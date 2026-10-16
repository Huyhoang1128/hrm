"""
salary/views.py – API endpoints cho Payroll module.
"""
from datetime import date
from hrm import branding
from django.utils import timezone
from django.db.models import Q

from django.db import models
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.response import Response

from employee.models import Employee, Department
from hrm.models import MonthlyWorkCredit, CompanyAnnouncement
from users.utils import get_user_role

from .models import MonthlySalaryRecord, SalaryComponent, SalaryFormula, SalaryComponentOverride
from .salary_data_models import EmployeeSalaryHistory, EmployeeKPIRecord, TaxBracketConfig, TaxBracket, DisciplinaryPenalty, SalesCommission, OvertimeRateConfig, SalaryAdvance, OtherAllowance, ParkingAllowanceOverride, LunchAllowanceOverride, EmployeeMonthlySalaryInput
from .salary_engine import SalaryRuleEngine
from .serializers import (
    ApproveSalarySerializer,
    BulkCalculateSalarySerializer,
    BulkImportAdvanceSerializer,
    BulkImportEmployeeMonthlySalaryInputSerializer,
    BulkImportCommissionSerializer,
    BulkImportOtherAllowanceSerializer,
    BulkImportParkingAllowanceSerializer,
    BulkImportPenaltySerializer,
    OtherAllowanceSerializer,
    ParkingAllowanceOverrideSerializer,
    LunchAllowanceOverrideSerializer,
    SalaryAdvanceSerializer,
    CalculateSalarySerializer,
    DisciplinaryPenaltySerializer,
    SalesCommissionSerializer,
    EmployeeKPIRecordSerializer,
    EmployeeSalaryHistorySerializer,
    MarkPaidSerializer,
    MonthlySalaryRecordListSerializer,
    MonthlySalaryRecordSerializer,
    UpdateSalaryStandardWorkDaysSerializer,
    OvertimeRateConfigSerializer,
    EmployeeMonthlySalaryInputSerializer,
    SalaryComponentOverrideSerializer,
    SalaryComponentSerializer,
    SalaryFormulaListSerializer,
    SalaryFormulaSerializer,
    TaxBracketConfigSerializer,
    TaxBracketSerializer,
)
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)


def _render_payslip_body_html(body: str) -> str:
    from html import escape

    def _is_separator_line(text: str) -> bool:
        stripped = text.strip()
        return bool(stripped) and all(char in '═─-_=.' for char in stripped)

    def _is_section_title(text: str) -> bool:
        stripped = text.strip()
        if not stripped or ':' in stripped or _is_separator_line(stripped):
            return False
        letters = [char for char in stripped if char.isalpha()]
        return bool(letters) and stripped == stripped.upper()

    def _render_fallback(text: str) -> str:
        blocks = []
        paragraph = []
        for raw_line in text.splitlines():
            stripped = raw_line.strip()
            if stripped:
                paragraph.append(escape(stripped))
                continue
            if paragraph:
                blocks.append(f"<p style=\"margin: 0 0 12px;\">{'<br>'.join(paragraph)}</p>")
                paragraph = []

        if paragraph:
            blocks.append(f"<p style=\"margin: 0 0 12px;\">{'<br>'.join(paragraph)}</p>")

        return ''.join(blocks) or '<p style="margin: 0;">&nbsp;</p>'

    lines = [line.rstrip() for line in body.splitlines()]
    if not any(_is_section_title(line) for line in lines):
        return _render_fallback(body)

    preamble = []
    sections = []
    closing = []
    current_section = None
    seen_section = False

    for raw_line in lines:
        stripped = raw_line.strip()
        if not stripped or _is_separator_line(stripped):
            continue

        if _is_section_title(stripped):
            seen_section = True
            current_section = {
                'title': stripped,
                'rows': [],
            }
            sections.append(current_section)
            continue

        if not seen_section:
            preamble.append(stripped)
            continue

        if current_section is not None and ':' in stripped:
            current_section['rows'].append(stripped)
            continue

        current_section = None
        closing.append(stripped)

    if not sections:
        return _render_fallback(body)

    summary_labels = {
        'LƯƠNG THỰC LĨNH',
        'CÒN PHẢI TT',
        'CÒN PHẢI THANH TOÁN',
        'TỔNG THU NHẬP',
        'TỔNG KHẤU TRỪ',
    }

    preamble_html = ''.join(
        f'<p style="margin: 0 0 12px; color: #374151; line-height: 1.7;">{escape(line)}</p>'
        for line in preamble
    )

    section_html_parts = []
    for section in sections:
        rows_html = []
        for row in section['rows']:
            label, value = [part.strip() for part in row.split(':', 1)]
            is_summary = label.upper() in summary_labels
            label_style = 'font-weight: 700; color: #111827;' if is_summary else 'color: #374151;'
            value_style = (
                'font-weight: 800; color: #0f766e; font-size: 15px;'
                if is_summary else
                'font-weight: 600; color: #111827;'
            )
            background = '#ecfdf5' if is_summary else '#ffffff'

            rows_html.append(
                f"""
                <tr>
                    <td style=\"padding: 12px 14px; border-bottom: 1px solid #e5e7eb; width: 56%; {label_style} background: {background};\">{escape(label)}</td>
                    <td align=\"right\" style=\"padding: 12px 14px; border-bottom: 1px solid #e5e7eb; {value_style} background: {background};\">{escape(value)}</td>
                </tr>
                """
            )

        section_html_parts.append(
            f"""
            <table style=\"width: 100%; border-collapse: separate; border-spacing: 0; margin: 0 0 16px; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\">
                <tr>
                    <td colspan=\"2\" style=\"padding: 12px 14px; background: linear-gradient(90deg, #eff6ff 0%, #f8fafc 100%); font-weight: 800; color: #1d4ed8; text-transform: uppercase; letter-spacing: 0.04em; font-size: 12px;\">{escape(section['title'])}</td>
                </tr>
                {''.join(rows_html)}
            </table>
            """
        )

    closing_html = ''.join(
        f'<p style="margin: 0 0 10px; color: #4b5563; line-height: 1.7;">{escape(line)}</p>'
        for line in closing
    )

    return f'{preamble_html}{"".join(section_html_parts)}{closing_html}'


def _build_payslip_email_html(subject: str, body: str) -> str:
    from html import escape

    logo_url = branding.email_logo_url()
    banner_url = branding.email_banner_url()

    safe_subject = escape(subject)
    rendered_body = _render_payslip_body_html(body)

    return f"""
<!DOCTYPE html>
<html>
<head><meta charset=\"utf-8\"></head>
<body style=\"font-family: Arial, sans-serif; font-size: 14px; color: #333; margin: 0; padding: 0; background-color: #f8fafc;\">
<table style=\"width: 100%; border-collapse: collapse;\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\">
    <tr>
        <td align=\"center\" style=\"padding: 20px 12px;\">
            <table style=\"width: 100%; max-width: 640px; border-collapse: collapse; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.06);\" cellpadding=\"0\" cellspacing=\"0\" role=\"presentation\">
                <tr>
                    <td style=\"padding: 0;\">
                        {branding.email_banner_html(640)}
                    </td>
                </tr>
                <tr>
                    <td style=\"padding: 24px;\">
                        <p style=\"margin: 0 0 12px;\">Kính gửi Anh/Chị,</p>
                        <p style=\"margin: 0 0 12px;\">Phòng Hành chính Nhân sự gửi Anh/Chị phiếu lương với thông tin chi tiết như bên dưới.</p>

                        <div style=\"margin: 16px 0 12px; padding: 14px 16px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; color: #1d4ed8; font-weight: 700; font-size: 15px;\">
                            {safe_subject}
                        </div>
                        <div style=\"background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; line-height: 1.65; color: #111827;\">
                            {rendered_body}
                        </div>

                        <p style=\"margin: 16px 0 0;\">Nếu cần hỗ trợ thêm, Anh/Chị vui lòng phản hồi email này hoặc liên hệ Phòng HCNS.</p>
                        <p style=\"margin: 12px 0 0;\">Trân trọng!</p>

                        <hr style=\"border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;\">
                        <table style=\"border-collapse: collapse;\" role=\"presentation\">
                            <tr>
                                <td style=\"width: 80px; vertical-align: middle; padding-right: 16px;\">
                                    {branding.email_logo_html()}
                                </td>
                                <td style=\"vertical-align: middle; color: #666; font-size: 13px; line-height: 1.5;\">
                                    {branding.hr_signature_html()}
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>"""


def _build_default_payslip_body(record: dict, year: int, month: int) -> str:
    import calendar as _cal

    _, days_in_month = _cal.monthrange(year, month)
    sundays = sum(1 for d in range(1, days_in_month + 1) if _cal.weekday(year, month, d) == 6)
    std_days = record.get('cong_chuan')
    if std_days is None:
        std_days = max(days_in_month - sundays - 1, 1)

    def _fmtN(value):
        try:
            v = float(value or 0)
            return f"{round(v):,}".replace(',', '.') + " đ" if v else "—"
        except Exception:
            return "—"

    def _fmt_num(value):
        try:
            v = float(value or 0)
            return str(int(v)) if v.is_integer() else str(v)
        except Exception:
            return str(value)

    month_label = f"Tháng {str(month).zfill(2)}.{year}"

    def _resolve_income_amount(input_key: str, fallback_keys: list[str]) -> float:
        input_value = record.get(input_key)
        if input_value is not None:
            try:
                return float(input_value or 0)
            except Exception:
                return 0
        for key in fallback_keys:
            value = record.get(key)
            if value is not None:
                try:
                    return float(value or 0)
                except Exception:
                    return 0
        return 0

    # ── Work days (all pre-computed in row) ──────────────────────────────────
    tong_cong = record.get('tong_cong') or 0
    cong_thu_viec = float(record.get('cong_thu_viec') or 0)
    cong_chinh_thuc = float(record.get('cong_chinh_thuc') or 0)
    has_probation = cong_thu_viec > 0 and cong_chinh_thuc > 0
    contract_status_text = 'Thử việc' if record.get('contract_status') == 'THU_VIEC' else 'Chính thức'
    so_gio_tang_ca = float(record.get('so_gio_tang_ca') or record.get('tang_ca') or 0)

    # ── Income (all pre-computed in row) ─────────────────────────────────────
    luong_ngay_cong = float(record.get('luong_ngay_cong') or 0)
    luong_ngay_cong_thu_viec = float(record.get('luong_ngay_cong_thu_viec') or 0)
    luong_ngay_cong_chinh_thuc = float(record.get('luong_ngay_cong_chinh_thuc') or 0)
    probation_rate_percent = float(record.get('probation_rate_percent') or 0)
    luong_doanh_so = _resolve_income_amount('luong_doanh_so_input', ['luong_doanh_so'])
    luong_ot = _resolve_income_amount('luong_ot_input', ['luong_ot', 'luong_tang_ca'])
    ban_san_pham = _resolve_income_amount('ban_san_pham_input', ['ban_san_pham'])
    phu_mo = _resolve_income_amount('phu_mo_input', ['phu_mo'])
    luong_truc_ca = _resolve_income_amount('truc_ca_input', ['truc_ca', 'truc_toi'])
    thu_nhap_khac = float(record.get('thu_nhap_khac') or 0)
    thuong = _resolve_income_amount('thuong_input', ['thuong'])

    # ── Allowances (pre-computed in row) ─────────────────────────────────────
    phu_cap_gui_xe = float(record.get('phu_cap_gui_xe') or 0)
    phu_cap_an_trua = float(record.get('phu_cap_an_trua') or 0)
    # phu_cap = total allowance stored by backend; remainder = trách nhiệm + khác
    phu_cap_total = float(record.get('phu_cap') or 0)
    phu_cap_remainder = max(round(phu_cap_total - phu_cap_gui_xe - phu_cap_an_trua), 0)

    # ── Deductions (all pre-computed in row) ─────────────────────────────────
    bh_deduction = float(record.get('bh_deduction') or 0)
    cong_doan = float(record.get('cong_doan') or 0)
    phat_di_muon = float(record.get('tong_phat') or 0)
    phat_bien_ban = float(record.get('tong_phat_bienban') or 0)
    thue_tncn = float(record.get('thue_tncn') or 0)
    tam_ung = float(record.get('tam_ung') or 0)
    dieu_chinh = float(record.get('dieu_chinh') or 0)

    # ── Insurance breakdown from stored base (standard employee rates) ───────
    # muc_luong_dong_bh is already stored in the row; just read the individual rates
    ins_base = float(record.get('muc_luong_dong_bh') or 0)
    if ins_base > 0:
        bhxh = round(ins_base * 0.08)
        bhyt = round(ins_base * 0.015)
        bhtn = round(ins_base * 0.01)
    else:
        # No ins_base stored — split from total proportionally (8 : 1.5 : 1)
        bhxh = round(bh_deduction * 80 / 105) if bh_deduction else 0
        bhyt = round(bh_deduction * 15 / 105) if bh_deduction else 0
        bhtn = round(bh_deduction * 10 / 105) if bh_deduction else 0

    # ── Totals: follow frontend payslip formula from component fields ─────────
    tong_luong_iii = luong_ngay_cong + luong_doanh_so + luong_ot + ban_san_pham + phu_mo + luong_truc_ca + thu_nhap_khac
    tong_phu_cap_iv = phu_cap_gui_xe + phu_cap_an_trua + phu_cap_remainder
    tong_thu_nhap = tong_luong_iii + tong_phu_cap_iv + thuong
    tong_giam_tru = bhxh + bhyt + bhtn + cong_doan + phat_di_muon + phat_bien_ban
    luong_thuc_linh = tong_thu_nhap - tong_giam_tru + dieu_chinh
    con_phai_thanh_toan = luong_thuc_linh - tam_ung - thue_tncn

    lines = [
        f"Kính gửi {record.get('ho_va_ten') or ''},",
        "",
        f"Phòng nhân sự trân trọng gửi phiếu lương {month_label} của bạn.",
        "",
        "════════════════════════════════════════",
        "  THÔNG TIN NHÂN VIÊN",
        "────────────────────────────────────────",
        f"  Mã nhân viên      : {record.get('ma_nv') or '—'}",
        f"  Họ và tên         : {record.get('ho_va_ten') or '—'}",
        f"  Phòng ban          : {record.get('phong_ban') or '—'}",
        f"  Chức vụ            : {record.get('vi_tri') or '—'}",
        f"  HĐ lao động        : {contract_status_text}",
        "────────────────────────────────────────",
        "  THÔNG TIN CÔNG",
        "────────────────────────────────────────",
        f"  Công chuẩn         : {std_days} công",
        f"  Ngày công thực tế  : {_fmt_num(tong_cong)}",
        *([ f"  Công TV / CT       : {_fmt_num(cong_thu_viec)} / {_fmt_num(cong_chinh_thuc)}" ] if has_probation else []),
        f"  Giờ tăng ca        : {_fmt_num(so_gio_tang_ca)}",
        "────────────────────────────────────────",
        "  CÁC KHOẢN THU NHẬP",
        "────────────────────────────────────────",
        f"  Lương ngày công    : {_fmtN(luong_ngay_cong)}",
        *([ f"  └─ Lương công TV ({round(probation_rate_percent)}%): {_fmtN(luong_ngay_cong_thu_viec)}" ] if has_probation else []),
        *([ f"  └─ Lương công CT    : {_fmtN(luong_ngay_cong_chinh_thuc)}" ] if has_probation else []),
        *([ f"  Lương doanh số     : {_fmtN(luong_doanh_so)}" ] if luong_doanh_so else []),
        *([ f"  Lương OT           : {_fmtN(luong_ot)}" ] if luong_ot else []),
        *([ f"  Bán sản phẩm       : {_fmtN(ban_san_pham)}" ] if ban_san_pham else []),
        *([ f"  Phụ mổ             : {_fmtN(phu_mo)}" ] if phu_mo else []),
        *([ f"  Trực Ca            : {_fmtN(luong_truc_ca)}" ] if luong_truc_ca else []),
        *([ f"  Thu nhập khác      : {_fmtN(thu_nhap_khac)}" ] if thu_nhap_khac else []),
        *([ f"  Thưởng             : {_fmtN(thuong)}" ] if thuong else []),
        "────────────────────────────────────────",
        "  CÁC KHOẢN PHỤ CẤP",
        "────────────────────────────────────────",
        *([ f"  Phụ cấp gửi xe     : {_fmtN(phu_cap_gui_xe)}" ] if phu_cap_gui_xe else []),
        *([ f"  Phụ cấp ăn trưa    : {_fmtN(phu_cap_an_trua)}" ] if phu_cap_an_trua else []),
        *([ f"  Phụ cấp khác       : {_fmtN(phu_cap_remainder)}" ] if phu_cap_remainder else []),
        f"  Tổng thu nhập      : {_fmtN(tong_thu_nhap)}",
        "────────────────────────────────────────",
        "  CÁC KHOẢN KHẤU TRỪ",
        "────────────────────────────────────────",
        f"  BHXH               : -{_fmtN(bhxh)}",
        f"  BHYT               : -{_fmtN(bhyt)}",
        f"  BHTN               : -{_fmtN(bhtn)}",
        *([ f"  Công đoàn          : -{_fmtN(cong_doan)}" ] if cong_doan else []),
        *([ f"  Phạt đi muộn       : -{_fmtN(phat_di_muon)}" ] if phat_di_muon else []),
        *([ f"  Phạt (biên bản)    : -{_fmtN(phat_bien_ban)}" ] if phat_bien_ban else []),
        *([ f"  Thuế TNCN          : -{_fmtN(thue_tncn)}" ] if thue_tncn else []),
        *([ f"  Tạm ứng            : -{_fmtN(tam_ung)}" ] if tam_ung else []),
        "════════════════════════════════════════",
        f"  LƯƠNG THỰC LĨNH    : {_fmtN(luong_thuc_linh)}",
        f"  CÒN PHẢI TT        : {_fmtN(con_phai_thanh_toan)}",
        "════════════════════════════════════════",
        "",
        "Nếu có thắc mắc về bảng lương, vui lòng liên hệ phòng Nhân sự.",
        "",
        "Trân trọng,",
        "Phòng Nhân sự",
    ]
    return "\n".join(lines)


def _format_template_value(template: str, data: dict) -> str:
    if not template:
        return ""
    formatted = template
    for key, value in data.items():
        formatted = formatted.replace(f"{{{key}}}", str(value))
    return formatted


def _merge_monthly_inputs_into_salary_rows(rows: list[dict], year: int, month: int) -> list[dict]:
    if not rows:
        return rows

    employee_ids = [row.get('employee_id') for row in rows if row.get('employee_id')]
    if not employee_ids:
        return rows

    monthly_inputs = EmployeeMonthlySalaryInput.objects.filter(
        year=year,
        month=month,
        employee_id__in=employee_ids,
    ).only('employee_id', 'luong_doanh_so', 'luong_ot', 'ban_san_pham', 'phu_mo', 'truc_ca', 'thuong')
    monthly_input_map = {item.employee_id: item for item in monthly_inputs}

    for row in rows:
        employee_id = row.get('employee_id')
        if not employee_id:
            continue

        monthly_input = monthly_input_map.get(employee_id)
        if not monthly_input:
            continue

        row['luong_doanh_so_input'] = float(monthly_input.luong_doanh_so) if monthly_input.luong_doanh_so is not None else None
        row['luong_ot_input'] = float(monthly_input.luong_ot) if monthly_input.luong_ot is not None else None
        row['ban_san_pham_input'] = float(monthly_input.ban_san_pham) if monthly_input.ban_san_pham is not None else None
        row['phu_mo_input'] = float(monthly_input.phu_mo) if monthly_input.phu_mo is not None else None
        row['truc_ca_input'] = float(monthly_input.truc_ca) if monthly_input.truc_ca is not None else None
        row['thuong_input'] = float(monthly_input.thuong) if monthly_input.thuong is not None else None
        row['thuong'] = float(monthly_input.thuong) if monthly_input.thuong is not None else float(row.get('thuong') or 0)

    return rows


class SalaryAdminPermission(BasePermission):
    """Chỉ admin mới được truy cập API lương."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and get_user_role(request.user) == 'admin'
        )


class SalaryAdvanceViewPermission(BasePermission):
    """
    Truy cập SalaryAdvance:
    - Admin/superuser: full quyền (list, create, update, delete, bulk_import).
    - HR (Employee.is_hr): chỉ đọc toàn bộ.
    - Quản lý có cấp dưới trực tiếp: chỉ đọc dữ liệu của cấp dưới.
    - Khác: từ chối.
    """
    SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser or get_user_role(user) == 'admin':
            return True

        if request.method not in self.SAFE_METHODS:
            return False

        try:
            employee = Employee.objects.only('id', 'is_hr').get(user=user)
        except Employee.DoesNotExist:
            return False
        if employee.is_hr:
            return True

        return Employee.objects.filter(manager=employee).exists()


class ParkingAllowanceOverridePermission(BasePermission):
    """
    Truy cập Phụ cấp gửi xe (ParkingAllowanceOverride):
    - Admin/superuser: full quyền.
    - HR (Employee.is_hr=True): full quyền (được import/sửa/xoá) — đây là người thực hiện import.
    - Khác: từ chối.
    """
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_superuser or get_user_role(user) == 'admin':
            return True
        try:
            employee = Employee.objects.only('id', 'is_hr').get(user=user)
        except Employee.DoesNotExist:
            return False
        return bool(employee.is_hr)


class LunchAllowanceOverridePermission(ParkingAllowanceOverridePermission):
    """Truy cập Phụ cấp ăn trưa (LunchAllowanceOverride): cùng quy tắc với phụ cấp gửi xe."""


class SalaryPenaltyPermission(BasePermission):
    """Admin hoặc nhân sự có quyền quản lý phạt biên bản mới được truy cập."""

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False

        if user.is_superuser or get_user_role(user) == 'admin':
            return True

        try:
            employee = Employee.objects.only('id').get(user=user)
        except Employee.DoesNotExist:
            return False

        from hrm.models import EmployeePermission

        try:
            permission = EmployeePermission.objects.only(
                'can_manage_disciplinary_penalties'
            ).get(employee=employee)
            return bool(permission.can_manage_disciplinary_penalties)
        except EmployeePermission.DoesNotExist:
            return False


def _create_penalty_announcement(*, recipient: Employee, title: str, content: str, creator: Employee | None = None):
    announcement = CompanyAnnouncement.objects.create(
        title=title,
        content=content,
        announcement_type='NOTICE',
        priority='HIGH',
        apply_to_all=False,
        effective_from=timezone.now().date(),
        is_active=True,
        created_by=creator,
        approved_by=creator,
    )
    announcement.employees.add(recipient)
    return announcement


def _format_penalty_text(penalty: DisciplinaryPenalty, *, action_label: str) -> tuple[str, str]:
    title = f'{action_label} biên bản phạt tháng {penalty.month}/{penalty.year}'
    content = (
        f'Nhân sự: {penalty.employee.full_name}\n'
        f'Mã NV: {penalty.employee.employee_id}\n'
        f'Số tiền: {float(penalty.amount):,.0f} đ\n'
        f'Lý do: {penalty.reason or "Không có"}\n'
        f'Trạng thái: {penalty.get_status_display()}'
    )
    return title, content


# ---------------------------------------------------------------------------
# SalaryFormula ViewSet
# ---------------------------------------------------------------------------

class SalaryFormulaViewSet(viewsets.ModelViewSet):
    """
    CRUD cho công thức lương (SalaryFormula + SalaryComponent).
    """
    queryset = SalaryFormula.objects.prefetch_related(
        'components', 'apply_to_departments', 'apply_to_positions', 'apply_to_employees'
    ).order_by('-priority', '-effective_from')
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_serializer_class(self):
        if self.action == 'list':
            return SalaryFormulaListSerializer
        return SalaryFormulaSerializer

    @action(detail=False, methods=['get'], url_path='active')
    def active_formulas(self, request):
        """Danh sách công thức đang kích hoạt."""
        qs = self.get_queryset().filter(is_active=True)
        serializer = SalaryFormulaListSerializer(qs, many=True)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# SalaryComponent ViewSet
# ---------------------------------------------------------------------------

class SalaryComponentViewSet(viewsets.ModelViewSet):
    """
    CRUD cho thành phần lương (SalaryComponent).
    Hỗ trợ filter theo formula: /salary/components/?formula=<id>
    """
    queryset = SalaryComponent.objects.select_related('formula').order_by('formula', 'order')
    serializer_class = SalaryComponentSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        formula_id = self.request.query_params.get('formula')
        if formula_id:
            qs = qs.filter(formula_id=formula_id)
        return qs


# ---------------------------------------------------------------------------
# SalaryComponentOverride ViewSet
# ---------------------------------------------------------------------------

class SalaryComponentOverrideViewSet(viewsets.ModelViewSet):
    """
    CRUD cho điều chỉnh khoản lương cá nhân/tháng (SalaryComponentOverride).
    Hỗ trợ filter: ?employee=<id>&year=<y>&month=<m>
    """
    queryset = SalaryComponentOverride.objects.select_related('employee', 'created_by').order_by(
        '-year', '-month', 'employee'
    )
    serializer_class = SalaryComponentOverrideSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if emp_id := params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        return qs


# ---------------------------------------------------------------------------
# EmployeeSalaryHistory ViewSet
# ---------------------------------------------------------------------------

class EmployeeSalaryHistoryViewSet(viewsets.ModelViewSet):
    """
    CRUD cho lịch sử lương nhân viên (EmployeeSalaryHistory).
    Hỗ trợ filter: ?employee=<id>
    """
    queryset = EmployeeSalaryHistory.objects.select_related('employee', 'created_by').order_by(
        'employee', '-effective_from'
    )
    serializer_class = EmployeeSalaryHistorySerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        if emp_id := self.request.query_params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        return qs


# ---------------------------------------------------------------------------
# EmployeeKPIRecord ViewSet
# ---------------------------------------------------------------------------

class EmployeeKPIRecordViewSet(viewsets.ModelViewSet):
    """
    CRUD cho dữ liệu KPI tháng (EmployeeKPIRecord).
    Hỗ trợ filter: ?employee=<id>&year=<y>&month=<m>
    """
    queryset = EmployeeKPIRecord.objects.select_related('employee', 'created_by').order_by(
        '-year', '-month', 'employee'
    )
    serializer_class = EmployeeKPIRecordSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if emp_id := params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        return qs



# ---------------------------------------------------------------------------
# SalesCommission ViewSet
# ---------------------------------------------------------------------------

class SalesCommissionViewSet(viewsets.ModelViewSet):
    """
    CRUD cho hoa hồng doanh số (SalesCommission).
    Hỗ trợ filter: ?year=<y>&month=<m>
    """
    queryset = SalesCommission.objects.select_related('employee').order_by(
        '-year', '-month', 'employee__full_name'
    )
    serializer_class = SalesCommissionSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        return qs

    @action(detail=False, methods=['post'], url_path='bulk-import')
    def bulk_import(self, request):
        """Import hàng loạt hoa hồng từ Excel (update_or_create)."""
        ser = BulkImportCommissionSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        year, month, records = data['year'], data['month'], data['records']
        codes = [r['employee_code'] for r in records]
        emp_map = {e.employee_id: e for e in Employee.objects.filter(employee_id__in=codes)}
        results = {'success': [], 'errors': []}
        for row in records:
            code = row['employee_code']
            emp = emp_map.get(code)
            if not emp:
                results['errors'].append({'employee_code': code, 'error': f"Không tìm thấy '{code}'."})
                continue
            try:
                existing = SalesCommission.objects.filter(employee=emp, year=year, month=month).first()
                if existing:
                    if row['commission_amount']:
                        existing.amount = row['commission_amount']
                        existing.save(update_fields=['amount', 'updated_at'])
                    created = False
                    obj = existing
                else:
                    obj = SalesCommission.objects.create(
                        employee=emp, year=year, month=month,
                        amount=row['commission_amount'],
                    )
                    created = True
                results['success'].append({
                    'employee_code': code,
                    'employee_name': emp.full_name,
                    'commission_amount': float(obj.amount),
                    'created': created,
                })
            except Exception as exc:
                results['errors'].append({'employee_code': code, 'error': str(exc)})
        return Response(results, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# EmployeeMonthlySalaryInput ViewSet
# ---------------------------------------------------------------------------

class EmployeeMonthlySalaryInputViewSet(viewsets.ModelViewSet):
    """
    CRUD cho dữ liệu lương tháng theo nhân viên.
    Hỗ trợ filter: ?year=<y>&month=<m>&employee=<id>
    """
    queryset = EmployeeMonthlySalaryInput.objects.select_related('employee').order_by(
        '-year', '-month', 'employee__full_name'
    )
    serializer_class = EmployeeMonthlySalaryInputSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        if emp_id := params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        return qs

    @action(detail=False, methods=['post'], url_path='bulk-import')
    def bulk_import(self, request):
        """Import hàng loạt dữ liệu lương tháng từ Excel (update_or_create)."""
        ser = BulkImportEmployeeMonthlySalaryInputSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        year, month, records = data['year'], data['month'], data['records']
        codes = [r['employee_code'] for r in records]
        emp_map = {e.employee_id: e for e in Employee.objects.filter(employee_id__in=codes)}
        results = {'success': [], 'errors': []}

        for row in records:
            code = row['employee_code']
            emp = emp_map.get(code)
            if not emp:
                results['errors'].append({'employee_code': code, 'error': f"Không tìm thấy nhân viên '{code}'."})
                continue

            try:
                defaults = {
                    'luong_doanh_so': row.get('luong_doanh_so', None),
                    'luong_ot': row.get('luong_ot', None),
                    'ban_san_pham': row.get('ban_san_pham', None),
                    'phu_mo': row.get('phu_mo', None),
                    'truc_ca': row.get('truc_ca', None),
                    'thuong': row.get('thuong', None),
                }
                obj, created = EmployeeMonthlySalaryInput.objects.update_or_create(
                    employee=emp,
                    year=year,
                    month=month,
                    defaults=defaults,
                )
                results['success'].append({
                    'employee_code': code,
                    'employee_name': emp.full_name,
                    'luong_doanh_so': float(obj.luong_doanh_so) if obj.luong_doanh_so is not None else None,
                    'luong_ot': float(obj.luong_ot) if obj.luong_ot is not None else None,
                    'ban_san_pham': float(obj.ban_san_pham) if obj.ban_san_pham is not None else None,
                    'phu_mo': float(obj.phu_mo) if obj.phu_mo is not None else None,
                    'truc_ca': float(obj.truc_ca) if obj.truc_ca is not None else None,
                    'thuong': float(obj.thuong) if obj.thuong is not None else None,
                    'created': created,
                })
            except Exception as exc:
                results['errors'].append({'employee_code': code, 'error': str(exc)})

        return Response(results, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# DisciplinaryPenalty ViewSet
# ---------------------------------------------------------------------------

class DisciplinaryPenaltyViewSet(viewsets.ModelViewSet):
    """
    CRUD cho phạt biên bản (DisciplinaryPenalty).
    Hỗ trợ filter: ?year=<y>&month=<m>&employee=<id>
    """
    queryset = DisciplinaryPenalty.objects.select_related(
        'employee', 'employee__department', 'employee__company_unit', 'created_by'
    ).order_by(
        '-year', '-month', 'employee__full_name'
    )
    serializer_class = DisciplinaryPenaltySerializer
    permission_classes = [IsAuthenticated, SalaryPenaltyPermission]

    def get_permissions(self):
        """Manager approval endpoints should be reachable by direct managers as well.

        Create/update/delete stays behind the explicit disciplinary permission,
        but the approval inbox and approve/reject actions are controlled by
        the object-level checks inside the handlers.
        """
        if self.action in {'pending_approvals', 'approve', 'reject'}:
            return [IsAuthenticated()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        if emp_id := params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        status_param = params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def perform_create(self, serializer):
        creator = getattr(self.request.user, 'employee', None)
        penalty = serializer.save(status='PENDING_MANAGER', created_by=creator)

        title, content = _format_penalty_text(penalty, action_label='Biên bản phạt mới')
        _create_penalty_announcement(recipient=penalty.employee, title=title, content=content, creator=creator)

        manager = penalty.employee.manager or (penalty.employee.department.manager if penalty.employee.department else None)
        if manager and manager.id != penalty.employee.id:
            mgr_title = f'Cần duyệt biên bản phạt tháng {penalty.month}/{penalty.year}'
            mgr_content = (
                f'Nhân sự {penalty.employee.full_name} ({penalty.employee.employee_id}) có biên bản phạt chờ duyệt.\n'
                f'Số tiền: {float(penalty.amount):,.0f} đ\n'
                f'Lý do: {penalty.reason or "Không có"}'
            )
            _create_penalty_announcement(recipient=manager, title=mgr_title, content=mgr_content, creator=creator)

    @action(detail=False, methods=['get'], url_path='pending-approvals')
    def pending_approvals(self, request):
        """Danh sách biên bản phạt chờ quản lý duyệt cho Home."""
        try:
            approver = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response({'results': []})

        employee_ids = []
        if request.user.is_staff or request.user.is_superuser:
            qs = self.get_queryset().filter(status='PENDING_MANAGER')
            serializer = self.get_serializer(qs, many=True)
            return Response({'results': serializer.data})

        employee_ids = set(
            Employee.objects.filter(manager_id=approver.id).values_list('id', flat=True)
        )

        if approver.department and approver.department.manager_id == approver.id:
            employee_ids.update(
                Employee.objects.filter(department=approver.department).values_list('id', flat=True)
            )

        employee_ids = list(employee_ids)

        qs = self.get_queryset().filter(employee_id__in=employee_ids, status='PENDING_MANAGER')
        serializer = self.get_serializer(qs, many=True)
        return Response({'results': serializer.data})

    @action(detail=False, methods=['get'], url_path='my-pending', permission_classes=[IsAuthenticated])
    def my_pending(self, request):
        """Danh sách biên bản phạt chờ duyệt của chính nhân sự đang đăng nhập."""
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response({'results': []})

        qs = self.get_queryset().filter(employee=employee, status='PENDING_MANAGER')
        serializer = self.get_serializer(qs, many=True)
        return Response({'results': serializer.data})

    @action(detail=False, methods=['get'], url_path='my-penalties', permission_classes=[IsAuthenticated])
    def my_penalties(self, request):
        """Danh sách biên bản phạt của chính nhân sự (chờ duyệt/đã duyệt/từ chối)."""
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response({'results': []})

        qs = self.get_queryset().filter(
            employee=employee
        ).filter(
            Q(status='PENDING_MANAGER') | Q(status='APPROVED') | Q(status='REJECTED')
        )
        serializer = self.get_serializer(qs, many=True)
        return Response({'results': serializer.data})

    @action(detail=False, methods=['post'], url_path='finalize-month')
    def finalize_month(self, request):
        """Chốt biên bản phạt theo tháng: chuyển toàn bộ PENDING_MANAGER -> APPROVED."""
        year = request.data.get('year')
        month = request.data.get('month')

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response({'error': 'Năm/tháng không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        if month < 1 or month > 12:
            return Response({'error': 'Tháng không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        operator = getattr(request.user, 'employee', None)
        now_time = timezone.now()
        penalties = list(self.get_queryset().filter(year=year, month=month, status='PENDING_MANAGER'))

        if not penalties:
            return Response({'updated': 0, 'message': 'Không có biên bản chờ duyệt để chốt.'})

        for penalty in penalties:
            penalty.status = 'APPROVED'
            penalty.direct_manager_approved_by = operator
            penalty.direct_manager_approved_at = now_time
            penalty.approved_by = operator
            penalty.approved_at = now_time
            if not penalty.approval_note:
                penalty.approval_note = 'Chốt biên bản theo tháng'

        DisciplinaryPenalty.objects.bulk_update(
            penalties,
            [
                'status',
                'direct_manager_approved_by',
                'direct_manager_approved_at',
                'approved_by',
                'approved_at',
                'approval_note',
                'updated_at',
            ]
        )

        return Response({'updated': len(penalties), 'message': 'Chốt biên bản thành công.'})

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        penalty = self.get_object()
        if penalty.status != 'PENDING_MANAGER':
            return Response({'error': 'Biên bản không ở trạng thái chờ duyệt.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            approver = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response({'error': 'Không xác định được người duyệt.'}, status=status.HTTP_403_FORBIDDEN)

        is_admin = request.user.is_staff or request.user.is_superuser
        is_direct_manager = penalty.employee.manager_id == approver.id or (penalty.employee.department and penalty.employee.department.manager_id == approver.id)
        if not (is_admin or is_direct_manager):
            return Response({'error': 'Bạn không có quyền duyệt biên bản này.'}, status=status.HTTP_403_FORBIDDEN)

        penalty.status = 'APPROVED'
        penalty.direct_manager_approved_by = approver
        penalty.direct_manager_approved_at = timezone.now()
        penalty.approved_by = approver if not is_admin else approver
        penalty.approved_at = timezone.now()
        penalty.approval_note = request.data.get('note', '')
        penalty.save(update_fields=['status', 'direct_manager_approved_by', 'direct_manager_approved_at', 'approved_by', 'approved_at', 'approval_note', 'updated_at'])

        title, content = _format_penalty_text(penalty, action_label='Biên bản phạt đã được duyệt')
        _create_penalty_announcement(recipient=penalty.employee, title=title, content=content, creator=approver)
        return Response(self.get_serializer(penalty).data)

    @action(detail=True, methods=['post'], url_path='reject')
    def reject(self, request, pk=None):
        penalty = self.get_object()
        if penalty.status != 'PENDING_MANAGER':
            return Response({'error': 'Biên bản không ở trạng thái chờ duyệt.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            approver = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response({'error': 'Không xác định được người duyệt.'}, status=status.HTTP_403_FORBIDDEN)

        is_admin = request.user.is_staff or request.user.is_superuser
        is_direct_manager = penalty.employee.manager_id == approver.id or (penalty.employee.department and penalty.employee.department.manager_id == approver.id)
        if not (is_admin or is_direct_manager):
            return Response({'error': 'Bạn không có quyền từ chối biên bản này.'}, status=status.HTTP_403_FORBIDDEN)

        penalty.status = 'REJECTED'
        penalty.rejected_by = approver
        penalty.rejected_at = timezone.now()
        penalty.approval_note = request.data.get('note', '')
        penalty.save(update_fields=['status', 'rejected_by', 'rejected_at', 'approval_note', 'updated_at'])

        title, content = _format_penalty_text(penalty, action_label='Biên bản phạt bị từ chối')
        _create_penalty_announcement(recipient=penalty.employee, title=title, content=content, creator=approver)
        return Response(self.get_serializer(penalty).data)

    @action(detail=False, methods=['post'], url_path='bulk-import')
    def bulk_import(self, request):
        """Import hàng loạt phạt biên bản từ Excel."""
        serializer = BulkImportPenaltySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        year, month, records = data['year'], data['month'], data['records']
        codes = [r['employee_code'] for r in records]
        emp_map = {e.employee_id: e for e in Employee.objects.filter(employee_id__in=codes)}
        results = {'success': [], 'errors': []}
        for row in records:
            code = row['employee_code']
            emp = emp_map.get(code)
            if not emp:
                results['errors'].append({'employee_code': code, 'error': f"Không tìm thấy nhân viên '{code}'."})
                continue
            try:
                existing = DisciplinaryPenalty.objects.filter(employee=emp, year=year, month=month).first()
                if existing:
                    update_fields = []
                    if row['amount']:
                        existing.amount = row['amount']
                        update_fields.append('amount')
                    if row.get('reason'):
                        existing.reason = row['reason']
                        update_fields.append('reason')
                    if update_fields:
                        update_fields.append('updated_at')
                        existing.save(update_fields=update_fields)
                    obj = existing
                    created = False
                else:
                    obj = DisciplinaryPenalty.objects.create(
                        employee=emp, year=year, month=month,
                        amount=row['amount'], reason=row.get('reason', ''), status='PENDING_MANAGER',
                        created_by=getattr(request.user, 'employee', None),
                    )
                    creator = getattr(request.user, 'employee', None)
                    title, content = _format_penalty_text(obj, action_label='Biên bản phạt mới')
                    _create_penalty_announcement(recipient=emp, title=title, content=content, creator=creator)
                    created = True
                results['success'].append({
                    'id': obj.id,
                    'employee_code': code,
                    'employee_name': emp.full_name,
                    'amount': float(obj.amount),
                    'reason': obj.reason,
                    'created': created,
                })
            except Exception as exc:
                results['errors'].append({'employee_code': code, 'error': str(exc)})
        return Response(results, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# SalaryAdvance ViewSet
# ---------------------------------------------------------------------------

class SalaryAdvanceViewSet(viewsets.ModelViewSet):
    """
    CRUD cho tạm ứng lương (SalaryAdvance).
    Hỗ trợ filter: ?year=<y>&month=<m>&employee=<id>
    """
    queryset = SalaryAdvance.objects.select_related(
        'employee', 'employee__department', 'employee__manager',
    ).order_by('-year', '-month', 'employee__full_name')
    serializer_class = SalaryAdvanceSerializer
    permission_classes = [IsAuthenticated, SalaryAdvanceViewPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user

        # Chỉ ADMIN/HR được xem toàn bộ. Quản lý chỉ xem nhân sự
        # có manager trực tiếp là chính mình; không mở rộng theo phòng ban.
        is_admin = user.is_superuser or get_user_role(user) == 'admin'
        if not is_admin:
            try:
                employee = Employee.objects.only('id', 'is_hr').get(user=user)
            except Employee.DoesNotExist:
                return qs.none()
            if not employee.is_hr:
                qs = qs.filter(employee__manager=employee)

        params = self.request.query_params
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        if emp_id := params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        return qs

    @action(detail=False, methods=['post'], url_path='bulk-import')
    def bulk_import(self, request):
        """Import hàng loạt tạm ứng lương từ Excel (update_or_create)."""
        ser = BulkImportAdvanceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        year, month, records = data['year'], data['month'], data['records']
        codes = [r['employee_code'] for r in records]
        emp_map = {e.employee_id: e for e in Employee.objects.filter(employee_id__in=codes)}
        results = {'success': [], 'errors': []}
        for row in records:
            code = row['employee_code']
            emp = emp_map.get(code)
            if not emp:
                results['errors'].append({'employee_code': code, 'error': f"Không tìm thấy nhân viên '{code}'."})
                continue
            try:
                obj, created = SalaryAdvance.objects.update_or_create(
                    employee=emp, year=year, month=month,
                    defaults={'amount': row['amount']},
                )
                results['success'].append({
                    'employee_code': code,
                    'employee_name': emp.full_name,
                    'amount': float(obj.amount),
                    'created': created,
                })
            except Exception as exc:
                results['errors'].append({'employee_code': code, 'error': str(exc)})
        return Response(results, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# OtherAllowance ViewSet
# ---------------------------------------------------------------------------

class OtherAllowanceViewSet(viewsets.ModelViewSet):
    """
    CRUD cho phụ cấp khác (OtherAllowance).
    Hỗ trợ filter: ?year=<y>&month=<m>&employee=<id>
    """
    queryset = OtherAllowance.objects.select_related('employee').order_by(
        '-year', '-month', 'employee__full_name'
    )
    serializer_class = OtherAllowanceSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        if emp_id := params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        return qs

    @action(detail=False, methods=['post'], url_path='bulk-import')
    def bulk_import(self, request):
        """Import hàng loạt phụ cấp khác từ Excel (update_or_create)."""
        ser = BulkImportOtherAllowanceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        year, month, records = data['year'], data['month'], data['records']
        codes = [r['employee_code'] for r in records]
        emp_map = {e.employee_id: e for e in Employee.objects.filter(employee_id__in=codes)}
        results = {'success': [], 'errors': []}
        for row in records:
            code = row['employee_code']
            emp = emp_map.get(code)
            if not emp:
                results['errors'].append({'employee_code': code, 'error': f"Không tìm thấy nhân viên '{code}'."})
                continue
            try:
                obj, created = OtherAllowance.objects.update_or_create(
                    employee=emp, year=year, month=month,
                    defaults={'amount': row['amount'], 'description': row.get('description', '')},
                )
                results['success'].append({
                    'employee_code': code,
                    'employee_name': emp.full_name,
                    'amount': float(obj.amount),
                    'description': obj.description,
                    'created': created,
                })
            except Exception as exc:
                results['errors'].append({'employee_code': code, 'error': str(exc)})
        return Response(results, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# ParkingAllowanceOverride ViewSet
# ---------------------------------------------------------------------------

class _AllowanceOverrideViewSetBase(viewsets.ModelViewSet):
    """
    Phần dùng chung của các bảng phụ cấp nhập tay theo kỳ (gửi xe, ăn trưa):
    filter ?year=&month=&employee=, import hàng loạt từ Excel và tạo bản ghi
    cho những nhân viên đang hoạt động chưa có trong kỳ.
    """
    override_model = None
    label = ''

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        if emp_id := params.get('employee'):
            qs = qs.filter(employee_id=emp_id)
        return qs

    @action(detail=False, methods=['post'], url_path='bulk-import')
    def bulk_import(self, request):
        """Import hàng loạt phụ cấp (đã tính sẵn) từ Excel (update_or_create)."""
        ser = BulkImportParkingAllowanceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        year, month, records = data['year'], data['month'], data['records']
        codes = [r['employee_code'] for r in records]
        emp_map = {e.employee_id: e for e in Employee.objects.filter(employee_id__in=codes)}
        results = {'success': [], 'errors': []}
        for row in records:
            code = row['employee_code']
            emp = emp_map.get(code)
            if not emp:
                results['errors'].append({'employee_code': code, 'error': f"Không tìm thấy nhân viên '{code}'."})
                continue
            try:
                obj, created = self.override_model.objects.update_or_create(
                    employee=emp, year=year, month=month,
                    defaults={'amount': row['amount'], 'notes': row.get('notes', '')},
                )
                results['success'].append({
                    'employee_code': code,
                    'employee_name': emp.full_name,
                    'amount': float(obj.amount),
                    'notes': obj.notes,
                    'created': created,
                })
            except Exception as exc:
                results['errors'].append({'employee_code': code, 'error': str(exc)})
        return Response(results, status=status.HTTP_200_OK)

    def _create_missing_for_period(self, request, amount_for, notes):
        """
        Tạo bản ghi cho TẤT CẢ nhân viên đang hoạt động CHƯA có bản ghi ở kỳ
        (year, month) trong request. `amount_for(employees, year, month)` trả về
        dict {employee_id: số tiền}. KHÔNG đụng tới các bản ghi đã tồn tại
        (kể cả đã sửa tay từ trước).
        """
        try:
            year, month = int(request.data.get('year')), int(request.data.get('month'))
        except (TypeError, ValueError):
            return Response({'detail': 'Thiếu hoặc sai định dạng year/month.'}, status=status.HTTP_400_BAD_REQUEST)
        if not (2000 <= year <= 2100 and 1 <= month <= 12):
            return Response({'detail': 'Thiếu hoặc sai định dạng year/month.'}, status=status.HTTP_400_BAD_REQUEST)

        created_by = Employee.objects.filter(user=request.user).only('id').first()
        existing_employee_ids = set(
            self.override_model.objects.filter(year=year, month=month).values_list('employee_id', flat=True)
        )
        remaining = list(Employee.objects.filter(is_active=True).exclude(id__in=existing_employee_ids))
        amounts = amount_for(remaining, year, month)

        created_count = 0
        errors = []
        for emp in remaining:
            try:
                _, created = self.override_model.objects.get_or_create(
                    employee=emp, year=year, month=month,
                    defaults={'amount': amounts.get(emp.id, Decimal('0')), 'notes': notes, 'created_by': created_by},
                )
                created_count += int(created)
            except Exception as exc:
                errors.append({'employee_code': emp.employee_id, 'error': str(exc)})

        return Response({
            'created_count': created_count,
            'skipped_existing_count': len(existing_employee_ids),
            'errors': errors,
        }, status=status.HTTP_200_OK)


class ParkingAllowanceOverrideViewSet(_AllowanceOverrideViewSetBase):
    """
    CRUD cho phụ cấp gửi xe nhập tay (ParkingAllowanceOverride).
    Khi tồn tại bản ghi cho (employee, year, month), giá trị này luôn được
    ưu tiên dùng thay cho kết quả tính theo parkingAllowancePolicy khi chốt
    lương (xem hrm/finalization_views.py::_get_parking_allowance_override).
    Hỗ trợ filter: ?year=<y>&month=<m>&employee=<id>
    """
    queryset = ParkingAllowanceOverride.objects.select_related('employee').order_by(
        '-year', '-month', 'employee__full_name'
    )
    serializer_class = ParkingAllowanceOverrideSerializer
    permission_classes = [IsAuthenticated, ParkingAllowanceOverridePermission]
    override_model = ParkingAllowanceOverride

    @action(detail=False, methods=['post'], url_path='fill-remaining-zero')
    def fill_remaining_zero(self, request):
        """
        Đặt phụ cấp gửi xe = 0 cho mọi nhân viên đang hoạt động chưa có bản ghi
        ở kỳ — dùng khi HR đã import xong danh sách người ĐƯỢC phụ cấp và muốn
        những người còn lại về 0 mà không phải gõ tay từng người vào file Excel.
        """
        return self._create_missing_for_period(
            request, lambda employees, year, month: {}, 'Tự động: không có trong danh sách import',
        )


class LunchAllowanceOverrideViewSet(_AllowanceOverrideViewSetBase):
    """
    CRUD cho phụ cấp ăn trưa nhập tay (LunchAllowanceOverride).
    Khi tồn tại bản ghi cho (employee, year, month), giá trị này luôn được
    ưu tiên dùng thay cho kết quả tính theo lunchAllowancePolicy khi tính
    lương (xem hrm/finalization_views.py::_calculate_lunch_allowance).
    Hỗ trợ filter: ?year=<y>&month=<m>&employee=<id>
    """
    queryset = LunchAllowanceOverride.objects.select_related('employee').order_by(
        '-year', '-month', 'employee__full_name'
    )
    serializer_class = LunchAllowanceOverrideSerializer
    permission_classes = [IsAuthenticated, LunchAllowanceOverridePermission]
    override_model = LunchAllowanceOverride

    @action(detail=False, methods=['post'], url_path='sync-current')
    def sync_current(self, request):
        """
        Tạo bản ghi = giá trị đang được TÍNH TỰ ĐỘNG (lunchAllowancePolicy của
        từng nhân viên + tổng công đã chốt của kỳ) cho mọi nhân viên đang hoạt
        động chưa có bản ghi — làm điểm khởi đầu để HR rà soát/sửa tay sau.
        """
        from hrm.finalization_views import _calculate_lunch_allowance
        from hrm.models import WorkFinalization

        def amount_for(employees, year, month):
            work_days = dict(WorkFinalization.objects.filter(
                year=year, month=month, employee_id__in=[e.id for e in employees],
            ).values_list('employee_id', 'tong_cong'))
            return {
                emp.id: _calculate_lunch_allowance(emp, Decimal(str(work_days.get(emp.id) or 0)), year, month)
                for emp in employees
            }

        return self._create_missing_for_period(request, amount_for, 'Tự động: đồng bộ từ tính toán hiện tại')


# ---------------------------------------------------------------------------
# TaxBracketConfig ViewSet
# ---------------------------------------------------------------------------

class TaxBracketConfigViewSet(viewsets.ModelViewSet):
    """
    CRUD cho bảng thuế TNCN lũy tiến (TaxBracketConfig + TaxBracket).
    """
    queryset = TaxBracketConfig.objects.prefetch_related('brackets').order_by('-effective_from')
    serializer_class = TaxBracketConfigSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    @action(detail=False, methods=['get'], url_path='active')
    def active(self, request):
        """Lấy bảng thuế đang áp dụng."""
        config = TaxBracketConfig.get_active()
        if not config:
            return Response({'detail': 'Chưa có bảng thuế nào đang hoạt động.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(TaxBracketConfigSerializer(config).data)


# ---------------------------------------------------------------------------
# MonthlySalaryRecord ViewSet
# ---------------------------------------------------------------------------

class MonthlySalaryRecordViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Xem bảng lương tháng.
    Hỗ trợ filter: ?year=2025&month=3&employee=<id>&status=DRAFT
    """
    queryset = MonthlySalaryRecord.objects.select_related(
        'employee', 'formula_used', 'work_credit', 'approved_by'
    ).order_by('-year', '-month', 'employee__full_name')
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_serializer_class(self):
        if self.action == 'list':
            return MonthlySalaryRecordListSerializer
        return MonthlySalaryRecordSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        if year := params.get('year'):
            qs = qs.filter(year=year)
        if month := params.get('month'):
            qs = qs.filter(month=month)
        if employee_id := params.get('employee'):
            qs = qs.filter(employee_id=employee_id)
        if record_status := params.get('status'):
            qs = qs.filter(status=record_status)
        if dept_id := params.get('department'):
            qs = qs.filter(employee__department_id=dept_id)
        return qs

    @action(detail=False, methods=['get'], url_path='departments')
    def departments(self, request):
        departments = Department.objects.filter(is_section=False).order_by('code', 'name')
        return Response([
            {
                'id': department.id,
                'name': department.name,
                'code': department.code,
            }
            for department in departments
        ])

    @action(detail=False, methods=['get'], url_path='comparison-report')
    def comparison_report(self, request):
        """
        Báo cáo biến động lương giữa hai tháng — xem salary/comparison_report.py.

        GET ?month_a=2026-08&month_b=2026-09[&department=<id>][&legal_entity=<tên>][&employee=<mã/tên>]
        """
        from .comparison_report import build_comparison, parse_period

        params = request.query_params
        period_a = parse_period(params.get('month_a'))
        period_b = parse_period(params.get('month_b'))
        if period_a is None or period_b is None:
            return Response(
                {'detail': 'Cần chọn đủ hai tháng so sánh (month_a, month_b dạng YYYY-MM).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        department = params.get('department') or None
        if department is not None and not str(department).isdigit():
            return Response({'detail': 'department phải là số nguyên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            data = build_comparison(
                period_a, period_b,
                department_id=department,
                legal_entity=(params.get('legal_entity') or '').strip(),
                employee=(params.get('employee') or '').strip() or None,
            )
        except Exception:
            logger.exception('[SalaryComparison] Lỗi dựng báo cáo')
            return Response({'detail': 'Lỗi khi lấy dữ liệu bảng lương.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(data)

    @action(detail=False, methods=['get'], url_path='legal-entities')
    def legal_entities(self, request):
        from django.db.models.functions import Trim

        values = (
            Employee.objects
            .annotate(_legal_entity=Trim('subsidiary_legal_entity'))
            .exclude(_legal_entity__isnull=True)
            .exclude(_legal_entity__exact='')
            .values_list('_legal_entity', flat=True)
            .distinct()
        )

        dedup_map = {}
        for legal_entity in values:
            normalized = str(legal_entity).strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key not in dedup_map:
                dedup_map[key] = normalized

        legal_entities = sorted(dedup_map.values(), key=lambda item: item.lower())
        return Response([
            {'value': legal_entity, 'label': legal_entity}
            for legal_entity in legal_entities
        ])

    # ------------------------------------------------------------------
    # Tính lương
    # ------------------------------------------------------------------

    @action(detail=False, methods=['post'], url_path='calculate')
    def calculate(self, request):
        """Tính lương cho một nhân viên."""
        serializer = CalculateSalarySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            employee = Employee.objects.get(pk=data['employee_id'])
        except Employee.DoesNotExist:
            return Response(
                {'detail': 'Không tìm thấy nhân viên.'}, status=status.HTTP_404_NOT_FOUND
            )

        work_credit = None
        if wc_id := data.get('work_credit_id'):
            try:
                work_credit = MonthlyWorkCredit.objects.get(
                    pk=wc_id, employee=employee,
                    year=data['year'], month=data['month'],
                )
            except MonthlyWorkCredit.DoesNotExist:
                return Response(
                    {'detail': 'Không tìm thấy bảng công tương ứng.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

        try:
            record = SalaryRuleEngine.calculate(
                employee=employee,
                year=data['year'],
                month=data['month'],
                work_credit=work_credit,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            MonthlySalaryRecordSerializer(record).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['patch'], url_path='standard-work-days')
    def update_standard_work_days(self, request):
        """Cập nhật công chuẩn tính lương cho một phiếu lương cụ thể."""
        serializer = UpdateSalaryStandardWorkDaysSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            employee = Employee.objects.get(pk=data['employee_id'])
        except Employee.DoesNotExist:
            return Response({'detail': 'Không tìm thấy nhân viên.'}, status=status.HTTP_404_NOT_FOUND)

        record = MonthlySalaryRecord.objects.filter(
            employee=employee,
            year=data['year'],
            month=data['month'],
        ).select_related('work_credit').first()

        if not record:
            return Response({'detail': 'Không tìm thấy phiếu lương tương ứng.'}, status=status.HTTP_404_NOT_FOUND)

        if record.status in ('APPROVED', 'PAID'):
            return Response(
                {'detail': 'Không thể sửa công chuẩn cho phiếu lương đã duyệt hoặc đã thanh toán.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mode = data['standard_work_days_mode']
        employee.standard_work_days_mode = mode
        employee.save(update_fields=['standard_work_days_mode', 'updated_at'])

        try:
            updated = SalaryRuleEngine.calculate(
                employee=record.employee,
                year=record.year,
                month=record.month,
                work_credit=record.work_credit,
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from hrm.finalization_views import get_salary_rows

            salary_data = get_salary_rows(record.year, record.month, employee_code=record.employee.employee_id)
            # employee_code lọc kiểu "chứa" (mã hoặc tên) → lấy đúng dòng của NV này
            refreshed_row = next(row for row in salary_data['results'] if row['employee_id'] == record.employee_id)
        except Exception:
            refreshed_row = MonthlySalaryRecordSerializer(updated).data

        return Response(refreshed_row, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='bulk-calculate')
    def bulk_calculate(self, request):
        """Tính lương hàng loạt cho một tháng (toàn bộ hoặc theo phòng ban)."""
        serializer = BulkCalculateSalarySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        year, month = data['year'], data['month']

        employees = Employee.objects.filter(employment_status='ACTIVE').filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gte=date(year, month, 1))
        )
        if dept_id := data.get('department_id'):
            employees = employees.filter(department_id=dept_id)
        if ids := data.get('employee_ids'):
            employees = employees.filter(id__in=ids)

        results = {'success': [], 'errors': []}

        # Prefetch tất cả work_credit của tháng trong một query
        work_credit_map = {
            wc.employee_id: wc
            for wc in MonthlyWorkCredit.objects.filter(
                employee__in=employees, year=year, month=month
            )
        }

        for emp in employees:
            work_credit = work_credit_map.get(emp.id)
            try:
                record = SalaryRuleEngine.calculate(
                    employee=emp, year=year, month=month, work_credit=work_credit
                )
                results['success'].append({
                    'employee_id': emp.id,
                    'employee_name': emp.full_name,
                    'salary_code': record.salary_code,
                    'net_salary': float(record.net_salary),
                })
            except ValueError as exc:
                results['errors'].append({
                    'employee_id': emp.id,
                    'employee_name': emp.full_name,
                    'error': str(exc),
                })

        return Response(results, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='total-summary')
    def total_summary(self, request):
        """
        Tính tổng lương công ty cho một tháng.
        Lấy dữ liệu từ get_salary_rows() (hrm/finalization_views.py) — cùng số với bảng lương.
        """
        from decimal import Decimal
        
        year = request.query_params.get('year')
        month = request.query_params.get('month')
        dept_id = request.query_params.get('department')
        legal_entity = (request.query_params.get('legal_entity') or '').strip()

        if not year or not month:
            return Response(
                {'detail': 'Cần cung cấp year và month.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
        except ValueError:
            return Response(
                {'detail': 'year và month phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Import functions từ finalization_views
        try:
            from hrm.finalization_views import get_salary_rows
            salary_data = get_salary_rows(year, month, department_id=dept_id, legal_entity=legal_entity)
        except Exception as e:
            return Response(
                {'detail': f'Lỗi khi lấy dữ liệu bảng lương: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        results = salary_data.get('results', [])

        if not results:
            return Response({
                'year': year,
                'month': month,
                'department_id': dept_id,
                'legal_entity': legal_entity or None,
                'std_days': 0,
                'total_luong_thuc_linh': 0,
                'total_con_phai_thanh_toan': 0,
                'total_thue_tncn': 0,
                'total_net_salary': 0,
                'employee_count': 0,
                'breakdown': [],
            })

        # Đồng bộ chuẩn với frontend: dùng trực tiếp các trường đã được get_salary_rows() tính sẵn
        # (luong_thuc_linh, thue_tncn, con_phai_thanh_toan) thay vì tự tính lại bằng công thức rút gọn.
        total_luong_thuc_linh = Decimal('0')
        total_con_phai_thanh_toan = Decimal('0')
        total_thue_tncn = Decimal('0')

        def _to_decimal(value):
            try:
                return Decimal(str(value or 0))
            except Exception:
                return Decimal('0')

        breakdown = []
        for record in results:
            luong_thuc_linh = _to_decimal(record.get('luong_thuc_linh'))
            thue_tncn = _to_decimal(record.get('thue_tncn'))
            con_phai_thanh_toan = _to_decimal(record.get('con_phai_thanh_toan'))

            total_luong_thuc_linh += luong_thuc_linh
            total_thue_tncn += thue_tncn
            total_con_phai_thanh_toan += con_phai_thanh_toan

            breakdown.append({
                'ma_nv': record.get('ma_nv'),
                'ho_va_ten': record.get('ho_va_ten'),
                'phong_ban': record.get('phong_ban'),
                'luong_thuc_linh': float(luong_thuc_linh),
                'thue_tncn': float(thue_tncn),
                'con_phai_thanh_toan': float(con_phai_thanh_toan),
            })

        result = {
            'year': year,
            'month': month,
            'department_id': dept_id,
            'legal_entity': legal_entity or None,
            'std_days': salary_data.get('std_days', 0),
            'total_luong_thuc_linh': float(total_luong_thuc_linh),
            'total_thue_tncn': float(total_thue_tncn),
            'total_con_phai_thanh_toan': float(total_con_phai_thanh_toan),
            'total_net_salary': float(total_con_phai_thanh_toan),
            'employee_count': len(results),
            'breakdown': breakdown,
        }

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='salary-data-monthly-summary')
    def salary_data_monthly_summary(self, request):
        """
        Tổng hợp dữ liệu lương bổ sung theo tháng:
        - Hoa hồng
        - Phạt biên bản
        - Tạm ứng lương
        - Phụ cấp khác

        Query params:
        - year (required)
        - month (required)
        - department (optional)
        - legal_entity (optional)
        """
        year = request.query_params.get('year')
        month = request.query_params.get('month')
        department = request.query_params.get('department')
        legal_entity = (request.query_params.get('legal_entity') or '').strip()

        if not year or not month:
            return Response(
                {'detail': 'Cần cung cấp year và month.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'year và month phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        emp_filter = models.Q()
        if department:
            emp_filter &= models.Q(employee__department_id=department)
        if legal_entity:
            emp_filter &= models.Q(employee__subsidiary_legal_entity__iexact=legal_entity)

        commission_agg = SalesCommission.objects.filter(year=year, month=month).filter(emp_filter).aggregate(
            total=models.Sum('amount'),
            count=models.Count('id'),
        )
        penalty_agg = DisciplinaryPenalty.objects.filter(year=year, month=month).filter(emp_filter).aggregate(
            total=models.Sum('amount'),
            count=models.Count('id'),
        )
        advance_agg = SalaryAdvance.objects.filter(year=year, month=month).filter(emp_filter).aggregate(
            total=models.Sum('amount'),
            count=models.Count('id'),
        )
        other_allowance_agg = OtherAllowance.objects.filter(year=year, month=month).filter(emp_filter).aggregate(
            total=models.Sum('amount'),
            count=models.Count('id'),
        )

        commission_total = float(commission_agg['total'] or 0)
        penalty_total = float(penalty_agg['total'] or 0)
        advance_total = float(advance_agg['total'] or 0)
        other_allowance_total = float(other_allowance_agg['total'] or 0)
        net_adjustment = commission_total + other_allowance_total - penalty_total - advance_total

        return Response(
            {
                'year': year,
                'month': month,
                'department_id': int(department) if str(department).isdigit() else None,
                'legal_entity': legal_entity or None,
                'commission_total': commission_total,
                'penalty_total': penalty_total,
                'advance_total': advance_total,
                'other_allowance_total': other_allowance_total,
                'net_adjustment': net_adjustment,
                'commission_count': commission_agg['count'] or 0,
                'penalty_count': penalty_agg['count'] or 0,
                'advance_count': advance_agg['count'] or 0,
                'other_allowance_count': other_allowance_agg['count'] or 0,
            },
            status=status.HTTP_200_OK,
        )

    # ------------------------------------------------------------------
    # Gửi phiếu lương qua email
    # ------------------------------------------------------------------

    @action(detail=False, methods=['post'], url_path='send-payslip-email')
    def send_payslip_email(self, request):
        """Xếp hàng gửi phiếu lương cho nhân viên qua email.
        Nhận: { email, subject, body, employee_id, year, month, recipient_name? }
        """
        import uuid as _uuid
        from hrm.models import EmailQueue, EmailBatch

        recipient_email = (request.data.get('email') or '').strip()
        subject = (request.data.get('subject') or '').strip()
        body = (request.data.get('body') or '').strip()
        employee_id = request.data.get('employee_id')
        year = request.data.get('year')
        month = request.data.get('month')
        recipient_name = (request.data.get('recipient_name') or '').strip()

        if not recipient_email:
            return Response(
                {'detail': 'Địa chỉ email không được để trống.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not subject or not body:
            return Response(
                {'detail': 'Tiêu đề và nội dung email không được để trống.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not employee_id or not year or not month:
            return Response(
                {'detail': 'Cần cung cấp employee_id, year và month để xếp hàng gửi phiếu lương.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            employee_id = int(employee_id)
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'employee_id, year và month phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            employee = Employee.objects.select_related('user').get(id=employee_id)
        except Employee.DoesNotExist:
            return Response({'detail': 'Không tìm thấy nhân viên.'}, status=status.HTTP_404_NOT_FOUND)

        batch_id = f"PAYSLIP_{year}{str(month).zfill(2)}_{employee_id}_{_uuid.uuid4().hex[:8]}"
        html_body = _build_payslip_email_html(subject, body)

        EmailBatch.objects.create(
            batch_id=batch_id,
            total_emails=1,
            pending_count=1,
            created_by=request.user,
            status='PENDING',
        )

        EmailQueue.objects.create(
            employee=employee,
            email_type='PAYSLIP',
            status='PENDING',
            recipient_email=recipient_email,
            recipient_name=recipient_name or getattr(employee, 'full_name', '') or recipient_email,
            email_subject=subject,
            email_plain_body=body,
            email_html_body=html_body,
            batch_id=batch_id,
            created_by=request.user,
        )

        return Response(
            {
                'detail': f'Đã xếp hàng gửi phiếu lương đến {recipient_email}.',
                'batch_id': batch_id,
                'status': 'PENDING',
                'recipient_email': recipient_email,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['get'], url_path='department-payslip-recipients')
    def department_payslip_recipients(self, request):
        """Preview danh sách người nhận email phiếu lương theo phòng ban/tháng."""
        from hrm.finalization_views import get_salary_rows

        year = request.query_params.get('year')
        month = request.query_params.get('month')
        department_id = request.query_params.get('department_id')

        if not year or not month or not department_id:
            return Response(
                {'detail': 'Cần cung cấp year, month và department_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
            department_id = int(department_id)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'year, month và department_id phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        department = Department.objects.filter(id=department_id).first()
        if not department:
            return Response({'detail': 'Không tìm thấy phòng ban.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            salary_data = get_salary_rows(year, month, department_id=department_id)
        except Exception as exc:
            return Response(
                {'detail': f'Lỗi khi lấy dữ liệu bảng lương: {str(exc)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        salary_rows = salary_data.get('results', []) if isinstance(salary_data, dict) else []
        salary_rows = _merge_monthly_inputs_into_salary_rows(salary_rows, year, month)
        if not salary_rows:
            return Response(
                {'detail': 'Không có dữ liệu bảng lương.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee_ids = [row.get('employee_id') for row in salary_rows if row.get('employee_id')]
        employee_map = {
            emp.id: emp
            for emp in Employee.objects.filter(id__in=employee_ids).only('id', 'full_name', 'employee_id', 'personal_email')
        }

        month_label = f"Tháng {str(month).zfill(2)}.{year}"
        recipients = []
        no_email_count = 0
        for row in salary_rows:
            employee_id = row.get('employee_id')
            if not employee_id:
                continue
            emp = employee_map.get(employee_id)
            email = (getattr(emp, 'personal_email', None) or '').strip()
            has_email = bool(email)
            if not has_email:
                no_email_count += 1

            employee_name = row.get('ho_va_ten') or getattr(emp, 'full_name', '')
            preview_subject = f"[Phiếu lương] {month_label} - {employee_name}"
            preview_body = _build_default_payslip_body(row, year, month)

            recipients.append({
                'employee_id': employee_id,
                'employee_code': row.get('ma_nv') or getattr(emp, 'employee_id', ''),
                'employee_name': employee_name,
                'email': email,
                'has_email': has_email,
                'preview_subject': preview_subject,
                'preview_body': preview_body,
            })

        return Response({
            'year': year,
            'month': month,
            'department_id': department_id,
            'department_name': department.name,
            'total': len(recipients),
            'can_send': len(recipients) - no_email_count,
            'no_email_count': no_email_count,
            'recipients': recipients,
        })

    @action(detail=False, methods=['get'], url_path='department-payslip-email-statuses')
    def department_payslip_email_statuses(self, request):
        """Trả về trạng thái gửi email phiếu lương theo nhân viên từ bảng EmailQueue."""
        from hrm.finalization_views import get_salary_rows
        from hrm.models import EmailQueue

        year = request.query_params.get('year')
        month = request.query_params.get('month')
        department_id = request.query_params.get('department_id')
        legal_entity = (request.query_params.get('legal_entity') or '').strip()

        if not year or not month:
            return Response(
                {'detail': 'Cần cung cấp year và month.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'year và month phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        department_id_int = None
        if department_id not in (None, ''):
            try:
                department_id_int = int(department_id)
            except (TypeError, ValueError):
                return Response(
                    {'detail': 'department_id phải là số nguyên nếu có truyền.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            salary_data = get_salary_rows(year, month, department_id=department_id_int, legal_entity=legal_entity)
        except Exception as exc:
            return Response(
                {'detail': f'Lỗi khi lấy dữ liệu bảng lương: {str(exc)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        salary_rows = salary_data.get('results', []) if isinstance(salary_data, dict) else []
        employee_ids = [row.get('employee_id') for row in salary_rows if row.get('employee_id')]
        if not employee_ids:
            return Response({'statuses': []}, status=status.HTTP_200_OK)

        batch_prefix = f"PAYSLIP_{year}{str(month).zfill(2)}_"
        email_rows = (
            EmailQueue.objects
            .filter(
                email_type='PAYSLIP',
                employee_id__in=employee_ids,
                batch_id__startswith=batch_prefix,
            )
            .order_by('employee_id', '-created_at')
            .only('employee_id', 'status', 'processed_at', 'error_message', 'batch_id')
        )

        latest_by_employee = {}
        for email_row in email_rows:
            if email_row.employee_id in latest_by_employee:
                continue
            latest_by_employee[email_row.employee_id] = email_row

        statuses = []
        for employee_id in employee_ids:
            latest = latest_by_employee.get(employee_id)
            statuses.append({
                'employee_id': employee_id,
                'status': latest.status if latest else None,
                'processed_at': latest.processed_at if latest else None,
                'error_message': latest.error_message if latest else None,
                'batch_id': latest.batch_id if latest else None,
            })

        return Response({'statuses': statuses}, status=status.HTTP_200_OK)

    @action(detail=False, methods=['post'], url_path='send-department-payslip-emails')
    def send_department_payslip_emails(self, request):
        """Tạo hàng đợi gửi phiếu lương cho toàn bộ nhân sự trong 1 phòng ban.
        Email sẽ được gửi dần bởi process_email_queue worker.

        Nhận:
        {
          year: number,
          month: number,
          department_id: number,
          subject_template?: string,
          body_template?: string
        }

        Trả về:
        { batch_id, queued, skipped_no_email, total }
        """
        import uuid as _uuid
        from hrm.finalization_views import get_salary_rows
        from hrm.models import EmailBatch, EmailQueue

        year = request.data.get('year')
        month = request.data.get('month')
        department_id = request.data.get('department_id')
        subject_template = (request.data.get('subject_template') or '').strip()
        body_template = (request.data.get('body_template') or '').strip()

        if not year or not month or not department_id:
            return Response(
                {'detail': 'Cần cung cấp year, month và department_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
            department_id = int(department_id)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'year, month và department_id phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        department = Department.objects.filter(id=department_id).first()
        if not department:
            return Response({'detail': 'Không tìm thấy phòng ban.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            salary_data = get_salary_rows(year, month, department_id=department_id)
        except Exception as exc:
            return Response(
                {'detail': f'Lỗi khi lấy dữ liệu bảng lương: {str(exc)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        salary_rows = salary_data.get('results', []) if isinstance(salary_data, dict) else []
        salary_rows = _merge_monthly_inputs_into_salary_rows(salary_rows, year, month)
        if not salary_rows:
            return Response(
                {'detail': 'Không có dữ liệu bảng lương để gửi email.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee_ids = [row.get('employee_id') for row in salary_rows if row.get('employee_id')]
        employee_map = {
            emp.id: emp
            for emp in Employee.objects.filter(id__in=employee_ids).only('id', 'full_name', 'employee_id', 'personal_email')
        }

        month_label = f"Tháng {str(month).zfill(2)}.{year}"
        batch_id = f"PAYSLIP_{year}{str(month).zfill(2)}_{_uuid.uuid4().hex[:8]}"

        queue_objects = []
        skipped_no_email = 0
        total = 0

        for row in salary_rows:
            employee_id = row.get('employee_id')
            if not employee_id:
                continue
            total += 1
            emp = employee_map.get(employee_id)
            recipient_email = (getattr(emp, 'personal_email', None) or '').strip()
            if not recipient_email:
                skipped_no_email += 1
                continue

            net_payable = row.get('con_phai_thanh_toan')
            try:
                net_payable_text = f"{round(float(net_payable or 0)):,}".replace(',', '.') + ' đ'
            except Exception:
                net_payable_text = '0 đ'

            template_context = {
                'month_label': month_label,
                'employee_name': row.get('ho_va_ten') or getattr(emp, 'full_name', ''),
                'employee_code': row.get('ma_nv') or getattr(emp, 'employee_id', ''),
                'department': row.get('phong_ban') or department.name,
                'net_payable': net_payable_text,
            }

            subject = _format_template_value(subject_template, template_context) if subject_template else f"[Phiếu lương] {month_label} - {template_context['employee_name']}"
            body = _format_template_value(body_template, template_context) if body_template else _build_default_payslip_body(row, year, month)
            html_body = _build_payslip_email_html(subject, body)

            queue_objects.append(
                EmailQueue(
                    employee_id=employee_id,
                    email_type='PAYSLIP',
                    recipient_email=recipient_email,
                    recipient_name=template_context['employee_name'],
                    email_subject=subject,
                    email_plain_body=body,
                    email_html_body=html_body,
                    batch_id=batch_id,
                    created_by=request.user,
                    status='PENDING',
                )
            )

        if not queue_objects:
            return Response(
                {'detail': 'Không có nhân viên nào có email để gửi.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queued = len(queue_objects)
        EmailBatch.objects.create(
            batch_id=batch_id,
            total_emails=queued,
            pending_count=queued,
            created_by=request.user,
            status='PENDING',
        )
        EmailQueue.objects.bulk_create(queue_objects, batch_size=100)

        return Response(
            {
                'detail': f'Đã xếp hàng {queued}/{total} email phiếu lương cho phòng ban {department.name}. Email sẽ được gửi trong vài phút.',
                'batch_id': batch_id,
                'department_id': department_id,
                'department_name': department.name,
                'year': year,
                'month': month,
                'total': total,
                'queued': queued,
                'skipped_no_email': skipped_no_email,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['get'], url_path='company-payslip-recipients')
    def company_payslip_recipients(self, request):
        """Preview danh sách người nhận email phiếu lương toàn công ty."""
        from hrm.finalization_views import get_salary_rows

        year = request.query_params.get('year')
        month = request.query_params.get('month')
        legal_entity = (request.query_params.get('legal_entity') or '').strip()

        if not year or not month:
            return Response(
                {'detail': 'Cần cung cấp year và month.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'year và month phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            salary_data = get_salary_rows(year, month, legal_entity=legal_entity)
        except Exception as exc:
            return Response(
                {'detail': f'Lỗi khi lấy dữ liệu bảng lương: {str(exc)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        salary_rows = salary_data.get('results', []) if isinstance(salary_data, dict) else []
        salary_rows = _merge_monthly_inputs_into_salary_rows(salary_rows, year, month)
        if not salary_rows:
            return Response(
                {'detail': 'Không có dữ liệu bảng lương.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee_ids = [row.get('employee_id') for row in salary_rows if row.get('employee_id')]
        employee_map = {
            emp.id: emp
            for emp in Employee.objects.filter(id__in=employee_ids).only('id', 'full_name', 'employee_id', 'personal_email')
        }

        month_label = f"Tháng {str(month).zfill(2)}.{year}"
        recipients = []
        no_email_count = 0
        for row in salary_rows:
            employee_id = row.get('employee_id')
            if not employee_id:
                continue
            emp = employee_map.get(employee_id)
            email = (getattr(emp, 'personal_email', None) or '').strip()
            has_email = bool(email)
            if not has_email:
                no_email_count += 1

            employee_name = row.get('ho_va_ten') or getattr(emp, 'full_name', '')
            preview_subject = f"[Phiếu lương] {month_label} - {employee_name}"
            preview_body = _build_default_payslip_body(row, year, month)

            recipients.append({
                'employee_id': employee_id,
                'employee_code': row.get('ma_nv') or getattr(emp, 'employee_id', ''),
                'employee_name': employee_name,
                'email': email,
                'has_email': has_email,
                'preview_subject': preview_subject,
                'preview_body': preview_body,
            })

        return Response({
            'year': year,
            'month': month,
            'total': len(recipients),
            'can_send': len(recipients) - no_email_count,
            'no_email_count': no_email_count,
            'recipients': recipients,
        })

    @action(detail=False, methods=['post'], url_path='send-company-payslip-emails')
    def send_company_payslip_emails(self, request):
        """Tạo hàng đợi gửi phiếu lương cho toàn bộ nhân sự công ty.

        Nhận:
        {
          year: number,
          month: number,
          legal_entity?: string,
          subject_template?: string,
          body_template?: string
        }

        Trả về:
        { batch_id, queued, skipped_no_email, total }
        """
        import uuid as _uuid
        from hrm.finalization_views import get_salary_rows
        from hrm.models import EmailBatch, EmailQueue

        year = request.data.get('year')
        month = request.data.get('month')
        legal_entity = (request.data.get('legal_entity') or '').strip()
        subject_template = (request.data.get('subject_template') or '').strip()
        body_template = (request.data.get('body_template') or '').strip()

        if not year or not month:
            return Response(
                {'detail': 'Cần cung cấp year và month.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'year và month phải là số nguyên.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            salary_data = get_salary_rows(year, month, legal_entity=legal_entity)
        except Exception as exc:
            return Response(
                {'detail': f'Lỗi khi lấy dữ liệu bảng lương: {str(exc)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        salary_rows = salary_data.get('results', []) if isinstance(salary_data, dict) else []
        salary_rows = _merge_monthly_inputs_into_salary_rows(salary_rows, year, month)
        if not salary_rows:
            return Response(
                {'detail': 'Không có dữ liệu bảng lương để gửi email.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee_ids = [row.get('employee_id') for row in salary_rows if row.get('employee_id')]
        employee_map = {
            emp.id: emp
            for emp in Employee.objects.filter(id__in=employee_ids).only('id', 'full_name', 'employee_id', 'personal_email')
        }

        month_label = f"Tháng {str(month).zfill(2)}.{year}"
        batch_id = f"PAYSLIP_{year}{str(month).zfill(2)}_COMPANY_{_uuid.uuid4().hex[:8]}"

        queue_objects = []
        skipped_no_email = 0
        total = 0

        for row in salary_rows:
            employee_id = row.get('employee_id')
            if not employee_id:
                continue
            total += 1
            emp = employee_map.get(employee_id)
            recipient_email = (getattr(emp, 'personal_email', None) or '').strip()
            if not recipient_email:
                skipped_no_email += 1
                continue

            net_payable = row.get('con_phai_thanh_toan')
            try:
                net_payable_text = f"{round(float(net_payable or 0)):,}".replace(',', '.') + ' đ'
            except Exception:
                net_payable_text = '0 đ'

            employee_name = row.get('ho_va_ten') or getattr(emp, 'full_name', '')
            template_context = {
                'month_label': month_label,
                'employee_name': employee_name,
                'employee_code': row.get('ma_nv') or getattr(emp, 'employee_id', ''),
                'department': row.get('phong_ban') or '',
                'net_payable': net_payable_text,
            }

            subject = _format_template_value(subject_template, template_context) if subject_template else f"[Phiếu lương] {month_label} - {employee_name}"
            body = _format_template_value(body_template, template_context) if body_template else _build_default_payslip_body(row, year, month)
            html_body = _build_payslip_email_html(subject, body)

            queue_objects.append(
                EmailQueue(
                    employee_id=employee_id,
                    email_type='PAYSLIP',
                    recipient_email=recipient_email,
                    recipient_name=employee_name,
                    email_subject=subject,
                    email_plain_body=body,
                    email_html_body=html_body,
                    batch_id=batch_id,
                    created_by=request.user,
                    status='PENDING',
                )
            )

        if not queue_objects:
            return Response(
                {'detail': 'Không có nhân viên nào có email để gửi.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        queued = len(queue_objects)
        EmailBatch.objects.create(
            batch_id=batch_id,
            total_emails=queued,
            pending_count=queued,
            created_by=request.user,
            status='PENDING',
        )
        EmailQueue.objects.bulk_create(queue_objects, batch_size=100)

        return Response(
            {
                'detail': f'Đã xếp hàng {queued}/{total} email phiếu lương cho toàn công ty. Email sẽ được gửi trong vài phút.',
                'batch_id': batch_id,
                'year': year,
                'month': month,
                'total': total,
                'queued': queued,
                'skipped_no_email': skipped_no_email,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=['get'], url_path=r'payslip-email-batch/(?P<batch_id>[^/.]+)')
    def payslip_email_batch_status(self, request, batch_id=None):
        """Trả về trạng thái batch gửi phiếu lương kèm danh sách từng email."""
        from hrm.models import EmailBatch, EmailQueue

        try:
            batch = EmailBatch.objects.get(batch_id=batch_id)
        except EmailBatch.DoesNotExist:
            return Response({'detail': 'Không tìm thấy batch.'}, status=status.HTTP_404_NOT_FOUND)

        emails_qs = EmailQueue.objects.filter(batch_id=batch_id).select_related('employee').order_by('created_at')
        emails = [
            {
                'employee_id': eq.employee_id,
                'employee_code': getattr(eq.employee, 'employee_id', '') if eq.employee else '',
                'employee_name': eq.recipient_name,
                'email': eq.recipient_email,
                'status': eq.status,
                'processed_at': eq.processed_at,
                'error_message': eq.error_message,
                'retry_count': eq.retry_count,
            }
            for eq in emails_qs
        ]

        return Response({
            'batch_id': batch.batch_id,
            'status': batch.status,
            'total': batch.total_emails,
            'sent': batch.sent_count,
            'failed': batch.failed_count,
            'pending': batch.pending_count,
            'progress_pct': round(batch.sent_count / batch.total_emails * 100, 1) if batch.total_emails > 0 else 0,
            'created_at': batch.created_at,
            'completed_at': batch.completed_at,
            'emails': emails,
        })

    # ------------------------------------------------------------------
    # Duyệt / thanh toán / hủy
    # ------------------------------------------------------------------

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        """Duyệt bảng lương."""
        record = self.get_object()
        serializer = ApproveSalarySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            approver = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response(
                {'detail': 'Không tìm thấy hồ sơ nhân viên của người dùng hiện tại.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            record.approve(
                approved_by_employee=approver,
                note=serializer.validated_data.get('note', ''),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(MonthlySalaryRecordSerializer(record).data)

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        """Đánh dấu đã thanh toán."""
        record = self.get_object()
        serializer = MarkPaidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            record.mark_paid(payment_ref=serializer.validated_data.get('payment_ref', ''))
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(MonthlySalaryRecordSerializer(record).data)

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        """Hủy bảng lương."""
        record = self.get_object()
        try:
            record.cancel()
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(MonthlySalaryRecordSerializer(record).data)

    @action(detail=True, methods=['post'], url_path='submit')
    def submit(self, request, pk=None):
        """Chuyển bảng lương từ DRAFT → PENDING để chờ duyệt."""
        record = self.get_object()
        if record.status != 'DRAFT':
            return Response(
                {'detail': 'Chỉ có thể nộp bảng lương ở trạng thái Nháp.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        record.status = 'PENDING'
        record.save(update_fields=['status', 'updated_at'])
        return Response(MonthlySalaryRecordSerializer(record).data)

    @action(detail=False, methods=['post'], url_path='bonus-prediction')
    def bonus_prediction(self, request):
        """
        Dự đoán chi phí thưởng cho toàn công ty hoặc phòng ban.
        
        Request body:
        {
            "scheme": "fixed_3m_basic" | "prorated" | "custom",
            "fixed_amount": number (for custom scheme),
            "bonus_months": number (default: 1),
            "fiscal_year": number (optional, default: năm hiện tại),
            "department_id": number (optional),
            "legal_entity": string (optional)
        }
        
        Response:
        {
            "scheme": string,
            "fixed_amount": number,
            "bonus_months": number,
            "total_employee_count": number,
            "total_bonus": number,
            "employees": [...],
            "departments": [...]
        }
        """
        from decimal import Decimal
        from .bonus_calculator import BonusCalculator, BonusScheme
        
        scheme = request.data.get('scheme', BonusScheme.SCHEME_FIXED_3M_BASIC)
        fixed_amount = request.data.get('fixed_amount')
        bonus_months = request.data.get('bonus_months', 1)
        fiscal_year = request.data.get('fiscal_year')
        department_id = request.data.get('department_id')
        legal_entity = (request.data.get('legal_entity') or '').strip()
        under_one_year_amount = request.data.get('under_one_year_amount')
        
        # Validate
        if scheme not in [BonusScheme.SCHEME_FIXED_3M_BASIC, BonusScheme.SCHEME_PRORATED, BonusScheme.SCHEME_CUSTOM]:
            return Response(
                {'detail': f'Phương án thưởng không hợp lệ: {scheme}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        try:
            bonus_months = int(bonus_months)
            if bonus_months < 1:
                raise ValueError('Số tháng thưởng phải >= 1')
        except (TypeError, ValueError) as e:
            return Response(
                {'detail': f'Số tháng thưởng không hợp lệ: {str(e)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if fiscal_year is not None:
            try:
                fiscal_year = int(fiscal_year)
            except (TypeError, ValueError):
                return Response(
                    {'detail': 'fiscal_year phải là số nguyên.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        
        if scheme == BonusScheme.SCHEME_CUSTOM:
            if not fixed_amount or fixed_amount <= 0:
                return Response(
                    {'detail': 'Phương án custom cần cung cấp fixed_amount > 0'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            fixed_amount = Decimal(str(fixed_amount))
        else:
            fixed_amount = None
        
        if under_one_year_amount in (None, ''):
            from .bonus_calculator import DEFAULT_UNDER_ONE_YEAR_AMOUNT
            under_one_year_amount = DEFAULT_UNDER_ONE_YEAR_AMOUNT
        else:
            try:
                under_one_year_amount = Decimal(str(under_one_year_amount))
                if under_one_year_amount < 0:
                    raise ValueError
            except (ValueError, ArithmeticError):
                return Response({'detail': 'under_one_year_amount không hợp lệ.'},
                                status=status.HTTP_400_BAD_REQUEST)

        calculator = BonusCalculator()
        
        try:
            result = calculator.predict_company_bonus(
                scheme=scheme,
                fixed_amount=fixed_amount,
                bonus_months=bonus_months,
                department_id=department_id,
                legal_entity=legal_entity or None,
                fiscal_year=fiscal_year,
                under_one_year_amount=under_one_year_amount,
            )
            return Response(result, status=status.HTTP_200_OK)
        except Exception as exc:
            logger.exception('bonus prediction failed')
            return Response(
                {'detail': 'Lỗi tính dự đoán thưởng.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# ---------------------------------------------------------------------------
# OvertimeRateConfig
# ---------------------------------------------------------------------------

class OvertimeRateConfigViewSet(viewsets.ModelViewSet):
    serializer_class   = OvertimeRateConfigSerializer
    permission_classes = [IsAuthenticated, SalaryAdminPermission]

    def get_queryset(self):
        qs = OvertimeRateConfig.objects.prefetch_related(
            'departments', 'positions', 'employees'
        ).order_by('-effective_from')
        level = self.request.query_params.get('level')
        if level == 'department':
            return qs.filter(departments__isnull=False).distinct()
        if level == 'position':
            return qs.filter(positions__isnull=False).distinct()
        if level == 'employee':
            return qs.filter(employees__isnull=False).distinct()
        if level == 'all':
            return qs.filter(apply_to_all=True)
        return qs

    def perform_create(self, serializer):
        employee = None
        if self.request.user.is_authenticated:
            try:
                employee = Employee.objects.get(user=self.request.user)
            except Employee.DoesNotExist:
                pass
        serializer.save(created_by=employee)

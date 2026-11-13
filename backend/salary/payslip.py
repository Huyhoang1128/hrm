"""
Phiếu lương — NGUỒN DUY NHẤT của "Lương thực lĩnh" và "Còn phải thanh toán".

Trước đây có 3 công thức khác nhau: dòng lương backend (bỏ sót lương OT, trực ca, dữ liệu lương
tháng nhập tay; trừ tạm ứng ngay trong thực lĩnh), web tự tính lại phiếu lương (tự tính lại gửi xe /
ăn trưa / trách nhiệm theo cấu hình, lấy BH từ bản "xem trước" đã lưu), và email phiếu lương (chép
công thức web, ghi cứng tỷ lệ BH). Nay mọi nơi — bảng lương, phiếu lương, Excel, tổng lương, chốt
lương, báo cáo biến động, email — đọc đúng các số do apply_payslip_totals() ghi vào dòng.

Công thức (đúng phiếu lương nhân viên nhận):
  III  Các khoản lương = lương ngày công + doanh số + OT + bán sản phẩm + phụ mổ + trực ca + thu nhập khác
  IV   Phụ cấp         = gửi xe + ăn trưa + trách nhiệm + livestream + phụ cấp khác
  V    Thưởng
  VI   Tổng thu nhập   = III + IV + V
  VII  Giảm trừ        = BHXH + BHYT + BHTN + công đoàn + phạt chấm công + phạt biên bản + phạt thiếu công
  VIII Điều chỉnh
  IX   Lương thực lĩnh = VI − VII + VIII
  X    Tạm ứng, XI Thuế TNCN
  XII  Còn phải thanh toán = IX − X − XI

Mỗi khoản: số nhập tay trong "Dữ liệu lương tháng" (*_input) nếu có, không thì số máy tính. Mọi
khoản làm tròn tới đồng trước khi cộng để các dòng phiếu lương cộng đúng bằng tổng.

Chỉ đọc các trường của dòng nên tính lại được bất cứ lúc nào (kể cả dòng đã chốt lương): cùng dòng
→ cùng số.
"""
from decimal import Decimal, ROUND_HALF_UP

from .payroll_rules import (
    EMPLOYEE_BHTN_RATE,
    EMPLOYEE_BHXH_RATE,
    EMPLOYEE_BHYT_RATE,
    EMPLOYEE_INSURANCE_RATE,
)

# Khoá chứa toàn bộ các dòng phiếu lương trong dòng bảng lương.
PAYSLIP_KEY = 'phieu_luong'

# Dữ liệu lương tháng nhập tay (salary.EmployeeMonthlySalaryInput) ghép vào dòng: field model -> khoá dòng.
MONTHLY_INPUT_FIELDS = {
    'luong_doanh_so': 'luong_doanh_so_input',
    'luong_ot': 'luong_ot_input',
    'ban_san_pham': 'ban_san_pham_input',
    'phu_mo': 'phu_mo_input',
    'truc_ca': 'truc_ca_input',
    'thuong': 'thuong_input',
}


def _dec(value) -> Decimal:
    try:
        if value is None or value == '':
            return Decimal('0')
        return Decimal(str(value))
    except Exception:
        return Decimal('0')


def _money(value) -> Decimal:
    """Làm tròn tới đồng (nửa đồng làm tròn lên, như Math.round trên web trước đây)."""
    return _dec(value).quantize(Decimal('1'), rounding=ROUND_HALF_UP)


def _input_or(row: dict, input_key: str, fallback_key=None) -> Decimal:
    """Số nhập tay của tháng (kể cả 0) nếu có, ngược lại số máy tính trong dòng."""
    value = row.get(input_key)
    if value is not None and value != '':
        return _dec(value)
    return _dec(row.get(fallback_key)) if fallback_key else Decimal('0')


def responsibility_allowance(adjustments, work_days, standard_work_days) -> Decimal:
    """Phụ cấp trách nhiệm theo payroll_config.responsibilityAllowancePolicy của nhân viên."""
    adjustments = adjustments if isinstance(adjustments, dict) else {}
    payroll_config = adjustments.get('payroll_config') if isinstance(adjustments.get('payroll_config'), dict) else {}
    policy = payroll_config.get('responsibilityAllowancePolicy')
    policy = policy if isinstance(policy, dict) else {}
    mode = str(policy.get('mode') or 'none')
    # Nhận cả snake_case lẫn camelCase (dữ liệu cũ)
    monthly_max = _dec(policy.get('monthly_max') or policy.get('monthlyMax'))
    if mode == 'fixed':
        return max(monthly_max, Decimal('0'))
    if mode == 'actual_working_day':
        standard_work_days = _dec(standard_work_days)
        if standard_work_days > 0:
            rate = monthly_max / standard_work_days
            return min(max(_dec(work_days), Decimal('0')) * rate, monthly_max)
    return Decimal('0')


def _responsibility_for_row(row: dict) -> Decimal:
    if row.get('phu_cap_trach_nhiem') is not None:
        return _dec(row.get('phu_cap_trach_nhiem'))
    # Dòng đã chốt từ trước khi dòng lương có phu_cap_trach_nhiem: tính lại từ cấu hình lương lúc
    # chốt (đi kèm dòng) — đúng như phiếu lương trên web đã hiển thị.
    snapshot = row.get('employee_snapshot') or {}
    return responsibility_allowance(snapshot.get('salary_adjustments'), row.get('tong_cong'), row.get('cong_chuan'))


def insurance_breakdown(row: dict) -> tuple:
    """(BHXH, BHYT, BHTN) phần người lao động, đã làm tròn tới đồng.

    Theo mức lương đóng BH của dòng × tỷ lệ; dòng không có mức đóng (dữ liệu cũ) thì chia
    bh_deduction theo đúng tỷ lệ. Thử việc / HĐ không chính thức: dòng có mức đóng 0 và bh_deduction 0.
    """
    base = _dec(row.get('muc_luong_dong_bh'))
    if base > 0:
        return (_money(base * EMPLOYEE_BHXH_RATE), _money(base * EMPLOYEE_BHYT_RATE),
                _money(base * EMPLOYEE_BHTN_RATE))
    total = _dec(row.get('bh_deduction'))
    if total <= 0:
        return Decimal('0'), Decimal('0'), Decimal('0')
    return tuple(_money(total * rate / EMPLOYEE_INSURANCE_RATE)
                 for rate in (EMPLOYEE_BHXH_RATE, EMPLOYEE_BHYT_RATE, EMPLOYEE_BHTN_RATE))


def apply_payslip_totals(row: dict) -> dict:
    """Ghi các dòng phiếu lương (row['phieu_luong']) + luong_thuc_linh + con_phai_thanh_toan vào row.

    Gọi SAU khi đã ghép dữ liệu lương tháng nhập tay (merge_monthly_inputs). Trả lại chính row."""
    luong_ngay_cong = _money(row.get('luong_ngay_cong'))
    luong_doanh_so = _money(_input_or(row, 'luong_doanh_so_input', 'luong_doanh_so'))
    luong_ot = _money(_input_or(row, 'luong_ot_input', 'luong_tang_ca'))
    ban_san_pham = _money(_input_or(row, 'ban_san_pham_input'))
    phu_mo = _money(_input_or(row, 'phu_mo_input'))
    truc_ca = _money(_input_or(row, 'truc_ca_input', 'truc_toi'))
    thu_nhap_khac = _money(row.get('thu_nhap_khac'))
    tong_luong_iii = luong_ngay_cong + luong_doanh_so + luong_ot + ban_san_pham + phu_mo + truc_ca + thu_nhap_khac

    phu_cap_gui_xe = _money(row.get('phu_cap_gui_xe'))
    phu_cap_an_trua = _money(row.get('phu_cap_an_trua'))
    phu_cap_trach_nhiem = _money(_responsibility_for_row(row))
    phu_cap_livestream = _money(row.get('phu_cap_livestream'))
    # Phụ cấp khác = phần còn lại của tổng phụ cấp (phụ cấp cố định, phụ cấp theo cấu hình, phụ cấp
    # khác nhập tay của kỳ) — để tổng IV luôn bằng tổng phụ cấp máy tính.
    phu_cap_khac = max(
        _money(row.get('phu_cap_khac')),
        _money(row.get('phu_cap')) - phu_cap_gui_xe - phu_cap_an_trua - phu_cap_trach_nhiem - phu_cap_livestream,
        Decimal('0'),
    )
    tong_phu_cap_iv = phu_cap_gui_xe + phu_cap_an_trua + phu_cap_trach_nhiem + phu_cap_livestream + phu_cap_khac

    thuong = _money(_input_or(row, 'thuong_input', 'thuong'))
    tong_thu_nhap_vi = tong_luong_iii + tong_phu_cap_iv + thuong

    bhxh, bhyt, bhtn = insurance_breakdown(row)
    tong_bh = bhxh + bhyt + bhtn
    cong_doan = _money(row.get('cong_doan'))
    tong_phat = _money(row.get('tong_phat'))
    tong_phat_bienban = _money(row.get('tong_phat_bienban'))
    phat_thieu_cong = _money(row.get('phat_thieu_cong'))
    tong_giam_tru_vii = tong_bh + cong_doan + tong_phat + tong_phat_bienban + phat_thieu_cong

    dieu_chinh = _money(row.get('dieu_chinh'))
    luong_thuc_linh = tong_thu_nhap_vi - tong_giam_tru_vii + dieu_chinh
    tam_ung = _money(row.get('tam_ung'))
    thue_tncn = _money(row.get('thue_tncn'))
    con_phai_thanh_toan = luong_thuc_linh - tam_ung - thue_tncn

    lines = {
        'luong_ngay_cong': luong_ngay_cong,
        'luong_doanh_so': luong_doanh_so,
        'luong_ot': luong_ot,
        'ban_san_pham': ban_san_pham,
        'phu_mo': phu_mo,
        'truc_ca': truc_ca,
        'thu_nhap_khac': thu_nhap_khac,
        'tong_luong_iii': tong_luong_iii,
        'phu_cap_gui_xe': phu_cap_gui_xe,
        'phu_cap_an_trua': phu_cap_an_trua,
        'phu_cap_trach_nhiem': phu_cap_trach_nhiem,
        'phu_cap_livestream': phu_cap_livestream,
        'phu_cap_khac': phu_cap_khac,
        'tong_phu_cap_iv': tong_phu_cap_iv,
        'thuong': thuong,
        'tong_thu_nhap_vi': tong_thu_nhap_vi,
        'bhxh': bhxh,
        'bhyt': bhyt,
        'bhtn': bhtn,
        'tong_bh': tong_bh,
        'cong_doan': cong_doan,
        'tong_phat': tong_phat,
        'tong_phat_bienban': tong_phat_bienban,
        'phat_thieu_cong': phat_thieu_cong,
        'tong_giam_tru_vii': tong_giam_tru_vii,
        'dieu_chinh': dieu_chinh,
        'luong_thuc_linh': luong_thuc_linh,
        'tam_ung': tam_ung,
        'thue_tncn': thue_tncn,
        'con_phai_thanh_toan': con_phai_thanh_toan,
    }
    row[PAYSLIP_KEY] = {key: float(value) for key, value in lines.items()}
    row['luong_thuc_linh'] = float(luong_thuc_linh)
    row['con_phai_thanh_toan'] = float(con_phai_thanh_toan)
    return row


def merge_monthly_inputs(rows: list, year: int, month: int) -> list:
    """Ghép "Dữ liệu lương tháng" nhập tay (salary.EmployeeMonthlySalaryInput) vào các dòng lương.
    Dòng của tháng đã chốt đã ghép lúc chốt — không ghép số hiện tại."""
    from .payroll_finalization import FINALIZED_ROW_FLAG
    from .salary_data_models import EmployeeMonthlySalaryInput

    employee_ids = [row.get('employee_id') for row in rows
                    if row.get('employee_id') and not row.get(FINALIZED_ROW_FLAG)]
    if not employee_ids:
        return rows
    inputs = {
        item.employee_id: item
        for item in EmployeeMonthlySalaryInput.objects.filter(
            year=year, month=month, employee_id__in=employee_ids,
        ).only('employee_id', *MONTHLY_INPUT_FIELDS)
    }
    for row in rows:
        monthly_input = inputs.get(row.get('employee_id'))
        if not monthly_input or row.get(FINALIZED_ROW_FLAG):
            continue
        for field_name, row_key in MONTHLY_INPUT_FIELDS.items():
            value = getattr(monthly_input, field_name)
            row[row_key] = float(value) if value is not None else None
        if monthly_input.thuong is not None:
            row['thuong'] = float(monthly_input.thuong)
        else:
            row['thuong'] = float(row.get('thuong') or 0)
    return rows


def prepare_salary_rows(rows: list, year: int, month: int) -> list:
    """Dòng lương đầy đủ để hiển thị / lưu: ghép dữ liệu lương tháng + tính phiếu lương."""
    merge_monthly_inputs(rows, year, month)
    for row in rows:
        apply_payslip_totals(row)
    return rows

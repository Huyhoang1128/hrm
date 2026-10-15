"""
API views for Department Work-Finalization Approval (Phê duyệt chốt công phòng ban).

Flow:
  1. HR/Admin calls SendDepartmentApprovalView or SendAllDepartmentsApprovalView
     → creates / resets DepartmentWorkFinalizationApproval records (status=PENDING)
  2. The configured approval manager calls ApproveDepartmentFinalizationView.
  3. Anyone with access calls DepartmentFinalizationApprovalListView / DetailView to
     inspect the current state.
"""

from django.utils import timezone
from django.http import HttpResponse
from django.utils.html import escape
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models, transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from decimal import Decimal, InvalidOperation
import json

from django.db.models import Q

from employee.models import Department, Employee
from salary.models import MonthlySalaryRecord
from salary.salary_data_models import DisciplinaryPenalty, EmployeeSalaryHistory
from .models import (
    DepartmentWorkFinalizationApproval,
    WorkFinalization,
    WorkFinalizationApprovalLog,
    WorkFinalizationEmployeeDecision,
    WorkFinalizationAccountingExport,
    is_department_head,
)
from .employee_work_utils import get_holiday_credit_for_employee
from .approval_manager_utils import (
    get_approval_manager_filter,
    get_approval_manager_id,
    is_approval_manager,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_year_month(year_raw, month_raw):
    """Return (year, month, error_response) tuple.  error_response is None on success."""
    try:
        year = int(year_raw)
        month = int(month_raw)
    except (TypeError, ValueError):
        return None, None, Response(
            {"error": "year và month phải là số nguyên hợp lệ"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not (1 <= month <= 12):
        return None, None, Response(
            {"error": "month phải từ 1 đến 12"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not (2000 <= year <= 2100):
        return None, None, Response(
            {"error": "year phải từ 2000 đến 2100"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return year, month, None


def _to_decimal(value, default=Decimal("0")):
    """Convert value sang Decimal an toàn, fallback về default khi lỗi."""
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def _to_json_safe(value):
    """Chuẩn hóa object về kiểu JSON-serializable (date/datetime/Decimal...)."""
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def _get_salary_profile_for_month(employee: Employee, year: int, month: int) -> tuple[Decimal, Decimal]:
    import calendar as cal_module
    import datetime as _dt

    days_in_month = cal_module.monthrange(year, month)[1]
    calc_date = _dt.date(year, month, days_in_month)
    salary_history = EmployeeSalaryHistory.get_for_date(employee, calc_date)
    if salary_history:
        return (
            _to_decimal(salary_history.basic_salary),
            _to_decimal(salary_history.allowance),
        )
    return (
        _to_decimal(employee.basic_salary),
        _to_decimal(employee.allowance),
    )


def _is_hr_or_admin(request):
    """True nếu user là HR hoặc admin/superuser, hoặc có quyền can_approve_attendance."""
    user = request.user
    if user.is_staff or user.is_superuser:
        return True
    try:
        employee = user.employee
        if employee.is_hr:
            return True
        # Kiểm tra thêm quyền can_approve_attendance nếu có
        from .models import _has_approve_permission
        return _has_approve_permission(employee)
    except Exception:
        return False


def _is_super_admin(request):
    """Chỉ superadmin (is_superuser=True)."""
    try:
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)
    except Exception:
        return False


def _get_active_or_resigned_in_period_q(year=None, month=None):
    import datetime as _dt

    base_active_q = Q(is_active=True) & ~Q(employment_status__iexact="INACTIVE")
    if year is None or month is None:
        return base_active_q

    period_start = _dt.date(year, month, 1)

    started_on_or_before_period_q = (
        Q(start_date__isnull=True)
        | Q(start_date__year__lt=year)
        | Q(start_date__year=year, start_date__month__lte=month)
    )

    resigned_in_period_q = Q(
        employment_status__iexact="INACTIVE",
        end_date__year=year,
        end_date__month=month,
    )
    not_resigned_by_period_start_q = Q(end_date__isnull=True) | Q(end_date__gt=period_start)
    return (
        (base_active_q | resigned_in_period_q)
        & started_on_or_before_period_q
        & not_resigned_by_period_start_q
    )


def _get_manageable_department_ids(employee, year=None, month=None):
    """
    Trả về danh sách ID phòng ban mà nhân viên có quyền xem phê duyệt chốt công.

    Quy tắc:
      - Quản lý cấp 2 duyệt khi nhân sự có cấu hình quản lý cấp 2.
      - Nếu quản lý cấp 2 trống thì quản lý trực tiếp duyệt.
      - Nhân sự INACTIVE vẫn được tính nếu nghỉ trong đúng tháng/năm đang xét.
      - HR/Admin được xử lý riêng ở lớp view.
    """
    managed_department_ids = Employee.objects.filter(
        get_approval_manager_filter(employee),
        department_id__isnull=False,
    ).filter(
        _get_active_or_resigned_in_period_q(year, month)
    ).values_list("department_id", flat=True)

    return list(set(managed_department_ids))


def _get_employee_from_request(request):
    """
    Trả về Employee của user hiện tại, hoặc None nếu không tồn tại.
    Ném AttributeError nếu user không có employee liên kết.
    """
    return request.user.employee


def _serialize_approval(approval: DepartmentWorkFinalizationApproval) -> dict:
    sent_by = approval.sent_by
    # Khi bảng mới được duyệt một phần, chưa có approved_by ở cấp phòng.
    # Vẫn hiển thị người đang duyệt chính (duyệt nhiều nhân sự nhất).
    approved_by = approval.approved_by or _get_primary_employee_approver(approval)

    sent_by_role = "Admin"
    sent_by_name = "Quản trị viên"
    if sent_by:
        sent_by_name = sent_by.full_name
        if sent_by.is_hr:
            sent_by_role = "HR / Nhân sự"
        elif sent_by.user.is_superuser or sent_by.user.is_staff:
            sent_by_role = "Admin"
        elif sent_by.position:
            sent_by_role = sent_by.position.title
        else:
            sent_by_role = "Nhân viên"

    decision_progress = _get_employee_decision_progress(approval)

    return {
        "id": approval.pk,
        "department_id": approval.department_id,
        "department_code": approval.department_code,
        "department_name": approval.department.name if approval.department_id else None,
        "year": approval.year,
        "month": approval.month,
        "status": approval.status,
        "sent_by_id": sent_by.pk if sent_by else None,
        "sent_by_name": sent_by_name,
        "sent_by_role": sent_by_role,
        "sent_at": approval.sent_at,
        "approved_by_id": approved_by.pk if approved_by else None,
        "approved_by_name": approved_by.full_name if approved_by else None,
        "approved_at": approval.approved_at,
        "note": approval.note,
        "created_at": approval.sent_at,
        "total_employees": decision_progress["total_employees"],
        "approved_employees": decision_progress["approved_employees"],
        "rejected_employees": decision_progress["rejected_employees"],
        "decided_employees": decision_progress["decided_employees"],
    }


def _serialize_export_row(export_row: WorkFinalizationAccountingExport) -> dict:
    snapshot = export_row.data_snapshot or {}
    return {
        "id": export_row.pk,
        "approval_id": export_row.approval_id,
        "year": export_row.year,
        "month": export_row.month,
        "department_code": export_row.department_code,
        "department_name": export_row.department_name,
        "employee_id": export_row.employee_id,
        "employee_code": export_row.employee_code,
        "employee_name": export_row.employee_name,
        "decision": export_row.decision,
        "decision_label": export_row.decision_label or _get_decision_label(export_row.decision),
        "decision_note": export_row.decision_note,
        "decided_by_id": export_row.decided_by_id,
        "decided_by_name": export_row.decided_by.full_name if export_row.decided_by else None,
        "decided_at": export_row.decided_at,
        "exported_by_id": export_row.exported_by_id,
        "exported_by_name": export_row.exported_by.full_name if export_row.exported_by else None,
        "exported_at": export_row.exported_at,
        "snapshot": snapshot,
    }


def _get_active_employees_for_department(department, year, month):
    """
    Trả về danh sách nhân viên của phòng ban cho kỳ chốt công.
    Bao gồm nhân sự active và nhân sự INACTIVE nếu nghỉ trong đúng tháng/năm.
    """
    return (
        Employee.objects.select_related("department", "position")
        .filter(department=department)
        .filter(_get_active_or_resigned_in_period_q(year, month))
        .order_by("employee_id")
    )


def _get_employee_decision_progress(approval):
    """Đếm tiến độ duyệt theo toàn bộ nhân sự thuộc kỳ chốt công của phòng."""
    employee_ids = _get_active_employees_for_department(
        approval.department,
        approval.year,
        approval.month,
    ).values_list("pk", flat=True)
    counts = WorkFinalizationEmployeeDecision.objects.filter(
        approval=approval,
        employee_id__in=employee_ids,
    ).aggregate(
        approved_employees=models.Count("pk", filter=Q(decision="APPROVED")),
        rejected_employees=models.Count("pk", filter=Q(decision="REJECTED")),
        decided_employees=models.Count("pk"),
    )
    return {
        "total_employees": employee_ids.count(),
        "approved_employees": counts["approved_employees"] or 0,
        "rejected_employees": counts["rejected_employees"] or 0,
        "decided_employees": counts["decided_employees"] or 0,
    }


def _get_primary_employee_approver(approval):
    """
    Lấy người duyệt đại diện khi phòng mới được duyệt một phần.
    Ưu tiên số nhân sự đã duyệt nhiều nhất; nếu bằng nhau, lấy người duyệt gần nhất.
    """
    employee_ids = _get_active_employees_for_department(
        approval.department,
        approval.year,
        approval.month,
    ).values_list("pk", flat=True)
    primary = (
        WorkFinalizationEmployeeDecision.objects.filter(
            approval=approval,
            employee_id__in=employee_ids,
            decision="APPROVED",
            decided_by_id__isnull=False,
        )
        .values("decided_by_id")
        .annotate(
            approved_count=models.Count("pk"),
            latest_decision=models.Max("decided_at"),
        )
        .order_by("-approved_count", "-latest_decision")
        .first()
    )
    if not primary:
        return None
    return Employee.objects.filter(pk=primary["decided_by_id"]).first()


def _serialize_employee_summary(employee, year, month):
    """Tóm tắt dữ liệu nhân viên kèm trạng thái đã chốt công chưa."""
    salary_record = MonthlySalaryRecord.objects.filter(
        employee=employee, year=year, month=month
    ).first()

    salary_snapshot = getattr(salary_record, "input_snapshot", None) or {}

    try:
        wf = WorkFinalization.objects.get(
            employee=employee, year=year, month=month
        )
        finalized = True
        tong_cong = float(wf.tong_cong) if wf.tong_cong is not None else 0
        cong_ngay_le = float(wf.co_le) if wf.co_le is not None else 0
        if cong_ngay_le == 0:
            try:
                cong_ngay_le = float((wf.raw_state or {}).get("holiday_credit") or 0)
            except Exception:
                cong_ngay_le = 0
        if cong_ngay_le == 0:
            try:
                from .finalization_views import _holiday_unit_for, _split_holiday_credit
                cong_ngay_le = float(sum(_split_holiday_credit(
                    (wf.raw_state or {}).get("daily_summary"), None, _holiday_unit_for(employee),
                )))
            except Exception:
                cong_ngay_le = 0
        if (wf.raw_state or {}).get("holiday_credit") is None and cong_ngay_le > 0:
            tong_cong = round(tong_cong + cong_ngay_le, 2)
        cong_thuc_te = float(wf.cong_thuc_te) if wf.cong_thuc_te is not None else 0
        tong_phat = float(wf.tong_phat) if wf.tong_phat is not None else 0
        tang_ca = float(wf.tang_ca) if wf.tang_ca is not None else 0
        lam_them_gio = float(wf.lam_them_gio) if wf.lam_them_gio is not None else 0
        truc_toi = float(wf.truc_toi) if wf.truc_toi is not None else 0
        live = int(wf.live) if wf.live is not None else 0
        nghi_phep_thang = float(wf.nghi_phep_thang) if wf.nghi_phep_thang is not None else 0
        nghi_khong_phep_thang = float(wf.nghi_khong_phep_thang) if wf.nghi_khong_phep_thang is not None else 0
    except WorkFinalization.DoesNotExist:
        finalized = False
        tong_cong = 0
        cong_thuc_te = 0
        tong_phat = 0
        tang_ca = 0
        lam_them_gio = 0
        truc_toi = 0
        live = 0
        nghi_phep_thang = 0
        nghi_khong_phep_thang = 0

    history_basic_salary, history_allowance = _get_salary_profile_for_month(employee, year, month)
    basic_salary = _to_decimal(salary_snapshot.get("basic_salary"), history_basic_salary)
    allowance = _to_decimal(salary_snapshot.get("allowance"), history_allowance)
    gross_salary = _to_decimal(getattr(salary_record, "gross_salary", 0))
    net_salary = _to_decimal(getattr(salary_record, "net_salary", 0))
    total_deduction = _to_decimal(getattr(salary_record, "total_deduction", 0))

    # Fetch DisciplinaryPenalty (Giảm trừ khác) for the month
    giam_tru_khac = 0
    try:
        disciplinary_penalties = DisciplinaryPenalty.objects.filter(
            employee=employee, year=year, month=month
        ).aggregate(total=models.Sum('amount'))
        giam_tru_khac = float(disciplinary_penalties.get('total') or 0)
    except Exception:
        giam_tru_khac = 0

    if salary_record is None:
        gross_salary = basic_salary + allowance
        net_salary = gross_salary
        total_deduction = _to_decimal(0)

    return {
        "employee_id": employee.pk,
        "manager_id": employee.manager_id,
        "manager_level_2_id": employee.manager_level_2_id,
        "approval_manager_id": get_approval_manager_id(employee),
        "ma_nv": employee.employee_id,
        "ho_va_ten": employee.full_name,
        "vi_tri": employee.position.title if employee.position else None,
        "employment_status_notes": employee.employment_status_notes,
        "ghi_chu_cong_viec": employee.employment_status_notes,
        "ghi_chu_trang_thai": employee.employment_status_notes,
        "status_note": employee.employment_status_notes,
        "is_active": employee.is_active,
        "end_date": employee.end_date,
        "finalized": finalized,
        "is_locked": False, # wf.is_locked if finalized else False, # Temporarily disabled per user request
        "tong_cong": tong_cong,
        "cong_thuc_te": cong_thuc_te,
        "tong_phat": tong_phat,
        "tang_ca": tang_ca,
        "lam_them_gio": lam_them_gio,
        "truc_toi": truc_toi,
        "live": live,
        "nghi_phep_thang": nghi_phep_thang,
        "nghi_khong_phep_thang": nghi_khong_phep_thang,
        "giam_tru_khac": giam_tru_khac,
        "luong_co_ban": float(basic_salary),
        "phu_cap": float(allowance),
        "revenue_percentage": employee.revenue_percentage,
        "profit_percentage": employee.profit_percentage,
        # Keep the export aliases in the snapshot so accounting exports do not
        # need to fetch each employee again to resolve these percentages.
        "sales_percent": employee.revenue_percentage,
        "profit_percent": employee.profit_percentage,
        "tong_luong": float(gross_salary),
        "luong_thuc_linh": float(net_salary),
        "tong_khau_tru": float(total_deduction),
    }


def _get_visible_employees_for_approval(request, approval, viewer_employee, is_hr_admin):
    from itertools import chain as iterchain
    employees = _get_active_employees_for_department(
        approval.department, approval.year, approval.month
    )
    if not is_hr_admin:
        if viewer_employee is None:
            return employees.none()
        # Chỉ hiển thị nhân sự mà người xem là người duyệt theo cấu hình.
        managed_employees = employees.filter(get_approval_manager_filter(viewer_employee))
        # Thêm chính bản thân quản lý nếu họ active trong kỳ này
        # (dùng query riêng vì họ có thể thuộc phòng ban khác)
        self_qs = Employee.objects.select_related("department", "position").filter(
            pk=viewer_employee.pk
        ).filter(_get_active_or_resigned_in_period_q(approval.year, approval.month))
        if self_qs.exists() and not managed_employees.filter(pk=viewer_employee.pk).exists():
            return list(iterchain(managed_employees, self_qs))
        return managed_employees
    return employees


def _can_manage_department_approval(employee, approval):
    """
    True nếu nhân viên là quản lý phụ trách của ít nhất một nhân sự thuộc
    phòng ban trong kỳ chốt công này.

    Lưu ý: quyền này chỉ dùng cho thao tác theo từng nhân sự / danh sách nhân sự
    mà người dùng được phép thấy. Nút duyệt hàng loạt ở FE chỉ được áp dụng cho
    các nhân sự được cấu hình cho người duyệt phụ trách.

    Không bắt buộc phải là `department.manager` vì một phòng có thể có nhiều
    quản lý phụ trách cùng tham gia duyệt.
    """
    if not employee or not approval or not approval.department_id:
        return False

    manageable_department_ids = _get_manageable_department_ids(
        employee,
        approval.year,
        approval.month,
    )
    return approval.department_id in manageable_department_ids


def _can_approve_department_as_direct_manager(employee, approval):
    """
    Chỉ cho phép duyệt toàn bộ bảng khi người dùng là người duyệt được cấu hình
    của tất cả nhân sự khác trong phòng ban.
    """
    if not _can_manage_department_approval(employee, approval):
        return False

    department_employees = _get_active_employees_for_department(
        approval.department,
        approval.year,
        approval.month,
    ).exclude(pk=getattr(employee, "pk", None))

    if not department_employees.exists():
        return False

    return not department_employees.exclude(get_approval_manager_filter(employee)).exists()


def _get_department_decision_readiness(approval):
    """
    Kiểm tra trạng thái quyết định theo từng nhân sự trong phòng ban để phục vụ
    luồng admin duyệt lại nhanh:
      - Tất cả nhân sự phải có quyết định.
      - Quyết định phải do quản lý được cấu hình của nhân sự đó đưa ra
        (hoặc tự quyết cho chính mình).
    """
    employees = list(
        _get_active_employees_for_department(
            approval.department,
            approval.year,
            approval.month,
        )
    )

    if not employees:
        return {
            "total_employees": 0,
            "missing_decisions": [],
            "not_direct_manager_decisions": [],
        }

    employee_map = {emp.pk: emp for emp in employees}
    decision_map = {
        d.employee_id: d
        for d in WorkFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
            approval=approval,
            employee_id__in=list(employee_map.keys()),
        )
    }

    missing_decisions = []
    not_direct_manager_decisions = []

    for emp in employees:
        decision = decision_map.get(emp.pk)
        if not decision:
            missing_decisions.append(emp)
            continue

        decided_by_id = getattr(decision, "decided_by_id", None)
        is_self_decision = decided_by_id == emp.pk
        is_approval_manager_decision = decided_by_id == get_approval_manager_id(emp)
        if not is_self_decision and not is_approval_manager_decision:
            not_direct_manager_decisions.append(emp)

    return {
        "total_employees": len(employees),
        "missing_decisions": missing_decisions,
        "not_direct_manager_decisions": not_direct_manager_decisions,
    }


def _get_decision_label(decision_value):
    if decision_value == "APPROVED":
        return "Đã duyệt"
    if decision_value == "REJECTED":
        return "Đã từ chối"
    return "Chưa quyết định"


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class SendDepartmentApprovalView(APIView):
    """
    POST /hrm/work-finalization/approvals/send/
    Body: { "department_id": 1, "year": 2026, "month": 3 }
       or { "department_code": "KD", "year": 2026, "month": 3 }

    Gửi (hoặc reset) yêu cầu phê duyệt chốt công đến Trưởng phòng.
    Chỉ HR/Admin mới được gọi API này.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Chỉ HR hoặc Admin mới được gửi yêu cầu phê duyệt chốt công"},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(
            request.data.get("year"), request.data.get("month")
        )
        if err:
            return err

        department_id = request.data.get("department_id")
        department_code = request.data.get("department_code")
        if not department_id and not department_code:
            return Response(
                {"error": "department_id hoặc department_code là bắt buộc"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if department_id:
                department = Department.objects.get(pk=int(department_id))
            else:
                department = Department.objects.get(code=department_code)
        except (Department.DoesNotExist, ValueError):
            identifier = department_id or department_code
            return Response(
                {"error": f"Không tìm thấy phòng ban '{identifier}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        sent_by_employee = None
        try:
            sent_by_employee = request.user.employee
        except Exception:
            pass

        # Kiểm tra đơn đã tồn tại chưa để lấy trạng thái cũ phục vụ ghi log
        existing_approval = DepartmentWorkFinalizationApproval.objects.filter(
            department_code=department.code,
            year=year,
            month=month
        ).first()
        
        old_status = existing_approval.status if existing_approval else None
        
        try:
            approval, created = DepartmentWorkFinalizationApproval.objects.update_or_create(
                department_code=department.code,
                year=year,
                month=month,
                defaults={
                    "department": department,
                    "status": "PENDING",
                    "sent_by": sent_by_employee,
                    "approved_by": None,
                    "approved_at": None,
                    "note": "",
                },
            )

            # Nếu là Reset (đã tồn tại trước đó), đảm bảo sent_at được cập nhật (vì auto_now_add=True ngăn việc tự update)
            if not created:
                approval.sent_at = timezone.now()
                approval.save(update_fields=['sent_at'])

            # Ghi log
            WorkFinalizationApprovalLog.objects.create(
                approval=approval,
                action='SEND' if created else 'RESET',
                performed_by=sent_by_employee,
                from_status=old_status,
                to_status="PENDING",
                note="Gửi yêu cầu phê duyệt mới" if created else f"Gửi lại yêu cầu từ trạng thái {old_status} (Reset)"
            )

            return Response(
                {
                    "created": created,
                    "approval": _serialize_approval(approval),
                },
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
            )
        except Exception as e:
            return Response(
                {"error": f"Lỗi hệ thống khi gửi yêu cầu phê duyệt: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class SendAllDepartmentsApprovalView(APIView):
    """
    POST /hrm/work-finalization/approvals/send-all/
    Body: { "year": 2026, "month": 3 }

    Gửi yêu cầu phê duyệt chốt công cho TẤT CẢ phòng ban.
    Chỉ HR/Admin mới được gọi API này.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Chỉ HR hoặc Admin mới được gửi yêu cầu phê duyệt chốt công"},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(
            request.data.get("year"), request.data.get("month")
        )
        if err:
            return err

        sent_by_employee = None
        try:
            sent_by_employee = request.user.employee
        except Exception:
            pass

        departments = list(Department.objects.all())

        # Build list of objects for upsert (Django 4.1+ bulk_create with update_conflicts)
        objs = [
            DepartmentWorkFinalizationApproval(
                department=dept,
                department_code=dept.code,
                year=year,
                month=month,
                status="PENDING",
                sent_by=sent_by_employee,
                approved_by=None,
                approved_at=None,
                note="",
            )
            for dept in departments
        ]

        DepartmentWorkFinalizationApproval.objects.bulk_create(
            objs,
            update_conflicts=True,
            unique_fields=["department_code", "year", "month"],
            update_fields=["department", "status", "sent_by", "approved_by", "approved_at", "note"],
        )

        # Mở khóa dữ liệu cho tất cả các phòng ban để HR có thể tính toán lại nếu cần
        # WorkFinalization.objects.filter(
        #     year=year,
        #     month=month
        # ).update(is_locked=False)

        # Ghi log đồng loạt
        approvals = DepartmentWorkFinalizationApproval.objects.filter(year=year, month=month)
        log_objs = [
            WorkFinalizationApprovalLog(
                approval=app,
                action='SEND',
                performed_by=sent_by_employee,
                to_status="PENDING",
                note="Gửi yêu cầu phê duyệt đồng loạt"
            )
            for app in approvals
        ]
        WorkFinalizationApprovalLog.objects.bulk_create(log_objs)

        return Response(
            {
                "year": year,
                "month": month,
                "total": len(departments),
                "results": [
                    {"department_code": d.code, "department_name": d.name}
                    for d in departments
                ],
            },
            status=status.HTTP_200_OK,
        )


class ApproveDepartmentFinalizationView(APIView):
    """
    POST /hrm/work-finalization/approvals/<int:pk>/approve/
    Body: { "action": "APPROVED" | "REJECTED", "note": "..." }

    Quản lý phụ trách phê duyệt hoặc từ chối chốt công của phòng ban mình.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            try:
                approval = DepartmentWorkFinalizationApproval.objects.select_related(
                    "department", "sent_by", "approved_by"
                ).get(pk=pk)
            except DepartmentWorkFinalizationApproval.DoesNotExist:
                return Response(
                    {"error": "Không tìm thấy yêu cầu phê duyệt"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if approval.status != "PENDING":
                return Response(
                    {"error": f"Yêu cầu này đã ở trạng thái '{approval.status}', không thể phê duyệt"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Kiểm tra quyền: HR/Admin hoặc Quản lý của phòng ban/nhân sự đó
            approver_employee = None
            try:
                approver_employee = request.user.employee
            except Exception:
                pass

            is_hr_admin = _is_super_admin(request)
            is_authorized = False

            if is_hr_admin:
                is_authorized = True
            elif approver_employee and _can_approve_department_as_direct_manager(approver_employee, approval):
                is_authorized = True
            
            if not is_authorized:
                return Response(
                    {"error": "Bạn không có quyền phê duyệt chốt công của phòng ban này"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            action = request.data.get("action", "").upper()
            if action not in ("APPROVED", "REJECTED"):
                return Response(
                    {"error": "action phải là 'APPROVED' hoặc 'REJECTED'"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            action_note = (request.data.get("note") or "").strip()
            if action == "REJECTED" and not action_note:
                return Response(
                    {"error": "Vui lòng nhập lý do từ chối"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Luồng admin duyệt nhanh chỉ dùng để duyệt lại theo quyết định hiện có
            # của quản lý phụ trách. Khi bật cờ này, dữ liệu phải đầy đủ/hợp lệ.
            require_direct_manager_decisions = bool(
                request.data.get("require_direct_manager_decisions", False)
            )
            if action == "APPROVED" and require_direct_manager_decisions:
                readiness = _get_department_decision_readiness(approval)
                missing_count = len(readiness["missing_decisions"])
                invalid_count = len(readiness["not_direct_manager_decisions"])
                if missing_count > 0 or invalid_count > 0:
                    return Response(
                        {
                            "error": "Chỉ có thể duyệt nhanh khi toàn bộ nhân sự đã được quản lý phụ trách quyết định.",
                            "missing_decisions": missing_count,
                            "not_direct_manager_decisions": invalid_count,
                            "total_employees": readiness["total_employees"],
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            old_status = approval.status
            target_status = action # Chuyển thẳng sang APPROVED hoặc REJECTED
            
            approval.status = target_status
            approval.approved_by = approver_employee
            approval.approved_at = timezone.now()
            approval.note = action_note
            approval.save(update_fields=["status", "approved_by", "approved_at", "note"])

            # Ghi log
            WorkFinalizationApprovalLog.objects.create(
                approval=approval,
                action='APPROVE' if action == 'APPROVED' else 'REJECT',
                performed_by=approver_employee,
                from_status=old_status,
                to_status=target_status,
                note=approval.note
            )

            # Khóa dữ liệu công nếu APPROVED (Tạm thời bỏ vì chưa migrate DB)
            # if target_status == 'APPROVED':
            #     WorkFinalization.objects.filter(
            #         year=approval.year,
            #         month=approval.month,
            #         employee__department=approval.department
            #     ).update(is_locked=True)

            return Response(
                {"approval": _serialize_approval(approval)},
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            import traceback
            print(traceback.format_exc()) # Log ra console để debug
            return Response(
                {"error": f"Lỗi hệ thống khi phê duyệt: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class DepartmentFinalizationApprovalListView(APIView):
    """
    GET /hrm/work-finalization/approvals/
    Query params:
      - year  (required)
      - month (required)
      - department_id   (optional)
      - department_code (optional)
      - status          (optional: PENDING | APPROVED | REJECTED)

    Trả về danh sách phê duyệt chốt công theo tháng/năm.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        year, month, err = _validate_year_month(
            request.query_params.get("year"),
            request.query_params.get("month"),
        )
        if err:
            return err

        qs = DepartmentWorkFinalizationApproval.objects.select_related(
            "department", "sent_by", "approved_by"
        ).filter(year=year, month=month)

        # Kiểm soát truy cập: chỉ superadmin xem tất cả,
        # còn lại chỉ xem phòng ban có nhân sự do mình phụ trách phê duyệt.
        if not _is_super_admin(request):
            try:
                employee = _get_employee_from_request(request)
            except AttributeError:
                return Response(
                    {"error": "Không tìm thấy thông tin nhân viên của bạn"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            accessible_dept_ids = _get_manageable_department_ids(employee, year, month)
            qs = qs.filter(department_id__in=accessible_dept_ids)

            # Với quản lý phụ trách (không phải HR/Admin), ẩn bảng đã ADMIN duyệt.
            is_direct_manager_view = (
                not bool(getattr(employee, "is_hr", False))
                and not bool(getattr(request.user, "is_staff", False))
                and not bool(getattr(request.user, "is_superuser", False))
            )
            if is_direct_manager_view:
                qs = qs.exclude(status="APPROVED")

        department_id = request.query_params.get("department_id")
        if department_id:
            qs = qs.filter(department_id=department_id)

        department_code = request.query_params.get("department_code")
        if department_code:
            qs = qs.filter(department_code=department_code)

        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter.upper())

        current_employee = None
        try:
            current_employee = _get_employee_from_request(request)
        except Exception:
            current_employee = None

        results = []
        for approval in qs:
            item = _serialize_approval(approval)
            item["can_approve"] = _is_super_admin(request) or _can_approve_department_as_direct_manager(current_employee, approval)
            item["can_decide_employees"] = _is_super_admin(request) or _can_manage_department_approval(current_employee, approval)
            results.append(item)
        return Response(
            {
                "year": year,
                "month": month,
                "total": len(results),
                "results": results,
            }
        )


class DepartmentFinalizationApprovalDetailView(APIView):
    """
    GET /hrm/work-finalization/approvals/<int:pk>/
    Trả về chi tiết phê duyệt kèm danh sách nhân sự của phòng ban đó trong tháng.
    Bao gồm nhân sự INACTIVE nếu ngày nghỉ việc nằm trong đúng tháng/năm chốt công.
    Với người dùng không phải HR/Admin, chỉ trả về nhân sự họ phụ trách phê duyệt.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            approval = DepartmentWorkFinalizationApproval.objects.select_related(
                "department", "sent_by", "approved_by"
            ).get(pk=pk)
        except DepartmentWorkFinalizationApproval.DoesNotExist:
            return Response(
                {"error": "Không tìm thấy yêu cầu phê duyệt"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Kiểm soát truy cập: chỉ superadmin xem tất cả,
        # còn lại chỉ xem phòng ban có nhân sự active mà mình phụ trách phê duyệt
        # hoặc phòng ban do mình quản lý.
        if not _is_super_admin(request):
            try:
                employee = _get_employee_from_request(request)
            except AttributeError:
                return Response(
                    {"error": "Không tìm thấy thông tin nhân viên của bạn"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            accessible_dept_ids = _get_manageable_department_ids(employee, approval.year, approval.month)
            if approval.department_id not in accessible_dept_ids:
                return Response(
                    {"error": "Bạn không có quyền xem phê duyệt của phòng ban này"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        current_employee = None
        try:
            current_employee = _get_employee_from_request(request)
        except Exception:
            current_employee = None

        employees = _get_visible_employees_for_approval(
            request, approval, current_employee, _is_super_admin(request)
        )

        employee_list = [
            _serialize_employee_summary(emp, approval.year, approval.month)
            for emp in employees
        ]

        employee_ids = [item["employee_id"] for item in employee_list]
        decisions_map = {
            d.employee_id: d
            for d in WorkFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
                approval=approval,
                employee_id__in=employee_ids,
            )
        }
        for item in employee_list:
            decision = decisions_map.get(item["employee_id"])
            decision_by_id = decision.decided_by_id if decision else None
            employee_approval_manager_id = item.get("approval_manager_id")
            is_self_decision = bool(decision and decision_by_id == item["employee_id"])
            is_approval_manager_decision = bool(
                decision
                and decision_by_id is not None
                and employee_approval_manager_id is not None
                and decision_by_id == employee_approval_manager_id
            )
            item["individual_decision"] = decision.decision if decision else None
            item["individual_decision_label"] = _get_decision_label(decision.decision if decision else None)
            item["individual_decision_note"] = decision.note if decision else ""
            item["individual_decided_at"] = decision.decided_at if decision else None
            item["individual_decided_by_id"] = decision_by_id
            item["individual_decided_by_name"] = decision.decided_by.full_name if decision and decision.decided_by else None
            item["individual_decision_from_approval_manager"] = is_approval_manager_decision or is_self_decision
            # Giữ field cũ để tương thích với frontend/client chưa cập nhật.
            item["individual_decision_from_direct_manager"] = item["individual_decision_from_approval_manager"]

        data = _serialize_approval(approval)
        
        # Kiểm tra quyền duyệt của user hiện tại với đơn này
        user_emp = None
        try:
            user_emp = request.user.employee
        except:
            pass
            
        is_authorized = _is_super_admin(request)
        if not is_authorized and user_emp:
            is_authorized = _can_approve_department_as_direct_manager(user_emp, approval)

        data["can_approve"] = is_authorized # FE có thể dùng để hiện nút Duyệt
        data["can_decide_employees"] = _is_super_admin(request) or _can_manage_department_approval(user_emp, approval)
        data["employees"] = employee_list
        data["total_employees"] = len(employee_list)
        return Response(data)


class DecideEmployeeFinalizationView(APIView):
    """
    POST /hrm/work-finalization/approvals/<int:pk>/employees/<int:employee_id>/decision/
    Body: {"action": "APPROVED" | "REJECTED", "note": "..."}

    Cho phép từ chối nhân sự ở mọi trạng thái bảng chốt công.
    Cho phép duyệt từng nhân sự ngay cả khi bảng chốt công vẫn đang chờ duyệt.
    Bất kỳ quản lý phụ trách nào của nhân sự trong phòng đều có thể thao tác,
    không bắt buộc là trưởng phòng cố định.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, pk, employee_id):
        try:
            approval = DepartmentWorkFinalizationApproval.objects.select_related("department").get(pk=pk)
        except DepartmentWorkFinalizationApproval.DoesNotExist:
            return Response(
                {"error": "Không tìm thấy yêu cầu phê duyệt"},
                status=status.HTTP_404_NOT_FOUND,
            )

        approver_employee = None
        try:
            approver_employee = _get_employee_from_request(request)
        except Exception:
            pass

        is_hr_admin = _is_super_admin(request)
        can_decide = False
        if is_hr_admin:
            can_decide = True
        elif approver_employee and _can_manage_department_approval(approver_employee, approval):
            can_decide = True

        if not can_decide:
            return Response(
                {"error": "Bạn không có quyền duyệt/từ chối nhân sự trong bảng chốt công này"},
                status=status.HTTP_403_FORBIDDEN,
            )

        action = (request.data.get("action") or "").upper().strip()
        if action not in ("APPROVED", "REJECTED"):
            return Response(
                {"error": "action phải là 'APPROVED' hoặc 'REJECTED'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if action == "APPROVED" and approval.status == "REJECTED":
            return Response(
                {"error": "Không thể duyệt nhân sự khi bảng chốt công đã bị từ chối"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        note = (request.data.get("note") or "").strip()
        if action == "REJECTED" and not note:
            return Response(
                {"error": "Vui lòng nhập lý do từ chối cho nhân sự này"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            target_employee = Employee.objects.select_related("department").get(pk=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {"error": "Không tìm thấy nhân sự"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if target_employee.department_id != approval.department_id:
            return Response(
                {"error": "Nhân sự không thuộc phòng ban của bảng chốt công này"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not is_hr_admin and approver_employee:
            is_direct_managed = is_approval_manager(approver_employee, target_employee)
            is_self = target_employee.pk == approver_employee.pk
            if not is_direct_managed and not is_self:
                return Response(
                    {"error": "Bạn chỉ có thể thao tác với nhân sự mà mình được phân công phê duyệt"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        snapshot = _to_json_safe(_serialize_employee_summary(target_employee, approval.year, approval.month))
        auto_approved = False
        with transaction.atomic():
            # Khoá bản ghi cấp phòng để hai quản lý duyệt nhân sự cuối cùng cùng lúc
            # không tạo trạng thái hoặc log trùng nhau. Chỉ khoá bảng chính vì
            # sent_by/approved_by là nullable LEFT JOIN, PostgreSQL không cho FOR UPDATE trên đó.
            approval = DepartmentWorkFinalizationApproval.objects.select_related(
                "department", "sent_by", "approved_by"
            ).select_for_update(of=("self",)).get(pk=pk)
            decision_obj, _ = WorkFinalizationEmployeeDecision.objects.update_or_create(
                approval=approval,
                employee=target_employee,
                defaults={
                    "decision": action,
                    "note": note,
                    "decided_by": approver_employee,
                    "employee_snapshot": snapshot,
                },
            )

            progress = _get_employee_decision_progress(approval)
            if (
                approval.status == "PENDING"
                and progress["total_employees"] > 0
                and progress["approved_employees"] == progress["total_employees"]
            ):
                old_status = approval.status
                approval.status = "APPROVED"
                approval.approved_by = approver_employee
                approval.approved_at = timezone.now()
                approval.note = "Tự động duyệt khi toàn bộ nhân sự đã được phê duyệt"
                approval.save(update_fields=["status", "approved_by", "approved_at", "note"])
                WorkFinalizationApprovalLog.objects.create(
                    approval=approval,
                    action="APPROVE",
                    performed_by=approver_employee,
                    from_status=old_status,
                    to_status="APPROVED",
                    note=approval.note,
                )
                auto_approved = True

        return Response(
            {
                "message": "Đã cập nhật quyết định theo nhân sự",
                "approval": _serialize_approval(approval),
                "auto_approved": auto_approved,
                "decision": {
                    "approval_id": approval.pk,
                    "employee_id": target_employee.pk,
                    "employee_name": target_employee.full_name,
                    "decision": decision_obj.decision,
                    "decision_label": _get_decision_label(decision_obj.decision),
                    "note": decision_obj.note,
                    "decided_by_name": decision_obj.decided_by.full_name if decision_obj.decided_by else None,
                    "decided_at": decision_obj.decided_at,
                },
            },
            status=status.HTTP_200_OK,
        )


class FinalizationAccountingExportGenerateView(APIView):
    """
    POST /hrm/work-finalization/accounting-exports/generate/

    Tạo / cập nhật bảng dữ liệu chuẩn cuối cùng để kế toán xuất file.
    Chỉ admin mới được thao tác.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not _is_super_admin(request):
            return Response(
                {"error": "Chỉ admin mới được tạo dữ liệu xuất kế toán"},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(
            request.data.get("year"),
            request.data.get("month"),
        )
        if err:
            return err

        department_code = (request.data.get("department_code") or "").strip()

        approvals = DepartmentWorkFinalizationApproval.objects.select_related(
            "department", "sent_by", "approved_by"
        ).filter(year=year, month=month, status="APPROVED")
        if department_code:
            approvals = approvals.filter(department_code=department_code)

        current_employee = None
        try:
            current_employee = _get_employee_from_request(request)
        except Exception:
            current_employee = None

        exported_rows = []
        skipped = []

        for approval in approvals:
            employees = list(_get_visible_employees_for_approval(request, approval, current_employee, True))
            employee_list = [_serialize_employee_summary(emp, approval.year, approval.month) for emp in employees]
            decisions_map = {
                d.employee_id: d
                for d in WorkFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
                    approval=approval,
                    employee_id__in=[item["employee_id"] for item in employee_list],
                )
            }

            missing = [item for item in employee_list if item["employee_id"] not in decisions_map]
            if missing:
                skipped.append({
                    "department_code": approval.department_code,
                    "department_name": approval.department.name if approval.department_id else None,
                    "missing_employees": len(missing),
                })
                continue

            for item in employee_list:
                decision = decisions_map[item["employee_id"]]
                snapshot = dict(item)
                snapshot.update({
                    "decision": decision.decision,
                    "decision_label": _get_decision_label(decision.decision),
                    "decision_note": decision.note,
                    "decided_by_name": decision.decided_by.full_name if decision.decided_by else None,
                    "decided_at": decision.decided_at.isoformat() if decision.decided_at else None,
                })

                row, _ = WorkFinalizationAccountingExport.objects.update_or_create(
                    approval=approval,
                    employee_id=item["employee_id"],
                    defaults={
                        "year": approval.year,
                        "month": approval.month,
                        "department_code": approval.department_code,
                        "department_name": approval.department.name if approval.department_id else None,
                        "employee_code": item["ma_nv"],
                        "employee_name": item["ho_va_ten"],
                        "decision": decision.decision,
                        "decision_label": _get_decision_label(decision.decision),
                        "decision_note": decision.note,
                        "decided_by": decision.decided_by,
                        "decided_at": decision.decided_at,
                        "exported_by": current_employee,
                        "data_snapshot": _to_json_safe(snapshot),
                    },
                )
                exported_rows.append(_serialize_export_row(row))

        return Response(
            {
                "year": year,
                "month": month,
                "department_code": department_code or None,
                "total_exported": len(exported_rows),
                "skipped_departments": skipped,
                "results": exported_rows,
            },
            status=status.HTTP_200_OK,
        )


class FinalizationAccountingExportListView(APIView):
    """
    GET /hrm/work-finalization/accounting-exports/
    Trả về danh sách dữ liệu chuẩn cuối cùng để admin xuất cho kế toán.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _is_super_admin(request):
            return Response(
                {"error": "Chỉ admin mới được xem dữ liệu xuất kế toán"},
                status=status.HTTP_403_FORBIDDEN,
            )

        year, month, err = _validate_year_month(
            request.query_params.get("year"),
            request.query_params.get("month"),
        )
        if err:
            return err

        qs = WorkFinalizationAccountingExport.objects.select_related(
            "approval", "employee", "decided_by", "exported_by"
        ).filter(year=year, month=month)

        department_code = request.query_params.get("department_code")
        if department_code:
            qs = qs.filter(department_code=department_code)

        employee_code = request.query_params.get("employee_code")
        if employee_code:
            qs = qs.filter(employee_code=employee_code)

        decision = request.query_params.get("decision")
        if decision:
            qs = qs.filter(decision=decision.upper())

        results = [_serialize_export_row(row) for row in qs]
        return Response(
            {
                "year": year,
                "month": month,
                "total": len(results),
                "results": results,
            }
        )


class DepartmentFinalizationApprovalPrintView(APIView):
    """
    GET /hrm/work-finalization/approvals/<int:pk>/print/
    Trả về HTML in phiếu ký cho bảng chốt công phòng ban.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            approval = DepartmentWorkFinalizationApproval.objects.select_related(
                "department", "sent_by", "approved_by"
            ).get(pk=pk)
        except DepartmentWorkFinalizationApproval.DoesNotExist:
            return Response(
                {"error": "Không tìm thấy yêu cầu phê duyệt"},
                status=status.HTTP_404_NOT_FOUND,
            )

        is_hr_admin = _is_super_admin(request)
        current_employee = None
        try:
            current_employee = _get_employee_from_request(request)
        except Exception:
            current_employee = None

        if not is_hr_admin:
            if not current_employee:
                return Response(
                    {"error": "Không tìm thấy thông tin nhân viên của bạn"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            accessible_dept_ids = _get_manageable_department_ids(current_employee, approval.year, approval.month)
            if approval.department_id not in accessible_dept_ids:
                return Response(
                    {"error": "Bạn không có quyền in bảng chốt công của phòng ban này"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        employees = _get_visible_employees_for_approval(
            request, approval, current_employee, is_hr_admin
        )
        employee_list = [
            _serialize_employee_summary(emp, approval.year, approval.month)
            for emp in employees
        ]

        decisions_map = {
            d.employee_id: d
            for d in WorkFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
                approval=approval,
                employee_id__in=[item["employee_id"] for item in employee_list],
            )
        }

        row_html = []
        for index, item in enumerate(employee_list, start=1):
            decision = decisions_map.get(item["employee_id"])
            decision_label = _get_decision_label(decision.decision if decision else None)
            decision_note = decision.note if decision else ""
            row_html.append(
                f"""
                <tr>
                  <td>{index}</td>
                  <td>{escape(item.get('ma_nv') or '')}</td>
                  <td>{escape(item.get('ho_va_ten') or '')}</td>
                  <td>{escape(item.get('vi_tri') or '')}</td>
                  <td class=\"num\">{float(item.get('luong_co_ban') or 0):,.0f}</td>
                  <td class=\"num\">{float(item.get('phu_cap') or 0):,.0f}</td>
                  <td class=\"num\">{float(item.get('cong_thuc_te') or 0):,.2f}</td>
                  <td>{escape(decision_label)}</td>
                  <td>{escape(decision_note or '')}</td>
                  <td></td>
                </tr>
                """
            )

        html = f"""
        <!DOCTYPE html>
        <html lang=\"vi\">
        <head>
          <meta charset=\"utf-8\" />
          <title>Phiếu ký chốt công {escape(approval.department_code)} - {approval.month}/{approval.year}</title>
          <style>
            body {{ font-family: Arial, sans-serif; color: #111; margin: 24px; }}
            h1 {{ font-size: 20px; margin: 0 0 4px 0; }}
            .sub {{ color: #555; margin-bottom: 16px; }}
            table {{ width: 100%; border-collapse: collapse; font-size: 12px; }}
            th, td {{ border: 1px solid #222; padding: 6px 8px; vertical-align: middle; }}
            th {{ background: #f4f4f4; text-align: center; }}
            td.num {{ text-align: right; white-space: nowrap; }}
            .signatures {{ margin-top: 40px; display: flex; justify-content: space-between; gap: 24px; }}
            .sig {{ width: 30%; text-align: center; }}
            .sig .title {{ font-weight: 700; text-transform: uppercase; margin-bottom: 72px; }}
            .sig .name {{ font-weight: 600; }}
            .meta {{ margin-top: 12px; font-size: 12px; color: #444; }}
            @media print {{ body {{ margin: 12px; }} }}
          </style>
        </head>
        <body>
          <h1>PHIẾU CHỐT CÔNG PHÒNG BAN</h1>
          <div class=\"sub\">Phòng ban: <strong>{escape(approval.department.name if approval.department_id else approval.department_code)}</strong> — Tháng {approval.month}/{approval.year}</div>

          <table>
            <thead>
              <tr>
                <th style=\"width:40px\">STT</th>
                <th style=\"width:90px\">Mã NV</th>
                <th>Họ và tên</th>
                <th>Vị trí</th>
                <th>Lương cơ bản</th>
                <th>Phụ cấp</th>
                <th>Công thực tế</th>
                <th>Trạng thái</th>
                <th>Ghi chú</th>
                <th style=\"width:120px\">Ký nhận</th>
              </tr>
            </thead>
            <tbody>
              {''.join(row_html) if row_html else '<tr><td colspan="10" style="text-align:center;">Không có dữ liệu</td></tr>'}
            </tbody>
          </table>

          <div class=\"meta\">In lúc: {timezone.now().strftime('%d/%m/%Y %H:%M')}</div>

          <div class=\"signatures\">
            <div class=\"sig\">
              <div class=\"title\">Người lập</div>
              <div class=\"name\">{escape(approval.sent_by.full_name if approval.sent_by else '')}</div>
            </div>
            <div class=\"sig\">
              <div class=\"title\">Người duyệt</div>
              <div class=\"name\">{escape(approval.approved_by.full_name if approval.approved_by else '')}</div>
            </div>
            <div class=\"sig\">
              <div class=\"title\">Xác nhận nhân sự</div>
              <div class=\"name\">&nbsp;</div>
            </div>
          </div>
        </body>
        </html>
        """

        return HttpResponse(html)

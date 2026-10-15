"""
API views for Attendance Finalization Approval (Phê duyệt chốt công nhân sự).

Flow:
  1. HR/Admin calls SendAttendanceFinalizationApprovalView or SendAllAttendanceFinalizationApprovalsView
     -> creates / resets AttendanceFinalizationApproval records (status=PENDING)
  2. The configured approval manager calls ApproveAttendanceFinalizationView.
  3. Anyone with access calls AttendanceFinalizationApprovalListView / DetailView to inspect state.
"""

from django.utils import timezone
from django.http import HttpResponse
from django.utils.html import escape
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
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
    AttendanceFinalizationApproval,
    AttendanceFinalizationApprovalLog,
    AttendanceFinalizationEmployeeDecision,
    WorkFinalization,
    EmailBatch,
    EmailQueue,
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
    if value in (None, ""):
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def _to_json_safe(value):
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
    user = request.user
    if user.is_staff or user.is_superuser:
        return True
    try:
        employee = user.employee
        if employee.is_hr:
            return True
        from .models import _has_approve_permission
        return _has_approve_permission(employee)
    except Exception:
        return False


def _is_super_admin(request):
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
    managed_department_ids = Employee.objects.filter(
        get_approval_manager_filter(employee),
        department_id__isnull=False,
    ).filter(
        _get_active_or_resigned_in_period_q(year, month)
    ).values_list("department_id", flat=True)

    return list(set(managed_department_ids))


def _get_employee_from_request(request):
    return request.user.employee


def _serialize_approval(approval: AttendanceFinalizationApproval) -> dict:
    sent_by = approval.sent_by
    approved_by = approval.approved_by

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
    }


def _get_active_employees_for_department(department, year, month):
    return (
        Employee.objects.select_related("department", "position")
        .filter(department=department)
        .filter(_get_active_or_resigned_in_period_q(year, month))
        .order_by("employee_id")
    )


def _serialize_employee_summary(employee, year, month):
    salary_record = MonthlySalaryRecord.objects.filter(
        employee=employee, year=year, month=month
    ).first()

    salary_snapshot = getattr(salary_record, "input_snapshot", None) or {}

    try:
        wf = WorkFinalization.objects.get(employee=employee, year=year, month=month)
        finalized = True
        tong_cong = float(wf.tong_cong) if wf.tong_cong is not None else 0
        cong_thuc_te = float(wf.cong_thuc_te) if wf.cong_thuc_te is not None else 0
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
        tong_phat = float(wf.tong_phat) if wf.tong_phat is not None else 0
        tang_ca = float(wf.tang_ca) if wf.tang_ca is not None else 0
        lam_them_gio = float(wf.lam_them_gio) if wf.lam_them_gio is not None else 0
        truc_toi = float(wf.truc_toi) if wf.truc_toi is not None else 0
        live = int(wf.live) if wf.live is not None else 0
        nghi_phep_thang = float(wf.nghi_phep_thang) if wf.nghi_phep_thang is not None else 0
        nghi_khong_phep_thang = float(wf.nghi_khong_phep_thang) if wf.nghi_khong_phep_thang is not None else 0
        phu_cap_gui_xe = float(wf.phu_cap_gui_xe) if wf.phu_cap_gui_xe is not None else 0
    except WorkFinalization.DoesNotExist:
        finalized = False
        tong_cong = 0
        cong_thuc_te = 0
        cong_ngay_le = 0
        tong_phat = 0
        tang_ca = 0
        lam_them_gio = 0
        truc_toi = 0
        live = 0
        nghi_phep_thang = 0
        nghi_khong_phep_thang = 0
        phu_cap_gui_xe = 0

    history_basic_salary, history_allowance = _get_salary_profile_for_month(employee, year, month)
    basic_salary = _to_decimal(salary_snapshot.get("basic_salary"), history_basic_salary)
    allowance = _to_decimal(salary_snapshot.get("allowance"), history_allowance)
    gross_salary = _to_decimal(getattr(salary_record, "gross_salary", 0))
    net_salary = _to_decimal(getattr(salary_record, "net_salary", 0))
    total_deduction = _to_decimal(getattr(salary_record, "total_deduction", 0))

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
        "tong_cong": tong_cong,
        "cong_thuc_te": cong_thuc_te,
        "cong_ngay_le": cong_ngay_le,
        "tong_phat": tong_phat,
        "tang_ca": tang_ca,
        "lam_them_gio": lam_them_gio,
        "truc_toi": truc_toi,
        "live": live,
        "nghi_phep_thang": nghi_phep_thang,
        "nghi_khong_phep_thang": nghi_khong_phep_thang,
        "phu_cap_gui_xe": phu_cap_gui_xe,
        "giam_tru_khac": giam_tru_khac,
        "luong_co_ban": float(basic_salary),
        "phu_cap": float(allowance),
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
        managed_employees = employees.filter(get_approval_manager_filter(viewer_employee))
        self_qs = Employee.objects.select_related("department", "position").filter(
            pk=viewer_employee.pk
        ).filter(_get_active_or_resigned_in_period_q(approval.year, approval.month))
        if self_qs.exists() and not managed_employees.filter(pk=viewer_employee.pk).exists():
            return list(iterchain(managed_employees, self_qs))
        return managed_employees
    return employees


def _can_manage_department_approval(employee, approval):
    if not employee or not approval or not approval.department_id:
        return False

    manageable_department_ids = _get_manageable_department_ids(
        employee,
        approval.year,
        approval.month,
    )
    return approval.department_id in manageable_department_ids


def _can_approve_department_as_direct_manager(employee, approval):
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
        for d in AttendanceFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
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


def _build_attendance_email_body(employee_data: dict, approval, decision_obj=None):
    month_label = f"{str(approval.month).zfill(2)}/{approval.year}"
    employee_name = employee_data.get("ho_va_ten") or employee_data.get("employee_name") or "Nhân sự"
    employee_code = employee_data.get("ma_nv") or employee_data.get("employee_code") or "-"
    department_name = approval.department.name if approval.department_id else approval.department_code
    decision_label = _get_decision_label(decision_obj.decision if decision_obj else None)
    decision_note = (decision_obj.note if decision_obj else "") or ""

    tong_cong = float(employee_data.get("tong_cong") or 0)
    cong_thuc_te = float(employee_data.get("cong_thuc_te") or 0)
    tang_ca = float(employee_data.get("tang_ca") or 0)
    nghi_phep_thang = float(employee_data.get("nghi_phep_thang") or 0)
    tong_phat = float(employee_data.get("tong_phat") or 0)

    note_line = f"\n- Ghi chú quyết định: {decision_note}" if decision_note else ""

    return (
        f"Xin chào {employee_name},\n\n"
        f"Hệ thống gửi thông tin chốt công tháng {month_label}.\n"
        f"- Mã nhân sự: {employee_code}\n"
        f"- Phòng ban: {department_name}\n"
        f"- Tổng công: {tong_cong:.2f}\n"
        f"- Công thực tế: {cong_thuc_te:.2f}\n"
        f"- Tăng ca: {tang_ca:.2f}\n"
        f"- Nghỉ phép tháng: {nghi_phep_thang:.2f}\n"
        f"- Tổng phạt: {tong_phat:,.0f} VNĐ\n"
        f"- Trạng thái quyết định: {decision_label}"
        f"{note_line}\n\n"
        f"Vui lòng liên hệ quản lý trực tiếp hoặc bộ phận HCNS nếu cần hỗ trợ.\n\n"
        f"Trân trọng,\n"
        f"Hệ thống HRM"
    )


def _build_attendance_email_html(subject: str, body: str):
    safe_subject = escape(subject or "Thông báo chốt công")
    lines = [escape(line) for line in (body or "").splitlines()]
    html_body = "<br>".join(lines)
    return f"""
    <div style=\"font-family: Arial, sans-serif; color: #1f2937; line-height: 1.65;\">
      <h2 style=\"margin: 0 0 12px; color: #111827;\">{safe_subject}</h2>
      <p style=\"margin: 0; white-space: normal;\">{html_body}</p>
      <p style=\"margin-top: 16px; color: #6b7280; font-size: 12px;\">
        Đây là email tự động từ hệ thống HRM. Vui lòng không trả lời email này.
      </p>
    </div>
    """.strip()


def _get_approval_and_employee_for_action(pk: int, employee_id: int):
    try:
        approval = AttendanceFinalizationApproval.objects.select_related("department").get(pk=pk)
    except AttendanceFinalizationApproval.DoesNotExist:
        return None, None, Response(
            {"error": "Không tìm thấy yêu cầu phê duyệt"},
            status=status.HTTP_404_NOT_FOUND,
        )

    try:
        target_employee = Employee.objects.select_related("department", "user").get(pk=employee_id)
    except Employee.DoesNotExist:
        return None, None, Response(
            {"error": "Không tìm thấy nhân sự"},
            status=status.HTTP_404_NOT_FOUND,
        )

    if target_employee.department_id != approval.department_id:
        return None, None, Response(
            {"error": "Nhân sự không thuộc phòng ban của bảng chốt công này"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return approval, target_employee, None


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class SendAttendanceFinalizationApprovalView(APIView):
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

        existing_approval = AttendanceFinalizationApproval.objects.filter(
            department_code=department.code,
            year=year,
            month=month
        ).first()

        old_status = existing_approval.status if existing_approval else None

        try:
            approval, created = AttendanceFinalizationApproval.objects.update_or_create(
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

            if not created:
                approval.sent_at = timezone.now()
                approval.save(update_fields=['sent_at'])

            AttendanceFinalizationApprovalLog.objects.create(
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


class SendAllAttendanceFinalizationApprovalsView(APIView):
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

        objs = [
            AttendanceFinalizationApproval(
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

        AttendanceFinalizationApproval.objects.bulk_create(
            objs,
            update_conflicts=True,
            unique_fields=["department_code", "year", "month"],
            update_fields=["department", "status", "sent_by", "approved_by", "approved_at", "note"],
        )

        approvals = AttendanceFinalizationApproval.objects.filter(year=year, month=month)
        log_objs = [
            AttendanceFinalizationApprovalLog(
                approval=app,
                action='SEND',
                performed_by=sent_by_employee,
                to_status="PENDING",
                note="Gửi yêu cầu phê duyệt đồng loạt"
            )
            for app in approvals
        ]
        AttendanceFinalizationApprovalLog.objects.bulk_create(log_objs)

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


class ApproveAttendanceFinalizationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            try:
                approval = AttendanceFinalizationApproval.objects.select_related(
                    "department", "sent_by", "approved_by"
                ).get(pk=pk)
            except AttendanceFinalizationApproval.DoesNotExist:
                return Response(
                    {"error": "Không tìm thấy yêu cầu phê duyệt"},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if approval.status != "PENDING":
                return Response(
                    {"error": f"Yêu cầu này đã ở trạng thái '{approval.status}', không thể phê duyệt"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

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
            target_status = action

            approval.status = target_status
            approval.approved_by = approver_employee
            approval.approved_at = timezone.now()
            approval.note = action_note
            approval.save(update_fields=["status", "approved_by", "approved_at", "note"])

            AttendanceFinalizationApprovalLog.objects.create(
                approval=approval,
                action='APPROVE' if action == 'APPROVED' else 'REJECT',
                performed_by=approver_employee,
                from_status=old_status,
                to_status=target_status,
                note=approval.note
            )

            return Response(
                {"approval": _serialize_approval(approval)},
                status=status.HTTP_200_OK,
            )
        except Exception as e:
            import traceback
            print(traceback.format_exc())
            return Response(
                {"error": f"Lỗi hệ thống khi phê duyệt: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class AttendanceFinalizationApprovalListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year, month, err = _validate_year_month(
            request.query_params.get("year"),
            request.query_params.get("month"),
        )
        if err:
            return err

        qs = AttendanceFinalizationApproval.objects.select_related(
            "department", "sent_by", "approved_by"
        ).filter(year=year, month=month)

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


class AttendanceFinalizationApprovalDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            approval = AttendanceFinalizationApproval.objects.select_related(
                "department", "sent_by", "approved_by"
            ).get(pk=pk)
        except AttendanceFinalizationApproval.DoesNotExist:
            return Response(
                {"error": "Không tìm thấy yêu cầu phê duyệt"},
                status=status.HTTP_404_NOT_FOUND,
            )

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
            for d in AttendanceFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
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

        user_emp = None
        try:
            user_emp = request.user.employee
        except Exception:
            pass

        is_authorized = _is_super_admin(request)
        if not is_authorized and user_emp:
            is_authorized = _can_approve_department_as_direct_manager(user_emp, approval)

        data["can_approve"] = is_authorized
        data["can_decide_employees"] = _is_super_admin(request) or _can_manage_department_approval(user_emp, approval)
        data["employees"] = employee_list
        data["total_employees"] = len(employee_list)
        return Response(data)


class DecideEmployeeAttendanceFinalizationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, employee_id):
        try:
            approval = AttendanceFinalizationApproval.objects.select_related("department").get(pk=pk)
        except AttendanceFinalizationApproval.DoesNotExist:
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
        decision_obj, _ = AttendanceFinalizationEmployeeDecision.objects.update_or_create(
            approval=approval,
            employee=target_employee,
            defaults={
                "decision": action,
                "note": note,
                "decided_by": approver_employee,
                "employee_snapshot": snapshot,
            },
        )

        return Response(
            {
                "message": "Đã cập nhật quyết định theo nhân sự",
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


class AttendanceFinalizationApprovalPrintView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            approval = AttendanceFinalizationApproval.objects.select_related(
                "department", "sent_by", "approved_by"
            ).get(pk=pk)
        except AttendanceFinalizationApproval.DoesNotExist:
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
            for d in AttendanceFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
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
          <title>Phiếu ký chốt công nhân sự {escape(approval.department_code)} - {approval.month}/{approval.year}</title>
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
          <h1>PHIẾU CHỐT CÔNG NHÂN SỰ</h1>
          <div class=\"sub\">Phòng ban: <strong>{escape(approval.department.name if approval.department_id else approval.department_code)}</strong> — Tháng {approval.month}/{approval.year}</div>

          <table>
            <thead>
              <tr>
                <th style=\"width:40px\">STT</th>
                <th style=\"width:90px\">Mã NV</th>
                <th>Họ và tên</th>
                <th>Vị trí</th>
                <th>Công thực tế</th>
                <th>Trạng thái</th>
                <th>Ghi chú</th>
                <th style=\"width:120px\">Ký nhận</th>
              </tr>
            </thead>
            <tbody>
              {''.join(row_html) if row_html else '<tr><td colspan="8" style="text-align:center;">Không có dữ liệu</td></tr>'}
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


class AttendanceFinalizationEmployeeEmailPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk, employee_id):
        approval, target_employee, err = _get_approval_and_employee_for_action(pk, employee_id)
        if err:
            return err

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
                {"error": "Bạn không có quyền xem trước email cho nhân sự này"},
                status=status.HTTP_403_FORBIDDEN,
            )

        employee_data = _serialize_employee_summary(target_employee, approval.year, approval.month)
        decision_obj = AttendanceFinalizationEmployeeDecision.objects.filter(
            approval=approval,
            employee=target_employee,
        ).select_related("decided_by").first()

        month_label = f"Tháng {str(approval.month).zfill(2)}.{approval.year}"
        subject = f"[Chốt công] {month_label} - {target_employee.full_name}"
        body = _build_attendance_email_body(employee_data, approval, decision_obj)
        recipient_email = (
            (target_employee.personal_email or "").strip()
            or ((target_employee.user.email or "").strip() if target_employee.user_id else "")
        )

        return Response(
            {
                "approval_id": approval.pk,
                "employee_id": target_employee.pk,
                "employee_name": target_employee.full_name,
                "employee_code": target_employee.employee_id,
                "email": recipient_email,
                "has_email": bool(recipient_email),
                "preview_subject": subject,
                "preview_body": body,
                "decision_label": _get_decision_label(decision_obj.decision if decision_obj else None),
            },
            status=status.HTTP_200_OK,
        )


class SendAttendanceFinalizationEmployeeEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk, employee_id):
        import uuid as _uuid

        approval, target_employee, err = _get_approval_and_employee_for_action(pk, employee_id)
        if err:
            return err

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
                {"error": "Bạn không có quyền gửi email chốt công cho nhân sự này"},
                status=status.HTTP_403_FORBIDDEN,
            )

        recipient_email = (
            (target_employee.personal_email or "").strip()
            or ((target_employee.user.email or "").strip() if target_employee.user_id else "")
        )
        if not recipient_email:
            return Response(
                {"error": "Nhân sự chưa có email để gửi"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employee_data = _serialize_employee_summary(target_employee, approval.year, approval.month)
        decision_obj = AttendanceFinalizationEmployeeDecision.objects.filter(
            approval=approval,
            employee=target_employee,
        ).select_related("decided_by").first()

        month_label = f"Tháng {str(approval.month).zfill(2)}.{approval.year}"
        default_subject = f"[Chốt công] {month_label} - {target_employee.full_name}"
        default_body = _build_attendance_email_body(employee_data, approval, decision_obj)

        subject = (request.data.get("subject") or "").strip() or default_subject
        body = (request.data.get("body") or "").strip() or default_body
        html_body = _build_attendance_email_html(subject, body)

        batch_id = f"ATT_FINAL_{approval.year}{str(approval.month).zfill(2)}_{approval.pk}_{target_employee.pk}_{_uuid.uuid4().hex[:8]}"

        EmailBatch.objects.create(
            batch_id=batch_id,
            total_emails=1,
            pending_count=1,
            created_by=request.user,
            status='PENDING',
        )

        EmailQueue.objects.create(
            employee=target_employee,
            email_type='PAYSLIP',
            status='PENDING',
            recipient_email=recipient_email,
            recipient_name=target_employee.full_name,
            email_subject=subject,
            email_plain_body=body,
            email_html_body=html_body,
            batch_id=batch_id,
            created_by=request.user,
        )

        return Response(
            {
                "detail": f"Đã xếp hàng gửi email chốt công đến {recipient_email}.",
                "batch_id": batch_id,
                "status": "PENDING",
                "recipient_email": recipient_email,
            },
            status=status.HTTP_200_OK,
        )


class AttendanceFinalizationEmailStatusesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year, month, err = _validate_year_month(
            request.query_params.get("year"),
            request.query_params.get("month"),
        )
        if err:
            return err

        department_id = request.query_params.get("department_id")
        if not department_id:
            return Response(
                {"error": "department_id là bắt buộc"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            department_id = int(department_id)
            department = Department.objects.get(pk=department_id)
        except (ValueError, Department.DoesNotExist):
            return Response(
                {"error": "Không tìm thấy phòng ban"},
                status=status.HTTP_404_NOT_FOUND,
            )

        current_employee = None
        try:
            current_employee = _get_employee_from_request(request)
        except Exception:
            current_employee = None

        if not _is_super_admin(request):
            if not current_employee:
                return Response(
                    {"error": "Không tìm thấy thông tin nhân viên của bạn"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            accessible_dept_ids = _get_manageable_department_ids(current_employee, year, month)
            if department_id not in accessible_dept_ids:
                return Response(
                    {"error": "Bạn không có quyền xem trạng thái email của phòng ban này"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        employees = list(_get_active_employees_for_department(department, year, month))
        employee_ids = [emp.pk for emp in employees]
        if not employee_ids:
            return Response(
                {
                    "year": year,
                    "month": month,
                    "department_id": department_id,
                    "statuses": [],
                },
                status=status.HTTP_200_OK,
            )

        batch_prefix = f"ATT_FINAL_{year}{str(month).zfill(2)}_"
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
        for emp in employees:
            latest = latest_by_employee.get(emp.pk)
            statuses.append({
                "employee_id": emp.pk,
                "status": latest.status if latest else None,
                "processed_at": latest.processed_at if latest else None,
                "error_message": latest.error_message if latest else None,
                "batch_id": latest.batch_id if latest else None,
            })

        return Response(
            {
                "year": year,
                "month": month,
                "department_id": department_id,
                "statuses": statuses,
            },
            status=status.HTTP_200_OK,
        )


class SendAttendanceFinalizationDepartmentEmailsView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        import uuid as _uuid

        year, month, err = _validate_year_month(
            request.data.get("year"),
            request.data.get("month"),
        )
        if err:
            return err

        department_id = request.data.get("department_id")
        if not department_id:
            return Response(
                {"error": "department_id là bắt buộc"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            department_id = int(department_id)
            department = Department.objects.get(pk=department_id)
        except (ValueError, Department.DoesNotExist):
            return Response(
                {"error": "Không tìm thấy phòng ban"},
                status=status.HTTP_404_NOT_FOUND,
            )

        current_employee = None
        try:
            current_employee = _get_employee_from_request(request)
        except Exception:
            current_employee = None

        if not _is_super_admin(request):
            if not current_employee:
                return Response(
                    {"error": "Không tìm thấy thông tin nhân viên của bạn"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            accessible_dept_ids = _get_manageable_department_ids(current_employee, year, month)
            if department_id not in accessible_dept_ids:
                return Response(
                    {"error": "Bạn không có quyền gửi email chốt công cho phòng ban này"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        employees = list(_get_active_employees_for_department(department, year, month))
        if not employees:
            return Response(
                {"error": "Không có nhân sự phù hợp để gửi email"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        approval = AttendanceFinalizationApproval.objects.filter(
            department_id=department_id,
            year=year,
            month=month,
        ).first()

        decision_map = {}
        if approval:
            decision_map = {
                d.employee_id: d
                for d in AttendanceFinalizationEmployeeDecision.objects.select_related("decided_by").filter(
                    approval=approval,
                    employee_id__in=[emp.pk for emp in employees],
                )
            }

        month_label = f"Tháng {str(month).zfill(2)}.{year}"
        batch_id = f"ATT_FINAL_{year}{str(month).zfill(2)}_DEPT_{department_id}_{_uuid.uuid4().hex[:8]}"

        queue_objects = []
        skipped_no_email = 0
        total = 0

        for emp in employees:
            total += 1
            recipient_email = (
                (emp.personal_email or "").strip()
                or ((emp.user.email or "").strip() if getattr(emp, "user_id", None) else "")
            )
            if not recipient_email:
                skipped_no_email += 1
                continue

            employee_data = _serialize_employee_summary(emp, year, month)
            decision_obj = decision_map.get(emp.pk)
            subject = f"[Chốt công] {month_label} - {emp.full_name}"
            body = _build_attendance_email_body(employee_data, approval, decision_obj) if approval else _build_attendance_email_body(
                employee_data,
                type("TmpApproval", (), {
                    "month": month,
                    "year": year,
                    "department_id": department_id,
                    "department_code": department.code,
                    "department": department,
                })(),
                decision_obj,
            )
            html_body = _build_attendance_email_html(subject, body)

            queue_objects.append(
                EmailQueue(
                    employee=emp,
                    email_type='PAYSLIP',
                    status='PENDING',
                    recipient_email=recipient_email,
                    recipient_name=emp.full_name,
                    email_subject=subject,
                    email_plain_body=body,
                    email_html_body=html_body,
                    batch_id=batch_id,
                    created_by=request.user,
                )
            )

        if not queue_objects:
            return Response(
                {"error": "Không có nhân sự nào có email để gửi"},
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
                "detail": f"Đã xếp hàng {queued}/{total} email chốt công cho phòng ban {department.name}.",
                "batch_id": batch_id,
                "department_id": department_id,
                "department_name": department.name,
                "year": year,
                "month": month,
                "total": total,
                "queued": queued,
                "skipped_no_email": skipped_no_email,
            },
            status=status.HTTP_200_OK,
        )

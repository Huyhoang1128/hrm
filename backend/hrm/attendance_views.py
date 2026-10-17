"""
hrm/attendance_views.py
═══════════════════════
REST API views cho hệ thống HRM Attendance Engine.

Endpoints:
  /api/v1/hrm/attendance/
    policy-versions/           – CRUD AttendancePolicyVersion
    policy-versions/<id>/activate/
    penalty-tiers/             – CRUD PenaltyTierConfig
    policy-config/             – CRUD AttendancePolicyConfig
    registration-requests/     – CRUD RegistrationRequest (OT/LIVE/NIGHT_SHIFT…)
    registration-requests/<id>/approve/
    registration-requests/<id>/reject/
    online-work-requests/      – CRUD OnlineWorkRequest
    online-work-requests/<id>/approve/
    online-work-requests/<id>/reject/
    monthly-summary/<emp_id>/<year>/<month>/  – tính công tháng
    finalize/<emp_id>/<year>/<month>/         – chốt công (lưu MonthlyWorkCredit)
    finalize-department/<dept_id>/<year>/<month>/
    penalty-preview/           – xem trước mức phạt
    live-check/                – kiểm tra phiên live
    event-log/                 – xem event log
    event-replay/<emp_id>/     – replay events với engine mới
    livestream-config/         – CRUD LivestreamSessionConfig
    shift-assignment/          – Gán ca làm việc cho nhân viên / phòng ban
"""

import datetime
import logging
import traceback
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.db.models import Q

from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import JSONParser, MultiPartParser

from employee.models import Employee, Department

from .attendance_models import (
    AttendancePolicyVersion,
    PenaltyTierConfig,
    AttendancePolicyConfig,
    RegistrationRequest,
    OnlineWorkRequest,
    AttendanceEventLog,
    LivestreamSessionConfig,
)
from .attendance_engine import (
    HRMAttendanceEngine,
    DepartmentAttendanceBatchEngine,
    PolicyLoader,
    calculate_penalty_preview,
    check_live_session_eligibility,
    EXEMPT_EXPLANATION_TYPES,
)
from .models import ShiftConfig, _is_hr
from .employee_work_utils import is_employee_active_on_date, is_holiday_creditable, get_holiday_credit_for_employee

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _get_employee(request):
    """Lấy Employee từ request.user hiện tại."""
    try:
        return Employee.objects.get(user=request.user)
    except Employee.DoesNotExist:
        return None


def _ok(data, status_code=status.HTTP_200_OK):
    return Response({"success": True, "data": data}, status=status_code)


def _err(msg, status_code=status.HTTP_400_BAD_REQUEST, details=None):
    body = {"success": False, "error": msg}
    if details:
        body["details"] = details
    return Response(body, status=status_code)


# ─────────────────────────────────────────────────────────────────────────────
# 1. POLICY VERSION
# ─────────────────────────────────────────────────────────────────────────────

class AttendancePolicyVersionListView(APIView):
    """GET list / POST create AttendancePolicyVersion"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = AttendancePolicyVersion.objects.all()
        data = [
            {
                "id":             v.id,
                "version_code":   v.version_code,
                "name":           v.name,
                "description":    v.description,
                "effective_from": str(v.effective_from),
                "effective_to":   str(v.effective_to) if v.effective_to else None,
                "is_active":      v.is_active,
                "created_at":     v.created_at.isoformat(),
            }
            for v in qs
        ]
        return _ok(data)

    def post(self, request):
        d = request.data
        emp = _get_employee(request)
        try:
            v = AttendancePolicyVersion.objects.create(
                version_code   = d["version_code"],
                name           = d["name"],
                description    = d.get("description", ""),
                effective_from = d["effective_from"],
                effective_to   = d.get("effective_to") or None,
                is_active      = d.get("is_active", False),
                created_by     = emp,
            )
            PolicyLoader.clear_cache()
            return _ok({"id": v.id, "version_code": v.version_code}, status.HTTP_201_CREATED)
        except Exception as exc:
            return _err(str(exc))


class AttendancePolicyVersionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        v = get_object_or_404(AttendancePolicyVersion, pk=pk)
        # Kèm penalty tiers + policy config
        tiers = list(PenaltyTierConfig.objects.filter(version=v).order_by("order").values())
        try:
            cfg = v.policy_config.as_dict()
        except Exception:
            cfg = {}
        return _ok({
            "id": v.id, "version_code": v.version_code, "name": v.name,
            "description": v.description,
            "effective_from": str(v.effective_from),
            "effective_to": str(v.effective_to) if v.effective_to else None,
            "is_active": v.is_active,
            "penalty_tiers": tiers,
            "policy_config": cfg,
        })

    def patch(self, request, pk):
        v = get_object_or_404(AttendancePolicyVersion, pk=pk)
        d = request.data
        for f in ("name", "description", "effective_from", "effective_to"):
            if f in d:
                setattr(v, f, d[f] or None if f == "effective_to" else d[f])
        v.save()
        PolicyLoader.clear_cache()
        return _ok({"id": v.id, "version_code": v.version_code})

    def delete(self, request, pk):
        v = get_object_or_404(AttendancePolicyVersion, pk=pk)
        if v.is_active:
            return _err("Không thể xóa version đang active")
        v.delete()
        PolicyLoader.clear_cache()
        return _ok({"deleted": pk})


class ActivatePolicyVersionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        v = get_object_or_404(AttendancePolicyVersion, pk=pk)
        v.is_active = True
        v.save()   # save() tự deactivate các version khác
        PolicyLoader.clear_cache()
        return _ok({"activated": v.version_code})


# ─────────────────────────────────────────────────────────────────────────────
# 2. PENALTY TIERS
# ─────────────────────────────────────────────────────────────────────────────

class PenaltyTierListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        version_id = request.query_params.get("version_id")
        qs = PenaltyTierConfig.objects.all().order_by("version__effective_from", "order")
        if version_id:
            qs = qs.filter(version_id=version_id)
        data = list(qs.values(
            "id", "version_id", "order", "max_minutes",
            "fine_amount_regular", "fine_amount_manager",
            "deduct_work_credit", "description",
        ))
        return _ok(data)

    def post(self, request):
        d = request.data
        try:
            t = PenaltyTierConfig.objects.create(
                version_id         = d["version_id"],
                order              = d["order"],
                max_minutes        = d.get("max_minutes") or None,
                fine_amount_regular = d.get("fine_amount_regular", 0),
                fine_amount_manager = d.get("fine_amount_manager", 0),
                deduct_work_credit = d.get("deduct_work_credit", 0),
                description        = d.get("description", ""),
            )
            PolicyLoader.clear_cache()
            return _ok({"id": t.id}, status.HTTP_201_CREATED)
        except Exception as exc:
            return _err(str(exc))


class PenaltyTierDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        t = get_object_or_404(PenaltyTierConfig, pk=pk)
        for f in ("order", "max_minutes", "fine_amount_regular", "fine_amount_manager",
                  "deduct_work_credit", "description"):
            if f in request.data:
                setattr(t, f, request.data[f])
        t.save()
        PolicyLoader.clear_cache()
        return _ok({"id": t.id})

    def delete(self, request, pk):
        t = get_object_or_404(PenaltyTierConfig, pk=pk)
        t.delete()
        PolicyLoader.clear_cache()
        return _ok({"deleted": pk})


# ─────────────────────────────────────────────────────────────────────────────
# 3. POLICY CONFIG
# ─────────────────────────────────────────────────────────────────────────────

class AttendancePolicyConfigView(APIView):
    """GET + PUT/PATCH AttendancePolicyConfig cho một version"""
    permission_classes = [IsAuthenticated]

    def get(self, request, version_id):
        v = get_object_or_404(AttendancePolicyVersion, pk=version_id)
        try:
            cfg = v.policy_config
            return _ok(cfg.as_dict())
        except AttendancePolicyConfig.DoesNotExist:
            return _ok({})

    def put(self, request, version_id):
        v = get_object_or_404(AttendancePolicyVersion, pk=version_id)
        d = request.data
        cfg, _ = AttendancePolicyConfig.objects.get_or_create(version=v)
        for f in (
            "max_explanation_quota", "penalty_multiplier_threshold",
            "penalty_multiplier_value", "parking_allowance_per_day",
            "live_prime_time_allowance", "live_prime_start_hour", "live_prime_end_hour",
            "max_live_prime_time_pct", "max_ot_live_pct",
            "incomplete_no_expl_deduction", "incomplete_approved_deduction",
        ):
            if f in d:
                setattr(cfg, f, d[f])
        cfg.save()
        PolicyLoader.clear_cache()
        return _ok(cfg.as_dict())


# ─────────────────────────────────────────────────────────────────────────────
# 4. REGISTRATION REQUEST
# ─────────────────────────────────────────────────────────────────────────────

class RegistrationRequestListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = RegistrationRequest.objects.select_related("employee", "department", "approved_by")

        # Filters
        employee_id    = request.query_params.get("employee_id")
        department_id  = request.query_params.get("department_id")
        request_type   = request.query_params.get("request_type")
        status_filter  = request.query_params.get("status")
        year           = request.query_params.get("year")
        month          = request.query_params.get("month")
        date_str       = request.query_params.get("date")

        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if department_id:
            qs = qs.filter(department_id=department_id)
        if request_type:
            qs = qs.filter(request_type=request_type)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if year:
            qs = qs.filter(registration_date__year=year)
        if month:
            qs = qs.filter(registration_date__month=month)
        if date_str:
            qs = qs.filter(registration_date=date_str)

        data = [
            {
                "id":                r.id,
                "request_code":      r.request_code,
                "employee_id":       r.employee_id,
                "employee_name":     r.employee.full_name,
                "department_id":     r.department_id,
                "department_name":   r.department.name if r.department else None,
                "request_type":      r.request_type,
                "registration_date": str(r.registration_date),
                "start_time":        str(r.start_time),
                "end_time":          str(r.end_time),
                "total_hours":       float(r.total_hours),
                "live_role":         r.live_role,
                "is_prime_time":     r.is_prime_time,
                "reason":            r.reason,
                "status":            r.status,
                "approved_by_name":  r.approved_by.full_name if r.approved_by else None,
                "approved_at":       r.approved_at.isoformat() if r.approved_at else None,
                "created_at":        r.created_at.isoformat(),
            }
            for r in qs.order_by("-registration_date", "-created_at")
        ]
        return _ok(data)

    def post(self, request):
        d   = request.data
        emp = _get_employee(request)
        try:
            employee = Employee.objects.get(id=d["employee_id"])
        except Employee.DoesNotExist:
            return _err(f"Employee {d['employee_id']} không tồn tại")

        dept = None
        if d.get("department_id"):
            try:
                dept = Department.objects.get(id=d["department_id"])
            except Department.DoesNotExist:
                pass
        if not dept:
            dept = employee.department

        # Active policy version
        reg_date = datetime.date.fromisoformat(str(d["registration_date"]))
        cfg      = PolicyLoader.load(reg_date)
        version  = cfg.get("version_obj")

        try:
            rr = RegistrationRequest.objects.create(
                employee          = employee,
                department        = dept,
                request_type      = d["request_type"],
                registration_date = reg_date,
                start_time        = d["start_time"],
                end_time          = d["end_time"],
                total_hours       = d.get("total_hours", 0),
                live_role         = d.get("live_role", ""),
                reason            = d.get("reason", ""),
                notes             = d.get("notes", ""),
                status            = d.get("status", "PENDING"),
                policy_version    = version,
                created_by        = emp,
            )
            return _ok({"id": rr.id, "request_code": rr.request_code}, status.HTTP_201_CREATED)
        except Exception as exc:
            return _err(str(exc))


class RegistrationRequestDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        rr = get_object_or_404(RegistrationRequest, pk=pk)
        return _ok({
            "id":                rr.id,
            "request_code":      rr.request_code,
            "employee_id":       rr.employee_id,
            "employee_name":     rr.employee.full_name,
            "request_type":      rr.request_type,
            "registration_date": str(rr.registration_date),
            "start_time":        str(rr.start_time),
            "end_time":          str(rr.end_time),
            "total_hours":       float(rr.total_hours),
            "live_role":         rr.live_role,
            "is_prime_time":     rr.is_prime_time,
            "reason":            rr.reason,
            "notes":             rr.notes,
            "status":            rr.status,
            "approval_note":     rr.approval_note,
            "approved_by_name":  rr.approved_by.full_name if rr.approved_by else None,
            "approved_at":       rr.approved_at.isoformat() if rr.approved_at else None,
            "policy_version":    rr.policy_version.version_code if rr.policy_version else None,
            "created_at":        rr.created_at.isoformat(),
        })

    def patch(self, request, pk):
        rr = get_object_or_404(RegistrationRequest, pk=pk)
        if rr.status == "APPROVED":
            return _err("Không thể sửa đơn đã duyệt")
        d = request.data
        for f in ("start_time", "end_time", "total_hours", "live_role",
                  "reason", "notes", "registration_date"):
            if f in d:
                setattr(rr, f, d[f])
        rr.save()
        return _ok({"id": rr.id})

    def delete(self, request, pk):
        rr = get_object_or_404(RegistrationRequest, pk=pk)
        if rr.status == "APPROVED":
            return _err("Không thể xóa đơn đã duyệt")
        rr.status = "CANCELLED"
        rr.save()
        return _ok({"cancelled": pk})


class ApproveRegistrationRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        rr  = get_object_or_404(RegistrationRequest, pk=pk)
        emp = _get_employee(request)
        if not emp:
            return _err("Không tìm thấy thông tin nhân viên", status.HTTP_403_FORBIDDEN)
        note = request.data.get("note", "")
        rr.approve(emp)
        if note:
            rr.approval_note = note
            rr.save(update_fields=["approval_note"])
        return _ok({"id": rr.id, "status": "APPROVED"})


class RejectRegistrationRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        rr   = get_object_or_404(RegistrationRequest, pk=pk)
        emp  = _get_employee(request)
        if not emp:
            return _err("Không tìm thấy thông tin nhân viên", status.HTTP_403_FORBIDDEN)
        note = request.data.get("note", "Từ chối")
        rr.reject(emp, note)
        return _ok({"id": rr.id, "status": "REJECTED"})


# ─────────────────────────────────────────────────────────────────────────────
# 5. ONLINE WORK REQUEST
# ─────────────────────────────────────────────────────────────────────────────

class OnlineWorkRequestListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = OnlineWorkRequest.objects.select_related("employee", "approved_by")

        employee_id   = request.query_params.get("employee_id")
        status_filter = request.query_params.get("status")
        year          = request.query_params.get("year")
        month         = request.query_params.get("month")

        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if status_filter:
            qs = qs.filter(status=status_filter)
        if year:
            qs = qs.filter(work_date__year=year)
        if month:
            qs = qs.filter(work_date__month=month)

        data = [
            {
                "id":            r.id,
                "request_code":  r.request_code,
                "employee_id":   r.employee_id,
                "employee_name": r.employee.full_name,
                "work_date":     str(r.work_date),
                "reason":        r.reason,
                "status":        r.status,
                "approved_by":   r.approved_by.full_name if r.approved_by else None,
                "approved_at":   r.approved_at.isoformat() if r.approved_at else None,
                "created_at":    r.created_at.isoformat(),
            }
            for r in qs.order_by("-work_date")
        ]
        return _ok(data)

    def post(self, request):
        d   = request.data
        emp = _get_employee(request)
        try:
            employee = Employee.objects.get(id=d["employee_id"])
        except Employee.DoesNotExist:
            return _err(f"Employee {d['employee_id']} không tồn tại")

        work_date = datetime.date.fromisoformat(str(d["work_date"]))
        cfg       = PolicyLoader.load(work_date)
        version   = cfg.get("version_obj")

        try:
            ow = OnlineWorkRequest.objects.create(
                employee       = employee,
                work_date      = work_date,
                reason         = d.get("reason", ""),
                status         = d.get("status", "PENDING"),
                policy_version = version,
            )
            return _ok({"id": ow.id, "request_code": ow.request_code}, status.HTTP_201_CREATED)
        except Exception as exc:
            return _err(str(exc))


class OnlineWorkRequestDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        ow = get_object_or_404(OnlineWorkRequest, pk=pk)
        return _ok({
            "id":            ow.id,
            "request_code":  ow.request_code,
            "employee_id":   ow.employee_id,
            "employee_name": ow.employee.full_name,
            "work_date":     str(ow.work_date),
            "reason":        ow.reason,
            "status":        ow.status,
            "approval_note": ow.approval_note,
            "approved_by":   ow.approved_by.full_name if ow.approved_by else None,
            "approved_at":   ow.approved_at.isoformat() if ow.approved_at else None,
        })

    def delete(self, request, pk):
        ow = get_object_or_404(OnlineWorkRequest, pk=pk)
        if ow.status == "APPROVED":
            return _err("Không thể xóa đơn đã duyệt")
        ow.status = "CANCELLED"
        ow.save()
        return _ok({"cancelled": pk})


class ApproveOnlineWorkRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        ow  = get_object_or_404(OnlineWorkRequest, pk=pk)
        emp = _get_employee(request)
        if not emp:
            return _err("Không tìm thấy nhân viên", status.HTTP_403_FORBIDDEN)
        ow.approve(emp)
        return _ok({"id": ow.id, "status": "APPROVED"})


class RejectOnlineWorkRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        ow   = get_object_or_404(OnlineWorkRequest, pk=pk)
        emp  = _get_employee(request)
        if not emp:
            return _err("Không tìm thấy nhân viên", status.HTTP_403_FORBIDDEN)
        note = request.data.get("note", "Từ chối")
        ow.reject(emp, note)
        return _ok({"id": ow.id, "status": "REJECTED"})


# ─────────────────────────────────────────────────────────────────────────────
# 6. MONTHLY SUMMARY  (preview – không lưu)
# ─────────────────────────────────────────────────────────────────────────────

class MonthlySummaryView(APIView):
    """
    GET /monthly-summary/<employee_id>/<year>/<month>/
    Tính toán và trả về tóm tắt công tháng (KHÔNG lưu vào DB).
    Dùng để preview trước khi chốt.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, employee_id, year, month):
        employee = get_object_or_404(Employee, pk=employee_id)

        engine  = HRMAttendanceEngine()
        try:
            # Engine tự query EmployeeEvent cho registrations, online, explanations, leaves
            summary = engine.calculate_monthly_summary(
                employee        = employee,
                year            = int(year),
                month           = int(month),
                persist_events  = False,  # preview only
            )
            return _ok(summary)
        except Exception as exc:
            return _err(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────────────────────────
# 7. FINALIZE (chốt công – lưu vào MonthlyWorkCredit)
# ─────────────────────────────────────────────────────────────────────────────

class FinalizeWorkCreditView(APIView):
    """
    POST /finalize/<employee_id>/<year>/<month>/
    Tính toán và LƯU MonthlyWorkCredit.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, employee_id, year, month):
        employee  = get_object_or_404(Employee, pk=employee_id)
        requester = _get_employee(request)

        engine = HRMAttendanceEngine()
        try:
            # Engine tự query EmployeeEvent cho registrations, online, explanations, leaves
            summary = engine.calculate_monthly_summary(
                employee        = employee,
                year            = int(year),
                month           = int(month),
                persist_events  = True,
            )
            wc = engine.save_monthly_work_credit(
                employee    = employee,
                year        = int(year),
                month       = int(month),
                summary     = summary,
                created_by  = requester,
            )
            return _ok({
                "work_credit_id":       wc.id,
                "col14_actual_credit":  summary.get("col14_actual_work_credit"),
                "total_penalty_vnd":    summary.get("total_penalty_vnd"),
                "total_parking":        summary.get("total_parking_allowance"),
                "total_live_allowance": summary.get("total_live_allowance"),
                "total_ot_hours":       summary.get("total_overtime_hours"),
                "policy_version":       summary.get("policy_version"),
            })
        except Exception as exc:
            return _err(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────────────────────────
# 8. DEPARTMENT BATCH FINALIZE
# ─────────────────────────────────────────────────────────────────────────────

class FinalizeDepartmentView(APIView):
    """
    POST /finalize-department/<department_id>/<year>/<month>/
    Chốt công cho toàn bộ nhân viên của một phòng ban.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, department_id, year, month):
        dept      = get_object_or_404(Department, pk=department_id)
        requester = _get_employee(request)

        batch = DepartmentAttendanceBatchEngine()
        try:
            results = batch.process_department_month(
                department = dept,
                year       = int(year),
                month      = int(month),
                created_by = requester,
            )
            return _ok(results)
        except Exception as exc:
            return _err(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)


# ─────────────────────────────────────────────────────────────────────────────
# 9. PENALTY PREVIEW
# ─────────────────────────────────────────────────────────────────────────────

class PenaltyPreviewView(APIView):
    """
    POST /penalty-preview/
    Body: {late_minutes, early_minutes, violation_count_month, is_manager, date (opt)}
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        d = request.data
        date_str = d.get("date")
        date     = datetime.date.fromisoformat(date_str) if date_str else None
        try:
            result = calculate_penalty_preview(
                late_minutes         = int(d.get("late_minutes", 0)),
                early_minutes        = int(d.get("early_minutes", 0)),
                violation_count_month = int(d.get("violation_count_month", 1)),
                is_manager           = bool(d.get("is_manager", False)),
                date                 = date,
            )
            return _ok(result)
        except Exception as exc:
            return _err(str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# 10. LIVE SESSION CHECK
# ─────────────────────────────────────────────────────────────────────────────

class LiveSessionCheckView(APIView):
    """
    POST /live-check/
    Body: {start_time, session_hours, current_prime_sessions, total_team_live, date (opt)}
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        d = request.data
        date_str = d.get("date")
        date     = datetime.date.fromisoformat(date_str) if date_str else None
        try:
            result = check_live_session_eligibility(
                start_time_str       = str(d.get("start_time", "21:00")),
                session_hours        = float(d.get("session_hours", 2)),
                current_prime_sessions = int(d.get("current_prime_sessions", 0)),
                total_team_live      = int(d.get("total_team_live", 0)),
                date                 = date,
            )
            return _ok(result)
        except Exception as exc:
            return _err(str(exc))


# ─────────────────────────────────────────────────────────────────────────────
# 11. EVENT LOG
# ─────────────────────────────────────────────────────────────────────────────

class AttendanceEventLogListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = AttendanceEventLog.objects.select_related("employee", "policy_version")

        employee_id  = request.query_params.get("employee_id")
        event_type   = request.query_params.get("event_type")
        year         = request.query_params.get("year")
        month        = request.query_params.get("month")
        version_code = request.query_params.get("version_code")
        page         = int(request.query_params.get("page", 1))
        page_size    = min(int(request.query_params.get("page_size", 50)), 200)

        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        if event_type:
            qs = qs.filter(event_type=event_type)
        if year:
            qs = qs.filter(event_date__year=year)
        if month:
            qs = qs.filter(event_date__month=month)
        if version_code:
            qs = qs.filter(rule_version_code=version_code)

        total  = qs.count()
        offset = (page - 1) * page_size
        items  = qs.order_by("-event_date", "-event_timestamp")[offset:offset + page_size]

        data = [
            {
                "event_id":         str(ev.event_id),
                "event_type":       ev.event_type,
                "employee_id":      ev.employee_id,
                "employee_name":    ev.employee.full_name,
                "event_date":       str(ev.event_date),
                "rule_version":     ev.rule_version_code,
                "rule_result":      ev.rule_result,
                "created_at":       ev.created_at.isoformat(),
            }
            for ev in items
        ]
        return _ok({"total": total, "page": page, "page_size": page_size, "results": data})


# ─────────────────────────────────────────────────────────────────────────────
# 12. EVENT REPLAY
# ─────────────────────────────────────────────────────────────────────────────

class EventReplayView(APIView):
    """
    POST /event-replay/<employee_id>/
    Body: {start_date, end_date}
    Replay tất cả events với engine / policy hiện tại.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, employee_id):
        d = request.data
        try:
            start = datetime.date.fromisoformat(d["start_date"])
            end   = datetime.date.fromisoformat(d["end_date"])
        except (KeyError, ValueError) as exc:
            return _err(f"start_date / end_date không hợp lệ: {exc}")

        engine = HRMAttendanceEngine()
        results = engine.event_store.replay(
            employee_id = int(employee_id),
            start_date  = start,
            end_date    = end,
        )
        return _ok({"replayed_events": len(results), "results": results})


# ─────────────────────────────────────────────────────────────────────────────
# 13. LIVESTREAM SESSION CONFIG
# ─────────────────────────────────────────────────────────────────────────────

class LivestreamSessionConfigListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = LivestreamSessionConfig.objects.select_related(
            "department", "ot_override_approved_by", "policy_version"
        )
        dept_id = request.query_params.get("department_id")
        year    = request.query_params.get("year")
        month   = request.query_params.get("month")
        if dept_id:
            qs = qs.filter(department_id=dept_id)
        if year:
            qs = qs.filter(year=year)
        if month:
            qs = qs.filter(month=month)

        data = [
            {
                "id":                     c.id,
                "department_id":          c.department_id,
                "department_name":        c.department.name,
                "year":                   c.year,
                "month":                  c.month,
                "total_planned_sessions": c.total_planned_sessions,
                "max_prime_time_override": c.max_prime_time_override,
                "ot_override_approved":   c.ot_override_approved,
                "ot_override_note":       c.ot_override_note,
                "policy_version":         c.policy_version.version_code if c.policy_version else None,
            }
            for c in qs.order_by("-year", "-month")
        ]
        return _ok(data)

    def post(self, request):
        d         = request.data
        emp       = _get_employee(request)
        dept      = get_object_or_404(Department, pk=d["department_id"])
        year      = int(d["year"])
        month     = int(d["month"])
        first_day = datetime.date(year, month, 1)
        ver       = PolicyLoader.load(first_day).get("version_obj")

        try:
            cfg, created = LivestreamSessionConfig.objects.get_or_create(
                department=dept, year=year, month=month,
                defaults={
                    "total_planned_sessions": d.get("total_planned_sessions", 0),
                    "max_prime_time_override": d.get("max_prime_time_override") or None,
                    "policy_version":          ver,
                }
            )
            if not created:
                cfg.total_planned_sessions = d.get("total_planned_sessions", cfg.total_planned_sessions)
                if "max_prime_time_override" in d:
                    cfg.max_prime_time_override = d["max_prime_time_override"] or None
                cfg.save()
            return _ok({"id": cfg.id}, status.HTTP_201_CREATED if created else status.HTTP_200_OK)
        except Exception as exc:
            return _err(str(exc))


class LivestreamSessionConfigDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        cfg = get_object_or_404(LivestreamSessionConfig, pk=pk)
        d   = request.data
        for f in ("total_planned_sessions", "max_prime_time_override",
                  "ot_override_approved", "ot_override_note"):
            if f in d:
                setattr(cfg, f, d[f])
        if d.get("ot_override_approved"):
            emp = _get_employee(request)
            cfg.ot_override_approved_by = emp
            cfg.ot_override_approved_at = timezone.now()
        cfg.save()
        return _ok({"id": cfg.id})


# ─────────────────────────────────────────────────────────────────────────────
# 14. SHIFT ASSIGNMENT  (Gán ca làm việc cho nhân viên / phòng ban)
# ─────────────────────────────────────────────────────────────────────────────

class ShiftAssignmentView(APIView):
    """
    POST /shift-assignment/
    Body:
      {
        "shift_id": 1,
        "employee_ids": [1, 2, 3],       ← chọn một trong hai
        "department_id": 5,              ← hoặc toàn phòng ban
        "effective_from": "2024-08-01",
        "effective_to":   "2024-08-31"   ← optional
      }
    Gán ShiftConfig cho nhân viên / phòng ban. Nếu truyền cả hai thì employee_ids ưu tiên.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        d       = request.data
        shift   = get_object_or_404(ShiftConfig, pk=d["shift_id"])
        emp_ids = d.get("employee_ids", [])
        dept_id = d.get("department_id")

        if emp_ids:
            employees = Employee.objects.filter(id__in=emp_ids)
        elif dept_id:
            employees = Employee.objects.filter(department_id=dept_id, employment_status="ACTIVE")
        else:
            return _err("Phải cung cấp employee_ids hoặc department_id")

        # effective dates
        eff_from = datetime.date.fromisoformat(d["effective_from"]) if d.get("effective_from") else None
        eff_to   = datetime.date.fromisoformat(d["effective_to"])   if d.get("effective_to")   else None

        if eff_from:
            shift.effective_from = eff_from
        if eff_to:
            shift.effective_to = eff_to

        # ManyToMany assignment
        shift.apply_to_employees.add(*employees)
        shift.save()

        return _ok({
            "shift_id":    shift.id,
            "shift_name":  shift.name,
            "assigned_to": [e.id for e in employees],
            "count":       employees.count(),
        })

    def delete(self, request):
        """Gỡ bỏ ca làm việc khỏi nhân viên / phòng ban."""
        d       = request.data
        shift   = get_object_or_404(ShiftConfig, pk=d["shift_id"])
        emp_ids = d.get("employee_ids", [])
        dept_id = d.get("department_id")

        if emp_ids:
            employees = Employee.objects.filter(id__in=emp_ids)
        elif dept_id:
            employees = Employee.objects.filter(department_id=dept_id)
        else:
            return _err("Phải cung cấp employee_ids hoặc department_id")

        shift.apply_to_employees.remove(*employees)
        return _ok({"removed": [e.id for e in employees]})

    def get(self, request):
        """Lấy danh sách ca làm việc đang được gán cho nhân viên hoặc phòng ban."""
        emp_id  = request.query_params.get("employee_id")
        dept_id = request.query_params.get("department_id")

        qs = ShiftConfig.objects.filter(is_active=True)
        if emp_id:
            qs = qs.filter(
                Q(apply_to_employees__id=emp_id) |
                Q(apply_to_departments__employees__id=emp_id) |
                Q(apply_to_all=True)
            ).distinct()
        elif dept_id:
            qs = qs.filter(
                Q(apply_to_departments__id=dept_id) | Q(apply_to_all=True)
            ).distinct()

        data = [
            {
                "id":            s.id,
                "name":          s.name,
                "code":          s.code,
                "shift_type":    s.shift_type,
                "apply_scope":   s.apply_scope,
                "apply_scope_display": s.get_apply_scope_display() if s.apply_scope else None,
                "start_time":    str(s.start_time),
                "end_time":      str(s.end_time),
                "working_hours": float(s.working_hours or 0),
                "effective_from": str(s.effective_from) if s.effective_from else None,
                "effective_to":   str(s.effective_to)   if s.effective_to   else None,
                "is_default":    s.is_default,
            }
            for s in qs.order_by("start_time")
        ]
        return _ok(data)


class ShiftConfigForDepartmentView(APIView):
    """
    GET /shifts/department/<dept_id>/
    Trả về tất cả ca đang áp dụng cho phòng ban (kể cả ca chung apply_to_all).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, dept_id):
        dept = get_object_or_404(Department, pk=dept_id)
        today = datetime.date.today()

        qs = ShiftConfig.objects.filter(is_active=True).filter(
            Q(apply_to_departments=dept) | Q(apply_to_all=True)
        ).filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today)
        ).filter(
            Q(effective_to__isnull=True)   | Q(effective_to__gte=today)
        ).distinct().order_by("start_time")

        data = [
            {
                "id":            s.id,
                "name":          s.name,
                "code":          s.code,
                "shift_type":    s.shift_type,
                "apply_scope":   s.apply_scope,
                "apply_scope_display": s.get_apply_scope_display() if s.apply_scope else None,
                "start_time":    str(s.start_time),
                "end_time":      str(s.end_time),
                "working_hours": float(s.working_hours or 0),
                "is_default":    s.is_default,
            }
            for s in qs
        ]
        return _ok({"department": dept.name, "shifts": data})


class ShiftConfigForEmployeeView(APIView):
    """
    GET /shifts/employee/<emp_id>/
    Trả về ca của một nhân viên cụ thể (ưu tiên: cá nhân > vị trí > phòng ban > chung).
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, emp_id):
        employee = get_object_or_404(Employee, pk=emp_id)
        today    = datetime.date.today()

        def active_filter(qs):
            return qs.filter(is_active=True).filter(
                Q(effective_from__isnull=True) | Q(effective_from__lte=today)
            ).filter(
                Q(effective_to__isnull=True) | Q(effective_to__gte=today)
            )

        # 1. Gán cụ thể cho cá nhân
        personal = active_filter(
            ShiftConfig.objects.filter(apply_to_employees=employee)
        )
        # 2. Gán theo vị trí
        position_shifts = active_filter(
            ShiftConfig.objects.filter(apply_to_positions=employee.position)
        ) if employee.position else ShiftConfig.objects.none()
        # 3. Gán theo phòng ban
        dept_shifts = active_filter(
            ShiftConfig.objects.filter(apply_to_departments=employee.department)
        ) if employee.department else ShiftConfig.objects.none()
        # 4. Ca chung
        all_shifts = active_filter(ShiftConfig.objects.filter(apply_to_all=True))

        # Merge (theo ưu tiên)
        combined = (personal | position_shifts | dept_shifts | all_shifts).distinct().order_by("start_time")

        def serialize(s):
            return {
                "id":            s.id,
                "name":          s.name,
                "code":          s.code,
                "shift_type":    s.shift_type,
                "apply_scope":   s.apply_scope,
                "apply_scope_display": s.get_apply_scope_display() if s.apply_scope else None,
                "start_time":    str(s.start_time),
                "end_time":      str(s.end_time),
                "working_hours": float(s.working_hours or 0),
                "is_default":    s.is_default,
                "scope": (
                    "personal" if s in personal
                    else "position" if s in position_shifts
                    else "department" if s in dept_shifts
                    else "company"
                ),
            }

        return _ok({
            "employee_id":   employee.id,
            "employee_name": employee.full_name,
            "shifts":        [serialize(s) for s in combined],
        })


# ─────────────────────────────────────────────────────────────────────────────
# 15. ACTIVE POLICY (quick endpoint)
# ─────────────────────────────────────────────────────────────────────────────

class ActivePolicyView(APIView):
    """GET /active-policy/ – Trả về chính sách đang active và bảng phạt."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        date_str = request.query_params.get("date")
        date     = datetime.date.fromisoformat(date_str) if date_str else datetime.date.today()
        cfg      = PolicyLoader.load(date)
        return _ok({
            "version_code":  cfg["version_code"],
            "policy":        cfg["policy"],
            "penalty_tiers": [
                {
                    "max_minutes":          t[0],
                    "fine_regular_vnd":     t[1],
                    "fine_manager_vnd":     t[2],
                    "work_deduction":       t[3],
                }
                for t in cfg["penalty_tiers"]
            ],
        })


# ─────────────────────────────────────────────────────────────────────────────
# 16. ATTENDANCE CALENDAR VIEW
# ─────────────────────────────────────────────────────────────────────────────

# Màu trạng thái cho frontend calendar
_ATTENDANCE_STATUS_COLOR = {
    "PRESENT": "green",
    "LATE": "yellow",
    "EARLY_LEAVE": "yellow",
    "LATE_EARLY": "yellow",
    "ABSENT": "red",
    "HALF_DAY": "orange",
    "INCOMPLETE_ATTENDANCE": "purple",
}

_ATTENDANCE_STATUS_DISPLAY = {
    "PRESENT": "Đủ công",
    "LATE": "Đi muộn",
    "EARLY_LEAVE": "Về sớm",
    "LATE_EARLY": "Đi muộn/Về sớm",
    "ABSENT": "Vắng mặt",
    "HALF_DAY": "Nửa công",
    "INCOMPLETE_ATTENDANCE": "Quên chấm công",
    "EMPTY": "Trống",
}

_DAY_STATUS_LEGEND = {
    # day_status  →  nhãn tiếng Việt + màu (frontend dùng để render dot)
    "FULL":       {"label": "Đủ công",   "color": "green"},
    "HALF":       {"label": "Nửa công",  "color": "orange"},
    "ABSENT":     {"label": "Vắng",      "color": "red"},
    "LATE_EARLY": {"label": "Muộn/Sớm", "color": "yellow"},
    "FORGOT_CC":  {"label": "Quên CC",   "color": "purple"},
    "LEAVE":      {"label": "Nghỉ",      "color": "gray"},
    "HOLIDAY":    {"label": "Lễ",        "color": "blue"},
    "EMPTY":      {"label": "Trống",     "color": "light-blue"},
    "UNAUTHORIZED_ABSENCE": {"label": "Nghỉ không phép", "color": "dark-red"},
}

_SHIFT_ORDER    = ["MORNING", "AFTERNOON", "EVENING"]
_SHIFT_LABELS   = {"MORNING": "Sáng", "AFTERNOON": "Chiều", "EVENING": "Tối"}
_WEEKDAY_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]


def _get_status_color(status: str) -> str:
    return _ATTENDANCE_STATUS_COLOR.get(status, "gray")


class AttendanceCalendarView(APIView):
    """
    GET /attendance/calendar-view/?year=2026&month=2[&employee_id=1]

    Trả về toàn bộ dữ liệu lịch chấm công trong tháng.

    Kiến trúc:
    ─ Sử dụng EmployeeState.replay_month() (main_api.py) để tính toán
      nghiệp vụ (penalty, công, OT, live, parking…).
      replay_month đọc EmployeeEvent và áp dụng rule engine theo từng event.

    ─ Đồng thời truy vấn EmployeeEvent để hiển thị ca làm việc và các
      đăng ký (overtime, leave_request, livestream, explanation) trên calendar.

    Response shape:
    {
      "year", "month",
      "employee": {id, employee_id, full_name},
      "summary": {              ← UI counters (từ EmployeeState.state)
          total_work_days, full_days, half_days, late_or_early_days,
          absent_days, forgot_checkin_days,
          overtime_hours, extra_hours, night_shift_sessions,
          live_sessions, leave_days,
          unauthorized_absence_days  ← số ngày có "Đơn nghỉ không phép" đã
                                        được duyệt trong tháng
      },
      "engine_summary": {       ← nghiệp vụ từ EmployeeState.replay_month
          total_penalty_vnd, total_parking_allowance, total_live_allowance,
          explanation_quota_used, events_processed
      },
      "legend": [...],
      "calendar": [
        {
          date, day, weekday, weekday_label, is_weekend,
          is_holiday, holiday_name, is_leave,
          day_status, status_badge,
          engine_context: {     ← từ aggregated delta/effects của replay_month
              is_holiday, is_leave_day, is_absent, is_incomplete,
              work_credit, penalty_amount,
              overtime_hours, extra_hours, night_shift_sessions,
              live_sessions, rules_applied
          },
          shifts: [{shift_type, shift_label, check_in, check_out,
                    status, status_color}],
          registrations: [...]  ← EmployeeEvent non-attendance records
        }, ...
      ],
      "total_days_in_month": 28
    }
    """
    permission_classes = [IsAuthenticated]

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_holiday_map(year: int, month: int) -> dict:
        """Dict {date: holiday_name} cho tháng/năm đang xét."""
        from .models import HolidayConfig
        holiday_map: dict[datetime.date, str] = {}
        for h in HolidayConfig.objects.filter(is_active=True):
            hd = h.holiday_date
            if h.is_recurring:
                if hd.month == month:
                    try:
                        holiday_map[datetime.date(year, hd.month, hd.day)] = h.name
                    except ValueError:
                        pass
            elif hd.year == year and hd.month == month:
                holiday_map[hd] = h.name
        return holiday_map

    @staticmethod
    def _build_leave_dates(leaves, first_day, last_day) -> dict:
        """Dict {date: tên loại nghỉ} cho các ngày nghỉ đã duyệt trong tháng."""
        leave_dates: dict[datetime.date, str] = {}
        for lv in leaves:
            cur = max(lv.start_date, first_day)
            end = min(lv.end_date,   last_day)
            while cur <= end:
                leave_dates[cur] = (
                    lv.get_leave_type_display()
                    if hasattr(lv, "get_leave_type_display")
                    else lv.leave_type
                )
                cur += datetime.timedelta(days=1)
        return leave_dates

    @staticmethod
    def _day_status_from_detail(
        detail: dict,
        day_atts: list,
        leave_dates: dict,
        holiday_map: dict,
        date: datetime.date,
    ):
        """
        Map daily_detail (từ engine.calculate_monthly_summary) + raw Attendance
        records → (day_status, status_badge) cho calendar display.

        Ưu tiên:
          1. Nếu có Attendance records → dùng engine detail + status từ model
          2. Không có Attendance → nghỉ phép / lễ / trống
        """
        if day_atts:
            if detail.get("is_absent"):
                return "ABSENT", "Vắng mặt"
            if detail.get("is_incomplete"):
                return "FORGOT_CC", "Quên chấm công"

            statuses = [a.status for a in day_atts]
            if "HALF_DAY" in statuses:
                return "HALF", None
            if "LATE" in statuses or "EARLY_LEAVE" in statuses:
                return "LATE_EARLY", None
            if "PRESENT" in statuses:
                return "FULL", None
            return "EMPTY", None

        # Không có Attendance – tra cứu từ engine detail
        if detail.get("is_leave_day"):
            return "LEAVE", leave_dates.get(date)
        if detail.get("is_holiday"):
            return "HOLIDAY", holiday_map.get(date)
        return "EMPTY", None

    @staticmethod
    def _find_unauthorized_absence_event(day_events: list, allowed_statuses=("APPROVED",)):
        """Đơn Nghỉ không phép của ngày có trạng thái thuộc allowed_statuses —
        bỏ qua đơn bị từ chối/đã huỷ đứng trước trong danh sách (case NV80033
        10/9/2026: đơn REJECTED che mất đơn APPROVED tạo lại → ngày hiện "Nửa công")."""
        from .event_models import EmployeeEvent as EmpEvent
        return next(
            (
                e for e in day_events
                if e.event_type == EmpEvent.EventType.UNAUTHORIZED_ABSENCE
                and ((e.data or {}).get("status") or "").upper() in allowed_statuses
            ),
            None,
        )

    @staticmethod
    def _unauthorized_absence_amount(day_events: list, allowed_statuses=("APPROVED",)) -> float:
        """Số ngày nghỉ không phép của 1 ngày đã được xác định là
        UNAUTHORIZED_ABSENCE: 0.5 nếu đơn nửa ngày (HALF_DAY), ngược lại 1."""
        from .event_models import EmployeeEvent as EmpEvent
        ev = AttendanceCalendarView._find_unauthorized_absence_event(day_events, allowed_statuses) or next(
            (e for e in day_events if e.event_type == EmpEvent.EventType.UNAUTHORIZED_ABSENCE),
            None,
        )
        if ev and (ev.data or {}).get("expected_status") == "HALF_DAY":
            return 0.5
        return 1.0

    # Ngày có vi phạm ở buổi đi làm còn lại (đi muộn/về sớm/quên chấm công/vắng)
    # được ưu tiên hiển thị hơn "Nghỉ không phép", nhưng đơn KP đã duyệt vẫn phải
    # được đếm (case NV80037 19/9/2026: sáng đi muộn có giải trình, chiều nghỉ
    # không phép → bộ đếm bỏ sót 0.5 ngày).
    _KP_COUNTED_WITH_VIOLATION_STATUSES = ("LATE", "EARLY_LEAVE", "LATE_EARLY", "FORGOT_CC", "ABSENT")

    @staticmethod
    def _unauthorized_absence_days(day_status: str, day_events: list, include_pending: bool = False) -> float:
        """Số ngày nghỉ không phép của 1 ngày cho bộ đếm tháng — dùng chung cho
        lịch chấm công và bảng chốt công để 2 nơi luôn khớp nhau.

          - Ngày "Nghỉ không phép" hoặc ngày có vi phạm ở buổi còn lại → theo đơn
            (0.5 nếu nửa ngày, 1 nếu cả ngày).
          - Ngày nghỉ phép / làm online → chỉ đơn nửa ngày (0.5): buổi kia là phép/online.
          - Ngày lễ, ngày không có đơn hợp lệ → 0.
        """
        allowed = ("APPROVED", "PENDING") if include_pending else ("APPROVED",)
        ev = AttendanceCalendarView._find_unauthorized_absence_event(day_events, allowed)
        if ev is None:
            return 0.0
        amount = 0.5 if (ev.data or {}).get("expected_status") == "HALF_DAY" else 1.0
        if day_status == "UNAUTHORIZED_ABSENCE" or day_status in AttendanceCalendarView._KP_COUNTED_WITH_VIOLATION_STATUSES:
            return amount
        if day_status in ("LEAVE", "ONLINE_WORK") and amount == 0.5:
            return 0.5
        return 0.0

    @staticmethod
    def _day_status_from_events_data(
        agg_delta: dict,
        agg_effects: dict,
        day_events: list,
        holiday_map: dict,
        date,
        shift_configs: list = None,
        include_pending_unauthorized_absence: bool = False,
    ):
        """
        Derive (day_status, status_badge) from aggregated deltas produced by
        EmployeeState.replay_month() and the raw EmployeeEvent records.

        Priority order:
          1. Absent (vang_mat)
          2. Forgot check-in (quen_cham_cong)
          3. Leave (nghi_phep / nghi_khong_luong / LEAVE_REQUEST event)
          4. Late / early leave (di_muon_ve_som)
          5. Ra trực / Online work đã duyệt
          6. Nghỉ không phép (có "Đơn nghỉ không phép" đã được duyệt cho đúng
             ngày này — không tự suy luận từ việc thiếu dữ liệu nữa, để xử lý
             được cả trường hợp ngày Chủ nhật/ngày nghỉ bù bất kỳ)
          7. Full day (nua_ngay_cong >= 1.0 or ngay_du_cong > 0)
          8. Half day (any nua_ngay_cong > 0)
          9. Holiday
          10. Empty
        """
        from .event_models import EmployeeEvent as EmpEvent

        vang_mat = agg_delta.get("vang_mat", 0)
        total_work_credits = agg_delta.get("nua_ngay_cong", 0.0) + agg_delta.get(
            "ngay_du_cong", 0.0
        )

        if vang_mat > 0 and total_work_credits == 0:
            return "ABSENT", "Vắng mặt"

        if agg_delta.get("quen_cham_cong", 0) > 0:
            return "FORGOT_CC", "Quên chấm công"

        is_leave = (
            agg_delta.get("nghi_phep", 0) > 0
            or agg_delta.get("nghi_khong_luong", 0) > 0
            or any(
                (ev.event_type == EmpEvent.EventType.LEAVE_REQUEST
                 or (ev.event_type == EmpEvent.EventType.EXPLANATION and (ev.data or {}).get('explanation_type') == 'LEAVE'))
                and (ev.data or {}).get('status', '').upper() in ('APPROVED', 'PENDING')
                for ev in day_events
            )
        )
        if is_leave:
            # Tìm event nghỉ phép đã duyệt/chờ duyệt để lấy notes làm badge
            leave_ev = next(
                (
                    ev
                    for ev in day_events
                    if (ev.event_type == EmpEvent.EventType.LEAVE_REQUEST
                        or (ev.event_type == EmpEvent.EventType.EXPLANATION and (ev.data or {}).get('explanation_type') == 'LEAVE'))
                    and (ev.data or {}).get('status', '').upper() in ('APPROVED', 'PENDING')
                ),
                None,
            )
            badge = (
                leave_ev.notes if leave_ev and leave_ev.notes else 
                (leave_ev.explanation if leave_ev and hasattr(leave_ev, 'explanation') else None)
            ) or "Nghỉ phép"
            return "LEAVE", badge

        # Nếu bị trừ công hoặc có vi phạm đi muộn / về sớm
        if agg_delta.get("di_muon_ve_som", 0) > 0 or (
            vang_mat > 0 and total_work_credits > 0
        ):
            late_mins = int(agg_effects.get("late_minutes", 0))
            early_mins = int(agg_effects.get("early_leave_minutes", 0))

            # Nếu engine không trả về phút cụ thể (có thể do tính vào vắng mặt theo ca)
            # thì tự tính từ ATTENDANCE event để hiển thị đúng badge
            if late_mins == 0 and early_mins == 0 and shift_configs:
                att_ev = next(
                    (
                        ev
                        for ev in day_events
                        if ev.event_type == EmpEvent.EventType.ATTENDANCE
                    ),
                    None,
                )
                if att_ev and (att_ev.check_in or att_ev.check_out):
                    try:
                        s = min(sc.start_time for sc in shift_configs if sc.start_time)
                        e = max(sc.end_time for sc in shift_configs if sc.end_time)
                        if att_ev.check_in and att_ev.check_in > s:
                            late_mins = (
                                datetime.datetime.combine(date, att_ev.check_in)
                                - datetime.datetime.combine(date, s)
                            ).seconds // 60
                        if att_ev.check_out and att_ev.check_out < e:
                            early_mins = (
                                datetime.datetime.combine(date, e)
                                - datetime.datetime.combine(date, att_ev.check_out)
                            ).seconds // 60
                    except Exception:
                        pass  # ensure reliability

            # Resolve LATE_EARLY if both violations exist, or pick the specific one
            if late_mins > 0 and early_mins > 0:
                badge_text = "Đi muộn/Về sớm"
                status_val = "LATE_EARLY"
            elif late_mins > 0:
                badge_text = "Đi muộn"
                status_val = "LATE"
            elif early_mins > 0:
                badge_text = "Về sớm"
                status_val = "EARLY_LEAVE"
            else:
                # Fallback if somehow both are 0 but engine flagged violation
                badge_text = "Đi muộn/Về sớm"
                status_val = "LATE_EARLY"

            return status_val, badge_text
        # Kiểm tra đơn Ra trực
        off_duty_ev = next(
            (ev for ev in day_events if ev.event_type == EmpEvent.EventType.OFF_DUTY),
            None
        )
        if off_duty_ev:
            ev_data = off_duty_ev.data or {}
            if ev_data.get("status") == "APPROVED":
                return "FULL", "Đã duyệt ra trực"

        # Kiểm tra đơn Nghỉ không phép — chỉ tính khi có đơn (nhân viên/QLTT/HR
        # tạo đơn, không tự suy luận từ việc thiếu dữ liệu nữa), áp dụng cho MỌI
        # ngày kể cả Chủ nhật/ngày nghỉ bù để xử lý được trường hợp lịch làm việc
        # không cố định.
        #
        # include_pending_unauthorized_absence=True (lịch chấm công đang xem
        # trực tiếp — AttendanceCalendarView.get()): nhận cả PENDING lẫn
        # APPROVED, giống hệt pattern của nhánh "Nghỉ phép" (is_leave) phía
        # trên — trước đây chỉ nhận APPROVED, khiến ngày có đơn đang chờ duyệt
        # rơi xuống "EMPTY"/"Chưa có dữ liệu" thay vì được đánh dấu; badge "Chờ
        # duyệt" cụ thể do FE tự hiển thị đè lên (has_pending_request).
        #
        # Mặc định False (chỉ nhận APPROVED) — dùng cho bảng CHỐT CÔNG đã khoá
        # (finalization_views._build_daily_summary): 1 ngày CHƯA được quyết
        # định (còn PENDING) không nên bị tính thẳng thành "KP" (0 công) trong
        # bảng lương/chốt công, tránh sai nếu đơn sau đó bị từ chối.
        allowed_statuses = ("APPROVED", "PENDING") if include_pending_unauthorized_absence else ("APPROVED",)
        unauthorized_absence_ev = AttendanceCalendarView._find_unauthorized_absence_event(day_events, allowed_statuses)
        if unauthorized_absence_ev:
            ev_data = unauthorized_absence_ev.data or {}
            badge = "Nghỉ không phép"
            if ev_data.get("expected_status") == "HALF_DAY":
                half = (ev_data.get("half_day_period") or "").upper()
                if half == "MORNING":
                    badge = "Nghỉ không phép (sáng)"
                elif half == "AFTERNOON":
                    badge = "Nghỉ không phép (chiều)"
                else:
                    # Đơn cũ tạo trước khi có half_day_period — không rõ buổi.
                    badge = "Nghỉ không phép (nửa ngày)"
            return "UNAUTHORIZED_ABSENCE", badge

        # Kiểm tra đơn làm việc online
        online_ev = next(
            (ev for ev in day_events if ev.event_type == EmpEvent.EventType.ONLINE_WORK),
            None
        )
        if online_ev:
            ev_data = online_ev.data or {}
            if ev_data.get("status") == "APPROVED":
                badge = "Duyệt làm việc online"
                if ev_data.get("expected_status") == "HALF_DAY":
                    badge = "Duyệt 0.5 công online"
                return "ONLINE_WORK", badge

        # Ca online cộng thêm (kế hoạch ca tuần, hrm/online_shift.py)
        online_credits = agg_effects.get("cong_ca_online", 0) or 0
        if online_credits > 0 and total_work_credits > 0:
            on_site = total_work_credits - online_credits
            badge = ("Có mặt + ca online" if on_site >= 1.0
                     else "Nửa công + ca online" if on_site > 0 else "Ca online")
            return ("FULL" if total_work_credits >= 1.0 else "HALF"), badge

        if total_work_credits >= 1.0:
            return "FULL", "Có mặt"
        if total_work_credits > 0:
            return "HALF", "Nửa công"

        if date in holiday_map:
            return "HOLIDAY", holiday_map.get(date)

        # Có checkin nhưng không có checkout → quên chấm công
        has_checkin_without_checkout = any(
            ev.event_type == EmpEvent.EventType.ATTENDANCE
            and ev.check_in
            and not ev.check_out
            for ev in day_events
        )
        if has_checkin_without_checkout:
            return "FORGOT_CC", "Quên chấm công"

        return "EMPTY", "Chưa có dữ liệu"

    @staticmethod
    def _build_shifts_from_employee_events(
        att_events: list, agg_effects: dict = None
    ) -> list:
        """
        Build the shifts array (Sáng / Chiều / Tối) from EmployeeEvent ATTENDANCE
        records for a single day.

        Because EmployeeEvent has a unique constraint (employee, event_date, event_type),
        there is at most one ATTENDANCE event per day.  We display it as a FULL_DAY
        row: check_in → Sáng, check_out → Chiều, Tối is always empty.
        """
        def _fmt(t):
            return str(t)[:5] if t else None

        if not att_events:
            return [
                {
                    "shift_type": st, "shift_label": _SHIFT_LABELS[st],
                    "check_in": None, "check_out": None,
                    "status": "EMPTY", "status_color": "gray",
                }
                for st in _SHIFT_ORDER
            ]

        ev = att_events[0]
        ev_data = ev.data or {}

        # Resolve status from engine effects if available
        late_mins = agg_effects.get("late_minutes", 0) if agg_effects else 0
        early_mins = agg_effects.get("early_leave_minutes", 0) if agg_effects else 0

        if late_mins > 0 and early_mins > 0:
            ev_status = "LATE_EARLY"
        elif late_mins > 0:
            ev_status = "LATE"
        elif early_mins > 0:
            ev_status = "EARLY_LEAVE"
        else:
            ev_status = ev_data.get(
                "status", "PRESENT" if (ev.check_in or ev.check_out) else "EMPTY"
            )

        return [
            {
                "shift_type": "MORNING", "shift_label": "Sáng",
                "check_in": _fmt(ev.check_in), "check_out": None,
                "status": ev_status,
                "status_display": _ATTENDANCE_STATUS_DISPLAY.get(ev_status, ev_status),
                "status_color": _get_status_color(ev_status),
            },
            {
                "shift_type": "AFTERNOON", "shift_label": "Chiều",
                "check_in": None, "check_out": _fmt(ev.check_out),
                "status": ev_status,
                "status_display": _ATTENDANCE_STATUS_DISPLAY.get(ev_status, ev_status),
                "status_color": _get_status_color(ev_status),
            },
            {
                "shift_type": "EVENING", "shift_label": "Tối",
                "check_in": None, "check_out": None,
                "status": "EMPTY",
                "status_display": _ATTENDANCE_STATUS_DISPLAY.get("EMPTY"),
                "status_color": "gray",
            },
        ]

    @staticmethod
    def _build_shifts_from_config_and_events(
        shift_configs: list, att_events: list, agg_effects: dict = None
    ) -> list:
        """
        Build the shifts array from ShiftConfig records (if available) combined
        with the actual EmployeeEvent ATTENDANCE data for the day.

        Priority: ShiftConfig-based display when configs exist, otherwise fallback
        to the legacy 3-row (Sáng/Chiều/Tối) layout.

        For each configured shift:
          - scheduled_start / scheduled_end: from ShiftConfig
          - check_in / check_out: from the attendance event if it overlaps this shift
          - status: derived from comparing actual times against scheduled times
        """
        import datetime as _dt

        if not shift_configs:
            return AttendanceCalendarView._build_shifts_from_employee_events(
                att_events, agg_effects
            )

        def _fmt(t):
            return str(t)[:5] if t else None

        def _parse_time(t):
            if not t:
                return None
            if isinstance(t, _dt.time):
                return t
            for fmt in ('%H:%M:%S', '%H:%M'):
                try:
                    return _dt.datetime.strptime(str(t), fmt).time()
                except ValueError:
                    continue
            return None

        def _times_overlap(ci, co, s, e):
            """True when [ci, co] overlaps with shift window [s, e]."""
            if ci and co:
                return ci < e and co > s
            if ci:
                return s <= ci < e
            if co:
                return s < co <= e
            return False

        # Use the first attendance event for check-in / check-out times.
        # Typically there is at most one ATTENDANCE record per day (the model does
        # not enforce a DB-level unique constraint, but the submission logic prevents
        # duplicates).  If multiple records somehow exist, the first one is used.
        ev = att_events[0] if att_events else None
        actual_ci = ev.check_in  if ev else None
        actual_co = ev.check_out if ev else None
        ev_data   = (ev.data or {}) if ev else {}

        # Xác định ca nào thực sự "sở hữu" check_in / check_out của phiên chấm công
        # duy nhất trong ngày — ca overlap ĐẦU TIÊN (theo thứ tự shift_configs, giả
        # định đã sắp xếp theo thời gian) nhận check_in, ca overlap CUỐI CÙNG nhận
        # check_out. Cần thiết vì _times_overlap() coi cả khoảng [check_in, check_out]
        # là overlap với BẤT KỲ ca nào nó chạm vào — khi 2 ca liền kề không có khoảng
        # nghỉ (vd: Sáng kết thúc đúng 12:00, Chiều bắt đầu đúng 12:00), một checkout
        # trễ vài phút (12:02) khiến cả Sáng lẫn Chiều đều "overlap", và nếu hiển thị
        # nguyên cặp (check_in, check_out) trên mọi ca overlap thì Chiều sẽ bị gán
        # nhầm check_in 09:43 (giờ vào của ca Sáng) như thể đó là giờ vào của nó.
        overlapping_indices = [
            idx for idx, sc in enumerate(shift_configs)
            if (actual_ci or actual_co) and _times_overlap(actual_ci, actual_co, sc.start_time, sc.end_time)
        ]
        ci_owner_idx = overlapping_indices[0] if (actual_ci and overlapping_indices) else None
        co_owner_idx = overlapping_indices[-1] if (actual_co and overlapping_indices) else None

        shifts = []
        for idx, sc in enumerate(shift_configs):
            s = sc.start_time
            e = sc.end_time

            if actual_ci or actual_co:
                if _times_overlap(actual_ci, actual_co, s, e):
                    # Determine status
                    late_mins = agg_effects.get("late_minutes", 0) if agg_effects else 0
                    early_mins = (
                        agg_effects.get("early_leave_minutes", 0) if agg_effects else 0
                    )

                    if late_mins > 0 and early_mins > 0:
                        status = "LATE_EARLY"
                    elif late_mins > 0:
                        status = "LATE"
                    elif early_mins > 0:
                        status = "EARLY_LEAVE"
                    else:
                        # Fallback to time-based or raw status
                        raw_status = ev_data.get("status")
                        if actual_ci and actual_ci > s:
                            status = "LATE"
                        elif actual_co and actual_co < e:
                            status = "EARLY_LEAVE"
                        elif raw_status in (
                            "PRESENT",
                            "LATE",
                            "EARLY_LEAVE",
                            "LATE_EARLY",
                            "ABSENT",
                            "HALF_DAY",
                            "INCOMPLETE_ATTENDANCE",
                        ):
                            status = raw_status
                        else:
                            status = "PRESENT"
                    # Chỉ ca "sở hữu" (xem giải thích ở trên) mới hiển thị check_in/
                    # check_out — các ca overlap khác (do liền kề, không có khoảng
                    # nghỉ) không được hiển thị lại mốc giờ đã thuộc về ca kia.
                    ci_display = _fmt(actual_ci) if idx == ci_owner_idx else None
                    co_display = _fmt(actual_co) if idx == co_owner_idx else None
                else:
                    status     = "ABSENT"
                    ci_display = None
                    co_display = None
            else:
                status     = "EMPTY"
                ci_display = None
                co_display = None

            shifts.append({
                "shift_type":      sc.shift_type,
                "shift_label":     sc.name,
                "shift_code":      sc.code,
                "scheduled_start": _fmt(s),
                "scheduled_end":   _fmt(e),
                "check_in":        ci_display,
                "check_out":       co_display,
                "status":          status,
                "status_display":  _ATTENDANCE_STATUS_DISPLAY.get(status, status),
                "status_color":    _get_status_color(status),
            })

        return shifts

    # ------------------------------------------------------------------
    # GET handler
    # ------------------------------------------------------------------

    def get(self, request):
        from .main_api import EmployeeState
        from .event_models import EmployeeEvent

        # ── 1. Parse & validate query params ────────────────────────────
        try:
            year  = int(request.query_params.get("year",  datetime.date.today().year))
            month = int(request.query_params.get("month", datetime.date.today().month))
        except (ValueError, TypeError):
            return _err("year và month phải là số nguyên hợp lệ")

        if not (1 <= month <= 12):
            return _err("Tháng phải từ 1 đến 12")
        if not (2000 <= year <= 2100):
            return _err("Năm không hợp lệ (2000–2100)")

        employee_id = request.query_params.get("employee_id")
        viewer_employee = _get_employee(request)

        # ── 2. Lấy Employee ──────────────────────────────────────────────
        # VÁ LỖ HỔNG: trước đây employee_id được nhận thẳng không kiểm tra
        # quyền gì cả (chỉ cần đăng nhập) — bất kỳ ai cũng xem được lịch
        # chấm công/phạt tiền của BẤT KỲ nhân viên nào khác. Giờ chỉ cho
        # xem nếu là chính mình, Admin/HR, quản lý trực tiếp/cấp 2/cấp 3,
        # hoặc trưởng phòng ban của nhân viên đó (xem
        # hrm/models.py::can_view_employee_attendance).
        if employee_id:
            from .models import can_view_employee_attendance
            employee = get_object_or_404(Employee, pk=employee_id)
            if not can_view_employee_attendance(request.user, viewer_employee, employee):
                return _err(
                    "Bạn không có quyền xem chấm công của nhân viên này.",
                    status.HTTP_403_FORBIDDEN,
                )
        else:
            employee = viewer_employee
            if not employee:
                return _err("Không tìm thấy thông tin nhân viên", status.HTTP_404_NOT_FOUND)

        # ── 3. Khoảng ngày trong tháng ───────────────────────────────────
        first_day = datetime.date(year, month, 1)
        last_day  = (
            datetime.date(year + 1, 1, 1) - datetime.timedelta(days=1)
            if month == 12
            else datetime.date(year, month + 1, 1) - datetime.timedelta(days=1)
        )

        # ── 4. Dữ liệu phụ trợ ───────────────────────────────────────────
        holiday_map = self._build_holiday_map(year, month)

        # ── 5. Chạy replay_month từ main_api (EmployeeState + EmployeeEvent) ──
        #   replay_month:
        #   • Đọc EmployeeEvent (attendance, leave_request, overtime,
        #     livestream, explanation) từ database
        #   • Áp dụng rule engine để tính toán state (penalty, công, OT…)
        #   • Trả về state tổng hợp + calendar_result chi tiết từng ngày
        employee_code = employee.employee_id  # string mã nhân viên, ví dụ "E001"
        try:
            result = EmployeeState.replay_month(employee_code, year, month)
        except Exception as exc:
            logger.error(
                "replay_month failed for employee=%s %d/%d: %s\n%s",
                employee_code, month, year, exc, traceback.format_exc(),
            )
            return _err(str(exc), status.HTTP_500_INTERNAL_SERVER_ERROR)

        # ShiftConfig áp dụng cho nhân viên (đã được tải trong replay_month)
        shift_configs_data = result.get("shift_configs", [])  # serialised list
        # Tải lại đối tượng ShiftConfig để dùng khi build shifts per day
        from .shift_config_utils import (
            load_shift_configs_for_employee,
            get_registered_shift_configs_for_date,
        )
        # Cache dùng chung cho cả tháng — _day_shift_configs() dưới đây gọi 1
        # lần/ngày (xem docstring get_registered_shift_configs_for_date /
        # load_shift_configs_for_employee).
        _registration_scope_cache: dict = {}
        _shift_by_date_cache: dict = {}

        def _day_shift_configs(day):
            """ShiftConfig dùng để HIỂN THỊ ca của 1 ngày cụ thể.

            Ưu tiên (các) ca đã ĐĂNG KÝ cho đúng ngày đó, hệt như engine tính
            công (xem EmployeeState._rules_from_registered_shifts) — nếu không
            thì giữ nguyên cascade ca cố định theo tháng như trước. Thiếu bước
            này thì nhân viên đăng ký Ca 2 sẽ thấy công/phạt tính theo Ca 2
            nhưng khung giờ ca hiển thị vẫn là ca cascade, rất khó hiểu.
            """
            # Ca cố định giải theo ĐÚNG NGÀY (không phải ngày 01 của tháng) —
            # khớp engine tính công (EmployeeState._rules_from_shift_configs_
            # for_date). Giải bằng đầu tháng thì nhân viên đổi ca giữa tháng
            # thấy khung giờ ca sai dù công/phạt đã tính đúng.
            cascade = load_shift_configs_for_employee(employee_code, day, _shift_by_date_cache)
            try:
                registered = get_registered_shift_configs_for_date(
                    employee, day, _registration_scope_cache,
                )
            except Exception:
                logger.exception(
                    "[RegisteredShift] Lỗi khi lấy ca đã đăng ký để hiển thị "
                    "NV=%s ngày=%s -> dùng cascade ca cố định",
                    employee_code, day,
                )
                return cascade
            return registered or cascade

        # Index calendar_result theo date string "YYYY-MM-DD"
        # (mỗi ngày có thể có nhiều event: attendance + overtime + leave…)
        calendar_by_date: dict[str, list] = {}
        for entry in result.get("calendar", []):
            date_str = entry.get("date")
            if date_str:
                calendar_by_date.setdefault(date_str, []).append(entry)

        # ── 6. Fetch toàn bộ EmployeeEvent để hiển thị ca và đăng ký ────
        events_qs = EmployeeEvent.objects.filter(
            employee=employee,
            event_date__gte=first_day,
            event_date__lte=last_day,
        ).select_related("created_by").order_by("event_date", "created_at")

        events_by_date: dict[datetime.date, list] = {}
        for ev in events_qs:
            events_by_date.setdefault(ev.event_date, []).append(ev)

        # ── 7. Xây dựng summary từ state của EmployeeState ───────────────
        state = result.get("state", {})
        summary_ui = {
            "total_work_days":      state.get("tong_ngay_cong", 0),
            "full_days":            state.get("ngay_du_cong", 0),
            "half_days":            state.get("nua_ngay_cong", 0),
            "late_or_early_days":   state.get("di_muon_ve_som", 0),
            "absent_days":          state.get("vang_mat", 0),
            "forgot_checkin_days":  state.get("quen_cham_cong", 0),
            "overtime_hours":       round(float(state.get("tang_ca", 0)), 2),
            "extra_hours":          round(float(state.get("lam_them_gio", 0)), 2),
            "night_shift_sessions": int(state.get("truc_toi", 0)),
            "live_sessions":        int(state.get("live", 0)),
            "leave_days":           state.get("nghi_phep", 0),
            "violation_count":      max(
                0,
                state.get("di_muon_ve_som", 0) + state.get("quen_cham_cong", 0),
            ),
        }

        # Get policy for quota max
        from .attendance_engine import PolicyLoader
        policy_cfg = PolicyLoader.load(datetime.date(year, month, 1))
        quota_max = policy_cfg.get("policy", {}).get("max_explanation_quota", 3)
        quota_used = state.get("explanation_quota_used", 0)
        # Part-time/full-time VÀO NGÀY LỄ (lịch sử điều chuyển, employee/assignment.py)
        # — đổi hình thức làm việc từ tháng sau không đổi công lễ tháng này.
        from employee.assignment import AssignmentResolver
        _assignment = AssignmentResolver()
        holiday_credit_total = round(
            sum(
                get_holiday_credit_for_employee(employee, d, _assignment)
                for d in holiday_map.keys()
                if is_holiday_creditable(employee, d)
            ),
            2,
        )

        engine_summary = {
            "total_penalty_vnd":       state.get("tong_phat", 0),
            "total_parking_allowance": state.get("tong_phu_cap_gui_xe", 0),
            "total_live_allowance":    state.get("tong_phu_cap_livestream", 0),
            "total_holiday_credit":    holiday_credit_total,
            "explanation_quota_used":  quota_used,
            "explanation_quota_max":   quota_max,
            "explanation_quota_remaining": max(0, quota_max - quota_used),
            **_explanation_quota_summary(employee, year, month),
            "events_processed":        result.get("events_processed", 0),
        }

        summary_ui["holiday_days"] = int(holiday_credit_total)
        summary_ui["holiday_credit"] = holiday_credit_total
        summary_ui["total_work_days"] = round(
            float(summary_ui.get("total_work_days", 0)) + holiday_credit_total,
            2,
        )

        # ── 8. Xây dựng calendar ─────────────────────────────────────────
        calendar_days = []
        cur = first_day
        # Ngày NV hưởng chế độ con nhỏ (được đi muộn / về sớm thêm N phút) — để lịch ghi chú.
        from .child_care_regime import child_care_minutes_by_date
        child_care_minutes = child_care_minutes_by_date(employee.id, first_day, last_day)

        # Vai trò của NGƯỜI XEM — tính 1 lần cho cả tháng (có query
        # managed_departments/subordinates nên không được tính lại cho từng
        # đơn). Dùng để gắn cờ quyền duyệt/sửa/huỷ vào mỗi đơn bên dưới, cho
        # modal "Chi tiết chấm công ngày" ở Chấm công > Nhân viên và Chốt công
        # (yêu cầu HCNS 2026-09-23).
        from .request_permissions import _viewer_roles, compute_request_permissions
        viewer_roles = _viewer_roles(request.user, viewer_employee)

        try:
            while cur <= last_day:
                weekday    = cur.weekday()   # 0=Mon … 6=Sun
                is_weekend = weekday >= 5
                is_holiday = cur in holiday_map

                day_str     = cur.isoformat()
                day_entries = calendar_by_date.get(day_str, [])   # từ replay_month calendar_result
                day_events  = events_by_date.get(cur, [])

                # Tổng hợp delta + effects từ tất cả event entries của ngày
                agg_delta: dict   = {}
                agg_effects: dict = {}
                for entry in day_entries:
                    for k, v in (entry.get("delta") or {}).items():
                        agg_delta[k] = agg_delta.get(k, 0) + v
                    for k, v in (entry.get("effects") or {}).items():
                        agg_effects[k] = agg_effects.get(k, 0) + v

                # day_status: từ aggregated delta + effects + raw events.
                # include_pending_unauthorized_absence=True: đây là lịch xem trực
                # tiếp (chưa chốt công) nên ngày có đơn Nghỉ không phép đang chờ
                # duyệt cũng cần được đánh dấu, không đợi duyệt xong mới hiện.
                day_shift_objs = _day_shift_configs(cur)

                day_status, status_badge = self._day_status_from_events_data(
                    agg_delta, agg_effects, day_events, holiday_map, cur, day_shift_objs,
                    include_pending_unauthorized_absence=True,
                )

                is_leave = day_status == "LEAVE"

                # Shifts: ưu tiên dùng ShiftConfig; fallback 3-row mặc định
                att_events = sorted(
                    [ev for ev in day_events if ev.event_type == EmployeeEvent.EventType.ATTENDANCE],
                    key=lambda ev: (0 if ev.checkin_is_valid is True else 1),
                )
                shifts = self._build_shifts_from_config_and_events(
                    day_shift_objs, att_events, agg_effects
                )

                # engine_context: từ aggregated delta/effects của replay_month
                is_leave_day = (
                    agg_effects.get("nghi_phep", 0) > 0
                    or agg_effects.get("nghi_khong_luong", 0) > 0
                    or any(
                        (ev.event_type == EmployeeEvent.EventType.LEAVE_REQUEST
                         or (ev.event_type == EmployeeEvent.EventType.EXPLANATION and (ev.data or {}).get('explanation_type') == 'LEAVE'))
                        and (ev.data or {}).get('status', '').upper() in ('APPROVED', 'PENDING')
                        for ev in day_events
                    )
                )
                holiday_credit = (
                    get_holiday_credit_for_employee(employee, cur, _assignment)
                    if (is_holiday and is_holiday_creditable(employee, cur)) else 0.0
                )
                engine_context = {
                    "is_holiday":           is_holiday,
                    "is_leave_day":         is_leave_day,
                    "is_absent":            agg_delta.get("vang_mat",       0) > 0,
                    "is_incomplete":        agg_delta.get("quen_cham_cong", 0) > 0,
                    "is_unauthorized_absence": day_status == "UNAUTHORIZED_ABSENCE",
                    "unauthorized_absence_days": self._unauthorized_absence_days(
                        day_status, day_events, include_pending=True,
                    ),
                    "work_credit":          (agg_delta.get("nua_ngay_cong", 0.0)
                                            + agg_delta.get("ngay_du_cong", 0.0)
                                            + holiday_credit),
                    "holiday_credit":       holiday_credit,
                    "penalty_amount":       agg_effects.get("tong_phat",    0),
                    "late_penalty":         agg_effects.get("late_penalty", 0),
                    "early_leave_penalty":  agg_effects.get("early_leave_penalty", 0),
                    "overtime_hours":       agg_effects.get("tang_ca",      0.0),
                    "extra_hours":          agg_effects.get("lam_them_gio", 0.0),
                    "night_shift_sessions": int(agg_effects.get("truc_toi", 0)),
                    "live_sessions":        int(agg_effects.get("live",     0)),
                    "late_minutes":         int(agg_effects.get("late_minutes",        0)),
                    "early_leave_minutes":  int(agg_effects.get("early_leave_minutes", 0)),
                    # Chế độ con nhỏ: số phút được đi muộn / về sớm thêm của ngày (0 = không hưởng)
                    "child_care_minutes":   child_care_minutes.get(day_str, 0),
                    "explanation_quota_delta": agg_delta.get("explanation_quota_used", 0),
                    "explanation_quota_used": day_entries[-1].get("state_after", {}).get("explanation_quota_used", 0) if day_entries else 0,
                    "rules_applied":        [
                        rule
                        for entry in day_entries
                        for rule in entry.get("rules_applied", [])
                    ],
                }

                # Registrations: non-attendance EmployeeEvent records của ngày.
                # CỐ Ý KHÔNG lọc bỏ đơn CANCELLED ở đây — endpoint này còn được
                # dùng cho DayDetailDialog (AttendanceCalendar.tsx) và trang Chốt
                # công (WorkFinalization.tsx embed cùng component), nơi quản
                # lý/HR cần thấy đầy đủ kể cả đơn đã huỷ để đối chiếu khi review/
                # chốt công (yêu cầu HCNS 2026-09-18: HCNS/QLTT báo không thấy
                # đơn đã huỷ của NV trong bảng chốt công). Việc ẩn đơn CANCELLED
                # khỏi "Lịch sử đơn tháng" (để tránh nhìn như trùng lặp) được lọc
                # riêng ở FE khi build danh sách đó (AttendanceManagement.tsx::
                # handleCalendarDataLoaded), không lọc chung tại nguồn dữ liệu.
                registrations = []
                for ev in day_events:
                    if ev.event_type == EmployeeEvent.EventType.ATTENDANCE:
                        continue
                    creator = ev.created_by
                    reg: dict = {
                        "id":         ev.id,
                        "event_type": ev.event_type,
                        # event_date TRƯỚC ĐÂY thiếu — FE phải đoán lại từ ngày
                        # đang mở modal, sai với đơn nhiều ngày (nghỉ không phép).
                        "event_date": ev.event_date.isoformat(),
                        "notes":      ev.notes,
                        "created_by": creator.full_name if creator else None,
                        "created_by_name": creator.full_name if creator else None,
                        "is_hr_created": _is_hr(creator) if creator else False,
                        "created_at": ev.created_at.isoformat() if ev.created_at else None,
                        # Cờ quyền cho UI (xem hrm/request_permissions.py) —
                        # endpoint duyệt/sửa/huỷ vẫn tự kiểm tra lại khi bấm.
                        **compute_request_permissions(
                            ev, request.user, viewer_employee, roles=viewer_roles
                        ),
                    }
                    if ev.check_in:
                        reg["check_in"] = str(ev.check_in)[:5]
                    if ev.check_out:
                        reg["check_out"] = str(ev.check_out)[:5]
                    if ev.overtime_hours is not None:
                        reg["overtime_hours"] = float(ev.overtime_hours)
                    if ev.explanation:
                        reg["explanation"] = ev.explanation
                    
                    # Inject status for display
                    ev_status = (ev.data or {}).get("status")
                    if ev_status:
                        reg["status"] = ev_status
                        reg["status_display"] = _ATTENDANCE_STATUS_DISPLAY.get(ev_status, ev_status)

                    if ev.data:
                        reg["data"] = ev.data
                    registrations.append(reg)

                # raw_checkin_checkout: từ EmployeeEvent ATTENDANCE của ngày
                # source="mobile" nếu checkin_is_valid=True (GPS), source="device" nếu từ máy chấm công
                raw_checkin_checkout = [
                    {
                        "check_in":  str(ev.check_in)[:5] if ev.check_in else None,
                        "check_out": str(ev.check_out)[:5] if ev.check_out else None,
                        "source":    "mobile" if ev.checkin_is_valid is True else "device",
                    }
                    for ev in att_events
                ]

                calendar_days.append({
                    "date":               day_str,
                    "day":                cur.day,
                    "weekday":            weekday,
                    "weekday_label":      _WEEKDAY_LABELS[weekday],
                    "is_weekend":         is_weekend,
                    "is_holiday":         is_holiday,
                    "holiday_name":       holiday_map.get(cur),
                    "is_leave":           is_leave,
                    "day_status":         day_status,
                    "status_badge":       status_badge,
                    "engine_context":     engine_context,
                    "shifts":             shifts,
                    "registrations":      registrations,
                    "raw_checkin_checkout": raw_checkin_checkout,
                })

                cur += datetime.timedelta(days=1)

            summary_ui["unauthorized_absence_days"] = sum(
                (d.get("engine_context") or {}).get("unauthorized_absence_days", 0.0)
                for d in calendar_days
            )

        except Exception as exc:
            logger.error(
                "Lỗi khi xây dựng calendar cho employee=%s %d/%d ngày %s: %s\n%s",
                employee_code, month, year, cur.isoformat() if cur else "?",
                exc, traceback.format_exc(),
            )
            return _err(
                f"Lỗi khi xây dựng lịch chấm công: {exc}",
                status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return _ok({
            "year":  year,
            "month": month,
            "employee": {
                "id":          employee.id,
                "employee_id": getattr(employee, "employee_id", None),
                "full_name":   employee.full_name,
            },
            "summary":        summary_ui,
            "engine_summary": engine_summary,
            "shift_configs":  shift_configs_data,
            "legend": [
                {"day_status": k, **v}
                for k, v in _DAY_STATUS_LEGEND.items()
            ],
            "calendar":            calendar_days,
            "total_days_in_month": (last_day - first_day).days + 1,
        })


# ─── Livestream Allowance Configuration ────────────────────────────────────────
class LivestreamAllowanceConfigListView(APIView):
    """
    GET /attendance/livestream-allowance-config/ - Danh sách
    POST /attendance/livestream-allowance-config/ - Tạo mới
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        from hrm.attendance_models import LivestreamAllowanceConfig
        from hrm.serializers import LivestreamAllowanceConfigSerializer
        
        configs = LivestreamAllowanceConfig.objects.all()
        serializer = LivestreamAllowanceConfigSerializer(configs, many=True)
        return Response(serializer.data)
    
    def post(self, request):
        from hrm.attendance_models import LivestreamAllowanceConfig
        from hrm.serializers import LivestreamAllowanceConfigSerializer
        
        serializer = LivestreamAllowanceConfigSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(
                created_by=request.user.employee if hasattr(request.user, 'employee') else None
            )
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LivestreamAllowanceConfigDetailView(APIView):
    """
    GET /attendance/livestream-allowance-config/<id>/ - Chi tiết
    PUT /attendance/livestream-allowance-config/<id>/ - Cập nhật
    PATCH /attendance/livestream-allowance-config/<id>/ - Cập nhật từng phần
    DELETE /attendance/livestream-allowance-config/<id>/ - Xóa
    """
    permission_classes = [IsAuthenticated]
    
    def get_object(self, pk):
        from hrm.attendance_models import LivestreamAllowanceConfig
        try:
            return LivestreamAllowanceConfig.objects.get(pk=pk)
        except LivestreamAllowanceConfig.DoesNotExist:
            return None
    
    def get(self, request, pk):
        from hrm.serializers import LivestreamAllowanceConfigSerializer
        config = self.get_object(pk)
        if not config:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = LivestreamAllowanceConfigSerializer(config)
        return Response(serializer.data)
    
    def put(self, request, pk):
        from hrm.serializers import LivestreamAllowanceConfigSerializer
        config = self.get_object(pk)
        if not config:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        
        serializer = LivestreamAllowanceConfigSerializer(config, data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    def patch(self, request, pk):
        from hrm.serializers import LivestreamAllowanceConfigSerializer
        config = self.get_object(pk)
        if not config:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        
        serializer = LivestreamAllowanceConfigSerializer(config, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    def delete(self, request, pk):
        config = self.get_object(pk)
        if not config:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        
        config.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _explanation_quota_summary(employee, year, month) -> dict:
    """Hạn mức giải trình theo từng loại cho lịch (hrm/explanation_quota.py). Chế độ chung
    (mặc định) trả mode=COMBINED, giao diện giữ cách hiển thị cũ."""
    from .explanation_quota import explanation_quota_status
    try:
        status = explanation_quota_status(employee, datetime.date(year, month, 1))
    except Exception:
        return {"explanation_quota_mode": "COMBINED"}
    summary = {
        "explanation_quota_mode": status["mode"],
        "explanation_quota_shared": status["shared"],
        "is_manager_combined_quota": status["is_manager_combined_quota"],
        "explanation_quota_by_type": status["by_type"],
    }
    if status["mode"] == "PER_TYPE":
        # Số tổng trên lịch = tổng các giỏ (hoặc rổ gộp) thay cho hạn mức chung của chính sách
        summary.update({
            "explanation_quota_used": status["combined"]["used"],
            "explanation_quota_max": status["combined"]["max"],
            "explanation_quota_remaining": status["combined"]["remaining"],
        })
    return summary


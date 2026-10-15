"""Cảnh báo: đã được HCNS mở khoá nhưng VẪN tạo/duyệt sau mốc 3 giờ.

Yêu cầu HCNS 2026-10-09. Luật HCNS cho trường hợp đột xuất là: nhờ HCNS mở
khoá rồi phải tạo VÀ duyệt trong 3 giờ đầu sau khi đi làm. HCNS chốt KHÔNG
chặn cứng mốc này ("cứ mở thoải mái") mà làm một trang cảnh báo riêng, vì phần
trễ có thể do CHÍNH HCNS mở khoá muộn — chặn cứng sẽ phạt oan nhân viên.

Mốc 3 giờ dùng lại nguyên hàm có sẵn `unauthorized_absence_deadline()`:
giờ vào ca của NGÀY LÀM VIỆC KẾ TIẾP sau ngày nghỉ, cộng 3 giờ. Hàm đó hiện
không còn đường chạy tới trong luồng chính (từ 29/09 đơn nghỉ không phép chuyển
sang `leave_style_deadline`), nên ở đây là nơi duy nhất còn dùng — KHÔNG viết
lại công thức để hai nơi không lệch nhau.

Trang này CHỈ cảnh báo, không sinh tiền phạt: mức phạt nằm ở
violation_report_views, và một lần mở khoá đã làm đơn đó không bị tính lỗi.
"""
import datetime as _dt

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Employee

from .deadline_exception_models import DeadlineExceptionGrant
from .deadline_utils import (
    get_shift_start_time,
    next_working_day,
    unauthorized_absence_deadline,
)
from .event_models import EmployeeEvent

PAID_LEAVE = "LEAVE"
UNPAID_LEAVE = "UNAUTHORIZED_ABSENCE"

TYPE_LABEL = {
    PAID_LEAVE: "Nghỉ phép tháng (có lương)",
    UNPAID_LEAVE: "Nghỉ không phép (không lương)",
}

# Vì sao trễ — tách ra để HCNS biết lỗi thuộc về ai, thay vì gộp một cục.
CAUSE_LABEL = {
    "HCNS_UNLOCK_LATE": "HCNS mở khoá sau mốc 3 giờ",
    "CREATED_LATE": "Nhân viên tạo đơn sau mốc 3 giờ",
    "APPROVED_LATE": "Quản lý duyệt sau mốc 3 giờ",
    "NO_REQUEST_YET": "Đã mở khoá nhưng chưa thấy đơn nào",
}


def _parse_dt(value):
    if not value:
        return None
    try:
        d = _dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else timezone.make_aware(d)


def _month_range(year, month):
    first = _dt.date(year, month, 1)
    last = (_dt.date(year + (month == 12), (month % 12) + 1, 1) - _dt.timedelta(days=1))
    return first, last


def _minutes(later, earlier):
    try:
        return int((later - earlier).total_seconds() // 60)
    except Exception:  # noqa: BLE001
        return None


class GrantTimingReportView(APIView):
    """GET /api-hrm/grant-timing-report/?year=&month=[&department_id=]

    Chỉ HCNS/Admin — gom dữ liệu toàn công ty.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Phạm vi xem giống hệt trang đối soát: nhân viên thấy của mình, quản lý
        # thấy của mình + team, HCNS/Admin thấy toàn công ty. Dùng chung hàm để
        # hai trang không lệch nhau — tab này nằm ngay trong trang kia.
        from .violation_report_views import viewer_scope

        viewer = Employee.objects.filter(user=request.user).first()
        scope, emp_ids = viewer_scope(request.user, viewer)
        if scope == "NONE":
            return Response(
                {"error": "Tài khoản chưa gắn hồ sơ nhân viên nên không xem được báo cáo."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            year = int(request.query_params.get("year") or timezone.localdate().year)
            month = int(request.query_params.get("month") or timezone.localdate().month)
        except (TypeError, ValueError):
            return Response({"error": "year/month phải là số"}, status=status.HTTP_400_BAD_REQUEST)
        if not (1 <= month <= 12):
            return Response({"error": "month phải từ 1 đến 12"}, status=status.HTTP_400_BAD_REQUEST)

        first, last = _month_range(year, month)
        dept_id = request.query_params.get("department_id")

        grants = (DeadlineExceptionGrant.objects
                  .filter(event_date__gte=first, event_date__lte=last,
                          request_type__in=[PAID_LEAVE, UNPAID_LEAVE],
                          revoked_at__isnull=True)
                  .select_related("employee", "employee__department",
                                  "employee__manager", "granted_by")
                  .order_by("event_date"))
        if dept_id:
            grants = grants.filter(employee__department_id=dept_id)
        if emp_ids is not None:
            grants = grants.filter(employee_id__in=emp_ids)

        rows = []
        for g in grants:
            rows.extend(self._rows_for_grant(g))

        late_rows = [r for r in rows if r["causes"]]
        by_cause = {
            code: sum(1 for r in late_rows if code in r["causes"])
            for code in CAUSE_LABEL
        }
        return Response({
            "year": year,
            "month": month,
            "scope": scope,
            "generated_at": timezone.now().isoformat(),
            "cause_labels": CAUSE_LABEL,
            "summary": {
                "grants_checked": len(rows),
                "late_rows": len(late_rows),
                "on_time_rows": len(rows) - len(late_rows),
                "by_cause": by_cause,
                # Số dòng phải dùng mốc dự phòng 10h00 vì không tra được giờ ca
                # -> HCNS đừng kết luận oan trên mấy dòng này.
                "fallback_rows": sum(1 for r in late_rows if r["deadline_is_fallback"]),
            },
            "rows": late_rows,
        })

    def _rows_for_grant(self, g):
        emp = g.employee
        deadline = unauthorized_absence_deadline(g.event_date, emp)

        # Có tra được giờ vào ca hay phải dùng mốc dự phòng 10h00? Phải tự hỏi
        # lại vì unauthorized_absence_deadline() không nói ra, mà một mốc dự
        # phòng thì không đủ chắc để kết luận ai trễ.
        nwd = next_working_day(g.event_date, emp)
        shift_start = None
        try:
            shift_start = get_shift_start_time(emp, nwd, half="FULL")
        except Exception:  # noqa: BLE001
            pass
        is_fallback = shift_start is None

        event_type = "explanation" if g.request_type == PAID_LEAVE else "unauthorized_absence"
        events = list(EmployeeEvent.objects
                      .filter(employee_id=emp.id, event_date=g.event_date,
                              event_type=event_type)
                      .exclude(data__status__in=["CANCELLED", "REJECTED"]))
        if g.request_type == PAID_LEAVE:
            events = [e for e in events
                      if (e.data or {}).get("explanation_type") == "LEAVE"]

        base = {
            "employee_id": emp.id,
            "employee_code": emp.employee_id,
            "employee_name": emp.full_name,
            "department_name": emp.department.name if emp.department else None,
            "manager_name": emp.manager.full_name if emp.manager else None,
            "request_type": g.request_type,
            "request_type_label": TYPE_LABEL.get(g.request_type, g.request_type),
            "event_date": g.event_date.isoformat(),
            "deadline_3h": deadline.isoformat() if deadline else None,
            "deadline_is_fallback": is_fallback,
            "next_working_day": nwd.isoformat() if nwd else None,
            "granted_at": g.created_at.isoformat(),
            "granted_by_name": g.granted_by.full_name if g.granted_by else None,
            "grant_note": g.note or "",
        }

        # Mở khoá muộn là nguyên nhân ĐỨNG TRƯỚC: nếu HCNS mở sau mốc 3 giờ thì
        # nhân viên không còn cách nào kịp, nên không quy lỗi tạo/duyệt muộn nữa.
        hcns_late = bool(deadline and g.created_at > deadline)

        if not events:
            causes = ["HCNS_UNLOCK_LATE"] if hcns_late else ["NO_REQUEST_YET"]
            return [{
                **base,
                "request_code": None,
                "created_at": None,
                "approved_at": None,
                "created_overdue_minutes": None,
                "approved_overdue_minutes": None,
                "hcns_unlock_overdue_minutes": _minutes(g.created_at, deadline) if hcns_late else None,
                "causes": causes,
                "cause_labels": [CAUSE_LABEL[c] for c in causes],
            }]

        out = []
        for ev in events:
            d = ev.data or {}
            created = _parse_dt(d.get("submitted_at")) or ev.created_at
            approved = _parse_dt(d.get("direct_manager_approved_at"))
            causes = []
            if hcns_late:
                causes.append("HCNS_UNLOCK_LATE")
            else:
                if deadline and created and created > deadline:
                    causes.append("CREATED_LATE")
                if deadline and approved and approved > deadline:
                    causes.append("APPROVED_LATE")
            out.append({
                **base,
                "request_code": d.get("request_code") or "",
                "created_at": created.isoformat() if created else None,
                "approved_at": approved.isoformat() if approved else None,
                "created_overdue_minutes": (
                    _minutes(created, deadline) if (deadline and created and created > deadline) else None
                ),
                "approved_overdue_minutes": (
                    _minutes(approved, deadline) if (deadline and approved and approved > deadline) else None
                ),
                "hcns_unlock_overdue_minutes": _minutes(g.created_at, deadline) if hcns_late else None,
                "causes": causes,
                "cause_labels": [CAUSE_LABEL[c] for c in causes],
            })
        return out

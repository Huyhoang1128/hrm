"""
hrm/deadline_exception_views.py
════════════════════════════════
API cho "Mở khoá đặc biệt" (hrm/deadline_exception_models.py) — CHỈ HCNS/
Admin mới được tạo/xoá, để không phải dùng Django Admin (quá kỹ thuật cho
HCNS). Nhân viên/TBP-TP KHÔNG cần biết đến API này — họ chỉ đơn giản thấy
đơn tạo/duyệt được bình thường sau khi HCNS mở khoá.

/api-hrm/deadline-exceptions/
    GET   – Danh sách (mới nhất trước), lọc được ?employee_id=&request_type=&search=,
            phân trang khi có ?page=&page_size=
    POST  – Tạo mới (employee_id, event_date, request_type, note)
    DELETE <pk>/ – Thu hồi 1 lượt mở khoá (đánh dấu revoked_at, KHÔNG xoá —
            giữ lịch sử để rà soát đơn đã tạo/duyệt nhờ lượt này)
    GET   for-events/?ids=1,2,3 – {event_id: [lượt mở khoá đã áp dụng]} để
            gắn cờ "Mở khoá đặc biệt" cho đơn trên giao diện duyệt
"""
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from employee.models import Employee

from .deadline_exception_models import DeadlineExceptionGrant, find_applied_grants_for_events
from .event_models import EmployeeEvent
from .models import _is_hr, _has_approve_permission
from .pagination import StandardResultsSetPagination


class DeadlineExceptionGrantViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def _get_employee(self, request):
        return Employee.objects.filter(user=request.user).first()

    def _check_hr_or_admin(self, request):
        """Quyền ĐỌC danh sách mở khoá — giữ rộng như cũ, gồm cả quản lý có
        quyền duyệt chấm công, để màn Phê duyệt vẫn hiện được badge đã mở khoá."""
        if request.user.is_staff or request.user.is_superuser:
            return True
        emp = self._get_employee(request)
        return bool(emp and (_is_hr(emp) or _has_approve_permission(emp)))

    def _check_can_grant(self, request):
        """Quyền CẤP / THU HỒI mở khoá — chỉ HCNS/Admin.

        Trước đây dùng chung _check_hr_or_admin, tức BẤT KỲ quản lý có
        `EmployeePermission.can_approve_attendance` cũng tự cấp mở khoá được,
        kể cả cho đơn của chính mình. Dưới cơ chế phạt 500k (HCNS áp từ
        10/2026) thì đó là lỗ hổng tự xoá lỗi của chính mình: quản lý duyệt
        muộn chỉ cần cấp 1 grant là hết bị tính lỗi. HCNS chốt 2026-10-09
        "siết: chỉ HCNS/Admin được mở khoá".

        Đã đo trước khi siết: cả 47 người hiện cấp được grant đều đã là
        HCNS/Admin, nên KHÔNG ai mất quyền — chỉ bịt đường lạm dụng về sau.
        """
        if request.user.is_staff or request.user.is_superuser:
            return True
        emp = self._get_employee(request)
        return bool(emp and _is_hr(emp))

    def list(self, request):
        if not self._check_hr_or_admin(request):
            return Response({"error": "Bạn không có quyền xem danh sách này"}, status=status.HTTP_403_FORBIDDEN)

        qs = DeadlineExceptionGrant.objects.select_related(
            "employee", "employee__department", "granted_by", "revoked_by",
        ).order_by("-created_at")

        employee_id = request.query_params.get("employee_id")
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        request_type = request.query_params.get("request_type")
        if request_type:
            qs = qs.filter(request_type=request_type)

        search = (request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(employee__full_name__icontains=search)
                | Q(employee__employee_id__icontains=search)
                | Q(employee__department__name__icontains=search)
            )

        # Có ?page= -> phân trang chuẩn {count, results}; không có -> mảng như cũ.
        if request.query_params.get("page"):
            paginator = StandardResultsSetPagination()
            page = paginator.paginate_queryset(qs, request)
            return paginator.get_paginated_response([self._serialize(g) for g in page])

        qs = qs[:200]
        return Response([self._serialize(g) for g in qs])

    def create(self, request):
        if not self._check_can_grant(request):
            return Response({"error": "Chỉ HCNS/Admin được mở khoá đặc biệt. Vui lòng liên hệ HCNS."}, status=status.HTTP_403_FORBIDDEN)

        employee_id = request.data.get("employee_id")
        event_date_raw = request.data.get("event_date")
        request_type = request.data.get("request_type")
        note = request.data.get("note", "")

        if not (employee_id and event_date_raw and request_type):
            return Response(
                {"error": "Thiếu thông tin: cần chọn nhân viên, ngày và loại đơn."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if request_type not in dict(DeadlineExceptionGrant.REQUEST_TYPE_CHOICES):
            return Response({"error": "Loại đơn không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)

        from datetime import date as _date
        try:
            event_date = _date.fromisoformat(str(event_date_raw))
        except (TypeError, ValueError):
            return Response({"error": "Ngày không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)

        employee = Employee.objects.filter(id=employee_id).first()
        if not employee:
            return Response({"error": "Không tìm thấy nhân viên"}, status=status.HTTP_400_BAD_REQUEST)

        # ── Chặn mở khoá khi ngày đó ĐÃ CÓ đơn cùng loại ───────────────────
        # Mở khoá lúc đã có đơn chờ duyệt / đã duyệt gần như luôn là để "cứu"
        # quản lý quên duyệt: mở xong duyệt lại thì lỗi "duyệt đơn quá hạn" 500k
        # của quản lý biến mất. HCNS yêu cầu chặn 2026-10-10, nhưng vẫn cho
        # HCNS tick xác nhận vì có trường hợp thật (trưởng phòng ốm không duyệt
        # được) — tick thì BẮT BUỘC nhập lý do.
        from .deadline_exception_models import find_blocking_request

        blocking = find_blocking_request(employee, event_date, request_type)
        override = str(request.data.get("override_existing") or "").lower() in ("1", "true", "yes", "on")

        if blocking and not override:
            return Response(
                {
                    "code": "EXISTING_REQUEST",
                    "error": (
                        f"Ngày {event_date.strftime('%d/%m/%Y')} đã có đơn "
                        f"\"{dict(DeadlineExceptionGrant.REQUEST_TYPE_CHOICES).get(request_type, request_type)}\" "
                        f"ở trạng thái {blocking['status_label'].lower()}. "
                        "Mở khoá lúc này thường là để duyệt bù cho quản lý quên duyệt — "
                        "nếu thật sự cần (ví dụ quản lý ốm), tick xác nhận và nhập lý do."
                    ),
                    "existing": blocking,
                },
                status=status.HTTP_409_CONFLICT,
            )
        if blocking and override and not str(note or "").strip():
            return Response(
                {"error": "Phải nhập lý do khi vẫn mở khoá dù ngày đó đã có đơn."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        granted_by = self._get_employee(request)
        grant, created = DeadlineExceptionGrant.objects.filter(revoked_at__isnull=True).update_or_create(
            employee=employee, event_date=event_date, request_type=request_type,
            defaults={
                "note": note,
                "granted_by": granted_by,
                "overrode_existing_request": bool(blocking and override),
            },
        )
        return Response(self._serialize(grant), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def destroy(self, request, pk=None):
        if not self._check_can_grant(request):
            return Response({"error": "Chỉ HCNS/Admin được thu hồi mở khoá đặc biệt."}, status=status.HTTP_403_FORBIDDEN)
        grant = DeadlineExceptionGrant.objects.filter(pk=pk, revoked_at__isnull=True).first()
        if not grant:
            return Response(status=status.HTTP_404_NOT_FOUND)
        grant.revoked_at = timezone.now()
        grant.revoked_by = self._get_employee(request)
        grant.save(update_fields=["revoked_at", "revoked_by"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="for-events")
    def for_events(self, request):
        if not self._check_hr_or_admin(request):
            return Response({"error": "Bạn không có quyền xem thông tin này"}, status=status.HTTP_403_FORBIDDEN)
        ids = [int(x) for x in (request.query_params.get("ids") or "").split(",") if x.strip().isdigit()][:500]
        events = EmployeeEvent.objects.filter(id__in=ids).only(
            "id", "employee_id", "event_date", "event_type", "data", "created_at", "updated_at",
        )
        applied = find_applied_grants_for_events(list(events))
        created_at_by_id = {e.id: e.created_at for e in events}
        return Response({
            str(event_id): [
                {
                    **self._serialize_brief(g),
                    # Mở trước khi tạo đơn -> gỡ hạn TẠO; mở sau -> gỡ hạn duyệt/huỷ/sửa.
                    "granted_before_created": bool(
                        created_at_by_id.get(event_id) and g.created_at <= created_at_by_id[event_id]
                    ),
                }
                for g in grants
            ]
            for event_id, grants in applied.items()
        })

    @staticmethod
    def _serialize_brief(g: DeadlineExceptionGrant) -> dict:
        return {
            "id": g.id,
            "request_type": g.request_type,
            "request_type_display": g.get_request_type_display(),
            "note": g.note,
            "overrode_existing_request": g.overrode_existing_request,
            "granted_by_name": g.granted_by.full_name if g.granted_by else None,
            "created_at": g.created_at.isoformat(),
            "revoked_at": g.revoked_at.isoformat() if g.revoked_at else None,
        }

    @staticmethod
    def _serialize(g: DeadlineExceptionGrant) -> dict:
        return {
            "id": g.id,
            "employee_id": g.employee_id,
            "employee_code": g.employee.employee_id,
            "employee_name": g.employee.full_name,
            "department_name": g.employee.department.name if g.employee.department else None,
            "event_date": g.event_date.isoformat(),
            "request_type": g.request_type,
            "request_type_display": g.get_request_type_display(),
            "note": g.note,
            "overrode_existing_request": g.overrode_existing_request,
            "granted_by_name": g.granted_by.full_name if g.granted_by else None,
            "created_at": g.created_at.isoformat(),
            "revoked_at": g.revoked_at.isoformat() if g.revoked_at else None,
            "revoked_by_name": g.revoked_by.full_name if g.revoked_by else None,
        }

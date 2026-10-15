"""
hrm/shift_registration_views.py
════════════════════════════════
ViewSet cho "Đăng ký ca làm" theo tuần — KHÔNG qua duyệt, có hiệu lực ngay
khi lưu (miễn còn trong hạn: hết Thứ 7 tuần trước tuần đăng ký).

Chỉ áp dụng cho nhân viên thuộc phạm vi ShiftRegistrationScopeConfig (cấu
hình phòng ban/vị trí + 2 ca, sửa ở Django admin). Mỗi "ca" (Ca 1/Ca 2) là 1
CẶP (ca sáng, ca chiều) — không phải 1 ShiftConfig cho cả ngày — xem
shift_registration_models.py.

/api-hrm/shift-registrations/
    GET  scope-status/       – NV hiện tại có thuộc phạm vi không + thông tin
                               2 ca (mỗi ca gồm ca sáng + ca chiều).
    GET  team-overview/      – HR/Admin (toàn bộ NV trong phạm vi) hoặc quản lý trực
                               tiếp (chỉ cấp dưới trực tiếp trong phạm vi) xem lưới
                               đăng ký ca của cả nhóm trong 1 tuần. Nhóm đăng ký CẢ
                               TUẦN (requires_manager_approval=False, vd AI/IT) vẫn
                               CHỈ HR/Admin sửa hộ được (save()); nhóm đăng ký Ca 2
                               THEO NGÀY cần duyệt (requires_manager_approval=True,
                               vd Điều dưỡng) từ 2026-09-17 quản lý trực tiếp CŨNG
                               tự đăng ký/duyệt hộ được ngay trong bảng này (xem
                               day_id/status ở mỗi ngày trả về) — không cần rời
                               sang trang Phê duyệt riêng, theo yêu cầu HCNS.
    GET  ?employee_id=&week_start_date=  – danh sách đăng ký (HR/Admin xem được của NV khác).
    POST                      – upsert đăng ký cho 1 tuần (employee_id + week_start_date +
                               days=[{date, ca: 1|2|null}]); chỉ NV tự đăng ký cho mình
                               HOẶC HR/Admin sửa hộ — QLTT không được gọi API này thay cấp dưới.
"""
import logging
from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from employee.models import Employee

from .models import _is_hr, _has_approve_permission
from .shift_registration_models import (
    ShiftRegistrationScopeConfig,
    ShiftRegistration,
    ShiftRegistrationDay,
    shift_registration_deadline,
    day_registration_deadline,
)
from .shift_registration_serializers import ShiftRegistrationSerializer

logger = logging.getLogger(__name__)


def _shift_brief(shift):
    if not shift:
        return None
    return {
        "id": shift.id,
        "code": shift.code,
        "name": shift.name,
        "start_time": str(shift.start_time)[:5],
        "end_time": str(shift.end_time)[:5],
    }


def _ca_brief(config):
    """Mô tả 2 lựa chọn Ca 1/Ca 2 (mỗi ca gồm ca sáng + ca chiều) để FE hiển thị dropdown."""
    if not config:
        return {"ca_1": None, "ca_2": None}
    return {
        "ca_1": {
            "morning": _shift_brief(config.shift_1_morning),
            "afternoon": _shift_brief(config.shift_1_afternoon),
        },
        "ca_2": {
            "morning": _shift_brief(config.shift_2_morning),
            "afternoon": _shift_brief(config.shift_2_afternoon),
        },
    }


def _ca_labels(config):
    """Nhãn hiển thị 2 ô ca của ĐÚNG config — FE dùng để render nút/badge thay
    vì viết cứng "Ca 1"/"Ca 2" (mỗi team gọi khác nhau, xem model)."""
    return {
        "default_ca_label": (getattr(config, "default_ca_label", None) or "Ca 1"),
        "registrable_ca_label": (getattr(config, "registrable_ca_label", None) or "Ca 2"),
        # false => team này đã ngừng ca phải đăng ký, FE ẩn nút đăng ký.
        "registration_enabled": getattr(config, "registration_enabled", True) is not False,
    }


def _registration_disabled_response(config):
    return Response(
        {"error": f"Nhóm này đã ngừng áp dụng {config.registrable_ca_label or 'Ca 2'}, "
                  f"chỉ còn {config.default_ca_label or 'Ca 1'} — không đăng ký thêm được."},
        status=status.HTTP_403_FORBIDDEN,
    )


def _labels_for_employee(employee, cache=None):
    if cache is not None and employee.id in cache:
        return cache[employee.id]
    labels = _ca_labels(ShiftRegistrationScopeConfig.for_employee(employee))
    if cache is not None:
        cache[employee.id] = labels
    return labels


def _ca2_day_brief(day_obj, _label_cache=None):
    """Mô tả 1 đơn đăng ký Ca 2 theo ngày (mô hình requires_manager_approval) —
    dùng chung cho register-ca2/, my-ca2-requests/, pending-ca2-approvals/,
    approve-ca2/, reject-ca2/."""
    deadline = day_obj.registration_deadline
    return {
        "id": day_obj.id,
        "date": day_obj.date.isoformat(),
        "status": day_obj.status,
        "morning": _shift_brief(day_obj.morning_shift),
        "afternoon": _shift_brief(day_obj.afternoon_shift),
        "reviewed_by_name": day_obj.reviewed_by.full_name if day_obj.reviewed_by else None,
        "reviewed_at": day_obj.reviewed_at.isoformat() if day_obj.reviewed_at else None,
        # null với bản ghi tạo trước 2026-09-25 (lúc đó bảng chưa có cột này)
        "created_at": day_obj.created_at.isoformat() if day_obj.created_at else None,
        "review_note": day_obj.review_note,
        "registration_deadline": deadline.isoformat(),
        "is_past_deadline": timezone.now() >= deadline,
        **_labels_for_employee(day_obj.registration.employee, _label_cache),
    }


def _can_cancel_ca2(viewer, is_admin_or_hr, day_obj):
    """(được huỷ không, lý do nếu không) — huỷ 1 đơn đăng ký ca theo ngày đã
    duyệt/đang chờ khi nhân viên không làm ca đó nữa (yêu cầu 2026-10-06, vd
    QLTT duyệt Ca 1 cho nhân viên rồi nhân viên không làm).

    Cùng khung ngày với việc TẠO HỘ của QLTT (register_ca2): ngày tương lai,
    hoặc ngày đã qua trong 2 ngày làm việc gần nhất — QLTT tạo được tới đâu
    thì huỷ được tới đó. HCNS/Admin huỷ được mọi ngày.
    """
    if day_obj.status not in (ShiftRegistrationDay.Status.APPROVED, ShiftRegistrationDay.Status.PENDING):
        return False, "Chỉ huỷ được đơn đã duyệt hoặc đang chờ duyệt."
    if is_admin_or_hr:
        return True, None
    target = day_obj.registration.employee
    if target.manager_id != viewer.id:
        return False, "Chỉ quản lý trực tiếp hoặc HCNS được huỷ đơn này."
    if day_obj.date > timezone.localdate():
        return True, None
    from .deadline_utils import subtract_working_days
    if day_obj.date >= subtract_working_days(timezone.localdate(), 2, target):
        return True, None
    return False, ("Quá 2 ngày làm việc, quản lý trực tiếp không huỷ được nữa — "
                   "liên hệ HCNS để huỷ.")


class ShiftRegistrationViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def _get_employee(self, request):
        try:
            return Employee.objects.select_related('position', 'department').get(user=request.user)
        except Employee.DoesNotExist:
            return None

    def _is_admin_or_hr(self, request, employee):
        return bool(
            request.user.is_staff or request.user.is_superuser
            or (employee and _is_hr(employee))
            or (employee and _has_approve_permission(employee))
        )

    # ── Kiểm tra phạm vi áp dụng cho NV hiện tại ─────────────────────────────

    @action(detail=False, methods=["get"], url_path="scope-status")
    def scope_status(self, request):
        employee = self._get_employee(request)
        # Từ khi hỗ trợ NHIỀU config song song (mỗi nhóm phòng ban/vị trí/bác
        # sĩ phụ trách có thể có cặp Ca 1/Ca 2 khác nhau), "ca_1"/"ca_2" ở đây
        # LUÔN là của ĐÚNG config áp dụng cho NV hiện tại (for_employee) — nếu
        # NV không thuộc phạm vi của config nào, không còn 1 cặp "mặc định"
        # chung để hiển thị cho HR/Admin xem trước nữa (khác thiết kế singleton
        # cũ) — HR/Admin cần chọn đúng nhân viên cụ thể ở team-overview/create
        # để thấy đúng config áp dụng cho người đó.
        config = ShiftRegistrationScopeConfig.for_employee(employee) if employee else None
        in_scope = bool(config)
        is_admin_or_hr = self._is_admin_or_hr(request, employee)
        is_manager = bool(employee and employee.position and employee.position.is_management)
        all_configs = ShiftRegistrationScopeConfig.objects.filter(is_active=True) if is_admin_or_hr else []
        scope_departments = []
        seen_dept_ids = set()
        for c in all_configs:
            for d in c.departments.all().order_by('name'):
                if d.id not in seen_dept_ids:
                    seen_dept_ids.add(d.id)
                    scope_departments.append({"id": d.id, "name": d.name})
        return Response({
            "in_scope": in_scope,
            **(_ca_brief(config) if in_scope else {"ca_1": None, "ca_2": None}),
            # True => nhóm này KHÔNG đăng ký theo tuần nữa: Ca 1 mặc định cho
            # mọi ngày, muốn làm Ca 2 phải đăng ký riêng cho 1 ngày cụ thể và
            # chờ quản lý trực tiếp duyệt trước 0h ngày đó (xem register-ca2/,
            # my-ca2-requests/). FE dựa vào field này để chọn đúng UI.
            "requires_manager_approval": bool(config and config.requires_manager_approval),
            **_ca_labels(config),
            "is_admin_or_hr": is_admin_or_hr,
            "can_view_team_overview": bool(is_admin_or_hr or is_manager),
            # Gộp phòng ban của TẤT CẢ config đang bật (chỉ để HR/Admin xem
            # tổng quan phạm vi đang cấu hình — không đại diện cho 1 config
            # cụ thể nào).
            "scope_departments": scope_departments,
        })

    # ── Đăng ký Ca 2 theo NGÀY, cần quản lý trực tiếp duyệt trước 0h ────────
    # (chỉ áp dụng cho config có requires_manager_approval=True — khác hẳn
    # create() ở dưới, vốn đăng ký CẢ TUẦN và có hiệu lực ngay, không duyệt.)
    # 2026-09-18: nếu chính quản lý trực tiếp là người gọi register_ca2 (tạo
    # hộ nhân viên), tự động APPROVED luôn — họ là người DUY NHẤT có thẩm
    # quyền duyệt nên tạo hộ tức là đã quyết định rồi. Chỉ khi HR/Admin tạo
    # hộ (không phải quản lý trực tiếp) hoặc chính NV tự đăng ký mới còn ở
    # PENDING, chờ quản lý trực tiếp duyệt như cũ.

    def _get_target_employee(self, request, employee, is_admin_or_hr, employee_id, *,
                              for_write_label, allow_direct_manager=False):
        """Helper dùng chung cho các action tự-đăng-ký/tự-xem: NV chỉ được
        thao tác cho chính mình, trừ khi là Admin/HR (thao tác hộ) — hoặc,
        khi `allow_direct_manager=True` (dùng cho register_ca2, theo yêu cầu
        HCNS 2026-09-17 cho nhóm Điều dưỡng: quản lý trực tiếp cần tự đăng
        ký/sửa Ca 2 thay cho NV khi NV báo miệng nhưng quên/không tự thao
        tác được), quản lý trực tiếp của ĐÚNG nhân viên đó cũng được phép.
        Phạm vi tự nhiên bị giới hạn đúng nhóm áp dụng đăng ký Ca 2 (chỉ
        nhóm có ShiftRegistrationScopeConfig.requires_manager_approval=True
        — hiện tại là Điều dưỡng) vì action gọi hàm này (register_ca2) đã tự
        chặn nhóm khác ngay sau đó."""
        target_employee = employee
        if employee_id:
            if not is_admin_or_hr and str(employee.id) != str(employee_id):
                candidate = Employee.objects.filter(id=employee_id).first()
                is_direct_manager = bool(
                    allow_direct_manager and candidate and candidate.manager_id == employee.id
                )
                if not is_direct_manager:
                    return None, Response(
                        {"error": f"Bạn không có quyền {for_write_label} thay nhân viên khác"},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                target_employee = candidate
            else:
                target_employee = Employee.objects.filter(id=employee_id).first()
            if not target_employee:
                return None, Response({"error": "Employee not found"}, status=status.HTTP_400_BAD_REQUEST)
        return target_employee, None

    @action(detail=False, methods=["post"], url_path="register-ca2")
    def register_ca2(self, request):
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)
        is_admin_or_hr = self._is_admin_or_hr(request, employee)

        target_employee, err = self._get_target_employee(
            request, employee, is_admin_or_hr, request.data.get("employee_id"),
            for_write_label="đăng ký ca làm", allow_direct_manager=True,
        )
        if err:
            return err

        config = ShiftRegistrationScopeConfig.for_employee(target_employee)
        if not config or not config.requires_manager_approval:
            return Response(
                {"error": "Nhân viên không thuộc nhóm áp dụng đăng ký ca theo ngày."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not config.registration_enabled:
            return _registration_disabled_response(config)

        date_str = request.data.get("date")
        try:
            target_date = date.fromisoformat(str(date_str))
        except (TypeError, ValueError):
            return Response({"error": "date không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)

        # Chính quản lý trực tiếp của nhân viên là người tạo hộ hay không —
        # dùng CẢ cho quy tắc hạn ngày (ngay dưới) LẪN tự động duyệt (dưới nữa).
        is_direct_manager_creator = bool(target_employee.manager_id == employee.id)

        # Chỉ được đăng ký cho ngày TƯƠNG LAI — hạn chót là 0h ngày áp dụng
        # (day_registration_deadline), tương đương "phải đăng ký trước ngày
        # đó bắt đầu". Trừ 2 trường hợp được lùi lại ngày ĐÃ QUA:
        #   1. HCNS đã "mở khoá đặc biệt" cho đúng NV/ngày này (mọi người tạo).
        #   2. Chính quản lý trực tiếp tự tạo hộ — được lùi tối đa 2 NGÀY LÀM
        #      VIỆC gần nhất (không cần xin mở khoá riêng lẻ mỗi lần) — thực
        #      tế QLTT thường chỉ phát hiện sai Ca1/Ca2 sau 1-2 ngày khi xem
        #      lại chấm công (yêu cầu HCNS 2026-09-18). HR/Admin tạo hộ
        #      (KHÔNG phải quản lý trực tiếp) hoặc chính NV tự đăng ký thì
        #      KHÔNG có ưu đãi này, vẫn cần "mở khoá đặc biệt" như cũ.
        from .deadline_exception_models import has_deadline_exception
        date_blocked = False
        if target_date <= timezone.localdate():
            if has_deadline_exception(target_employee, target_date, "CA2"):
                date_blocked = False
            elif is_direct_manager_creator:
                from .deadline_utils import subtract_working_days
                earliest_allowed = subtract_working_days(timezone.localdate(), 2, target_employee)
                date_blocked = target_date < earliest_allowed
            else:
                date_blocked = True
        if date_blocked:
            return Response(
                {"error": f"Chỉ được đăng ký {config.registrable_ca_label or 'Ca 2'} cho ngày trong TƯƠNG LAI, hoặc ngày ĐÃ QUA "
                          "trong vòng 2 ngày làm việc gần nhất nếu chính quản lý trực tiếp tạo hộ. "
                          "Nếu đã báo quản lý nhưng quên tạo kịp trên HRM, liên hệ HCNS để được mở "
                          "khoá đặc biệt."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        week_start = target_date - timedelta(days=target_date.weekday())
        week_end = week_start + timedelta(days=6)
        registration, _created = ShiftRegistration.objects.get_or_create(
            employee=target_employee, week_start_date=week_start,
            defaults={"week_end_date": week_end},
        )
        day_obj, _ = ShiftRegistrationDay.objects.get_or_create(registration=registration, date=target_date)
        day_obj.apply_ca(config, 2)

        # Chính quản lý trực tiếp của nhân viên là người tạo hộ -> tự động
        # DUYỆT LUÔN (không cần bước "Duyệt" riêng nữa) — người duy nhất có
        # thẩm quyền duyệt Ca 2 chính là quản lý trực tiếp, nên họ tự tạo hộ
        # tức là đã quyết định rồi, bắt duyệt lại quyết định của chính mình
        # là thừa. Ngược lại — HR/Admin tạo hộ (KHÔNG phải quản lý trực tiếp
        # của người đó) hoặc chính nhân viên tự đăng ký — vẫn giữ PENDING,
        # chờ đúng quản lý trực tiếp duyệt (theo yêu cầu HCNS 2026-09-18).
        # (is_direct_manager_creator đã tính ở trên, dùng chung với check hạn.)
        if is_direct_manager_creator:
            day_obj.status = ShiftRegistrationDay.Status.APPROVED
            day_obj.reviewed_by = employee
            day_obj.reviewed_at = timezone.now()
            day_obj.review_note = "Tự động duyệt — quản lý trực tiếp tự tạo đơn hộ nhân viên."
        else:
            day_obj.status = ShiftRegistrationDay.Status.PENDING
            day_obj.reviewed_by = None
            day_obj.reviewed_at = None
            day_obj.review_note = ""
        day_obj.save()

        return Response(_ca2_day_brief(day_obj), status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["get"], url_path="ca2-day-status")
    def ca2_day_status(self, request):
        """Trạng thái Ca 2 của 1 nhân viên vào 1 ngày cụ thể — dùng cho modal
        "Chi tiết chấm công ngày" ở tab Nhân viên (AttendanceView.tsx) để
        hiển thị đúng trạng thái + cho quản lý trực tiếp/Admin/HR tạo hộ
        ngay tại đó (theo yêu cầu HCNS 2026-09-18: "cho tạo hộ ở màn này").
        Cùng quyền xem với register-ca2 (chính mình/quản lý trực tiếp/
        Admin/HR)."""
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)
        is_admin_or_hr = self._is_admin_or_hr(request, employee)

        target_employee, err = self._get_target_employee(
            request, employee, is_admin_or_hr, request.query_params.get("employee_id"),
            for_write_label="xem đăng ký ca làm", allow_direct_manager=True,
        )
        if err:
            return err

        date_str = request.query_params.get("date")
        try:
            target_date = date.fromisoformat(str(date_str))
        except (TypeError, ValueError):
            return Response({"error": "date không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)

        config = ShiftRegistrationScopeConfig.for_employee(target_employee)
        if not config or not config.requires_manager_approval:
            return Response({"in_scope": False})

        day_obj = ShiftRegistrationDay.objects.filter(
            registration__employee=target_employee, date=target_date,
        ).select_related('morning_shift', 'afternoon_shift', 'reviewed_by').first()

        if day_obj:
            can_cancel, _reason = _can_cancel_ca2(employee, is_admin_or_hr, day_obj)
            return Response({"in_scope": True, **_ca2_day_brief(day_obj), "can_cancel": can_cancel})

        deadline = day_registration_deadline(target_date)
        return Response({
            "in_scope": True,
            "id": None,
            "date": target_date.isoformat(),
            "status": None,
            "morning": None,
            "afternoon": None,
            "reviewed_by_name": None,
            "reviewed_at": None,
            "review_note": "",
            "registration_deadline": deadline.isoformat(),
            "is_past_deadline": timezone.now() >= deadline,
            "can_cancel": False,
            **_ca_labels(config),
        })

    @action(detail=False, methods=["get"], url_path="my-ca2-requests")
    def my_ca2_requests(self, request):
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        days = ShiftRegistrationDay.objects.filter(
            registration__employee=employee, ca_choice=2,
        ).select_related('morning_shift', 'afternoon_shift', 'reviewed_by').order_by('-date')[:60]
        return Response([_ca2_day_brief(d) for d in days])

    @action(detail=False, methods=["get"], url_path="pending-ca2-approvals")
    def pending_ca2_approvals(self, request):
        """Danh sách đơn Ca 2 mà người gọi có quyền duyệt — quản lý trực tiếp
        chỉ thấy cấp dưới trực tiếp của mình (đúng cơ chế khiến đơn này "chỉ
        phòng đó nhìn thấy", không cần lọc riêng theo phòng ban); Admin/HR
        thấy tất cả.

        `?status=` (PENDING mặc định | APPROVED | REJECTED) — bổ sung
        2026-09-23 để trang Phê duyệt hiển thị đơn Ca 2 xen kẽ trong cả 3 tab
        Chờ duyệt/Đã duyệt/Từ chối như mọi loại đơn khác, thay vì 1 khối riêng
        chỉ có đơn chờ duyệt (yêu cầu HCNS: "ca 2 cũng là 1 loại đơn thôi").
        Giữ mặc định PENDING để các nơi gọi cũ không đổi hành vi.
        """
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)
        is_admin_or_hr = self._is_admin_or_hr(request, employee)

        status_param = (request.query_params.get("status") or "PENDING").upper()
        valid_statuses = {s for s, _ in ShiftRegistrationDay.Status.choices}
        if status_param not in valid_statuses:
            return Response(
                {"error": f"status không hợp lệ, phải là 1 trong {sorted(valid_statuses)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = ShiftRegistrationDay.objects.filter(
            status=status_param, ca_choice=2,
        ).select_related(
            'registration__employee__department', 'registration__employee__position',
            'morning_shift', 'afternoon_shift',
        )
        if not is_admin_or_hr:
            qs = qs.filter(registration__employee__manager=employee)
        qs = qs.order_by('date')

        label_cache = {}
        return Response([
            {
                **_ca2_day_brief(d, label_cache),
                "employee_id": d.registration.employee_id,
                "employee_code": d.registration.employee.employee_id,
                "employee_name": d.registration.employee.full_name,
                "department_name": d.registration.employee.department.name if d.registration.employee.department else None,
                # Các trường dưới đây để đơn Ca 2 dùng chung được bộ lọc phạm vi
                # của trang Phê duyệt với mọi loại đơn khác (nó lọc theo
                # employee_manager_id / employee_department_manager_id). Thiếu
                # chúng thì tài khoản QLTT không thấy đơn Ca 2 nào cả, dù API
                # đã trả về đúng — bổ sung 2026-09-23.
                "employee_manager_id": d.registration.employee.manager_id,
                "employee_department_manager_id": (
                    d.registration.employee.department.manager_id
                    if d.registration.employee.department else None
                ),
                "employee_position": (
                    d.registration.employee.position.title
                    if d.registration.employee.position else None
                ),
            }
            for d in qs
        ])

    def _review_ca2_day(self, request, pk, new_status):
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        day_obj = ShiftRegistrationDay.objects.filter(
            pk=pk, ca_choice=2,
        ).select_related('registration__employee', 'morning_shift', 'afternoon_shift').first()
        if not day_obj:
            return Response({"error": "Không tìm thấy đơn đăng ký ca"}, status=status.HTTP_404_NOT_FOUND)

        is_admin_or_hr = self._is_admin_or_hr(request, employee)
        is_direct_mgr = day_obj.registration.employee.manager_id == employee.id
        if not (is_admin_or_hr or is_direct_mgr):
            return Response({"error": "Bạn không có quyền duyệt đơn này"}, status=status.HTTP_403_FORBIDDEN)

        if day_obj.status != ShiftRegistrationDay.Status.PENDING:
            return Response(
                {"error": f"Đơn này đã ở trạng thái {day_obj.status}, không thể duyệt/từ chối lại."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .deadline_exception_models import has_deadline_exception
        if day_obj.is_past_deadline and not has_deadline_exception(day_obj.registration.employee, day_obj.date, "CA2"):
            return Response(
                {"error": f"Đã quá hạn duyệt (phải duyệt trước 0h ngày {day_obj.date.strftime('%d/%m/%Y')}). "
                          f"Liên hệ HCNS để được mở khoá đặc biệt nếu cần."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        day_obj.status = new_status
        day_obj.reviewed_by = employee
        day_obj.reviewed_at = timezone.now()
        day_obj.review_note = str(request.data.get("note", ""))[:500]
        day_obj.save()
        return Response(_ca2_day_brief(day_obj))

    @action(detail=True, methods=["post"], url_path="approve-ca2")
    def approve_ca2(self, request, pk=None):
        return self._review_ca2_day(request, pk, ShiftRegistrationDay.Status.APPROVED)

    @action(detail=True, methods=["post"], url_path="reject-ca2")
    def reject_ca2(self, request, pk=None):
        return self._review_ca2_day(request, pk, ShiftRegistrationDay.Status.REJECTED)

    @action(detail=True, methods=["post"], url_path="cancel-ca2")
    def cancel_ca2(self, request, pk=None):
        """Huỷ đơn đăng ký ca theo ngày đã duyệt/đang chờ -> ngày đó quay về ca
        mặc định. Không xoá bản ghi: giữ lại ai duyệt trước đó trong ghi chú để
        đối chiếu; muốn làm lại thì đăng ký lại như bình thường."""
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        day_obj = ShiftRegistrationDay.objects.filter(pk=pk).select_related(
            'registration__employee', 'morning_shift', 'afternoon_shift', 'reviewed_by',
        ).first()
        if not day_obj:
            return Response({"error": "Không tìm thấy đơn đăng ký ca"}, status=status.HTTP_404_NOT_FOUND)
        config = ShiftRegistrationScopeConfig.for_employee(day_obj.registration.employee)
        if not config or not config.requires_manager_approval:
            return Response({"error": "Nhân viên không thuộc nhóm đăng ký ca theo ngày."},
                            status=status.HTTP_400_BAD_REQUEST)

        is_admin_or_hr = self._is_admin_or_hr(request, employee)
        ok, reason = _can_cancel_ca2(employee, is_admin_or_hr, day_obj)
        if not ok:
            code = status.HTTP_400_BAD_REQUEST if day_obj.status not in (
                ShiftRegistrationDay.Status.APPROVED, ShiftRegistrationDay.Status.PENDING,
            ) else status.HTTP_403_FORBIDDEN
            return Response({"error": reason}, status=code)

        if day_obj.status == ShiftRegistrationDay.Status.APPROVED and day_obj.reviewed_by:
            truoc = (f"trước đó đã duyệt bởi {day_obj.reviewed_by.full_name}"
                     f" lúc {timezone.localtime(day_obj.reviewed_at):%H:%M %d/%m/%Y}" if day_obj.reviewed_at else
                     f"trước đó đã duyệt bởi {day_obj.reviewed_by.full_name}")
        else:
            truoc = f"trước đó {day_obj.get_status_display().lower()}"
        note = str(request.data.get("note", "") or "").strip()
        day_obj.status = ShiftRegistrationDay.Status.CANCELLED
        day_obj.reviewed_by = employee
        day_obj.reviewed_at = timezone.now()
        day_obj.review_note = f"Đã huỷ{': ' + note if note else ''} ({truoc})"[:500]
        day_obj.save()
        return Response({**_ca2_day_brief(day_obj), "can_cancel": False})

    # ── Team overview (HR/Admin/QLTT — CHỈ XEM) ──────────────────────────────

    @action(detail=False, methods=["get"], url_path="team-overview")
    def team_overview(self, request):
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin_or_hr = self._is_admin_or_hr(request, employee)
        is_manager = bool(employee.position and employee.position.is_management)
        if not is_admin_or_hr and not is_manager:
            return Response({"error": "Bạn không có quyền xem trang này"}, status=status.HTTP_403_FORBIDDEN)

        week_start_str = request.query_params.get("week_start_date")
        try:
            week_start = date.fromisoformat(str(week_start_str))
        except (TypeError, ValueError):
            return Response({"error": "week_start_date không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)
        if week_start.weekday() != 0:
            return Response({"error": "week_start_date phải là Thứ 2"}, status=status.HTTP_400_BAD_REQUEST)
        week_dates = [week_start + timedelta(days=i) for i in range(7)]

        active_configs = list(ShiftRegistrationScopeConfig.objects.filter(is_active=True))
        if not active_configs:
            return Response([])

        # Có thể có NHIỀU config song song (mỗi nhóm phòng ban/vị trí/bác sĩ
        # phụ trách có thể có cặp Ca 1/Ca 2 riêng) — 1 nhân viên thuộc phạm vi
        # nếu khớp ĐỦ điều kiện của BẤT KỲ config nào (OR giữa các config), y
        # hệt ShiftRegistrationScopeConfig.employee_in_scope() cho từng config
        # riêng lẻ: phòng ban + vị trí LUÔN bắt buộc; bác sĩ phụ trách chỉ
        # bắt buộc thêm khi config có điền doctor_teams (để trống = không lọc
        # theo bác sĩ phụ trách — dùng cho phòng ban không liên quan bác sĩ).
        scope_q = Q(pk__in=[])
        for config in active_configs:
            dept_ids = list(config.departments.values_list('id', flat=True))
            pos_ids = list(config.positions.values_list('id', flat=True))
            base_q = Q(department_id__in=dept_ids) & Q(position_id__in=pos_ids)
            doctor_teams = config.doctor_team_list()
            if doctor_teams:
                doctor_q = Q()
                for team in doctor_teams:
                    doctor_q |= Q(doctor_team__iexact=team)
                base_q &= doctor_q
            scope_q |= base_q

        if is_admin_or_hr:
            employees_qs = Employee.objects.filter(scope_q, is_active=True)
            department_id = request.query_params.get("department_id")
            if department_id:
                employees_qs = employees_qs.filter(department_id=department_id)
        else:
            # Quản lý trực tiếp — CHỈ thấy cấp dưới trực tiếp đang trong phạm vi.
            employees_qs = Employee.objects.filter(scope_q, manager=employee, is_active=True)

        employees_qs = employees_qs.select_related('department', 'position').order_by('employee_id')

        regs = ShiftRegistration.objects.filter(
            employee__in=employees_qs, week_start_date=week_start,
        ).select_related('employee').prefetch_related('days__morning_shift', 'days__afternoon_shift')
        regs_by_employee = {r.employee_id: r for r in regs}
        deadline = shift_registration_deadline(week_start)

        result = []
        for emp in employees_qs:
            reg = regs_by_employee.get(emp.id)
            days_by_date = {d.date: d for d in reg.days.all()} if reg else {}
            emp_config = ShiftRegistrationScopeConfig.for_employee(emp)
            emp_requires_approval = bool(emp_config and emp_config.requires_manager_approval)
            days_payload = []
            for d in week_dates:
                day_obj = days_by_date.get(d)
                if day_obj is None:
                    days_payload.append({
                        "date": d.isoformat(), "registered": False, "ca_choice": None,
                        "morning_shift_code": None, "afternoon_shift_code": None,
                        # Chưa có bản ghi -> chưa có gì để duyệt/từ chối, và
                        # cũng chưa "quá hạn" theo nghĩa có đơn bị treo — FE
                        # tự so registration_deadline (dưới) với ngày này để
                        # quyết định còn bấm "+ Ca 2" được không.
                        "day_id": None, "status": None, "is_past_deadline": None,
                        "reviewed_by_name": None, "can_cancel": False,
                    })
                else:
                    days_payload.append({
                        "date": d.isoformat(), "registered": True, "ca_choice": day_obj.ca_choice,
                        "morning_shift_code": day_obj.morning_shift.code if day_obj.morning_shift else None,
                        "afternoon_shift_code": day_obj.afternoon_shift.code if day_obj.afternoon_shift else None,
                        # Thêm 2026-09-17 để FE (team-overview) render được nút
                        # duyệt/từ chối/đăng ký Ca 2 ngay trong bảng cho quản lý
                        # trực tiếp, không cần rời sang trang Phê duyệt riêng —
                        # chỉ có ý nghĩa với nhóm requires_manager_approval=True
                        # (Điều dưỡng); nhóm cũ (đăng ký tuần, apply_ca() không
                        # set status khác default) status luôn là APPROVED nên
                        # vô hại khi FE bỏ qua không dùng tới các field này.
                        "day_id": day_obj.id,
                        "status": day_obj.status,
                        "is_past_deadline": timezone.now() >= day_obj.registration_deadline,
                        "reviewed_by_name": day_obj.reviewed_by.full_name if day_obj.reviewed_by else None,
                        # Nút "Huỷ" (cancel-ca2) — chỉ nhóm đăng ký theo ngày.
                        "can_cancel": bool(
                            emp_requires_approval
                            and _can_cancel_ca2(employee, is_admin_or_hr, day_obj)[0]
                        ),
                    })
            # Mỗi NV có thể thuộc config khác nhau (Ca 1/Ca 2 khác nhau) — nhúng
            # thẳng ca_1/ca_2 ĐÚNG CỦA NGƯỜI ĐÓ vào từng dòng, để FE (màn "sửa
            # hộ") dùng đúng lựa chọn của nhân viên đang sửa, không lấy nhầm
            # theo cấu hình của người xem (HR/QLTT) hay của nhân viên khác.
            result.append({
                "employee_id": emp.id,
                "employee_code": emp.employee_id,
                "employee_name": emp.full_name,
                "department_name": emp.department.name if emp.department else None,
                "position_name": emp.position.title if emp.position else None,
                "has_registration": reg is not None,
                "registration_deadline": deadline.isoformat(),
                "is_past_deadline": timezone.now() > deadline,
                # True => dòng này thuộc nhóm "mặc định Ca 1, đăng ký Ca 2 theo
                # NGÀY cần quản lý trực tiếp duyệt" — FE render nút duyệt/đăng
                # ký hộ theo ngày (register-ca2/approve-ca2) thay vì ô chọn Ca
                # cả tuần (save()), vốn bị chặn 403 cho nhóm này (xem create()).
                "requires_manager_approval": emp_requires_approval,
                "days": days_payload,
                **_ca_brief(emp_config),
                **_ca_labels(emp_config),
            })
        return Response(result)

    # ── List ──────────────────────────────────────────────────────────────

    def list(self, request):
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin_or_hr = self._is_admin_or_hr(request, employee)

        employee_id = request.query_params.get("employee_id")
        target_employee = employee
        if employee_id:
            if not is_admin_or_hr and str(employee.id) != str(employee_id):
                return Response({"error": "Bạn không có quyền xem đăng ký ca làm của nhân viên khác"},
                                 status=status.HTTP_403_FORBIDDEN)
            target_employee = Employee.objects.filter(id=employee_id).first()
            if not target_employee:
                return Response({"error": "Employee not found"}, status=status.HTTP_400_BAD_REQUEST)

        qs = ShiftRegistration.objects.filter(employee=target_employee).prefetch_related(
            'days__morning_shift', 'days__afternoon_shift',
        )

        week_start_date = request.query_params.get("week_start_date")
        if week_start_date:
            qs = qs.filter(week_start_date=week_start_date)

        qs = qs.order_by('-week_start_date')[:12]
        return Response(ShiftRegistrationSerializer(qs, many=True).data)

    # ── Create/Upsert ─────────────────────────────────────────────────────

    def create(self, request):
        employee = self._get_employee(request)
        if not employee:
            return Response({"error": "Employee profile not found"}, status=status.HTTP_400_BAD_REQUEST)

        is_admin_or_hr = self._is_admin_or_hr(request, employee)

        employee_id = request.data.get("employee_id")
        target_employee = employee
        if employee_id:
            if not is_admin_or_hr and str(employee.id) != str(employee_id):
                return Response({"error": "Bạn không có quyền đăng ký ca làm thay nhân viên khác"},
                                 status=status.HTTP_403_FORBIDDEN)
            target_employee = Employee.objects.filter(id=employee_id).first()
            if not target_employee:
                return Response({"error": "Employee not found"}, status=status.HTTP_400_BAD_REQUEST)

        config = ShiftRegistrationScopeConfig.for_employee(target_employee)
        if not config:
            return Response(
                {"error": "Nhân viên không thuộc phạm vi áp dụng đăng ký ca làm"},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not config.registration_enabled:
            return _registration_disabled_response(config)

        # Scope dùng mô hình "mặc định Ca 1, đăng ký Ca 2 theo NGÀY cần duyệt"
        # (requires_manager_approval=True) KHÔNG được dùng flow đăng ký CẢ
        # TUẦN, có hiệu lực NGAY, không qua duyệt này — nếu cho phép, NV có
        # thể tự đăng ký Ca 2 (status mặc định 'APPROVED' vì apply_ca() không
        # set status) mà bỏ qua hoàn toàn bước quản lý trực tiếp duyệt. Dùng
        # register-ca2/ (qua Chấm công > chọn ngày > Đơn đăng ký) thay thế.
        if config.requires_manager_approval:
            return Response(
                {"error": "Nhóm này dùng mô hình đăng ký khác: mặc định Ca 1 cho mọi ngày, "
                          "muốn làm Ca 2 đăng ký theo từng ngày ở Chấm công > chọn ngày > "
                          "Đơn đăng ký (cần quản lý trực tiếp duyệt trước 0h ngày áp dụng)."},
                status=status.HTTP_403_FORBIDDEN,
            )

        week_start_str = request.data.get("week_start_date")
        try:
            week_start = date.fromisoformat(str(week_start_str))
        except (TypeError, ValueError):
            return Response({"error": "week_start_date không hợp lệ"}, status=status.HTTP_400_BAD_REQUEST)
        if week_start.weekday() != 0:
            return Response({"error": "week_start_date phải là Thứ 2"}, status=status.HTTP_400_BAD_REQUEST)

        if not is_admin_or_hr:
            deadline = shift_registration_deadline(week_start)
            if timezone.now() > deadline:
                return Response(
                    {"error": f"Đã quá hạn đăng ký ca làm cho tuần {week_start.isoformat()} "
                              f"(hạn hết Thứ 7 tuần trước, {deadline.strftime('%d/%m/%Y %H:%M')})."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        days_payload = request.data.get("days", [])
        if not isinstance(days_payload, list):
            return Response({"error": "days phải là danh sách"}, status=status.HTTP_400_BAD_REQUEST)

        valid_ca_choices = config.valid_ca_choices()
        week_end = week_start + timedelta(days=6)
        parsed_days = {}
        for item in days_payload:
            d_str = item.get("date")
            ca = item.get("ca")
            try:
                d = date.fromisoformat(str(d_str))
            except (TypeError, ValueError):
                return Response({"error": f"Ngày không hợp lệ: {d_str}"}, status=status.HTTP_400_BAD_REQUEST)
            if not (week_start <= d <= week_end):
                return Response({"error": f"Ngày {d_str} không thuộc tuần đăng ký"}, status=status.HTTP_400_BAD_REQUEST)
            if ca is not None and int(ca) not in valid_ca_choices:
                return Response({"error": f"Ca không hợp lệ cho ngày {d_str}"}, status=status.HTTP_400_BAD_REQUEST)
            parsed_days[d] = int(ca) if ca is not None else None

        registration, _created = ShiftRegistration.objects.update_or_create(
            employee=target_employee,
            week_start_date=week_start,
            defaults={"week_end_date": week_end},
        )
        for d, ca in parsed_days.items():
            day_obj, _ = ShiftRegistrationDay.objects.get_or_create(registration=registration, date=d)
            day_obj.apply_ca(config, ca)
            day_obj.save()

        registration.refresh_from_db()
        return Response(ShiftRegistrationSerializer(registration).data, status=status.HTTP_200_OK)

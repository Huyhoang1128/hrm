"""Đối soát vi phạm quanh đơn Nghỉ phép tháng (có lương) và Nghỉ không phép
(không lương) — yêu cầu HCNS 2026-10-06 (chị Dung).

Phân loại lỗi thành 2 nhóm theo NGƯỜI CHỊU TRÁCH NHIỆM:

  LỖI NHÂN VIÊN
    - NO_REQUEST       : ngày nghỉ/vắng nhưng không có đơn nào trong HRM
    - LATE_CREATED     : nhân sự tạo đơn muộn. Gồm CẢ HAI đường ghi nhận được:
                         tạo được nhưng sau hạn, và bấm tạo nhưng bị hệ thống
                         chặn (BlockedRequestAttempt). Trước 2026-10-12 tách
                         thành 2 mã nhưng hành vi y hệt nhau — việc tách chỉ
                         phản ánh đường kỹ thuật nào bắt được, nên đã gộp.
                         Dòng từ đường bị chặn mang cờ `had_blocked_attempt`.

  LỖI QUẢN LÝ
    - NOT_APPROVED     : nhân sự tạo đúng hạn nhưng đơn vẫn chưa được duyệt
    - APPROVED_LATE    : quản lý trực tiếp duyệt SAU hạn

Quy tắc loại trừ do HCNS chốt: đơn đột xuất đã được HCNS "Mở khoá đặc biệt"
(DeadlineExceptionGrant) MÀ nhân sự tạo + quản lý duyệt đều đúng hạn thì bỏ
qua hoàn toàn; còn nếu đã mở khoá nhưng vẫn tạo/duyệt sai thì VẪN tính lỗi.

Mốc hạn ưu tiên đọc snapshot `data['advance_deadline']` lưu lúc tạo đơn. KHÔNG
tính lại khi đã có snapshot — tính lại thì mỗi lần đổi luật là số liệu các tháng
cũ đổi theo (đã xảy ra với đơn nghỉ không phép khi đổi luật 28/09/2026).

Nhưng khi KHÔNG có snapshot thì từ 2026-10-12 có tính lại (cờ
`deadline_recomputed`), vì bỏ qua là tạo ra lỗ miễn trừ vĩnh viễn: đo ngày
2026-10-12 trên dữ liệu 01/09–31/10 thì 747/1.117 đơn nghỉ (66%) không có
snapshot, riêng đơn Nghỉ không phép là 660/733 (90%) — tức loại hay tạo muộn
nhất gần như không bao giờ bị gắn lỗi "tạo đơn quá hạn". Việc tính lại tôn
trọng PHIÊN BẢN LUẬT lúc tạo đơn (unauthorized_absence_uses_leave_rule), nên
không lặp lại sự cố 28/09.
"""
import datetime as _dt

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Employee
from employee.schedule import ScheduleResolver

from .deadline_exception_models import DeadlineExceptionGrant
from .event_models import EmployeeEvent
from .models import _is_hr_or_admin_broad
# Import cả MODULE (không phải từng giá trị) để ngày hiệu lực luôn đọc tươi —
# import theo giá trị sẽ chụp ảnh lúc khởi động, lệch với penalty_config nếu
# ai đó gán lại lúc chạy (và làm kết quả test sai).
from . import penalty_config as _pc
from .violation_models import BlockedRequestAttempt

# Hai loại đơn trong phạm vi báo cáo, kèm nhãn "có lương / không lương" mà
# HCNS dùng trong văn bản.
PAID_LEAVE = "LEAVE"                        # Nghỉ phép tháng — CÓ lương
UNPAID_LEAVE = "UNAUTHORIZED_ABSENCE"       # Nghỉ không phép — KHÔNG lương
# Tăng ca vào bảng từ 2026-10-14 (HCNS: "đơn tăng ca cũng phải cảnh báo
# phạt nhé"). Hạn của nó KHÁC HẲN đơn nghỉ: phải tạo VÀ được duyệt xong trước
# 2 GIỜ so với giờ bắt đầu ca — xem deadline_utils.overtime_deadline_for.
# Đừng nhầm với mốc "10h sáng hôm sau": đó là hạn QLTT SỬA GIỜ của đơn đã có
# (manager_attendance_fix_deadline), không phải hạn tạo/duyệt.
OVERTIME = "OVERTIME"

TYPE_LABEL = {
    PAID_LEAVE: "Nghỉ phép tháng (có lương)",
    UNPAID_LEAVE: "Nghỉ không phép (không lương)",
    OVERTIME: "Tăng ca",
}

# Mỗi loại đơn nằm ở event_type nào — dùng để lọc ngay ở tầng truy vấn.
_EVENT_TYPE_OF = {
    PAID_LEAVE: "explanation",
    UNPAID_LEAVE: "unauthorized_absence",
    OVERTIME: "overtime",
}

# ─────────────────────────────────────────────────────────────────────────────
# LOẠI ĐƠN ĐƯA VÀO BẢNG. Tăng ca hiện ẨN HẲN — HCNS 2026-10-14: "bạn cứ ẩn
# hẳn cả cảnh báo nhé", sau khi thấy nó có 2 mốc hạn dễ nhầm (tạo/duyệt trước
# 2 giờ vs sửa giờ 10h sáng hôm sau) và 141/335 đơn onsite tháng 9 chưa từng
# được đối soát giờ thực tế.
#
# BẬT LẠI chỉ cần thêm OVERTIME vào tập này — toàn bộ phần tính hạn, gộp dòng
# và test cho tăng ca vẫn còn nguyên, cố ý không xoá. Khi bật lại nhớ xem tiếp
# penalty_config.WARN_ONLY_REQUEST_TYPES: nó quyết định tăng ca ra tiền hay chỉ
# cảnh báo, và hiện đang để "chỉ cảnh báo".
# ─────────────────────────────────────────────────────────────────────────────
REPORTED_REQUEST_TYPES = frozenset({PAID_LEAVE, UNPAID_LEAVE})

# Chỉ hiện vi phạm TỪ ngày hiệu lực trở đi. HCNS 2026-10-14: "ẩn hết các lỗi
# của ngày trước 14/10 đi nhé bạn. Hôm nay mới tính."
#
# Trước đó các dòng cũ vẫn hiện với mức 0 đ để đối soát lịch sử; nay ẩn hẳn, nên
# tháng 9 sẽ ra BẢNG RỖNG. Dữ liệu không mất đi đâu — đổi cờ này về False là
# thấy lại toàn bộ.
HIDE_ROWS_BEFORE_EFFECTIVE_DATE = True

VIOLATION_LABEL = {
    "NO_REQUEST": "Nghỉ không tạo đơn",
    "LATE_CREATED": "Tạo đơn quá hạn",
    "NOT_APPROVED": "Chưa duyệt đơn",
    "APPROVED_LATE": "Duyệt đơn quá hạn",
    "HALF_DAY_ONLY": "Nghỉ cả ngày nhưng chỉ có đơn nửa ngày",
}

EMPLOYEE_FAULTS = {"NO_REQUEST", "LATE_CREATED", "HALF_DAY_ONLY"}

# Loại đơn KHÔNG giải thích được việc vắng mặt cả ngày, nên không được dùng để
# miễn lỗi "Nghỉ không tạo đơn". Đăng ký tăng ca cho ngày mai rồi nghỉ cả ngày
# thì ngày đó vẫn là nghỉ không khai báo — trước 2026-10-12 BẤT KỲ đơn nào cũng
# miễn, nên đây là đường lách không mất gì và không cần xin ai.
#
# ⚠️ CỐ Ý KHÔNG đưa vào đây: online_work, off_duty, explanation/FIRST_DAY,
# explanation/INCOMPLETE_ATTENDANCE. Đó đúng là các trường hợp ĐI LÀM THẬT mà
# không có lượt quẹt nào (làm online / ngày đầu chưa có thẻ / quên quẹt thẻ đã
# giải trình), mà _from_absent_days chỉ chạy đúng vào ngày 0 lượt quẹt — bỏ che
# mấy loại đó là phạt đúng những người đã khai báo tử tế. Số đo 01/09–30/10:
# online_work 35 ngày, FIRST_DAY 17, INCOMPLETE_ATTENDANCE 1 sẽ bị phạt oan.
# `live` (6 ngày) và `night_shift` đang để nguyên, chờ HCNS quyết.
NON_COVERING_EVENT_TYPES = ("overtime",)

# Đơn nửa ngày chỉ che ĐÚNG nửa ngày. Đủ cả 2 buổi mới tương đương đơn cả ngày.
_HALF_BOTH = frozenset({"MORNING", "AFTERNOON"})

# Một ngày nghỉ chỉ được tính MỘT lỗi cho mỗi bên (nhân viên / quản lý) —
# trước đây 1 người vừa bị chặn tạo đơn vừa không quẹt thẻ thì ra 2 dòng
# = 1.000.000 đ cho đúng một ngày nghỉ. HCNS chốt 2026-10-09: "gộp thành
# 1 lỗi, ưu tiên Nghỉ không tạo đơn". Số nhỏ = được giữ lại.
VIOLATION_PRIORITY = {
    "NO_REQUEST": 0,
    "HALF_DAY_ONLY": 1,
    "LATE_CREATED": 1,
    "APPROVED_LATE": 2,
    "NOT_APPROVED": 3,
}


def _leave_style_label(d, span):
    """Nghỉ cả ngày / nửa ngày sáng hay chiều / nhiều ngày — hiện thẳng trên bảng.

    HCNS 2026-10-14 hỏi "sao cái này lại hạn 9h 14/10 nhỉ?" cho một đơn nghỉ
    CHIỀU: hạn nửa ngày là giờ vào ca − 4h (09:00 cùng ngày), còn nghỉ cả ngày
    thì 17h30 HÔM TRƯỚC — lệch nhau 15,5 tiếng. Không ghi rõ nửa ngày hay cả
    ngày thì nhìn cột Hạn không hiểu nổi vì sao hai dòng cùng ngày lại khác mốc.
    """
    exp = str(d.get("expected_status") or "").upper()
    if exp == "HALF_DAY":
        period = str(d.get("half_day_period") or "").strip().upper()
        if period == "MORNING":
            return "Nửa ngày · Sáng"
        if period == "AFTERNOON":
            return "Nửa ngày · Chiều"
        return "Nửa ngày"
    lo, hi = span if span else (None, None)
    if lo and hi and lo != hi:
        # Bỏ khoảng ngày khỏi nhãn: nó hiện dưới dạng BADGE cạnh ngày nghỉ trên
        # màn hẹp (HCNS 2026-10-14), mà mỗi ngày của đợt nghỉ vốn đã là một
        # dòng riêng nên khoảng ngày nhìn bảng là thấy.
        return f"{(hi - lo).days + 1} ngày"
    return "1 ngày"


def _parse_dt(value):
    if not value:
        return None
    try:
        return _dt.datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def _merge_note(row):
    """Câu ghi thêm vào dòng ĐƯỢC GIỮ, mô tả dòng bị gộp bỏ — để không mất
    thông tin khi 1 ngày nghỉ ra nhiều lỗi (xem VIOLATION_PRIORITY)."""
    code = row.get("violation_code")
    # Nhận biết qua CỜ chứ không qua mã: từ 2026-10-12 dòng bị chặn cũng mang mã
    # LATE_CREATED, nếu dò theo mã thì mất câu bằng chứng "đã bấm tạo đơn lúc…",
    # mà đó đúng là thứ phân biệt người đã cố gắng với người quên hẳn.
    if row.get("had_blocked_attempt"):
        at = _parse_dt(row.get("created_at"))
        when = timezone.localtime(at).strftime("%H:%M %d/%m") if at else "?"
        return f"(Đã bấm tạo đơn lúc {when} nhưng bị hệ thống chặn vì quá hạn.)"
    return f"(Còn bị tính thêm: {VIOLATION_LABEL.get(code, code)}.)"


def _month_range(year: int, month: int):
    first = _dt.date(year, month, 1)
    last = (_dt.date(year + 1, 1, 1) if month == 12
            else _dt.date(year, month + 1, 1)) - _dt.timedelta(days=1)
    return first, last


def viewer_scope(user, viewer):
    """Ai được xem những dòng nào.

    HCNS chốt 2026-10-12: "ai cũng có thể xem lỗi của người đó (hoặc lỗi của
    quản lý liên quan đến đơn của người đó). Quản lý thì xem được toàn bộ lỗi
    của bản thân và team mình".

    Trả (mã phạm vi, tập employee_id được xem hoặc None = toàn công ty).

    Lọc theo `employee_id` của DÒNG — tức người NGHỈ, không phải người chịu
    trách nhiệm. Nhờ vậy nhân viên tự động thấy luôn dòng "lỗi quản lý" phát
    sinh trên chính đơn của mình, đúng yêu cầu, mà không cần luật riêng.
    """
    if _is_hr_or_admin_broad(user, viewer):
        return "ALL", None
    if not viewer:
        return "NONE", set()

    from django.db.models import Q
    subs = set(
        Employee.objects
        .filter(Q(manager=viewer) | Q(department__manager=viewer))
        .values_list("id", flat=True)
    )
    if subs:
        return "TEAM", subs | {viewer.id}
    return "SELF", {viewer.id}


class LeaveViolationReportView(APIView):
    """GET /api-hrm/violation-report/?year=&month=[&department_id=]

    Chỉ HCNS/Admin — báo cáo này gom dữ liệu toàn công ty và gắn với mức phạt.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        viewer = Employee.objects.filter(user=request.user).first()
        scope, emp_ids = viewer_scope(request.user, viewer)
        if scope == "NONE":
            return Response(
                {"error": "Tài khoản chưa gắn hồ sơ nhân viên nên không xem được báo cáo."},
                status=status.HTTP_403_FORBIDDEN,
            )
        can_manage = scope == "ALL"      # chỉ HCNS/Admin được áp/gỡ phạt
        try:
            year = int(request.query_params.get("year") or timezone.localdate().year)
            month = int(request.query_params.get("month") or timezone.localdate().month)
        except (TypeError, ValueError):
            return Response({"error": "year/month phải là số"}, status=status.HTTP_400_BAD_REQUEST)
        if not (1 <= month <= 12):
            return Response({"error": "month phải từ 1 đến 12"}, status=status.HTTP_400_BAD_REQUEST)

        first, last = _month_range(year, month)
        dept_id = request.query_params.get("department_id")

        effective_date = _pc.resolve_effective_date(
            request.query_params.get("preview_effective_date")
        )
        preview_mode = effective_date != _pc.PENALTY_EFFECTIVE_DATE
        rows = self.compute_rows(first, last, dept_id, emp_ids, effective_date)

        # Gom theo người chịu trách nhiệm để HCNS cộng tiền phạt theo đầu người.
        by_person = {}
        for r in rows:
            key = (r["fault_side"], r["responsible_id"])
            g = by_person.setdefault(key, {
                "fault_side": r["fault_side"],
                "employee_id": r["responsible_id"],
                "employee_code": r["responsible_code"],
                "employee_name": r["responsible_name"],
                "department_name": r["responsible_department"],
                "violation_count": 0,
                "penalty_total": 0,
                "violations": [],
            })
            g["violation_count"] += 1
            g["penalty_total"] += r.get("penalty_amount") or 0
            g["violations"].append(r)

        groups = sorted(by_person.values(),
                        key=lambda g: (-g["violation_count"], g["employee_name"] or ""))
        return Response({
            "year": year,
            "month": month,
            # Phạm vi người xem đang thấy — FE ghi rõ để không ai tưởng đây là
            # số liệu toàn công ty.
            "scope": scope,
            "can_manage_penalty": can_manage,
            "generated_at": timezone.now().isoformat(),
            "summary": {
                # Đơn đang chờ HCNS duyệt nốt KHÔNG nằm trong rows (xem
                # _from_requests) nên không lọt vào con số này.
                "total_violations": len(rows),
                "total_rows": len(rows),
                "employee_faults": sum(1 for r in rows if r["fault_side"] == "EMPLOYEE"),
                "manager_faults": sum(1 for r in rows if r["fault_side"] == "MANAGER"),
                "by_type": {
                    code: sum(1 for r in rows if r["violation_code"] == code)
                    for code in VIOLATION_LABEL
                },
                # Ngày thứ 7: không phải phòng ban nào cũng làm -> HCNS nên rà lại
                "saturday_rows": sum(1 for r in rows if r.get("is_saturday")),
                # Đơn KHÔNG kết luận được vì tạo trước khi hệ thống lưu mốc hạn.
                # Không nằm trong `rows` — nêu ra để HCNS biết báo cáo tháng cũ
                # còn thiếu, chứ không im lặng bỏ qua.
                "undetermined_requests": self._count_undetermined(first, last, dept_id, emp_ids),
                # Số dòng có "Mở khoá đặc biệt". Từ 2026-10-12 các dòng này VẪN
                # nằm trong `rows` (chỉ không tự ra tiền) — tên khoá giữ nguyên
                # để không vỡ frontend đang đọc.
                "granted_skipped": self._granted_skipped,
                # ── Tiền phạt (CHỈ cảnh báo, không ghi vào lương) ────────
                "penalty_configured": effective_date is not None,
                "penalty_effective_date": (
                    effective_date.isoformat() if effective_date else None
                ),
                # Đang xem thử với mốc khác mốc thật -> giao diện và tên file
                # Excel phải ghi rõ, kẻo HCNS tưởng là số chính thức.
                "preview_mode": preview_mode,
                "real_effective_date": (
                    _pc.PENALTY_EFFECTIVE_DATE.isoformat()
                    if _pc.PENALTY_EFFECTIVE_DATE else None
                ),
                "penalty_codes": sorted(_pc.PENALTY_CODES),
                "warn_only_codes": sorted(_pc.WARN_ONLY_CODES),
                "reason_labels": _pc.REASON_LABEL,
                "warn_rows": sum(
                    1 for r in rows if (r.get("penalty_amount") or 0) == 0
                ),
                "penalty_amount_per_violation": _pc.PENALTY_AMOUNT_PER_VIOLATION,
                "total_penalty": sum(r.get("penalty_amount") or 0 for r in rows),
                "penalty_rows": sum(1 for r in rows if (r.get("penalty_amount") or 0) > 0),
                # Chấm công nạp theo đợt Excel -> giữa tháng dữ liệu còn thiếu,
                # mà "Nghỉ không tạo đơn" lại quét đúng bảng này. Trả độ phủ ra
                # để HCNS không chốt phạt trên tháng chưa nạp xong.
                "attendance_coverage": self._attendance_coverage(first, last, dept_id),
            },
            "violation_labels": VIOLATION_LABEL,
            "groups": groups,
            "rows": rows,
        })

    @staticmethod
    def _count_undetermined(first, last, dept_id, emp_ids=None):
        """Đơn còn chờ duyệt mà KHÔNG có snapshot mốc hạn -> không biết quá hạn
        hay chưa. Chủ yếu là đơn tạo trước 07/10/2026 (lúc bổ sung snapshot cho
        đơn nghỉ không phép)."""
        qs = EmployeeEvent.objects.filter(
            event_date__gte=first, event_date__lte=last,
            event_type__in=["explanation", "unauthorized_absence"],
            data__status="PENDING",
        )
        if dept_id:
            qs = qs.filter(employee__department_id=dept_id)
        if emp_ids is not None:
            qs = qs.filter(employee_id__in=emp_ids)
        n = 0
        for ev in qs:
            d = ev.data or {}
            if ev.event_type == "explanation" and (d.get("explanation_type") or "").upper() != "LEAVE":
                continue
            if not d.get("advance_deadline"):
                n += 1
        return n

    # ── Lỗi suy ra từ CÁC ĐƠN đã tồn tại ────────────────────────────────
    def _from_requests(self, first, last, dept_id, emp_ids=None):
        qs = EmployeeEvent.objects.filter(
            event_date__gte=first, event_date__lte=last,
        ).select_related("employee", "employee__manager", "employee__department")
        qs = qs.filter(event_type__in=sorted(
            _EVENT_TYPE_OF[t] for t in REPORTED_REQUEST_TYPES))
        if dept_id:
            qs = qs.filter(employee__department_id=dept_id)
        if emp_ids is not None:
            qs = qs.filter(employee_id__in=emp_ids)

        # Nạp 1 lần toàn bộ grant của tháng -> tránh N+1 has_deadline_exception
        grants = set(
            DeadlineExceptionGrant.objects
            .filter(event_date__gte=first, event_date__lte=last, revoked_at__isnull=True)
            .values_list("employee_id", "event_date", "request_type")
        )

        spans = self._request_spans(first, last, dept_id, emp_ids)

        out = []
        for ev in qs:
            d = ev.data or {}
            if ev.event_type == "explanation":
                if (d.get("explanation_type") or "").upper() != "LEAVE":
                    continue
                req_type = PAID_LEAVE
            elif ev.event_type == "overtime":
                req_type = OVERTIME
            else:
                req_type = UNPAID_LEAVE

            # Chốt chặn lần 2: lọc ở tầng truy vấn đã đủ, nhưng giữ ở đây để
            # thêm loại đơn mới không vô tình lọt vào bảng khi chưa được duyệt.
            if req_type not in REPORTED_REQUEST_TYPES:
                continue

            st = (d.get("status") or "").upper()
            if st in ("CANCELLED", "REJECTED"):
                continue

            deadline = _parse_dt(d.get("advance_deadline"))
            created = _parse_dt(d.get("submitted_at")) or ev.created_at
            approved = _parse_dt(d.get("direct_manager_approved_at"))
            has_grant = (ev.employee_id, ev.event_date, req_type) in grants

            # Đơn không có snapshot mốc hạn: tính lại thay vì bỏ qua (66% đơn
            # nghỉ thiếu snapshot -> miễn trừ vĩnh viễn, xem docstring đầu file).
            deadline_recomputed = False
            if deadline is None:
                deadline = self._recomputed_deadline(ev, d, req_type, created, spans)
                deadline_recomputed = deadline is not None

            # HCNS đã "Mở khoá đặc biệt" cho đúng NV/ngày/loại này thì hạn
            # KHÔNG còn hiệu lực — backend cũng bỏ rào hạn ở cả lúc tạo
            # (registration_serializers/taodon_views) lẫn lúc duyệt
            # (_check_explanation_approve_deadline), nên dòng này KHÔNG tự ra
            # tiền (penalty_config.REASON_HAD_GRANT).
            #
            # Nhưng từ 2026-10-12 KHÔNG xoá dòng khỏi báo cáo nữa. Trước đó ở
            # đây là `continue`, nên 45 dòng tháng 9 và 57 dòng tháng 10 biến
            # mất hẳn — HCNS: "vẫn phải tính phạt chứ nhỉ? Ví dụ vẫn biết
            # là tp duyệt muộn hay người tạo đơn muộn". Mở khoá chính là đường
            # dùng để cứu trưởng phòng quên duyệt, nên nó phải NHÌN THẤY ĐƯỢC.
            if has_grant:
                self._granted_skipped += 1

            base = self._base_row(
                ev, req_type, d, deadline, created, approved, has_grant,
                deadline_recomputed=deadline_recomputed,
                style_label=_leave_style_label(d, spans.get(d.get("request_code"))),
            )

            # 1) Nhân sự tạo đơn sau hạn
            if deadline and created and created > deadline:
                out.append({**base, "fault_side": "EMPLOYEE", "violation_code": "LATE_CREATED",
                            "overdue_minutes": self._minutes(created, deadline),
                            **self._responsible(ev.employee)})
                continue  # lỗi gốc là của nhân sự, không quy thêm cho quản lý

            # 2) Nhân sự tạo đúng hạn -> xét trách nhiệm quản lý.
            # CHỈ tính lỗi "chưa duyệt" khi hạn ĐÃ QUA — đơn còn trong hạn mà
            # quản lý chưa bấm thì không phải vi phạm (lỗi này từng gắn cờ cả
            # 266 đơn tháng 10 khi mới mùng 7). Đơn không có snapshot hạn thì
            # không kết luận được, để deadline_unknown cho HCNS tự rà.
            now = timezone.now()
            # Đơn đi 2 BƯỚC: quản lý trực tiếp duyệt -> HCNS duyệt nốt. Đơn chỉ
            # chuyển APPROVED khi xong CẢ HAI, nên status=PENDING KHÔNG có
            # nghĩa là quản lý chưa làm gì. Trước đây gộp làm một nên quản lý
            # bị quy lỗi "chưa duyệt đơn" cho cả những đơn họ đã duyệt từ lâu
            # mà HCNS chưa xử lý nốt — thực tế:
            # QLTT duyệt 30/09, hạn 07/10, vẫn bị tính lỗi cho chị Phí Thị
            # Phương (HCNS báo 2026-10-08). Nay tách theo đúng người còn nợ việc.
            dm_done = bool(d.get("direct_manager_approved"))

            if dm_done and deadline and approved and approved > deadline:
                # Quản lý có duyệt nhưng muộn — lỗi của quản lý
                out.append({**base, "fault_side": "MANAGER", "violation_code": "APPROVED_LATE",
                            "overdue_minutes": self._minutes(approved, deadline),
                            **self._responsible(ev.employee.manager)})
            elif st == "PENDING" and not dm_done and deadline and now > deadline:
                # Quá hạn mà quản lý vẫn chưa duyệt bước của mình
                out.append({**base, "fault_side": "MANAGER", "violation_code": "NOT_APPROVED",
                            "overdue_minutes": self._minutes(now, deadline),
                            **self._responsible(ev.employee.manager)})
            # Đơn quản lý đã duyệt đúng hạn, đang chờ HCNS duyệt nốt: KHÔNG
            # phải lỗi của ai và cũng không cần theo dõi ở màn đối soát — bỏ
            # hẳn, kể cả con số (HCNS chốt 2026-10-08). Việc tồn của HCNS
            # đã có trang Phê duyệt lo.
        return out

    # ── Lỗi suy ra từ LẦN BẤM TẠO BỊ CHẶN (không có đơn) ────────────────
    def _from_blocked_attempts(self, first, last, dept_id, emp_ids=None):
        qs = BlockedRequestAttempt.objects.filter(
            event_date__gte=first, event_date__lte=last,
            request_type__in=[PAID_LEAVE, UNPAID_LEAVE],
        ).select_related("employee", "employee__department", "employee__manager")
        if dept_id:
            qs = qs.filter(employee__department_id=dept_id)
        if emp_ids is not None:
            qs = qs.filter(employee_id__in=emp_ids)

        # 1 nhân viên bấm nhiều lần cho cùng 1 ngày chỉ tính 1 lỗi.
        seen = set()
        out = []
        for b in qs.order_by("attempted_at"):
            key = (b.employee_id, b.event_date, b.request_type)
            if key in seen:
                continue
            seen.add(key)
            # Nếu sau đó đơn vào được (HCNS mở khoá) thì _from_requests đã
            # xét rồi — tránh đếm 2 lần cùng 1 ngày.
            if EmployeeEvent.objects.filter(
                employee_id=b.employee_id, event_date=b.event_date,
                event_type=("explanation" if b.request_type == PAID_LEAVE else "unauthorized_absence"),
            ).exclude(data__status__in=["CANCELLED", "REJECTED"]).exists():
                continue
            out.append({
                "request_type": b.request_type,
                "request_type_label": TYPE_LABEL.get(b.request_type, b.request_type),
                "pay_category": "PAID" if b.request_type == PAID_LEAVE else "UNPAID",
                "event_date": b.event_date.isoformat(),
                "request_code": None,
                "status": None,
                "deadline": b.deadline.isoformat() if b.deadline else None,
                "deadline_unknown": b.deadline is None,
                "created_at": b.attempted_at.isoformat(),
                "overdue_minutes": (self._minutes(b.attempted_at, b.deadline)
                                    if b.deadline else None),
                "approved_at": None,
                "has_grant": False,
                "detail": b.error_message or "",
                "employee_id": b.employee_id,
                "employee_code": b.employee.employee_id,
                "employee_name": b.employee.full_name,
                "fault_side": "EMPLOYEE",
                "violation_code": "LATE_CREATED",
                # Đường ghi nhận là "bấm tạo nhưng bị chặn" -> giữ cờ để
                # _merge_note và logic tiền còn phân biệt được.
                "had_blocked_attempt": True,
                **self._responsible(b.employee),
            })
        return out

    # ── Ngày VẮNG mà không có đơn nào ───────────────────────────────────
    def _from_absent_days(self, first, last, dept_id, emp_ids=None):
        """Nhân sự nghỉ mà không khai báo gì trên HRM.

        Nguồn sự thật là EmployeeEvent(attendance) — KHÔNG phải bảng Attendance.
        Bảng Attendance là bảng cũ, không được giữ đồng bộ: có bản ghi ghi
        status='ABSENT', check_in/out rỗng trong khi EmployeeEvent cùng ngày
        vẫn có giờ quẹt thẻ đầy đủ. Toàn công ty tháng 9/2026 có 10 bản ghi
        như vậy, và 3 trong số đó rơi vào 1 người nên anh ấy bị báo nghỉ
        không phép 3 ngày dù đi làm đủ (HCNS báo 2026-10-08).

        Bộ lọc: bỏ ngày lễ -> bỏ Chủ nhật của phòng được nghỉ Chủ nhật -> bỏ
        người chưa vào làm/đã nghỉ việc -> bỏ ngày đã có đơn GIẢI THÍCH ĐƯỢC
        việc vắng mặt (xem NON_COVERING_EVENT_TYPES).

        Từ 2026-10-12, đơn nửa ngày không còn che cả ngày: ai chỉ xin nghỉ nửa
        ngày mà cả ngày không quẹt thẻ lượt nào thì nửa còn lại vẫn là vắng
        không khai báo -> mã HALF_DAY_ONLY (hiện chỉ cảnh báo). Đây là đường
        lách HCNS hỏi 2026-10-12; riêng việc CHIA 1 đơn cả ngày thành 2 đơn
        nửa ngày còn mua thêm ~11 giờ hạn (cả ngày: 17h30 hôm trước; nửa ngày:
        giờ vào ca - 4h), nên 2 đơn phủ đủ 2 buổi được coi như đơn cả ngày.
        """
        from .models import HolidayConfig

        qs = EmployeeEvent.objects.filter(
            event_type="attendance", event_date__gte=first, event_date__lte=last,
        ).select_related("employee", "employee__manager", "employee__department")
        if dept_id:
            qs = qs.filter(employee__department_id=dept_id)
        if emp_ids is not None:
            qs = qs.filter(employee_id__in=emp_ids)

        holidays = set()
        for h in HolidayConfig.objects.filter(is_active=True):
            hd = h.holiday_date
            if h.is_recurring:
                try:
                    holidays.add(_dt.date(first.year, hd.month, hd.day))
                except ValueError:
                    pass
            else:
                holidays.add(hd)

        # `covered`: ngày đã có đơn giải thích được việc vắng CẢ NGÀY.
        # `half_periods`: ngày chỉ có đơn nghỉ NỬA ngày -> xét riêng bên dưới.
        covered = set()
        half_periods = {}
        cover_qs = (
            EmployeeEvent.objects
            .filter(event_date__gte=first, event_date__lte=last)
            .exclude(event_type="attendance")
            .exclude(event_type__in=NON_COVERING_EVENT_TYPES)
            .exclude(data__status__in=["CANCELLED", "REJECTED"])
            .values_list("employee_id", "event_date", "event_type", "data")
        )
        for emp_id, ed, etype, data in cover_qs:
            dd = data if isinstance(data, dict) else {}
            key = (emp_id, ed)
            is_leaveish = etype == "unauthorized_absence" or (
                etype == "explanation"
                and str(dd.get("explanation_type") or "").upper() == "LEAVE"
            )
            if is_leaveish and str(dd.get("expected_status") or "").upper() == "HALF_DAY":
                period = str(dd.get("half_day_period") or "").strip().upper()
                half_periods.setdefault(key, set()).add(
                    period if period in _HALF_BOTH else "?"
                )
                continue
            covered.add(key)
        # Lịch làm việc phòng ban tra theo TỪNG NGÀY (employee/schedule.py) — đổi lịch
        # giữa tháng (vd GSCL từ 15/10) thì nửa đầu tháng vẫn xét theo lịch cũ.
        schedule = ScheduleResolver()

        # Ai đã TỪNG vào bấm tạo đơn cho đúng ngày đó nhưng bị hệ thống chặn.
        # Nạp thẳng từ BlockedRequestAttempt chứ không dựa vào việc dòng
        # dòng "tạo đơn quá hạn" có được sinh ra và gộp vào hay không — _from_blocked_
        # attempts() bỏ qua khi đã có đơn cùng loại, nên không phải lúc nào cũng
        # có dòng để gộp. Những người này chỉ bị cảnh báo, không bị phạt tiền
        # (HCNS chốt 2026-10-10). Có 8 ca tháng 10/2026 đang chờ đúng ở đây,
        # sẽ thành "nghỉ không tạo đơn" ngay khi nạp chấm công.
        tried_dates = set(
            BlockedRequestAttempt.objects
            .filter(event_date__gte=first, event_date__lte=last,
                    request_type__in=[PAID_LEAVE, UNPAID_LEAVE])
            .values_list("employee_id", "event_date")
        )

        out = []
        seen = set()
        for a in qs:
            # CÓ quẹt thẻ (dù chỉ 1 lượt) thì hôm đó có đi làm, không phải nghỉ
            if a.check_in or a.check_out:
                continue
            d = a.event_date
            if d in holidays:
                continue
            emp = a.employee
            # Mặc định nghỉ Chủ nhật -> không cần đơn, không tính lỗi. Chỉ phòng
            # có đi làm Chủ nhật VÀO NGÀY ĐÓ (cờ works_on_sunday, kể cả lịch đổi theo
            # ngày) mới xét Chủ nhật như ngày thường. Trước 2026-10-10 cờ này từng
            # suy từ dữ liệu chấm công — sai khi HCNS đổi chính sách; nay HCNS tự
            # bật/tắt trong Django admin (Phòng ban -> Cấu hình chấm công / Đổi lịch).
            if d.weekday() == 6 and not schedule.flag(schedule.department_on(emp, d), "works_on_sunday", d):
                continue
            if emp.start_date and emp.start_date > d:
                continue
            if emp.end_date and emp.end_date < d:
                continue
            key = (emp.id, d)
            if key in seen or key in covered:
                continue
            periods = half_periods.get(key)
            if periods:
                # Không đọc được buổi nghỉ -> KHÔNG kết luận. Nói "nửa còn lại
                # thiếu đơn" mà không biết họ xin buổi nào là buộc tội không có
                # cơ sở, trong khi dòng này dính tiền.
                if "?" in periods:
                    continue
                # Buổi nào thật sự CẦN đơn. Chiều T7 tuần 2/4 công ty cho nghỉ
                # nên đơn buổi sáng là đã phủ hết ngày.
                required = ({"MORNING"} if self._afternoon_is_rest(emp, d, schedule)
                            else set(_HALF_BOTH))
                # 2 đơn nửa ngày phủ đủ các buổi cần = tương đương đơn cả ngày.
                if required <= periods:
                    continue
            seen.add(key)
            if periods:
                asked = ("buổi sáng" if periods == {"MORNING"}
                         else "buổi chiều" if periods == {"AFTERNOON"}
                         else "nửa ngày")
                code = "HALF_DAY_ONLY"
                detail = (f"Cả ngày không quẹt thẻ lượt nào nhưng chỉ có đơn nghỉ "
                          f"{asked} — nửa ngày còn lại không có đơn")
            else:
                code = "NO_REQUEST"
                detail = "Nghỉ nhưng không tạo đơn nào trên HRM"
            out.append({
                "request_type": None,
                "request_type_label": "Không có đơn",
                "leave_style_label": None,
                "pay_category": None,
                "event_date": d.isoformat(),
                "request_code": None,
                "status": None,
                "deadline": None,
                "deadline_unknown": False,
                "created_at": None,
                "approved_at": None,
                "has_grant": False,
                "overdue_minutes": None,
                "is_saturday": d.weekday() == 5,
                "detail": detail,
                "employee_id": emp.id,
                "employee_code": emp.employee_id,
                "employee_name": emp.full_name,
                "fault_side": "EMPLOYEE",
                "violation_code": code,
                # Đã vào bấm tạo đơn nhưng bị chặn -> chỉ cảnh báo, không phạt.
                "had_blocked_attempt": (emp.id, d) in tried_dates,
                **self._responsible(emp),
            })
        return out

    @staticmethod
    def _afternoon_is_rest(employee, d, schedule=None):
        """Chiều ngày `d` có phải nửa ngày CÔNG TY CHO NGHỈ (không cần đơn).

        Quy tắc chuẩn của hệ thống: chiều thứ 7 tuần 2 và 4 không tự tính công
        (xem Department.saturday_afternoon_always_workday và
        stats_utils.online_quota_amount — copy công thức tuần ở đây, cố ý không
        import để báo cáo không phụ thuộc vòng vào registration_views).

        Thiếu hàm này thì HALF_DAY_ONLY phạt oan hàng loạt: lần chạy đầu
        2026-10-12 ra 54 dòng mà 32 dòng là người xin nghỉ BUỔI SÁNG thứ 7
        26/09 (tuần 4) — chiều hôm đó công ty đã cho nghỉ, họ không thiếu đơn
        nào cả.
        """
        if d.weekday() != 5 or (d.day - 1) // 7 + 1 not in (2, 4):
            return False
        return not (schedule or ScheduleResolver()).saturday_afternoon_workday(employee, d)


    def compute_rows(self, first, last, dept_id=None, emp_ids=None, effective_date=None):
        """Tính toàn bộ dòng vi phạm của một khoảng ngày.

        Tách khỏi get() để hrm/violation_ledger.py dùng lại được mà không phải
        giả lập HTTP request — việc LƯU VẾT phải chạy được từ hook nạp chấm
        công và từ lệnh quản trị, không chỉ khi có người mở trang.
        """
        self._granted_skipped = 0
        rows = []
        rows += self._from_requests(first, last, dept_id, emp_ids)
        rows += self._from_blocked_attempts(first, last, dept_id, emp_ids)
        rows += self._from_absent_days(first, last, dept_id, emp_ids)
        rows = self._dedup_one_per_day(rows)
        if effective_date is None:
            effective_date = _pc.resolve_effective_date()
        from .violation_models import load_penalty_overrides
        overrides = load_penalty_overrides(first, last)
        # Dòng HCNS tự áp phạt mà hệ thống không sinh ra (ví dụ bấm từ tab cảnh
        # báo mốc 3 giờ, hoặc dòng đã bị loại vì có mở khoá) vẫn phải hiện ra —
        # nếu không thì bấm "Áp phạt" xong chẳng thấy gì.
        rows += self._rows_from_apply_overrides(rows, overrides)
        self._assign_penalties(rows, effective_date, overrides)

        # Lọc SAU khi đã tính phạt: các bước gộp đơn/gộp ngày liền nhau cần
        # nhìn thấy cả dòng cũ thì mới gộp đúng (vd đợt nghỉ bắt đầu từ 12/10
        # kéo sang 15/10 — bỏ dòng 12/10 quá sớm sẽ tính lại thành đợt mới).
        if HIDE_ROWS_BEFORE_EFFECTIVE_DATE and effective_date:
            rows = [r for r in rows
                    if (_pc._as_date(r.get("event_date")) or effective_date) >= effective_date]
        return rows

    def _request_spans(self, first, last, dept_id, emp_ids=None):
        """Khoảng ngày THẬT (đầu, cuối) của từng đơn, tra theo request_code.

        Đơn nghỉ nhiều ngày lưu mỗi ngày 1 EmployeeEvent cùng request_code, nên
        lấy ngày của riêng 1 event thì hạn bậc thang tính sai (đơn 5 ngày bị
        tính như đơn 1 ngày, hạn lỏng hơn thực tế). Dữ liệu 01/09-31/10 có 27
        đơn nhiều ngày, dài nhất 15 ngày.

        Nới cửa sổ ±45 ngày vì đơn vắt qua giao tháng: đơn nghỉ 28/09-02/10 mà
        chỉ xem tháng 10 thì span bị cắt còn 2 ngày.
        """
        pad = _dt.timedelta(days=45)
        q = (
            EmployeeEvent.objects
            .filter(event_date__gte=first - pad, event_date__lte=last + pad,
                    event_type__in=["explanation", "unauthorized_absence"])
            .exclude(data__status__in=["CANCELLED", "REJECTED"])
        )
        if dept_id:
            q = q.filter(employee__department_id=dept_id)
        if emp_ids is not None:
            q = q.filter(employee_id__in=emp_ids)

        spans = {}
        for ed, data in q.values_list("event_date", "data"):
            dd = data if isinstance(data, dict) else {}
            rc = dd.get("request_code")
            if not rc:
                continue
            lo, hi = spans.get(rc, (ed, ed))
            spans[rc] = (min(lo, ed), max(hi, ed))
        return spans

    def _recomputed_deadline(self, ev, d, req_type, created, spans):
        """Hạn tạo đơn TÍNH LẠI cho đơn không có snapshot `advance_deadline`.

        Tôn trọng PHIÊN BẢN LUẬT lúc tạo đơn: đơn Nghỉ không phép tạo TRƯỚC
        29/09/2026 vẫn theo mốc cũ (unauthorized_absence_deadline = 3 giờ sau
        giờ vào ca ngày làm việc kế tiếp), từ 29/09 mới theo đúng luật nghỉ
        phép. Thiếu nhánh này là lặp lại sự cố 28/09/2026: đơn tạo hợp lệ theo
        luật đang có hiệu lực lúc đó bị báo quá hạn hàng loạt.

        Trả None khi không tra được giờ ca -> dòng giữ nguyên `deadline_unknown`
        (thà không kết luận còn hơn kết luận sai, vì dòng này dính tiền).
        """
        from .deadline_utils import (
            leave_style_deadline,
            unauthorized_absence_deadline,
            unauthorized_absence_uses_leave_rule,
        )

        # Tăng ca: KHÔNG đơn nào có snapshot (đo 2026-10-14: 0/739), nên luôn
        # đi nhánh này. Mốc lấy từ giờ bắt đầu ca — `data.start_time` thường
        # rỗng, giờ thật nằm ở `ev.check_in` (đơn trong ảnh HCNS gửi đúng
        # kiểu đó), nên phải thử cả hai kẻo bỏ sót.
        if req_type == OVERTIME:
            from .deadline_utils import overtime_deadline_for
            start = d.get("start_time") or ev.check_in
            if isinstance(start, str):
                try:
                    start = _dt.time.fromisoformat(start)
                except ValueError:
                    start = ev.check_in
            try:
                deadline, _is_extended = overtime_deadline_for(
                    ev.event_date, start, ev.employee)
                return deadline
            except Exception:
                return None

        lo, hi = spans.get(d.get("request_code"), (ev.event_date, ev.event_date))
        try:
            if req_type == UNPAID_LEAVE and not unauthorized_absence_uses_leave_rule(created):
                return unauthorized_absence_deadline(hi, ev.employee)
            return leave_style_deadline(
                lo, hi, ev.employee,
                expected_status=d.get("expected_status"),
                half_day_period=d.get("half_day_period"),
                reason=d.get("reason") or "",
            )
        except Exception:
            # Ca làm không cấu hình được / dữ liệu đơn lạ -> không đoán.
            return None

    def _base_row(self, ev, req_type, d, deadline, created, approved, has_grant,
                  *, deadline_recomputed=False, style_label=None):
        return {
            "request_type": req_type,
            "request_type_label": TYPE_LABEL.get(req_type, req_type),
            # "Cả ngày" / "Nửa ngày · Chiều" / "3 ngày · 12/10–14/10" — thứ giải
            # thích vì sao cột Hạn của 2 dòng cùng ngày lại khác nhau.
            "leave_style_label": style_label,
            # Tăng ca không thuộc trục "có lương / không lương" của đơn nghỉ —
            # để None thì giao diện hiện nhãn trơn, không tô nhầm màu.
            "pay_category": (None if req_type == OVERTIME
                             else "PAID" if req_type == PAID_LEAVE else "UNPAID"),
            "event_date": ev.event_date.isoformat(),
            "request_code": d.get("request_code") or "",
            "status": (d.get("status") or "").upper(),
            "deadline": deadline.isoformat() if deadline else None,
            # Đơn tạo trước khi hệ thống snapshot mốc hạn — không đoán bừa.
            "deadline_unknown": deadline is None,
            # Hạn do báo cáo TÍNH LẠI (không có snapshot), theo đúng phiên bản
            # luật lúc tạo đơn. Trả ra để HCNS biết dòng nào là suy luận.
            "deadline_recomputed": deadline_recomputed,
            "created_at": created.isoformat() if created else None,
            "approved_at": approved.isoformat() if approved else None,
            "has_grant": has_grant,
            "detail": d.get("reason") or ev.explanation or "",
            "employee_id": ev.employee_id,
            "employee_code": ev.employee.employee_id,
            "employee_name": ev.employee.full_name,
        }

    def _rows_from_apply_overrides(self, rows, overrides):
        """Sinh dòng cho các lần HCNS bấm "Áp phạt" mà hệ thống không tự sinh.

        Cần vì HCNS bấm áp phạt từ các tab CẢNH BÁO (tạo đơn quá hạn, mở khoá
        quá mốc 3 giờ) — những dòng đó hoặc vốn không ra tiền, hoặc đã bị loại
        khỏi bảng (ví dụ ngày có "Mở khoá đặc biệt" bị bỏ qua hoàn toàn). Không
        sinh lại thì bấm xong chẳng thấy gì, HCNS tưởng nút hỏng.
        """
        existing = {
            (r.get("employee_id"), r.get("event_date"), r.get("violation_code"))
            for r in rows
        }
        missing = [
            (key, ov) for key, ov in (overrides or {}).items()
            if ov.action == "apply" and key not in existing
        ]
        if not missing:
            return []

        emps = {
            e.id: e for e in Employee.objects
            .filter(id__in={k[0] for k, _ in missing})
            .select_related("department", "manager", "manager__department")
        }
        out = []
        for (emp_id, date_iso, code), ov in missing:
            emp = emps.get(emp_id)
            if not emp:
                continue
            # Lỗi quản lý thì người chịu trách nhiệm là quản lý, giống các dòng
            # hệ thống tự sinh.
            is_manager_fault = code in ("NOT_APPROVED", "APPROVED_LATE")
            d = _pc._as_date(date_iso)
            out.append({
                "request_type": None,
                "request_type_label": "—",
                "pay_category": None,
                "event_date": date_iso,
                "request_code": None,
                "status": None,
                "deadline": None,
                "deadline_unknown": False,
                "created_at": None,
                "approved_at": None,
                "has_grant": False,
                "overdue_minutes": None,
                "is_saturday": bool(d and d.weekday() == 5),
                "detail": "HCNS áp phạt thủ công từ trang cảnh báo",
                "employee_id": emp.id,
                "employee_code": emp.employee_id,
                "employee_name": emp.full_name,
                "fault_side": "MANAGER" if is_manager_fault else "EMPLOYEE",
                "violation_code": code,
                **self._responsible(emp.manager if is_manager_fault else emp),
            })
        return out

    @staticmethod
    def _assign_penalties(rows, effective_date, overrides=None):
        """Gán `penalty_amount` + `penalty_reason` cho từng dòng.

        Mức "500.000 đ/lần" phải tính theo LẦN SAI, không theo số bản ghi — nên
        có hai lần gộp trước khi tính tiền:

        1. **Theo ĐƠN.** Đơn nghỉ nhiều ngày lưu mỗi ngày một EmployeeEvent cùng
           `request_code` (xem taodon_views.create / registration_serializers),
           nên một lần bấm duyệt muộn sinh N dòng. Dữ liệu thật có đơn nghỉ
           không phép dài tới 15 ngày -> nếu tính theo ngày thì một lần bấm ra
           7.500.000 đ. Chỉ ngày ĐẦU của mỗi đơn ra tiền (HCNS chốt
           2026-10-10: "1 lần cho cả đơn").
        2. **Theo ĐỢT VẮNG LIỀN NHAU.** Với `NO_REQUEST` thì không có đơn nào
           để gộp, nên gộp các ngày liên tiếp của cùng một người thành 1 lần.
           HCNS đã được cảnh báo chỗ này tạo kẽ hở (nghỉ dài không khai báo
           rẻ hơn nghỉ rải rác) và vẫn chọn gộp.

        GIỚI HẠN đã biết, không vá ở đây: báo cáo chạy theo TỪNG THÁNG, nên một
        đợt vắng bắc qua 31/10-01/11 bị cắt thành 2 đợt và tính 2 lần. Vá được
        thì phải nạp thêm dữ liệu tháng liền kề; HCNS cần tự rà các đợt nằm ở
        đầu/cuối tháng.
        """
        seen_request = set()
        prev_absent = {}       # employee_id -> ngày NO_REQUEST liền trước

        # Lặp theo (người, ngày) để nhận được đợt liên tiếp; `rows` giữ nguyên
        # thứ tự vì ta chỉ sửa nội dung từng dict.
        for r in sorted(rows, key=lambda x: (x.get("employee_id") or 0,
                                             x.get("event_date") or "")):
            code = r.get("violation_code")
            dup_request = False
            consecutive = False

            if code in _pc.REQUEST_SCOPED_CODES:
                # request_code luôn có giá trị trên dữ liệu thật (đã kiểm:
                # 1645/1645 đơn nghỉ phép, 795/795 nghỉ không phép), nhưng vẫn
                # để khoá dự phòng theo (người, ngày) để không bao giờ dồn các
                # đơn không mã của cả công ty vào cùng một nhóm.
                rc = r.get("request_code") or f"_{r.get('employee_id')}_{r.get('event_date')}"
                key = (code, rc)
                if key in seen_request:
                    dup_request = True
                else:
                    seen_request.add(key)

            if code == "NO_REQUEST":
                d = _pc._as_date(r.get("event_date"))
                if d:
                    prev = prev_absent.get(r.get("employee_id"))
                    if prev and (d - prev).days == 1:
                        consecutive = True
                    prev_absent[r.get("employee_id")] = d

            amount, reason = _pc.decide_penalty(
                r, effective_date=effective_date,
                is_duplicate_of_request=dup_request,
                is_consecutive_followup=consecutive,
            )
            # HCNS tự quyết thì đè lên kết quả tự động. Luôn kèm lý do + người
            # bấm để còn đối chiếu (HCNS 2026-10-12).
            ov = (overrides or {}).get(
                (r.get("employee_id"), r.get("event_date"), r.get("violation_code"))
            )
            if ov is not None:
                if ov.action == "apply":
                    amount = _pc.PENALTY_AMOUNT_PER_VIOLATION
                    reason = _pc.REASON_APPLIED_BY_HR
                else:
                    amount = 0
                    reason = _pc.REASON_WAIVED_BY_HR
                r["override"] = {
                    "id": ov.id,
                    "action": ov.action,
                    "reason": ov.reason,
                    "by": ov.created_by.full_name if ov.created_by else None,
                    "at": ov.created_at.isoformat(),
                }

            r["penalty_amount"] = amount
            r["penalty_reason"] = reason
            r["penalty_reason_label"] = _pc.REASON_LABEL.get(reason, reason)

    @staticmethod
    def _dedup_one_per_day(rows):
        """Một ngày nghỉ chỉ ra MỘT lỗi cho MỖI BÊN chịu trách nhiệm.

        Khoá dedup là (fault_side, employee_id, event_date) — cố tình KHÔNG
        gộp chéo giữa lỗi nhân viên và lỗi quản lý, vì đó là hai người khác
        nhau cùng bị phạt, không phải một lỗi bị đếm hai lần.

        Trước đây 1 người vừa bị chặn tạo đơn vừa không quẹt thẻ hôm đó thì ra
        2 dòng = 1.000.000 đ cho đúng một ngày nghỉ (HCNS chốt 2026-10-09
        gộp lại, ưu tiên "Nghỉ không tạo đơn"). Dòng bị loại không mất hẳn:
        thông tin của nó ghi thêm vào `detail` của dòng được giữ, để HCNS vẫn
        thấy người đó CÓ vào bấm tạo đơn chứ không phải quên hẳn.
        """
        best = {}
        for r in rows:
            # Thêm "họ đơn" vào khoá: HCNS chốt 2026-10-14 tính RIÊNG từng
            # đơn khi cùng ngày vừa lỗi đơn nghỉ vừa lỗi đơn tăng ca — đó là
            # hai lần không tuân thủ khác nhau, gộp lại là giấu mất một vi phạm.
            # Trong cùng một họ thì vẫn gộp như cũ (vd vừa bị chặn tạo đơn vừa
            # không quẹt thẻ -> 1 lỗi).
            family = "OVERTIME" if r.get("request_type") == OVERTIME else "LEAVE"
            key = (r["fault_side"], r["employee_id"], r["event_date"], family)
            cur = best.get(key)
            if cur is None:
                best[key] = r
                continue
            cur_p = VIOLATION_PRIORITY.get(cur["violation_code"], 99)
            new_p = VIOLATION_PRIORITY.get(r["violation_code"], 99)
            keep, drop = (cur, r) if cur_p <= new_p else (r, cur)
            # Cờ THẬT, không để logic tiền phải dò chuỗi tiếng Việt trong detail.
            # Người đã vào bấm tạo đơn mà bị chặn thì coi như đã cố gắng -> chỉ
            # cảnh báo, không phạt (HCNS chốt 2026-10-10).
            if drop.get("had_blocked_attempt"):
                keep["had_blocked_attempt"] = True
            note = _merge_note(drop)
            if note and note not in (keep.get("detail") or ""):
                keep["detail"] = ((keep.get("detail") or "").rstrip() + " " + note).strip()
            best[key] = keep
        return list(best.values())

    @staticmethod
    def _attendance_coverage(first, last, dept_id):
        """Đã có chấm công của bao nhiêu nhân viên trong tháng này.

        Chấm công nạp bằng import Excel theo đợt (đợt tháng 9 vào ngày 01/10),
        chỉ ~30 bản ghi/ngày vào live. Giữa tháng thì bảng chấm công gần như
        rỗng, mà "Nghỉ không tạo đơn" — loại chiếm 205/210 vi phạm tháng 9 —
        lại quét đúng bảng đó. Trả độ phủ ra để HCNS không chốt phạt trên
        tháng chưa nạp xong.

        Mốc so sánh là CHÍNH THÁNG TRƯỚC, không phải số nhân viên "đang làm":
        employment_status/is_active không cập nhật khi nghỉ việc, mà end_date
        cũng thường để trống, nên đếm theo hồ sơ ra 2.686 người trong khi thực
        tế chỉ ~423 người có chấm công (tháng 9/2026). Lấy tháng trước làm mốc
        thì tự hiệu chỉnh, không phụ thuộc trường trạng thái nào.
        """
        prev_last = first - _dt.timedelta(days=1)
        prev_first = prev_last.replace(day=1)

        def _count(f, l):
            qs = EmployeeEvent.objects.filter(
                event_type="attendance", event_date__gte=f, event_date__lte=l,
            )
            if dept_id:
                qs = qs.filter(employee__department_id=dept_id)
            return qs.values("employee_id").distinct().count(), qs.count()

        cur_emp, cur_rows = _count(first, last)
        prev_emp, prev_rows = _count(prev_first, prev_last)
        return {
            "employees_with_data": cur_emp,
            "attendance_rows": cur_rows,
            "prev_month": prev_first.strftime("%m/%Y"),
            "prev_employees_with_data": prev_emp,
            "prev_attendance_rows": prev_rows,
            "percent_of_prev_month": (
                round(cur_emp * 100.0 / prev_emp, 1) if prev_emp else None
            ),
            # Dưới 80% so với tháng trước thì coi là CHƯA nạp xong -> FE cảnh báo
            # đỏ, đừng chốt phạt. 80% để không báo động vì biến động nhân sự.
            "looks_incomplete": bool(prev_emp and cur_emp < prev_emp * 0.8),
        }

    @staticmethod
    def _minutes(later, earlier):
        """Trễ bao nhiêu PHÚT so với hạn — để HCNS phân biệt trễ 1 phút với
        trễ mấy ngày, thay vì gộp chung một mức phạt."""
        try:
            return int((later - earlier).total_seconds() // 60)
        except Exception:  # noqa: BLE001
            return None

    @staticmethod
    def _responsible(person, fallback=None):
        p = person or fallback
        return {
            "responsible_id": p.id if p else None,
            "responsible_code": p.employee_id if p else "",
            "responsible_name": p.full_name if p else "(chưa gán quản lý)",
            "responsible_department": (p.department.name if p and p.department else None),
        }


class FinalizeMonthView(APIView):
    """GET/POST /api-hrm/violation-report/finalize/  — chốt tháng. Chỉ HCNS/Admin.

    GET  ?year=&month=  : xem trước sẽ tạo bao nhiêu biên bản, bao nhiêu tiền.
    POST {year, month}  : tạo biên bản phạt (status APPROVED) cho mọi dòng ra
                          tiền CHƯA được chốt -> `salary_engine` trừ thẳng vào
                          lương tháng đó.

    Phải xem trước rồi mới chốt: đây là thao tác trừ tiền thật của hàng chục
    người cùng lúc. Chốt lại nhiều lần an toàn — chỉ thêm cái thiếu (HCNS
    2026-10-12), ràng buộc unique của ViolationPenaltyIssue bảo đảm việc đó.
    """
    permission_classes = [IsAuthenticated]

    def _guard(self, request):
        viewer = Employee.objects.filter(user=request.user).first()
        if not _is_hr_or_admin_broad(request.user, viewer):
            return None, Response({"error": "Chỉ HCNS/Admin được chốt tháng."},
                                  status=status.HTTP_403_FORBIDDEN)
        return viewer, None

    @staticmethod
    def _period(src):
        try:
            year = int(src.get("year"))
            month = int(src.get("month"))
        except (TypeError, ValueError):
            return None, None
        if not (1 <= month <= 12) or not (2000 <= year <= 2100):
            return None, None
        return year, month

    def get(self, request):
        viewer, err = self._guard(request)
        if err:
            return err
        year, month = self._period(request.query_params)
        if year is None:
            return Response({"error": "Năm/tháng không hợp lệ."},
                            status=status.HTTP_400_BAD_REQUEST)
        from .violation_finalize import preview_finalize
        return Response(preview_finalize(year, month))

    def post(self, request):
        viewer, err = self._guard(request)
        if err:
            return err
        year, month = self._period(request.data)
        if year is None:
            return Response({"error": "Năm/tháng không hợp lệ."},
                            status=status.HTTP_400_BAD_REQUEST)
        # Chốt tháng CHƯA KẾT THÚC là chốt thiếu: chấm công vào theo đợt đầu
        # tháng sau, nên dòng "Nghỉ không tạo đơn" chưa hiện hết.
        today = timezone.localdate()
        if (year, month) >= (today.year, today.month):
            return Response(
                {"error": f"Chưa chốt được tháng {month:02d}/{year} vì tháng chưa "
                          f"kết thúc. Chấm công nạp theo đợt đầu tháng sau, chốt "
                          f"bây giờ sẽ thiếu phần lớn lỗi nghỉ không đơn."},
                status=status.HTTP_400_BAD_REQUEST)

        from .violation_finalize import finalize_month
        result = finalize_month(year, month, actor=viewer)
        return Response(result)


class PenaltyOverrideView(APIView):
    """POST /api-hrm/violation-report/penalty-override/

    HCNS tự quyết áp phạt / gỡ phạt cho MỘT dòng vi phạm. Chỉ HCNS/Admin.

    Body: employee_id, event_date (YYYY-MM-DD), violation_code, reason,
          action = "apply" | "waive" | "clear"
      - apply : bắt dòng này phải ra tiền (dùng ở các tab cảnh báo)
      - waive : gỡ tiền của dòng hệ thống tự tính
      - clear : thu hồi quyết định tay, trả dòng về tính tự động

    Luôn BẮT BUỘC lý do — kể cả "clear" — vì đây là thao tác đụng tới tiền của
    người khác, phải trả lời được "ai bấm, lúc nào, vì sao" (HCNS 2026-10-12).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        viewer = Employee.objects.filter(user=request.user).first()
        if not _is_hr_or_admin_broad(request.user, viewer):
            return Response(
                {"error": "Chỉ HCNS/Admin được áp hoặc gỡ phạt."},
                status=status.HTTP_403_FORBIDDEN,
            )

        from .violation_models import ViolationPenaltyOverride

        action = str(request.data.get("action") or "").lower()
        if action not in ("apply", "waive", "clear"):
            return Response({"error": "action phải là apply / waive / clear"},
                            status=status.HTTP_400_BAD_REQUEST)

        reason = str(request.data.get("reason") or "").strip()
        if not reason:
            return Response({"error": "Phải nhập lý do."},
                            status=status.HTTP_400_BAD_REQUEST)

        code = str(request.data.get("violation_code") or "").strip().upper()
        if code not in VIOLATION_LABEL:
            return Response({"error": "Loại lỗi không hợp lệ"},
                            status=status.HTTP_400_BAD_REQUEST)

        event_date = _pc._as_date(request.data.get("event_date"))
        if not event_date:
            return Response({"error": "Ngày không hợp lệ"},
                            status=status.HTTP_400_BAD_REQUEST)

        employee = Employee.objects.filter(id=request.data.get("employee_id")).first()
        if not employee:
            return Response({"error": "Không tìm thấy nhân viên"},
                            status=status.HTTP_400_BAD_REQUEST)

        # Một khoá chỉ có 1 quyết định còn hiệu lực — thu hồi cái cũ rồi ghi cái
        # mới, giữ lại lịch sử thay vì xoá.
        ViolationPenaltyOverride.objects.filter(
            employee=employee, event_date=event_date, violation_code=code,
            revoked_at__isnull=True,
        ).update(revoked_at=timezone.now(), revoked_by=viewer)

        if action == "clear":
            return Response({"ok": True, "action": "clear"})

        ov = ViolationPenaltyOverride.objects.create(
            employee=employee, event_date=event_date, violation_code=code,
            action=action, reason=reason, created_by=viewer,
        )
        return Response({
            "ok": True,
            "id": ov.id,
            "action": ov.action,
            "reason": ov.reason,
            "by": viewer.full_name if viewer else None,
            "at": ov.created_at.isoformat(),
        }, status=status.HTTP_201_CREATED)

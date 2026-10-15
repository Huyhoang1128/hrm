"""
hrm/overtime_reconciliation.py
═══════════════════════════════
Đối soát đơn tăng ca ONSITE (Tại Viện/VP, xem RegistrationRequestCreate
Serializer.ot_type) với giờ chấm công THỰC TẾ — gọi ngay sau khi upload
file chấm công (thường cuối tháng), theo yêu cầu HCNS 2026-09-18: "cho
các đơn onsite thì sau khi máy chấm công up data lên thì auto đối chiếu
giờ out lại đối với giờ out của đơn tăng ca".

CHỦ Ý (cập nhật 2026-09-23 sau khi HCNS review lại — thay cho cả quy tắc
"không tự sửa" 2026-09-18 lẫn cách hiểu sai "dải dung sai 30 phút" 2026-09-22):
- Thực tế RA SỚM HƠN đăng ký: LUÔN LUÔN tự động lấy giờ ra theo máy chấm công
  (ghi đè check_out/overtime_hours), KHÔNG có ngưỡng bỏ qua nào — "chấm công
  out ít hơn thời gian quy định cho đơn tăng ca onsite thì auto align theo giờ
  chấm công out". Audit trail giờ cũ/mới lưu trong data['reconciliation']
  (status 'auto_corrected_shortfall').
- Nếu align xong mà TỔNG thời gian tăng ca thực tế < 30 phút: HUỶ HẲN đơn tăng
  ca (soft_cancel_request, status 'cancelled_too_short') — "duration mà <30p là
  hủy hẳn đơn tăng ca". 30 phút là THỜI LƯỢNG OT TỐI THIỂU để được tính, không
  phải dung sai lệch giờ.
- Thực tế RA MUỘN HƠN đăng ký quá 15 phút (excess): KHÔNG tự sửa (rủi ro cộng
  thêm giờ tăng ca sai) — chỉ GHI CHÚ, chờ QUẢN LÝ TRỰC TIẾP vào sửa trong hạn
  (manager_attendance_fix_deadline(): 10h sáng ngày lịch kế tiếp, riêng Chủ
  nhật tới hết ngày) rồi HCNS duyệt lại mới ghi nhận chính thức — xem
  reconciliation_action() ở registration_views.py.
- 15 phút là ngưỡng BÁO LÊN màn Đối chiếu tăng ca ("quá 15p thì mới báo về
  trang kia"): lệch <= 15 phút vẫn align như trên nhưng ghi note im lặng.
  Màn đối chiếu này chỉ HCNS xem/xử lý (chốt 2026-09-23) — QLTT không còn vai
  trò gì ở đây, việc sửa giờ hằng ngày của họ nằm ở trang Phê duyệt.
An toàn để chạy lại nhiều lần (idempotent — luôn ghi đè bằng kết quả tính
mới nhất, trừ các key hr_decision đã có — xem _carry_over_hr_decision).

"Be smart and reasonable" (yêu cầu HCNS): xử lý đúng trường hợp nhân
viên quên chấm công buổi SÁNG — khi đó máy chấm công chỉ có 1 lượt quẹt
trong ngày (thường là lúc RA), nhưng bị hệ thống lưu nhầm thành check_in
(check_out=None) — logic dưới đây nhận diện đúng trường hợp này (xem
CHECKIN_CONFUSION_TOLERANCE) để không báo nhầm "thiếu giờ ra"/"về sớm"
khi thực chất họ có mặt đủ, chỉ là thiếu 1 lượt quẹt.
"""
import re
import logging
import datetime as _dt

from django.utils import timezone

logger = logging.getLogger(__name__)

# Khớp các khung giờ dạng "17h30-18h52", "6h12 - 7h30", "21:34-22:52"...
_TIME_RANGE_RE = re.compile(r'(\d{1,2})[hH:](\d{2})?\s*[-–]\s*(\d{1,2})[hH:](\d{2})?')

# Lượt quẹt duy nhất (thiếu check_out) lệch trong khoảng này so với giờ OT
# kết thúc -> coi là "quên chấm công vào", lượt quẹt đó chính là lúc họ RA.
CHECKIN_CONFUSION_TOLERANCE_MIN = 30
# Chênh lệch (phút) giữa giờ ra thực tế và giờ OT đăng ký kết thúc mà KỂ TỪ ĐÓ
# mới báo lên màn Đối chiếu tăng ca (HCNS 2026-09-23:
# "quá 15p thì mới báo về trang kia"). LƯU Ý: đây KHÔNG phải ngưỡng để quyết
# định có sửa giờ hay không — giờ ra sớm hơn đăng ký thì LUÔN được align theo
# máy chấm công, bất kể lệch bao nhiêu phút; ngưỡng này chỉ quyết định có làm
# phiền người khác hay không.
OT_REPORT_THRESHOLD_MINUTES = 15
# Thời lượng tăng ca thực tế TỐI THIỂU (phút) để đơn được tính là tăng ca —
# dưới mức này thì huỷ hẳn đơn (HCNS 2026-09-23: "duration mà <30p là hủy hẳn
# đơn tăng ca"), không giữ đơn với vài phút OT lẻ.
OT_MIN_DURATION_MINUTES = 30


# Tab hiển thị ở FE (Đơn từ & Phê duyệt > Phê duyệt > Đối chiếu tăng ca) —
# ĐƠN GIẢN HOÁ theo yêu cầu HCNS 2026-09-18 ("sửa lại cho đơn giản hơn, focus
# vào việc duyệt và chưa duyệt hơn"): chỉ còn 2 tab, KHÔNG phân theo lý do
# (shortfall/multi_segment/...) nữa — lý do vẫn hiển thị ở cột Trạng thái/
# Ghi chú của từng dòng, chỉ không dùng để chia tab.
TAB_PENDING = 'pending'    # có vấn đề, HR CHƯA quyết định (Duyệt/Sửa auto/Sửa tay/Từ chối)
TAB_DONE = 'done'          # HR đã quyết định (hr_decision) HOẶC tự khớp sẵn (status='ok')
TAB_REJECTED = 'rejected'  # đơn đã bị Từ chối (data.status='REJECTED')

TAB_ORDER = [TAB_PENDING, TAB_DONE, TAB_REJECTED]

# Các status đối soát LUÔN phải báo lên màn Đối chiếu tăng ca (cần HR/QLTT
# xem hoặc ít nhất phải biết). 'ok' KHÔNG nằm trong này.
# 'auto_corrected_shortfall' CÓ ĐIỀU KIỆN: chỉ báo khi lệch quá
# OT_REPORT_THRESHOLD_MINUTES — nên KHÔNG liệt kê ở đây mà xét qua cờ
# note['reported'] (xem _mark_reported/_is_reported bên dưới).
_ISSUE_STATUSES = {
    'excess',                 # thực tế nhiều hơn đăng ký -> QLTT sửa trong hạn
    'cancelled_too_short',    # đã huỷ đơn vì OT thực tế < 30 phút
    'missing_checkin_note', 'scope_mismatch',
    'multi_segment_reason', 'no_attendance_data', 'needs_manual_review',
}


def _is_reported(note: dict) -> bool:
    """1 kết quả đối soát có cần hiện lên màn Đối chiếu tăng ca (và bắn thông
    báo cho QLTT) hay không. Tách riêng khỏi `status` vì
    'auto_corrected_shortfall' vừa có thể là "sửa im lặng vài phút lẻ" (không
    báo) vừa có thể là "đã tự sửa hẳn 20 phút" (phải báo) — phân biệt bằng cờ
    `reported` do _reconcile_one gắn lúc tạo note."""
    if not note:
        return False
    if note.get('reported'):
        return True
    return note.get('status') in _ISSUE_STATUSES


def classify_tab(ot_data: dict) -> str:
    """Xếp 1 đơn tăng ca ONSITE (không phải BUSINESS_TRIP) vào 'pending'
    (chưa duyệt), 'done' (đã duyệt/tự khớp) hoặc 'rejected' (đã bị từ chối
    ngay ở màn này) — dùng cho danh sách LIST ở overtime_reconciliation view
    (chỉ query ot_type=ONSITE nên hàm này không cần xử lý case ONLINE)."""
    if (ot_data or {}).get('status') == 'REJECTED':
        return TAB_REJECTED
    reconciliation = (ot_data or {}).get('reconciliation') or {}
    if reconciliation.get('hr_decision'):
        return TAB_DONE
    if _is_reported(reconciliation):
        return TAB_PENDING
    return TAB_DONE


def ensure_reconciled(ot_events) -> None:
    """Với các đơn tăng ca ONSITE trong `ot_events` (iterable EmployeeEvent,
    đã APPROVED) mà chưa từng được đối soát lần nào (chưa có
    data['reconciliation']), chạy đối soát ngay tại chỗ (tự cập nhật lại
    ot.data qua _save_note/_reconcile_one) — dùng để "tự vá" dữ liệu cũ
    (trước khi tính năng đối soát tự động tồn tại) khi HR mở trang xem lần
    đầu, không cần chạy migration/script riêng."""
    pairs = set()
    for ot in ot_events:
        d = ot.data or {}
        if d.get('ot_type') != 'ONSITE':
            continue
        if d.get('status') != 'APPROVED':
            continue  # đơn REJECTED không cần đối soát
        if d.get('reconciliation'):
            continue
        pairs.add((ot.employee, ot.event_date))
    if pairs:
        reconcile_onsite_overtime(pairs)


def _to_minutes(t: _dt.time, ot_start: _dt.time = None) -> int:
    m = t.hour * 60 + t.minute
    if ot_start and t.hour < 6 and ot_start.hour >= 18:
        m += 24 * 60
    return m


# Trần số giờ tăng ca/ngày — PHẢI khớp đúng
# RegistrationRequestCreateSerializer.MAX_OVERTIME_HOURS_PER_DAY (dùng lúc
# tạo đơn) để Sửa auto/Sửa tay ở màn Đối chiếu tăng ca tính ra số giờ nhất
# quán với lúc tạo đơn, không lệch cách tính.
MAX_OVERTIME_HOURS_PER_DAY = 8.0


def compute_overtime_hours(check_in: _dt.time, check_out: _dt.time) -> float:
    """Tính số giờ tăng ca từ giờ vào/ra — CÙNG công thức với lúc tạo đơn
    (registration_serializers.py, xử lý qua nửa đêm bằng cách cộng thêm 24h
    nếu giờ ra sớm hơn giờ vào một cách bất thường, ví dụ vào 21h ra 1h sáng).
    Dùng khi HR bấm "Sửa auto"/"Sửa tay" ở màn Đối chiếu tăng ca."""
    start_min = _to_minutes(check_in)
    end_min = _to_minutes(check_out, check_in)
    delta_hours = (end_min - start_min) / 60
    return round(min(max(delta_hours, 0), MAX_OVERTIME_HOURS_PER_DAY), 2)


def _build_note(status: str, **extra) -> dict:
    return {
        # 'ok' | 'shortfall' | 'missing_checkin_note' | 'scope_mismatch'
        # | 'multi_segment_reason' | 'no_attendance_data' | 'needs_manual_review'
        'status': status,
        'checked_at': timezone.now().isoformat(),
        **extra,
    }


def reconcile_onsite_overtime(employee_date_pairs) -> list:
    """
    Đối soát các đơn tăng ca ONSITE cho danh sách (employee, date) vừa được
    cập nhật chấm công. Best-effort: lỗi ở 1 đơn không làm dừng các đơn
    khác, và không raise ra ngoài (không được làm hỏng luồng upload chấm
    công chính đang gọi hàm này).

    employee_date_pairs: iterable các (employee, date) — employee là
    Employee instance (không phải id), date là datetime.date.

    Trả về list dict tóm tắt các đơn CÓ vấn đề cần HR xem (status khác
    'ok'), để caller tiện log/thông báo — không bao gồm các đơn khớp
    bình thường.
    """
    from .event_models import EmployeeEvent

    flagged = []
    seen_keys = set()

    for employee, event_date in employee_date_pairs:
        if not employee or not event_date:
            continue
        key = (employee.id, event_date)
        if key in seen_keys:
            continue
        seen_keys.add(key)

        try:
            _reconcile_one(employee, event_date, flagged)
        except Exception:
            logger.exception(
                "[overtime_reconciliation] Lỗi đối soát tăng ca cho NV=%s ngày=%s -> bỏ qua",
                getattr(employee, 'employee_id', employee), event_date,
            )

    return flagged


def _get_effective_attendance_times(employee, event_date, att):
    """Trả về (check_in, check_out, filled_from_explanation) — nếu chấm
    công thiếu giờ vào/ra nhưng đã có đơn giải trình "Quên chấm công"
    (PENDING hoặc APPROVED, chưa bị REJECTED/CANCELLED) khai đúng giờ đó,
    dùng giờ khai trong đơn giải trình thay cho việc coi là thiếu dữ liệu
    — theo yêu cầu HCNS 2026-09-18: "nếu có đơn quên chấm công được
    duyệt/chưa duyệt thì tính là ko missing cái giờ đó luôn"."""
    from .event_models import EmployeeEvent

    check_in = att.check_in if att else None
    check_out = att.check_out if att else None
    if check_in and check_out:
        return check_in, check_out, False

    explanation = EmployeeEvent.objects.filter(
        employee=employee,
        event_type=EmployeeEvent.EventType.EXPLANATION,
        event_date=event_date,
        data__explanation_type='INCOMPLETE_ATTENDANCE',
    ).exclude(data__status__in=['REJECTED', 'CANCELLED']).order_by('-created_at').first()

    if not explanation:
        return check_in, check_out, False

    d = explanation.data or {}
    filled = False
    if not check_in and d.get('forgot_checkin_time'):
        try:
            check_in = _dt.time.fromisoformat(str(d['forgot_checkin_time']))
            filled = True
        except (ValueError, TypeError):
            pass
    if not check_out and d.get('forgot_checkout_time'):
        try:
            check_out = _dt.time.fromisoformat(str(d['forgot_checkout_time']))
            filled = True
        except (ValueError, TypeError):
            pass
    return check_in, check_out, filled


def _reconcile_one(employee, event_date, flagged: list):
    from .event_models import EmployeeEvent
    from .models import soft_cancel_request
    from .deadline_utils import manager_attendance_fix_deadline

    ot_events = EmployeeEvent.objects.filter(
        employee=employee,
        event_type=EmployeeEvent.EventType.OVERTIME,
        event_date=event_date,
        data__status='APPROVED',
        data__ot_type='ONSITE',
    ).exclude(data__registration_type='BUSINESS_TRIP')

    if not ot_events.exists():
        return

    att = EmployeeEvent.objects.filter(
        employee=employee,
        event_type=EmployeeEvent.EventType.ATTENDANCE,
        event_date=event_date,
    ).first()
    eff_check_in, eff_check_out, filled_from_explanation = _get_effective_attendance_times(employee, event_date, att)

    for ot in ot_events:
        reason = (ot.data or {}).get('reason', '')

        if len(_TIME_RANGE_RE.findall(reason)) >= 2:
            note = _build_note(
                'multi_segment_reason',
                message='Lý do đơn có nhiều khung giờ tách rời — giờ đăng ký lưu trong hệ thống không '
                        'phản ánh đúng thực tế, cần HR xem tay từng đơn.',
            )
            _save_note(ot, note, flagged, employee, event_date)
            continue

        if not ot.check_in or not ot.check_out:
            continue  # đơn thiếu giờ đăng ký -> không có gì để đối soát

        if not eff_check_in and not eff_check_out:
            note = _build_note(
                'no_attendance_data',
                message='Không có (hoặc chưa đủ) dữ liệu chấm công ngày này để đối soát — '
                        'kiểm tra lại xem có đúng nên phân loại Tại Viện/VP không.',
            )
            _save_note(ot, note, flagged, employee, event_date)
            continue

        ot_start_min = _to_minutes(ot.check_in)
        ot_end_min = _to_minutes(ot.check_out, ot.check_in)
        explanation_suffix = (
            ' (giờ lấy từ đơn giải trình "Quên chấm công", không phải máy chấm công)'
            if filled_from_explanation else ''
        )

        if not eff_check_out:
            # Chỉ có 1 lượt quẹt (check_out thiếu, và không có đơn giải
            # trình nào bù giờ ra) — xem lượt quẹt đó (lưu ở check_in) là
            # lúc RA hay lúc bắt đầu ca, theo đúng logic đã audit thủ công.
            diff_from_ot_end = abs(_to_minutes(eff_check_in) - ot_end_min)
            if diff_from_ot_end <= CHECKIN_CONFUSION_TOLERANCE_MIN:
                note = _build_note(
                    'missing_checkin_note',
                    actual_checkin=eff_check_in.isoformat(),
                    message='Chỉ quẹt 1 lần cuối ngày (gần giờ OT đăng ký kết thúc), hệ thống ghi nhầm '
                            'thành check_in, thiếu check_out — coi như có mặt đủ hết OT, không cần sửa '
                            'giờ, chỉ cần HR bổ sung lại giờ chấm công vào cho đúng dữ liệu.' + explanation_suffix,
                )
            elif _to_minutes(eff_check_in) < ot_start_min:
                note = _build_note(
                    'scope_mismatch',
                    actual_checkin=eff_check_in.isoformat(),
                    message='Chỉ có 1 lượt quẹt, xảy ra TRƯỚC khi khung OT đăng ký bắt đầu — nhân viên '
                            'có vẻ không có mặt tại viện/VP lúc làm OT này, kiểm tra lại có nên đổi '
                            'phân loại đơn này thành Online không.' + explanation_suffix,
                )
            else:
                note = _build_note(
                    'needs_manual_review',
                    actual_checkin=eff_check_in.isoformat(),
                    message='Thiếu giờ ra (check-out), giờ vào ghi nhận không khớp mẫu nào ở trên — cần HR xem tay.' + explanation_suffix,
                )
            _save_note(ot, note, flagged, employee, event_date)
            continue

        actual_checkout_min = _to_minutes(eff_check_out, ot.check_in)
        # Thời lượng tăng ca THỰC TẾ (phút) tính từ giờ OT đăng ký bắt đầu tới
        # lúc chấm công ra — số âm nghĩa là đã ra trước cả khi khung OT bắt đầu
        # (không hề ở lại làm OT).
        actual_duration_min = actual_checkout_min - ot_start_min
        shortfall = ot_end_min - actual_checkout_min

        if actual_duration_min < OT_MIN_DURATION_MINUTES:
            # Thực tế làm chưa tới 30 phút (hoặc ra trước cả giờ OT bắt đầu)
            # -> HUỶ HẲN đơn, không tính tăng ca (HCNS 2026-09-23: "duration
            # mà <30p là hủy hẳn đơn tăng ca").
            data = dict(ot.data or {})
            if actual_duration_min < 0:
                reason = (
                    f'Đã chấm công ra lúc {eff_check_out.isoformat()[:5]}, TRƯỚC cả khi khung OT '
                    f'đăng ký bắt đầu ({ot.check_in.isoformat()[:5]}) — không ghi nhận tăng ca tại '
                    f'viện/VP. Nếu thực tế có làm thì kiểm tra lại xem đơn này có nên là Online không.'
                )
            else:
                reason = (
                    f'Tăng ca thực tế chỉ {actual_duration_min} phút '
                    f'(chấm công ra lúc {eff_check_out.isoformat()[:5]}), dưới mức tối thiểu '
                    f'{OT_MIN_DURATION_MINUTES} phút nên không được tính tăng ca.'
                )
            data = soft_cancel_request(data, None, reason=reason)
            note = _build_note(
                'cancelled_too_short',
                actual_checkin=eff_check_in.isoformat() if eff_check_in else None,
                actual_checkout=eff_check_out.isoformat(),
                actual_duration_minutes=actual_duration_min,
                registered_hours=float(ot.overtime_hours) if ot.overtime_hours is not None else None,
                reported=True,  # huỷ đơn thì luôn phải cho biết
                message=reason + ' Hệ thống đã tự huỷ đơn tăng ca này.' + explanation_suffix,
            )
            ot.data = data  # _save_note sẽ copy lại data này rồi gắn note vào
            _save_note(ot, note, flagged, employee, event_date)

        elif shortfall > 0:
            # Thực tế ra SỚM HƠN đăng ký -> LUÔN LUÔN lấy giờ ra theo máy chấm
            # công, bất kể lệch bao nhiêu phút (HCNS 2026-09-23: "chấm công out
            # ít hơn thời gian quy định thì auto align theo giờ chấm công out").
            # Chỉ BÁO lên màn đối chiếu khi lệch quá 15 phút.
            old_check_out = ot.check_out
            old_hours = ot.overtime_hours
            ot.check_out = eff_check_out
            ot.overtime_hours = compute_overtime_hours(ot.check_in, eff_check_out)
            ot.save(update_fields=['check_out', 'overtime_hours'])
            should_report = shortfall > OT_REPORT_THRESHOLD_MINUTES
            note = _build_note(
                'auto_corrected_shortfall',
                actual_checkin=eff_check_in.isoformat() if eff_check_in else None,
                actual_checkout=eff_check_out.isoformat(),
                shortfall_minutes=shortfall,
                old_check_out=old_check_out.isoformat() if old_check_out else None,
                old_overtime_hours=float(old_hours) if old_hours is not None else None,
                new_overtime_hours=float(ot.overtime_hours),
                reported=should_report,
                message=f'Hệ thống tự động cập nhật giờ ra theo máy chấm công (về sớm hơn đăng ký '
                        f'{shortfall} phút) — giờ ra: {old_check_out} → {eff_check_out.isoformat()[:5]}, '
                        f'số giờ tăng ca: {old_hours} → {ot.overtime_hours}h.' + explanation_suffix,
            )
            _save_note(ot, note, flagged, employee, event_date)

        elif -shortfall > OT_REPORT_THRESHOLD_MINUTES:
            # Thực tế ra MUỘN HƠN đăng ký quá 15 phút -> KHÔNG tự sửa (rủi
            # ro cộng thêm giờ sai) — cần quản lý trực tiếp vào sửa trong
            # hạn (10h sáng ngày lịch kế tiếp, Chủ nhật tới hết ngày), rồi
            # HCNS duyệt lại mới ghi nhận (xem reconciliation_action()).
            excess_minutes = -shortfall
            deadline = manager_attendance_fix_deadline(event_date)
            note = _build_note(
                'excess',
                actual_checkin=eff_check_in.isoformat() if eff_check_in else None,
                actual_checkout=eff_check_out.isoformat(),
                excess_minutes=excess_minutes,
                registered_hours=float(ot.overtime_hours) if ot.overtime_hours is not None else None,
                manager_fix_deadline=deadline.isoformat(),
                message=f'Chấm công ra MUỘN HƠN giờ OT đăng ký kết thúc {excess_minutes} phút — HCNS '
                        f'kiểm tra rồi quyết định giữ nguyên đơn hay sửa lại giờ cho đúng thực tế '
                        f'(hạn quản lý trực tiếp tự sửa ở trang Phê duyệt là '
                        f'{deadline.strftime("%H:%M %d/%m/%Y")}).' + explanation_suffix,
            )
            _save_note(ot, note, flagged, employee, event_date)

        else:
            # Ra đúng giờ, hoặc muộn hơn nhưng chưa tới 15 phút -> khớp bình
            # thường, vẫn ghi lại 'ok' để biết đơn này ĐÃ được đối soát
            # (idempotent, ghi đè lần đối soát trước nếu có).
            note = _build_note(
                'ok',
                actual_checkin=eff_check_in.isoformat() if eff_check_in else None,
                actual_checkout=eff_check_out.isoformat(),
            )
            data = dict(ot.data or {})
            note = _carry_over_hr_decision(data.get('reconciliation') or {}, note)
            data['reconciliation'] = note
            ot.data = data
            ot.save(update_fields=['data'])


# Các key HR tự ghi khi bấm Duyệt/Sửa auto/Sửa tay ở màn Đối chiếu tăng ca
# (xem RegistrationRequestViewSet.reconciliation_action) — PHẢI giữ lại mỗi
# khi đối soát chạy lại (upload chấm công tháng sau, hoặc mở lại màn xem)
# ghi đè data['reconciliation'], nếu không sẽ mất dấu vết HR đã xử lý và đơn
# lại hiện ra như chưa ai xem, dù thực tế không có gì thay đổi thêm.
_HR_DECISION_KEYS = ('hr_decision', 'hr_decided_by_name', 'hr_decided_at', 'hr_note')


def _carry_over_hr_decision(old_note: dict, new_note: dict) -> dict:
    if old_note and old_note.get('hr_decision'):
        for k in _HR_DECISION_KEYS:
            if k in old_note:
                new_note[k] = old_note[k]
    return new_note


def _save_note(ot, note: dict, flagged: list, employee, event_date):
    data = dict(ot.data or {})
    old_note = data.get('reconciliation') or {}
    old_status = old_note.get('status')
    note = _carry_over_hr_decision(old_note, note)
    data['reconciliation'] = note
    ot.data = data
    ot.save(update_fields=['data'])
    # 2026-09-23: ĐÃ BỎ phần bắn thông báo (chuông + chat nội bộ) cho quản lý
    # trực tiếp khi đối soát phát hiện vấn đề — HCNS chốt "giờ chỉ hcns mới có
    # thể đối chiếu thôi", nên QLTT không còn vai trò gì ở luồng đối soát cuối
    # tháng này (việc sửa giờ hằng ngày của họ nằm ở trang Phê duyệt).
    flagged.append({
        'event_id': ot.id,
        'employee_id': employee.id,
        'employee_code': getattr(employee, 'employee_id', None),
        'employee_name': getattr(employee, 'full_name', None),
        'date': event_date.isoformat(),
        'request_code': (ot.data or {}).get('request_code', ''),
        **note,
    })

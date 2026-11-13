"""Section quy định: Chấm công, giải trình, nghỉ phép, làm online, đăng ký ca, tăng ca, chốt công.

Xem hrm/system_rules/__init__.py. Mỗi hàm @rule_section trả dict, giá trị lấy từ đúng chỗ backend dùng.
"""
from . import rule_section


def _validator_bounds(model, field_name):
    """(min, max) mà validator của field cho phép — chặt nhất trong các MinValueValidator /
    MaxValueValidator gắn trên field (kể cả validator khoảng số nguyên Django tự thêm)."""
    from django.core.validators import MaxValueValidator, MinValueValidator

    field = model._meta.get_field(field_name)
    mins = [v.limit_value for v in field.validators if isinstance(v, MinValueValidator)]
    maxs = [v.limit_value for v in field.validators if isinstance(v, MaxValueValidator)]
    return _num(max(mins) if mins else None), _num(min(maxs) if maxs else None)


def _num(value):
    """Số JSON gọn: 31 thay vì Decimal('31') / 31.0."""
    if value is None:
        return None
    value = float(value)
    return int(value) if value.is_integer() else value


def _penalty_policy(day):
    """Bảng phạt chấm công đang áp dụng ở ngày `day` — đúng nguồn engine dùng (PolicyLoader:
    AttendancePolicyVersion + PenaltyTierConfig + AttendancePolicyConfig, mặc định của engine
    khi chưa cấu hình)."""
    from hrm.attendance_engine import PolicyLoader

    cfg = PolicyLoader.load(day)
    policy = cfg['policy']
    version = cfg.get('version_obj')
    return {
        'version_code': cfg['version_code'],
        'effective_from': version.effective_from.isoformat() if version is not None else None,
        # Tăng dần theo max_minutes; tier cuối max_minutes=None (> tier trước). work_deduction > 0
        # thì tier đó trừ công thay vì phạt tiền (PenaltyRule).
        'tiers': [
            {
                'max_minutes': max_minutes,
                'fine_regular': fine_regular,
                'fine_manager': fine_manager,
                'work_deduction': work_deduction,
            }
            for (max_minutes, fine_regular, fine_manager, work_deduction) in cfg['penalty_tiers']
        ],
        # Từ lần vi phạm thứ N trong tháng, tiền phạt nhân hệ số (không áp cho tier trừ công).
        'multiplier_threshold': policy['penalty_multiplier_threshold'],
        'multiplier_value': policy['penalty_multiplier_value'],
        # Quên chấm công: không giải trình / giải trình được duyệt / phần trừ thêm khi vượt hạn mức.
        'incomplete_no_expl_deduction': policy['incomplete_no_expl_deduction'],
        'incomplete_approved_deduction': policy['incomplete_approved_deduction'],
        'incomplete_over_quota_deduction': policy['incomplete_over_quota_deduction'],
    }


@rule_section('attendance')
def attendance_rules(request):
    """Quy định chấm công / nghỉ chung cho mọi nhân viên (không phụ thuộc người / tháng)."""
    from django.utils import timezone

    from hrm.deadline_utils import RETURN_TO_WORK_FALLBACK_TIME, RETURN_TO_WORK_GRACE_HOURS
    from hrm.penalty_config import PENALTY_AMOUNT_PER_VIOLATION, is_penalty_configured
    from hrm.registration_serializers import RegistrationRequestCreateSerializer
    from hrm.shift_config_utils import FULL_DAY_HOURS_THRESHOLD

    return {
        # Bảng "Quy định kỷ luật" ở trang Chấm công — chính sách áp dụng hôm nay.
        'penalty_policy': _penalty_policy(timezone.localdate()),
        # Phạt nghỉ không báo / không được duyệt (penalty_config.decide_penalty). None khi chưa
        # cấu hình ngày hiệu lực (không dòng nào ra tiền).
        'unreported_absence_penalty': PENALTY_AMOUNT_PER_VIOLATION if is_penalty_configured() else None,
        # Ngưỡng giờ của 1 ngày công: duyệt Quên chấm công / Lỗi máy chấm công, giờ vào–ra ghép lại
        # >= ngưỡng -> 1.0 công, còn lại 0.5 (main_api). Web dùng cho phần xem trước ở trang Phê duyệt.
        'full_day_hours_threshold': FULL_DAY_HOURS_THRESHOLD,
        # Số ngày tối đa (tính cả ngày bắt đầu) của 1 đơn Nghỉ không phép nhiều ngày — đúng hằng số
        # serializer dùng để chặn ((end - start).days >= N bị từ chối).
        'unauthorized_absence_max_days': RegistrationRequestCreateSerializer.MAX_UNAUTHORIZED_ABSENCE_RANGE_DAYS,
        # Hạn mức ngày làm online ghi đè (OnlineWorkQuotaOverride.max_online_days): khoảng theo
        # validator của model, bước = nửa ngày (đơn vị 1 đơn online nửa ngày tính vào hạn mức).
        'online_quota_override': _online_quota_override_rule(),
        # Chế độ con nhỏ (ChildCareRegime.allowance_minutes): khoảng theo validator + mặc định.
        'child_care_allowance_minutes': _child_care_minutes_rule(),
        # Ân hạn "đi làm trở lại" (deadline_utils.unauthorized_absence_deadline): số giờ sau giờ vào
        # ca của ngày làm việc kế tiếp + mốc dự phòng khi không tra được giờ vào ca.
        'return_to_work_grace_hours': RETURN_TO_WORK_GRACE_HOURS,
        'return_to_work_fallback_time': RETURN_TO_WORK_FALLBACK_TIME.strftime('%H:%M'),
    }


def _online_quota_override_rule():
    from hrm.models import OnlineWorkQuotaOverride
    from hrm.stats_utils import ONLINE_HALF_DAY_AMOUNT

    lo, hi = _validator_bounds(OnlineWorkQuotaOverride, 'max_online_days')
    return {'min': lo, 'max': hi, 'step': ONLINE_HALF_DAY_AMOUNT}


def _child_care_minutes_rule():
    from hrm.models import ChildCareRegime

    lo, hi = _validator_bounds(ChildCareRegime, 'allowance_minutes')
    return {'min': lo, 'max': hi, 'default': ChildCareRegime._meta.get_field('allowance_minutes').get_default()}


@rule_section('shift')
def shift_rules(request):
    """Ca làm / trực tối."""
    from hrm.main_api import TELESALE_POSITION_CODES

    return {
        # Vị trí Telesale: đơn Trực tối được cộng công dù không có chấm công ca chiều (main_api) —
        # web dùng để hiện preset "Ca gãy" riêng cho nhóm này.
        'telesale_position_codes': sorted(TELESALE_POSITION_CODES),
    }


@rule_section('overtime')
def overtime_rules(request):
    """Đơn tăng ca: sàn thời lượng tối thiểu và các loại đơn áp sàn đó.

    Đúng hằng số registration_serializers / registration_views dùng khi tạo / sửa giờ đơn.
    """
    from hrm.overtime_reconciliation import OT_MIN_DURATION_MINUTES, OT_MIN_DURATION_TYPES

    return {
        'min_minutes': OT_MIN_DURATION_MINUTES,
        'min_applies_to': list(OT_MIN_DURATION_TYPES),
    }

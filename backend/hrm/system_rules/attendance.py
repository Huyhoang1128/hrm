"""Section quy định: Chấm công, giải trình, nghỉ phép, làm online, đăng ký ca, tăng ca, chốt công.

Xem hrm/system_rules/__init__.py. Mỗi hàm @rule_section trả dict, giá trị lấy từ đúng chỗ backend dùng.
"""
from . import rule_section


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

    from hrm.penalty_config import PENALTY_AMOUNT_PER_VIOLATION, is_penalty_configured

    return {
        # Bảng "Quy định kỷ luật" ở trang Chấm công — chính sách áp dụng hôm nay.
        'penalty_policy': _penalty_policy(timezone.localdate()),
        # Phạt nghỉ không báo / không được duyệt (penalty_config.decide_penalty). None khi chưa
        # cấu hình ngày hiệu lực (không dòng nào ra tiền).
        'unreported_absence_penalty': PENALTY_AMOUNT_PER_VIOLATION if is_penalty_configured() else None,
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

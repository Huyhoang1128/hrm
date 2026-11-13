"""Section quy định: Chấm công, giải trình, nghỉ phép, làm online, đăng ký ca, tăng ca, chốt công.

Xem hrm/system_rules/__init__.py. Mỗi hàm @rule_section trả dict, giá trị lấy từ đúng chỗ backend dùng.
"""
from . import rule_section


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

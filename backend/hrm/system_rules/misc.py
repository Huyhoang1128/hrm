"""Section quy định: Khác: mật khẩu, giới hạn file tải lên, góp ý, chat, chứng từ thanh toán, thông báo, tài sản, tuyển dụng, thương hiệu.

Xem hrm/system_rules/__init__.py. Mỗi hàm @rule_section trả dict, giá trị lấy từ đúng chỗ backend dùng.
"""
from . import rule_section  # noqa: F401


@rule_section('password', public=True)
def password_rules(request):
    """Chính sách mật khẩu = AUTH_PASSWORD_VALIDATORS (validate_password dùng ở mọi đường đổi/đặt mật khẩu).

    Public: trang đăng nhập / quên mật khẩu chưa có phiên. Web không tự đặt độ dài hay quy tắc chữ hoa/số.
    """
    from django.contrib.auth.password_validation import (
        MinimumLengthValidator,
        get_default_password_validators,
        password_validators_help_texts,
    )
    from hrm.utils import RESET_PASSWORD_LENGTH

    min_length = None
    for validator in get_default_password_validators():
        if isinstance(validator, MinimumLengthValidator):
            min_length = validator.min_length
    return {
        # None = không cấu hình độ dài tối thiểu.
        'min_length': min_length,
        'help_texts': [str(text) for text in password_validators_help_texts()],
        # Độ dài mật khẩu ngẫu nhiên khi cấp lại (HR "Cấp lại" / "Quên mật khẩu") — hrm.utils.generate_reset_password.
        'reset_generated_length': RESET_PASSWORD_LENGTH,
    }

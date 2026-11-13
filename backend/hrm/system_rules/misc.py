"""Section quy định: Khác: mật khẩu, giới hạn file tải lên, góp ý, chat, chứng từ thanh toán, thông báo, tài sản, tuyển dụng, thương hiệu.

Xem hrm/system_rules/__init__.py. Mỗi hàm @rule_section trả dict, giá trị lấy từ đúng chỗ backend dùng.
"""
from django.conf import settings

from . import rule_section


def _choices(pairs):
    """[(value, label), ...] -> [{value, label}, ...] (giữ thứ tự backend)."""
    return [{'value': value, 'label': str(label)} for value, label in pairs]


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


@rule_section('branding', public=True)
def branding_rules(request):
    """Thông tin công ty dùng trong email / bản in của backend (hrm/branding.py) — web in văn bản theo đúng giá trị này.

    KHÔNG trả DEFAULT_PASSWORD_PREFIX: section public, lộ tiền tố là đoán được mật khẩu mặc định.
    """
    from hrm import branding
    return {
        'company_name': branding.company_name(),
        'company_legal_name': branding.company_legal_name(),
        'hr_department_label': branding.hr_department_label(),
        'company_city': branding.company_city(),
        # Biên bản xử lý vi phạm (bản in): "Thời gian hoàn thành biên bản: trước <giờ> ngày ..."
        'penalty_report_submit_deadline': getattr(settings, 'PENALTY_REPORT_SUBMIT_DEADLINE', ''),
    }


@rule_section('uploads')
def upload_rules(request):
    """Giới hạn file tải lên theo tính năng — đúng hằng số backend kiểm tra."""
    from hrm import upload_limits
    from hrm.payment_document_views import ALLOWED_EXTENSIONS, MAX_ATTACHMENT_SIZE
    return {
        'avatar': {
            'max_bytes': upload_limits.AVATAR_MAX_BYTES,
            'types': list(upload_limits.AVATAR_ALLOWED_TYPES),
        },
        'announcement_attachment': {
            'max_bytes': upload_limits.ANNOUNCEMENT_ATTACHMENT_MAX_BYTES,
            'extensions': list(upload_limits.ANNOUNCEMENT_ATTACHMENT_EXTENSIONS),
        },
        'payment_document_attachment': {
            'max_bytes': MAX_ATTACHMENT_SIZE,
            'extensions': sorted(ALLOWED_EXTENSIONS),
        },
        'contract_template': {
            'extensions': list(upload_limits.CONTRACT_TEMPLATE_EXTENSIONS),
        },
    }


@rule_section('feedback')
def feedback_rules(request):
    """Form "Tiếp nhận - xử lý - Phản hồi IT/HC" (hrm/feedback_views.py + Feedback model)."""
    from PIL import Image

    from hrm.feedback_models import Feedback
    from hrm.feedback_views import ALLOWED_IMAGE_FORMATS, MAX_ANSWER_LENGTH, MAX_IMAGE_BYTES, MAX_IMAGES

    Image.init()  # nạp plugin định dạng để Image.MIME có đủ (mặc định rỗng tới lần mở ảnh đầu tiên)
    formats = sorted(ALLOWED_IMAGE_FORMATS)
    return {
        'max_answer_length': MAX_ANSWER_LENGTH,
        'max_images': MAX_IMAGES,
        'max_image_bytes': MAX_IMAGE_BYTES,
        # Backend nhận diện ảnh bằng Pillow (định dạng thật); MIME tương ứng để web lọc file / accept.
        'image_formats': formats,
        'image_types': [Image.MIME[fmt] for fmt in formats if fmt in Image.MIME],
        'topics': _choices(Feedback.TOPIC_CHOICES),
        # Vấn đề do bộ phận IT xử lý; còn lại do HCNS.
        'it_topics': list(Feedback.IT_TOPICS),
        'questions': [{'field': field, 'question': question} for field, question in Feedback.ANSWER_FIELDS],
    }


@rule_section('chat')
def chat_rules(request):
    """Chat nội bộ: ảnh gửi kèm tin nhắn + icon reaction (chat/views.py)."""
    from chat.views import CHAT_IMAGE_MAX_SIZE, CHAT_IMAGE_TYPES, REACTION_ICON_SIZE, REACTION_SOURCE_MAX_SIZE
    return {
        'image_max_bytes': CHAT_IMAGE_MAX_SIZE,
        'image_types': sorted(CHAT_IMAGE_TYPES),
        'reaction_source_max_bytes': REACTION_SOURCE_MAX_SIZE,
        'reaction_icon_px': REACTION_ICON_SIZE,
    }


@rule_section('assets')
def asset_rules(request):
    """Phân loại tài sản (hrm/models.py: ASSET_TYPE, normalize_asset_type, Asset.is_multi_holder_type)."""
    from hrm.models import (
        ASSET_TYPE,
        ASSET_TYPE_MAX_LENGTH,
        UNASSIGNABLE_ASSET_CONDITIONS,
        Asset,
        _ASSET_TYPE_ALIASES,
    )
    return {
        # Loại chuẩn (mã + nhãn); "Phân loại" là text tự do, ngoài danh sách này coi như loại tự do.
        'standard_types': _choices(ASSET_TYPE),
        'type_max_length': ASSET_TYPE_MAX_LENGTH,
        # Tên gọi khác (viết thường) -> mã chuẩn, dùng khi chuẩn hoá giống normalize_asset_type().
        'type_aliases': dict(_ASSET_TYPE_ALIASES),
        # Loại có Số lượng + bàn giao nhiều người; loại tự do (ngoài standard_types) cũng vậy.
        'multi_holder_types': sorted(Asset.MULTI_HOLDER_TYPES),
        # Tình trạng không được bàn giao (Asset.assign_to_employee chặn).
        'unassignable_conditions': list(UNASSIGNABLE_ASSET_CONDITIONS),
    }


@rule_section('recruitment')
def recruitment_rules(request):
    """Trạng thái nhu cầu tuyển dụng (recruitment/models.py RECRUITMENT_STATUS)."""
    from recruitment.models import RECRUITMENT_STATUS
    return {
        'need_statuses': _choices(RECRUITMENT_STATUS),
    }


@rule_section('regulation')
def regulation_rules(request):
    """Tài liệu quy định (onboarding / RegulationGate)."""
    return {
        # Số giây tối thiểu mở tài liệu trước khi được bấm "Đã đọc".
        'min_read_seconds': settings.REGULATION_MIN_READ_SECONDS,
    }


@rule_section('account')
def account_rules(request):
    """Quản lý tài khoản nhân viên (hrm/views.py send_account_emails)."""
    return {
        # Thời gian chờ giữa 2 lần "Gửi email tài khoản cho tất cả" (reset mật khẩu mọi nhân viên).
        'send_all_emails_cooldown_seconds': settings.SEND_ALL_ACCOUNT_EMAILS_COOLDOWN_SECONDS,
    }

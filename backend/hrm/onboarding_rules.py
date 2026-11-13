"""Quy định form nhận việc công khai (onboarding) — NGUỒN DUY NHẤT cho backend và web.

Trước đây các giới hạn (độ dài tên 50, CCCD 12 số, tuổi 18–65, ngày cấp CCCD từ 2019...) chỉ nằm ở web;
backend không kiểm tra nên gọi thẳng API / web cũ vẫn lưu được dữ liệu sai, và có chỗ web cho nhập dài hơn
cột của Employee (nơi khai sinh 500 ký tự vs 255) -> lỗi DB khi chép sang hồ sơ.

- Serializer submit (hrm/serializers.py EmployeeOnboardingFormSerializer) kiểm tra theo các hằng số này.
- Web đọc cùng giá trị qua GET /api-hrm/system-rules/ (section "onboarding", public).
- Độ dài tối đa lấy từ chính field model mà giá trị được lưu vào (không chép số).
"""
import re
from datetime import date

from django.conf import settings
from rest_framework import serializers

# Họ tên / tên người liên hệ / mối quan hệ: chỉ chữ cái (kể cả tiếng Việt có dấu) và khoảng trắng.
# Cú pháp dùng được cho cả Python re và JavaScript RegExp.
NAME_PATTERN = r'^[a-zA-ZÀ-ỹ\s]+$'
PHONE_DIGITS = 10
CITIZEN_ID_DIGITS = 12
OLD_ID_DIGITS = 9
SOCIAL_INSURANCE_DIGITS = 10
TAX_CODE_MIN_DIGITS = 10
TAX_CODE_MAX_DIGITS = 13
MIN_AGE = 18
MAX_AGE = 65
EMERGENCY_CONTACT_MIN_AGE = 18
EMERGENCY_CONTACT_MAX_AGE = 100
# CCCD gắn chip cấp từ 2019 trở đi.
CITIZEN_ID_MIN_ISSUE_DATE = date(2019, 1, 1)

# File CCCD (2 mặt, PDF) — dùng chung cho form công khai, HCNS tạo onboarding và HCNS sửa onboarding.
CITIZEN_ID_FILE_EXTENSIONS = ('.pdf',)
CITIZEN_ID_FILE_MAX_BYTES = 15 * 1024 * 1024
# Ảnh VNeID: chỉ ảnh (định dạng theo settings.ALLOWED_IMAGE_TYPES), không nhận PDF.
VNEID_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif')
VNEID_MAX_BYTES = 10 * 1024 * 1024

# Hình thức làm việc người mới được chọn trên form (tập con của employee.models.WORK_FORM).
ONBOARDING_WORK_FORMS = ('FULL_TIME', 'PART_TIME')

# Ô chữ của form -> (field OnboardingProcess lưu tạm, field Employee nhận giá trị khi chép sang hồ sơ).
# Giới hạn độ dài = nhỏ nhất trong các field đó để không vỡ ở bước chép (vd nơi khai sinh 500 -> 255).
TEXT_FIELD_TARGETS = {
    'candidate_name': ('candidate_name', 'full_name'),
    'candidate_phone': ('candidate_phone', 'phone_number'),
    'birth_place': ('birth_place', 'birth_place'),
    'permanent_address': ('permanent_address', 'permanent_residence'),
    'current_address': ('current_address', 'current_address'),
    'ethnicity': ('ethnicity', 'ethnicity'),
    'nationality': ('nationality', 'nationality'),
    'citizen_id': ('citizen_id', 'cccd_number'),
    'citizen_id_issue_place': (None, 'cccd_issue_place'),
    'old_id_number': (None, 'old_id_number'),
    'social_insurance_number': ('social_insurance_number', 'social_insurance_number'),
    'tax_code': ('tax_code', 'tax_code'),
    'facebook_link': (None, 'facebook_link'),
    'region': ('region', 'region'),
    'block': ('block', 'block'),
    'section': ('section', 'section'),
    'job_rank': ('rank', 'rank'),
    'doctor_team': ('doctor_team', 'doctor_team'),
    'work_location': (None, 'work_location'),
    'emergency_contact_name': (None, 'emergency_contact_name'),
    'emergency_contact_relationship': (None, 'emergency_contact_relationship'),
    'emergency_contact_phone': (None, 'emergency_contact_phone'),
    'emergency_contact_occupation': (None, 'emergency_contact_occupation'),
    'emergency_contact_address': (None, 'emergency_contact_address'),
    'bank_name': ('bank_name', 'bank_name'),
    'bank_account': ('bank_account', 'bank_account'),
    'bank_account_holder': ('bank_account_holder', 'bank_account_holder'),
    'bank_branch': ('bank_branch', 'bank_branch'),
}


def text_max_lengths():
    """{ô form: số ký tự tối đa} — tính từ max_length của field model đích."""
    from employee.models import Employee
    from hrm.models import OnboardingProcess

    out = {}
    for form_field, (onboarding_field, employee_field) in TEXT_FIELD_TARGETS.items():
        limits = [Employee._meta.get_field(employee_field).max_length]
        if onboarding_field:
            limits.append(OnboardingProcess._meta.get_field(onboarding_field).max_length)
        limits = [n for n in limits if n]
        if limits:
            out[form_field] = min(limits)
    return out


def work_form_choices():
    from employee.models import WORK_FORM
    return [(code, label) for code, label in WORK_FORM if code in ONBOARDING_WORK_FORMS]


def find_department(name):
    """Phòng/Ban đang dùng theo tên — cùng tập web hiển thị (GET /api-hrm/departments/)."""
    from employee.models import Department
    return Department.objects.filter(name=name, is_section=False, is_deleted=False).order_by('id').first()


def find_position(title):
    from employee.models import Position
    return Position.objects.filter(title=title).order_by('id').first()


def vneid_mime_types():
    return list(getattr(settings, 'ALLOWED_IMAGE_TYPES', []))


def _mb(n_bytes):
    mb = n_bytes / (1024 * 1024)
    return f'{int(mb) if mb == int(mb) else round(mb, 1)}MB'


def validate_citizen_id_file(value):
    """File CCCD: PDF, tối đa CITIZEN_ID_FILE_MAX_BYTES."""
    if not value:
        return value
    if not value.name.lower().endswith(CITIZEN_ID_FILE_EXTENSIONS):
        raise serializers.ValidationError('File CCCD phải là định dạng PDF')
    if value.size > CITIZEN_ID_FILE_MAX_BYTES:
        raise serializers.ValidationError(f'File CCCD không được vượt quá {_mb(CITIZEN_ID_FILE_MAX_BYTES)}')
    return value


def validate_vneid_screenshot(value):
    """Ảnh VNeID: định dạng ảnh cho phép (settings.ALLOWED_IMAGE_TYPES) hoặc đuôi ảnh hợp lệ (trình
    duyệt có khi gửi HEIC với kiểu rỗng / octet-stream), tối đa VNEID_MAX_BYTES."""
    if not value:
        return value
    allowed = vneid_mime_types()
    ct = (getattr(value, 'content_type', '') or '').lower()
    ext_ok = (getattr(value, 'name', '') or '').lower().endswith(VNEID_EXTENSIONS)
    if allowed and ct and ct not in allowed and not ext_ok:
        raise serializers.ValidationError(f'Định dạng ảnh không hợp lệ. Cho phép: {", ".join(allowed)}')
    if value.size > VNEID_MAX_BYTES:
        raise serializers.ValidationError(f'Ảnh VNEID không được vượt quá {_mb(VNEID_MAX_BYTES)}')
    return value


def is_valid_name(value):
    """Họ tên / mối quan hệ chỉ gồm chữ cái và khoảng trắng (NAME_PATTERN)."""
    return bool(re.match(NAME_PATTERN, value or ''))


def age_on(born, today):
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _digits_error(value, label, min_digits, max_digits=None):
    max_digits = max_digits or min_digits
    if not re.fullmatch(r'[0-9]{%d,%d}' % (min_digits, max_digits), value):
        if min_digits == max_digits:
            return f'{label} phải có đúng {min_digits} chữ số'
        return f'{label} phải có {min_digits}-{max_digits} chữ số'
    return None


def validate_submit(attrs, today=None):
    """Kiểm tra dữ liệu form nhận việc lúc nộp — cùng quy tắc với web. Trả {field: lỗi}."""
    today = today or date.today()
    errors = {}

    for field, label in (
        ('candidate_name', 'Họ và tên'),
        ('emergency_contact_name', 'Tên người liên hệ'),
        ('emergency_contact_relationship', 'Mối quan hệ'),
    ):
        value = attrs.get(field)
        if value and not is_valid_name(value):
            errors[field] = f'{label} không được chứa số hoặc ký tự đặc biệt'

    digit_rules = (
        ('candidate_phone', 'Số điện thoại', PHONE_DIGITS, None),
        ('emergency_contact_phone', 'Số điện thoại người liên hệ', PHONE_DIGITS, None),
        ('citizen_id', 'Số CCCD', CITIZEN_ID_DIGITS, None),
        ('old_id_number', 'Số CMND cũ', OLD_ID_DIGITS, None),
        ('social_insurance_number', 'Mã BHXH', SOCIAL_INSURANCE_DIGITS, None),
        ('tax_code', 'Mã số thuế', TAX_CODE_MIN_DIGITS, TAX_CODE_MAX_DIGITS),
    )
    for field, label, min_digits, max_digits in digit_rules:
        value = attrs.get(field)
        if value:
            err = _digits_error(str(value), label, min_digits, max_digits)
            if err:
                errors[field] = err

    dob = attrs.get('date_of_birth')
    if dob:
        age = age_on(dob, today)
        if age < MIN_AGE:
            errors['date_of_birth'] = f'Chưa đủ {MIN_AGE} tuổi (hiện {age} tuổi)'
        elif age > MAX_AGE:
            errors['date_of_birth'] = f'Tuổi không hợp lệ ({age} tuổi)'

    contact_dob = attrs.get('emergency_contact_dob')
    if contact_dob:
        age = age_on(contact_dob, today)
        if contact_dob > today:
            errors['emergency_contact_dob'] = 'Ngày sinh không được sau hôm nay'
        elif age < EMERGENCY_CONTACT_MIN_AGE:
            errors['emergency_contact_dob'] = f'Người liên hệ phải đủ {EMERGENCY_CONTACT_MIN_AGE} tuổi (hiện {age} tuổi)'
        elif age > EMERGENCY_CONTACT_MAX_AGE:
            errors['emergency_contact_dob'] = f'Tuổi không hợp lệ ({age} tuổi)'

    issue_date = attrs.get('citizen_id_issue_date')
    if issue_date:
        if issue_date < CITIZEN_ID_MIN_ISSUE_DATE:
            errors['citizen_id_issue_date'] = (
                f'Ngày cấp CCCD gắn chip phải từ {CITIZEN_ID_MIN_ISSUE_DATE.strftime("%d/%m/%Y")} trở đi'
            )
        elif issue_date > today:
            errors['citizen_id_issue_date'] = 'Ngày cấp không được sau hôm nay'
    return errors

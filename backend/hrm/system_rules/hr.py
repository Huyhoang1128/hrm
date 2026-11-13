"""Section quy định: Nhân sự: hồ sơ nhân viên, hợp đồng, nhận việc (onboarding), danh sách lựa chọn, cấu hình công ty.

Xem hrm/system_rules/__init__.py. Mỗi hàm @rule_section trả dict, giá trị lấy từ đúng chỗ backend dùng.
"""
from . import rule_section


def _options(choices):
    return [{'value': value, 'label': label} for value, label in choices]


@rule_section('hr')
def hr_rules(request):
    """Quy định nhân sự cho trang quản trị (cần đăng nhập)."""
    from employee.models import CompanyUnit
    from hrm import company_config_rules, contract_rules

    prefix_field = CompanyUnit._meta.get_field('prefix_code')
    return {
        # Còn <= N ngày tới ngày kết thúc HĐ / thử việc là "sắp hết hạn" (cảnh báo, bộ lọc, nhãn).
        'contract_expiring_soon_days': contract_rules.expiring_soon_days(),
        # Trang tái ký: số ngày mặc định và khoảng ?days= backend chấp nhận.
        'contract_renewal_window_days': {
            'default': contract_rules.renewal_window_default_days(),
            'min': contract_rules.RENEWAL_WINDOW_MIN_DAYS,
            'max': contract_rules.RENEWAL_WINDOW_MAX_DAYS,
        },
        # Ô số của Cấu hình công ty: {field: {default, min, max, step, nullable}}.
        'company_config_fields': company_config_rules.field_rules(),
        # "Ký tự mã nhân sự" của đơn vị làm việc (CompanyUnit.prefix_code).
        'company_unit_prefix': {
            'max_length': prefix_field.max_length,
            'required': not prefix_field.blank,
        },
    }


@rule_section('choices', public=True)
def choices(request):
    """Danh sách lựa chọn từ choices của model — public vì form nhận việc chưa đăng nhập cũng cần."""
    from employee import models as em
    from hrm.models import CONTRACT_DOCUMENT_TYPE

    def in_contract_order(codes):
        return [code for code, _ in em.CONTRACT_TYPE if code in codes]

    return {
        'rank': _options(em.RANK_CHOICES),
        'employment_status': _options(em.EMPLOYMENT_STATUS),
        'contract_type': _options(em.CONTRACT_TYPE),
        # Loại của mẫu / bản hợp đồng (thêm Phụ lục).
        'contract_document_type': _options(CONTRACT_DOCUMENT_TYPE),
        'contract_type_groups': {
            'probation': in_contract_order(em.PROBATION_CONTRACT_TYPES),
            'non_official': in_contract_order(em.NON_OFFICIAL_CONTRACT_TYPES),
            'official_labor': in_contract_order(em.OFFICIAL_LABOR_CONTRACT_TYPES),
            'labor': in_contract_order(em.LABOR_CONTRACT_TYPES),
        },
        'work_form': _options(em.WORK_FORM),
        'education_level': _options(em.EDUCATION_LEVEL),
        'region': _options(em.REGION_CHOICES),
        'block': _options(em.BLOCK_CHOICES),
    }


@rule_section('onboarding', public=True)
def onboarding(request):
    """Giới hạn của form nhận việc công khai — cùng hằng số serializer submit kiểm tra (hrm/onboarding_rules.py)."""
    from hrm import onboarding_rules as r

    return {
        'text_max_length': r.text_max_lengths(),
        'name_pattern': r.NAME_PATTERN,
        'phone_digits': r.PHONE_DIGITS,
        'citizen_id_digits': r.CITIZEN_ID_DIGITS,
        'old_id_digits': r.OLD_ID_DIGITS,
        'social_insurance_digits': r.SOCIAL_INSURANCE_DIGITS,
        'tax_code_min_digits': r.TAX_CODE_MIN_DIGITS,
        'tax_code_max_digits': r.TAX_CODE_MAX_DIGITS,
        'min_age': r.MIN_AGE,
        'max_age': r.MAX_AGE,
        'emergency_contact_min_age': r.EMERGENCY_CONTACT_MIN_AGE,
        'emergency_contact_max_age': r.EMERGENCY_CONTACT_MAX_AGE,
        'citizen_id_min_issue_date': r.CITIZEN_ID_MIN_ISSUE_DATE.isoformat(),
        'citizen_id_file': {
            'extensions': list(r.CITIZEN_ID_FILE_EXTENSIONS),
            'max_bytes': r.CITIZEN_ID_FILE_MAX_BYTES,
        },
        'vneid_screenshot': {
            'mime_types': r.vneid_mime_types(),
            'extensions': list(r.VNEID_EXTENSIONS),
            'max_bytes': r.VNEID_MAX_BYTES,
        },
        'work_form': _options(r.work_form_choices()),
    }

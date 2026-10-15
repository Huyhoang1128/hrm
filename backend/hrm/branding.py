"""Thông tin công ty/thương hiệu dùng trong email, bản in và mật khẩu mặc định.

Mọi giá trị đọc từ settings (biến môi trường, xem .env.example) để không gán
cứng tên công ty, địa chỉ hay logo trong code.
"""
import re
from html import escape

from django.conf import settings


def _get(name, default=''):
    return getattr(settings, name, '') or default


def company_name():
    return _get('COMPANY_NAME', 'Công ty của bạn')


def company_legal_name():
    return _get('COMPANY_LEGAL_NAME', company_name().upper())


def hr_department_label():
    return _get('HR_DEPARTMENT_LABEL', 'Phòng Hành chính - Nhân sự')


def portal_url():
    return _get('HRM_PORTAL_URL') or _get('FRONTEND_URL', 'http://localhost:3000')


def user_guide_url():
    return _get('USER_GUIDE_URL') or portal_url()


def email_logo_url():
    return _get('EMAIL_LOGO_URL')


def email_banner_url():
    return _get('EMAIL_BANNER_URL')


def default_password(employee_id):
    """<DEFAULT_PASSWORD_PREFIX>@ + 5 số cuối mã nhân viên. VD: NV80020 → hrm@80020."""
    match = re.search(r'(\d+)$', str(employee_id or ''))
    tail = match.group(1)[-5:] if match else '00001'
    return f"{_get('DEFAULT_PASSWORD_PREFIX', 'hrm')}@{tail}"


def email_logo_html(width=80):
    url = email_logo_url()
    if not url:
        return ''
    return f'<img src="{escape(url)}" alt="Logo" style="width: {width}px;">'


def email_banner_html(max_width=600):
    url = email_banner_url()
    if not url:
        return ''
    return (
        f'<img src="{escape(url)}" alt="Banner" '
        f'style="width: 100%; max-width: {max_width}px; display: block;">'
    )


def _hr_contact_lines():
    lines = []
    address = _get('HR_CONTACT_ADDRESS')
    phone = _get('HR_CONTACT_PHONE')
    if address:
        lines.append(f'Địa chỉ: {address}')
    if phone:
        lines.append(f'SĐT: {phone}')
    return lines


def hr_signature_html():
    parts = [f'<strong>{escape(hr_department_label())}</strong>']
    parts.extend(escape(line) for line in _hr_contact_lines())
    return '<br>'.join(parts)


def hr_signature_text(indent=''):
    return ('\n' + indent).join([hr_department_label(), *_hr_contact_lines()])

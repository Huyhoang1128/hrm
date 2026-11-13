"""Giới hạn file tải lên (dung lượng, định dạng) theo từng tính năng — NGUỒN DUY NHẤT.

Backend kiểm tra bằng đúng các hằng số này; web đọc lại qua GET /api-hrm/system-rules/
(section "uploads", hrm/system_rules/misc.py) để chặn sớm + hiển thị câu chữ, không tự ghi số.
"""

MB = 1024 * 1024

# Ảnh đại diện (POST /api-hrm/change-avatar/).
AVATAR_MAX_BYTES = 5 * MB
AVATAR_ALLOWED_TYPES = ('image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif')

# File đính kèm thông báo công ty (CompanyAnnouncementViewSet).
ANNOUNCEMENT_ATTACHMENT_MAX_BYTES = 10 * MB
ANNOUNCEMENT_ATTACHMENT_EXTENSIONS = ('pdf', 'doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg')

# File mẫu hợp đồng (ContractTemplateViewSet) — engine điền placeholder chỉ đọc được Word .docx.
CONTRACT_TEMPLATE_EXTENSIONS = ('docx',)


def file_extension(name):
    """Đuôi file viết thường, không dấu chấm ('' nếu không có)."""
    name = str(name or '')
    return name.rsplit('.', 1)[-1].lower() if '.' in name else ''


def format_mb(num_bytes):
    """"10MB" / "0.5MB" — câu báo lỗi lấy từ đúng hằng số đang kiểm tra."""
    mb = num_bytes / MB
    return f'{int(mb)}MB' if mb == int(mb) else f'{mb:.1f}MB'

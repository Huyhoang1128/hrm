"""
Quy định hệ thống dùng chung cho web — NGUỒN DUY NHẤT (GET /api-hrm/system-rules/).

Vấn đề cần tránh: web tự ghi cứng con số / khung giờ / danh sách lựa chọn mà backend cũng có (cấu hình
hoặc hằng số) -> hai bên lệch nhau, đổi cấu hình ở backend thì web vẫn hiển thị / chặn theo số cũ.

Cách dùng:
  - Mỗi mảng nghiệp vụ khai báo các "section" ở module riêng trong package này (attendance.py,
    payroll.py, hr.py, misc.py), bằng decorator @rule_section("tên").
  - Giá trị PHẢI lấy từ đúng chỗ backend dùng khi kiểm tra / tính toán (hằng số, field cấu hình,
    validator của model...), KHÔNG chép số vào đây.
  - public=True: trả cả khi chưa đăng nhập (form nhận việc công khai, trang đăng nhập / quên mật khẩu).
    Section không public chỉ trả cho người đã đăng nhập.
  - Quy định phụ thuộc nhân viên / ngày cụ thể (hạn mức còn lại, hạn chót của 1 đơn...) KHÔNG để ở đây:
    trả kèm trong API của dữ liệu đó.

Web đọc qua frontend/src/services/systemRules.service.ts (getSystemRules / useSystemRules).
"""
_SECTIONS = {}


def rule_section(name, public=False):
    """Đăng ký 1 section: hàm nhận request (có thể None), trả dict JSON được."""
    def deco(fn):
        _SECTIONS[name] = (fn, public)
        return fn
    return deco


def build_rules(request=None, sections=None):
    """Dict {section: {...}}. sections: tập tên cần lấy (None = tất cả được phép)."""
    user = getattr(request, 'user', None)
    authenticated = bool(user is not None and user.is_authenticated)
    out = {}
    for name, (fn, public) in _SECTIONS.items():
        if sections and name not in sections:
            continue
        if not public and not authenticated:
            continue
        out[name] = fn(request)
    return out


# Đăng ký các section (đặt cuối file: các module dưới import rule_section từ package này).
from . import attendance, payroll, hr, misc  # noqa: E402,F401

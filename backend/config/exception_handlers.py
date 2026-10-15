"""
Custom DRF exception handler.

Khi 1 view gọi get_object_or_404(SomeQueryset, pk=pk) và không tìm thấy, DRF
(rest_framework.views.exception_handler) mặc định chuyển Http404 thành
NotFound(*exc.args) — tức là GIỮ NGUYÊN message kỹ thuật gốc của Django,
dạng "No <TênModel> matches the given query." — và trả thẳng ra ngoài cho
frontend hiển thị y hệt (tiếng Anh, tên model Python, vô nghĩa với người
dùng cuối). Đây KHÔNG phải lỗi hiếm gặp riêng lẻ — xảy ra ở BẤT KỲ endpoint
nào dùng get_object_or_404() khi item không còn tồn tại (thường do danh
sách trên UI đã cũ — người khác đã duyệt/xoá/xử lý xong trong lúc đó), nên
sửa 1 lần ở tầng exception handler chung thay vì từng call site.
"""
import re

from rest_framework.views import exception_handler as _drf_exception_handler

_GENERIC_DJANGO_404_RE = re.compile(r"^No \w+ matches the given query\.$")

FRIENDLY_404_MESSAGE = (
    "Không tìm thấy đơn/dữ liệu này — có thể đã được xử lý (duyệt/từ chối/xoá) "
    "bởi người khác trong lúc bạn đang xem. Vui lòng tải lại trang."
)


def friendly_exception_handler(exc, context):
    response = _drf_exception_handler(exc, context)

    if response is not None and response.status_code == 404 and isinstance(response.data, dict):
        detail = response.data.get("detail")
        if isinstance(detail, str) and _GENERIC_DJANGO_404_RE.match(detail):
            response.data["detail"] = FRIENDLY_404_MESSAGE

    return response

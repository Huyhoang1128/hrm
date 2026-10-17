"""
Khoá dữ liệu lương của tháng đã chốt (salary.MonthlyPayrollSnapshot).

Tháng đã chốt = có ít nhất 1 dòng snapshot. Các API ghi dữ liệu lương theo tháng
(hoa hồng, dữ liệu lương tháng, phạt biên bản, tạm ứng, phụ cấp khác / gửi xe /
ăn trưa, tính lương) trả HTTP 423 cho tháng đó — muốn sửa thì bỏ chốt trước.
"""
from rest_framework import status
from rest_framework.response import Response

PAYROLL_LOCKED_CODE = 'payroll_finalized'


def is_payroll_finalized(year, month) -> bool:
    from .salary_data_models import MonthlyPayrollSnapshot
    try:
        return MonthlyPayrollSnapshot.objects.filter(year=int(year), month=int(month)).exists()
    except (TypeError, ValueError):
        return False


def payroll_locked_response(year, month) -> Response:
    return Response(
        {
            'detail': (f'Bảng lương tháng {int(month):02d}/{int(year)} đã chốt nên không sửa được nữa. '
                       'Cần thay đổi thì bỏ chốt tháng đó trước.'),
            'code': PAYROLL_LOCKED_CODE,
            'year': int(year),
            'month': int(month),
        },
        status=status.HTTP_423_LOCKED,
    )


def locked_response_if_finalized(year, month):
    """Response 423 nếu tháng year/month đã chốt, ngược lại None."""
    if year and month and is_payroll_finalized(year, month):
        return payroll_locked_response(year, month)
    return None


def _period_from_data(data) -> tuple:
    try:
        return int(data.get('year')), int(data.get('month'))
    except (TypeError, ValueError, AttributeError):
        return None, None


class LockedPeriodMixin:
    """CRUD của model có year / month: chặn tạo / sửa / xoá bản ghi thuộc tháng đã chốt,
    kể cả sửa một bản ghi sang tháng đã chốt. Các action tuỳ chỉnh (bulk-import…) tự gọi
    locked_response_if_finalized()."""

    def create(self, request, *args, **kwargs):
        locked = locked_response_if_finalized(*_period_from_data(request.data))
        return locked or super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        year, month = _period_from_data(request.data)
        for period in ((instance.year, instance.month), (year or instance.year, month or instance.month)):
            locked = locked_response_if_finalized(*period)
            if locked:
                return locked
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        locked = locked_response_if_finalized(instance.year, instance.month)
        return locked or super().destroy(request, *args, **kwargs)

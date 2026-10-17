"""
API chốt lương tháng (chỉ Admin — cùng quyền với bảng lương):

    POST /api-hrm/salary/finalize/        {year, month}  chốt / chốt lại cả công ty
    POST /api-hrm/salary/unfinalize/      {year, month}  bỏ chốt (mở khoá dữ liệu lương)
    GET  /api-hrm/salary/finalize-state/?year=&month=    trạng thái + dữ liệu đã đổi sau khi chốt
"""
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from users.utils import get_user_role

from .payroll_finalization import finalize_salary_month, get_finalize_state, unfinalize_salary_month


def _period(data):
    """(year, month, None) hoặc (None, None, Response 400)."""
    try:
        year, month = int(data.get('year')), int(data.get('month'))
    except (TypeError, ValueError):
        year = month = None
    if not year or not (2000 <= year <= 2100 and 1 <= (month or 0) <= 12):
        return None, None, Response({'detail': 'year và month là bắt buộc và phải hợp lệ.'},
                                    status=status.HTTP_400_BAD_REQUEST)
    return year, month, None


class _AdminOnlyView(APIView):
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if get_user_role(request.user) != 'admin':
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Chỉ admin mới được chốt / bỏ chốt bảng lương.')


class FinalizeSalaryMonthView(_AdminOnlyView):
    def post(self, request):
        year, month, error = _period(request.data)
        if error:
            return error
        result = finalize_salary_month(year, month, user=request.user)
        if not result['total']:
            return Response({'detail': f'Tháng {month:02d}/{year} không có nhân viên nào trong bảng lương.'},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


class UnfinalizeSalaryMonthView(_AdminOnlyView):
    def post(self, request):
        year, month, error = _period(request.data)
        if error:
            return error
        removed = unfinalize_salary_month(year, month)
        if not removed:
            return Response({'detail': f'Tháng {month:02d}/{year} chưa chốt lương.'},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({'year': year, 'month': month, 'removed': removed})


class SalaryFinalizeStateView(_AdminOnlyView):
    def get(self, request):
        year, month, error = _period(request.query_params)
        if error:
            return error
        return Response(get_finalize_state(year, month))

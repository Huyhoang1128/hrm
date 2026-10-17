"""
/api-hrm/employee-changes/ — điều chỉnh nhân sự có ngày hiệu lực (Admin / HCNS).

    GET  employee-changes/?employee=&change_type=&status=a,b&search=&date_from=&date_to=
    POST employee-changes/   {employee, change_type, effective_date, note?,
                              department_id?, position_id?, basic_salary?, allowance?}
         — chỉ gửi trường muốn đổi; có khoá department_id / position_id nghĩa là đổi.
    POST employee-changes/<id>/cancel/
    GET  employee-changes/current/?employee=<id>   giá trị hiện tại + điều chỉnh đang chờ
"""
import datetime as dt

from django.db.models import Q
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from employee.models import Employee

from .employee_change_models import EmployeeChangeRecord
from .employee_change_service import (
    UNSET, EmployeeChangeError, apply_due_changes, cancel_change, create_change, current_values,
)
from .pagination import StandardResultsSetPagination
from .permissions import IsAdminOrHR


class EmployeeChangeRecordSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    change_type_display = serializers.CharField(source='get_change_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = EmployeeChangeRecord
        fields = [
            'id', 'employee', 'employee_code', 'employee_name', 'change_type', 'change_type_display',
            'status', 'status_display', 'effective_date', 'note',
            'changes_department', 'old_department', 'new_department', 'old_department_name', 'new_department_name',
            'changes_position', 'old_position', 'new_position', 'old_position_name', 'new_position_name',
            'old_basic_salary', 'new_basic_salary', 'old_allowance', 'new_allowance',
            'created_by_name', 'created_at', 'applied_at', 'cancelled_by_name', 'cancelled_at', 'apply_error',
        ]
        read_only_fields = fields


def _parse_date(value):
    try:
        return dt.date.fromisoformat(str(value)[:10]) if value else None
    except ValueError:
        return None


class EmployeeChangeRecordViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = EmployeeChangeRecordSerializer
    permission_classes = [IsAuthenticated, IsAdminOrHR]
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        qs = EmployeeChangeRecord.objects.select_related('employee')
        params = self.request.query_params
        if employee := params.get('employee'):
            qs = qs.filter(employee_id=employee)
        if change_type := params.get('change_type'):
            qs = qs.filter(change_type=change_type)
        if statuses := [s for s in (params.get('status') or '').split(',') if s]:
            qs = qs.filter(status__in=statuses)
        if search := (params.get('search') or '').strip():
            qs = qs.filter(Q(employee__employee_id__icontains=search) | Q(employee__full_name__icontains=search))
        if date_from := _parse_date(params.get('date_from')):
            qs = qs.filter(effective_date__gte=date_from)
        if date_to := _parse_date(params.get('date_to')):
            qs = qs.filter(effective_date__lte=date_to)
        return qs

    def list(self, request, *args, **kwargs):
        # Ngoài việc chạy định kỳ (manage.py apply_employee_changes), áp dụng luôn các điều
        # chỉnh đã đến ngày mỗi khi mở danh sách.
        apply_due_changes()
        return super().list(request, *args, **kwargs)

    def create(self, request):
        data = request.data
        employee = Employee.objects.filter(pk=data.get('employee')).select_related('department', 'position').first()
        if employee is None:
            return Response({'detail': 'Không tìm thấy nhân viên.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            record = create_change(
                employee, data.get('change_type'), _parse_date(data.get('effective_date')),
                user=request.user, note=data.get('note') or '',
                department_id=data['department_id'] if 'department_id' in data else UNSET,
                position_id=data['position_id'] if 'position_id' in data else UNSET,
                basic_salary=data.get('basic_salary'), allowance=data.get('allowance'),
            )
        except EmployeeChangeError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        record.refresh_from_db()
        return Response(self.get_serializer(record).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        record = self.get_object()
        try:
            record = cancel_change(record.pk, user=request.user)
        except EmployeeChangeError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(self.get_serializer(record).data)

    @action(detail=False, methods=['get'])
    def current(self, request):
        employee = (Employee.objects.filter(pk=request.query_params.get('employee'))
                    .select_related('department', 'position').first())
        if employee is None:
            return Response({'detail': 'Không tìm thấy nhân viên.'}, status=status.HTTP_404_NOT_FOUND)
        pending = EmployeeChangeRecord.objects.filter(employee=employee, status=EmployeeChangeRecord.Status.SCHEDULED)
        return Response({**current_values(employee),
                         'pending': self.get_serializer(pending, many=True).data})

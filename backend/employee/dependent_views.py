import django_filters
from django.utils import timezone
from rest_framework import status, viewsets, permissions, filters
from rest_framework.permissions import SAFE_METHODS, BasePermission
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend

from hrm.pagination import StandardResultsSetPagination
from .models import EmployeeDependent
from .serializers import EmployeeDependentSerializer


def is_hr_or_admin(user):
    """
    Admin/HR mới có quyền ghi. Nhận diện HR theo cùng cách với
    StaffReadOnlyPermission trong hrm/views.py: role từ get_user_role,
    kèm fallback theo chức danh/phòng ban có chữ 'HR' cho các hồ sơ cũ
    chưa bật cờ is_hr.
    """
    if not user or not user.is_authenticated:
        return False
    if user.is_staff or user.is_superuser:
        return True

    try:
        from users.utils import get_user_role
        user_role = get_user_role(user)
    except ImportError:
        user_role = 'staff' if hasattr(user, 'employee') else 'customer'

    if user_role in ('admin', 'hr'):
        return True

    employee = getattr(user, 'employee', None)
    if employee:
        if employee.position and 'HR' in employee.position.title.upper():
            return True
        if employee.department and 'HR' in employee.department.name.upper():
            return True
    return False


class DependentWritePermission(BasePermission):
    """Chỉ admin/HR được thêm/sửa/xoá; tài khoản khác chỉ đọc."""
    message = "Chỉ admin hoặc HR mới được thêm/sửa/xoá người phụ thuộc."

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return is_hr_or_admin(request.user)


class EmployeeDependentFilter(django_filters.FilterSet):
    """Lọc theo PK nhân viên hoặc mã nhân viên (employee_code), khoảng thời gian giảm trừ"""
    employee = django_filters.NumberFilter(field_name='employee__id')
    employee_code = django_filters.CharFilter(field_name='employee__employee_id', lookup_expr='exact')
    relationship = django_filters.CharFilter(field_name='relationship')
    is_active = django_filters.BooleanFilter(field_name='is_active')
    dependent_from_after = django_filters.DateFilter(field_name='dependent_from', lookup_expr='gte')
    dependent_to_before = django_filters.DateFilter(field_name='dependent_to', lookup_expr='lte')

    class Meta:
        model = EmployeeDependent
        fields = ['employee', 'employee_code', 'relationship', 'is_active']


class EmployeeDependentViewSet(viewsets.ModelViewSet):
    """
    CRUD người phụ thuộc (giảm trừ gia cảnh).

    GET    /api-hrm/employee-dependents/        - danh sách
    POST   /api-hrm/employee-dependents/        - tạo mới (admin/HR)
    GET    /api-hrm/employee-dependents/<id>/   - chi tiết
    PUT    /api-hrm/employee-dependents/<id>/   - cập nhật toàn bộ (admin/HR)
    PATCH  /api-hrm/employee-dependents/<id>/   - cập nhật một phần (admin/HR)
    DELETE /api-hrm/employee-dependents/<id>/   - xoá (admin/HR)

    Chỉ admin/HR được thêm/sửa/xoá và xem toàn bộ.
    Tài khoản khác chỉ xem, và chỉ thấy người phụ thuộc của chính mình.
    """
    queryset = EmployeeDependent.objects.select_related('employee').filter(is_deleted=False)
    serializer_class = EmployeeDependentSerializer
    permission_classes = [permissions.IsAuthenticated, DependentWritePermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = EmployeeDependentFilter
    search_fields = [
        'full_name', 'personal_identification_number', 'tax_code',
        'employee__employee_id', 'employee__full_name',
    ]
    ordering_fields = ['created_at', 'full_name', 'dependent_from', 'date_of_birth']
    ordering = ['-created_at']

    def destroy(self, request, *args, **kwargs):
        """
        Xoá mềm: đánh dấu thay vì xoá hẳn.

        Bảng lương đã chốt liên kết tới bản ghi này để truy vết ai được giảm trừ; xoá
        cứng sẽ cắt mất liên kết đó (bảng nối M2M dùng CASCADE). Muốn khôi phục thì bỏ
        cờ `is_deleted` trong Django admin.
        """
        instance = self.get_object()
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = request.user if request.user.is_authenticated else None
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'updated_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def get_queryset(self):
        queryset = super().get_queryset()
        if is_hr_or_admin(self.request.user):
            return queryset
        # Nhân viên thường: chỉ người phụ thuộc của chính mình.
        # User chưa gắn Employee thì không thấy gì.
        employee = getattr(self.request.user, 'employee', None)
        if employee is None:
            return queryset.none()
        return queryset.filter(employee=employee)

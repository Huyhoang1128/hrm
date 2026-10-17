"""/api-hrm/social-insurance-periods/ — kỳ đóng BHXH của nhân viên (Admin / HCNS). Lọc ?employee=<id>."""
from django.db.models import Q
from rest_framework import permissions, serializers, viewsets

from .dependent_views import is_hr_or_admin
from .models import SocialInsurancePeriod
from .social_insurance import sync_profile_level


class IsHrOrAdmin(permissions.BasePermission):
    message = 'Chỉ Admin hoặc HCNS được quản lý kỳ đóng BHXH.'

    def has_permission(self, request, view):
        return is_hr_or_admin(request.user)


class SocialInsurancePeriodSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)

    class Meta:
        model = SocialInsurancePeriod
        fields = ['id', 'employee', 'employee_code', 'employee_name', 'from_month', 'to_month',
                  'contribution_level', 'employee_rate', 'employer_rate', 'note', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def validate_contribution_level(self, value):
        if value is None or value < 0:
            raise serializers.ValidationError('Mức đóng không được âm.')
        return value

    def validate(self, attrs):
        employee = attrs.get('employee', getattr(self.instance, 'employee', None))
        start = attrs.get('from_month', getattr(self.instance, 'from_month', None))
        end = attrs.get('to_month', getattr(self.instance, 'to_month', None))
        start = start.replace(day=1) if start else None
        end = end.replace(day=1) if end else None
        for rate_field in ('employee_rate', 'employer_rate'):
            rate = attrs.get(rate_field)
            if rate is not None and not (0 <= rate <= 100):
                raise serializers.ValidationError({rate_field: 'Tỷ lệ phải trong khoảng 0–100%.'})
        if start and end and end < start:
            raise serializers.ValidationError({'to_month': 'Đến tháng phải sau hoặc bằng Từ tháng.'})
        if employee and start:
            overlap = SocialInsurancePeriod.objects.filter(employee=employee).filter(
                Q(to_month__isnull=True) | Q(to_month__gte=start))
            if end:
                overlap = overlap.filter(from_month__lte=end)
            if self.instance is not None:
                overlap = overlap.exclude(pk=self.instance.pk)
            if overlap.exists():
                raise serializers.ValidationError({
                    'from_month': f'{employee.full_name} đã có kỳ đóng BHXH trùng khoảng tháng này.'})
        return attrs


class SocialInsurancePeriodViewSet(viewsets.ModelViewSet):
    serializer_class = SocialInsurancePeriodSerializer
    permission_classes = [permissions.IsAuthenticated, IsHrOrAdmin]
    pagination_class = None

    def get_queryset(self):
        qs = SocialInsurancePeriod.objects.select_related('employee')
        if employee_id := self.request.query_params.get('employee'):
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        period = serializer.save(created_by=self.request.user)
        sync_profile_level(period.employee)

    def perform_update(self, serializer):
        period = serializer.save()
        sync_profile_level(period.employee)

    def perform_destroy(self, instance):
        employee = instance.employee
        instance.delete()
        sync_profile_level(employee)

import django_filters
from employee.models import Position


class PositionFilter(django_filters.FilterSet):
    """Filter for Position model"""

    is_management = django_filters.BooleanFilter(
        field_name='is_management',
        help_text="Lọc theo vị trí quản lý (true/false)"
    )
    department = django_filters.NumberFilter(
        field_name='department__id'
    )
    level = django_filters.NumberFilter(field_name='level')

    class Meta:
        model = Position
        fields = ['department', 'is_management', 'level']

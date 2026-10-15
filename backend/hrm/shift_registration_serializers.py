"""
hrm/shift_registration_serializers.py
══════════════════════════════════════
Serializers cho /api-hrm/shift-registrations/ (đăng ký ca làm theo tuần,
không qua duyệt — xem hrm/shift_registration_models.py).

Mỗi ngày chỉ lưu ca_choice (1/2/null=nghỉ) + snapshot morning_shift/
afternoon_shift của cặp ca đó — xem docstring shift_registration_models.py.
"""
from rest_framework import serializers

from .shift_registration_models import ShiftRegistration, ShiftRegistrationDay


class ShiftRegistrationDaySerializer(serializers.ModelSerializer):
    morning_shift_code = serializers.CharField(source='morning_shift.code', read_only=True, default=None)
    morning_shift_name = serializers.CharField(source='morning_shift.name', read_only=True, default=None)
    morning_start_time = serializers.TimeField(source='morning_shift.start_time', read_only=True, default=None)
    morning_end_time = serializers.TimeField(source='morning_shift.end_time', read_only=True, default=None)
    afternoon_shift_code = serializers.CharField(source='afternoon_shift.code', read_only=True, default=None)
    afternoon_shift_name = serializers.CharField(source='afternoon_shift.name', read_only=True, default=None)
    afternoon_start_time = serializers.TimeField(source='afternoon_shift.start_time', read_only=True, default=None)
    afternoon_end_time = serializers.TimeField(source='afternoon_shift.end_time', read_only=True, default=None)

    class Meta:
        model = ShiftRegistrationDay
        fields = [
            'id', 'date', 'ca_choice',
            'morning_shift_code', 'morning_shift_name', 'morning_start_time', 'morning_end_time',
            'afternoon_shift_code', 'afternoon_shift_name', 'afternoon_start_time', 'afternoon_end_time',
        ]


class ShiftRegistrationSerializer(serializers.ModelSerializer):
    days = ShiftRegistrationDaySerializer(many=True, read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    is_past_deadline = serializers.BooleanField(read_only=True)
    registration_deadline = serializers.DateTimeField(read_only=True)

    class Meta:
        model = ShiftRegistration
        fields = [
            'id', 'employee', 'employee_code', 'employee_name',
            'week_start_date', 'week_end_date', 'days',
            'is_past_deadline', 'registration_deadline',
            'created_at', 'updated_at',
        ]

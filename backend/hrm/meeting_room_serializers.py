from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from employee.models import Employee
from .models import (
    MeetingRoom,
    MeetingRoomBooking,
    MeetingRoomBookingLog,
    MeetingRoomSetting,
)


class MeetingRoomSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeetingRoom
        fields = [
            'id',
            'name',
            'code',
            'location',
            'capacity',
            'description',
            'is_active',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']


class MeetingRoomSettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = MeetingRoomSetting
        fields = [
            'id',
            'min_booking_minutes',
            'workday_start_hour',
            'workday_end_hour',
            'updated_by',
            'updated_at',
        ]
        read_only_fields = ['updated_by', 'updated_at']


class MeetingRoomBookingSerializer(serializers.ModelSerializer):
    room_name = serializers.CharField(source='room.name', read_only=True)
    booked_by_name = serializers.CharField(source='booked_by.full_name', read_only=True)
    booked_by_employee_id = serializers.IntegerField(source='booked_by.id', read_only=True)
    booked_by_user_id = serializers.IntegerField(source='booked_by_user.id', read_only=True)
    duration_minutes = serializers.IntegerField(read_only=True)

    class Meta:
        model = MeetingRoomBooking
        fields = [
            'id',
            'room',
            'room_name',
            'title',
            'note',
            'booked_by',
            'booked_by_name',
            'booked_by_employee_id',
            'booked_by_user',
            'booked_by_user_id',
            'booking_source',
            'ai_agent_name',
            'contact_name',
            'contact_phone',
            'start_time',
            'end_time',
            'duration_minutes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'booked_by',
            'booked_by_name',
            'booked_by_employee_id',
            'booked_by_user',
            'booked_by_user_id',
            'created_at',
            'updated_at',
            'duration_minutes',
        ]

    def _current_employee(self):
        request = self.context.get('request')
        if not request or not request.user or not request.user.is_authenticated:
            return None
        try:
            return Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return None

    def validate(self, attrs):
        start_time = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end_time = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        room = attrs.get('room', getattr(self.instance, 'room', None))

        if not start_time or not end_time or not room:
            return attrs

        if end_time <= start_time:
            raise serializers.ValidationError({'end_time': 'Giờ kết thúc phải lớn hơn giờ bắt đầu'})

        setting = MeetingRoomSetting.get_solo()
        duration_minutes = int((end_time - start_time).total_seconds() / 60)
        if duration_minutes < setting.min_booking_minutes:
            raise serializers.ValidationError(
                {'end_time': f'Mỗi lần đặt tối thiểu {setting.min_booking_minutes} phút'}
            )

        local_start = timezone.localtime(start_time)
        local_end = timezone.localtime(end_time)
        if local_start.date() != local_end.date():
            raise serializers.ValidationError({'end_time': 'Lịch đặt phải nằm trong cùng một ngày'})

        if local_start.hour < setting.workday_start_hour:
            raise serializers.ValidationError(
                {'start_time': f'Giờ đặt phải từ {setting.workday_start_hour}:00 trở đi'}
            )

        end_limit_minutes = setting.workday_end_hour * 60
        end_minutes = local_end.hour * 60 + local_end.minute
        if end_minutes > end_limit_minutes:
            raise serializers.ValidationError(
                {'end_time': f'Giờ kết thúc phải trước hoặc bằng {setting.workday_end_hour}:00'}
            )

        conflict_qs = MeetingRoomBooking.objects.filter(
            room=room,
            start_time__lt=end_time,
            end_time__gt=start_time,
        )
        if self.instance:
            conflict_qs = conflict_qs.exclude(pk=self.instance.pk)

        if conflict_qs.exists():
            raise serializers.ValidationError({'room': 'Khung giờ này đã có người đặt phòng'})

        return attrs

    def create(self, validated_data):
        request = self.context.get('request')
        employee = self._current_employee()

        if request and request.user and request.user.is_authenticated:
            validated_data['booked_by_user'] = request.user

        if employee:
            validated_data['booked_by'] = employee
            if not validated_data.get('contact_name'):
                validated_data['contact_name'] = employee.full_name or ''
            if not validated_data.get('contact_phone'):
                validated_data['contact_phone'] = (
                    employee.phone_number
                    or employee.phone
                    or employee.personal_email
                    or ''
                )

        return super().create(validated_data)


class MeetingRoomBookingLogSerializer(serializers.ModelSerializer):
    room_name = serializers.CharField(source='room.name', read_only=True)
    performed_by_username = serializers.CharField(source='performed_by.username', read_only=True)

    class Meta:
        model = MeetingRoomBookingLog
        fields = [
            'id',
            'booking',
            'room',
            'room_name',
            'action',
            'booking_source',
            'old_start_time',
            'old_end_time',
            'new_start_time',
            'new_end_time',
            'contact_name',
            'contact_phone',
            'ai_agent_name',
            'performed_by',
            'performed_by_username',
            'performed_by_role',
            'note',
            'created_at',
        ]

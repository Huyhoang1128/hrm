from datetime import datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Employee
from .meeting_room_serializers import (
    MeetingRoomBookingLogSerializer,
    MeetingRoomBookingSerializer,
    MeetingRoomSerializer,
    MeetingRoomSettingSerializer,
)
from .models import MeetingRoom, MeetingRoomBooking, MeetingRoomBookingLog, MeetingRoomSetting


class IsAdminOrHR(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff or user.is_superuser:
            return True
        try:
            employee = Employee.objects.get(user=user)
            return bool(employee.is_hr)
        except Employee.DoesNotExist:
            return False


class MeetingRoomViewSet(viewsets.ModelViewSet):
    queryset = MeetingRoom.objects.all().order_by('name')
    serializer_class = MeetingRoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action == 'list':
            include_inactive = str(self.request.query_params.get('include_inactive', '')).lower() in ['1', 'true', 'yes']
            if not include_inactive:
                queryset = queryset.filter(is_active=True)
        return queryset

    def _ensure_admin_or_hr(self):
        checker = IsAdminOrHR()
        if not checker.has_permission(self.request, self):
            raise PermissionDenied('Chỉ Admin hoặc HR mới có quyền quản lý phòng họp')

    def perform_create(self, serializer):
        self._ensure_admin_or_hr()
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._ensure_admin_or_hr()
        serializer.save()

    def perform_destroy(self, instance):
        self._ensure_admin_or_hr()
        instance.delete()


class MeetingRoomSettingView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        setting = MeetingRoomSetting.get_solo()
        return Response(MeetingRoomSettingSerializer(setting).data)

    def patch(self, request):
        checker = IsAdminOrHR()
        if not checker.has_permission(request, self):
            return Response(
                {'detail': 'Chỉ Admin hoặc HR mới có quyền cập nhật cấu hình phòng họp'},
                status=status.HTTP_403_FORBIDDEN,
            )

        setting = MeetingRoomSetting.get_solo()
        serializer = MeetingRoomSettingSerializer(setting, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)


class MeetingRoomBookingViewSet(viewsets.ModelViewSet):
    queryset = MeetingRoomBooking.objects.select_related('room', 'booked_by', 'booked_by_user').all()
    serializer_class = MeetingRoomBookingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _current_employee(self):
        try:
            return Employee.objects.get(user=self.request.user)
        except Employee.DoesNotExist:
            return None

    def _is_admin_or_hr(self):
        user = self.request.user
        if user.is_staff or user.is_superuser:
            return True
        employee = self._current_employee()
        return bool(employee and employee.is_hr)

    def _resolve_role_label(self):
        if self.request.user.is_staff or self.request.user.is_superuser:
            return 'ADMIN'
        employee = self._current_employee()
        if employee and employee.is_hr:
            return 'HR'
        return 'USER'

    def _can_edit_booking(self, booking):
        if self._is_admin_or_hr():
            return True
        employee = self._current_employee()
        if employee and booking.booked_by_id == employee.id:
            return True
        return booking.booked_by_user_id == self.request.user.id

    def _write_log(self, action, booking, old_start=None, old_end=None, note=''):
        MeetingRoomBookingLog.objects.create(
            booking=booking,
            room=booking.room,
            action=action,
            booking_source=booking.booking_source,
            old_start_time=old_start,
            old_end_time=old_end,
            new_start_time=booking.start_time,
            new_end_time=booking.end_time,
            contact_name=booking.contact_name,
            contact_phone=booking.contact_phone,
            ai_agent_name=booking.ai_agent_name,
            performed_by=self.request.user,
            performed_by_role=self._resolve_role_label(),
            note=note,
        )

    def get_queryset(self):
        qs = super().get_queryset().filter(room__is_active=True)

        room_id = self.request.query_params.get('room_id')
        if room_id:
            qs = qs.filter(room_id=room_id)

        date_param = self.request.query_params.get('date')
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')

        if date_param:
            parsed = parse_date(date_param)
            if parsed:
                tz = timezone.get_current_timezone()
                day_start = timezone.make_aware(datetime.combine(parsed, time.min), tz)
                day_end = day_start + timedelta(days=1)
                qs = qs.filter(start_time__lt=day_end, end_time__gt=day_start)
        else:
            if start_date:
                parsed_start = parse_date(start_date)
                if parsed_start:
                    tz = timezone.get_current_timezone()
                    dt_start = timezone.make_aware(datetime.combine(parsed_start, time.min), tz)
                    qs = qs.filter(end_time__gt=dt_start)
            if end_date:
                parsed_end = parse_date(end_date)
                if parsed_end:
                    tz = timezone.get_current_timezone()
                    dt_end = timezone.make_aware(datetime.combine(parsed_end, time.min), tz) + timedelta(days=1)
                    qs = qs.filter(start_time__lt=dt_end)

        return qs.order_by('start_time', 'room__name')

    def perform_create(self, serializer):
        booking_source = self.request.data.get('booking_source')
        if booking_source == 'AI' and not self._is_admin_or_hr():
            raise PermissionDenied('Chỉ Admin hoặc HR mới có quyền tạo booking từ AI')

        booking = serializer.save()
        self._write_log('CREATED', booking)

    def perform_update(self, serializer):
        booking = self.get_object()
        if not self._can_edit_booking(booking):
            raise PermissionDenied('Bạn không có quyền sửa lịch phòng họp này')

        old_start = booking.start_time
        old_end = booking.end_time
        updated = serializer.save()
        self._write_log('UPDATED', updated, old_start=old_start, old_end=old_end)

    def destroy(self, request, *args, **kwargs):
        booking = self.get_object()
        if not self._can_edit_booking(booking):
            raise PermissionDenied('Bạn không có quyền xóa lịch phòng họp này')

        role = self._resolve_role_label()
        old_start = booking.start_time
        old_end = booking.end_time

        MeetingRoomBookingLog.objects.create(
            booking=None,
            room=booking.room,
            action='DELETED',
            booking_source=booking.booking_source,
            old_start_time=old_start,
            old_end_time=old_end,
            new_start_time=None,
            new_end_time=None,
            contact_name=booking.contact_name,
            contact_phone=booking.contact_phone,
            ai_agent_name=booking.ai_agent_name,
            performed_by=request.user,
            performed_by_role=role,
            note=booking.note or '',
        )

        booking.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=['get'], url_path='history')
    def history(self, request):
        if not self._is_admin_or_hr():
            return Response(
                {'detail': 'Chỉ Admin hoặc HR mới có quyền xem lịch sử phòng họp'},
                status=status.HTTP_403_FORBIDDEN,
            )

        logs = MeetingRoomBookingLog.objects.select_related('room', 'performed_by').all()
        room_id = request.query_params.get('room_id')
        if room_id:
            logs = logs.filter(room_id=room_id)

        date_param = request.query_params.get('date')
        if date_param:
            parsed = parse_date(date_param)
            if parsed:
                tz = timezone.get_current_timezone()
                day_start = timezone.make_aware(datetime.combine(parsed, time.min), tz)
                day_end = day_start + timedelta(days=1)
                logs = logs.filter(created_at__gte=day_start, created_at__lt=day_end)

        serializer = MeetingRoomBookingLogSerializer(logs.order_by('-created_at')[:300], many=True)
        return Response(serializer.data)

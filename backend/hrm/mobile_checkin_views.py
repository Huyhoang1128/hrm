"""
hrm/mobile_checkin_views.py
API endpoint cho mobile app chấm công gọi để chấm công qua GPS.
Xác thực: X-Server-Key header (server-to-server)
"""

import datetime
import logging
import hmac
from django.utils import timezone
from django.db.models import Min, Max
from django.db import transaction, OperationalError
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings

from employee.models import Employee
from .event_models import EmployeeEvent
from .models import Attendance
from .location_utils import validate_checkout_location


def _sync_attendance_record(employee, event_date, check_in, check_out):
    """Đồng bộ EmployeeEvent mobile → Attendance (legacy) để HRMAttendanceEngine nhìn thấy."""
    code = f"ATT-MOB-{employee.employee_id}-{event_date}"
    Attendance.objects.update_or_create(
        attendance_code=code,
        defaults={
            'employee': employee,
            'attendance_date': event_date,
            'check_in': check_in,
            'check_out': check_out,
            'status': 'PRESENT',
            'notes': 'Chấm công qua app mobile',
        },
    )

logger = logging.getLogger(__name__)


def _verify_server_key(request):
    expected = getattr(settings, 'SERVER_API_KEY', '') or ''
    if not expected:
        # Chưa cấu hình key thì không cho gọi — tránh header rỗng khớp key rỗng.
        return False
    server_key = request.headers.get('X-Server-Key', '')
    return hmac.compare_digest(server_key, expected)


class MobileCheckinView(APIView):
    """
    POST /api/v1/hrm/attendance/mobile-checkin/
    Body: { employee_id, action, latitude, longitude }
    Header: X-Server-Key: <SERVER_API_KEY>
    """
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        if not _verify_server_key(request):
            return Response({'detail': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)

        employee_id = request.data.get('employee_id', '').strip()
        action = request.data.get('action', '').strip()
        latitude = request.data.get('latitude')
        longitude = request.data.get('longitude')
        local_date_str = request.data.get('local_date')
        local_time_str = request.data.get('local_time')

        if not employee_id:
            return Response({'detail': 'employee_id là bắt buộc'}, status=status.HTTP_400_BAD_REQUEST)
        if action not in ('checkin', 'checkout'):
            return Response({'detail': 'action phải là "checkin" hoặc "checkout"'}, status=status.HTTP_400_BAD_REQUEST)
        if latitude is None or longitude is None:
            return Response({'detail': 'latitude và longitude là bắt buộc'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            latitude = float(latitude)
            longitude = float(longitude)
        except (TypeError, ValueError):
            return Response({'detail': 'latitude/longitude không hợp lệ'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            employee = Employee.objects.select_related('company_unit').get(employee_id=employee_id)
        except Employee.DoesNotExist:
            return Response({'detail': f'Không tìm thấy nhân viên {employee_id}'}, status=status.HTTP_404_NOT_FOUND)

        # Validate vị trí — tìm cơ sở active gần nhất
        branch, distance, is_valid = validate_checkout_location(latitude, longitude)

        if not is_valid:
            dist_text = f"{round(distance)}m" if distance is not None else "không xác định"
            branch_name = branch['name'] if branch else "chưa cấu hình"
            logger.warning("[%s] employee=%s ngoài vùng: %s cách %s", action, employee_id, branch_name, dist_text)
            return Response({
                'is_valid': False,
                'distance_meters': round(distance, 1) if distance is not None else None,
                'branch_name': branch_name,
                'message': f'Bạn đang cách {branch_name} {dist_text}, vui lòng chấm công trong bán kính {branch["radius_meters"] if branch else 100}m',
            }, status=status.HTTP_400_BAD_REQUEST)

        server_today = timezone.localdate()
        server_now_time = timezone.localtime().time()

        today = server_today
        now_time = server_now_time
        if local_date_str:
            try:
                client_date = datetime.date.fromisoformat(str(local_date_str))
                if abs((client_date - server_today).days) <= 1:
                    today = client_date
            except (ValueError, TypeError):
                pass
        if local_time_str:
            try:
                now_time = datetime.time.fromisoformat(str(local_time_str))
            except (ValueError, TypeError):
                pass

        if action == 'checkin':
            from .attendance_models import BranchLocation
            branch_obj = BranchLocation.objects.get(id=branch['id'])
            event, created = EmployeeEvent.objects.get_or_create(
                employee=employee,
                event_date=today,
                event_type=EmployeeEvent.EventType.ATTENDANCE,
                checkin_is_valid=True,
                defaults={
                    'created_by': employee,
                    'check_in': now_time,
                    'checkin_latitude': latitude,
                    'checkin_longitude': longitude,
                    'checkin_distance_m': round(distance, 1),
                    'branch_location': branch_obj,
                },
            )
            _sync_attendance_record(employee, today, event.check_in, event.check_out)
            logger.info("[Checkin] employee=%s date=%s time=%s created=%s branch=%s dist=%sm",
                        employee_id, today, now_time, created, branch['name'], round(distance))
            return Response({
                'is_valid': True,
                'action': 'checkin',
                'event_id': event.id,
                'time': str(event.check_in)[:5],
                'distance_meters': round(distance, 1),
                'branch_name': branch['name'],
                'already_checked_in': not created,
                'message': f'Checkin thành công tại {branch["name"]} ({round(distance)}m)' if created else 'Đã checkin hôm nay',
            }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

        else:  # checkout
            try:
                with transaction.atomic():
                    event = EmployeeEvent.objects.select_for_update(nowait=True).filter(
                        employee=employee,
                        event_date=today,
                        event_type=EmployeeEvent.EventType.ATTENDANCE,
                        checkin_is_valid=True,
                        check_in__isnull=False,
                    ).order_by('-check_in').first()

                    if not event:
                        logger.warning("[Checkout] employee=%s chưa checkin ngày %s", employee_id, today)
                        return Response(
                            {'is_valid': False, 'detail': 'Chưa checkin hôm nay'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    # Chỉ update nếu giờ mới muộn hơn (đảm bảo MAX)
                    if event.check_out is None or now_time > event.check_out:
                        from .attendance_models import BranchLocation
                        checkout_branch_obj = BranchLocation.objects.get(id=branch['id'])
                        event.check_out = now_time
                        event.checkout_branch_location = checkout_branch_obj
                        event.checkout_distance_m = round(distance, 1)
                        event.checkout_latitude = latitude
                        event.checkout_longitude = longitude
                        event.save(update_fields=[
                            'check_out', 'checkout_branch_location', 'checkout_distance_m',
                            'checkout_latitude', 'checkout_longitude', 'updated_at',
                        ])
                        _sync_attendance_record(employee, today, event.check_in, event.check_out)
                        logger.info("[Checkout] employee=%s date=%s time=%s branch=%s dist=%sm",
                                    employee_id, today, now_time, branch['name'], round(distance))

            except OperationalError:
                logger.error("[Checkout] employee=%s row locked", employee_id)
                return Response(
                    {'detail': 'Đang xử lý, vui lòng thử lại'},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )

            return Response({
                'is_valid': True,
                'action': 'checkout',
                'event_id': event.id,
                'check_in': str(event.check_in)[:5],
                'check_out': str(event.check_out)[:5] if event.check_out else str(now_time)[:5],
                'distance_meters': round(distance, 1),
                'branch_name': branch['name'],
                'message': f'Checkout thành công tại {branch["name"]} ({round(distance)}m)',
            }, status=status.HTTP_200_OK)


class AttendanceTodayView(APIView):
    """
    GET /api/v1/hrm/attendance/mobile-today/?employee_id=NV001
    """
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        if not _verify_server_key(request):
            return Response({'detail': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)

        employee_id = request.query_params.get('employee_id', '').strip()
        if not employee_id:
            return Response({'detail': 'employee_id là bắt buộc'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            employee = Employee.objects.get(employee_id=employee_id)
        except Employee.DoesNotExist:
            return Response({'detail': f'Không tìm thấy nhân viên {employee_id}'}, status=status.HTTP_404_NOT_FOUND)

        today = timezone.localdate()
        qs = EmployeeEvent.objects.filter(
            employee=employee,
            event_date=today,
            event_type=EmployeeEvent.EventType.ATTENDANCE,
            checkin_is_valid=True,
        ).select_related('branch_location', 'checkout_branch_location').order_by('check_in')

        events = list(qs)
        if not events:
            return Response({
                'has_checkin': False,
                'has_checkout': False,
                'check_in': None,
                'check_out': None,
                'branch_name': None,
                'distance_meters': None,
                'sessions': [],
            })

        agg = qs.aggregate(min_ci=Min('check_in'), max_co=Max('check_out'))
        has_checkout = all(e.check_out is not None for e in events)

        def fmt(t):
            return str(t)[:5] if t else None

        sessions = [
            {
                'event_id': e.id,
                'check_in': fmt(e.check_in),
                'check_out': fmt(e.check_out),
                'branch_name': e.branch_location.name if e.branch_location else None,
                'distance_meters': e.checkin_distance_m,
                'checkout_branch_name': e.checkout_branch_location.name if e.checkout_branch_location else None,
                'checkout_distance_meters': e.checkout_distance_m,
            }
            for e in events
        ]

        first_event = next((e for e in events if e.branch_location), None)
        checkout_event = max((e for e in events if e.check_out), key=lambda e: e.check_out, default=None)

        return Response({
            'has_checkin': agg['min_ci'] is not None,
            'has_checkout': has_checkout,
            'check_in': fmt(agg['min_ci']),
            'check_out': fmt(agg['max_co']),
            'branch_name': first_event.branch_location.name if first_event else None,
            'distance_meters': first_event.checkin_distance_m if first_event else None,
            'checkout_branch_name': checkout_event.checkout_branch_location.name if checkout_event and checkout_event.checkout_branch_location else None,
            'checkout_distance_meters': checkout_event.checkout_distance_m if checkout_event else None,
            'sessions': sessions,
        })

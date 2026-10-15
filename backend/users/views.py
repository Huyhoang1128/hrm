"""
User API views for the HRM project.
Contains only HRM-relevant views (no CRM-specific views).
"""
import logging
import os
import requests
import secrets
import time

from django.contrib.auth.models import User
from django.db import connection
from django.db.models import Q
from django.utils import timezone
from django.conf import settings

from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from drf_yasg import openapi
from drf_yasg.utils import swagger_auto_schema

from .jwt_serializers import HRMTokenObtainPairView
from .models import Notification
from .notification_service import NotificationService
from .serializers import NotificationSerializer
from .utils import (
    get_employee_permission_data,
    get_user_permissions,
    get_user_role,
    get_user_role_display,
)

logger = logging.getLogger(__name__)


class UserProfileView(APIView):
    """
    User profile view that requires JWT authentication
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from employee.models import Employee, Department

        user = request.user
        employee = getattr(user, 'employee', None)
        employee_permission = get_employee_permission_data(employee) if employee else None

        # is_manager: NV có vị trí quản lý, là trưởng phòng, hoặc có cấp dưới trực tiếp.
        # Phải đồng bộ với visibility Q trong GenericRequestViewSet
        # (Q(employee__manager=employee)) — FE dùng flag này để bật tab "Cần tôi duyệt".
        is_manager = False
        if employee is not None:
            try:
                if employee.position and getattr(employee.position, 'is_management', False):
                    is_manager = True
                elif Department.objects.filter(manager=employee).exists():
                    is_manager = True
                elif Employee.objects.filter(manager=employee).exists():
                    is_manager = True
            except Exception:
                is_manager = False

        # NV có thuộc phạm vi tính năng "Đăng ký ca làm" không (cấu hình ở
        # Django admin — hrm.ShiftRegistrationScopeConfig). FE dùng flag này
        # để ẨN HẲN menu "Đăng ký ca làm" cho NV ngoài phạm vi, thay vì chỉ
        # hiện trang với thông báo "không thuộc phạm vi".
        shift_registration_in_scope = False
        if employee is not None:
            try:
                from hrm.shift_registration_models import ShiftRegistrationScopeConfig
                # BUG ĐÃ SỬA: trước đây lấy đại config is_active đầu tiên
                # (.first()) rồi chỉ check employee_in_scope() trên ĐÚNG 1
                # config đó — sai từ khi hỗ trợ NHIỀU config song song, vì NV
                # có thể thuộc config #2/#3... chứ không phải config đầu tiên
                # (VD: NV phòng IT/AI thuộc config riêng, không phải config
                # của nhóm bác sĩ có id nhỏ nhất) -> menu bị ẩn oan. Dùng
                # for_employee() để tự tìm đúng config áp dụng cho NV này.
                shift_registration_in_scope = bool(ShiftRegistrationScopeConfig.for_employee(employee))
            except Exception:
                shift_registration_in_scope = False

        # BUG ĐÃ SỬA: view này trước đây KHÔNG trả về employee_profile/hrm_user,
        # nên FE (authAPI.getProfile trong hrm/src/utils/api/auth.api.ts) luôn
        # fallback về dữ liệu is_hr/is_manager... cũ được cache trong
        # localStorage['login_response'] từ lần đăng nhập gần nhất — khiến admin
        # tick is_hr=True cho nhân viên xong, nhân viên đó KHÔNG thấy nút "Tạo quy
        # trình mới" cho tới khi họ đăng xuất rồi đăng nhập lại (F5 không đủ).
        # Thêm 2 field này để mỗi lần FE gọi lại /api/users/profile/ đều lấy đúng
        # is_hr mới nhất từ DB, không cần đăng nhập lại.
        employee_profile_data = None
        hrm_user_data = None
        if employee is not None:
            employee_profile_data = {
                'id': employee.id,
                'employee_id': employee.employee_id,
                'full_name': employee.full_name,
                'position': employee.position.title if employee.position else None,
                'position_code': employee.position.code if employee.position else None,
                'department': employee.department.name if employee.department else None,
                'department_code': employee.department.code if employee.department else None,
                'manager_id': employee.manager.employee_id if employee.manager else None,
                'manager_name': employee.manager.full_name if employee.manager else None,
                'employment_status': employee.employment_status,
                'is_manager': is_manager,
                'is_hr': employee.is_hr,
                'shift_registration_in_scope': shift_registration_in_scope,
            }
            hrm_user_data = {
                'employee_id': employee.employee_id,
                'full_name': employee.full_name,
                'position': employee.position.title if employee.position else None,
                'department': employee.department.name if employee.department else None,
                'is_manager': is_manager,
                'is_hr': employee.is_hr,
                'is_super_admin': user.is_superuser or (employee.position and employee.position.code == 'ADMIN'),
            }

        return Response({
            'message': f'Hello {user.username}!',
            'user_id': user.id,
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'role': get_user_role(user),
            'role_display': get_user_role_display(user),
            'permissions': get_user_permissions(user),
            'is_staff': user.is_staff,
            'is_superuser': user.is_superuser,
            'is_supperuser': user.is_superuser,
            'is_active': user.is_active,
            'is_manager': is_manager,
            'shift_registration_in_scope': shift_registration_in_scope,
            'date_joined': user.date_joined,
            'employee_permission': employee_permission,
            'employee_profile': employee_profile_data,
            'hrm_user': hrm_user_data,
        }, status=status.HTTP_200_OK)


class UserRegistrationView(APIView):
    """
    User registration view (public endpoint)
    """
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get('username')
        email = request.data.get('email')
        password = request.data.get('password')
        first_name = request.data.get('first_name', '')
        last_name = request.data.get('last_name', '')

        if not username or not email or not password:
            return Response({
                'success': False,
                'error': 'Tên đăng nhập, email và mật khẩu là bắt buộc'
            }, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username=username).exists():
            return Response({
                'success': False,
                'error': 'Tên đăng nhập đã tồn tại'
            }, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(email=email).exists():
            return Response({
                'success': False,
                'error': 'Email này đã được sử dụng'
            }, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name
            )

            refresh = RefreshToken.for_user(user)

            return Response({
                'success': True,
                'message': 'Đăng ký thành công',
                'user_id': user.id,
                'username': user.username,
                'email': user.email,
                'tokens': {
                    'refresh': str(refresh),
                    'access': str(refresh.access_token),
                }
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            logger.error(f"Error in user registration: {str(e)}")
            return Response({
                'success': False,
                'error': f'Đăng ký thất bại: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


class PublicInfoView(APIView):
    """
    Public information view (no authentication required)
    """
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({
            'message': 'Welcome to HRM API',
            'available_endpoints': {
                'user_registration': '/api/users/register/',
                'token_obtain': '/api/token/',
                'token_refresh': '/api/token/refresh/',
                'token_verify': '/api/token/verify/',
                'user_profile': '/api/users/profile/',
                'admin': '/admin/',
                'api_auth': '/api-auth/',
            },
            'authentication': {
                'type': 'JWT (JSON Web Token)',
                'header': 'Authorization: Bearer <token>',
                'token_lifetime': '60 minutes (access), 1 day (refresh)'
            }
        }, status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    """
    API to change user password.
    Requires current password and new password.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            user = request.user
            current_password = request.data.get('current_password')
            new_password = request.data.get('new_password')
            confirm_password = request.data.get('confirm_password')

            if not current_password or not new_password or not confirm_password:
                return Response({
                    'error': 'Mật khẩu hiện tại, mật khẩu mới và xác nhận mật khẩu là bắt buộc'
                }, status=status.HTTP_400_BAD_REQUEST)

            if new_password != confirm_password:
                return Response({
                    'error': 'Mật khẩu mới và xác nhận mật khẩu không khớp'
                }, status=status.HTTP_400_BAD_REQUEST)

            if len(new_password) < 6:
                return Response({
                    'error': 'Mật khẩu mới phải có ít nhất 6 ký tự'
                }, status=status.HTTP_400_BAD_REQUEST)

            if not user.check_password(current_password):
                return Response({
                    'error': 'Mật khẩu hiện tại không đúng'
                }, status=status.HTTP_400_BAD_REQUEST)

            user.set_password(new_password)
            user.save()

            logger.info(f"Password changed for user {user.username} (ID: {user.id})")

            return Response({
                'success': True,
                'message': 'Mật khẩu đã được thay đổi thành công'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error changing password for user {request.user.username}: {str(e)}")
            return Response({
                'error': f'Lỗi khi thay đổi mật khẩu: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


class ForgotPasswordView(APIView):
    """
    API to initiate forgot password process.
    Sends OTP to user's phone number (default OTP: 8888).
    """
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            phone_number = request.data.get('phone_number')

            if not phone_number:
                return Response({
                    'error': 'Số điện thoại là bắt buộc'
                }, status=status.HTTP_400_BAD_REQUEST)

            if not phone_number.isdigit() or len(phone_number) < 10:
                return Response({
                    'error': 'Số điện thoại không hợp lệ'
                }, status=status.HTTP_400_BAD_REQUEST)

            try:
                user = User.objects.get(username=phone_number)
            except User.DoesNotExist:
                return Response({
                    'error': 'Không tìm thấy tài khoản với số điện thoại này'
                }, status=status.HTTP_404_NOT_FOUND)

            otp_code = "8888"
            logger.info(f"Forgot password OTP for {phone_number}: {otp_code}")

            request.session[f'otp_{phone_number}'] = otp_code
            request.session[f'otp_expiry_{phone_number}'] = time.time() + 600  # 10 minutes

            return Response({
                'success': True,
                'message': 'OTP đã được gửi thành công'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error in forgot password: {str(e)}")
            return Response({
                'error': f'Lỗi khi gửi OTP: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


class VerifyOTPView(APIView):
    """
    API to verify OTP and generate reset token.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            phone_number = request.data.get('phone_number')
            otp_code = request.data.get('otp_code')

            if not phone_number or not otp_code:
                return Response({
                    'error': 'Số điện thoại và mã OTP là bắt buộc'
                }, status=status.HTTP_400_BAD_REQUEST)

            try:
                user = User.objects.get(username=phone_number)
            except User.DoesNotExist:
                return Response({
                    'error': 'Không tìm thấy tài khoản với số điện thoại này'
                }, status=status.HTTP_404_NOT_FOUND)

            expected_otp = "8888"

            if otp_code != expected_otp:
                return Response({
                    'error': 'Mã OTP không đúng'
                }, status=status.HTTP_400_BAD_REQUEST)

            refresh = RefreshToken.for_user(user)
            reset_token = str(refresh.access_token)

            request.session[f'reset_token_{phone_number}'] = reset_token
            request.session[f'reset_token_expiry_{phone_number}'] = time.time() + 3600  # 1 hour

            if f'otp_{phone_number}' in request.session:
                del request.session[f'otp_{phone_number}']
            if f'otp_expiry_{phone_number}' in request.session:
                del request.session[f'otp_expiry_{phone_number}']

            return Response({
                'success': True,
                'reset_token': reset_token
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error verifying OTP: {str(e)}")
            return Response({
                'error': f'Lỗi khi xác thực OTP: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


class ResetPasswordView(APIView):
    """
    API to reset password using reset token.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        try:
            reset_token = request.data.get('reset_token')
            new_password = request.data.get('new_password')

            if not reset_token or not new_password:
                return Response({
                    'error': 'Reset token và mật khẩu mới là bắt buộc'
                }, status=status.HTTP_400_BAD_REQUEST)

            if len(new_password) < 6:
                return Response({
                    'error': 'Mật khẩu mới phải có ít nhất 6 ký tự'
                }, status=status.HTTP_400_BAD_REQUEST)

            phone_number = None
            for key in request.session.keys():
                if key.startswith('reset_token_') and request.session[key] == reset_token:
                    phone_number = key.replace('reset_token_', '')
                    break

            if not phone_number:
                return Response({
                    'error': 'Reset token không hợp lệ hoặc đã hết hạn'
                }, status=status.HTTP_400_BAD_REQUEST)

            try:
                user = User.objects.get(username=phone_number)
            except User.DoesNotExist:
                return Response({
                    'error': 'Không tìm thấy tài khoản'
                }, status=status.HTTP_404_NOT_FOUND)

            user.set_password(new_password)
            user.save()

            if f'reset_token_{phone_number}' in request.session:
                del request.session[f'reset_token_{phone_number}']
            if f'reset_token_expiry_{phone_number}' in request.session:
                del request.session[f'reset_token_expiry_{phone_number}']

            logger.info(f"Password reset for user {user.username} (ID: {user.id})")

            return Response({
                'success': True,
                'message': 'Mật khẩu đã được đặt lại thành công'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error resetting password: {str(e)}")
            return Response({
                'error': f'Lỗi khi đặt lại mật khẩu: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


class DeleteAccountView(APIView):
    """
    API endpoint for users to deactivate their own account.
    DELETE /api/users/auth/account/
    """
    permission_classes = [IsAuthenticated]

    @swagger_auto_schema(
        operation_description="Deactivate user account with password confirmation",
        request_body=openapi.Schema(
            type=openapi.TYPE_OBJECT,
            required=['password'],
            properties={
                'password': openapi.Schema(
                    type=openapi.TYPE_STRING,
                    description='Current password for confirmation'
                ),
                'reason': openapi.Schema(
                    type=openapi.TYPE_STRING,
                    description='Reason for account deletion (optional)',
                    max_length=500
                ),
            },
        ),
        responses={
            200: openapi.Response(description="Account deactivated successfully"),
            400: openapi.Response(description="Bad request - validation errors"),
            401: openapi.Response(description="Unauthorized - invalid token"),
        },
        tags=['Authentication']
    )
    def delete(self, request):
        """
        Deactivate user account with password confirmation.
        """
        try:
            user = request.user
            password = request.data.get('password')
            reason = request.data.get('reason', '')

            if not password:
                return Response({
                    'success': False,
                    'error': 'Mật khẩu là bắt buộc để xác nhận'
                }, status=status.HTTP_400_BAD_REQUEST)

            if not user.check_password(password):
                return Response({
                    'success': False,
                    'error': 'Mật khẩu không đúng'
                }, status=status.HTTP_400_BAD_REQUEST)

            if not user.is_active:
                return Response({
                    'success': False,
                    'error': 'Tài khoản đã bị vô hiệu hóa'
                }, status=status.HTTP_400_BAD_REQUEST)

            now = timezone.now()

            # Deactivate user account
            user.is_active = False
            user.save()

            log_message = f"Account deactivated by user {user.username} (ID: {user.id})"
            if reason:
                log_message += f" - Reason: {reason}"
            logger.info(log_message)

            return Response({
                'success': True,
                'message': 'Tài khoản đã được vô hiệu hóa thành công',
                'deleted_at': now.isoformat(),
                'note': 'Your account has been deactivated. Contact support if you need to restore it.'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error deactivating account for user {request.user.id}: {str(e)}")
            return Response({
                'success': False,
                'error': 'An error occurred while deactivating the account',
                'details': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


# ============================================================================
# NOTIFICATION API VIEWS
# ============================================================================

class NotificationListView(generics.ListAPIView):
    """
    API to get notifications for the authenticated user.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer

    def get_queryset(self):
        user = self.request.user
        user_id_str = str(user.id)
        user_id_param = self.request.GET.get('user_id') or user_id_str

        if connection.vendor == 'postgresql':
            queryset = Notification.objects.filter(
                Q(user=user) |
                Q(target_user_ids__contains=[int(user_id_param)]) |
                Q(target_external_ids__contains=[int(user_id_param)])
            ).order_by('-created_at')
        else:
            # SQLite dev fallback
            queryset = Notification.objects.filter(
                Q(user=user) |
                Q(target_user_ids__icontains=int(user_id_param)) |
                Q(target_external_ids__icontains=int(user_id_param))
            ).order_by('-created_at')

        is_read = self.request.GET.get('is_read')
        if is_read is not None:
            queryset = queryset.filter(is_read=is_read.lower() == 'true')

        notification_type = self.request.GET.get('notification_type')
        if notification_type:
            queryset = queryset.filter(notification_type=notification_type)

        is_send = self.request.GET.get('is_send')
        if is_send is not None:
            queryset = queryset.filter(is_send=is_send.lower() == 'true')

        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        mark_all_read = request.GET.get('mark_all_read', '').lower() == 'true'
        if mark_all_read:
            unread_count = queryset.filter(is_read=False).update(is_read=True)
            logger.info(f"Marked {unread_count} notifications as read for user {request.user.id}")

        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'count': queryset.count(),
            'next': None,
            'previous': None,
            'results': serializer.data
        })


class NotificationMarkReadView(APIView):
    """
    API to mark a specific notification as read.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, notification_id):
        try:
            notification = Notification.objects.get(id=notification_id)

            user = request.user
            user_id_str = str(user.id)

            has_permission = (
                notification.user == user or
                (notification.target_user_ids and user.id in notification.target_user_ids) or
                (notification.target_external_ids and user_id_str in notification.target_external_ids)
            )

            if not has_permission:
                return Response({
                    'error': 'Bạn không có quyền đánh dấu thông báo này'
                }, status=status.HTTP_403_FORBIDDEN)

            notification.is_read = True
            notification.save()

            return Response({
                'success': True,
                'message': 'Đã đánh dấu thông báo là đã đọc'
            }, status=status.HTTP_200_OK)

        except Notification.DoesNotExist:
            return Response({
                'error': 'Thông báo không tồn tại'
            }, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error marking notification as read: {str(e)}")
            return Response({
                'error': f'Lỗi khi đánh dấu thông báo: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


class NotificationMarkAllReadView(APIView):
    """
    API to mark all notifications as read for the authenticated user.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            user = request.user
            user_id_str = str(user.id)

            unread_notifications = Notification.objects.filter(
                Q(user=user) |
                Q(target_user_ids__contains=[user.id]) |
                Q(target_external_ids__contains=[user_id_str]),
                is_read=False
            )

            count = unread_notifications.count()
            unread_notifications.update(is_read=True)

            logger.info(f"Marked {count} notifications as read for user {user.id}")

            return Response({
                'success': True,
                'message': f'Đã đánh dấu {count} thông báo là đã đọc',
                'count': count
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error marking all notifications as read: {str(e)}")
            return Response({
                'error': f'Lỗi khi đánh dấu thông báo: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


class NotificationUnreadCountView(APIView):
    """
    API to get count of unread notifications for the authenticated user.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            user = request.user
            user_id_str = str(user.id)

            unread_count = Notification.objects.filter(
                Q(user=user) |
                Q(target_user_ids__contains=[user.id]) |
                Q(target_external_ids__contains=[user_id_str]),
                is_read=False
            ).count()

            return Response({
                'success': True,
                'unread_count': unread_count
            }, status=status.HTTP_200_OK)

        except Exception as e:
            logger.error(f"Error getting unread notification count: {str(e)}")
            return Response({
                'error': f'Lỗi khi lấy số thông báo chưa đọc: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)


# ============================================================================
# STAFF LOOKUP VIEW
# ============================================================================

class StaffLookupView(APIView):
    """
    API to lookup staff/employee information.
    Accessible by authenticated staff users.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            if not request.user.is_staff:
                return Response({
                    'error': 'Bạn không có quyền tra cứu thông tin nhân viên'
                }, status=status.HTTP_403_FORBIDDEN)

            account = request.data.get('account')

            if not account:
                return Response({
                    'success': False,
                    'message': 'Tài khoản là bắt buộc'
                }, status=status.HTTP_400_BAD_REQUEST)

            crm_api_base_url = os.environ.get('CRM_API_BASE_URL', '')
            crm_api_key = os.environ.get('CRM_API_KEY', '')
            crm_debug_mode = os.environ.get('CRM_DEBUG_MODE', 'True').lower() == 'true'

            if not crm_debug_mode and crm_api_key:
                crm_api_url = f"{crm_api_base_url}/staff/lookup"
                headers = {'Content-Type': 'application/json'}
                if crm_api_key:
                    headers['X-API-Key'] = crm_api_key

                payload = {'account': account}
                logger.info(f"Calling CRM API for staff lookup: {crm_api_url}, payload: {payload}")

                response = requests.post(crm_api_url, json=payload, headers=headers, timeout=10)

                if response.status_code == 200:
                    data = response.json()
                    if data.get('success') and data.get('data'):
                        return Response({'success': True, 'data': data['data']}, status=status.HTTP_200_OK)
                    return Response({
                        'success': False,
                        'message': data.get('message', 'Không tìm thấy nhân viên với tài khoản này')
                    }, status=status.HTTP_404_NOT_FOUND)

                logger.error(f"CRM API error: {response.status_code} - {response.text}")
                return Response({
                    'success': False,
                    'message': f'Lỗi khi gọi CRM API: {response.status_code}'
                }, status=status.HTTP_400_BAD_REQUEST)

            logger.info(f"CRM debug mode, returning mock data for account: {account}")
            mock_data = {
                'staff_id': 1133,
                'account': account,
                'name': 'Nguyễn Văn A',
                'phone_number': '0900000000'
            }
            return Response({'success': True, 'data': mock_data}, status=status.HTTP_200_OK)

        except requests.exceptions.RequestException as e:
            logger.error(f"CRM API connection error: {str(e)}")
            return Response({
                'success': False,
                'message': f'Lỗi kết nối CRM API: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Error in staff lookup: {str(e)}")
            return Response({
                'success': False,
                'message': f'Lỗi khi tra cứu thông tin nhân viên: {str(e)}'
            }, status=status.HTTP_400_BAD_REQUEST)

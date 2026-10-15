"""
Notification API views for sending notifications via OneSignal
"""
import logging
from datetime import timedelta
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.utils import timezone

from .onesignal_service import get_onesignal_service
from .models import Notification
from .authentication import ServerAPIKeyOrJWTAuthentication

logger = logging.getLogger(__name__)


class SendNotificationView(APIView):
    """
    API endpoint to send a notification to a specific user via OneSignal
    
    POST /api/users/notifications/send/
    
    Request body:
    {
        "title": "Notification title",
        "message": "Notification message content",
        "user_id": 123,  # Django User ID (used as external_id for OneSignal)
        "data": {  # Optional additional data
            "type": "custom_type",
            "custom_field": "value"
        }
    }
    
    Response:
    {
        "success": true,
        "message": "Notification sent successfully",
        "notification_id": "onesignal_notification_id",
        "recipients": 1
    }
    """
    authentication_classes = [ServerAPIKeyOrJWTAuthentication]
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Send a notification to a specific user via OneSignal
        """
        try:
            # Extract required parameters
            title = request.data.get('title')
            message = request.data.get('message')
            user_id = request.data.get('user_id')
            print("------**")
            
            # Validate required fields
            if not title:
                return Response({
                    'success': False,
                    'error': 'Title is required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not message:
                return Response({
                    'success': False,
                    'error': 'Message is required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not user_id:
                return Response({
                    'success': False,
                    'error': 'User ID is required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Validate user exists
            try:
                user = User.objects.get(id=user_id)
            except User.DoesNotExist:
                return Response({
                    'success': False,
                    'error': f'User with ID {user_id} does not exist'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Check if user has permission to send notifications
            # For API key authentication (request.user is None), skip permission check
            # For JWT authentication, check user role
            # if request.user is not None:
            #     user_role = self._get_user_role(request.user)
            #     allowed_roles = ['admin', 'doctor', 'nurse', 'customer_care']
            #     print("check per")
            #     if user_role not in allowed_roles:
            #         return Response({
            #             'success': False,
            #             'error': 'You do not have permission to send notifications'
            #         }, status=status.HTTP_403_FORBIDDEN)
            
            # Get additional data if provided
            data = request.data.get('data', {})
            
            # Add user information to data
            sent_by_user_id = request.user.id if request.user else 0
            sent_by_username = request.user.username if request.user else 'system'
            data.update({
                'user_id': user_id,
                'sent_by_user_id': sent_by_user_id,
                'sent_by_username': sent_by_username
            })
            
            # Check if this is an activity notification and add deeplink if needed
            # Look for activity_id in data or in request data
            activity_id = data.get('activity_id') or request.data.get('activity_id')
            if activity_id and not data.get('launch_url'):
                try:
                    launch_url = f"hrm://tabs/today/{activity_id}"
                    data['launch_url'] = launch_url
                    data['activity_id'] = activity_id
                    logger.info(f"Added deeplink for activity {activity_id}: {launch_url}")
                except Exception:
                    pass  # Deeplink is optional
                    launch_url = f"hrm://tabs/today/{activity_id}"
                    data['launch_url'] = launch_url
                    data['activity_id'] = activity_id
                    logger.warning(f"Activity with ID {activity_id} not found, using default deeplink {launch_url}")
                except Exception as e:
                    logger.error(f"Error creating deeplink for activity {activity_id}: {str(e)}")
                    # Continue without deeplink
            
            # Get OneSignal service
            onesignal_service = get_onesignal_service()
            
            # Send notification using user ID as external_id
            # OneSignal expects external_id as a string
            result = onesignal_service.send_notification(
                message=message,
                heading=title,
                external_user_ids=[str(user_id)],  # Convert to string for OneSignal external_id
                data=data,
                url=data.get('launch_url') if isinstance(data, dict) else None
            )
            
            if result.get('success'):
                sent_by = request.user.id if request.user else 'system'
                logger.info(f"Notification sent successfully to user {user_id} by {sent_by}")
                return Response({
                    'success': True,
                    'message': 'Notification sent successfully',
                    'notification_id': result.get('notification_id'),
                    'recipients': result.get('recipients', 0),
                    'response': result.get('response', {})
                }, status=status.HTTP_200_OK)
            else:
                logger.error(f"Failed to send notification to user {user_id}: {result.get('error')}")
                return Response({
                    'success': False,
                    'error': f'Failed to send notification: {result.get("error")}',
                    'details': result.get('details', {})
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
        except Exception as e:
            logger.error(f"Error sending notification: {str(e)}")
            return Response({
                'success': False,
                'error': f'Error sending notification: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _get_user_role(self, user):
        """Get user role string"""
        if user.is_staff or user.is_superuser:
            return 'admin'
        elif hasattr(user, 'doctor_profile'):
            return 'doctor'
        elif hasattr(user, 'nurse_profile'):
            return 'nurse'
        elif hasattr(user, 'customer_profile'):
            return 'customer'
        else:
            return 'unknown'


class SendUserNotificationView(APIView):
    """
    API endpoint to send a notification to a specific user via OneSignal
    
    POST /api/users/notifications/send/
    
    Request body:
    {
        "title": "Notification title",
        "message": "Notification message content",
        "user_id": 123,  # Django User ID (used as external_id for OneSignal)
        "id": 456,  # Optional: Notification ID to update existing notification record
        "data": {  # Optional additional data
            "type": "custom_type",
            "custom_field": "value"
        }
    }
    
    Response:
    {
        "success": true,
        "message": "Notification sent successfully",
        "notification_id": "onesignal_notification_id",
        "recipients": 1,
        "db_notification_id": 789  # ID of the Notification record in database
    }
    """
    authentication_classes = [ServerAPIKeyOrJWTAuthentication]
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Send a notification to a specific user via OneSignal
        """
        try:
            # Extract required parameters
            title = request.data.get('title')
            message = request.data.get('message')
            user_id = request.data.get('user_id')
            notification_id = request.data.get('id')  # Optional notification ID
            
            # Validate required fields
            if not title:
                return Response({
                    'success': False,
                    'error': 'Title is required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not message:
                return Response({
                    'success': False,
                    'error': 'Message is required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not user_id:
                return Response({
                    'success': False,
                    'error': 'User ID is required'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Validate user exists
            try:
                user = User.objects.get(id=user_id)
            except User.DoesNotExist:
                return Response({
                    'success': False,
                    'error': f'User with ID {user_id} does not exist'
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Check if user has permission to send notifications
            # For API key authentication (request.user is None), skip permission check
            # For JWT authentication, check user role
            # if request.user is not None:
            #     user_role = self._get_user_role(request.user)
            #     allowed_roles = ['admin', 'doctor', 'nurse', 'customer_care']
            #     print("check per")
            #     if user_role not in allowed_roles:
            #         return Response({
            #             'success': False,
            #             'error': 'You do not have permission to send notifications'
            #         }, status=status.HTTP_403_FORBIDDEN)
            
            # Get additional data if provided
            data = request.data.get('data', {})
            
            # Add user information to data
            sent_by_user_id = request.user.id if request.user else 0
            sent_by_username = request.user.username if request.user else 'system'
            data.update({
                'user_id': user_id,
                'sent_by_user_id': sent_by_user_id,
                'sent_by_username': sent_by_username
            })
            

            # Check if notification ID is provided and notification exists
            notification = None
            if notification_id:
                try:
                    notification = Notification.objects.get(id=notification_id)
                    
                    # Check if notification is already sent
                    if notification.is_send or notification.status == 'sent':
                        logger.info(f"Notification with ID {notification_id} is already sent (is_send={notification.is_send}, status={notification.status})")
                        return Response({
                            'success': True,
                            'message': 'Notification already sent',
                            'notification_id': notification.provider_message_id,
                            'recipients': 1,
                            'db_notification_id': notification.id,
                            'already_sent': True
                        }, status=status.HTTP_200_OK)
                    
                    # Update notification fields with new data
                    notification.title = title
                    notification.content = message
                    notification.data = data
                    notification.updated_at = timezone.now()
                    logger.info(f"Found existing notification with ID {notification_id}, updating before sending")
                except Notification.DoesNotExist:
                    logger.warning(f"Notification with ID {notification_id} not found")
                    return Response({
                        'success': False,
                        'error': f'Notification with ID {notification_id} does not exist'
                    }, status=status.HTTP_404_NOT_FOUND)
            
                        # Check if this is an activity notification and add deeplink if needed
            # Look for activity_id in data or in request data
            
            if notification is not None:
                activity_id = notification.activity_id
            else:
                activity_id = None

            if activity_id:
                launch_url = f"hrm://tabs/today/{activity_id}"
                data['launch_url'] = launch_url
                data['activity_id'] = activity_id
            

            # Get OneSignal service
            onesignal_service = get_onesignal_service()
            
            # Send notification using user ID as external_id
            # OneSignal expects external_id as a string
            result = onesignal_service.send_notification(
                message=message,
                heading=title,
                external_user_ids=[str(user_id)],  # Convert to string for OneSignal external_id
                data=data,
                url=data.get('launch_url') if isinstance(data, dict) else None
            )
            
            if result.get('success'):
                # Create or update notification record
                if notification:
                    # Update existing notification
                    notification.is_send = True
                    notification.status = 'sent'
                    notification.sent_time = timezone.now()
                    notification.provider_message_id = result.get('notification_id')
                    notification.save()
                    db_notification_id = notification.id
                    logger.info(f"Updated notification record {db_notification_id} after successful send")
                
                sent_by = request.user.id if request.user else 'system'
                logger.info(f"Notification sent successfully to user {user_id} by {sent_by}")
                return Response({
                    'success': True,
                    'message': 'Notification sent successfully',
                    'notification_id': result.get('notification_id'),
                    'recipients': result.get('recipients', 0),
                    'db_notification_id': db_notification_id,
                    'response': result.get('response', {})
                }, status=status.HTTP_200_OK)
            else:
                # If sending failed, update notification status if it exists
                if notification:
                    notification.status = 'failed'
                    notification.error_message = result.get('error', 'Unknown error')
                    notification.save()
                    logger.error(f"Failed to send notification {notification.id} to user {user_id}: {result.get('error')}")
                else:
                    logger.error(f"Failed to send notification to user {user_id}: {result.get('error')}")
                
                return Response({
                    'success': False,
                    'error': f'Failed to send notification: {result.get("error")}',
                    'details': result.get('details', {})
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
        except Exception as e:
            logger.error(f"Error sending notification: {str(e)}")
            return Response({
                'success': False,
                'error': f'Error sending notification: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _get_user_role(self, user):
        """Get user role string"""
        if user.is_staff or user.is_superuser:
            return 'admin'
        elif hasattr(user, 'doctor_profile'):
            return 'doctor'
        elif hasattr(user, 'nurse_profile'):
            return 'nurse'
        elif hasattr(user, 'customer_profile'):
            return 'customer'
        else:
            return 'unknown'




class SendNotificationToCustomerView(APIView):
    """
    CRM feature removed - Customer notifications are no longer supported.
    """
    authentication_classes = [ServerAPIKeyOrJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from rest_framework import status as drf_status
        return Response(
            {'detail': 'Customer notification feature has been removed.'},
            status=drf_status.HTTP_410_GONE
        )


class TestNotificationView(APIView):
    """
    API endpoint to test OneSignal integration
    
    POST /api/users/notifications/test/
    
    Request body (optional):
    {
        "user_id": 123  # Optional user ID to test with
    }
    
    This sends a test notification to verify OneSignal is working
    """
    authentication_classes = [ServerAPIKeyOrJWTAuthentication]
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Send a test notification
        """
        try:
            # Check if user has permission to test notifications
            # For API key authentication (request.user is None), skip permission check
            # For JWT authentication, check user role
            if request.user is not None:
                user_role = self._get_user_role(request.user)
                allowed_roles = ['admin', 'doctor', 'nurse', 'customer_care']
                
                if user_role not in allowed_roles:
                    return Response({
                        'success': False,
                        'error': 'You do not have permission to test notifications'
                    }, status=status.HTTP_403_FORBIDDEN)
            
            # Get optional user_id
            user_id = request.data.get('user_id')
            user_ids = []
            
            if user_id:
                # Validate user exists
                try:
                    user = User.objects.get(id=user_id)
                    user_ids = [str(user_id)]
                    target_description = f"user {user_id} ({user.username})"
                except User.DoesNotExist:
                    return Response({
                        'success': False,
                        'error': f'User with ID {user_id} does not exist'
                    }, status=status.HTTP_404_NOT_FOUND)
            else:
                # If no user_id specified, use a test segment
                user_ids = None
                target_description = "test users segment"
            
            # Get OneSignal service
            onesignal_service = get_onesignal_service()
            
            # Send test notification
            result = onesignal_service.send_notification(
                message="🧪 Đây là thông báo kiểm tra từ HRM! Hệ thống thông báo đang hoạt động bình thường. 💖",
                heading="✅ HRM Test Notification",
                external_user_ids=user_ids,
                segments=["Test Users"] if not user_ids else None,
                data={
                    'type': 'test_notification',
                    'timestamp': str(timezone.now()),
                    'sent_by': request.user.username if request.user else 'system'
                },
                url=(request.data.get('data') or {}).get('launch_url')
            )
            
            if result.get('success'):
                sent_by = request.user.id if request.user else 'system'
                logger.info(f"Test notification sent successfully to {target_description} by {sent_by}")
                return Response({
                    'success': True,
                    'message': f'Test notification sent successfully to {target_description}',
                    'notification_id': result.get('notification_id'),
                    'recipients': result.get('recipients', 0),
                    'target': target_description,
                    'response': result.get('response', {})
                }, status=status.HTTP_200_OK)
            else:
                logger.error(f"Failed to send test notification: {result.get('error')}")
                return Response({
                    'success': False,
                    'error': f'Failed to send test notification: {result.get("error")}',
                    'details': result.get('details', {}),
                    'note': 'Check that OneSignal is properly configured with ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY environment variables'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
        except Exception as e:
            logger.error(f"Error sending test notification: {str(e)}")
            return Response({
                'success': False,
                'error': f'Error sending test notification: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _get_user_role(self, user):
        """Get user role string"""
        if user.is_staff or user.is_superuser:
            return 'admin'
        elif hasattr(user, 'doctor_profile'):
            return 'doctor'
        elif hasattr(user, 'nurse_profile'):
            return 'nurse'
        elif hasattr(user, 'customer_profile'):
            return 'customer'
        else:
            return 'unknown'

"""
URL configuration for users app - HRM project
"""
from django.urls import path
from rest_framework_simplejwt.views import (
    TokenRefreshView,
    TokenVerifyView,
)
from . import views
from .jwt_serializers import CustomTokenObtainPairView
from .care_activity_views import (
    DailyCareActivityViewSet, CompletionMediaViewSet, CustomerCareDashboardViewSet,
    ApplyActivityTemplatesToCareJourneyView
)
from .notification_views import (
    SendNotificationView, SendNotificationToCustomerView, TestNotificationView, SendUserNotificationView
)

urlpatterns = [
    # Authentication endpoints
    path('token/', CustomTokenObtainPairView.as_view(), name='token-obtain'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token-refresh'),
    path('token/verify/', TokenVerifyView.as_view(), name='token-verify'),
    path('auth/account/', views.DeleteAccountView.as_view(), name='delete-account'),

    # User management endpoints
    path('register/', views.UserRegistrationView.as_view(), name='user-register'),
    path('profile/', views.UserProfileView.as_view(), name='user-profile'),
    path('info/', views.PublicInfoView.as_view(), name='public-info'),

    # Password management
    path('change-password/', views.ChangePasswordView.as_view(), name='change-password'),
    path('forgot-password/', views.ForgotPasswordView.as_view(), name='forgot-password'),
    path('verify-otp/', views.VerifyOTPView.as_view(), name='verify-otp'),
    path('reset-password/', views.ResetPasswordView.as_view(), name='reset-password'),

    # Notification endpoints
    path('notifications/send/', SendNotificationView.as_view(), name='send-notification'),
    path('user-notifications/send/', SendUserNotificationView.as_view(), name='send-notification-v2'),
    path('notifications/send-to-customer/', SendNotificationToCustomerView.as_view(), name='send-notification-to-customer'),
    path('notifications/test/', TestNotificationView.as_view(), name='test-notification'),
    path('notifications/', views.NotificationListView.as_view(), name='notification-list'),
    path('notifications/<int:notification_id>/mark-read/', views.NotificationMarkReadView.as_view(), name='notification-mark-read'),
    path('notifications/mark-all-read/', views.NotificationMarkAllReadView.as_view(), name='notification-mark-all-read'),
    path('notifications/unread-count/', views.NotificationUnreadCountView.as_view(), name='notification-unread-count'),

    # Staff lookup (used by HRM)
    path('staff/lookup/', views.StaffLookupView.as_view(), name='staff-lookup'),
]

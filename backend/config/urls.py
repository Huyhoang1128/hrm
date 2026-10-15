"""
URL configuration for the HRM project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include, re_path
from users import views as user_views
from django.conf import settings
from django.conf.urls.static import static
from django.views.static import serve
from rest_framework import permissions
from drf_yasg.views import get_schema_view
from drf_yasg import openapi
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)
from hrm import views as hrm_views

# Schema view for API documentation
schema_view = get_schema_view(
    openapi.Info(
        title="HRM API",
        default_version='v1',
        description="API documentation for the HRM system",
        license=openapi.License(name="MIT License"),
    ),
    public=True,
    permission_classes=(permissions.AllowAny,),
)

urlpatterns = [
    path('admin/', admin.site.urls),
    # API Documentation endpoints
    re_path(r'^swagger(?P<format>\.json|\.yaml)$', schema_view.without_ui(cache_timeout=0), name='schema-json'),
    path('swagger/', schema_view.with_ui('swagger', cache_timeout=0), name='schema-swagger-ui'),
    path('redoc/', schema_view.with_ui('redoc', cache_timeout=0), name='schema-redoc'),
    # User API endpoints (includes authentication)
    path('api/users/', include('users.urls')),
    # Print URLs - KHÔNG đi qua API
    path('hrm/print-attendance-explanations/', hrm_views.print_attendance_explanation_multiple, name='print-attendance-explanation-multiple'),
    # HRM API endpoints
    path('api-hrm/users/token/', user_views.HRMTokenObtainPairView.as_view(), name='hrm-token-obtain'),
    path('api-hrm/', include('hrm.urls')),
    # HRM Attendance Engine v1 (event-driven rule engine)
    path('api/v1/hrm/', include('hrm.urls_v1')),
    # User Media API endpoints
    # Dashboard API endpoints
    # Service API endpoints
    # Appointment API endpoints
    # Agents API endpoints (Chat functionality)
    # Chat API endpoints (conversation, message, SSE)
    path('api/chat/', include('chat.urls')),
    # Salary (Payroll) API endpoints
    path('api/v1/salary/', include('salary.urls')),
    # Marketing (MKT) API endpoints
    # Recruitment API endpoints
    path('api/v1/recruitment/', include('recruitment.urls')),
    # REST Framework browsable API auth
    path('api-auth/', include('rest_framework.urls', namespace='rest_framework')),
]

# Serve media files (always, for Docker dev setup — bypasses DEBUG check)
urlpatterns += [
    re_path(r'^media/(?P<path>.*)$', serve, {'document_root': settings.MEDIA_ROOT}),
]
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

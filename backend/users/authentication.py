"""
API Key Authentication for server-to-server communication
"""
import os
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from django.conf import settings


class ServerAPIKeyAuthentication(BaseAuthentication):
    """
    API Key authentication for server-to-server communication.
    
    Expects API key in the 'X-API-Key' header.
    The API key should be configured in settings.py as SERVER_API_KEY.
    """
    
    def authenticate(self, request):
        """
        Authenticate the request using API key in header.
        """
        # Get API key from header (case-insensitive)
        api_key = request.headers.get('X-API-Key') or request.headers.get('X-Api-Key')
        
        if not api_key:
            # Also check for Authorization header with Bearer token format
            auth_header = request.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                api_key = auth_header.split('Bearer ')[1]
            else:
                return None
        
        # Get configured API key from settings
        configured_api_key = getattr(settings, 'SERVER_API_KEY', None)
        
        if not configured_api_key:
            raise AuthenticationFailed('Server API key not configured')
        
        # Compare API keys
        if api_key != configured_api_key:
            raise AuthenticationFailed('Invalid API key')
        
        # If API key matches, return or create a service user so DRF's IsAuthenticated
        # permission will treat the request as authenticated.
        from django.contrib.auth import get_user_model
        UserModel = get_user_model()
        service_username = getattr(settings, 'SERVER_API_USER', 'server_api')
        try:
            user, created = UserModel.objects.get_or_create(
                username=service_username,
                defaults={
                    'is_active': True,
                    'is_staff': False,  # Service user needs staff privileges for sync operations
                    'is_superuser': False,
                }
            )
            if created:
                # Ensure the service user has no usable password
                user.set_unusable_password()
                user.save()
        except Exception:
            # If DB is unavailable or creation fails, raise AuthenticationFailed
            raise AuthenticationFailed('Failed to provision service user for API key authentication')

        return (user, None)
    
    def authenticate_header(self, request):
        """
        Return the authentication header value.
        """
        return 'Bearer realm="api"'


class ServerAPIKeyOrJWTAuthentication(BaseAuthentication):
    """
    Combined authentication that accepts either API key or JWT token.
    
    This allows both server-to-server calls (with API key) and 
    authenticated user calls (with JWT token).
    """
    
    def authenticate(self, request):
        """
        Try API key authentication first, then fall back to JWT.
        """
        # First try API key authentication
        api_key_auth = ServerAPIKeyAuthentication()
        try:
            result = api_key_auth.authenticate(request)
            if result is not None:
                return result
        except AuthenticationFailed:
            # If API key authentication fails, let JWT handle it
            pass
        
        # Fall back to JWT authentication
        from rest_framework_simplejwt.authentication import JWTAuthentication
        jwt_auth = JWTAuthentication()
        return jwt_auth.authenticate(request)

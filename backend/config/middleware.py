"""
Custom middleware for HTTP request logging when DEBUG mode is enabled.
"""
import logging
import time
from django.conf import settings

logger = logging.getLogger(__name__)


class DebugRequestLoggingMiddleware:
    """
    Middleware that logs HTTP request details when DEBUG mode is enabled.
    
    This middleware logs:
    - Request method (GET, POST, PUT, DELETE, etc.)
    - Request path
    - User agent
    - Remote IP address
    - User information (if authenticated)
    - Request body for non-GET requests (limited size)
    - Response status code
    - Request duration
    
    Only activates when settings.DEBUG = True
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
        self.enabled = getattr(settings, 'DEBUG', False)
        
    def __call__(self, request):
        # Skip logging if DEBUG is not enabled
        if not self.enabled:
            return self.get_response(request)
        
        # Start timer
        start_time = time.time()
        
        # Log request details
        self.log_request(request)
        
        # Process the request
        response = self.get_response(request)
        
        # Calculate duration
        duration = time.time() - start_time
        
        # Log response details
        self.log_response(request, response, duration)
        
        return response
    
    def log_request(self, request):
        """Log incoming request details."""
        try:
            # Get basic request info
            method = request.method
            path = request.path
            user_agent = request.META.get('HTTP_USER_AGENT', 'Unknown')
            remote_addr = request.META.get('REMOTE_ADDR', 'Unknown')
            
            # Get user info
            user_info = 'Anonymous'
            if hasattr(request, 'user') and request.user.is_authenticated:
                user_info = f"{request.user.username} (ID: {request.user.id})"
            
            # Get query parameters
            query_params = dict(request.GET)
            
            # Get request body for non-GET requests (limited to avoid logging sensitive data)
            body_info = ''
            if method != 'GET' and request.body:
                # Limit body logging to first 1000 chars to avoid logging large files
                body_content = request.body.decode('utf-8', errors='ignore')
                if len(body_content) > 1000:
                    body_info = f"{body_content[:1000]}... [truncated, total: {len(body_content)} chars]"
                else:
                    body_info = body_content
            
            # Log the request
            logger.debug(
                f"HTTP REQUEST: {method} {path}\n"
                f"  User: {user_info}\n"
                f"  IP: {remote_addr}\n"
                f"  User-Agent: {user_agent}\n"
                f"  Query Params: {query_params}\n"
                f"  Body: {body_info}"
            )
            
        except Exception as e:
            # Don't let logging errors break the request
            logger.warning(f"Error logging request: {str(e)}")
    
    def log_response(self, request, response, duration):
        """Log response details."""
        try:
            method = request.method
            path = request.path
            status_code = response.status_code
            
            # Get response content type and size
            content_type = response.get('Content-Type', 'Unknown')
            content_length = response.get('Content-Length', 'Unknown')
            
            # Format duration in milliseconds
            duration_ms = duration * 1000
            
            logger.debug(
                f"HTTP RESPONSE: {method} {path} -> {status_code}\n"
                f"  Duration: {duration_ms:.2f}ms\n"
                f"  Content-Type: {content_type}\n"
                f"  Content-Length: {content_length}"
            )
            
        except Exception as e:
            # Don't let logging errors break the request
            logger.warning(f"Error logging response: {str(e)}")
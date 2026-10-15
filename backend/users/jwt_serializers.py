"""
Custom JWT serializers to include role information in tokens
"""
import logging
import token
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework.exceptions import AuthenticationFailed

from .utils import get_user_role, get_user_role_display, get_user_permissions

# Set up logger
logger = logging.getLogger(__name__)


def _get_avatar_url(employee):
    """Return a Cloudfly presigned URL for an employee's avatar, or None."""
    if not employee or not employee.avatar:
        return None
    try:
        from hrm.utils import get_cloudfly_presigned_url
        return get_cloudfly_presigned_url(str(employee.avatar))
    except Exception:
        return None


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom token serializer that includes user role information
    """
    
    @classmethod
    def get_token(cls, user):
        """
        Get token with custom claims including role information
        """
        token = super().get_token(user)
        
        # Add custom claims
        token['role'] = get_user_role(user)
        token['role_display'] = get_user_role_display(user)
        token['permissions'] = get_user_permissions(user)
        token['username'] = user.username
        token['email'] = user.email
        token['first_name'] = user.first_name
        token['last_name'] = user.last_name
        # Add full name and phone number for convenience
        token['full_name'] = user.get_full_name()
        # Prefer phone stored on profile models, fall back to username
        phone_number = user.username
        if hasattr(user, 'employee') and getattr(user.employee, 'phone_number', None):
            phone_number = user.employee.phone_number
        token['phone_number'] = phone_number
        
        return token
    
    def validate(self, attrs):
        """
        Validate and return token with custom response data
        Log detailed request information when authentication fails (401 error)
        """
        # Log authentication attempt with request details
        request = self.context.get('request')
        if request:
            # Extract request details for debugging
            username = attrs.get('username', '')
            client_ip = self._get_client_ip(request)
            user_agent = request.META.get('HTTP_USER_AGENT', '')
            request_method = request.method
            request_path = request.path
            
            logger.info(f"Token authentication attempt - username: {username}, IP: {client_ip}, "
                       f"path: {request_path}, method: {request_method}, user-agent: {user_agent}")
        else:
            logger.warning("Token authentication attempt without request context")
        
        try:
            data = super().validate(attrs)
            
            # Log successful authentication
            if request and hasattr(self, 'user'):
                logger.info(f"Token authentication SUCCESS - user_id: {self.user.id}, username: {self.user.username}")
            
        except AuthenticationFailed as e:
            # Log detailed information for 401 authentication failures
            if request:
                username = attrs.get('username', '')
                client_ip = self._get_client_ip(request)
                user_agent = request.META.get('HTTP_USER_AGENT', '')
                request_method = request.method
                request_path = request.path
                request_headers = {k: v for k, v in request.META.items() 
                                 if k.startswith('HTTP_') or k in ('CONTENT_TYPE', 'CONTENT_LENGTH')}
                
                logger.error(f"Token authentication FAILED (401) - username: {username}, IP: {client_ip}, "
                           f"path: {request_path}, method: {request_method}, user-agent: {user_agent}, "
                           f"error: {str(e)}")
                logger.debug(f"Request headers for failed authentication: {request_headers}")
            else:
                logger.error(f"Token authentication FAILED (401) - username: {attrs.get('username', '')}, "
                           f"error: {str(e)}")
            
            # Re-raise the authentication failed exception
            raise
        
        # Add custom response data
        user = self.user
        user_data = {
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name(),
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            # Provide main phone number for frontend convenience
            'phone_number': (user.employee.phone_number if hasattr(user, 'employee') and getattr(user.employee, 'phone_number', None) else user.username),
            'role': get_user_role(user),
            'role_display': get_user_role_display(user),
            'permissions': get_user_permissions(user),
            'is_staff': user.is_staff,
            'is_superuser': user.is_superuser,
            'is_active': user.is_active,
        }
        
        # Add employee information for staff users
        if hasattr(user, 'employee'):
            employee = user.employee
            user_data['employee_profile'] = {
                'id': employee.id,
                'employee_id': employee.employee_id,
                'full_name': employee.full_name,
                'gender': employee.gender,
                'gender_display': employee.get_gender_display(),
                'date_of_birth': employee.date_of_birth.isoformat() if employee.date_of_birth else None,
                'phone_number': employee.phone_number,
                'personal_email': employee.personal_email,
                'employment_status': employee.employment_status,
                'employment_status_display': employee.get_employment_status_display(),
                'start_date': employee.start_date.isoformat() if employee.start_date else None,
                'end_date': employee.end_date.isoformat() if employee.end_date else None,
                'position': employee.position.title if employee.position else None,
                'position_code': employee.position.code if employee.position else None,
                'department': employee.department.name if employee.department else None,
                'department_code': employee.department.code if employee.department else None,
                'manager_id': employee.manager.employee_id if employee.manager else None,
                'manager_name': employee.manager.full_name if employee.manager else None,
                'is_manager': employee.position.is_management if employee.position else False,
                'is_hr': employee.is_hr,
            }
        
        data['user'] = user_data
        
        return data
    
    def _get_client_ip(self, request):
        """
        Get client IP address from request
        """
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class CustomTokenObtainPairView(TokenObtainPairView):
    """
    Custom token obtain view that uses our custom serializer
    """
    serializer_class = CustomTokenObtainPairSerializer


class HRMTokenObtainPairSerializer(CustomTokenObtainPairSerializer):
    """
    HRM token serializer that includes HRM-specific role information
    """
    
    @classmethod
    def get_token(cls, user):
        """
        Get token with custom claims including HRM role information
        """
        token = super().get_token(user)
        
        # Add HRM-specific claims if user has employee profile
        if hasattr(user, 'employee'):
            employee = user.employee
            token['hrm_role'] = 'employee'
            token['employee_id'] = employee.employee_id
            token['position'] = employee.position.title if employee.position else None
            token['department'] = employee.department.name if employee.department else None
            token['is_manager'] = employee.position.is_management if employee.position else False
            token['is_hr'] = employee.is_hr
            # Check if user is super admin (e.g., based on role or position)
            token['is_super_admin'] = user.is_superuser or (employee.position and employee.position.code == 'ADMIN')
        else:
            token['hrm_role'] = None
            token['employee_id'] = None
            token['position'] = None
            token['department'] = None
            token['is_manager'] = False
            token['is_super_admin'] = user.is_superuser
        
        return token
    
    def validate(self, attrs):
        """
        Validate and return token with HRM-specific response data
        """
        data = super().validate(attrs)
        
        # Add HRM-specific user data
        user = self.user
        if hasattr(user, 'employee'):
            employee = user.employee
            data['hrm_user'] = {
                'employee_id': employee.employee_id,
                'full_name': employee.full_name,
                'position': employee.position.title if employee.position else None,
                'position_code': employee.position.code if employee.position else None,
                'department': employee.department.name if employee.department else None,
                'department_code': employee.department.code if employee.department else None,
                'manager_id': employee.manager.employee_id if employee.manager else None,
                'manager_name': employee.manager.full_name if employee.manager else None,
                'employment_status': employee.employment_status,
                'start_date': employee.start_date.isoformat() if employee.start_date else None,
                'phone_number': employee.phone_number,
                'email': employee.personal_email or user.email,
                'is_manager': employee.position.is_management if employee.position else False,
                'is_hr': employee.is_hr,
                'is_super_admin': user.is_superuser or (employee.position and employee.position.code == 'ADMIN'),
                'avatar_url': _get_avatar_url(employee),
            }
        else:
            data['hrm_user'] = None
        
        return data


class HRMTokenObtainPairView(TokenObtainPairView):
    """
    HRM token obtain view that uses HRM-specific serializer
    """
    serializer_class = HRMTokenObtainPairSerializer

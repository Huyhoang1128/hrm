import logging
from hrm import branding
import os
from collections import defaultdict
import re
from users.utils import get_user_display_name

logger = logging.getLogger(__name__)

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.permissions import IsAuthenticated, BasePermission, SAFE_METHODS
from .permissions import IsSuperUser, IsAdminOrHR
from .pagination import StandardResultsSetPagination, DepartmentResultsSetPagination, OnboardingResultsSetPagination
from rest_framework.views import APIView
import django_filters
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from .filters import PositionFilter
from django.db import models
from django.utils import timezone
from datetime import datetime, timedelta
from django.utils.dateparse import parse_date
from django.shortcuts import get_object_or_404
from employee.models import Employee, Department, Position, CompanyUnit
from .models import normalize_asset_type
from .models import Asset, AssetAssignmentHistory, AssetMaintenance, AssetInventoryCheck, AttendanceAppDownloadConfig, ContractTemplate, EmployeeContract, OnboardingDocumentTemplate, GenericRequest, RequestTemplate
from .serializers import (
    ContractTemplateSerializer, EmployeeContractSerializer, EmployeeSerializer, EmployeeCreateSerializer, EmployeeListSerializer, EmployeeBirthdaySerializer,
    DepartmentSerializer, OnboardingDocumentTemplateListSerializer, OnboardingDocumentTemplateListSerializer, OnboardingDocumentTemplateSerializer, PositionSerializer,
    AssetSerializer, AssetListSerializer, AssetAssignmentHistorySerializer, AssetMaintenanceSerializer,
    OnboardingProcessListSerializer, OnboardingProcessDetailSerializer, OnboardingProcessCreateSerializer,
    OnboardingProcessUpdateSerializer, OnboardingTaskSerializer, OnboardingTaskUpdateSerializer,
    OnboardingChecklistSerializer, OnboardingDocumentSerializer, OnboardingDocumentUploadSerializer, EmployeeOnboardingFormSerializer,
    GenericRequestSerializer, RequestTemplateSerializer,
)
from .models import (
    OnboardingProcess, OnboardingTask,
    OnboardingChecklist, OnboardingDocument
)
from django.db.models import Q
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

class HRMPermission(BasePermission):
    """
    Custom permission class for HRM API endpoints.
    Restricts access based on user roles:
    - Admin (is_staff or is_superuser): Full access
    - HR Manager (role='HR_MANAGER'): Full access to HRM
    - HR Staff (role='HR_STAFF'): Limited access (view only, no create/update/delete)
    - Staff (role='staff' from users.utils): No access to HRM management APIs
    - Other roles: No access
    """
    
    def has_permission(self, request, view):
        # Always allow authenticated users for now, but check in has_object_permission
        # or in view methods for specific restrictions
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Import get_user_role from users.utils
        try:
            from users.utils import get_user_role
            user_role = get_user_role(request.user)
        except ImportError:
            # Fallback if users.utils is not available
            if request.user.is_staff or request.user.is_superuser:
                user_role = 'admin'
            elif hasattr(request.user, 'employee'):
                user_role = 'staff'
            else:
                user_role = 'customer'
        
        # Admin users have full access
        if user_role == 'admin':
            return True
        
        # HR Manager and HR Staff have access to HRM
        # Check if user has employee record with HR role
        if hasattr(request.user, 'employee'):
            employee = request.user.employee
            # Check if employee has HR role (you might need to adjust this based on your model)
            # For now, we'll check if position contains "HR" or department is HR
            if employee.position and 'HR' in employee.position.title.upper():
                return True
            if employee.department and 'HR' in employee.department.name.upper():
                return True
        
        # Staff users (non-HR) should not have access to HRM management APIs
        # But they should have access to their own profile and attendance
        if user_role == 'staff':
            # Allow access to 'me' endpoint and own attendance
            if view.action in ['me', 'list', 'retrieve']:
                # For list/retrieve, we'll check object-level permissions
                return True
            # Deny create, update, delete for staff
            if request.method in ['POST', 'PUT', 'PATCH', 'DELETE']:
                return False
        
        # For other views, we'll handle permissions in the view methods
        return True
    
    def has_object_permission(self, request, view, obj):
        # Import get_user_role from users.utils
        try:
            from users.utils import get_user_role
            user_role = get_user_role(request.user)
        except ImportError:
            if request.user.is_staff or request.user.is_superuser:
                user_role = 'admin'
            elif hasattr(request.user, 'employee'):
                user_role = 'staff'
            else:
                user_role = 'customer'
        
        # Admin users have full access
        if user_role == 'admin':
            return True
        
        # HR Manager and HR Staff have full access
        if hasattr(request.user, 'employee'):
            employee = request.user.employee
            if employee.position and 'HR' in employee.position.title.upper():
                return True
            if employee.department and 'HR' in employee.department.name.upper():
                return True
        
        # Staff users can only access their own records
        if user_role == 'staff':
            # Check if obj is the user's own employee record
            if isinstance(obj, Employee) and hasattr(request.user, 'employee'):
                return obj.id == request.user.employee.id
            
            # Check if obj belongs to the user (e.g., attendance record for the employee)
            if hasattr(obj, 'employee') and hasattr(request.user, 'employee'):
                return obj.employee.id == request.user.employee.id
            
            # Check if obj is assigned to the user (e.g., asset assigned to employee)
            if hasattr(obj, 'assigned_to') and hasattr(request.user, 'employee'):
                return obj.assigned_to.id == request.user.employee.id
        
        return False


class StaffReadOnlyPermission(BasePermission):
    """
    Permission class that allows staff users read-only access.
    Staff can view but cannot create, update, or delete.
    """
    
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Import get_user_role from users.utils
        try:
            from users.utils import get_user_role
            user_role = get_user_role(request.user)
        except ImportError:
            if request.user.is_staff or request.user.is_superuser:
                user_role = 'admin'
            elif hasattr(request.user, 'employee'):
                user_role = 'staff'
            else:
                user_role = 'customer'
        
        # Admin users have full access
        if user_role == 'admin':
            return True
        
        if user_role == 'hr':
            return True
        
        # HR Manager and HR Staff have full access
        if hasattr(request.user, 'employee'):
            employee = request.user.employee
            if employee.position and 'HR' in employee.position.title.upper():
                return True
            if employee.department and 'HR' in employee.department.name.upper():
                return True
        
        # Staff users have read-only access
        if user_role == 'staff':
            return request.method in ['GET', 'HEAD', 'OPTIONS']
        
        return False


class StaffOwnDataPermission(BasePermission):
    """
    Permission class that allows staff users to access only their own data.
    For attendance explanations, also allows direct managers and department managers to approve.
    """
    
    def has_permission(self, request, view):
        
        logger.info(f"StaffOwnDataPermission.has_permission called for view: {view.__class__.__name__}, action: {view.action if hasattr(view, 'action') else 'N/A'}, method: {request.method}")
        
        if not request.user or not request.user.is_authenticated:
            logger.warning(f"StaffOwnDataPermission.has_permission: User not authenticated or no user")
            return False
        
        logger.info(f"StaffOwnDataPermission.has_permission: User ID={request.user.id}, username={request.user.username}, is_staff={request.user.is_staff}, is_superuser={request.user.is_superuser}")
        
        # Import get_user_role from users.utils
        try:
            from users.utils import get_user_role
            user_role = get_user_role(request.user)
            logger.info(f"StaffOwnDataPermission.has_permission: user_role from get_user_role={user_role}")
        except ImportError:
            if request.user.is_staff or request.user.is_superuser:
                user_role = 'admin'
            elif hasattr(request.user, 'employee'):
                user_role = 'staff'
            else:
                user_role = 'customer'
            logger.info(f"StaffOwnDataPermission.has_permission: user_role from fallback={user_role}")
        
        # Admin, HR Manager, and HR Staff have full access
        if user_role == 'admin':
            logger.info(f"StaffOwnDataPermission.has_permission: User is admin, granting permission")
            return True
        
        if hasattr(request.user, 'employee'):
            employee = request.user.employee
            logger.info(f"StaffOwnDataPermission.has_permission: User has employee record, ID={employee.id}, name={employee.full_name}")
            
            # Check if employee is HR using multiple methods
            is_hr = employee.is_hr  # Check the is_hr field on Employee model
            
            # Check position for HR keywords (both English and Vietnamese)
            is_hr_position = False
            if employee.position and employee.position.title:
                position_upper = employee.position.title.upper()
                is_hr_position = ('HR' in position_upper or 
                                 'NHÂN SỰ' in position_upper or 
                                 'HÀNH CHÍNH NHÂN SỰ' in position_upper)
            
            # Check department for HR keywords (both English and Vietnamese)
            is_hr_department = False
            if employee.department and employee.department.name:
                department_upper = employee.department.name.upper()
                is_hr_department = ('HR' in department_upper or 
                                   'NHÂN SỰ' in department_upper or 
                                   'HÀNH CHÍNH NHÂN SỰ' in department_upper)
            
            # Check if employee has can_approve_attendance permission
            has_approve_permission = False
            try:
                from .models import EmployeePermission
                permission = EmployeePermission.objects.get(employee=employee)
                has_approve_permission = permission.can_approve_attendance
                logger.info(f"StaffOwnDataPermission.has_permission: Found EmployeePermission, can_approve_attendance={has_approve_permission}")
            except EmployeePermission.DoesNotExist:
                has_approve_permission = False
                logger.info(f"StaffOwnDataPermission.has_permission: No EmployeePermission found for employee {employee.id}")
            
            logger.info(f"StaffOwnDataPermission.has_permission: is_hr={is_hr}, is_hr_position={is_hr_position}, is_hr_department={is_hr_department}, has_approve_permission={has_approve_permission}")
            logger.info(f"StaffOwnDataPermission.has_permission: position_title={employee.position.title if employee.position else None}")
            logger.info(f"StaffOwnDataPermission.has_permission: department_name={employee.department.name if employee.department else None}")
            
            if is_hr or is_hr_position or is_hr_department or has_approve_permission:
                logger.info(f"StaffOwnDataPermission.has_permission: User is HR or has approval permission, granting permission")
                return True
        
        # Staff users can access the view (object-level permissions will restrict further)
        if user_role == 'staff':
            logger.info(f"StaffOwnDataPermission.has_permission: User is staff, allowing access (object-level permissions will apply)")
            return True
        
        logger.warning(f"StaffOwnDataPermission.has_permission: User does not have permission. user_role={user_role}, has_employee={hasattr(request.user, 'employee')}")
        return False
    
    def has_object_permission(self, request, view, obj):
        
        logger.info(f"StaffOwnDataPermission.has_object_permission called for view: {view.__class__.__name__}, action: {view.action if hasattr(view, 'action') else 'N/A'}, obj type: {type(obj).__name__}, obj ID: {obj.id if hasattr(obj, 'id') else 'N/A'}")
        
        # ===== BYPASS OBJECT-LEVEL PERMISSION FOR CUSTOM ACTIONS =====
        # These actions have their own permission logic inside the action method
        if hasattr(view, 'action') and view.action in ['reset_password', 'activate', 'deactivate']:
            logger.info(f"StaffOwnDataPermission.has_object_permission: Action '{view.action}' bypasses object-level permission (has own permission check)")
            return True
        
        # Import get_user_role from users.utils
        try:
            from users.utils import get_user_role
            user_role = get_user_role(request.user)
            logger.info(f"StaffOwnDataPermission.has_object_permission: user_role from get_user_role={user_role}")
        except ImportError:
            if request.user.is_staff or request.user.is_superuser:
                user_role = 'admin'
            elif hasattr(request.user, 'employee'):
                user_role = 'staff'
            else:
                user_role = 'customer'
            logger.info(f"StaffOwnDataPermission.has_object_permission: user_role from fallback={user_role}")
        
        # Admin, HR Manager, and HR Staff have full access
        if user_role == 'admin':
            logger.info(f"StaffOwnDataPermission.has_object_permission: User is admin, granting permission")
            return True
        
        if hasattr(request.user, 'employee'):
            employee = request.user.employee
            logger.info(f"StaffOwnDataPermission.has_object_permission: User has employee record, ID={employee.id}, name={employee.full_name}")
            
            # Check if employee is HR using multiple methods
            is_hr = employee.is_hr  # Check the is_hr field on Employee model
            
            # Check position for HR keywords (both English and Vietnamese)
            is_hr_position = False
            if employee.position and employee.position.title:
                position_upper = employee.position.title.upper()
                is_hr_position = ('HR' in position_upper or 
                                 'NHÂN SỰ' in position_upper or 
                                 'HÀNH CHÍNH NHÂN SỰ' in position_upper)
            
            # Check department for HR keywords (both English and Vietnamese)
            is_hr_department = False
            if employee.department and employee.department.name:
                department_upper = employee.department.name.upper()
                is_hr_department = ('HR' in department_upper or 
                                   'NHÂN SỰ' in department_upper or 
                                   'HÀNH CHÍNH NHÂN SỰ' in department_upper)
            
            # Check if employee has can_approve_attendance permission
            has_approve_permission = False
            try:
                from .models import EmployeePermission
                permission = EmployeePermission.objects.get(employee=employee)
                has_approve_permission = permission.can_approve_attendance
                logger.info(f"StaffOwnDataPermission.has_object_permission: Found EmployeePermission, can_approve_attendance={has_approve_permission}")
            except EmployeePermission.DoesNotExist:
                has_approve_permission = False
                logger.info(f"StaffOwnDataPermission.has_object_permission: No EmployeePermission found for employee {employee.id}")
            
            logger.info(f"StaffOwnDataPermission.has_object_permission: is_hr={is_hr}, is_hr_position={is_hr_position}, is_hr_department={is_hr_department}, has_approve_permission={has_approve_permission}")
            logger.info(f"StaffOwnDataPermission.has_object_permission: position_title={employee.position.title if employee.position else None}")
            logger.info(f"StaffOwnDataPermission.has_object_permission: department_name={employee.department.name if employee.department else None}")
            
            if is_hr or is_hr_position or is_hr_department or has_approve_permission:
                logger.info(f"StaffOwnDataPermission.has_object_permission: User is HR or has approval permission, granting permission")
                return True
        
        # Staff users can only access their own data
        if user_role == 'staff' and hasattr(request.user, 'employee'):
            user_employee = request.user.employee
            
            # Check if obj is the user's own employee record
            if isinstance(obj, Employee):
                is_own_record = obj.id == user_employee.id
                logger.info(f"StaffOwnDataPermission.has_object_permission: obj is Employee, is_own_record={is_own_record}")
                if is_own_record:
                    return True
                # Trưởng phòng (position.is_management=True) được XEM (không sửa/xoá)
                # hồ sơ nhân viên đang có mình là "quản lý trực tiếp" — phục vụ
                # trang Quản lý nhân viên, xem thêm get_queryset() của
                # EmployeeViewSet (đổi từ Department.manager sang Employee.manager
                # — xem comment ở đó để biết lý do).
                if (request.method in SAFE_METHODS
                        and user_employee.position and user_employee.position.is_management
                        and obj.manager_id == user_employee.id):
                    logger.info("StaffOwnDataPermission.has_object_permission: manager viewing direct report, granting")
                    return True
                return False
            
            # Check if obj belongs to the user (e.g., attendance, asset assignment)
            if hasattr(obj, 'employee'):
                # Check if user is the employee who created the object
                is_own_object = obj.employee.id == user_employee.id
                logger.info(f"StaffOwnDataPermission.has_object_permission: obj has employee field, obj.employee.id={obj.employee.id}, user_employee.id={user_employee.id}, is_own_object={is_own_object}")
                
                if is_own_object:
                    logger.info(f"StaffOwnDataPermission.has_object_permission: User owns the object, granting permission")
                    return True
                
                # For attendance explanations, also check if user is direct manager or department manager
                # Check if obj is an AttendanceExplanation by checking its model name or type
                if obj.__class__.__name__ == 'AttendanceExplanation':
                    logger.info(f"StaffOwnDataPermission.has_object_permission: obj is AttendanceExplanation, checking manager permissions")
                    
                    # Check if user is direct manager of the employee
                    is_direct_manager = obj.employee.manager and obj.employee.manager.id == user_employee.id
                    logger.info(f"StaffOwnDataPermission.has_object_permission: is_direct_manager={is_direct_manager}, obj.employee.manager.id={obj.employee.manager.id if obj.employee.manager else None}")
                    
                    # Check if user is department manager of the employee's department
                    is_department_manager = obj.employee.department and obj.employee.department.manager and obj.employee.department.manager.id == user_employee.id
                    logger.info(f"StaffOwnDataPermission.has_object_permission: is_department_manager={is_department_manager}, obj.employee.department.manager.id={obj.employee.department.manager.id if obj.employee.department and obj.employee.department.manager else None}")
                    
                    if is_direct_manager or is_department_manager:
                        logger.info(f"StaffOwnDataPermission.has_object_permission: User is manager of the employee, granting permission")
                        return True
                
                logger.info(f"StaffOwnDataPermission.has_object_permission: User does not own the object and is not a manager, denying permission")
                # For other objects with employee field, only the employee can access
                return False
            
            # Check if obj is assigned to the user
            if hasattr(obj, 'assigned_to'):
                is_assigned_to_user = obj.assigned_to.id == user_employee.id
                logger.info(f"StaffOwnDataPermission.has_object_permission: obj has assigned_to field, is_assigned_to_user={is_assigned_to_user}")
                return is_assigned_to_user
        
        logger.warning(f"StaffOwnDataPermission.has_object_permission: User does not have object permission. user_role={user_role}, has_employee={hasattr(request.user, 'employee')}")
        return False


_SUSPENDED_EMPLOYMENT_STATUSES = ['SUSPENDED', 'PAUSED']


def _working_employee_q(today):
    """Đang làm việc: không tạm dừng, chưa tới ngày nghỉ việc — GỒM cả người
    đang thử việc. Dùng chung cho filter danh sách, stats() và dashboard."""
    return ~Q(employment_status__in=_SUSPENDED_EMPLOYMENT_STATUSES) & (
        Q(end_date__isnull=True) | Q(end_date__gt=today)
    )


def _probation_q(today):
    """Còn thử việc: hợp đồng thử việc HOẶC còn hạn probation_end_date
    ("Thử việc" không còn là giá trị của employment_status)."""
    return Q(contract_type='PROBATION') | Q(probation_end_date__gte=today)


class EmployeeViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing employees
    """
    queryset = Employee.objects.all().order_by('employee_id')
    serializer_class = EmployeeSerializer
    permission_classes = [IsAuthenticated, StaffOwnDataPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        # 'employment_status' bị override bởi custom logic trong get_queryset
        # vì đây là computed value (ACTIVE/SUSPENDED/INACTIVE dựa vào end_date + override)
        'department', 'position', 'gender', 'is_active',
        'contract_type'
    ]
    
    search_fields = [
        'employee_id', 'full_name', 'phone_number', 'personal_email',
        'bank_account',
        'social_insurance_number', 'tax_code', 'household_code'
    ]
    
    ordering_fields = [
        'employee_id', 'full_name', 'start_date', 'created_at'
    ]
    
    ordering = ['employee_id']

    def _request_user_can_manage_accounts(self, request):
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr = False
        try:
            current_employee = Employee.objects.select_related('department', 'position').get(user=request.user)
            if current_employee.is_hr:
                is_hr = True
            else:
                department_name = (current_employee.department.name or '').upper() if current_employee.department else ''
                department_code = (current_employee.department.code or '').upper() if current_employee.department else ''
                position_title = (current_employee.position.title or '').upper() if current_employee.position else ''
                is_hr = (
                    'HR' in department_name
                    or 'HCNS' in department_code
                    or 'NHÂN SỰ' in department_name
                    or 'HR' in position_title
                    or 'NHÂN SỰ' in position_title
                )
        except Employee.DoesNotExist:
            pass
        return is_admin or is_hr

    def get_queryset(self):
        queryset = super().get_queryset()
        # Mặc định chỉ lấy nhân viên is_active=True, trừ khi có tham số include_inactive=true
        if self.action == 'list':
            include_inactive = self.request.query_params.get('include_inactive', 'false').lower()
            if include_inactive != 'true':
                queryset = queryset.filter(is_active=True)

            # Trưởng phòng (position.is_management=True), nếu không phải admin/HR,
            # chỉ được xem nhân viên đang có mình là "quản lý trực tiếp"
            # (Employee.manager) ở trang Quản lý nhân viên — enforce ở đây,
            # không phụ thuộc vào FE.
            #
            # LƯU Ý: trước đây lọc theo Department.manager ("Trưởng phòng ban"),
            # nhưng dữ liệu thực tế cho thấy Department.manager hầu như không
            # được gán (chẩn đoán qua diagnose_manager_scope) — cấu trúc báo cáo
            # thật của công ty nằm ở Employee.manager ("quản lý trực tiếp"), nên
            # đổi sang dùng field này. Chỉ tính cấp dưới TRỰC TIẾP (không đệ quy
            # xuống cấp dưới của cấp dưới).
            #
            # Lưu ý: CHỦ Ý không dùng _request_user_can_manage_accounts() ở đây —
            # hàm đó coi bất kỳ ai có department/position CHỨA từ khoá "HR"/"HCNS"/
            # "NHÂN SỰ" là HR (kể cả 1 Trưởng phòng thuộc phòng HCNS), nên sẽ vô
            # tình bỏ qua giới hạn cho đúng nhóm is_manager cần giới hạn. Ở đây chỉ
            # miễn giới hạn cho admin thật hoặc is_hr=True (field tường minh).
            is_admin_or_hr = self.request.user.is_staff or self.request.user.is_superuser
            request_employee = Employee.objects.filter(
                user=self.request.user
            ).select_related('position').first()
            if request_employee and request_employee.is_hr:
                is_admin_or_hr = True

            if not is_admin_or_hr and request_employee and request_employee.position and request_employee.position.is_management:
                queryset = queryset.filter(manager_id=request_employee.id)

        # Filter theo employment_status computed:
        #   - SUSPENDED: stored_status in (SUSPENDED, PAUSED) (manual override)
        #   - INACTIVE : không thuộc nhóm SUSPENDED, end_date <= today
        #   - ACTIVE   : đang làm việc (_working_employee_q) — GỒM cả người đang thử
        #                việc, khớp ô "Đang làm việc" ở stats() và nhãn trạng thái
        #                trong danh sách (case 2026-10-09: lọc ra 240 trong khi ô
        #                thống kê 319, thiếu đúng 78 người đang thử việc).
        #   - PROBATION: đang làm việc VÀ còn thử việc (_probation_q) — là tập con
        #                của ACTIVE; không tính người thử việc đã nghỉ.
        status_param = self.request.query_params.get('employment_status')
        if status_param:
            from datetime import date
            today = date.today()
            suspended_statuses = _SUSPENDED_EMPLOYMENT_STATUSES
            if status_param in suspended_statuses:
                queryset = queryset.filter(employment_status__in=suspended_statuses)
            elif status_param == 'INACTIVE':
                queryset = queryset.exclude(employment_status__in=suspended_statuses).filter(
                    end_date__isnull=False, end_date__lte=today
                )
            elif status_param == 'PROBATION':
                queryset = queryset.filter(_working_employee_q(today)).filter(_probation_q(today))
            elif status_param == 'ACTIVE':
                queryset = queryset.filter(_working_employee_q(today))

            # Chỉ áp dụng khoảng ngày nghỉ khi đang xem nhân viên đã nghỉ.
            # Hai mốc đều được tính inclusive để người dùng dễ đối chiếu báo cáo.
            if status_param == 'INACTIVE':
                end_date_from = parse_date(self.request.query_params.get('end_date_from', ''))
                end_date_to = parse_date(self.request.query_params.get('end_date_to', ''))
                if end_date_from:
                    queryset = queryset.filter(end_date__gte=end_date_from)
                if end_date_to:
                    queryset = queryset.filter(end_date__lte=end_date_to)
        return queryset
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'create':
            return EmployeeCreateSerializer
        elif self.action == 'list':
            return EmployeeListSerializer
        return EmployeeSerializer
    
    def create(self, request, *args, **kwargs):
        """
        Create a new employee
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        
        # Return full employee details
        employee = serializer.instance
        full_serializer = EmployeeSerializer(employee, context=self.get_serializer_context())
        return Response(full_serializer.data, status=status.HTTP_201_CREATED, headers=headers)
    
    @action(detail=False, methods=['get'])
    def me(self, request):
        """
        Get the current authenticated user's employee profile
        """
        try:
            # Get the employee associated with the current user
            employee = Employee.objects.get(user=request.user)
            serializer = EmployeeSerializer(employee, context=self.get_serializer_context())
            return Response(serializer.data)
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Employee profile not found for this user'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=True, methods=['get'], url_path='approval-summary', permission_classes=[IsAuthenticated])
    def approval_summary(self, request, pk=None):
        """
        Get a reduced employee payload for approval screens.

        This endpoint is meant for direct managers / department managers who need to
        view employee information for monthly approval tables without having full
        access to the standard employee detail endpoint.
        """
        try:
            employee = Employee.objects.select_related('department', 'position', 'manager').get(pk=pk)
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Employee not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        requester = getattr(request.user, 'employee', None)
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr = bool(requester and (requester.is_hr or (requester.position and requester.position.title and ('HR' in requester.position.title.upper() or 'NHÂN SỰ' in requester.position.title.upper()))))
        is_department_manager = bool(requester and employee.department and employee.department.manager_id == requester.id)
        is_direct_manager = bool(requester and employee.manager_id == requester.id)
        is_self = bool(requester and requester.id == employee.id)

        if not (is_admin or is_hr or is_department_manager or is_direct_manager or is_self):
            return Response(
                {'error': 'Bạn không có quyền xem thông tin nhân sự này'},
                status=status.HTTP_403_FORBIDDEN
            )

        department_name = employee.department.name if employee.department else None
        position_title = employee.position.title if employee.position else None
        manager_name = employee.manager.full_name if employee.manager else None

        return Response({
            'id': employee.id,
            'employee_id': employee.employee_id,
            'full_name': employee.full_name,
            'employee_code': employee.employee_id,
            'department_id': employee.department_id,
            'department_name': department_name,
            'department_code': employee.department.code if employee.department else None,
            'position_id': employee.position_id,
            'position': position_title,
            'manager_id': employee.manager_id,
            'manager_name': manager_name,
            'is_active': employee.is_active,
            'employment_status': employee.employment_status,
            'employee_status': employee.employment_status,
            'start_date': employee.start_date,
            'end_date': employee.end_date,
            'probation_months': employee.probation_months,
            'probation_end_date': employee.probation_end_date,
            'probation_rate': employee.probation_rate,
            'probation_rate_display': employee.get_probation_rate_display() if hasattr(employee, 'get_probation_rate_display') else None,
            'allowance': employee.allowance,
            'basic_salary': employee.basic_salary,
            'rank': employee.rank,
            'section': employee.section,
            'block': employee.block,
            'region': employee.region,
            'work_location': employee.work_location,
            'work_location_display': employee.get_work_location_display() if hasattr(employee, 'get_work_location_display') else None,
            'work_form': employee.work_form,
            'work_form_display': employee.get_work_form_display() if hasattr(employee, 'get_work_form_display') else None,
            'doctor_team': employee.doctor_team,
            'sales_percent': employee.revenue_percentage,
            'profit_percent': employee.profit_percentage,
            'insurance_participation': employee.insurance_participation,
            'social_insurance_participation_status': employee.social_insurance_participation_status,
            'social_insurance_contribution_level': employee.social_insurance_contribution_level,
            'social_insurance_start_date': employee.social_insurance_start_date,
            'social_insurance_end_date': employee.social_insurance_end_date,
            'salary_adjustments': employee.salary_adjustments,
            'extra_info': employee.extra_info,
            'is_manager': bool(
                (employee.position and employee.position.is_management)
                or Department.objects.filter(manager=employee).exists()
                or Employee.objects.filter(manager=employee).exists()
            ),
            'is_hr': employee.is_hr,
        })

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get employee statistics
        """
        today = timezone.now().date()
        suspended_statuses = ['SUSPENDED', 'PAUSED']

        active_queryset = Employee.objects.exclude(
            employment_status__in=suspended_statuses
        ).filter(
            is_active=True
        ).filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gt=today)
        )

        total = Employee.objects.count()
        active = active_queryset.count()
        inactive = Employee.objects.exclude(employment_status__in=suspended_statuses).filter(
            models.Q(is_active=False) | models.Q(end_date__isnull=False, end_date__lte=today)
        ).count()
        # "Thử việc" = người ĐANG LÀM VIỆC còn thử việc — khớp filter PROBATION
        # của get_queryset(); trước đây đếm cả người thử việc đã nghỉ việc.
        probation = active_queryset.filter(_probation_q(today)).count()

        # Count by department
        departments = Department.objects.all()
        department_stats = []
        for dept in departments:
            count = active_queryset.filter(department=dept).count()
            if count > 0:
                department_stats.append({
                    'department_id': dept.id,
                    'department_name': dept.name,
                    'count': count
                })
        
        # Count by gender
        male_count = active_queryset.filter(gender='M').count()
        female_count = active_queryset.filter(gender='F').count()
        other_count = active_queryset.filter(gender='O').count()
        
        return Response({
            'total': total,
            'active': active,
            'inactive': inactive,
            'probation': probation,
            'department_stats': department_stats,
            'gender_stats': {
                'male': male_count,
                'female': female_count,
                'other': other_count
            }
        })
    
    @action(detail=False, methods=['get'])
    def hr_employees(self, request):
        """
        Get list of HR employees
        """
        # Get HR employees based on is_hr flag or position/department containing "HR"
        hr_employees = Employee.objects.filter(
            models.Q(is_hr=True) |
            models.Q(position__title__icontains='HR') |
            models.Q(position__title__icontains='Nhân sự') |
            models.Q(department__name__icontains='HR') |
            models.Q(department__name__icontains='Nhân sự')
        ).distinct().order_by('employee_id')
        
        page = self.paginate_queryset(hr_employees)
        
        if page is not None:
            serializer = EmployeeListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = EmployeeListSerializer(hr_employees, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='export-all',
            permission_classes=[IsAuthenticated, IsAdminOrHR])
    def export_all(self, request):
        """
        Xuất toàn bộ thông tin của tất cả nhân viên trong bảng Employee.
        Chỉ Admin hoặc HCNS.
        GET /api/hrm/employees/export-all/
        """
        employees = Employee.objects.all().select_related(
            'user', 'position', 'department', 'manager',
            'manager_level_2', 'manager_level_3', 'company_unit'
        ).order_by('employee_id')

        serializer = EmployeeSerializer(employees, many=True, context=self.get_serializer_context())
        data = serializer.data
        return Response({
            'count': len(data),
            'results': data
        })

    @action(detail=False, methods=['get'])
    def birthdays_today(self, request):
        """
        Get list of employees whose birthday is today or on a specific date.
        Optional query param: date (YYYY-MM-DD). Defaults to today.
        """
        date_param = request.query_params.get('date')
        if date_param:
            try:
                target_date = datetime.strptime(date_param, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'error': 'Invalid date format. Use YYYY-MM-DD.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            target_date = timezone.now().date()

        employees = Employee.objects.filter(
            date_of_birth__month=target_date.month,
            date_of_birth__day=target_date.day,
            is_active=True,
        ).exclude(
            employment_status='INACTIVE',
        ).filter(
            Q(employment_status__in=['SUSPENDED', 'PAUSED']) |
            Q(end_date__isnull=True) |
            Q(end_date__gt=target_date),
        ).order_by('employee_id')

        page = self.paginate_queryset(employees)

        if page is not None:
            serializer = EmployeeBirthdaySerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = EmployeeBirthdaySerializer(employees, many=True)
        return Response(serializer.data)
    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        employee = self.get_object()
        employee.employment_status = 'ACTIVE'
        employee.is_active = True
        employee.save()
        return Response({'success': True, 'message': f'Đã kích hoạt nhân viên {employee.full_name}'})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        from django.db import transaction
        employee = self.get_object()
        with transaction.atomic():
            employee.employment_status = 'INACTIVE'
            employee.is_active = False
            employee.save()
            # Đồng bộ với EmployeeSerializer.update(): khi nhân viên bị vô hiệu hoá,
            # mọi hợp đồng chưa hết hiệu lực phải chuyển CANCELLED — nếu không, Bulk
            # Contracts vẫn hiển thị hợp đồng của người đã nghỉ như đang ký.
            EmployeeContract.objects.filter(
                employee=employee,
                status__in=['DRAFT', 'PENDING_SIGN', 'SIGNED'],
            ).update(status='CANCELLED')
        return Response({'success': True, 'message': f'Đã vô hiệu hóa nhân viên {employee.full_name}'})

    @action(detail=True, methods=['post'], url_path='create-account')
    def create_account(self, request, pk=None):
        """
        Tạo tài khoản đăng nhập app chấm công/HRM cho một nhân sự.
        Chỉ ADMIN hoặc HR được thao tác.
        """
        if not self._request_user_can_manage_accounts(request):
            return Response(
                {'error': 'Bạn không có quyền tạo tài khoản app chấm công'},
                status=status.HTTP_403_FORBIDDEN
            )

        employee = self.get_object()
        if employee.user_id:
            serializer = self.get_serializer(employee)
            return Response(
                {'success': False, 'error': 'Nhân sự đã có tài khoản', 'employee': serializer.data},
                status=status.HTTP_400_BAD_REQUEST
            )

        from django.contrib.auth.models import User
        import secrets
        import string

        username = (request.data.get('username') or employee.employee_id or '').strip()
        email = (request.data.get('email') or employee.personal_email or '').strip()
        if not username:
            return Response(
                {'error': 'Nhân sự chưa có mã nhân viên để tạo tên đăng nhập'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if not email:
            return Response(
                {'error': 'Nhân sự chưa có email cá nhân để gửi thông tin tài khoản'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if User.objects.filter(username=username).exists():
            return Response(
                {'error': f'Tên đăng nhập {username} đã tồn tại'},
                status=status.HTTP_400_BAD_REQUEST
            )

        chars = string.ascii_uppercase + string.ascii_lowercase + string.digits + "!@#$%^&*"
        new_password = ''.join(secrets.choice(chars) for _ in range(12))
        name_parts = (employee.full_name or '').split()
        user = User.objects.create_user(
            username=username,
            email=email,
            first_name=name_parts[-1] if name_parts else '',
            last_name=' '.join(name_parts[:-1]) if len(name_parts) > 1 else '',
            password=new_password,
        )
        employee.user = user
        employee.save(update_fields=['user'])

        from hrm.serializers import send_account_info_email
        email_sent = send_account_info_email(user=user, employee=employee, new_password=new_password)

        serializer = self.get_serializer(employee)
        return Response(
            {
                'success': True,
                'message': (
                    f'Đã tạo tài khoản {username} cho {employee.full_name}.'
                    + (' Email thông tin tài khoản đã được gửi.' if email_sent else ' Không thể gửi email tự động.')
                ),
                'email_sent': email_sent,
                'employee': serializer.data,
            },
            status=status.HTTP_201_CREATED
        )

    @action(detail=True, methods=['post'], url_path='activate-account')
    def activate_account(self, request, pk=None):
        if not self._request_user_can_manage_accounts(request):
            return Response(
                {'error': 'Bạn không có quyền kích hoạt tài khoản app chấm công'},
                status=status.HTTP_403_FORBIDDEN
            )
        employee = self.get_object()
        if not employee.user_id:
            return Response({'error': 'Nhân sự chưa có tài khoản'}, status=status.HTTP_400_BAD_REQUEST)
        employee.user.is_active = True
        employee.user.save(update_fields=['is_active'])
        serializer = self.get_serializer(employee)
        return Response({'success': True, 'message': 'Đã kích hoạt tài khoản app chấm công', 'employee': serializer.data})

    @action(detail=True, methods=['post'], url_path='deactivate-account')
    def deactivate_account(self, request, pk=None):
        if not self._request_user_can_manage_accounts(request):
            return Response(
                {'error': 'Bạn không có quyền vô hiệu hóa tài khoản app chấm công'},
                status=status.HTTP_403_FORBIDDEN
            )
        employee = self.get_object()
        if not employee.user_id:
            return Response({'error': 'Nhân sự chưa có tài khoản'}, status=status.HTTP_400_BAD_REQUEST)
        employee.user.is_active = False
        employee.user.save(update_fields=['is_active'])
        serializer = self.get_serializer(employee)
        return Response({'success': True, 'message': 'Đã vô hiệu hóa tài khoản app chấm công', 'employee': serializer.data})
    
    @action(detail=True, methods=['post'])
    def reset_password(self, request, pk=None):
        """
        Reset password cho employee
        POST /api/employees/{employee_id}/reset-password/
        
        URL Param: employee_id (pk)
        
        Permission: Chỉ ADMIN hoặc HR mới có quyền
        """
        from django.contrib.auth.models import User
        from django.utils.crypto import get_random_string
        import logging
        
        logger = logging.getLogger(__name__)
        
        # Get employee from URL parameter
        try:
            employee = self.get_object()  # pk from URL
            user = employee.user
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Không tìm thấy nhân viên'},
                status=status.HTTP_404_NOT_FOUND
            )
        except AttributeError:
            return Response(
                {'error': 'Nhân viên không có tài khoản user'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # ===== CHECK PERMISSION =====
        if not self._request_user_can_manage_accounts(request):
            logger.warning(f"Unauthorized reset password attempt by {request.user.username} for employee {employee.employee_id}")
            return Response(
                {'error': 'Bạn không có quyền reset mật khẩu'},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            # ===== GENERATE PASSWORD =====
            # Generate random password (12 chars) with uppercase, lowercase, numbers, special chars
            import secrets
            import string
            
            password_chars = string.ascii_uppercase + string.ascii_lowercase + string.digits + "!@#$%^&*"
            new_password = ''.join(secrets.choice(password_chars) for _ in range(12))
            
            logger.info(f"Generated random password for employee {employee.employee_id} (user: {user.username})")
            
            # ===== SET PASSWORD =====
            user.set_password(new_password)
            user.save()
            logger.info(f"Password updated for user {user.username}")
            
            # ===== SEND EMAIL =====
            from hrm.serializers import send_account_info_email
            
            email_sent = send_account_info_email(
                user=user,
                employee=employee,
                new_password=new_password
            )
            
            if not email_sent:
                logger.error(f"Failed to send email to {user.email}")
                return Response(
                    {'success': False, 'error': 'Không thể gửi email'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            logger.info(f"Password reset successfully by {request.user.username} for employee {employee.employee_id}")
            
            return Response(
                {
                    'success': True,
                    'message': f'Đã reset mật khẩu thành công cho {employee.full_name} ({employee.employee_id}). Email đã được gửi tới {user.email}.',
                    'employee': {
                        'id': employee.id,
                        'employee_id': employee.employee_id,
                        'full_name': employee.full_name,
                        'email': user.email,
                    }
                },
                status=status.HTTP_200_OK
            )
        
        except Exception as e:
            logger.error(f"Error resetting password for employee {employee.employee_id}: {str(e)}", exc_info=True)
            return Response(
                {'success': False, 'error': f'Lỗi: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=False, methods=['post'], url_path='change_manager')
    def change_manager(self, request):
        """
        Đổi quản lý trực tiếp hàng loạt — dùng khi 1 quản lý offboard, cần chuyển
        thủ công toàn bộ nhân viên đang report cho họ sang quản lý mới.

        POST /api-hrm/employees/change_manager/
        Body: {"old_manager_id": <id>, "new_manager_id": <id>}
        """
        import logging
        logger = logging.getLogger(__name__)

        if not self._request_user_can_manage_accounts(request):
            return Response(
                {'error': 'Bạn không có quyền đổi quản lý trực tiếp hàng loạt'},
                status=status.HTTP_403_FORBIDDEN
            )

        old_manager_id = request.data.get('old_manager_id')
        new_manager_id = request.data.get('new_manager_id')

        if not old_manager_id or not new_manager_id:
            return Response(
                {'error': 'Thiếu quản lý cũ hoặc quản lý mới'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if str(old_manager_id) == str(new_manager_id):
            return Response(
                {'error': 'Quản lý cũ và quản lý mới không được trùng nhau'},
                status=status.HTTP_400_BAD_REQUEST
            )

        old_manager = Employee.objects.filter(pk=old_manager_id).first()
        new_manager = Employee.objects.filter(pk=new_manager_id).first()
        if not old_manager:
            return Response({'error': 'Không tìm thấy quản lý cũ'}, status=status.HTTP_404_NOT_FOUND)
        if not new_manager:
            return Response({'error': 'Không tìm thấy quản lý mới'}, status=status.HTTP_404_NOT_FOUND)

        # Loại trừ new_manager khỏi tập bị đổi — nếu new_manager đang report cho
        # old_manager, update hàng loạt theo filter(manager=old_manager) sẽ vô tình
        # gán new_manager làm quản lý của chính họ (tự tham chiếu).
        affected_qs = Employee.objects.filter(manager_id=old_manager_id).exclude(pk=new_manager_id)
        affected_employees = list(
            affected_qs.order_by('employee_id').values('id', 'employee_id', 'full_name')
        )
        count = affected_qs.update(manager=new_manager)

        logger.info(
            f"{request.user.username} đổi quản lý trực tiếp: "
            f"{count} nhân viên từ {old_manager.employee_id} sang {new_manager.employee_id}"
        )

        return Response({
            'success': True,
            'message': f'Đã chuyển {count} nhân viên từ quản lý "{old_manager.full_name}" sang "{new_manager.full_name}"',
            'count': count,
            'employees': affected_employees,
        })


# ======================
# ATTENDANCE EXPLANATION VIEWSETS
# ======================

from .models import AttendanceExplanation
from .serializers import (
    AttendanceExplanationSerializer, AttendanceExplanationListSerializer,
    AttendanceExplanationStatsSerializer, CompanyUnitSerializer, BranchLocationSerializer
)
from .attendance_models import BranchLocation


class CompanyUnitViewSet(viewsets.ModelViewSet):
    """API endpoint for managing company units (đơn vị làm việc)"""
    queryset = CompanyUnit.objects.all().order_by('name')
    serializer_class = CompanyUnitSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = DepartmentResultsSetPagination
    filter_backends = [filters.SearchFilter]
    search_fields = ['name', 'code']

    def get_permissions(self):
        if self.action == 'list':
            return [AllowAny()]
        return super().get_permissions()

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        return qs


class BranchLocationViewSet(viewsets.ModelViewSet):
    """CRUD cấu hình tọa độ và bán kính chấm công của chi nhánh."""
    queryset = BranchLocation.objects.select_related('company_unit').all().order_by('name')
    serializer_class = BranchLocationSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = DepartmentResultsSetPagination
    filter_backends = [filters.SearchFilter, DjangoFilterBackend]
    search_fields = ['name', 'address', 'company_unit__name']
    filterset_fields = ['is_active', 'company_unit']


class DepartmentViewSet(viewsets.ModelViewSet):
    """
    API endpoint cho Phòng ban (Department với is_section=False).
    Tự lọc is_section=False và tự set khi create/update.
    """
    queryset = Department.objects.filter(is_section=False, is_deleted=False).order_by('code')
    serializer_class = DepartmentSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]

    def get_permissions(self):
        if self.action == 'list':
            return [AllowAny()]
        return super().get_permissions()
    pagination_class = DepartmentResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]

    # 'manager' cho phép FE tra "phòng ban mà 1 nhân viên đang quản lý"
    # (vd. /api-hrm/departments/?manager=<employee_id>) — dùng để khoá cứng
    # filter phòng ban ở trang Quản lý nhân viên cho user is_manager.
    filterset_fields = ['parent_department', 'manager']
    search_fields = ['name', 'code']

    def perform_create(self, serializer):
        serializer.save(is_section=False)

    def perform_update(self, serializer):
        serializer.save(is_section=False)

    def perform_destroy(self, instance):
        """
        Soft-delete: đánh dấu is_deleted + lưu người xoá/thời điểm xoá thay vì xoá
        cứng — trước đây xoá cứng vừa mất dữ liệu vĩnh viễn không cách nào tra ai
        xoá, vừa âm thầm gỡ Employee.department (SET_NULL) của mọi NV thuộc phòng
        ban đó. Xem employee.models.Department.is_deleted/deleted_at/deleted_by.
        """
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = getattr(self.request.user, 'employee', None)
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])

    @action(detail=True, methods=['get'])
    def employees(self, request, pk=None):
        """
        Get all employees in a department
        """
        department = self.get_object()
        employees = Employee.objects.filter(department=department)
        page = self.paginate_queryset(employees)

        if page is not None:
            serializer = EmployeeListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = EmployeeListSerializer(employees, many=True)
        return Response(serializer.data)


class SectionViewSet(viewsets.ModelViewSet):
    """
    API endpoint cho Bộ phận (Department với is_section=True).
    Dùng chung model Department nhưng tự lọc is_section=True và tự set khi create/update.
    """
    queryset = Department.objects.filter(is_section=True, is_deleted=False).select_related('parent_department').order_by('code')
    serializer_class = DepartmentSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]

    def get_permissions(self):
        if self.action == 'list':
            return [AllowAny()]
        return super().get_permissions()

    pagination_class = DepartmentResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['parent_department']
    search_fields = ['name', 'code']

    def perform_create(self, serializer):
        serializer.save(is_section=True)

    def perform_update(self, serializer):
        serializer.save(is_section=True)

    def perform_destroy(self, instance):
        """Soft-delete — xem DepartmentViewSet.perform_destroy (cùng model, cùng lý do)."""
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.deleted_by = getattr(self.request.user, 'employee', None)
        instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by'])


# ======================
# ASSET MANAGEMENT VIEWSETS
# ======================

def _asset_type_counts(qs):
    """Đếm tài sản theo "Phân loại" thực tế đang lưu — gồm cả loại gõ tự do,
    không chỉ các loại chuẩn trong ASSET_TYPE. Trả [(giá trị, nhãn, số lượng)]."""
    from django.db.models import Count
    from .models import ASSET_TYPE
    labels = dict(ASSET_TYPE)
    rows = qs.values('asset_type').annotate(n=Count('id')).order_by('-n', 'asset_type')
    return [(r['asset_type'], labels.get(r['asset_type'], r['asset_type']), r['n'])
            for r in rows if r['asset_type']]


class AssetFilterSet(django_filters.FilterSet):
    # "Phân loại" là text tự do: lọc bằng CharFilter, không dùng ChoiceFilter tự
    # sinh từ choices (sẽ báo "Select a valid choice" với loại gõ tự do).
    asset_type = django_filters.CharFilter(field_name='asset_type')

    class Meta:
        model = Asset
        fields = ['asset_type', 'status', 'condition', 'department', 'assigned_to']


class AssetViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing assets
    """
    queryset = Asset.objects.all().order_by('asset_code')
    serializer_class = AssetSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    def get_permissions(self):
        """
        Custom permissions for asset actions
        """
        if self.action in (
            'assigned_assets',
            'confirm_handover',
            'reject_handover',
            'pending_handovers',
            'recent_returns',
            'acknowledge_returns',
        ):
            return [IsAuthenticated()]
        return super().get_permissions()

    filterset_class = AssetFilterSet
    
    search_fields = [
        'asset_code', 'name', 'brand', 'model', 'serial_number',
        'invoice_number', 'supplier'
    ]
    
    ordering_fields = [
        'asset_code', 'name', 'purchase_date', 'purchase_price',
        'created_at', 'updated_at'
    ]
    
    ordering = ['asset_code']

    def get_queryset(self):
        """Hỗ trợ lọc tài sản có yêu cầu bàn giao còn chờ xác nhận."""
        queryset = super().get_queryset()
        pending_handover = (self.request.query_params.get('pending_handover') or '').lower()
        if pending_handover in ('true', '1'):
            queryset = queryset.filter(assignment_history__status='PENDING').distinct()
        return queryset
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return AssetListSerializer
        return AssetSerializer

    def perform_create(self, serializer):
        """
        Gán người tạo là nhân viên tương ứng với user đang đăng nhập
        """
        employee = getattr(self.request.user, 'employee', None)
        serializer.save(created_by=employee)

    @action(detail=True, methods=['post'])
    def upload_image(self, request, pk=None):
        """
        POST /api-hrm/assets/{id}/upload_image/
        multipart: 'image' = file ảnh, 'image_type' = 'current' | 'purchase'.

        Tách riêng khỏi create/update (thay vì gộp vào payload JSON chính) và luôn
        upload thẳng lên Cloudfly — đúng pattern field "hình ảnh" đã dùng cho
        ChangeAvatarView/Employee.avatar, KHÔNG qua cờ CLOUDFLY_ENABLED (cờ này mặc
        định False nếu thiếu biến môi trường, dùng nó ở đây sẽ âm thầm bỏ qua upload
        mà không báo lỗi gì).
        """
        from .utils import upload_file_to_cloudfly, get_cloudfly_presigned_url

        asset = self.get_object()
        image_type = request.data.get('image_type')
        if image_type not in ('current', 'purchase'):
            return Response({'error': "image_type phải là 'current' hoặc 'purchase'"}, status=status.HTTP_400_BAD_REQUEST)

        image_file = request.FILES.get('image')
        if not image_file:
            return Response({'error': 'Vui lòng tải lên file ảnh'}, status=status.HTTP_400_BAD_REQUEST)

        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
        content_type = getattr(image_file, 'content_type', '') or ''
        if content_type not in allowed_types:
            return Response(
                {'error': 'Chỉ hỗ trợ định dạng ảnh: JPEG, PNG, WebP, GIF'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            s3_key = upload_file_to_cloudfly(image_file, folder='assets/images')
        except Exception as e:
            logger.error(f"Asset image upload failed for asset {asset.asset_code}: {type(e).__name__}")
            return Response({'error': 'Upload ảnh thất bại, vui lòng thử lại'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        field_name = 'current_image' if image_type == 'current' else 'purchase_image'
        setattr(asset, field_name, s3_key)
        asset.save(update_fields=[field_name])

        return Response({
            'success': True,
            'current_image_url': get_cloudfly_presigned_url(asset.current_image) if asset.current_image else None,
            'purchase_image_url': get_cloudfly_presigned_url(asset.purchase_image) if asset.purchase_image else None,
        })

    @action(detail=True, methods=['post'])
    def clear_image(self, request, pk=None):
        """
        POST /api-hrm/assets/{id}/clear_image/
        Body: {"image_type": "current" | "purchase"}
        """
        asset = self.get_object()
        image_type = request.data.get('image_type')
        if image_type not in ('current', 'purchase'):
            return Response({'error': "image_type phải là 'current' hoặc 'purchase'"}, status=status.HTTP_400_BAD_REQUEST)

        field_name = 'current_image' if image_type == 'current' else 'purchase_image'
        setattr(asset, field_name, None)
        asset.save(update_fields=[field_name])
        return Response({'success': True})

    @action(detail=True, methods=['get'], url_path='qr_code')
    def qr_code(self, request, pk=None):
        """
        Trả về ảnh QR (PNG) generate on-the-fly — KHÔNG lưu file, luôn tạo lại
        theo request nên không bao giờ lệch dữ liệu. QR encode 1 URL mở trang
        chi tiết tài sản trong HRM (route /dashboard/assets/{id}), đăng nhập
        rồi mới xem được (ProtectedRoute tự redirect /login?redirect=... rồi
        quay lại đúng trang sau khi đăng nhập) — tài sản có giá mua/giá trị
        hiện tại nên không để public.
        GET /api-hrm/assets/{id}/qr_code/
        """
        import qrcode
        from io import BytesIO
        from django.http import HttpResponse
        from django.conf import settings

        asset = self.get_object()
        target_url = f"{settings.FRONTEND_URL}/dashboard/assets/{asset.id}"

        qr = qrcode.QRCode(box_size=10, border=2)
        qr.add_data(target_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")

        buffer = BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)

        response = HttpResponse(buffer.getvalue(), content_type='image/png')
        response['Content-Disposition'] = f'inline; filename="qr-{asset.asset_code}.png"'
        return response

    @action(detail=False, methods=['get'])
    def assigned_assets(self, request):
        """
        Get assets assigned to the currently logged-in employee.
        Trả về mọi asset mà employee đang giữ CONFIRMED (kể cả MONITOR
        multi-holder, khi `asset.assigned_to` snapshot có thể là holder khác).
        Mỗi asset kèm field `my_assigned_quantity` = tổng số đơn vị employee
        này đang giữ cho asset đó.
        """
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response([], status=status.HTTP_200_OK)

        assets = Asset.objects.filter(
            assignment_history__assigned_to=employee,
            assignment_history__status='CONFIRMED',
            assignment_history__returned_date__isnull=True,
        ).distinct().order_by('asset_code')
        serializer = AssetListSerializer(assets, many=True)
        data = serializer.data
        from django.db.models import Sum
        for asset_data in data:
            my_qty = AssetAssignmentHistory.objects.filter(
                asset_id=asset_data['id'],
                assigned_to=employee,
                status='CONFIRMED',
                returned_date__isnull=True,
            ).aggregate(total=Sum('assigned_quantity'))['total'] or 0
            asset_data['my_assigned_quantity'] = int(my_qty)
        return Response(data)

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get asset statistics
        """
        total = Asset.objects.count()
        in_use = Asset.objects.filter(status='IN_USE').count()
        idle = Asset.objects.filter(status='IDLE').count()
        under_maintenance = Asset.objects.filter(status='UNDER_MAINTENANCE').count()
        damaged = Asset.objects.filter(status='DAMAGED').count()
        retired = Asset.objects.filter(status='RETIRED').count()
        
        # Count by asset type (cả loại gõ tự do)
        type_stats = [
            {'asset_type': value, 'asset_type_display': label, 'count': count}
            for value, label, count in _asset_type_counts(Asset.objects.all())
        ]
        
        # Count by department
        from employee.models import Department
        departments = Department.objects.all()
        department_stats = []
        for dept in departments:
            count = Asset.objects.filter(department=dept).count()
            if count > 0:
                department_stats.append({
                    'department_id': dept.id,
                    'department_name': dept.name,
                    'count': count
                })
        
        # Total asset value
        total_value = Asset.objects.aggregate(
            total=models.Sum('purchase_price')
        )['total'] or 0
        
        # Assets with expired warranty
        today = timezone.now().date()
        expired_warranty = Asset.objects.filter(
            warranty_expiry__lt=today,
            warranty_expiry__isnull=False
        ).count()
        
        return Response({
            'total': total,
            'in_use': in_use,
            'idle': idle,
            'under_maintenance': under_maintenance,
            'damaged': damaged,
            'retired': retired,
            'type_stats': type_stats,
            'department_stats': department_stats,
            'total_value': float(total_value),
            'expired_warranty': expired_warranty
        })
    
    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        """
        Tạo yêu cầu bàn giao tài sản (trạng thái PENDING).
        Nhân viên cần vào app để Confirm/Reject trước khi asset thực sự chuyển IN_USE.
        """
        asset = self.get_object()
        employee_id = request.data.get('employee_id')
        assigned_date = request.data.get('assigned_date')
        notes = request.data.get('notes', '')

        if not employee_id:
            return Response(
                {'error': 'employee_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )

        assigned_by = getattr(request.user, 'employee', None)
        # Nếu admin user chưa link Employee profile, fallback theo thứ tự:
        # 1) Match Employee qua email hoặc tên user
        # 2) Dùng asset.managed_by (Người quản lý kho thực tế của asset đó)
        # Lưu ý: KHÔNG dùng `from employee.models import Employee` ở đây vì
        # sẽ shadow tên module-level → UnboundLocalError ở block bên dưới.
        if assigned_by is None:
            try:
                user = request.user
                user_email = getattr(user, 'email', None)
                if user_email:
                    assigned_by = Employee.objects.filter(personal_email__iexact=user_email).first()
                if assigned_by is None and getattr(user, 'first_name', None):
                    full = f"{user.first_name} {getattr(user, 'last_name', '') or ''}".strip()
                    if full:
                        assigned_by = Employee.objects.filter(full_name__iexact=full).first()
            except Exception:
                pass
        # Cuối cùng fallback về người quản lý kho của asset
        if assigned_by is None:
            assigned_by = asset.managed_by
        override_pending = bool(request.data.get('override_pending', False))

        # Số lượng bàn giao (chỉ có nghĩa với MONITOR multi-holder).
        # Default 1 cho tương thích client cũ.
        try:
            quantity = int(request.data.get('quantity', 1) or 1)
        except (TypeError, ValueError):
            quantity = 1

        try:
            history = asset.assign_to_employee(
                employee,
                assigned_date=assigned_date,
                notes=notes,
                assigned_by=assigned_by,
                override_pending=override_pending,
                quantity=quantity,
            )
        except ValidationError as e:
            message = e.messages[0] if hasattr(e, 'messages') and e.messages else str(e)
            payload = {'error': message}
            error_code = getattr(e, 'error_code', None)
            if error_code:
                payload['error_code'] = error_code
            for attr in ('total_quantity', 'remaining_quantity', 'requested_quantity'):
                val = getattr(e, attr, None)
                if val is not None:
                    payload[attr] = val
            existing = getattr(e, 'existing_pending', None)
            if existing is not None:
                payload['existing_pending'] = {
                    'id': existing.id,
                    'assigned_to': existing.assigned_to_id,
                    'assigned_to_name': existing.assigned_to.full_name if existing.assigned_to else None,
                    'assigned_date': existing.assigned_date.isoformat() if existing.assigned_date else None,
                    'assigned_by_name': existing.assigned_by.full_name if existing.assigned_by else None,
                    'assignment_notes': existing.assignment_notes,
                }
            return Response(payload, status=status.HTTP_400_BAD_REQUEST)

        return Response(AssetAssignmentHistorySerializer(history).data)

    @action(detail=True, methods=['post'], url_path='confirm_handover')
    def confirm_handover(self, request, pk=None):
        """Nhân viên xác nhận nhận máy: PENDING → CONFIRMED, asset chuyển IN_USE."""
        from django.db import transaction

        asset = self.get_object()
        me = getattr(request.user, 'employee', None)
        if me is None:
            return Response(
                {'error': 'Tài khoản hiện tại không liên kết với nhân viên'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        history = AssetAssignmentHistory.objects.filter(
            asset=asset, status='PENDING', assigned_to=me
        ).first()
        if not history:
            return Response(
                {'error': 'Không có yêu cầu bàn giao chờ bạn xác nhận'},
                status=status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            # Non-MONITOR: auto-thu hồi holder cũ nếu asset đang thuộc người khác.
            # MONITOR multi-holder: KHÔNG auto-thu hồi — nhiều holder song song.
            if not asset.is_multi_holder():
                if asset.assigned_to and asset.assigned_to_id != me.id:
                    AssetAssignmentHistory.objects.filter(
                        asset=asset,
                        assigned_to=asset.assigned_to,
                        status='CONFIRMED',
                        returned_date__isnull=True,
                    ).update(
                        status='RETURNED',
                        returned_date=timezone.now().date(),
                        return_notes=f"Tự động thu hồi khi {me.full_name} xác nhận nhận máy",
                    )

            # Update history
            history.status = 'CONFIRMED'
            history.confirmed_at = timezone.now()
            history.save()

            # Update asset snapshot
            asset.assigned_to = me
            asset.assigned_date = history.assigned_date
            asset.status = 'IN_USE'
            asset.save()

        return Response(AssetAssignmentHistorySerializer(history).data)

    @action(detail=True, methods=['post'], url_path='reject_handover')
    def reject_handover(self, request, pk=None):
        """Nhân viên từ chối nhận máy: PENDING → REJECTED, asset giữ nguyên."""
        asset = self.get_object()
        me = getattr(request.user, 'employee', None)
        if me is None:
            return Response(
                {'error': 'Tài khoản hiện tại không liên kết với nhân viên'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reason = (request.data.get('rejection_reason') or '').strip()
        history = AssetAssignmentHistory.objects.filter(
            asset=asset, status='PENDING', assigned_to=me
        ).first()
        if not history:
            return Response(
                {'error': 'Không có yêu cầu bàn giao chờ bạn xác nhận'},
                status=status.HTTP_404_NOT_FOUND,
            )

        history.status = 'REJECTED'
        history.rejected_at = timezone.now()
        history.rejection_reason = reason
        history.save()

        return Response(AssetAssignmentHistorySerializer(history).data)

    @action(detail=False, methods=['get'], url_path='recent_returns')
    def recent_returns(self, request):
        """Danh sách các tài sản đã được thu hồi khỏi nhân viên hiện tại trong N ngày gần đây.

        Dùng để FE hiển thị dialog "Thiết bị đã được thu hồi" lên người được bàn
        giao, giúp họ biết máy đã bị thu hồi mà không cần refresh thủ công.
        """
        me = getattr(request.user, 'employee', None)
        if me is None:
            return Response([], status=status.HTTP_200_OK)

        days = 7
        try:
            days = max(1, min(30, int(request.query_params.get('days', days))))
        except (TypeError, ValueError):
            pass

        from datetime import timedelta
        cutoff = timezone.now().date() - timedelta(days=days)
        qs = AssetAssignmentHistory.objects.filter(
            assigned_to=me,
            status='RETURNED',
            returned_date__gte=cutoff,
        ).exclude(seen_by=me).select_related('asset', 'assigned_by').order_by('-returned_date', '-id')
        return Response(AssetAssignmentHistorySerializer(qs, many=True).data)

    @action(detail=False, methods=['post'], url_path='acknowledge_returns')
    def acknowledge_returns(self, request):
        """Đánh dấu các thông báo thu hồi là đã xem cho nhân viên hiện tại."""
        me = getattr(request.user, 'employee', None)
        if me is None:
            return Response({'acknowledged': 0})
        ids = request.data.get('ids', [])
        if not isinstance(ids, list) or not ids:
            return Response({'acknowledged': 0})
        histories = AssetAssignmentHistory.objects.filter(
            id__in=ids,
            assigned_to=me,
            status='RETURNED',
        )
        for h in histories:
            h.seen_by.add(me)
        return Response({'acknowledged': histories.count()})

    @action(detail=False, methods=['get'], url_path='pending_handovers')
    def pending_handovers(self, request):
        """Danh sách yêu cầu bàn giao đang chờ xác nhận của nhân viên hiện tại."""
        me = getattr(request.user, 'employee', None)
        if me is None:
            return Response([], status=status.HTTP_200_OK)

        qs = AssetAssignmentHistory.objects.filter(
            status='PENDING', assigned_to=me
        ).select_related('asset', 'assigned_by').order_by('-assigned_date')
        return Response(AssetAssignmentHistorySerializer(qs, many=True).data)

    @action(detail=False, methods=['get'], url_path='type_options')
    def type_options(self, request):
        """Các "Phân loại" đang dùng (kèm số tài sản) + các loại chuẩn chưa dùng
        — FE gợi ý khi gõ ô Phân loại, để HCNS gõ thống nhất (tránh "CCDCVP" /
        "CCDC VP" thành 2 loại)."""
        from .models import ASSET_TYPE
        used = _asset_type_counts(Asset.objects.filter(is_deleted=False))
        options = [{'value': v, 'label': label, 'count': n} for v, label, n in used]
        used_values = {v for v, _, _ in used}
        options += [{'value': code, 'label': label, 'count': 0}
                    for code, label in ASSET_TYPE if code not in used_values]
        return Response(options)

    @action(detail=False, methods=['get'], url_path='export_template')
    def export_template(self, request):
        """Tải file mẫu (.xlsx) để nhập tài sản hàng loạt — header + dropdown +
        2 dòng ví dụ, không phụ thuộc dữ liệu thật. FE dùng cho nút "Tải file mẫu"
        ở mục Nhập Excel (giống Department/Position).
        """
        from io import BytesIO
        from django.http import HttpResponse
        from .asset_export import build_template_workbook

        wb = build_template_workbook()
        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        response = HttpResponse(
            buffer.getvalue(),
            content_type=(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ),
        )
        response['Content-Disposition'] = 'attachment; filename="mau-import-tai-san.xlsx"'
        return response

    @action(detail=False, methods=['get'], url_path='export_excel')
    def export_excel(self, request):
        """Xuất Asset queryset (đã filter) ra file Excel theo schema chuẩn.

        Query params:
            search: chuỗi tìm kiếm trên asset_code/name/brand/model/managed_by_name/assigned_to_name
            asset_type: filter theo loại (uppercase enum)
            status: filter theo trạng thái
            condition: filter theo tình trạng

        Trả về file .xlsx attachment.
        """
        from datetime import datetime as _dt
        from io import BytesIO
        from django.db.models import Q
        from django.http import HttpResponse
        from .asset_export import build_workbook

        qs = Asset.objects.filter(is_deleted=False).select_related(
            'department', 'managed_by', 'assigned_to'
        )

        search = (request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(asset_code__icontains=search)
                | Q(name__icontains=search)
                | Q(brand__icontains=search)
                | Q(model__icontains=search)
                | Q(managed_by__full_name__icontains=search)
                | Q(assigned_to__full_name__icontains=search)
            )

        # FE gửi nhiều loại nối bằng dấu phẩy. Loại gõ tự do có thể chứa dấu
        # phẩy, nên giá trị trùng y hệt 1 loại đang có thì giữ nguyên, không tách.
        wanted = set()
        for raw in request.query_params.getlist('asset_type'):
            raw = raw.strip()
            if not raw or raw.lower() == 'all':
                continue
            parts = [raw] if Asset.objects.filter(asset_type=raw).exists() else raw.split(',')
            wanted.update(normalize_asset_type(p) for p in parts if p.strip())
        if wanted:
            qs = qs.filter(asset_type__in=wanted)

        asset_status = (request.query_params.get('status') or '').strip()
        if asset_status and asset_status.lower() != 'all':
            qs = qs.filter(status=asset_status.upper())

        condition = (request.query_params.get('condition') or '').strip()
        if condition and condition.lower() != 'all':
            qs = qs.filter(condition=condition.upper())

        qs = qs.order_by('asset_type', 'name', 'id')

        wb = build_workbook(qs)
        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f"tai-san-{_dt.now().strftime('%Y-%m-%d')}.xlsx"
        response = HttpResponse(
            buffer.getvalue(),
            content_type=(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ),
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=['post'], url_path='bulk_import_excel',
            parser_classes=[MultiPartParser])
    def bulk_import_excel(self, request):
        """Nhận file .xlsx từ FE, parse + upsert Asset bằng `hrm.asset_import`.

        Form-data field: ``file`` (xlsx). Trả về JSON summary theo format
        của ``import_workbook()``.
        """
        from openpyxl import load_workbook
        from .asset_import import import_workbook

        upload = request.FILES.get('file')
        if not upload:
            return Response(
                {'error': 'Thiếu file (form-data field "file")'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            wb = load_workbook(upload, data_only=True)
        except Exception as e:
            return Response(
                {'error': f'Không đọc được file Excel: {e}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            result = import_workbook(wb)
        except Exception as e:
            return Response(
                {'error': f'Lỗi khi xử lý import: {e}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def return_asset(self, request, pk=None):
        """
        Thu hồi tài sản.

        - ``history_id`` optional: thu hồi đúng 1 history record (partial
          return cho MONITOR multi-holder).
        - Không có ``history_id``: thu hồi toàn bộ holder hiện tại (flow cũ).
        """
        asset = self.get_object()
        return_date = request.data.get('return_date')
        condition = request.data.get('condition')
        notes = request.data.get('notes', '')
        history_id = request.data.get('history_id')
        return_quantity = request.data.get('return_quantity')
        try:
            history_id = int(history_id) if history_id not in (None, '') else None
        except (TypeError, ValueError):
            history_id = None
        try:
            return_quantity = int(return_quantity) if return_quantity not in (None, '') else None
        except (TypeError, ValueError):
            return_quantity = None

        # Validate: nếu không có history_id thì phải có assigned_to (flow cũ)
        if history_id is None and not asset.assigned_to:
            return Response(
                {'error': 'Tài sản không có người đang giữ để thu hồi'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Nếu có history_id, verify nó thuộc về asset này và đang CONFIRMED
        if history_id is not None:
            hist = AssetAssignmentHistory.objects.filter(
                id=history_id, asset=asset, status='CONFIRMED'
            ).first()
            if not hist:
                return Response(
                    {'error': f'Không tìm thấy bản ghi bàn giao id={history_id} ở trạng thái CONFIRMED'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        success = asset.return_asset(
            return_date=return_date,
            condition=condition,
            notes=notes,
            history_id=history_id,
            return_quantity=return_quantity,
        )

        if success:
            serializer = self.get_serializer(asset)
            return Response(serializer.data)
        else:
            return Response(
                {'error': 'Không thực hiện được thu hồi'},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['get'])
    def assignment_history(self, request, pk=None):
        """
        Get assignment history for an asset
        """
        asset = self.get_object()
        history = asset.get_assignment_history()
        page = self.paginate_queryset(history)
        
        if page is not None:
            serializer = AssetAssignmentHistorySerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = AssetAssignmentHistorySerializer(history, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def maintenance_history(self, request, pk=None):
        """
        Get maintenance history for an asset
        """
        asset = self.get_object()
        maintenance = asset.maintenance_records.all().order_by('-maintenance_date')
        page = self.paginate_queryset(maintenance)
        
        if page is not None:
            serializer = AssetMaintenanceSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = AssetMaintenanceSerializer(maintenance, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def inventory_history(self, request, pk=None):
        """Lịch sử kiểm kê của 1 tài sản."""
        from .serializers import AssetInventoryCheckSerializer
        asset = self.get_object()
        checks = asset.inventory_checks.select_related('checked_by', 'created_by').order_by('-check_date', '-id')
        page = self.paginate_queryset(checks)
        if page is not None:
            serializer = AssetInventoryCheckSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = AssetInventoryCheckSerializer(checks, many=True)
        return Response(serializer.data)


class AssetAssignmentHistoryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing asset assignment history
    """
    queryset = AssetAssignmentHistory.objects.all().order_by('-assigned_date')
    serializer_class = AssetAssignmentHistorySerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    
    filterset_fields = ['asset', 'assigned_to', 'returned_date']
    
    @action(detail=False, methods=['get'])
    def current_assignments(self, request):
        """
        Get current asset assignments (where returned_date is null)
        """
        current = AssetAssignmentHistory.objects.filter(
            returned_date__isnull=True
        ).order_by('-assigned_date')
        page = self.paginate_queryset(current)
        
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(current, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def employee_assignments(self, request):
        """
        Get asset assignments for a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        assignments = AssetAssignmentHistory.objects.filter(
            assigned_to=employee
        ).order_by('-assigned_date')
        page = self.paginate_queryset(assignments)
        
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(assignments, many=True)
        return Response(serializer.data)


class AssetInventoryCheckViewSet(viewsets.ModelViewSet):
    """API kiểm kê tài sản (mỗi bản ghi là 1 lần kiểm kê thực tế)."""
    queryset = AssetInventoryCheck.objects.select_related('asset', 'checked_by', 'created_by').order_by('-check_date', '-id')
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['asset', 'result', 'checked_by']
    search_fields = ['notes', 'asset__asset_code', 'asset__name']

    def get_serializer_class(self):
        from .serializers import AssetInventoryCheckSerializer
        return AssetInventoryCheckSerializer

    def perform_create(self, serializer):
        """Mặc định người tạo bản ghi = nhân viên của user đang đăng nhập."""
        employee = getattr(self.request.user, 'employee', None)
        if employee and not serializer.validated_data.get('created_by'):
            serializer.save(created_by=employee)
        else:
            serializer.save()


class AssetMaintenanceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing asset maintenance records
    """
    queryset = AssetMaintenance.objects.all().order_by('-maintenance_date')
    serializer_class = AssetMaintenanceSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    
    filterset_fields = ['asset', 'maintenance_type', 'performed_by_employee']
    search_fields = ['description', 'result', 'performed_by']
    
    @action(detail=False, methods=['get'])
    def upcoming_maintenance(self, request):
        """
        Get assets with upcoming maintenance
        """
        from datetime import timedelta
        
        # Get assets with next_maintenance_date within next 30 days
        thirty_days_later = timezone.now().date() + timedelta(days=30)
        upcoming = AssetMaintenance.objects.filter(
            next_maintenance_date__isnull=False,
            next_maintenance_date__gte=timezone.now().date(),
            next_maintenance_date__lte=thirty_days_later
        ).order_by('next_maintenance_date')
        
        page = self.paginate_queryset(upcoming)
        
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(upcoming, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def asset_maintenance_summary(self, request):
        """
        Get maintenance summary for all assets
        """
        from django.db.models import Count, Sum, Avg
        
        # Maintenance count by asset
        maintenance_by_asset = AssetMaintenance.objects.values(
            'asset__asset_code', 'asset__name'
        ).annotate(
            count=Count('id'),
            total_cost=Sum('cost'),
            avg_cost=Avg('cost')
        ).order_by('-count')
        
        # Maintenance count by type
        maintenance_by_type = AssetMaintenance.objects.values(
            'maintenance_type'
        ).annotate(
            count=Count('id'),
            total_cost=Sum('cost')
        ).order_by('-count')
        
        # Recent maintenance (last 30 days)
        from datetime import timedelta
        thirty_days_ago = timezone.now().date() - timedelta(days=30)
        recent_maintenance = AssetMaintenance.objects.filter(
            maintenance_date__gte=thirty_days_ago
        ).count()
        
        return Response({
            'maintenance_by_asset': list(maintenance_by_asset),
            'maintenance_by_type': list(maintenance_by_type),
            'recent_maintenance': recent_maintenance,
            'total_maintenance_records': AssetMaintenance.objects.count()
        })


class PositionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing positions
    """
    queryset = Position.objects.all().prefetch_related('department').order_by('code').distinct()
    serializer_class = PositionSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]

    filterset_class = PositionFilter
    search_fields = ['title', 'code', 'description', 'department__name', 'department__code']

    def get_permissions(self):
        if self.action == 'list':
            return [AllowAny()]
        return super().get_permissions()
    
    @action(detail=True, methods=['get'])
    def employees(self, request, pk=None):
        """
        Get all employees in a position
        """
        position = self.get_object()
        employees = Employee.objects.filter(position=position)
        page = self.paginate_queryset(employees)
        
        if page is not None:
            serializer = EmployeeListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = EmployeeListSerializer(employees, many=True)
        return Response(serializer.data)


class AttendanceAppDownloadConfigAPIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        config = AttendanceAppDownloadConfig.objects.filter(is_active=True).first()
        if not config:
            return Response({
                'name': 'Ứng dụng chấm công',
                'ios_url': '',
                'android_url': '',
            })
        return Response({
            'name': config.name,
            'ios_url': config.ios_url,
            'android_url': config.android_url,
        })


class DashboardAPIView(APIView):
    """
    API endpoint for HRM dashboard statistics
    """
    permission_classes = [IsAuthenticated]

    def _parse_date_param(self, value, field_name):
        if not value:
            return None
        try:
            return datetime.strptime(value, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            raise ValueError(f'{field_name} must be YYYY-MM-DD')

    def _add_months(self, source_date, months):
        month = source_date.month - 1 + months
        year = source_date.year + month // 12
        month = month % 12 + 1
        month_lengths = [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                         31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        day = min(source_date.day, month_lengths[month - 1])
        return source_date.replace(year=year, month=month, day=day)

    def _is_truthy(self, value):
        return str(value).lower() in ('1', 'true', 'yes', 'y', 'on')

    def _active_on_date_q(self, target_date):
        return (
            (models.Q(start_date__isnull=True) | models.Q(start_date__lte=target_date)) &
            (models.Q(end_date__isnull=True) | models.Q(end_date__gte=target_date))
        )

    def _month_end(self, source_date):
        first_day = source_date.replace(day=1)
        return self._add_months(first_day, 1) - timedelta(days=1)

    def _average_active_headcount(self, queryset, start_date, end_date):
        sample_dates = []
        cursor = start_date.replace(day=1)
        while cursor <= end_date:
            sample_dates.append(min(self._month_end(cursor), end_date))
            cursor = self._add_months(cursor, 1)

        counts = [queryset.filter(self._active_on_date_q(sample_date)).count() for sample_date in sample_dates]
        return (sum(counts) / len(counts)) if counts else 0

    def _is_voluntary_departure(self, employee):
        reason = (employee.termination_reason or employee.employment_status_notes or '').lower()
        voluntary_keywords = (
            'tự nguyện', 'tu nguyen', 'xin nghỉ', 'xin nghi', 'nghỉ việc',
            'nghi viec', 'resign', 'resignation', 'personal', 'cá nhân', 'ca nhan',
        )
        involuntary_keywords = (
            'sa thải', 'sa thai', 'kỷ luật', 'ky luat', 'chấm dứt', 'cham dut',
            'terminated', 'dismiss', 'layoff',
        )
        return any(keyword in reason for keyword in voluntary_keywords) and not any(
            keyword in reason for keyword in involuntary_keywords
        )

    def _safe_rate(self, numerator, denominator):
        return round((numerator * 100 / denominator), 1) if denominator else 0

    def _build_attrition_stats(self, request, today):
        all_time = self._is_truthy(request.query_params.get('all_time'))
        start_date = None if all_time else self._parse_date_param(request.query_params.get('start_date'), 'start_date')
        end_date = self._parse_date_param(request.query_params.get('end_date'), 'end_date') or today
        if start_date and start_date > end_date:
            raise ValueError('start_date must be before or equal to end_date')

        if all_time or not start_date:
            first_start_date = Employee.objects.filter(start_date__isnull=False).order_by('start_date').values_list('start_date', flat=True).first()
            start_date = first_start_date or end_date

        department_id = request.query_params.get('department_id') or request.query_params.get('department')
        if department_id:
            try:
                department_id = int(department_id)
            except (TypeError, ValueError):
                raise ValueError('department_id must be an integer')

        departments = Department.objects.all().order_by('name')
        if department_id:
            departments = departments.filter(id=department_id)

        period_days = max((end_date - start_date).days + 1, 1)
        period_months = max(period_days / 30.4375, 1)
        denominator_start_date = max(start_date, end_date - timedelta(days=365) + timedelta(days=1))

        def calculate_for_department(department):
            base_qs = Employee.objects.filter(department=department).select_related('department')
            headcount_start = base_qs.filter(self._active_on_date_q(start_date)).count()
            headcount_end = base_qs.filter(self._active_on_date_q(end_date)).count()
            average_headcount = self._average_active_headcount(
                base_qs,
                denominator_start_date,
                end_date,
            )

            departures_qs = base_qs.filter(end_date__gte=start_date, end_date__lte=end_date)
            departures = list(departures_qs)
            departure_count = len(departures)
            voluntary_departures = sum(1 for employee in departures if self._is_voluntary_departure(employee))

            start_employee_ids = set(base_qs.filter(self._active_on_date_q(start_date)).values_list('id', flat=True))
            retained_from_start = base_qs.filter(id__in=start_employee_ids).filter(self._active_on_date_q(end_date)).count()
            denominator_employee_ids = set(
                base_qs.filter(self._active_on_date_q(denominator_start_date)).values_list('id', flat=True)
            )
            retained_from_denominator_start = base_qs.filter(
                id__in=denominator_employee_ids
            ).filter(self._active_on_date_q(end_date)).count()

            hires = list(base_qs.filter(start_date__gte=start_date, start_date__lte=end_date))
            early_departures_3m = 0
            early_departures_6m = 0
            for employee in hires:
                if not employee.start_date or not employee.end_date:
                    continue
                if employee.end_date <= self._add_months(employee.start_date, 3):
                    early_departures_3m += 1
                if employee.end_date <= self._add_months(employee.start_date, 6):
                    early_departures_6m += 1

            tenure_days = []
            for employee in base_qs.filter(self._active_on_date_q(end_date), start_date__isnull=False):
                tenure_days.append(max((end_date - employee.start_date).days, 0))
            average_tenure_months = round((sum(tenure_days) / len(tenure_days)) / 30.4375, 1) if tenure_days else 0

            monthly_rate = (departure_count / average_headcount / period_months) if average_headcount else 0
            turnover_rate = self._safe_rate(departure_count, average_headcount)

            return {
                'department_id': department.id,
                'department_name': department.name,
                'department_code': department.code,
                'headcount_start': headcount_start,
                'headcount_end': headcount_end,
                'average_headcount': round(average_headcount, 1),
                'departures': departure_count,
                'voluntary_departures': voluntary_departures,
                'hires': len(hires),
                'retained_from_start': retained_from_start,
                'retained_from_denominator_start': retained_from_denominator_start,
                'turnover_rate': turnover_rate,
                'voluntary_turnover_rate': self._safe_rate(voluntary_departures, average_headcount),
                'retention_rate': self._safe_rate(retained_from_denominator_start, average_headcount),
                'early_attrition_3m_rate': self._safe_rate(early_departures_3m, len(hires)),
                'early_attrition_6m_rate': self._safe_rate(early_departures_6m, len(hires)),
                'early_departures_3m': early_departures_3m,
                'early_departures_6m': early_departures_6m,
                'monthly_attrition_rate': round(monthly_rate * 100, 1),
                'annualized_attrition_rate': round(turnover_rate * 12 / period_months, 1) if period_months else 0,
                'average_tenure_months': average_tenure_months,
            }

        by_department = [calculate_for_department(department) for department in departments]
        trend_qs = Employee.objects.filter(department__isnull=False).select_related('department')
        if department_id:
            trend_qs = trend_qs.filter(department_id=department_id)

        monthly_trends = []
        trend_cursor = denominator_start_date.replace(day=1)
        while trend_cursor <= end_date:
            month_start = max(trend_cursor, denominator_start_date)
            month_end = min(self._month_end(trend_cursor), end_date)
            month_days = max((month_end - month_start).days + 1, 1)
            month_count = max(month_days / 30.4375, 1)

            month_headcount_start = trend_qs.filter(self._active_on_date_q(month_start)).count()
            month_headcount_end = trend_qs.filter(self._active_on_date_q(month_end)).count()
            month_average_headcount = (month_headcount_start + month_headcount_end) / 2

            month_departures = list(trend_qs.filter(end_date__gte=month_start, end_date__lte=month_end))
            month_departure_count = len(month_departures)
            month_voluntary_departures = sum(
                1 for employee in month_departures if self._is_voluntary_departure(employee)
            )

            month_start_employee_ids = set(
                trend_qs.filter(self._active_on_date_q(month_start)).values_list('id', flat=True)
            )
            month_retained = trend_qs.filter(
                id__in=month_start_employee_ids
            ).filter(self._active_on_date_q(month_end)).count()

            month_hires = list(trend_qs.filter(start_date__gte=month_start, start_date__lte=month_end))
            month_early_departures_3m = 0
            month_early_departures_6m = 0
            for employee in month_hires:
                if not employee.start_date or not employee.end_date:
                    continue
                if employee.end_date <= self._add_months(employee.start_date, 3):
                    month_early_departures_3m += 1
                if employee.end_date <= self._add_months(employee.start_date, 6):
                    month_early_departures_6m += 1

            month_tenure_days = [
                max((month_end - employee.start_date).days, 0)
                for employee in trend_qs.filter(self._active_on_date_q(month_end), start_date__isnull=False)
            ]
            month_average_tenure = (
                round((sum(month_tenure_days) / len(month_tenure_days)) / 30.4375, 1)
                if month_tenure_days else 0
            )
            month_turnover_rate = self._safe_rate(month_departure_count, month_average_headcount)
            month_rate = (
                month_departure_count / month_average_headcount / month_count
                if month_average_headcount else 0
            )

            monthly_trends.append({
                'month': month_start.strftime('%Y-%m'),
                'label': f'{month_start.month:02d}/{month_start.year}',
                'headcount_start': month_headcount_start,
                'headcount_end': month_headcount_end,
                'average_headcount': round(month_average_headcount, 1),
                'departures': month_departure_count,
                'voluntary_departures': month_voluntary_departures,
                'hires': len(month_hires),
                'retained_from_start': month_retained,
                'turnover_rate': month_turnover_rate,
                'voluntary_turnover_rate': self._safe_rate(month_voluntary_departures, month_average_headcount),
                'retention_rate': self._safe_rate(month_retained, month_average_headcount),
                'early_attrition_3m_rate': self._safe_rate(month_early_departures_3m, len(month_hires)),
                'early_attrition_6m_rate': self._safe_rate(month_early_departures_6m, len(month_hires)),
                'monthly_attrition_rate': round(month_rate * 100, 1),
                'annualized_attrition_rate': round(month_turnover_rate * 12 / month_count, 1) if month_count else 0,
                'average_tenure_months': month_average_tenure,
            })

            trend_cursor = self._add_months(trend_cursor, 1)

        company_row = {
            'department_id': None,
            'department_name': 'Toàn công ty',
            'department_code': '',
        }
        numeric_fields = (
            'headcount_start', 'headcount_end', 'departures', 'voluntary_departures',
            'hires', 'retained_from_start', 'retained_from_denominator_start',
            'early_departures_3m', 'early_departures_6m',
        )
        for field in numeric_fields:
            company_row[field] = sum(row[field] for row in by_department)
        company_average_headcount = sum(row['average_headcount'] for row in by_department)
        company_monthly_rate = (
            company_row['departures'] / company_average_headcount / period_months
            if company_average_headcount else 0
        )
        all_tenure_months = [
            (row['average_tenure_months'], row['headcount_end']) for row in by_department
            if row['average_tenure_months'] > 0 and row['headcount_end'] > 0
        ]
        company_average_tenure_months = (
            sum(months * headcount for months, headcount in all_tenure_months) /
            sum(headcount for _, headcount in all_tenure_months)
        ) if all_tenure_months else 0
        company_row.update({
            'average_headcount': round(company_average_headcount, 1),
            'turnover_rate': self._safe_rate(company_row['departures'], company_average_headcount),
            'voluntary_turnover_rate': self._safe_rate(company_row['voluntary_departures'], company_average_headcount),
            'retention_rate': self._safe_rate(company_row['retained_from_denominator_start'], company_average_headcount),
            'early_attrition_3m_rate': self._safe_rate(company_row['early_departures_3m'], company_row['hires']),
            'early_attrition_6m_rate': self._safe_rate(company_row['early_departures_6m'], company_row['hires']),
            'monthly_attrition_rate': round(company_monthly_rate * 100, 1),
            'annualized_attrition_rate': round(
                self._safe_rate(company_row['departures'], company_average_headcount) * 12 / period_months,
                1
            ) if period_months else 0,
            'average_tenure_months': round(company_average_tenure_months, 1),
        })

        return {
            'summary': company_row,
            'by_department': sorted(by_department, key=lambda item: item['turnover_rate'], reverse=True),
            'monthly_trends': monthly_trends,
            'filters': {
                'start_date': start_date.isoformat(),
                'end_date': end_date.isoformat(),
                'department_id': department_id,
                'all_time': all_time,
                'denominator_start_date': denominator_start_date.isoformat(),
                'denominator_end_date': end_date.isoformat(),
            }
        }

    def _build_recruitment_stats(self, request, today):
        all_time = self._is_truthy(request.query_params.get('all_time'))
        start_date = None if all_time else self._parse_date_param(request.query_params.get('start_date'), 'start_date')
        end_date = self._parse_date_param(request.query_params.get('end_date'), 'end_date')
        if start_date and end_date and start_date > end_date:
            raise ValueError('start_date must be before or equal to end_date')

        department_id = request.query_params.get('department_id') or request.query_params.get('department')
        recruitment_qs = Employee.objects.filter(start_date__isnull=False).select_related(
            'department', 'position', 'onboarding_process__created_by'
        )
        if start_date:
            recruitment_qs = recruitment_qs.filter(start_date__gte=start_date)
        if end_date:
            recruitment_qs = recruitment_qs.filter(start_date__lte=end_date)
        if department_id:
            try:
                recruitment_qs = recruitment_qs.filter(department_id=int(department_id))
            except (TypeError, ValueError):
                raise ValueError('department_id must be an integer')

        official_contract_qs = Employee.objects.filter(
            contract_type='ONE_YEAR',
            contract_start_date__isnull=False,
        ).select_related('department', 'position', 'onboarding_process__created_by')
        if start_date:
            official_contract_qs = official_contract_qs.filter(contract_start_date__gte=start_date)
        if end_date:
            official_contract_qs = official_contract_qs.filter(contract_start_date__lte=end_date)
        if department_id:
            official_contract_qs = official_contract_qs.filter(department_id=int(department_id))

        summary = {
            'total_hired': 0,
            'currently_working': 0,
            'left_within_3_days': 0,
            'left_from_4_to_7_days': 0,
            'left_after_7_days': 0,
            'passed_7_days': 0,
            'passed_1_month': 0,
            'pass_probation': 0,
            'official_contracts': 0,
        }
        by_position = defaultdict(lambda: {
            'position_id': None,
            'position_title': 'Chưa có vị trí',
            'position_code': '',
            'hired_count': 0,
            'currently_working': 0,
            'left_within_3_days': 0,
            'left_from_4_to_7_days': 0,
            'passed_7_days': 0,
            'passed_1_month': 0,
            'pass_probation': 0,
            'employees': [],
        })
        by_department = defaultdict(lambda: {
            'department_id': None,
            'department_name': 'Chưa có phòng ban',
            'department_code': '',
            'hired_count': 0,
            'left_within_7_days': 0,
            'left_within_1_month': 0,
            'left_within_2_months': 0,
            'early_turnover_rate': 0,
        })
        monthly_cohorts = defaultdict(lambda: {
            'month': '',
            'hired_count': 0,
            'currently_working': 0,
            'left_within_7_days': 0,
            'passed_7_days': 0,
            'passed_1_month': 0,
            'pass_probation': 0,
            'official_contracts': 0,
            'pass_rate': 0,
        })
        by_recruiter = defaultdict(lambda: {
            'recruiter_id': None,
            'recruiter_name': 'Chưa xác định',
            'candidate_count': 0,
        })
        by_recruiter_position = defaultdict(lambda: {
            'recruiter_id': None,
            'recruiter_name': 'Chưa xác định',
            'hired_count': 0,
            'passed_3_days': 0,
            'passed_7_days': 0,
            'passed_1_month': 0,
            'official_contracts': 0,
            'employees': [],
        })
        recruiter_positions_raw = defaultdict(lambda: defaultdict(lambda: {
            'position_id': None,
            'position_title': 'Chưa có vị trí',
            'hired_count': 0,
            'employees': [],
        }))
        terminated_days = []
        employee_lists = {
            'total_hired': [],
            'currently_working': [],
            'left_within_3_days': [],
            'left_from_4_to_7_days': [],
            'left_after_7_days': [],
            'passed_7_days': [],
            'passed_1_month': [],
            'pass_probation': [],
            'official_contracts': [],
        }

        onboarding_qs = OnboardingProcess.objects.select_related('created_by')
        if start_date:
            onboarding_qs = onboarding_qs.filter(start_date__gte=start_date)
        if end_date:
            onboarding_qs = onboarding_qs.filter(start_date__lte=end_date)
        if department_id:
            onboarding_qs = onboarding_qs.filter(department_id=int(department_id))

        for onboarding in onboarding_qs:
            recruiter = onboarding.created_by
            recruiter_key = recruiter.id if recruiter else 'none'
            recruiter_row = by_recruiter[recruiter_key]
            if recruiter:
                recruiter_row['recruiter_id'] = recruiter.id
                recruiter_row['recruiter_name'] = recruiter.full_name
            recruiter_row['candidate_count'] += 1

        def is_currently_working(employee):
            return (
                employee.is_active
                and employee.employment_status not in ('SUSPENDED', 'PAUSED')
                and (employee.end_date is None or employee.end_date > today)
            )

        def serialize_employee(employee):
            onboarding = getattr(employee, 'onboarding_process', None)
            recruiter = onboarding.created_by if onboarding else None
            return {
                'id': employee.id,
                'employee_code': employee.employee_id,
                'full_name': employee.full_name,
                'start_date': employee.start_date.isoformat() if employee.start_date else None,
                'end_date': employee.end_date.isoformat() if employee.end_date else None,
                'contract_start_date': employee.contract_start_date.isoformat() if employee.contract_start_date else None,
                'contract_type': employee.contract_type or '',
                'department_name': employee.department.name if employee.department else '',
                'position_title': employee.position.title if employee.position else '',
                'is_currently_working': is_currently_working(employee),
                'recruiter_employee_id': recruiter.employee_id if recruiter else None,
                'recruiter_full_name': recruiter.full_name if recruiter else None,
            }

        for employee in official_contract_qs:
            employee_data = serialize_employee(employee)
            summary['official_contracts'] += 1
            employee_lists['official_contracts'].append(employee_data)

            contract_month = employee.contract_start_date.strftime('%Y-%m')
            contract_cohort = monthly_cohorts[contract_month]
            contract_cohort['month'] = contract_month
            contract_cohort['official_contracts'] += 1

        for employee in recruitment_qs:
            employee_data = serialize_employee(employee)
            summary['total_hired'] += 1
            employee_lists['total_hired'].append(employee_data)
            position_key = employee.position_id or 'none'
            position_row = by_position[position_key]
            if employee.position:
                position_row['position_id'] = employee.position_id
                position_row['position_title'] = employee.position.title
                position_row['position_code'] = employee.position.code
            position_row['hired_count'] += 1
            position_row['employees'].append(employee_data)

            department_key = employee.department_id or 'none'
            department_row = by_department[department_key]
            if employee.department:
                department_row['department_id'] = employee.department_id
                department_row['department_name'] = employee.department.name
                department_row['department_code'] = employee.department.code
            department_row['hired_count'] += 1

            onboarding = getattr(employee, 'onboarding_process', None)
            recruiter = onboarding.created_by if onboarding else None
            recruiter_position_key = recruiter.id if recruiter else 'none'
            recruiter_position_row = by_recruiter_position[recruiter_position_key]
            if recruiter:
                recruiter_position_row['recruiter_id'] = recruiter.id
                recruiter_position_row['recruiter_name'] = recruiter.full_name
            recruiter_position_row['hired_count'] += 1
            recruiter_position_row['employees'].append(employee_data)
            if employee.contract_type == 'ONE_YEAR' and employee.contract_start_date is not None:
                recruiter_position_row['official_contracts'] += 1

            recruiter_position_detail = recruiter_positions_raw[recruiter_position_key][position_key]
            if employee.position:
                recruiter_position_detail['position_id'] = employee.position_id
                recruiter_position_detail['position_title'] = employee.position.title
            recruiter_position_detail['hired_count'] += 1
            recruiter_position_detail['employees'].append(employee_data)

            cohort_key = employee.start_date.strftime('%Y-%m')
            cohort_row = monthly_cohorts[cohort_key]
            cohort_row['month'] = cohort_key
            cohort_row['hired_count'] += 1
            if is_currently_working(employee):
                summary['currently_working'] += 1
                position_row['currently_working'] += 1
                cohort_row['currently_working'] += 1
                employee_lists['currently_working'].append(employee_data)

            days_worked = None
            if employee.end_date:
                days_worked = max((employee.end_date - employee.start_date).days + 1, 0)
                terminated_days.append(days_worked)

            if days_worked is not None and days_worked <= 3:
                summary['left_within_3_days'] += 1
                position_row['left_within_3_days'] += 1
                employee_lists['left_within_3_days'].append(employee_data)
            elif days_worked is not None and days_worked <= 7:
                summary['left_from_4_to_7_days'] += 1
                position_row['left_from_4_to_7_days'] += 1
                employee_lists['left_from_4_to_7_days'].append(employee_data)
            elif days_worked is not None:
                summary['left_after_7_days'] += 1
                employee_lists['left_after_7_days'].append(employee_data)

            three_day_pass_date = employee.start_date + timedelta(days=3)
            passed_3_days = (
                (employee.end_date is not None and employee.end_date >= three_day_pass_date)
                or (employee.end_date is None and today >= three_day_pass_date)
            )
            if passed_3_days:
                recruiter_position_row['passed_3_days'] += 1

            seven_day_pass_date = employee.start_date + timedelta(days=7)
            left_within_7_days = days_worked is not None and days_worked <= 7
            if left_within_7_days:
                department_row['left_within_7_days'] += 1
                cohort_row['left_within_7_days'] += 1

            passed_7_days = (
                (employee.end_date is not None and employee.end_date >= seven_day_pass_date)
                or (employee.end_date is None and today >= seven_day_pass_date)
            )
            if passed_7_days:
                summary['passed_7_days'] += 1
                position_row['passed_7_days'] += 1
                cohort_row['passed_7_days'] += 1
                employee_lists['passed_7_days'].append(employee_data)
                recruiter_position_row['passed_7_days'] += 1

            one_month_pass_date = self._add_months(employee.start_date, 1)
            if employee.end_date is not None and employee.end_date < one_month_pass_date:
                department_row['left_within_1_month'] += 1

            passed_1_month = (
                (employee.end_date is not None and employee.end_date >= one_month_pass_date)
                or (employee.end_date is None and today >= one_month_pass_date)
            )
            if passed_1_month:
                summary['passed_1_month'] += 1
                position_row['passed_1_month'] += 1
                cohort_row['passed_1_month'] += 1
                employee_lists['passed_1_month'].append(employee_data)
                recruiter_position_row['passed_1_month'] += 1

            probation_pass_date = self._add_months(employee.start_date, 2)
            if employee.end_date is not None and employee.end_date < probation_pass_date:
                department_row['left_within_2_months'] += 1

            passed_probation = (
                (employee.end_date is not None and employee.end_date >= probation_pass_date)
                or (employee.end_date is None and today >= probation_pass_date)
            )
            if passed_probation:
                summary['pass_probation'] += 1
                position_row['pass_probation'] += 1
                cohort_row['pass_probation'] += 1
                employee_lists['pass_probation'].append(employee_data)

        for row in by_department.values():
            if row['hired_count']:
                row['early_turnover_rate'] = round(row['left_within_7_days'] * 100 / row['hired_count'], 1)

        for row in by_position.values():
            hired_count = row['hired_count'] or 0
            left_within_7_days = row['left_within_3_days'] + row['left_from_4_to_7_days']
            row['left_within_7_days'] = left_within_7_days
            row['early_turnover_rate'] = round(left_within_7_days * 100 / hired_count, 1) if hired_count else 0
            row['pass_rate'] = round(row['pass_probation'] * 100 / hired_count, 1) if hired_count else 0

        for row in monthly_cohorts.values():
            if row['hired_count']:
                row['pass_rate'] = round(row['pass_probation'] * 100 / row['hired_count'], 1)

        for recruiter_key, row in by_recruiter_position.items():
            row['positions'] = sorted(
                recruiter_positions_raw[recruiter_key].values(),
                key=lambda item: item['hired_count'],
                reverse=True,
            )

        avg_days_before_exit = round(sum(terminated_days) / len(terminated_days), 1) if terminated_days else 0

        position_stats = sorted(
            by_position.values(),
            key=lambda item: item['hired_count'],
            reverse=True
        )
        department_stats = sorted(
            by_department.values(),
            key=lambda item: item['early_turnover_rate'],
            reverse=True
        )
        risky_positions = sorted(
            [item for item in by_position.values() if item['hired_count'] > 0],
            key=lambda item: (item['early_turnover_rate'], item['left_within_7_days'], item['hired_count']),
            reverse=True
        )
        cohort_stats = sorted(monthly_cohorts.values(), key=lambda item: item['month'])
        recruiter_stats = sorted(
            by_recruiter.values(),
            key=lambda item: item['candidate_count'],
            reverse=True,
        )
        recruiter_position_stats = sorted(
            by_recruiter_position.values(),
            key=lambda item: item['hired_count'],
            reverse=True,
        )

        department = None
        if department_id:
            department_obj = Department.objects.filter(id=department_id).first()
            if department_obj:
                department = {
                    'id': department_obj.id,
                    'name': department_obj.name,
                    'code': department_obj.code,
                }

        return {
            **summary,
            'avg_days_before_exit': avg_days_before_exit,
            'by_position': position_stats,
            'by_department': department_stats,
            'risky_positions': risky_positions,
            'monthly_cohorts': cohort_stats,
            'by_recruiter': recruiter_stats,
            'by_recruiter_position': recruiter_position_stats,
            'total_candidates': sum(item['candidate_count'] for item in recruiter_stats),
            'employee_lists': employee_lists,
            'filters': {
                'start_date': start_date.isoformat() if start_date else None,
                'end_date': end_date.isoformat() if end_date else None,
                'department_id': int(department_id) if department_id else None,
                'department': department,
                'all_time': all_time,
            }
        }

    def _build_social_insurance_stats(self, request, today):
        all_time = self._is_truthy(request.query_params.get('all_time'))
        start_date = None if all_time else self._parse_date_param(request.query_params.get('start_date'), 'start_date')
        end_date = self._parse_date_param(request.query_params.get('end_date'), 'end_date') or today
        if start_date and start_date > end_date:
            raise ValueError('start_date must be before or equal to end_date')

        department_id = request.query_params.get('department_id') or request.query_params.get('department')
        if department_id:
            try:
                department_id = int(department_id)
            except (TypeError, ValueError):
                raise ValueError('department_id must be an integer')

        qs = Employee.objects.filter(is_active=True).select_related('department')
        if department_id:
            qs = qs.filter(department_id=department_id)

        total_active = qs.count()
        participating_qs = qs.filter(social_insurance_participation_status='PARTICIPATING')
        not_participating = qs.filter(social_insurance_participation_status='NOT_PARTICIPATING').count()
        suspended = qs.filter(social_insurance_participation_status='SUSPENDED').count()
        unspecified = qs.filter(
            models.Q(social_insurance_participation_status__isnull=True) |
            models.Q(social_insurance_participation_status='')
        ).count()
        missing_number = qs.filter(
            models.Q(social_insurance_number__isnull=True) |
            models.Q(social_insurance_number='')
        ).count()
        missing_tax_code = qs.filter(
            models.Q(tax_code__isnull=True) |
            models.Q(tax_code='')
        ).count()
        missing_household_code = qs.filter(
            models.Q(household_code__isnull=True) |
            models.Q(household_code='')
        ).count()
        missing_contribution = participating_qs.filter(
            models.Q(social_insurance_contribution_level__isnull=True) |
            models.Q(social_insurance_contribution_level__lte=0)
        ).count()
        total_contribution_level = participating_qs.aggregate(
            total=models.Sum('social_insurance_contribution_level')
        )['total'] or 0
        participating = participating_qs.count()

        upcoming_end_qs = qs.filter(
            social_insurance_end_date__isnull=False,
            social_insurance_end_date__gte=today,
            social_insurance_end_date__lte=today + timedelta(days=30),
        )
        overdue_end_qs = qs.filter(
            social_insurance_participation_status='PARTICIPATING',
            social_insurance_end_date__isnull=False,
            social_insurance_end_date__lt=today,
        )

        new_participation_qs = qs.filter(social_insurance_start_date__isnull=False)
        if start_date:
            new_participation_qs = new_participation_qs.filter(social_insurance_start_date__gte=start_date)
        if end_date:
            new_participation_qs = new_participation_qs.filter(social_insurance_start_date__lte=end_date)

        departments = Department.objects.all().order_by('name')
        if department_id:
            departments = departments.filter(id=department_id)

        by_department = []
        for dept in departments:
            dept_qs = qs.filter(department=dept)
            active_count = dept_qs.count()
            if active_count <= 0:
                continue

            dept_participating_qs = dept_qs.filter(social_insurance_participation_status='PARTICIPATING')
            dept_participating = dept_participating_qs.count()
            dept_total_contribution = dept_participating_qs.aggregate(
                total=models.Sum('social_insurance_contribution_level')
            )['total'] or 0
            by_department.append({
                'department_id': dept.id,
                'department_name': dept.name,
                'department_code': dept.code,
                'active_count': active_count,
                'participating': dept_participating,
                'not_participating': dept_qs.filter(social_insurance_participation_status='NOT_PARTICIPATING').count(),
                'suspended': dept_qs.filter(social_insurance_participation_status='SUSPENDED').count(),
                'unspecified': dept_qs.filter(
                    models.Q(social_insurance_participation_status__isnull=True) |
                    models.Q(social_insurance_participation_status='')
                ).count(),
                'missing_number': dept_qs.filter(
                    models.Q(social_insurance_number__isnull=True) |
                    models.Q(social_insurance_number='')
                ).count(),
                'missing_tax_code': dept_qs.filter(
                    models.Q(tax_code__isnull=True) |
                    models.Q(tax_code='')
                ).count(),
                'missing_household_code': dept_qs.filter(
                    models.Q(household_code__isnull=True) |
                    models.Q(household_code='')
                ).count(),
                'missing_contribution': dept_participating_qs.filter(
                    models.Q(social_insurance_contribution_level__isnull=True) |
                    models.Q(social_insurance_contribution_level__lte=0)
                ).count(),
                'contribution_level_total': float(dept_total_contribution),
                'participation_rate': self._safe_rate(dept_participating, active_count),
            })

        return {
            'summary': {
                'total_active': total_active,
                'participating': participating,
                'not_participating': not_participating,
                'suspended': suspended,
                'unspecified': unspecified,
                'missing_number': missing_number,
                'missing_tax_code': missing_tax_code,
                'missing_household_code': missing_household_code,
                'missing_contribution': missing_contribution,
                'new_participation_in_period': new_participation_qs.count(),
                'upcoming_end_30_days': upcoming_end_qs.count(),
                'overdue_end': overdue_end_qs.count(),
                'participation_rate': self._safe_rate(participating, total_active),
                'contribution_level_total': float(total_contribution_level),
                'contribution_level_average': float(total_contribution_level / participating) if participating else 0,
            },
            'by_department': sorted(
                by_department,
                key=lambda item: (
                    item['missing_number'] +
                    item['missing_tax_code'] +
                    item['missing_household_code'] +
                    item['missing_contribution'],
                    item['active_count'],
                ),
                reverse=True
            ),
            'filters': {
                'start_date': start_date.isoformat() if start_date else None,
                'end_date': end_date.isoformat() if end_date else None,
                'department_id': department_id,
                'all_time': all_time,
            }
        }
    
    def get(self, request):
        """
        Get comprehensive dashboard statistics
        """
        try:
            from users.utils import get_user_role
            is_admin = get_user_role(request.user) == 'admin'
        except Exception:
            is_admin = bool(getattr(request.user, 'is_superuser', False) or getattr(request.user, 'is_staff', False))

        today = timezone.now().date()
        suspended_statuses = ['SUSPENDED', 'PAUSED']

        active_employee_queryset = Employee.objects.exclude(
            employment_status__in=suspended_statuses
        ).filter(
            is_active=True
        ).filter(
            models.Q(end_date__isnull=True) | models.Q(end_date__gt=today)
        )

        try:
            recruitment_stats = self._build_recruitment_stats(request, today)
            attrition_stats = self._build_attrition_stats(request, today)
            social_insurance_stats = self._build_social_insurance_stats(request, today)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Employee statistics
        total_employees = Employee.objects.count()
        active_employees = active_employee_queryset.count()
        # "Thử việc" = người đang làm việc còn thử việc, khớp trang Quản lý nhân viên.
        probation_employees = active_employee_queryset.filter(_probation_q(today)).count()
        inactive_employees = Employee.objects.filter(employment_status='INACTIVE').count()
        
        # Employee growth (last 30 days)
        thirty_days_ago = timezone.now() - timedelta(days=30)
        new_employees_30_days = Employee.objects.filter(
            created_at__gte=thirty_days_ago
        ).count()
        
        # Department statistics — chỉ đếm nhân viên đang làm việc (ACTIVE)
        departments = Department.objects.all()
        department_stats = []
        basic_salary_fund_by_department = []
        for dept in departments:
            dept_active_qs = active_employee_queryset.filter(department=dept)
            count = dept_active_qs.count()
            if count > 0:
                department_stats.append({
                    'id': dept.id,
                    'name': dept.name,
                    'code': dept.code,
                    'employee_count': count
                })
                if is_admin:
                    basic_salary_total = dept_active_qs.aggregate(
                        total=models.Sum('basic_salary')
                    )['total'] or 0
                    basic_salary_fund_by_department.append({
                        'id': dept.id,
                        'name': dept.name,
                        'code': dept.code,
                        'employee_count': count,
                        'basic_salary_total': float(basic_salary_total),
                    })
        
        # Asset statistics
        total_assets = Asset.objects.count()
        assets_in_use = Asset.objects.filter(status='IN_USE').count()
        assets_idle = Asset.objects.filter(status='IDLE').count()
        assets_under_maintenance = Asset.objects.filter(status='UNDER_MAINTENANCE').count()
        
        # Asset value
        total_asset_value = Asset.objects.aggregate(
            total=models.Sum('purchase_price')
        )['total'] or 0
        
        # Current asset assignments
        current_assignments = AssetAssignmentHistory.objects.filter(
            returned_date__isnull=True
        ).count()
        
        # Upcoming maintenance
        thirty_days_later = timezone.now().date() + timedelta(days=30)
        upcoming_maintenance = AssetMaintenance.objects.filter(
            next_maintenance_date__isnull=False,
            next_maintenance_date__gte=timezone.now().date(),
            next_maintenance_date__lte=thirty_days_later
        ).count()
        
        # Recent activities (last 7 days)
        # Dùng created_at (DateTimeField) cho assignment/maintenance để tránh lỗi so sánh datetime vs DateField
        # Dùng returned_date (DateField) cho returns, phải convert sang date()
        seven_days_ago = timezone.now() - timedelta(days=7)
        seven_days_ago_date = seven_days_ago.date()

        recent_asset_assignments = AssetAssignmentHistory.objects.filter(
            created_at__gte=seven_days_ago
        ).exclude(status='RETURNED').count()

        recent_asset_returns = AssetAssignmentHistory.objects.filter(
            returned_date__isnull=False,
            returned_date__gte=seven_days_ago_date
        ).count()

        recent_maintenance = AssetMaintenance.objects.filter(
            created_at__gte=seven_days_ago
        ).count()
        
        # Gender statistics
        male_count = Employee.objects.filter(gender='M').count()
        female_count = Employee.objects.filter(gender='F').count()
        other_count = Employee.objects.filter(gender='O').count()
        
        # Asset type distribution (cả loại gõ tự do)
        asset_type_stats = [
            {'type': value, 'display_name': label, 'count': count}
            for value, label, count in _asset_type_counts(Asset.objects.all())
        ]
        
        # Recent hires (last 30 days)
        recent_hires = Employee.objects.filter(
            start_date__gte=thirty_days_ago.date()
        ).count()
        
        response_data = {
            'employee_stats': {
                'total': total_employees,
                'active': active_employees,
                'probation': probation_employees,
                'inactive': inactive_employees,
                'new_last_30_days': new_employees_30_days,
                'recent_hires': recent_hires,
                'gender_distribution': {
                    'male': male_count,
                    'female': female_count,
                    'other': other_count
                }
            },
            'department_stats': department_stats,
            'recruitment_stats': recruitment_stats,
            'attrition_stats': attrition_stats,
            'social_insurance_stats': social_insurance_stats,
            'asset_stats': {
                'total': total_assets,
                'in_use': assets_in_use,
                'idle': assets_idle,
                'under_maintenance': assets_under_maintenance,
                'total_value': float(total_asset_value),
                'current_assignments': current_assignments,
                'upcoming_maintenance': upcoming_maintenance,
                'type_distribution': asset_type_stats
            },
            'recent_activities': {
                'asset_assignments': recent_asset_assignments,
                'asset_returns': recent_asset_returns,
                'maintenance': recent_maintenance
            },
            'trends': {
                'employee_growth': new_employees_30_days,
                'asset_growth': Asset.objects.filter(
                    created_at__gte=thirty_days_ago
                ).count()
            }
        }

        if is_admin:
            response_data['basic_salary_fund_by_department'] = basic_salary_fund_by_department

        return Response(response_data)


# ======================
# ATTENDANCE VIEWSETS
# ======================

from .models import Attendance, AttendanceImportLog, LeaveRequest, _is_hr
from .serializers import (
    AttendanceSerializer, AttendanceListSerializer, 
    AttendanceImportLogSerializer, AttendanceStatsSerializer
)


class AttendanceViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing attendance records
    """
    queryset = Attendance.objects.all().order_by('-attendance_date', 'employee')
    serializer_class = AttendanceSerializer
    permission_classes = [IsAuthenticated, StaffOwnDataPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'employee', 'attendance_date', 'status', 'shift_type',
        'imported_from_file', 'import_batch'
    ]
    
    search_fields = [
        'employee__full_name', 'employee__employee_id',
        'attendance_code', 'notes'
    ]
    
    ordering_fields = [
        'attendance_date', 'check_in', 'check_out', 'working_hours',
        'created_at', 'updated_at'
    ]
    
    ordering = ['-attendance_date']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return AttendanceListSerializer
        return AttendanceSerializer

    # ------------------------------------------------------------------
    # Status / shift helpers
    # ------------------------------------------------------------------
    _STATUS_DISPLAY = {
        'PRESENT': 'Có mặt',
        'LATE': 'Đi muộn',
        'EARLY_LEAVE': 'Về sớm',
        'LATE_EARLY': 'Đi muộn/Về sớm',
        'ABSENT': 'Vắng mặt',
        'HALF_DAY': 'Nửa ngày',
        'INCOMPLETE_ATTENDANCE': 'Quên chấm công',
        'LEAVE': 'Nghỉ phép tháng',
        'HOLIDAY': 'Ngày lễ',
    }
    _SHIFT_DISPLAY = {
        'MORNING': 'Ca sáng',
        'AFTERNOON': 'Ca chiều',
        'EVENING': 'Ca tối',
        'FULL_DAY': 'Cả ngày',
        'NIGHT': 'Ca đêm',
    }

    @staticmethod
    def _get_user_roles(user):
        """Return (is_admin, is_hr) booleans for the given user."""
        is_admin = user.is_staff or user.is_superuser
        is_hr = False
        try:
            from users.utils import get_user_role
            role = get_user_role(user)
            if role == 'admin':
                is_admin = True
            elif role == 'hr':
                is_hr = True
        except ImportError:
            pass
        return is_admin, is_hr

    @staticmethod
    def _months_in_range(start, end):
        """Yield (year, month) tuples covering [start, end]."""
        y, m = start.year, start.month
        while (y, m) <= (end.year, end.month):
            yield y, m
            m += 1
            if m > 12:
                m = 1
                y += 1

    @staticmethod
    def _derive_status(agg_delta, agg_effects):
        """Map aggregated event-engine delta/effects to an Attendance status string."""
        vang_mat = agg_delta.get('vang_mat', 0)
        total_credits = agg_delta.get('nua_ngay_cong', 0.0) + agg_delta.get('ngay_du_cong', 0.0)

        # Trừ khi vắng sạch công, vắng mặt một phần sẽ được coi là đi muộn/về sớm (LATE_EARLY)
        # và được phân giải sau dựa trên số phút thực tế.
        if vang_mat > 0 and total_credits == 0:
            return 'ABSENT'

        if agg_delta.get('quen_cham_cong', 0) > 0:
            return 'INCOMPLETE_ATTENDANCE'

        if agg_effects.get('nghi_phep_thang', 0) > 0 or agg_effects.get('nghi_khong_luong', 0) > 0:
            return 'LEAVE'

        # Nếu có vi phạm đi muộn/về sớm HOẶC vắng mặt một phần (nhưng còn công)
        if agg_delta.get('di_muon_ve_som', 0) > 0 or vang_mat > 0:
            return 'LATE_EARLY'

        if total_credits >= 1.0:
            return 'PRESENT'
        if total_credits > 0:
            return 'HALF_DAY'

        return 'ABSENT'

    @staticmethod
    def _derive_shift_type(day_entries, day_all_events=None):
        """Infer shift_type from the rules applied in calendar entries.

        Ưu tiên rule chấm công thực tế (SHIFT_RULE_MORNING/AFTERNOON). Nhưng khi ngày đó
        không có rule chấm công nào áp dụng — ví dụ ngày nghỉ phép/giải trình thuần, không
        có check-in — thì KHÔNG được mặc định "Cả ngày": phải soi dữ liệu nửa ngày
        (is_half_day / expected_status == HALF_DAY) trên các EmployeeEvent liên quan trong
        ngày (leave_request, explanation, explanation_approval, online_work...), nếu không
        cột "Ca làm" sẽ mâu thuẫn với cột "Trạng thái" (vốn đọc đúng từ cùng nguồn công
        nua_ngay_cong qua _derive_status) trên cùng 1 dòng — đây chính là bug khiến "bảng
        chốt công" báo nửa ngày còn modal "Chi tiết ngày" báo cả ngày cho cùng 1 sự kiện.
        """
        rules_applied = [r for e in day_entries for r in e.get('rules_applied', [])]
        has_morning = any('MORNING' in r.get('rule_type', '') for r in rules_applied)
        has_afternoon = any('AFTERNOON' in r.get('rule_type', '') for r in rules_applied)
        if has_morning and has_afternoon:
            return 'FULL_DAY'
        if has_morning:
            return 'MORNING'
        if has_afternoon:
            return 'AFTERNOON'

        for ev in (day_all_events or []):
            data = getattr(ev, 'data', None) or {}
            is_half_day = bool(data.get('is_half_day')) or data.get('expected_status') == 'HALF_DAY'
            if not is_half_day:
                continue
            period = (data.get('half_day_period') or '').upper()
            if period in ('MORNING', 'AFTERNOON'):
                return period
            # Nửa ngày nhưng không rõ buổi sáng/chiều — vẫn không được mặc định "Cả ngày"
            return 'MORNING'

        return 'FULL_DAY'

    def _build_records_for_month(self, employee, year, month, start_date, end_date, EmployeeState, EmployeeEvent, cal_mod):
        """
        Run replay_month for one employee/month and return a list of daily attendance dicts
        covering the intersection of [start_date, end_date] and the given month.
        """
        from datetime import date as date_cls, datetime as dt_cls

        employee_code = employee.employee_id
        dept_name = employee.department.name if employee.department else None
        _reg_scope_cache: dict = {}
        _shift_by_date_cache: dict = {}

        try:
            result = EmployeeState.replay_month(employee_code, year, month)
        except Exception as exc:
            logger.warning("replay_month failed for %s %d/%d: %s", employee_code, year, month, exc)
            return []

        # Index calendar_result by date string
        calendar_by_date: dict = {}
        for entry in result.get('calendar', []):
            d = entry.get('date')
            if d:
                calendar_by_date.setdefault(d, []).append(entry)

        # Intersection of the month and requested date range
        month_start = date_cls(year, month, 1)
        month_end   = date_cls(year, month, cal_mod.monthrange(year, month)[1])
        range_start = max(month_start, start_date)
        range_end   = min(month_end,   end_date)

        # All events for the date range (used both for check_in/check_out and for the events list)
        all_events_qs = EmployeeEvent.objects.filter(
            employee=employee,
            event_date__gte=range_start,
            event_date__lte=range_end,
        ).order_by('event_date', 'created_at').select_related('created_by')

        attendance_events_by_date: dict = {}
        all_events_by_date: dict = {}
        for ev in all_events_qs:
            date_key = ev.event_date.isoformat()
            all_events_by_date.setdefault(date_key, []).append(ev)
            if ev.event_type == EmployeeEvent.EventType.ATTENDANCE:
                attendance_events_by_date.setdefault(date_key, []).append(ev)

        records = []
        cur = range_start
        while cur <= range_end:
            day_str     = cur.isoformat()
            day_entries = calendar_by_date.get(day_str, [])
            day_ev_list = attendance_events_by_date.get(day_str, [])

            # Aggregate delta + effects from all event-engine entries for this day
            agg_delta:   dict = {}
            agg_effects: dict = {}
            for entry in day_entries:
                for k, v in (entry.get('delta') or {}).items():
                    agg_delta[k] = agg_delta.get(k, 0) + v
                for k, v in (entry.get('effects') or {}).items():
                    agg_effects[k] = agg_effects.get(k, 0) + v

            # Skip days with no events at all
            day_all_events = all_events_by_date.get(day_str, [])
            if not day_entries and not day_ev_list and not day_all_events:
                if cur.weekday() >= 5:   # weekend → skip silently
                    cur += timedelta(days=1)
                    continue
                # Weekday with no events → ABSENT
                status_val    = 'ABSENT'
                check_in_val  = None
                check_out_val = None
                shift_type    = 'FULL_DAY'
                working_hours    = 0.0
                overtime_hours   = 0.0
                late_minutes     = 0
                early_leave_mins = 0
            else:
                status_val = self._derive_status(agg_delta, agg_effects)
                shift_type = self._derive_shift_type(day_entries, day_all_events)

                # check_in / check_out – prefer raw EmployeeEvent, fallback to calendar entry
                check_in_val  = None
                check_out_val = None
                if day_ev_list:
                    # Nếu ngày có mobile GPS event thì ưu tiên hiển thị mobile, fallback về device
                    mobile_ev = [ev for ev in day_ev_list if ev.checkin_is_valid is True]
                    source_ev = mobile_ev if mobile_ev else day_ev_list
                    all_ci = [ev.check_in for ev in source_ev if ev.check_in]
                    all_co = [ev.check_out for ev in source_ev if ev.check_out]
                    check_in_val  = str(min(all_ci))[:5] if all_ci else None
                    check_out_val = str(max(all_co))[:5] if all_co else None
                elif day_entries:
                    check_in_val  = day_entries[0].get('check_in')
                    check_out_val = day_entries[-1].get('check_out')

                # working_hours from check times
                working_hours = 0.0
                if check_in_val and check_out_val:
                    try:
                        ci = dt_cls.strptime(check_in_val,  '%H:%M')
                        co = dt_cls.strptime(check_out_val, '%H:%M')
                        working_hours = max(0.0, (co - ci).total_seconds() / 3600)
                    except ValueError:
                        pass

                overtime_hours   = float(agg_effects.get('tang_ca', 0) + agg_effects.get('lam_them_gio', 0))
                
                # ── 5. Late / Early mins fallback calculation ────────────────
                late_minutes     = int(agg_effects.get('late_minutes', 0))
                early_leave_mins = int(agg_effects.get('early_leave_minutes', 0))

                # Nếu engine không trả về phút cụ thể nhưng có attendance event, tự tính
                if late_minutes == 0 and early_leave_mins == 0:
                    from .shift_config_utils import (
                        load_shift_configs_for_employee, get_registered_shift_configs_for_date,
                    )

                    # Phải tự tính theo ĐÚNG ca mà engine dùng cho ngày này: ca đã
                    # ĐĂNG KÝ (Ca 2...) trước, rồi ca cố định giải theo ĐÚNG NGÀY.
                    # Trước đây lấy ca cố định của NGÀY 01 THÁNG, nên đúng những
                    # ngày engine trả 0 vì không vi phạm (Ca 2 đã duyệt, đổi ca
                    # giữa tháng) lại bị hiện ra số phút muộn/sớm sai — vd
                    # NV80034 25/09/2026 Ca 2 đã duyệt hiện "muộn 102 phút" dù
                    # phạt 0đ; NV80010 23-24/09 hiện "về sớm 24-30 phút".
                    try:
                        registered = get_registered_shift_configs_for_date(employee, cur, _reg_scope_cache)
                    except Exception:
                        registered = None
                    shift_config_objs = registered or load_shift_configs_for_employee(
                        employee_code, cur, _shift_by_date_cache,
                    )
                    att_ev = next((ev for ev in day_ev_list if ev.event_type == EmployeeEvent.EventType.ATTENDANCE), None)
                    if att_ev and shift_config_objs:
                        try:
                            s = min(sc.start_time for sc in shift_config_objs if sc.start_time)
                            e = max(sc.end_time   for sc in shift_config_objs if sc.end_time)
                            if att_ev.check_in and att_ev.check_in > s:
                                late_minutes = (dt_cls.combine(cur, att_ev.check_in) - dt_cls.combine(cur, s)).seconds // 60
                            if att_ev.check_out and att_ev.check_out < e:
                                early_leave_mins = (dt_cls.combine(cur, e) - dt_cls.combine(cur, att_ev.check_out)).seconds // 60
                        except Exception:
                            pass

                # Resolve LATE_EARLY if only one exists or keep both if both > 0
                if status_val == "LATE_EARLY":
                    if late_minutes > 0 and early_leave_mins > 0:
                        pass # keep LATE_EARLY
                    elif late_minutes > 0:
                        status_val = "LATE"
                    elif early_leave_mins > 0:
                        status_val = "EARLY_LEAVE"

            penalty_amount = float(agg_delta.get('tong_phat', 0))

            records.append({
                'id': None,
                'attendance_code': None,
                'employee_name':   employee.full_name,
                'employee_code':   employee_code,
                'attendance_date': day_str,
                'check_in':        check_in_val,
                'check_out':       check_out_val,
                'status':          status_val,
                'status_display':  self._STATUS_DISPLAY.get(status_val, status_val),
                'shift_type':      shift_type,
                'shift_type_display': self._SHIFT_DISPLAY.get(shift_type, shift_type),
                'working_hours':   round(working_hours, 2),
                'overtime_hours':  round(overtime_hours, 2),
                'late_minutes':    late_minutes,
                'early_leave_minutes': early_leave_mins,
                'penalty_amount':  penalty_amount,
                'late_penalty':    float(agg_effects.get('late_penalty', 0)),
                'early_leave_penalty': float(agg_effects.get('early_leave_penalty', 0)),
                'notes':           '',
                'department_name': dept_name,
                'events': [
                    {
                        'id':            ev.id,
                        'event_type':    ev.event_type,
                        'event_date':    ev.event_date.isoformat(),
                        'check_in':      str(ev.check_in)[:5] if ev.check_in else None,
                        'check_out':     str(ev.check_out)[:5] if ev.check_out else None,
                        'overtime_hours': float(ev.overtime_hours) if ev.overtime_hours is not None else None,
                        'explanation':   ev.explanation,
                        'notes':         ev.notes,
                        'status':        status_val if ev.event_type == 'attendance' else (ev.data or {}).get('status'),
                        'status_display': self._STATUS_DISPLAY.get(status_val) if ev.event_type == 'attendance' else None,
                        'data':          ev.data,
                        'created_at':    ev.created_at.isoformat(),
                        'created_by':    ev.created_by.full_name if ev.created_by else None,
                        'created_by_name': ev.created_by.full_name if ev.created_by else None,
                        'is_hr_created': _is_hr(ev.created_by) if ev.created_by else False,
                        'employee_is_hr': _is_hr(ev.employee) if ev.employee else False,
                    }
                    for ev in day_all_events
                ],
            })
            cur += timedelta(days=1)

        return records

    def list(self, request, *args, **kwargs):
        """
        Return attendance records computed via EmployeeState.replay_month()
        (event-driven engine) instead of querying the Attendance table directly.

        Query params:
          employee_id   – DB primary key of an Employee (admin/HR only)
          department_id – filter by department (admin/HR only)
          start_date    – YYYY-MM-DD (default: first day of current month)
          end_date      – YYYY-MM-DD (default: today)
        """
        import calendar as cal_mod
        from .main_api import EmployeeState
        from .event_models import EmployeeEvent
        from datetime import date, datetime

        # ── 1. Parse dates ───────────────────────────────────────────────
        today = date.today()
        try:
            sd = request.query_params.get('start_date')
            ed = request.query_params.get('end_date')
            start_date = datetime.strptime(sd, '%Y-%m-%d').date() if sd else today.replace(day=1)
            end_date   = datetime.strptime(ed, '%Y-%m-%d').date() if ed else today
        except ValueError:
            return Response({'error': 'Invalid date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

        # ── 2. Determine employees (with permission checks) ───────────────
        user = request.user
        is_admin, is_hr = self._get_user_roles(user)

        employee_id   = request.query_params.get('employee_id')
        department_id = request.query_params.get('department_id')

        current_user_employee = None
        try:
            current_user_employee = Employee.objects.get(user=user)
        except Employee.DoesNotExist:
            if not is_admin and not is_hr:
                return Response({'count': 0, 'next': None, 'previous': None, 'results': []})

        # scope=my_team: quản lý trực tiếp xem nhanh TOÀN BỘ cấp dưới trực
        # tiếp của mình mà không cần truyền employee_id từng người — luôn an
        # toàn (chỉ trả về đúng cấp dưới của chính request.user).
        scope = request.query_params.get('scope')

        if is_admin or is_hr:
            if employee_id:
                employees = list(Employee.objects.filter(id=employee_id))
            elif department_id:
                employees = list(Employee.objects.filter(department_id=department_id))
            elif scope == 'my_team' and current_user_employee:
                employees = list(Employee.objects.filter(manager=current_user_employee))
            else:
                employees = [current_user_employee] if current_user_employee else []
        else:
            # VÁ LỖ HỔNG + MỞ QUYỀN CHO QUẢN LÝ: trước đây nhánh này chỉ cho
            # xem đúng dữ liệu CHÍNH MÌNH — kể cả quản lý trực tiếp thật sự
            # cũng không xem được cấp dưới. Giờ dùng chung
            # can_view_employee_attendance (hrm/models.py): chính mình, quản
            # lý trực tiếp/cấp 2/cấp 3, hoặc trưởng phòng ban của người đó.
            from .models import can_view_employee_attendance
            if not current_user_employee:
                return Response({'count': 0, 'next': None, 'previous': None, 'results': []})
            if employee_id:
                target = Employee.objects.filter(id=employee_id).first()
                if not target or not can_view_employee_attendance(user, current_user_employee, target):
                    return Response({'count': 0, 'next': None, 'previous': None, 'results': []})
                employees = [target]
            elif department_id:
                dept = Department.objects.filter(id=department_id).first()
                if not dept or dept.manager_id != current_user_employee.id:
                    return Response({'count': 0, 'next': None, 'previous': None, 'results': []})
                employees = list(Employee.objects.filter(department_id=department_id))
            elif scope == 'my_team':
                employees = list(Employee.objects.filter(manager=current_user_employee))
            else:
                employees = [current_user_employee]

        # ── 3. Build attendance records via event engine ──────────────────
        all_records = []
        for employee in employees:
            if not employee:
                continue
            for year, month in self._months_in_range(start_date, end_date):
                all_records.extend(
                    self._build_records_for_month(
                        employee, year, month, start_date, end_date,
                        EmployeeState, EmployeeEvent, cal_mod,
                    )
                )

        # Sort by attendance_date descending, then employee_name
        all_records.sort(key=lambda x: (x['attendance_date'], x['employee_name']), reverse=True)

        # Tổng phạt trong khoảng thời gian được yêu cầu
        total_penalty_vnd = sum(r.get('penalty_amount', 0) for r in all_records)

        # ── 4. Paginate and return ────────────────────────────────────────
        page = self.paginate_queryset(all_records)
        if page is not None:
            response = self.get_paginated_response(page)
            response.data['total_penalty_vnd'] = total_penalty_vnd
            return response
        return Response({
            'count':             len(all_records),
            'next':              None,
            'previous':          None,
            'results':           all_records,
            'total_penalty_vnd': total_penalty_vnd,
        })

    def get_queryset(self):
        """
        Optionally filter by employee_id, department_id, or date range
        Also restrict staff users to only see their own records
        """
        queryset = super().get_queryset()
        
        # Get current user
        user = self.request.user
        
        # Check if user is a staff user (not admin, not HR)
        is_admin = user.is_staff or user.is_superuser
        
        # Check if user is HR
        is_hr = False
        try:
            from users.utils import get_user_role
            user_role = get_user_role(user)
            if user_role == 'admin':
                is_admin = True
            elif user_role == 'hr':
                is_hr = True
        except ImportError:
            pass
        
        # Get current user's employee record if exists
        current_user_employee = None
        try:
            current_user_employee = Employee.objects.get(user=user)
        except Employee.DoesNotExist:
            # If user doesn't have an employee record and is not admin/HR, they shouldn't see any attendance records
            if not is_admin and not is_hr:
                return queryset.none()
        
        # If user is not admin and not HR, restrict to only their own records
        if not is_admin and not is_hr and current_user_employee:
            queryset = queryset.filter(employee=current_user_employee)
        
        # Filter by employee_id (if provided and user has permission)
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            # Check if user has permission to view other employees' records
            if is_admin or is_hr:
                queryset = queryset.filter(employee_id=employee_id)
            elif current_user_employee:
                # Non-admin/non-HR users can only filter by their own employee_id
                if str(current_user_employee.id) == employee_id:
                    queryset = queryset.filter(employee_id=employee_id)
        
        # Filter by department_id (only for admin/HR users)
        department_id = self.request.query_params.get('department_id')
        if department_id and (is_admin or is_hr):
            queryset = queryset.filter(employee__department_id=department_id)
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                attendance_date__gte=start_date,
                attendance_date__lte=end_date
            )
        elif start_date:
            queryset = queryset.filter(attendance_date__gte=start_date)
        elif end_date:
            queryset = queryset.filter(attendance_date__lte=end_date)
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get attendance statistics with filtering options
        """
        # Get filter parameters
        employee_id = request.query_params.get('employee_id')
        department_id = request.query_params.get('department_id')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')

        # VÁ LỖ HỔNG: trước đây endpoint này KHÔNG hề kiểm tra quyền — bất kỳ
        # ai đã đăng nhập cũng truyền employee_id/department_id bất kỳ là lấy
        # được thống kê chấm công (số ngày phạt, đi muộn, vắng mặt...) của
        # người/phòng ban khác, hoặc không truyền gì cả thì lấy thống kê
        # TOÀN CÔNG TY. Dùng chung can_view_employee_attendance (hrm/models.py)
        # giống AttendanceViewSet.list()/AttendanceCalendarView.
        user = request.user
        is_admin, is_hr = self._get_user_roles(user)
        if not is_admin and not is_hr:
            from .models import can_view_employee_attendance
            current_user_employee = Employee.objects.filter(user=user).first()
            if not current_user_employee:
                return Response({
                    'filters': {'employee_id': employee_id, 'department_id': department_id, 'start_date': start_date, 'end_date': end_date},
                    'statistics': {'total_days': 0, 'status_summary': {}, 'total_working_hours': 0, 'total_overtime_hours': 0, 'total_late_minutes': 0, 'total_early_leave_minutes': 0},
                    'attendance_by_date': [], 'employees': []
                })
            if employee_id:
                target = Employee.objects.filter(id=employee_id).first()
                if not target or not can_view_employee_attendance(user, current_user_employee, target):
                    return Response({
                        'filters': {'employee_id': employee_id, 'department_id': department_id, 'start_date': start_date, 'end_date': end_date},
                        'statistics': {'total_days': 0, 'status_summary': {}, 'total_working_hours': 0, 'total_overtime_hours': 0, 'total_late_minutes': 0, 'total_early_leave_minutes': 0},
                        'attendance_by_date': [], 'employees': []
                    })
            elif department_id:
                # Department.manager hầu như không được gán trong dữ liệu
                # thực tế (xem EmployeeViewSet.get_queryset) nên nhánh này
                # với đa số quản lý trực tiếp sẽ luôn ra rỗng — an toàn (chưa
                # có nhu cầu FE dùng department_id ở đây cho người không phải
                # admin/HR, nên tạm chặn hẳn thay vì đoán 1 quy tắc mới).
                dept = Department.objects.filter(id=department_id).first()
                if not dept or dept.manager_id != current_user_employee.id:
                    return Response({
                        'filters': {'employee_id': employee_id, 'department_id': department_id, 'start_date': start_date, 'end_date': end_date},
                        'statistics': {'total_days': 0, 'status_summary': {}, 'total_working_hours': 0, 'total_overtime_hours': 0, 'total_late_minutes': 0, 'total_early_leave_minutes': 0},
                        'attendance_by_date': [], 'employees': []
                    })
            else:
                # Không truyền gì cả -> mặc định chỉ chính mình (trước đây sẽ
                # trả thống kê TOÀN CÔNG TY cho bất kỳ ai).
                employee_id = str(current_user_employee.id)

        # Set default date range if not provided (current month)
        if not start_date or not end_date:
            today = timezone.now().date()
            start_date = today.replace(day=1)
            # Last day of current month
            if today.month == 12:
                end_date = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                end_date = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
        
        # Build filter conditions
        filters = {
            'attendance_date__gte': start_date,
            'attendance_date__lte': end_date
        }
        
        if employee_id:
            filters['employee_id'] = employee_id
        
        if department_id:
            filters['employee__department_id'] = department_id
        
        # Get attendance records
        attendance_records = Attendance.objects.filter(**filters)
        
        # Calculate statistics
        total_days = attendance_records.count()
        
        # Count by status
        status_counts = attendance_records.values('status').annotate(
            count=models.Count('id')
        )
        status_summary = {item['status']: item['count'] for item in status_counts}
        
        # Calculate totals
        total_working_hours = attendance_records.aggregate(
            total=models.Sum('working_hours')
        )['total'] or 0
        
        total_overtime_hours = attendance_records.aggregate(
            total=models.Sum('overtime_hours')
        )['total'] or 0
        
        total_late_minutes = attendance_records.aggregate(
            total=models.Sum('late_minutes')
        )['total'] or 0
        
        total_early_leave_minutes = attendance_records.aggregate(
            total=models.Sum('early_leave_minutes')
        )['total'] or 0
        
        # Get attendance by date
        attendance_by_date = attendance_records.values('attendance_date').annotate(
            count=models.Count('id'),
            present=models.Count('id', filter=models.Q(status='PRESENT')),
            late=models.Count('id', filter=models.Q(status='LATE')),
            absent=models.Count('id', filter=models.Q(status='ABSENT')),
            early_leave=models.Count('id', filter=models.Q(status='EARLY_LEAVE')),
            half_day=models.Count('id', filter=models.Q(status='HALF_DAY'))
        ).order_by('attendance_date')
        
        # Get employee list for the selected department
        employees = []
        if department_id:
            employees = Employee.objects.filter(department_id=department_id).values(
                'id', 'full_name', 'employee_id'
            )
        elif employee_id:
            employee = Employee.objects.filter(id=employee_id).values(
                'id', 'full_name', 'employee_id'
            ).first()
            if employee:
                employees = [employee]
        
        return Response({
            'filters': {
                'employee_id': employee_id,
                'department_id': department_id,
                'start_date': start_date,
                'end_date': end_date
            },
            'statistics': {
                'total_days': total_days,
                'status_summary': status_summary,
                'total_working_hours': float(total_working_hours),
                'total_overtime_hours': float(total_overtime_hours),
                'total_late_minutes': total_late_minutes,
                'total_early_leave_minutes': total_early_leave_minutes
            },
            'attendance_by_date': list(attendance_by_date),
            'employees': list(employees)
        })
    
    @action(detail=False, methods=['get'])
    def calendar_view(self, request):
        """
        Get attendance data formatted for calendar view
        """
        # Get filter parameters
        employee_id = request.query_params.get('employee_id')
        department_id = request.query_params.get('department_id')
        year = request.query_params.get('year', timezone.now().year)
        month = request.query_params.get('month', timezone.now().month)
        
        # Get current user
        user = request.user
        
        # Check if user is a staff user (not admin, not HR)
        is_admin = user.is_staff or user.is_superuser
        
        # Check if user is HR
        is_hr = False
        try:
            from users.utils import get_user_role
            user_role = get_user_role(user)
            if user_role == 'admin':
                is_admin = True
            elif user_role == 'hr':
                is_hr = True
        except ImportError:
            pass
        
        # Get current user's employee record if exists
        current_user_employee = None
        try:
            current_user_employee = Employee.objects.get(user=user)
        except Employee.DoesNotExist:
            # If user doesn't have an employee record and is not admin/HR, they shouldn't see any attendance records
            if not is_admin and not is_hr:
                return Response({
                    'year': year,
                    'month': month,
                    'start_date': None,
                    'end_date': None,
                    'calendar_data': [],
                    'employees': []
                })
        
        # Build filter conditions
        filters = {}
        
        # Filter by employee_id (if provided and user has permission)
        if employee_id:
            # Check if user has permission to view other employees' records
            if is_admin or is_hr:
                filters['employee_id'] = employee_id
            elif current_user_employee:
                # Non-admin/non-HR users can only filter by their own employee_id
                if str(current_user_employee.id) == employee_id:
                    filters['employee_id'] = employee_id
                else:
                    # User doesn't have permission to view other employees' records
                    return Response({
                        'year': year,
                        'month': month,
                        'start_date': None,
                        'end_date': None,
                        'calendar_data': [],
                        'employees': []
                    })
        else:
            # If no employee_id provided, non-admin/non-HR users can only see their own records
            if not is_admin and not is_hr and current_user_employee:
                filters['employee_id'] = current_user_employee.id
        
        # Filter by department_id (only for admin/HR users)
        if department_id and (is_admin or is_hr):
            filters['employee__department_id'] = department_id
        
        # Filter by year and month
        import datetime
        start_date = datetime.date(int(year), int(month), 1)
        if int(month) == 12:
            end_date = datetime.date(int(year) + 1, 1, 1) - datetime.timedelta(days=1)
        else:
            end_date = datetime.date(int(year), int(month) + 1, 1) - datetime.timedelta(days=1)
        
        filters['attendance_date__gte'] = start_date
        filters['attendance_date__lte'] = end_date
        
        # Get attendance records
        attendance_records = Attendance.objects.filter(**filters)
        
        # Use serializer to get all fields including rule information
        # The serializer's to_representation method will recalculate attendance
        # using the rule engine without saving to the database
        serializer = AttendanceSerializer(attendance_records, many=True, context={'request': request})
        
        # Format for calendar
        calendar_data = []
        for record_data in serializer.data:
            calendar_data.append({
                'id': record_data['id'],
                'date': record_data['attendance_date'],
                'employee_id': record_data['employee']['id'] if isinstance(record_data['employee'], dict) else record_data['employee'],
                'employee_name': record_data['employee_name'],
                'employee_code': record_data['employee_code'],
                'check_in': record_data['check_in'],
                'check_out': record_data['check_out'],
                'status': record_data['status'],
                'status_display': record_data['status_display'],
                'shift_type': record_data['shift_type'],
                'shift_type_display': record_data['shift_type_display'],
                'working_hours': float(record_data['working_hours']),
                'late_minutes': record_data.get('late_minutes', 0),
                'early_leave_minutes': record_data.get('early_leave_minutes', 0),
                'notes': record_data['notes'],
                'department_name': record_data['department_name'],
                # Thêm các field mới từ serializer
                'work_coefficient': record_data.get('work_coefficient', 1.0),
                'applied_rules': record_data.get('applied_rules', []),
                'rule_history': record_data.get('rule_history', [])
            })
        
        # Get approved attendance explanations for the same date range and employee(s)
        explanation_filters = {
            'attendance_date__gte': start_date,
            'attendance_date__lte': end_date,
            'status': 'APPROVED'
        }
        
        if employee_id:
            explanation_filters['employee_id'] = employee_id
        elif not is_admin and not is_hr and current_user_employee:
            explanation_filters['employee_id'] = current_user_employee.id
        
        approved_explanations = AttendanceExplanation.objects.filter(**explanation_filters)
        
        # Get approved leave requests for the same date range and employee(s)
        leave_filters = {
            'status': 'APPROVED'
        }
        
        if employee_id:
            leave_filters['employee_id'] = employee_id
        elif not is_admin and not is_hr and current_user_employee:
            leave_filters['employee_id'] = current_user_employee.id
        
        approved_leaves = LeaveRequest.objects.filter(**leave_filters)
        
        # Create a dictionary to map dates to approved requests
        date_to_approved_requests = {}
        
        # Process approved explanations
        for explanation in approved_explanations:
            date_str = str(explanation.attendance_date)
            if date_str not in date_to_approved_requests:
                date_to_approved_requests[date_str] = {
                    'approved_explanations': [],
                    'approved_leave_requests': []
                }
            
            date_to_approved_requests[date_str]['approved_explanations'].append({
                'id': explanation.id,
                'request_code': explanation.request_code,
                'original_status': explanation.original_status,
                'expected_status': explanation.expected_status,
                'status': explanation.status,
                'approved_at': explanation.approved_at.isoformat() if explanation.approved_at else None,
                'approved_by_name': explanation.approved_by.full_name if explanation.approved_by else None
            })
        
        # Process approved leave requests
        for leave in approved_leaves:
            # Check if leave date range overlaps with the calendar month
            leave_start = leave.start_date
            leave_end = leave.end_date or leave.start_date
            
            # Generate all dates in the leave range
            current_date = leave_start
            while current_date <= leave_end:
                if start_date <= current_date <= end_date:
                    date_str = str(current_date)
                    if date_str not in date_to_approved_requests:
                        date_to_approved_requests[date_str] = {
                            'approved_explanations': [],
                            'approved_leave_requests': []
                        }
                    
                    date_to_approved_requests[date_str]['approved_leave_requests'].append({
                        'id': leave.id,
                        'request_code': leave.request_code,
                        'leave_type': leave.leave_type,
                        'status': leave.status,
                        'approved_at': leave.approved_at.isoformat() if leave.approved_at else None,
                        'approved_by_name': leave.approved_by.full_name if leave.approved_by else None
                    })
                
                current_date += datetime.timedelta(days=1)
        
        # Add approved requests information to calendar data
        for calendar_item in calendar_data:
            date_str = calendar_item['date']
            if date_str in date_to_approved_requests:
                calendar_item['approved_explanations'] = date_to_approved_requests[date_str]['approved_explanations']
                calendar_item['approved_leave_requests'] = date_to_approved_requests[date_str]['approved_leave_requests']
                
                # Calculate day status summary
                has_approved_explanation = len(calendar_item.get('approved_explanations', [])) > 0
                has_approved_leave = len(calendar_item.get('approved_leave_requests', [])) > 0
                has_pending_request = False  # We could add this later if needed
                
                summary_text = ""
                if has_approved_explanation and has_approved_leave:
                    summary_text = "Giải trình và nghỉ phép đã duyệt"
                elif has_approved_explanation:
                    summary_text = "Giải trình đã duyệt"
                elif has_approved_leave:
                    summary_text = "Nghỉ phép đã duyệt"
                
                # Determine display color
                display_color = 'default'
                if has_approved_explanation or has_approved_leave:
                    display_color = 'green'  # Green for approved requests
                
                calendar_item['day_status_summary'] = {
                    'has_approved_explanation': has_approved_explanation,
                    'has_approved_leave': has_approved_leave,
                    'has_pending_request': has_pending_request,
                    'summary_text': summary_text,
                    'display_color': display_color
                }
            else:
                calendar_item['approved_explanations'] = []
                calendar_item['approved_leave_requests'] = []
                calendar_item['day_status_summary'] = {
                    'has_approved_explanation': False,
                    'has_approved_leave': False,
                    'has_pending_request': False,
                    'summary_text': '',
                    'display_color': 'default'
                }
        
        # Get employee list for the selected department
        employees = []
        if department_id:
            employees = Employee.objects.filter(department_id=department_id).values(
                'id', 'full_name', 'employee_id', 'department__name'
            )
        elif employee_id:
            employee = Employee.objects.filter(id=employee_id).values(
                'id', 'full_name', 'employee_id', 'department__name'
            ).first()
            if employee:
                employees = [employee]
        
        return Response({
            'year': year,
            'month': month,
            'start_date': start_date,
            'end_date': end_date,
            'calendar_data': calendar_data,
            'employees': list(employees)
        })
    
    @action(detail=False, methods=['post'])
    def bulk_create(self, request):
        """
        Create multiple attendance records at once
        """
        data = request.data
        if not isinstance(data, list):
            return Response(
                {'error': 'Expected a list of attendance records'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        created = []
        errors = []
        
        for idx, item in enumerate(data):
            serializer = self.get_serializer(data=item)
            if serializer.is_valid():
                try:
                    attendance = serializer.save()
                    created.append(attendance.id)
                except Exception as e:
                    errors.append({
                        'index': idx,
                        'data': item,
                        'error': str(e)
                    })
            else:
                errors.append({
                    'index': idx,
                    'data': item,
                    'error': serializer.errors
                })
        
        if errors and not created:
            return Response(
                {'errors': errors},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        return Response({
            'created': len(created),
            'created_ids': created,
            'errors': errors,
            'message': f'Successfully created {len(created)} attendance records'
        })


class AttendanceImportLogViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing attendance import logs
    """
    queryset = AttendanceImportLog.objects.all().order_by('-created_at')
    serializer_class = AttendanceImportLogSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    
    filterset_fields = ['imported_by', 'completed_at']
    search_fields = ['file_name', 'import_code']
    
    @action(detail=True, methods=['post'])
    def mark_completed(self, request, pk=None):
        """
        Mark import log as completed
        """
        import_log = self.get_object()
        import_log.completed_at = timezone.now()
        import_log.save()
        
        serializer = self.get_serializer(import_log)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def import_stats(self, request):
        """
        Get import statistics
        """
        # Total imports
        total_imports = AttendanceImportLog.objects.count()
        
        # Successful imports (with completed_at)
        successful_imports = AttendanceImportLog.objects.filter(
            completed_at__isnull=False
        ).count()
        
        # Failed imports (with error_log)
        failed_imports = AttendanceImportLog.objects.filter(
            error_log__isnull=False
        ).count()
        
        # Total records imported
        total_records = AttendanceImportLog.objects.aggregate(
            total=models.Sum('imported_records')
        )['total'] or 0
        
        # Recent imports (last 30 days)
        thirty_days_ago = timezone.now() - timedelta(days=30)
        recent_imports = AttendanceImportLog.objects.filter(
            created_at__gte=thirty_days_ago
        ).count()
        
        # Average success rate
        if total_imports > 0:
            avg_success_rate = (successful_imports / total_imports) * 100
        else:
            avg_success_rate = 0
        
        return Response({
            'total_imports': total_imports,
            'successful_imports': successful_imports,
            'failed_imports': failed_imports,
            'total_records_imported': total_records,
            'recent_imports': recent_imports,
            'avg_success_rate': round(avg_success_rate, 2)
        })


# ======================
# COMPANY CONFIGURATION VIEWSETS
# ======================

from .models import CompanyConfig, ShiftConfig, HolidayConfig
from .serializers import (
    CompanyConfigSerializer, CompanyConfigListSerializer,
    ShiftConfigSerializer, ShiftConfigListSerializer,
    HolidayConfigSerializer, HolidayConfigListSerializer,
    CurrentCompanyConfigSerializer
)


class CompanyConfigViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing company configurations
    """
    queryset = CompanyConfig.objects.all().order_by('-effective_from', 'code')
    serializer_class = CompanyConfigSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'is_active', 'effective_from', 'effective_to'
    ]
    
    search_fields = [
        'name', 'code', 'description'
    ]
    
    ordering_fields = [
        'name', 'code', 'effective_from', 'effective_to',
        'created_at', 'updated_at'
    ]
    
    ordering = ['-effective_from']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return CompanyConfigListSerializer
        return CompanyConfigSerializer
    
    def get_queryset(self):
        """
        Optionally filter by active status or date range
        """
        queryset = super().get_queryset()
        
        # Filter by is_current
        is_current = self.request.query_params.get('is_current')
        if is_current == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True,
                effective_from__lte=today
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )
        elif is_current == 'false':
            today = timezone.now().date()
            queryset = queryset.exclude(
                models.Q(
                    is_active=True,
                    effective_from__lte=today
                ) & (
                    models.Q(effective_to__isnull=True) | 
                    models.Q(effective_to__gte=today)
                )
            )
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                effective_from__lte=end_date
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=start_date)
            )
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def current(self, request):
        """
        Get current active company configuration
        """
        today = timezone.now().date()
        current_config = CompanyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from').first()
        
        if current_config:
            serializer = self.get_serializer(current_config)
            return Response(serializer.data)
        else:
            return Response(
                {'error': 'No active company configuration found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get company configuration statistics
        """
        total = CompanyConfig.objects.count()
        active = CompanyConfig.objects.filter(is_active=True).count()
        current = CompanyConfig.objects.filter(
            is_active=True,
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).count()
        
        # Configurations by year
        from django.db.models.functions import ExtractYear
        configs_by_year = CompanyConfig.objects.annotate(
            year=ExtractYear('effective_from')
        ).values('year').annotate(
            count=models.Count('id')
        ).order_by('-year')
        
        return Response({
            'total': total,
            'active': active,
            'current': current,
            'configs_by_year': list(configs_by_year)
        })


class ShiftConfigViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing shift configurations
    """
    queryset = ShiftConfig.objects.all().order_by('start_time', 'code')
    serializer_class = ShiftConfigSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'is_active', 'is_default', 'shift_type',
        'effective_from', 'effective_to'
    ]
    
    search_fields = [
        'name', 'code', 'description'
    ]
    
    ordering_fields = [
        'name', 'code', 'start_time', 'end_time',
        'effective_from', 'effective_to',
        'created_at', 'updated_at'
    ]
    
    ordering = ['start_time']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return ShiftConfigListSerializer
        return ShiftConfigSerializer
    
    def get_queryset(self):
        """
        Optionally filter by active status, date range, or employee/department
        """
        queryset = super().get_queryset()
        
        # Filter by is_current
        is_current = self.request.query_params.get('is_current')
        if is_current == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True,
                effective_from__lte=today
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )
        elif is_current == 'false':
            today = timezone.now().date()
            queryset = queryset.exclude(
                models.Q(
                    is_active=True,
                    effective_from__lte=today
                ) & (
                    models.Q(effective_to__isnull=True) | 
                    models.Q(effective_to__gte=today)
                )
            )
        
        # Filter by employee_id
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                # Get shifts that apply to this employee
                queryset = queryset.filter(
                    models.Q(apply_to_employees=employee) |
                    models.Q(apply_to_departments=employee.department) |
                    models.Q(apply_to_positions=employee.position) |
                    models.Q(is_default=True)
                ).distinct()
            except Employee.DoesNotExist:
                pass
        
        # Filter by department_id
        department_id = self.request.query_params.get('department_id')
        if department_id:
            queryset = queryset.filter(
                models.Q(apply_to_departments__id=department_id) |
                models.Q(is_default=True)
            ).distinct()

        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                effective_from__lte=end_date
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=start_date)
            )

        # ShiftConfigListSerializer giờ serialize cả 3 M2M (apply_to_*) nên
        # prefetch để tránh N+1 query khi list() (vd trang "Cấu hình ca làm"
        # tải toàn bộ ~40+ ca 1 lần để dựng bảng tổng quan).
        queryset = queryset.prefetch_related(
            'apply_to_departments', 'apply_to_positions', 'apply_to_employees'
        )

        return queryset
    
    @action(detail=False, methods=['get'])
    def current(self, request):
        """
        Get current active shift configurations
        """
        today = timezone.now().date()
        current_shifts = ShiftConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('start_time')
        
        serializer = self.get_serializer(current_shifts, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def employee_shifts(self, request):
        """
        Get shift configurations for a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        today = timezone.now().date()
        
        # Build conditions — chỉ filter theo những gì employee thực sự có
        conditions = models.Q(apply_to_employees=employee)
        
        # Chỉ filter theo department nếu employee có department
        if employee.department_id:
            conditions |= models.Q(apply_to_departments=employee.department)
        
        # Chỉ filter theo position nếu employee có position
        if employee.position_id:
            conditions |= models.Q(apply_to_positions=employee.position)

        shifts = ShiftConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).filter(conditions).distinct().order_by('start_time')
        
        serializer = self.get_serializer(shifts, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get shift configuration statistics
        """
        total = ShiftConfig.objects.count()
        active = ShiftConfig.objects.filter(is_active=True).count()
        current = ShiftConfig.objects.filter(
            is_active=True,
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).count()
        
        # Count by shift type
        from .models import ShiftConfig
        shift_types = dict(ShiftConfig._meta.get_field('shift_type').choices)
        shift_type_stats = []
        for shift_type, display_name in shift_types.items():
            count = ShiftConfig.objects.filter(shift_type=shift_type).count()
            if count > 0:
                shift_type_stats.append({
                    'shift_type': shift_type,
                    'shift_type_display': display_name,
                    'count': count
                })
        
        # Default shifts
        default_shifts = ShiftConfig.objects.filter(is_default=True).count()
        
        return Response({
            'total': total,
            'active': active,
            'current': current,
            'default_shifts': default_shifts,
            'shift_type_stats': shift_type_stats
        })
    
    @action(detail=True, methods=['get'], url_path='assign-options')
    def assign_options(self, request, pk=None):
        """
        Get all available employees, positions, departments to assign to this shift,
        along with currently assigned items.
        
        Response:
        {
          "shift": {...},
          "current_assignments": {
            "employees": [...],
            "positions": [...],
            "departments": [...]
          },
          "available_options": {
            "employees": [...],
            "positions": [...],
            "departments": [...]
          }
        }
        """
        shift = self.get_object()
        
        # Get current assignments
        current_employees = shift.apply_to_employees.values('id', 'employee_id', 'full_name', 'personal_email', 'department__name')
        current_positions = shift.apply_to_positions.values('id', 'code', 'title').distinct()
        current_departments = shift.apply_to_departments.values('id', 'code', 'name')
        
        # Get all available options
        all_employees = Employee.objects.filter(is_active=True).values('id', 'employee_id', 'full_name', 'personal_email', 'department__name').order_by('full_name')
        all_positions = Position.objects.values('id', 'code', 'title').order_by('title').distinct()
        all_departments = Department.objects.values('id', 'code', 'name').order_by('name')
        
        # Serialize the shift
        shift_serializer = ShiftConfigSerializer(shift)
        
        return Response({
            'shift': shift_serializer.data,
            'current_assignments': {
                'employees': list(current_employees),
                'positions': list(current_positions),
                'departments': list(current_departments)
            },
            'available_options': {
                'employees': list(all_employees),
                'positions': list(all_positions),
                'departments': list(all_departments)
            }
        })
    
    @action(detail=True, methods=['post'], url_path='assign')
    def assign(self, request, pk=None):
        """
        Assign employees, positions, and/or departments to this shift.
        
        Expected request body:
        {
          "employee_ids": [1, 2, 3],        # Optional
          "position_ids": [1, 2],           # Optional  
          "department_ids": [1, 2]          # Optional
        }
        
        If any field is provided, it will ADD to current assignments for that field.
        If no field is provided, no changes are made.
        """
        shift = self.get_object()
        
        employee_ids = request.data.get('employee_ids')
        position_ids = request.data.get('position_ids')
        department_ids = request.data.get('department_ids')
        
        errors = {}
        
        # Validate and assign employees
        if employee_ids is not None:
            if not isinstance(employee_ids, list):
                errors['employee_ids'] = 'Must be a list'
            else:
                try:
                    employee_ids = list(dict.fromkeys(employee_ids))  # Remove duplicates, preserve order
                    employees = list(Employee.objects.filter(id__in=employee_ids))
                    if len(employees) != len(employee_ids):
                        missing_ids = set(employee_ids) - set(emp.id for emp in employees)
                        errors['employee_ids'] = f'Invalid employee IDs: {missing_ids}'
                    else:
                        shift.apply_to_employees.add(*employees)
                except Exception as e:
                    errors['employee_ids'] = str(e)
        
        # Validate and assign positions
        if position_ids is not None:
            if not isinstance(position_ids, list):
                errors['position_ids'] = 'Must be a list'
            else:
                try:
                    position_ids = list(dict.fromkeys(position_ids))  # Remove duplicates, preserve order
                    positions = list(Position.objects.filter(id__in=position_ids))
                    if len(positions) != len(position_ids):
                        missing_ids = set(position_ids) - set(pos.id for pos in positions)
                        errors['position_ids'] = f'Invalid position IDs: {missing_ids}'
                    else:
                        shift.apply_to_positions.add(*positions)
                except Exception as e:
                    errors['position_ids'] = str(e)
        
        # Validate and assign departments
        if department_ids is not None:
            if not isinstance(department_ids, list):
                errors['department_ids'] = 'Must be a list'
            else:
                try:
                    department_ids = list(dict.fromkeys(department_ids))  # Remove duplicates, preserve order
                    departments = list(Department.objects.filter(id__in=department_ids))
                    if len(departments) != len(department_ids):
                        missing_ids = set(department_ids) - set(dep.id for dep in departments)
                        errors['department_ids'] = f'Invalid department IDs: {missing_ids}'
                    else:
                        shift.apply_to_departments.add(*departments)
                except Exception as e:
                    errors['department_ids'] = str(e)
        
        if errors:
            return Response(
                {'errors': errors, 'message': 'Validation failed'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Return updated shift
        shift.refresh_from_db()
        serializer = self.get_serializer(shift)
        return Response({
            'message': 'Assignments updated successfully',
            'shift': serializer.data
        }, status=status.HTTP_200_OK)
    @action(detail=True, methods=['post'], url_path='remove-employee')
    def remove_employee(self, request, pk=None):
        """
        Remove a single employee from this shift's direct assignment.
        Does NOT affect department/position assignments.

        Expected request body:
        {
          "employee_id": 5
        }
        """
        shift = self.get_object()

        employee_id = request.data.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Chỉ remove khỏi apply_to_employees (direct assignment)
        # Không đụng đến department/position assignment
        shift.apply_to_employees.remove(employee)

        return Response(
            {'message': f'Đã xóa nhân viên {employee.full_name} khỏi ca {shift.name}'},
            status=status.HTTP_200_OK
        )


class HolidayConfigViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing holiday configurations
    """
    queryset = HolidayConfig.objects.all().order_by('holiday_date', 'name')
    serializer_class = HolidayConfigSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'is_active', 'is_recurring', 'holiday_type',
        'is_working_day', 'allow_voluntary_work'
    ]
    
    search_fields = [
        'name', 'description', 'notes'
    ]
    
    ordering_fields = [
        'name', 'holiday_date', 'holiday_type',
        'created_at', 'updated_at'
    ]
    
    ordering = ['holiday_date']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return HolidayConfigListSerializer
        return HolidayConfigSerializer
    
    def get_queryset(self):
        """
        Optionally filter by date range or employee
        """
        queryset = super().get_queryset()
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                holiday_date__gte=start_date,
                holiday_date__lte=end_date
            )
        elif start_date:
            queryset = queryset.filter(holiday_date__gte=start_date)
        elif end_date:
            queryset = queryset.filter(holiday_date__lte=end_date)
        
        # Filter by is_today
        is_today = self.request.query_params.get('is_today')
        if is_today == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                models.Q(holiday_date=today) |
                models.Q(is_recurring=True, holiday_date__month=today.month, holiday_date__day=today.day)
            )
        
        # Filter by employee_id
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                # Get holidays that apply to this employee
                queryset = queryset.filter(
                    models.Q(apply_to_all=True) &
                    ~models.Q(excluded_employees=employee) &
                    ~models.Q(excluded_departments=employee.department) &
                    ~models.Q(excluded_positions=employee.position)
                ).distinct()
            except Employee.DoesNotExist:
                pass
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def upcoming(self, request):
        """
        Get upcoming holidays (next 30 days)
        """
        today = timezone.now().date()
        thirty_days_later = today + timedelta(days=30)
        
        upcoming_holidays = HolidayConfig.objects.filter(
            is_active=True,
            holiday_date__gte=today,
            holiday_date__lte=thirty_days_later
        ).order_by('holiday_date')
        
        # Include recurring holidays
        recurring_holidays = HolidayConfig.objects.filter(
            is_active=True,
            is_recurring=True
        ).exclude(
            holiday_date__gte=today,
            holiday_date__lte=thirty_days_later
        )
        
        # Filter recurring holidays for the next 30 days
        recurring_upcoming = []
        for holiday in recurring_holidays:
            # Create date for this year
            holiday_date_this_year = holiday.holiday_date.replace(year=today.year)
            
            # If date has passed this year, use next year
            if holiday_date_this_year < today:
                holiday_date_this_year = holiday.holiday_date.replace(year=today.year + 1)
            
            if today <= holiday_date_this_year <= thirty_days_later:
                recurring_upcoming.append(holiday)
        
        all_upcoming = list(upcoming_holidays) + recurring_upcoming
        all_upcoming.sort(key=lambda x: x.holiday_date)
        
        serializer = self.get_serializer(all_upcoming, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def today(self, request):
        """
        Get today's holidays
        """
        today = timezone.now().date()
        
        # Exact date matches
        today_holidays = HolidayConfig.objects.filter(
            is_active=True,
            holiday_date=today
        )
        
        # Recurring holidays
        recurring_today = HolidayConfig.objects.filter(
            is_active=True,
            is_recurring=True,
            holiday_date__month=today.month,
            holiday_date__day=today.day
        ).exclude(id__in=today_holidays.values_list('id', flat=True))
        
        all_today = list(today_holidays) + list(recurring_today)
        
        serializer = self.get_serializer(all_today, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def employee_holidays(self, request):
        """
        Get holidays for a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get date range
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        
        if not start_date or not end_date:
            # Default to current year
            today = timezone.now().date()
            start_date = today.replace(month=1, day=1)
            end_date = today.replace(month=12, day=31)
        
        # Get holidays that apply to this employee
        holidays = HolidayConfig.objects.filter(
            is_active=True,
            holiday_date__gte=start_date,
            holiday_date__lte=end_date
        ).filter(
            models.Q(apply_to_all=True) &
            ~models.Q(excluded_employees=employee) &
            ~models.Q(excluded_departments=employee.department) &
            ~models.Q(excluded_positions=employee.position)
        ).distinct().order_by('holiday_date')
        
        # Include recurring holidays
        recurring_holidays = HolidayConfig.objects.filter(
            is_active=True,
            is_recurring=True
        ).exclude(
            holiday_date__gte=start_date,
            holiday_date__lte=end_date
        )
        
        # Filter recurring holidays for the date range
        recurring_in_range = []
        for holiday in recurring_holidays:
            # Create date for this year
            holiday_date_this_year = holiday.holiday_date.replace(year=start_date.year)
            
            # If date has passed this year, use next year
            if holiday_date_this_year < start_date:
                holiday_date_this_year = holiday.holiday_date.replace(year=start_date.year + 1)
            
            if start_date <= holiday_date_this_year <= end_date:
                recurring_in_range.append(holiday)
        
        all_holidays = list(holidays) + recurring_in_range
        all_holidays.sort(key=lambda x: x.holiday_date)
        
        serializer = self.get_serializer(all_holidays, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get holiday configuration statistics
        """
        total = HolidayConfig.objects.count()
        active = HolidayConfig.objects.filter(is_active=True).count()
        recurring = HolidayConfig.objects.filter(is_recurring=True).count()
        
        # Count by holiday type
        from .models import HolidayConfig
        holiday_types = dict(HolidayConfig._meta.get_field('holiday_type').choices)
        holiday_type_stats = []
        for holiday_type, display_name in holiday_types.items():
            count = HolidayConfig.objects.filter(holiday_type=holiday_type).count()
            if count > 0:
                holiday_type_stats.append({
                    'holiday_type': holiday_type,
                    'holiday_type_display': display_name,
                    'count': count
                })
        
        # Working holidays
        working_holidays = HolidayConfig.objects.filter(is_working_day=True).count()
        
        # Holidays with voluntary work allowed
        voluntary_work_allowed = HolidayConfig.objects.filter(allow_voluntary_work=True).count()
        
        return Response({
            'total': total,
            'active': active,
            'recurring': recurring,
            'working_holidays': working_holidays,
            'voluntary_work_allowed': voluntary_work_allowed,
            'holiday_type_stats': holiday_type_stats
        })


class CurrentCompanyConfigAPIView(APIView):
    """
    API endpoint for getting current company configuration
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """
        Get current company configuration including shifts and holidays
        """
        serializer = CurrentCompanyConfigSerializer({})
        return Response(serializer.data)


# ======================
# COMPANY INFORMATION VIEWSETS
# ======================

from .models import CompanyDocument, CompanyAnnouncement, CompanyDocumentViewLog, CompanyAnnouncementViewLog, CompanyAnnouncementAttachment
from .serializers import (
    CompanyDocumentSerializer, CompanyDocumentListSerializer,
    CompanyAnnouncementSerializer, CompanyAnnouncementListSerializer,
    CompanyDocumentViewLogSerializer, CompanyAnnouncementViewLogSerializer,
    EmployeeCompanyInfoSerializer
)


class CompanyDocumentViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing company documents
    """
    queryset = CompanyDocument.objects.all().order_by('-effective_from', 'document_code')
    serializer_class = CompanyDocumentSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'document_type', 'status', 'access_level', 'department',
        'effective_from', 'effective_to'
    ]
    
    search_fields = [
        'document_code', 'title', 'description', 'file_name',
        'tags', 'version'
    ]
    
    ordering_fields = [
        'document_code', 'title', 'effective_from', 'effective_to',
        'created_at', 'updated_at', 'published_at'
    ]
    
    ordering = ['-effective_from']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return CompanyDocumentListSerializer
        return CompanyDocumentSerializer
    
    def get_queryset(self):
        """
        Optionally filter by current status, document type, or employee access
        """
        queryset = super().get_queryset()
        
        # Filter by is_current
        is_current = self.request.query_params.get('is_current')
        if is_current == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                status='PUBLISHED',
                effective_from__lte=today
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )
        elif is_current == 'false':
            today = timezone.now().date()
            queryset = queryset.exclude(
                models.Q(
                    status='PUBLISHED',
                    effective_from__lte=today
                ) & (
                    models.Q(effective_to__isnull=True) | 
                    models.Q(effective_to__gte=today)
                )
            )
        
        # Filter by document type
        document_type = self.request.query_params.get('document_type')
        if document_type:
            queryset = queryset.filter(document_type=document_type)
        
        # Filter by employee access (if employee_id is provided)
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                # Filter documents that the employee can access
                accessible_docs = []
                for doc in queryset:
                    if doc.can_access(employee):
                        accessible_docs.append(doc.id)
                queryset = queryset.filter(id__in=accessible_docs)
            except Employee.DoesNotExist:
                pass
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                effective_from__lte=end_date
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=start_date)
            )
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def current(self, request):
        """
        Get current active company documents
        """
        today = timezone.now().date()
        current_documents = CompanyDocument.objects.filter(
            status='PUBLISHED',
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from')
        
        serializer = self.get_serializer(current_documents, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def employee_documents(self, request):
        """
        Get company documents accessible to a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        today = timezone.now().date()
        
        # Get published documents
        documents = CompanyDocument.objects.filter(
            status='PUBLISHED',
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from')
        
        # Filter by access level
        accessible_documents = []
        for doc in documents:
            if doc.can_access(employee):
                accessible_documents.append(doc)
        
        serializer = self.get_serializer(accessible_documents, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """
        Publish a document
        """
        document = self.get_object()
        
        # Get published_by employee from request user
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Employee profile not found for this user'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        success = document.publish(employee)
        
        if success:
            serializer = self.get_serializer(document)
            return Response(serializer.data)
        else:
            return Response(
                {'error': 'Document cannot be published (may already be published)'},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        """
        Archive a document
        """
        document = self.get_object()
        success = document.archive()
        
        if success:
            serializer = self.get_serializer(document)
            return Response(serializer.data)
        else:
            return Response(
                {'error': 'Document cannot be archived (may not be published)'},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'])
    def record_view(self, request, pk=None):
        """
        Record a document view by an employee
        """
        document = self.get_object()
        
        # Get employee from request user
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Employee profile not found for this user'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Check if employee can access the document
        if not document.can_access(employee):
            return Response(
                {'error': 'Employee does not have access to this document'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Create view log
        view_log = CompanyDocumentViewLog.objects.create(
            document=document,
            employee=employee,
            user_agent=request.META.get('HTTP_USER_AGENT', ''),
            ip_address=request.META.get('REMOTE_ADDR')
        )
        
        serializer = CompanyDocumentViewLogSerializer(view_log)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get company document statistics
        """
        total = CompanyDocument.objects.count()
        published = CompanyDocument.objects.filter(status='PUBLISHED').count()
        draft = CompanyDocument.objects.filter(status='DRAFT').count()
        archived = CompanyDocument.objects.filter(status='ARCHIVED').count()
        current = CompanyDocument.objects.filter(
            status='PUBLISHED',
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).count()
        
        # Count by document type
        from .models import COMPANY_DOCUMENT_TYPE
        document_types = dict(COMPANY_DOCUMENT_TYPE)
        document_type_stats = []
        for doc_type, display_name in document_types.items():
            count = CompanyDocument.objects.filter(document_type=doc_type).count()
            if count > 0:
                document_type_stats.append({
                    'document_type': doc_type,
                    'document_type_display': display_name,
                    'count': count
                })
        
        # Count by access level
        from .models import ACCESS_LEVEL
        access_levels = dict(ACCESS_LEVEL)
        access_level_stats = []
        for access_level, display_name in access_levels.items():
            count = CompanyDocument.objects.filter(access_level=access_level).count()
            if count > 0:
                access_level_stats.append({
                    'access_level': access_level,
                    'access_level_display': display_name,
                    'count': count
                })
        
        # Total views
        total_views = CompanyDocumentViewLog.objects.count()
        
        return Response({
            'total': total,
            'published': published,
            'draft': draft,
            'archived': archived,
            'current': current,
            'document_type_stats': document_type_stats,
            'access_level_stats': access_level_stats,
            'total_views': total_views
        })


class CompanyAnnouncementViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing company announcements
    """
    queryset = CompanyAnnouncement.objects.select_related('created_by', 'approved_by').all().order_by('-effective_from', '-priority')
    serializer_class = CompanyAnnouncementSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'announcement_type', 'priority', 'is_active',
        'effective_from', 'effective_to'
    ]
    
    search_fields = [
        'announcement_code', 'title', 'content',
    ]
    
    ordering_fields = [
        'announcement_code', 'title', 'effective_from', 'effective_to',
        'priority', 'created_at', 'updated_at', 'published_at'
    ]
    
    ordering = ['-effective_from', '-priority']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return CompanyAnnouncementListSerializer
        return CompanyAnnouncementSerializer

    def perform_create(self, serializer):
        from .utils import upload_file_to_cloudfly
        from django.conf import settings
        extra = {}
        try:
            extra['created_by'] = Employee.objects.get(user=self.request.user)
        except Employee.DoesNotExist:
            pass
        attachment = self.request.FILES.get('attachment')
        if attachment and getattr(settings, 'CLOUDFLY_ENABLED', False):
            extra['attachment'] = upload_file_to_cloudfly(attachment, 'company/announcements')
        announcement = serializer.save(**extra)
        self._save_attachments(announcement)

    def perform_update(self, serializer):
        from .utils import upload_file_to_cloudfly
        from django.conf import settings
        extra = {}
        attachment = self.request.FILES.get('attachment')
        if attachment and getattr(settings, 'CLOUDFLY_ENABLED', False):
            extra['attachment'] = upload_file_to_cloudfly(attachment, 'company/announcements')
        elif self.request.data.get('clear_attachment') == '1':
            extra['attachment'] = None
        announcement = serializer.save(**extra)
        remove_ids = self.request.data.getlist('remove_attachment_ids')
        if remove_ids:
            CompanyAnnouncementAttachment.objects.filter(
                announcement=announcement, id__in=remove_ids
            ).delete()
        self._save_attachments(announcement)

    def _save_attachments(self, announcement):
        from .utils import upload_file_to_cloudfly
        from django.conf import settings
        files = self.request.FILES.getlist('attachments')
        for f in files:
            if getattr(settings, 'CLOUDFLY_ENABLED', False):
                s3_key = upload_file_to_cloudfly(f, 'company/announcements')
                CompanyAnnouncementAttachment.objects.create(
                    announcement=announcement, file=s3_key, file_name=f.name
                )
            else:
                CompanyAnnouncementAttachment.objects.create(
                    announcement=announcement, file=f, file_name=f.name
                )

    def _get_request_employee(self):
        try:
            return Employee.objects.get(user=self.request.user)
        except Employee.DoesNotExist:
            return None

    def _get_announcement_viewer_filter(self, employee=None):
        """Match both new user-based logs and legacy employee-based logs."""
        viewer_filter = models.Q(user=self.request.user)
        if employee:
            viewer_filter |= models.Q(employee=employee)
        return viewer_filter

    def _can_read_announcement(self, announcement, employee=None, include_company_feed=False):
        user = self.request.user
        if user.is_staff or user.is_superuser:
            return True

        if employee is None:
            return False

        if announcement.should_apply_to_employee(employee):
            return True

        if include_company_feed:
            return (
                announcement.apply_to_all
                or announcement.departments.exists()
                or announcement.positions.exists()
            )

        return False

    def get_queryset(self):
        """
        Optionally filter by current status, announcement type, or employee applicability
        """
        queryset = super().get_queryset()
        
        # Filter by is_current
        is_current = self.request.query_params.get('is_current')
        if is_current == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True,
                effective_from__lte=today
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )
        elif is_current == 'false':
            today = timezone.now().date()
            queryset = queryset.exclude(
                models.Q(
                    is_active=True,
                    effective_from__lte=today
                ) & (
                    models.Q(effective_to__isnull=True) | 
                    models.Q(effective_to__gte=today)
                )
            )
        
        # Filter by announcement type
        announcement_type = self.request.query_params.get('announcement_type')
        if announcement_type:
            queryset = queryset.filter(announcement_type=announcement_type)
        
        # Filter by priority
        priority = self.request.query_params.get('priority')
        if priority:
            queryset = queryset.filter(priority=priority)
        
        # Filter by employee applicability (if employee_id is provided)
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                # Filter announcements that apply to this employee
                applicable_announcements = []
                for ann in queryset:
                    if ann.should_apply_to_employee(employee):
                        applicable_announcements.append(ann.id)
                queryset = queryset.filter(id__in=applicable_announcements)
            except Employee.DoesNotExist:
                pass

        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                effective_from__lte=end_date
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=start_date)
            )

        # Non-staff users normally only see announcements applicable to themselves.
        # Home can request a broader company feed so everyone can see department /
        # position scoped company announcements, while employee-only notices for
        # other people stay private.
        #
        # `home_feed=true` = CÁC MÀN CÁ NHÂN (widget Trang chủ, chuông, ngăn thông
        # báo, số đếm chưa đọc) -> lọc theo người nhận cho MỌI vai, kể cả
        # staff/superuser. Trước 2026-10-12 nhánh này bỏ qua hẳn admin, nên anh
        # HCNS (superuser) thấy thông báo cá nhân của TẤT CẢ mọi người: 70 cái
        # chưa đọc toàn "biên bản phạt tháng 6" của người khác. Feed cá nhân thì
        # phải là của cá nhân, không phụ thuộc chức vụ.
        #
        # Trang QUẢN LÝ thông báo (AnnouncementList) KHÔNG gửi home_feed, nên
        # admin vẫn xem và sửa được toàn bộ thông báo ở đó như cũ.
        home_feed = self.request.query_params.get('home_feed') == 'true'
        is_admin_viewer = (self.request.user.is_authenticated
                           and (self.request.user.is_staff or self.request.user.is_superuser))
        if self.request.user.is_authenticated and (home_feed or not is_admin_viewer):
            employee = self._get_request_employee()
            if employee:
                if home_feed:
                    queryset = queryset.filter(
                        models.Q(apply_to_all=True)
                        | models.Q(departments__isnull=False)
                        | models.Q(positions__isnull=False)
                        | models.Q(employees=employee)
                    ).distinct()
                else:
                    queryset = queryset.filter(
                        models.Q(apply_to_all=True)
                        | models.Q(departments=employee.department)
                        | models.Q(positions=employee.position)
                        | models.Q(employees=employee)
                    ).distinct()
            else:
                if home_feed:
                    queryset = queryset.filter(
                        models.Q(apply_to_all=True)
                        | models.Q(departments__isnull=False)
                        | models.Q(positions__isnull=False)
                    ).distinct()
                else:
                    queryset = queryset.none()

        # Lọc theo tài khoản hiện tại, đồng thời đọc cả log cũ lưu theo employee.
        unread_only = self.request.query_params.get('unread_only')
        if unread_only == 'true':
            employee = self._get_request_employee()
            viewed_ids = CompanyAnnouncementViewLog.objects.filter(
                self._get_announcement_viewer_filter(employee),
                acknowledged=True,
            ).values_list('announcement_id', flat=True)
            queryset = queryset.exclude(id__in=viewed_ids)

        return queryset
    
    @action(detail=False, methods=['get'])
    def current(self, request):
        """
        Get current active company announcements
        """
        today = timezone.now().date()
        current_announcements = CompanyAnnouncement.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from', '-priority')
        
        serializer = self.get_serializer(current_announcements, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def employee_announcements(self, request):
        """
        Get company announcements applicable to a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        today = timezone.now().date()
        
        # Get active announcements
        announcements = CompanyAnnouncement.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from', '-priority')
        
        # Filter by applicability
        applicable_announcements = []
        for ann in announcements:
            if ann.should_apply_to_employee(employee):
                applicable_announcements.append(ann)
        
        serializer = self.get_serializer(applicable_announcements, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def publish(self, request, pk=None):
        """
        Publish an announcement
        """
        announcement = self.get_object()
        
        # Get approved_by employee from request user (optional)
        approved_by_employee = None
        try:
            employee = Employee.objects.get(user=request.user)
            approved_by_employee = employee
        except Employee.DoesNotExist:
            pass
        
        success = announcement.publish(approved_by_employee)
        
        if success:
            serializer = self.get_serializer(announcement)
            return Response(serializer.data)
        else:
            return Response(
                {'error': 'Announcement cannot be published (may already be published)'},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def record_view(self, request, pk=None):
        """
        Record an announcement view by an employee
        """
        announcement = get_object_or_404(CompanyAnnouncement, pk=pk)

        # Get employee from request user
        employee = self._get_request_employee()
        if not employee:
            if not (request.user.is_staff or request.user.is_superuser):
                return Response(
                    {'error': 'Announcement does not apply to this employee'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if not self._can_read_announcement(announcement, employee, include_company_feed=True):
            return Response(
                {'error': 'Announcement does not apply to this employee'},
                status=status.HTTP_403_FORBIDDEN
            )

        if not announcement.is_current:
            return Response({'message': 'View recorded'}, status=status.HTTP_200_OK)

        # Dùng filter().first() thay vì get_or_create để tránh MultipleObjectsReturned
        # (unique_together bao gồm viewed_at nên 1 nhân viên có thể có nhiều log)
        view_log = CompanyAnnouncementViewLog.objects.filter(
            announcement=announcement,
        ).filter(
            self._get_announcement_viewer_filter(employee),
        ).order_by('viewed_at').first()
        if not view_log:
            view_log = CompanyAnnouncementViewLog.objects.create(
                announcement=announcement,
                employee=employee,
                user=request.user,
                user_agent=request.META.get('HTTP_USER_AGENT', ''),
                ip_address=request.META.get('REMOTE_ADDR'),
            )

        serializer = CompanyAnnouncementViewLogSerializer(view_log)
        return Response(serializer.data, status=status.HTTP_200_OK)
    
    @action(detail=True, methods=['post'], permission_classes=[IsAuthenticated])
    def acknowledge(self, request, pk=None):
        """
        Acknowledge reading an announcement
        """
        announcement = get_object_or_404(CompanyAnnouncement, pk=pk)

        # Get employee from request user
        employee = self._get_request_employee()
        if not employee:
            if not (request.user.is_staff or request.user.is_superuser):
                return Response(
                    {'error': 'Announcement does not apply to this employee'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        
        # Check if announcement applies to employee
        if not self._can_read_announcement(announcement, employee, include_company_feed=True):
            return Response(
                {'error': 'Announcement does not apply to this employee'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Dùng filter().first() thay vì get_or_create để tránh MultipleObjectsReturned
        view_log = CompanyAnnouncementViewLog.objects.filter(
            announcement=announcement,
        ).filter(
            self._get_announcement_viewer_filter(employee),
        ).order_by('viewed_at').first()
        if not view_log:
            view_log = CompanyAnnouncementViewLog.objects.create(
                announcement=announcement,
                employee=employee,
                user=request.user,
                user_agent=request.META.get('HTTP_USER_AGENT', ''),
                ip_address=request.META.get('REMOTE_ADDR'),
            )
        
        # Acknowledge the announcement
        success = view_log.acknowledge()
        
        if success:
            serializer = CompanyAnnouncementViewLogSerializer(view_log)
            return Response(serializer.data)
        else:
            return Response(
                {'error': 'Announcement already acknowledged'},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated], url_path='mark-all-read')
    def mark_all_read(self, request):
        """Mark every currently visible company announcement as read."""
        employee = self._get_request_employee()
        if not employee and not (request.user.is_staff or request.user.is_superuser):
            return Response(
                {'error': 'Employee profile not found'},
                status=status.HTTP_403_FORBIDDEN,
            )

        announcements = list(self.get_queryset())
        now = timezone.now()
        marked_count = 0

        for announcement in announcements:
            view_log = CompanyAnnouncementViewLog.objects.filter(
                announcement=announcement,
            ).filter(
                self._get_announcement_viewer_filter(employee),
            ).order_by('viewed_at').first()

            if not view_log:
                CompanyAnnouncementViewLog.objects.create(
                    announcement=announcement,
                    employee=employee,
                    user=request.user,
                    acknowledged=True,
                    acknowledged_at=now,
                    user_agent=request.META.get('HTTP_USER_AGENT', ''),
                    ip_address=request.META.get('REMOTE_ADDR'),
                )
                marked_count += 1
            elif not view_log.acknowledged:
                view_log.acknowledged = True
                view_log.acknowledged_at = now
                view_log.save(update_fields=['acknowledged', 'acknowledged_at'])
                marked_count += 1

        return Response({'marked_count': marked_count}, status=status.HTTP_200_OK)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get company announcement statistics
        """
        total = CompanyAnnouncement.objects.count()
        active = CompanyAnnouncement.objects.filter(is_active=True).count()
        current = CompanyAnnouncement.objects.filter(
            is_active=True,
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).count()
        
        # Count by announcement type
        from .models import CompanyAnnouncement
        announcement_types = dict(CompanyAnnouncement._meta.get_field('announcement_type').choices)
        announcement_type_stats = []
        for ann_type, display_name in announcement_types.items():
            count = CompanyAnnouncement.objects.filter(announcement_type=ann_type).count()
            if count > 0:
                announcement_type_stats.append({
                    'announcement_type': ann_type,
                    'announcement_type_display': display_name,
                    'count': count
                })
        
        # Count by priority
        priorities = dict(CompanyAnnouncement._meta.get_field('priority').choices)
        priority_stats = []
        for priority, display_name in priorities.items():
            count = CompanyAnnouncement.objects.filter(priority=priority).count()
            if count > 0:
                priority_stats.append({
                    'priority': priority,
                    'priority_display': display_name,
                    'count': count
                })
        
        # Total views
        total_views = CompanyAnnouncementViewLog.objects.count()
        
        # Acknowledged announcements
        acknowledged = CompanyAnnouncementViewLog.objects.filter(acknowledged=True).count()
        
        return Response({
            'total': total,
            'active': active,
            'current': current,
            'announcement_type_stats': announcement_type_stats,
            'priority_stats': priority_stats,
            'total_views': total_views,
            'acknowledged': acknowledged
        })


class EmployeeCompanyInfoAPIView(APIView):
    """
    API endpoint for getting company information for an employee
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """
        Get company information for the current employee
        """
        # Get the employee associated with the current user
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Employee profile not found for this user'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        serializer = EmployeeCompanyInfoSerializer(employee)
        return Response(serializer.data)


# ======================
# ATTENDANCE RULE CONFIGURATION VIEWSETS
# ======================

from .models import AttendanceRuleConfig, AttendanceRuleHistory, LeavePolicyConfig
from .serializers import (
    AttendanceRuleConfigSerializer, AttendanceRuleConfigListSerializer,
    AttendanceRuleHistorySerializer, LeavePolicyConfigSerializer,
    LeavePolicyConfigListSerializer, AttendanceRuleEngineSerializer
)


class AttendanceRuleConfigViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing attendance rule configurations
    """
    queryset = AttendanceRuleConfig.objects.all().order_by('-effective_from', 'code')
    serializer_class = AttendanceRuleConfigSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'rule_type', 'is_active', 'is_default',
        'effective_from', 'effective_to'
    ]
    
    search_fields = [
        'name', 'code', 'description'
    ]
    
    ordering_fields = [
        'name', 'code', 'rule_type', 'effective_from', 'effective_to',
        'created_at', 'updated_at'
    ]
    
    ordering = ['-effective_from']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return AttendanceRuleConfigListSerializer
        return AttendanceRuleConfigSerializer
    
    def get_queryset(self):
        """
        Optionally filter by current status, rule type, or employee applicability
        """
        queryset = super().get_queryset()
        
        # Filter by is_current
        is_current = self.request.query_params.get('is_current')
        if is_current == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True,
                effective_from__lte=today
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )
        elif is_current == 'false':
            today = timezone.now().date()
            queryset = queryset.exclude(
                models.Q(
                    is_active=True,
                    effective_from__lte=today
                ) & (
                    models.Q(effective_to__isnull=True) | 
                    models.Q(effective_to__gte=today)
                )
            )
        
        # Filter by rule type
        rule_type = self.request.query_params.get('rule_type')
        if rule_type:
            queryset = queryset.filter(rule_type=rule_type)
        
        # Filter by employee applicability (if employee_id is provided)
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                # Filter rules that apply to this employee
                applicable_rules = []
                for rule in queryset:
                    if rule.should_apply_to_employee(employee):
                        applicable_rules.append(rule.id)
                queryset = queryset.filter(id__in=applicable_rules)
            except Employee.DoesNotExist:
                pass
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                effective_from__lte=end_date
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=start_date)
            )
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def current(self, request):
        """
        Get current active attendance rule configurations
        """
        today = timezone.now().date()
        current_rules = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from')
        
        serializer = self.get_serializer(current_rules, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def employee_rules(self, request):
        """
        Get attendance rule configurations for a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        today = timezone.now().date()
        
        # Get active rules
        rules = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from')
        
        # Filter by applicability
        applicable_rules = []
        for rule in rules:
            if rule.should_apply_to_employee(employee):
                applicable_rules.append(rule)
        
        serializer = self.get_serializer(applicable_rules, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def rule_types(self, request):
        """
        Get available rule types
        """
        from .models import ATTENDANCE_RULE_TYPE
        rule_types = []
        for rule_type, display_name in ATTENDANCE_RULE_TYPE:
            rule_types.append({
                'value': rule_type,
                'display_name': display_name
            })
        
        return Response(rule_types)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get attendance rule configuration statistics
        """
        total = AttendanceRuleConfig.objects.count()
        active = AttendanceRuleConfig.objects.filter(is_active=True).count()
        current = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).count()
        
        # Count by rule type
        from .models import ATTENDANCE_RULE_TYPE
        rule_type_stats = []
        for rule_type, display_name in ATTENDANCE_RULE_TYPE:
            count = AttendanceRuleConfig.objects.filter(rule_type=rule_type).count()
            if count > 0:
                rule_type_stats.append({
                    'rule_type': rule_type,
                    'rule_type_display': display_name,
                    'count': count
                })
        
        # Default rules
        default_rules = AttendanceRuleConfig.objects.filter(is_default=True).count()
        
        return Response({
            'total': total,
            'active': active,
            'current': current,
            'default_rules': default_rules,
            'rule_type_stats': rule_type_stats
        })


class AttendanceRuleHistoryViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing attendance rule history
    """
    queryset = AttendanceRuleHistory.objects.all().order_by('-applied_at')
    serializer_class = AttendanceRuleHistorySerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    
    filterset_fields = [
        'attendance', 'rule', 'applied_by'
    ]
    
    @action(detail=False, methods=['get'])
    def attendance_history(self, request):
        """
        Get rule history for a specific attendance record
        """
        attendance_id = request.query_params.get('attendance_id')
        if not attendance_id:
            return Response(
                {'error': 'attendance_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            attendance = Attendance.objects.get(id=attendance_id)
        except Attendance.DoesNotExist:
            return Response(
                {'error': f'Attendance with ID {attendance_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        history = AttendanceRuleHistory.objects.filter(
            attendance=attendance
        ).order_by('-applied_at')
        
        page = self.paginate_queryset(history)
        
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(history, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def rule_history(self, request):
        """
        Get application history for a specific rule
        """
        rule_id = request.query_params.get('rule_id')
        if not rule_id:
            return Response(
                {'error': 'rule_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            rule = AttendanceRuleConfig.objects.get(id=rule_id)
        except AttendanceRuleConfig.DoesNotExist:
            return Response(
                {'error': f'AttendanceRuleConfig with ID {rule_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        history = AttendanceRuleHistory.objects.filter(
            rule=rule
        ).order_by('-applied_at')
        
        page = self.paginate_queryset(history)
        
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        
        serializer = self.get_serializer(history, many=True)
        return Response(serializer.data)


class LeavePolicyConfigViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing leave policy configurations
    """
    queryset = LeavePolicyConfig.objects.all().order_by('-effective_from', 'code')
    serializer_class = LeavePolicyConfigSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'leave_type', 'is_active',
        'effective_from', 'effective_to'
    ]
    
    search_fields = [
        'name', 'code', 'description'
    ]
    
    ordering_fields = [
        'name', 'code', 'leave_type', 'effective_from', 'effective_to',
        'created_at', 'updated_at'
    ]
    
    ordering = ['-effective_from']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return LeavePolicyConfigListSerializer
        return LeavePolicyConfigSerializer
    
    def get_queryset(self):
        """
        Optionally filter by current status, leave type, or employee applicability
        """
        queryset = super().get_queryset()
        
        # Filter by is_current
        is_current = self.request.query_params.get('is_current')
        if is_current == 'true':
            today = timezone.now().date()
            queryset = queryset.filter(
                is_active=True,
                effective_from__lte=today
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
            )
        elif is_current == 'false':
            today = timezone.now().date()
            queryset = queryset.exclude(
                models.Q(
                    is_active=True,
                    effective_from__lte=today
                ) & (
                    models.Q(effective_to__isnull=True) | 
                    models.Q(effective_to__gte=today)
                )
            )
        
        # Filter by leave type
        leave_type = self.request.query_params.get('leave_type')
        if leave_type:
            queryset = queryset.filter(leave_type=leave_type)
        
        # Filter by employee applicability (if employee_id is provided)
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            try:
                employee = Employee.objects.get(id=employee_id)
                # Filter policies that apply to this employee
                applicable_policies = []
                for policy in queryset:
                    if policy.should_apply_to_employee(employee):
                        applicable_policies.append(policy.id)
                queryset = queryset.filter(id__in=applicable_policies)
            except Employee.DoesNotExist:
                pass
        
        # Filter by date range
        start_date = self.request.query_params.get('start_date')
        end_date = self.request.query_params.get('end_date')
        if start_date and end_date:
            queryset = queryset.filter(
                effective_from__lte=end_date
            ).filter(
                models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=start_date)
            )
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def current(self, request):
        """
        Get current active leave policy configurations
        """
        today = timezone.now().date()
        current_policies = LeavePolicyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from')
        
        serializer = self.get_serializer(current_policies, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def employee_policies(self, request):
        """
        Get leave policy configurations for a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        today = timezone.now().date()
        
        # Get active policies
        policies = LeavePolicyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from')
        
        # Filter by applicability
        applicable_policies = []
        for policy in policies:
            if policy.should_apply_to_employee(employee):
                applicable_policies.append(policy)
        
        serializer = self.get_serializer(applicable_policies, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['post'])
    def validate_leave_request(self, request, pk=None):
        """
        Validate a leave request against this policy
        """
        policy = self.get_object()
        
        # Get employee from request data
        employee_id = request.data.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create a mock leave request for validation
        from .models import LeaveRequest
        leave_request_data = {
            'employee': employee,
            'start_date': request.data.get('start_date'),
            'end_date': request.data.get('end_date'),
            'total_days': request.data.get('total_days', 1),
            'leave_type': policy.leave_type
        }
        
        # Validate the leave request
        validation_result = policy.validate_leave_request(
            leave_request_data, employee
        )
        
        return Response(validation_result)
    
    @action(detail=False, methods=['get'])
    def leave_types(self, request):
        """
        Get available leave types
        """
        from .models import LEAVE_TYPE
        leave_types = []
        for leave_type, display_name in LEAVE_TYPE:
            leave_types.append({
                'value': leave_type,
                'display_name': display_name
            })
        
        return Response(leave_types)
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get leave policy configuration statistics
        """
        total = LeavePolicyConfig.objects.count()
        active = LeavePolicyConfig.objects.filter(is_active=True).count()
        current = LeavePolicyConfig.objects.filter(
            is_active=True,
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).count()
        
        # Count by leave type
        from .models import LEAVE_TYPE
        leave_type_stats = []
        for leave_type, display_name in LEAVE_TYPE:
            count = LeavePolicyConfig.objects.filter(leave_type=leave_type).count()
            if count > 0:
                leave_type_stats.append({
                    'leave_type': leave_type,
                    'leave_type_display': display_name,
                    'count': count
                })
        
        # Policies with medical certificate requirement
        requires_medical_certificate = LeavePolicyConfig.objects.filter(
            requires_medical_certificate=True
        ).count()
        
        # Policies requiring approval
        requires_approval = LeavePolicyConfig.objects.filter(
            requires_approval=True
        ).count()
        
        return Response({
            'total': total,
            'active': active,
            'current': current,
            'leave_type_stats': leave_type_stats,
            'requires_medical_certificate': requires_medical_certificate,
            'requires_approval': requires_approval
        })
    
    @action(detail=False, methods=['post'])
    def calculate_advance_notice(self, request):
        """
        Calculate required advance notice for a leave request
        """
        leave_type = request.data.get('leave_type')
        total_days = request.data.get('total_days', 1)
        employee_id = request.data.get('employee_id')
        
        if not leave_type or not employee_id:
            return Response(
                {'error': 'leave_type and employee_id are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        today = timezone.now().date()
        
        # Get applicable policies
        policies = LeavePolicyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today,
            leave_type=leave_type
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from')
        
        # Find policy that applies to employee
        applicable_policy = None
        for policy in policies:
            if policy.should_apply_to_employee(employee):
                applicable_policy = policy
                break
        
        if not applicable_policy:
            return Response({
                'has_policy': False,
                'message': 'No applicable leave policy found for this employee'
            })
        
        # Calculate advance notice
        advance_notice = applicable_policy.calculate_advance_notice(total_days)
        
        return Response({
            'has_policy': True,
            'policy': LeavePolicyConfigListSerializer(applicable_policy).data,
            'advance_notice': advance_notice,
            'emergency_notice_hours': applicable_policy.emergency_notice_hours
        })


class AttendanceRuleEngineAPIView(APIView):
    """
    API endpoint for attendance rule engine calculations
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Calculate attendance status and work hours based on rules
        """
        serializer = AttendanceRuleEngineSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        data = serializer.validated_data
        
        try:
            employee = Employee.objects.get(id=data['employee_id'])
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {data["employee_id"]} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get applicable rules for this employee
        today = timezone.now().date()
        rules = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).filter(
            models.Q(apply_to_employees=employee) |
            models.Q(apply_to_departments=employee.department) |
            models.Q(apply_to_positions=employee.position) |
            models.Q(apply_to_all=True)
        ).distinct()
        
        # Apply rules in order of priority
        calculation_result = {
            'status': 'PRESENT',
            'work_hours': 0.0,
            'work_coefficient': 1.0,
            'late_minutes': 0,
            'early_leave_minutes': 0,
            'applied_rules': [],
            'notes': []
        }
        
        # Apply shift rules first
        shift_rules = rules.filter(rule_type='SHIFT_RULE')
        for rule in shift_rules:
            config = rule.configuration
            # Apply shift rule logic here
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type,
                'configuration': config
            })
        
        # Apply late/early rules
        late_rules = rules.filter(rule_type='LATE_EARLY_RULE')
        for rule in late_rules:
            config = rule.configuration
            # Apply late/early rule logic here
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type,
                'configuration': config
            })
        
        # Apply work hour calculation rules
        work_hour_rules = rules.filter(rule_type='WORK_HOUR_CALCULATION')
        for rule in work_hour_rules:
            config = rule.configuration
            # Apply work hour calculation logic here
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type,
                'configuration': config
            })
        
        # Apply overtime rules
        overtime_rules = rules.filter(rule_type='OVERTIME_RULE')
        for rule in overtime_rules:
            config = rule.configuration
            # Apply overtime rule logic here
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type,
                'configuration': config
            })
        
        # If we have check_in and check_out, calculate basic hours
        if data.get('check_in') and data.get('check_out'):
            from datetime import datetime
            check_in_dt = datetime.combine(data['attendance_date'], data['check_in'])
            check_out_dt = datetime.combine(data['attendance_date'], data['check_out'])
            
            # If check_out < check_in, assume next day
            if data['check_out'] <= data['check_in']:
                check_out_dt = datetime.combine(
                    data['attendance_date'] + timedelta(days=1),
                    data['check_out']
                )
            
            delta = check_out_dt - check_in_dt
            calculation_result['work_hours'] = delta.total_seconds() / 3600
        
        return Response(calculation_result)
    
    @action(detail=False, methods=['get'])
    def test_rule_application(self, request):
        """
        Test rule application for a specific scenario
        """
        employee_id = request.query_params.get('employee_id')
        attendance_date = request.query_params.get('attendance_date')
        check_in = request.query_params.get('check_in')
        check_out = request.query_params.get('check_out')
        shift_type = request.query_params.get('shift_type', 'FULL_DAY')
        
        if not employee_id or not attendance_date:
            return Response(
                {'error': 'employee_id and attendance_date are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Parse dates
        from datetime import datetime
        try:
            attendance_date_obj = datetime.strptime(attendance_date, '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {'error': 'attendance_date must be in YYYY-MM-DD format'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        check_in_obj = None
        if check_in:
            try:
                check_in_obj = datetime.strptime(check_in, '%H:%M:%S').time()
            except ValueError:
                try:
                    check_in_obj = datetime.strptime(check_in, '%H:%M').time()
                except ValueError:
                    return Response(
                        {'error': 'check_in must be in HH:MM or HH:MM:SS format'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
        
        check_out_obj = None
        if check_out:
            try:
                check_out_obj = datetime.strptime(check_out, '%H:%M:%S').time()
            except ValueError:
                try:
                    check_out_obj = datetime.strptime(check_out, '%H:%M').time()
                except ValueError:
                    return Response(
                        {'error': 'check_out must be in HH:MM or HH:MM:SS format'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
        
        # Call the rule engine
        engine_data = {
            'employee_id': employee_id,
            'attendance_date': attendance_date_obj,
            'check_in': check_in_obj,
            'check_out': check_out_obj,
            'shift_type': shift_type
        }
        
        # This would normally call the rule engine logic
        # For now, return a mock response
        return Response({
            'test_scenario': engine_data,
            'applied_rules': [],
            'calculation_result': {
                'status': 'PRESENT',
                'work_hours': 8.0,
                'work_coefficient': 1.0,
                'late_minutes': 0,
                'early_leave_minutes': 0
            },
            'notes': ['Rule engine test mode - actual implementation needed']
        })


# ======================
# RULE ENGINE VIEWSETS
# ======================

from .rule_engine import (
    AttendanceRuleEngine, LeavePolicyEngine, DepartmentRuleManager,
    apply_rules_to_employee_attendance, apply_rules_to_department_attendance,
    validate_employee_leave_request
)


class RuleEngineAPIView(APIView):
    """
    API endpoint for rule engine operations
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """
        Get rule engine information and capabilities
        """
        return Response({
            'name': 'HRM Attendance Rule Engine',
            'version': '1.0.0',
            'capabilities': [
                'Apply attendance rules to employees',
                'Validate leave requests against policies',
                'Generate department compliance reports',
                'Batch process attendance records',
                'Calculate work hours and overtime'
            ],
            'available_engines': [
                'AttendanceRuleEngine',
                'LeavePolicyEngine',
                'DepartmentRuleManager'
            ]
        })


class EmployeeRuleEngineAPIView(APIView):
    """
    API endpoint for employee-specific rule engine operations
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, employee_id):
        """
        Get applicable rules for an employee
        """
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get date parameter (default: today)
        date_str = request.query_params.get('date')
        if date_str:
            try:
                from datetime import datetime
                date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'error': 'Date must be in YYYY-MM-DD format'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            date = None
        
        # Get applicable rules
        attendance_rules = AttendanceRuleEngine.get_applicable_rules_for_employee(employee, date)
        leave_policies = LeavePolicyEngine.get_applicable_policies_for_employee(employee, date)
        
        return Response({
            'employee': {
                'id': employee.id,
                'full_name': employee.full_name,
                'employee_id': employee.employee_id,
                'department': employee.department.name if employee.department else None,
                'position': employee.position.title if employee.position else None
            },
            'date': date or timezone.now().date(),
            'attendance_rules': [
                {
                    'id': rule.id,
                    'code': rule.code,
                    'name': rule.name,
                    'type': rule.rule_type,
                    'configuration': rule.configuration,
                    'effective_from': rule.effective_from,
                    'effective_to': rule.effective_to,
                    'priority': AttendanceRuleEngine._get_rule_priority(rule, employee)
                }
                for rule in attendance_rules
            ],
            'leave_policies': [
                {
                    'id': policy.id,
                    'code': policy.code,
                    'name': policy.name,
                    'type': policy.leave_type,
                    'advance_notice_rules': policy.advance_notice_rules,
                    'max_days_per_year': policy.max_days_per_year,
                    'max_consecutive_days': policy.max_consecutive_days,
                    'effective_from': policy.effective_from,
                    'effective_to': policy.effective_to
                }
                for policy in leave_policies
            ],
            'summary': {
                'total_attendance_rules': len(attendance_rules),
                'total_leave_policies': len(leave_policies),
                'rule_types': list(set([rule.rule_type for rule in attendance_rules])),
                'leave_types': list(set([policy.leave_type for policy in leave_policies]))
            }
        })
    
    def post(self, request, employee_id):
        """
        Apply rules to employee attendance for a specific date
        """
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get date parameter
        date_str = request.data.get('date')
        if not date_str:
            return Response(
                {'error': 'Date is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from datetime import datetime
            date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {'error': 'Date must be in YYYY-MM-DD format'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Apply rules to employee attendance
        result = apply_rules_to_employee_attendance(employee_id, date)
        
        return Response(result)


class DepartmentRuleEngineAPIView(APIView):
    """
    API endpoint for department-specific rule engine operations
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, department_id):
        """
        Get department rules summary and configuration
        """
        try:
            department = Department.objects.get(id=department_id)
        except Department.DoesNotExist:
            return Response(
                {'error': f'Department with ID {department_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get date parameter (default: today)
        date_str = request.query_params.get('date')
        if date_str:
            try:
                from datetime import datetime
                date = datetime.strptime(date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'error': 'Date must be in YYYY-MM-DD format'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            date = None
        
        # Get rule type filter
        rule_type = request.query_params.get('rule_type')
        
        # Get department rules summary
        summary = DepartmentRuleManager.get_department_rules_summary(department, date)
        
        # Get department rule configuration
        configuration = DepartmentRuleManager.get_department_rule_configuration(department, rule_type)
        
        return Response({
            'department': {
                'id': department.id,
                'name': department.name,
                'code': department.code
            },
            'date': date or timezone.now().date(),
            'summary': summary,
            'configuration': configuration
        })
    
    def post(self, request, department_id):
        """
        Apply rules to department attendance for a date range
        """
        try:
            department = Department.objects.get(id=department_id)
        except Department.DoesNotExist:
            return Response(
                {'error': f'Department with ID {department_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get date range parameters
        start_date_str = request.data.get('start_date')
        end_date_str = request.data.get('end_date')
        
        if not start_date_str or not end_date_str:
            return Response(
                {'error': 'start_date and end_date are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from datetime import datetime
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {'error': 'Dates must be in YYYY-MM-DD format'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate date range
        if start_date > end_date:
            return Response(
                {'error': 'start_date must be before or equal to end_date'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Apply rules to department attendance
        result = apply_rules_to_department_attendance(department_id, start_date, end_date)
        
        return Response(result)


class DepartmentComplianceAPIView(APIView):
    """
    API endpoint for department compliance reports
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, department_id):
        """
        Get compliance report for a department
        """
        try:
            department = Department.objects.get(id=department_id)
        except Department.DoesNotExist:
            return Response(
                {'error': f'Department with ID {department_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get date range parameters
        start_date_str = request.query_params.get('start_date')
        end_date_str = request.query_params.get('end_date')
        
        if not start_date_str or not end_date_str:
            # Default to current month
            today = timezone.now().date()
            start_date = today.replace(day=1)
            if today.month == 12:
                end_date = today.replace(year=today.year + 1, month=1, day=1) - timedelta(days=1)
            else:
                end_date = today.replace(month=today.month + 1, day=1) - timedelta(days=1)
        else:
            try:
                from datetime import datetime
                start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
                end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
            except ValueError:
                return Response(
                    {'error': 'Dates must be in YYYY-MM-DD format'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Validate date range
        if start_date > end_date:
            return Response(
                {'error': 'start_date must be before or equal to end_date'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Generate compliance report
        report = DepartmentRuleManager.get_department_rule_compliance_report(
            department, start_date, end_date
        )
        
        return Response(report)


class LeaveValidationAPIView(APIView):
    """
    API endpoint for leave request validation
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Validate a leave request
        """
        employee_id = request.data.get('employee_id')
        leave_type = request.data.get('leave_type')
        start_date = request.data.get('start_date')
        end_date = request.data.get('end_date')
        total_days = request.data.get('total_days', 1)
        
        if not all([employee_id, leave_type, start_date, end_date]):
            return Response(
                {'error': 'Missing required fields: employee_id, leave_type, start_date, end_date'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate leave request
        validation_result = validate_employee_leave_request(employee_id, {
            'leave_type': leave_type,
            'start_date': start_date,
            'end_date': end_date,
            'total_days': total_days
        })
        
        return Response(validation_result)


class RuleApplicationAPIView(APIView):
    """
    API endpoint for applying rules to specific attendance records
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, attendance_id):
        """
        Apply rules to a specific attendance record
        """
        try:
            attendance = Attendance.objects.get(id=attendance_id)
        except Attendance.DoesNotExist:
            return Response(
                {'error': f'Attendance with ID {attendance_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Apply rules to attendance
        calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(attendance)
        
        # Update attendance record with calculation results
        attendance.status = calculation_result.get('status', attendance.status)
        attendance.working_hours = calculation_result.get('work_hours', attendance.working_hours)
        attendance.late_minutes = calculation_result.get('late_minutes', attendance.late_minutes)
        attendance.early_leave_minutes = calculation_result.get('early_leave_minutes', attendance.early_leave_minutes)
        attendance.overtime_hours = calculation_result.get('overtime_hours', attendance.overtime_hours)
        
        # Save the updated attendance
        attendance.save()
        
        # Create rule history records
        from .models import AttendanceRuleHistory
        for rule_info in calculation_result.get('applied_rules', []):
            AttendanceRuleHistory.objects.create(
                attendance=attendance,
                rule_id=rule_info['rule_id'],
                applied_configuration=rule_info,
                calculation_result=calculation_result
            )
        
        return Response({
            'success': True,
            'attendance_id': attendance.id,
            'attendance_code': attendance.attendance_code,
            'calculation_result': calculation_result,
            'updated_fields': {
                'status': attendance.status,
                'working_hours': float(attendance.working_hours),
                'late_minutes': attendance.late_minutes,
                'early_leave_minutes': attendance.early_leave_minutes,
                'overtime_hours': float(attendance.overtime_hours)
            }
        })


class RuleTestAPIView(APIView):
    """
    API endpoint for testing rule application scenarios
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        """
        Test rule application for a specific scenario
        """
        # Get test parameters
        employee_id = request.data.get('employee_id')
        attendance_date = request.data.get('attendance_date')
        check_in = request.data.get('check_in')
        check_out = request.data.get('check_out')
        shift_type = request.data.get('shift_type', 'FULL_DAY')
        
        if not employee_id or not attendance_date:
            return Response(
                {'error': 'employee_id and attendance_date are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Parse dates and times
        from datetime import datetime
        try:
            attendance_date_obj = datetime.strptime(attendance_date, '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {'error': 'attendance_date must be in YYYY-MM-DD format'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        check_in_obj = None
        if check_in:
            try:
                check_in_obj = datetime.strptime(check_in, '%H:%M:%S').time()
            except ValueError:
                try:
                    check_in_obj = datetime.strptime(check_in, '%H:%M').time()
                except ValueError:
                    return Response(
                        {'error': 'check_in must be in HH:MM or HH:MM:SS format'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
        
        check_out_obj = None
        if check_out:
            try:
                check_out_obj = datetime.strptime(check_out, '%H:%M:%S').time()
            except ValueError:
                try:
                    check_out_obj = datetime.strptime(check_out, '%H:%M').time()
                except ValueError:
                    return Response(
                        {'error': 'check_out must be in HH:MM or HH:MM:SS format'},
                        status=status.HTTP_400_BAD_REQUEST
                    )
        
        # Create a test attendance record
        test_attendance = Attendance(
            employee=employee,
            attendance_date=attendance_date_obj,
            check_in=check_in_obj,
            check_out=check_out_obj,
            shift_type=shift_type,
            status='PRESENT',
            working_hours=0.0,
            late_minutes=0,
            early_leave_minutes=0,
            overtime_hours=0.0
        )
        
        # Apply rules to test attendance
        calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(test_attendance)
        
        return Response({
            'test_scenario': {
                'employee_id': employee_id,
                'employee_name': employee.full_name,
                'attendance_date': attendance_date,
                'check_in': check_in,
                'check_out': check_out,
                'shift_type': shift_type
            },
            'calculation_result': calculation_result,
            'rule_application_summary': {
                'total_rules_applied': len(calculation_result.get('applied_rules', [])),
                'final_status': calculation_result.get('status'),
                'calculated_work_hours': calculation_result.get('work_hours'),
                'calculated_overtime_hours': calculation_result.get('overtime_hours')
            }
        })


class ApplyDepartmentRulesToEmployeeAPIView(APIView):
    """
    API endpoint for applying department rules to a new employee
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, employee_id):
        """
        Apply department rules to a new employee
        """
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get department_id from request data
        department_id = request.data.get('department_id')
        if not department_id:
            return Response(
                {'error': 'department_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            department = Department.objects.get(id=department_id)
        except Department.DoesNotExist:
            return Response(
                {'error': f'Department with ID {department_id} does not exist'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Check if employee belongs to this department
        if employee.department != department:
            return Response(
                {'error': f'Employee {employee_id} does not belong to department {department_id}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get applicable rules for the department
        today = timezone.now().date()
        
        # Get attendance rules that apply to this department
        attendance_rules = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).filter(
            models.Q(apply_to_departments=department) | models.Q(apply_to_all=True)
        ).distinct()
        
        # Get leave policies that apply to this department
        leave_policies = LeavePolicyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).filter(
            models.Q(apply_to_departments=department) | models.Q(apply_to_all=True)
        ).distinct()
        
        # Apply rules to employee
        applied_rules = 0
        applied_policies = 0
        
        # For attendance rules, we just need to ensure they apply to the employee
        # The rule engine will automatically apply them when needed
        for rule in attendance_rules:
            # Check if rule already applies to employee
            if not rule.apply_to_employees.filter(id=employee.id).exists():
                # Add employee to rule's apply_to_employees
                rule.apply_to_employees.add(employee)
                applied_rules += 1
        
        # For leave policies, similarly ensure they apply to the employee
        for policy in leave_policies:
            # Check if policy already applies to employee
            if not policy.apply_to_employees.filter(id=employee.id).exists():
                # Add employee to policy's apply_to_employees
                policy.apply_to_employees.add(employee)
                applied_policies += 1
        
        return Response({
            'success': True,
            'message': f'Successfully applied {applied_rules} attendance rules and {applied_policies} leave policies to employee',
            'applied_rules': applied_rules,
            'applied_policies': applied_policies,
            'employee': {
                'id': employee.id,
                'full_name': employee.full_name,
                'employee_id': employee.employee_id
            },
            'department': {
                'id': department.id,
                'name': department.name,
                'code': department.code
            },
            'summary': {
                'total_department_rules': attendance_rules.count(),
                'total_department_policies': leave_policies.count(),
                'rules_applied': applied_rules,
                'policies_applied': applied_policies
            }
        })


from .models import EmployeePermission
from .serializers import (
    EmployeePermissionSerializer, EmployeePermissionListSerializer,
    EmployeePermissionCheckSerializer
)


class EmployeePermissionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing employee permissions
    """
    queryset = EmployeePermission.objects.all().order_by('employee__employee_id')
    serializer_class = EmployeePermissionSerializer
    permission_classes = [IsAuthenticated, StaffReadOnlyPermission]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    
    filterset_fields = [
        'can_approve_attendance', 'can_create_employee', 'can_manage_attendance',
        'can_manage_assets', 'can_approve_leave', 'can_approve_overtime',
        'can_view_all_employees', 'can_manage_departments', 'can_manage_positions',
        'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
        'can_view_reports', 'can_export_reports',
        'can_manage_disciplinary_penalties',
    ]
    
    search_fields = [
        'employee__full_name', 'employee__employee_id', 'employee__department__name',
        'employee__position__title', 'notes'
    ]
    
    ordering_fields = [
        'employee__employee_id', 'employee__full_name', 'created_at', 'updated_at'
    ]
    
    ordering = ['employee__employee_id']
    
    def get_serializer_class(self):
        """
        Return appropriate serializer class based on action
        """
        if self.action == 'list':
            return EmployeePermissionListSerializer
        return EmployeePermissionSerializer
    
    def get_queryset(self):
        """
        Optionally filter by employee_id, department_id, or permission type
        """
        queryset = super().get_queryset()
        
        # Filter by employee_id
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            queryset = queryset.filter(employee_id=employee_id)
        
        # Filter by department_id
        department_id = self.request.query_params.get('department_id')
        if department_id:
            queryset = queryset.filter(employee__department_id=department_id)
        
        # Filter by has_any_permission (check if any permission field is True)
        has_any_permission = self.request.query_params.get('has_any_permission')
        if has_any_permission == 'true':
            # Build a query that checks if any permission field is True
            permission_query = Q()
            for field in [
                'can_approve_attendance', 'can_approve_leave', 'can_approve_overtime',
                'can_create_employee', 'can_edit_employee', 'can_view_all_employees',
                'can_manage_attendance', 'can_import_attendance', 'can_adjust_attendance', 'can_edit_attendance',
                'can_manage_assets', 'can_assign_assets', 'can_approve_asset_requests',
                'can_manage_departments', 'can_manage_positions',
                'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
                'can_view_reports', 'can_export_reports',
                'can_manage_disciplinary_penalties',
            ]:
                permission_query |= Q(**{field: True})
            queryset = queryset.filter(permission_query)
        elif has_any_permission == 'false':
            # Build a query that checks if all permission fields are False
            permission_query = Q()
            for field in [
                'can_approve_attendance', 'can_approve_leave', 'can_approve_overtime',
                'can_create_employee', 'can_edit_employee', 'can_view_all_employees',
                'can_manage_attendance', 'can_import_attendance', 'can_adjust_attendance', 'can_edit_attendance',
                'can_manage_assets', 'can_assign_assets', 'can_approve_asset_requests',
                'can_manage_departments', 'can_manage_positions',
                'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
                'can_view_reports', 'can_export_reports',
                'can_manage_disciplinary_penalties',
            ]:
                permission_query &= Q(**{field: False})
            queryset = queryset.filter(permission_query)
        
        # Filter by specific permission combination
        # Example: can_approve_attendance=true&can_manage_assets=true
        for field in [
            'can_approve_attendance', 'can_create_employee', 'can_manage_attendance',
            'can_manage_assets', 'can_approve_leave', 'can_approve_overtime',
            'can_view_all_employees', 'can_manage_departments', 'can_manage_positions',
            'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
            'can_view_reports', 'can_export_reports',
            'can_manage_disciplinary_penalties',
        ]:
            value = self.request.query_params.get(field)
            if value == 'true':
                queryset = queryset.filter(**{field: True})
            elif value == 'false':
                queryset = queryset.filter(**{field: False})
        
        return queryset
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        """
        Get employee permission statistics
        """
        total = EmployeePermission.objects.count()
        
        # Calculate employees_with_permissions by checking if any permission field is True
        # Since there's no has_any_permission field, we need to check all permission fields
        permission_fields = [
            'can_approve_attendance', 'can_approve_leave', 'can_approve_overtime',
            'can_create_employee', 'can_edit_employee', 'can_view_all_employees',
            'can_manage_attendance', 'can_import_attendance', 'can_adjust_attendance', 'can_edit_attendance',
            'can_manage_assets', 'can_assign_assets', 'can_approve_asset_requests',
            'can_manage_departments', 'can_manage_positions',
            'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
            'can_view_reports', 'can_export_reports',
            'can_manage_disciplinary_penalties',
        ]
        
        # Build a query that checks if any permission field is True
        permission_query = Q()
        for field in permission_fields:
            permission_query |= Q(**{field: True})
        
        employees_with_permissions = EmployeePermission.objects.filter(permission_query).count()

        # Count by permission type
        permission_stats = {}
        permission_fields_with_names = [
            ('can_approve_attendance', 'Phê duyệt công'),
            ('can_create_employee', 'Tạo nhân viên'),
            ('can_manage_attendance', 'Quản lý chấm công'),
            ('can_manage_assets', 'Quản lý tài sản'),
            ('can_approve_leave', 'Phê duyệt nghỉ phép tháng'),
            ('can_approve_overtime', 'Phê duyệt làm thêm giờ'),
            ('can_view_all_employees', 'Xem tất cả nhân viên'),
            ('can_manage_departments', 'Quản lý phòng ban'),
            ('can_manage_positions', 'Quản lý vị trí'),
            ('can_manage_company_config', 'Quản lý cấu hình công ty'),
            ('can_manage_attendance_rules', 'Quản lý quy tắc chấm công'),
            ('can_manage_leave_policies', 'Quản lý chính sách nghỉ phép tháng'),
            ('can_view_reports', 'Xem báo cáo'),
            ('can_export_reports', 'Xuất báo cáo'),
            ('can_manage_disciplinary_penalties', 'Ghi nhận / quản lý phạt biên bản'),
        ]

        for field, display_name in permission_fields_with_names:
            count = EmployeePermission.objects.filter(**{field: True}).count()
            permission_stats[field] = {
                'display_name': display_name,
                'count': count,
                'percentage': round((count / total * 100), 2) if total > 0 else 0
            }

        # Count by department
        from employee.models import Department
        departments = Department.objects.all()
        department_stats = []
        for dept in departments:
            # Count employees in this department who have any permission
            count = EmployeePermission.objects.filter(
                employee__department=dept
            ).filter(permission_query).count()
            if count > 0:
                department_stats.append({
                    'department_id': dept.id,
                    'department_name': dept.name,
                    'count': count
                })
        
        return Response({
            'total': total,
            'employees_with_permissions': employees_with_permissions,
            'employees_without_permissions': total - employees_with_permissions,
            'permission_stats': permission_stats,
            'department_stats': department_stats
        })
    
    @action(detail=False, methods=['get'])
    def employee_permissions(self, request):
        """
        Get permissions for a specific employee
        """
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get or create permission for employee
        permission, created = EmployeePermission.objects.get_or_create(employee=employee)
        
        serializer = self.get_serializer(permission)
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def check_permissions(self, request):
        """
        Check if an employee has specific permissions
        """
        serializer = EmployeePermissionCheckSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        result = serializer.save()
        return Response(result)
    
    @action(detail=False, methods=['get'])
    def my_permissions(self, request):
        """
        Get current user's permissions
        """
        # Get current user's employee
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Employee profile not found for this user'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get or create permission for employee
        permission, created = EmployeePermission.objects.get_or_create(employee=employee)
        
        # Check if user is admin (is_staff or is_superuser)
        is_admin = request.user.is_staff or request.user.is_superuser
        
        # If user is admin, grant all permissions
        if is_admin:
            # Update permission to have all permissions
            for field in [
                'can_approve_attendance', 'can_create_employee', 'can_manage_attendance',
                'can_edit_attendance', 'can_manage_assets', 'can_approve_leave', 'can_approve_overtime',
                'can_view_all_employees', 'can_manage_departments', 'can_manage_positions',
                'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
                'can_view_reports', 'can_export_reports',
                'can_manage_disciplinary_penalties',
            ]:
                setattr(permission, field, True)
            permission.save()
        
        serializer = self.get_serializer(permission)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def permission_summary(self, request):
        """
        Get summary of permissions for current user
        """
        # Get current user's employee
        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return Response(
                {'error': 'Employee profile not found for this user'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get or create permission for employee
        permission, created = EmployeePermission.objects.get_or_create(employee=employee)
        
        # Check if user is admin (is_staff or is_superuser)
        is_admin = request.user.is_staff or request.user.is_superuser
        
        # If user is admin, grant all permissions
        if is_admin:
            permission_summary = {
                'is_admin': True,
                'has_all_permissions': True,
                'permissions': {
                    'can_approve_attendance': True,
                    'can_create_employee': True,
                    'can_manage_attendance': True,
                    'can_manage_assets': True,
                    'can_approve_leave': True,
                    'can_approve_overtime': True,
                    'can_view_all_employees': True,
                    'can_manage_departments': True,
                    'can_manage_positions': True,
                    'can_manage_company_config': True,
                    'can_manage_attendance_rules': True,
                    'can_manage_leave_policies': True,
                    'can_view_reports': True,
                    'can_export_reports': True,
                    'can_edit_attendance': True,
                    'can_manage_disciplinary_penalties': True,
                },
                'permission_summary': permission.get_permission_summary()
            }
        else:
            # Calculate if employee has any permission by checking all permission fields
            has_any_permission = any([
                permission.can_approve_attendance,
                permission.can_create_employee,
                permission.can_manage_attendance,
                permission.can_manage_assets,
                permission.can_approve_leave,
                permission.can_approve_overtime,
                permission.can_view_all_employees,
                permission.can_manage_departments,
                permission.can_manage_positions,
                permission.can_manage_company_config,
                permission.can_manage_attendance_rules,
                permission.can_manage_leave_policies,
                permission.can_view_reports,
                permission.can_export_reports,
                permission.can_edit_attendance,
                permission.can_manage_disciplinary_penalties,
            ])
            
            permission_summary = {
                'is_admin': False,
                'has_all_permissions': has_any_permission,
                'permissions': {
                    'can_approve_attendance': permission.can_approve_attendance,
                    'can_create_employee': permission.can_create_employee,
                    'can_manage_attendance': permission.can_manage_attendance,
                    'can_manage_assets': permission.can_manage_assets,
                    'can_approve_leave': permission.can_approve_leave,
                    'can_approve_overtime': permission.can_approve_overtime,
                    'can_view_all_employees': permission.can_view_all_employees,
                    'can_manage_departments': permission.can_manage_departments,
                    'can_manage_positions': permission.can_manage_positions,
                    'can_manage_company_config': permission.can_manage_company_config,
                    'can_manage_attendance_rules': permission.can_manage_attendance_rules,
                    'can_manage_leave_policies': permission.can_manage_leave_policies,
                    'can_view_reports': permission.can_view_reports,
                    'can_export_reports': permission.can_export_reports,
                    'can_edit_attendance': permission.can_edit_attendance,
                    'can_manage_disciplinary_penalties': permission.can_manage_disciplinary_penalties,
                },
                'permission_summary': permission.get_permission_summary()
            }
        
        return Response(permission_summary)
    
    @action(detail=False, methods=['post'])
    def bulk_update(self, request):
        """
        Bulk update permissions for multiple employees
        """
        data = request.data
        if not isinstance(data, list):
            return Response(
                {'error': 'Expected a list of permission updates'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        updated = []
        errors = []
        
        for idx, item in enumerate(data):
            employee_id = item.get('employee_id')
            if not employee_id:
                errors.append({
                    'index': idx,
                    'data': item,
                    'error': 'employee_id is required'
                })
                continue
            
            try:
                employee = Employee.objects.get(id=employee_id)
            except Employee.DoesNotExist:
                errors.append({
                    'index': idx,
                    'data': item,
                    'error': f'Employee with ID {employee_id} does not exist'
                })
                continue
            
            # Get or create permission
            permission, created = EmployeePermission.objects.get_or_create(employee=employee)
            
            # Update permission fields
            for field in [
                'can_approve_attendance', 'can_create_employee', 'can_manage_attendance',
                'can_manage_assets', 'can_approve_leave', 'can_approve_overtime',
                'can_view_all_employees', 'can_manage_departments', 'can_manage_positions',
                'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
                'can_view_reports', 'can_export_reports',
                'can_manage_disciplinary_penalties',
                'notes'
            ]:
                if field in item:
                    setattr(permission, field, item[field])
            
            permission.save()
            updated.append(permission.id)
        
        return Response({
            'updated': len(updated),
            'updated_ids': updated,
            'errors': errors,
            'message': f'Successfully updated {len(updated)} permissions'
        })
    
    @action(detail=False, methods=['get'])
    def export(self, request):
        """
        Export permissions to CSV
        """
        import csv
        from django.http import HttpResponse
        
        # Create the HttpResponse object with CSV header
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="employee_permissions.csv"'
        
        writer = csv.writer(response)
        
        # Write header
        writer.writerow([
            'Mã nhân viên', 'Họ tên', 'Phòng ban', 'Vị trí',
            'Phê duyệt công', 'Tạo nhân viên', 'Quản lý chấm công', 'Quản lý tài sản',
            'Phê duyệt nghỉ phép', 'Phê duyệt làm thêm giờ', 'Xem tất cả nhân viên',
            'Quản lý phòng ban', 'Quản lý vị trí', 'Quản lý cấu hình công ty',
            'Quản lý quy tắc chấm công', 'Quản lý chính sách nghỉ phép',
            'Xem báo cáo', 'Xuất báo cáo', 'Quản lý phạt biên bản',
            'Ghi chú', 'Ngày tạo', 'Ngày cập nhật'
        ])
        
        # Get queryset with filters
        queryset = self.get_queryset()
        
        # Write data rows
        for permission in queryset:
            writer.writerow([
                permission.employee.employee_id if permission.employee else '',
                permission.employee.full_name if permission.employee else '',
                permission.employee.department.name if permission.employee and permission.employee.department else '',
                permission.employee.position.title if permission.employee and permission.employee.position else '',
                'Có' if permission.can_approve_attendance else 'Không',
                'Có' if permission.can_create_employee else 'Không',
                'Có' if permission.can_manage_attendance else 'Không',
                'Có' if permission.can_manage_assets else 'Không',
                'Có' if permission.can_approve_leave else 'Không',
                'Có' if permission.can_approve_overtime else 'Không',
                'Có' if permission.can_view_all_employees else 'Không',
                'Có' if permission.can_manage_departments else 'Không',
                'Có' if permission.can_manage_positions else 'Không',
                'Có' if permission.can_manage_company_config else 'Không',
                'Có' if permission.can_manage_attendance_rules else 'Không',
                'Có' if permission.can_manage_leave_policies else 'Không',
                'Có' if permission.can_view_reports else 'Không',
                'Có' if permission.can_export_reports else 'Không',
                'Có' if permission.can_manage_disciplinary_penalties else 'Không',
                permission.notes or '',
                permission.created_at.strftime('%Y-%m-%d %H:%M:%S') if permission.created_at else '',
                permission.updated_at.strftime('%Y-%m-%d %H:%M:%S') if permission.updated_at else ''
            ])
        
        return response


# ======================
# PRINT ATTENDANCE EXPLANATION VIEW
# ======================
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_GET
from django.shortcuts import get_object_or_404, render
from django.http import HttpResponseForbidden
from .models import AttendanceExplanation, Employee
from django.http import HttpResponse

# ===========================================================================================
# CẬP NHẬT hrm/views.py - KIỂM TRA CÙNG NHÂN VIÊN
# ===========================================================================================

@login_required
@require_GET
def print_attendance_explanation_multiple(request):
    """
    View để in nhiều phiếu giải trình chấm công cùng lúc (tối đa 3)
    TẤT CẢ PHIẾU PHẢI CÙNG MỘT NHÂN VIÊN
    """
    # Lấy danh sách IDs từ query parameter
    ids_str = request.GET.get('ids', '')
    
    if not ids_str:
        return HttpResponse("Không có phiếu giải trình nào được chọn", status=400)
    
    # Parse IDs
    try:
        ids = [int(id.strip()) for id in ids_str.split(',') if id.strip()]
    except ValueError:
        return HttpResponse("ID không hợp lệ", status=400)
    
    # Kiểm tra số lượng (tối đa 3)
    if len(ids) == 0:
        return HttpResponse("Vui lòng chọn ít nhất một phiếu giải trình", status=400)
    
    if len(ids) > 3:
        return HttpResponse("Chỉ được phép in tối đa 3 phiếu cùng lúc", status=400)
    
    # Lấy các giải trình
    explanations = AttendanceExplanation.objects.filter(id__in=ids).select_related(
        'employee',
        'employee__department',
        'direct_manager_approved_by',
        'hr_approved_by',
        'approved_by'
    ).order_by('attendance_date')
    
    if not explanations.exists():
        return HttpResponse("Không tìm thấy phiếu giải trình", status=404)
    
    # KIỂM TRA TẤT CẢ PHIẾU PHẢI CÙNG MỘT NHÂN VIÊN
    # Lấy danh sách các employee.id (không phải explanation.id)
    unique_employee_ids = set(explanations.values_list('employee_id', flat=True))
    
    if len(unique_employee_ids) > 1:
        # Lấy tên các nhân viên để hiển thị thông báo rõ ràng
        employee_names = list(explanations.values_list('employee__full_name', flat=True).distinct())
        return HttpResponse(
            "Tất cả phiếu giải trình phải thuộc về cùng một nhân viên. "
            f"Bạn đã chọn phiếu của {len(unique_employee_ids)} nhân viên khác nhau: {', '.join(employee_names)}.",
            status=400
        )
    
    # Kiểm tra quyền truy cập
    employee_of_explanations = explanations.first().employee
    
    if not (request.user.is_staff or request.user.is_superuser):
        try:
            employee = Employee.objects.get(user=request.user)
            
            # Kiểm tra quyền xem
            if employee_of_explanations != employee:
                # Kiểm tra xem người dùng có phải là quản lý trực tiếp hoặc trưởng phòng không
                is_direct_manager = employee_of_explanations.manager == employee
                is_department_manager = (
                    employee_of_explanations.department and 
                    employee_of_explanations.department.manager == employee
                )
                
                if not (is_direct_manager or is_department_manager):
                    return HttpResponse(
                        f"Bạn không có quyền xem phiếu giải trình của nhân viên này",
                        status=403
                    )
        except Employee.DoesNotExist:
            return HttpResponse("Bạn không có quyền xem các phiếu giải trình này", status=403)
    
    # Chuẩn bị dữ liệu cho template
    context = {
        'explanations': explanations,
        'company_name': branding.company_legal_name(),
        'print_date': timezone.now().strftime('%d/%m/%Y %H:%M'),
        'user': request.user,
        'today': timezone.now(),
        'count': explanations.count(),
    }
    
    # Render template
    return render(request, 'hrm/print_attendance_explanation_multiple.html', context)


@login_required
@require_GET
def print_attendance_explanation(request, explanation_id):
    """
    View để in phiếu giải trình chấm công (đơn lẻ - giữ lại để tương thích ngược)
    """
    # Redirect sang view mới với single ID
    from django.shortcuts import redirect
    from django.urls import reverse
    
    url = reverse('print-attendance-explanation-multiple') + f'?ids={explanation_id}'
    return redirect(url)


@login_required
@require_GET
def print_multiple_attendance_explanations(request):
    """
    View để in nhiều phiếu giải trình chấm công cùng lúc
    Mỗi record sẽ hiển thị trên một dòng trong bảng
    """
    # Lấy danh sách ID từ query parameters
    explanation_ids = request.GET.get('ids', '')
    if not explanation_ids:
        from django.http import HttpResponseBadRequest
        return HttpResponseBadRequest("Thiếu tham số ids")
    
    # Chuyển chuỗi ID thành danh sách
    try:
        id_list = [int(id_str.strip()) for id_str in explanation_ids.split(',') if id_str.strip()]
    except ValueError:
        from django.http import HttpResponseBadRequest
        return HttpResponseBadRequest("Định dạng ids không hợp lệ")
    
    if not id_list:
        from django.http import HttpResponseBadRequest
        return HttpResponseBadRequest("Danh sách ids trống")
    
    # Lấy tất cả giải trình
    explanations = AttendanceExplanation.objects.filter(id__in=id_list)
    
    # Kiểm tra quyền truy cập cho từng giải trình
    if not (request.user.is_staff or request.user.is_superuser):
        # Kiểm tra xem người dùng có phải là nhân viên không
        try:
            employee = Employee.objects.get(user=request.user)
            # Lọc các giải trình mà người dùng có quyền xem
            accessible_explanations = []
            for explanation in explanations:
                if explanation.employee == employee:
                    accessible_explanations.append(explanation)
                else:
                    # Kiểm tra xem người dùng có phải là quản lý trực tiếp hoặc trưởng phòng không
                    is_direct_manager = explanation.employee.manager == employee
                    is_department_manager = explanation.employee.department and explanation.employee.department.manager == employee
                    
                    if is_direct_manager or is_department_manager:
                        accessible_explanations.append(explanation)
            
            explanations = accessible_explanations
            
            if not explanations:
                from django.http import HttpResponseForbidden
                return HttpResponseForbidden("Bạn không có quyền xem bất kỳ giải trình nào trong danh sách")
                
        except Employee.DoesNotExist:
            # Người dùng không phải là nhân viên
            from django.http import HttpResponseForbidden
            return HttpResponseForbidden("Bạn không có quyền xem giải trình này")
    
    # Sắp xếp theo ID để giữ nguyên thứ tự
    explanations = sorted(explanations, key=lambda x: id_list.index(x.id))
    
    # Chuẩn bị dữ liệu cho template
    context = {
        'explanations': explanations,
        'company_name': branding.company_legal_name(),
        'print_date': timezone.now().strftime('%d/%m/%Y %H:%M'),
        'user': request.user,
        'today': timezone.now(),
        'total_count': len(explanations),
    }
    
    # Render template mới cho in nhiều giải trình
    return render(request, 'hrm/print_multiple_attendance_explanations.html', context)

class OnboardingProcessViewSet(viewsets.ModelViewSet):
    """ViewSet cho OnboardingProcess"""
    permission_classes = [IsAuthenticated]
    pagination_class = OnboardingResultsSetPagination
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        'onboarding_code',
        'desired_employee_id',
        'candidate_name',
        'employee__employee_id',
        'employee__full_name',
    ]
    ordering_fields = ['created_at', 'start_date', 'candidate_name', 'onboarding_code']
    ordering = ['-created_at']
    
    def get_queryset(self):
        user = self.request.user
        
        base_qs = OnboardingProcess.objects.all().select_related(
            'position', 'department', 'direct_manager',
            'hr_responsible', 'employee', 'created_by'
        ).prefetch_related('tasks', 'documents', 'documents__uploaded_by', 'documents__template_source', 'documents__template_source__created_by')

        if user.is_superuser or user.is_staff:
            qs = base_qs
        else:
            try:
                from employee.models import Employee
                employee = Employee.objects.select_related('position').get(user=user)

                if employee.is_hr:
                    qs = base_qs
                else:
                    MANAGER_POSITIONS = ['TP AI', 'Leader', 'Trưởng phòng tập sự', 'Phó phòng', 'Trưởng phòng', 'Phó Giám đốc', 'Giám đốc', 'Chủ tịch']
                    is_manager = (
                        (employee.position and employee.position.title in MANAGER_POSITIONS) or
                        (employee.rank and employee.rank in MANAGER_POSITIONS)
                    )

                    if is_manager:
                        qs = base_qs.filter(direct_manager=employee)
                    else:
                        # Nhân viên thường chỉ xem onboarding của chính mình
                        qs = base_qs.filter(employee=employee)

            except Employee.DoesNotExist:
                return OnboardingProcess.objects.none()

        # Lọc theo status
        status = self.request.query_params.get('status')
        valid_statuses = [s[0] for s in OnboardingProcess.status.field.choices]
        if status:
            if status not in valid_statuses:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({'status': f"Giá trị không hợp lệ. Các giá trị hợp lệ: {valid_statuses}"})
            qs = qs.filter(status=status)

        # Lọc theo tháng/năm (dựa trên start_date)
        month_str = self.request.query_params.get('month')
        year_str = self.request.query_params.get('year')
        if month_str or year_str:
            from rest_framework.exceptions import ValidationError
            try:
                month_val = int(month_str) if month_str else None
                year_val = int(year_str) if year_str else None
            except ValueError:
                raise ValidationError({'detail': 'month và year phải là số nguyên hợp lệ.'})
            if month_val is not None and not (1 <= month_val <= 12):
                raise ValidationError({'month': 'Tháng phải nằm trong khoảng 1–12.'})
            if month_val and year_val:
                qs = qs.filter(start_date__month=month_val, start_date__year=year_val)
            elif year_val:
                qs = qs.filter(start_date__year=year_val)

        # Lọc theo vị trí tuyển dụng
        position_id = self.request.query_params.get('position')
        if position_id:
            try:
                qs = qs.filter(position_id=int(position_id))
            except (ValueError, TypeError):
                from rest_framework.exceptions import ValidationError
                raise ValidationError({'position': 'position phải là số nguyên (Position.id).'})

        return qs

    
    def get_serializer_class(self):
        """Chọn serializer phù hợp với action"""
        if self.action == 'list':
            return OnboardingProcessListSerializer
        elif self.action == 'create':
            return OnboardingProcessCreateSerializer
        elif self.action in ['update', 'partial_update']:
            return OnboardingProcessUpdateSerializer
        return OnboardingProcessDetailSerializer

    _ONBOARDING_FILE_FIELDS = {
        'cv_file': 'onboarding/cv',
        'id_card_front': 'onboarding/id_cards',
        'id_card_back': 'onboarding/id_cards',
        'diploma_file': 'onboarding/diplomas',
    }

    def _upload_onboarding_files(self):
        """Upload onboarding file fields to Cloudfly S3 and return extra kwargs"""
        from .utils import upload_file_to_cloudfly
        extra = {}
        for field_name, folder in self._ONBOARDING_FILE_FIELDS.items():
            file = self.request.FILES.get(field_name)
            if file:
                try:
                    extra[field_name] = upload_file_to_cloudfly(file, folder)
                except Exception as e:
                    logger.error(f"Failed to upload {field_name} to Cloudfly: {str(e)}")
                    raise
        return extra

    @action(detail=False, methods=['get'], url_path='stats')
    def stats(self, request):
        """Tổng hợp số liệu phân loại onboarding cho dashboard.

        Trả về:
        - total: tổng số onboarding (đã filter theo quyền + tháng/năm nếu có)
        - quit_within_3_days / quit_within_7_days: NV nghỉ trong vòng 3 / 7 ngày
          kể từ ngày bắt đầu thử việc (Employee.end_date - Employee.start_date)
        - passed_probation: NV đã pass thử việc — có official_start_date và chưa nghỉ
        - by_position: breakdown theo vị trí tuyển dụng (Position.title -> count)
        """
        from datetime import date
        qs = self.filter_queryset(self.get_queryset())

        total = qs.count()
        quit_within_3 = 0
        quit_within_7 = 0
        passed = 0
        per_position = {}

        today = date.today()
        for ob in qs.iterator():
            position_title = ob.position.title if ob.position else 'Khác'
            per_position[position_title] = per_position.get(position_title, 0) + 1

            emp = ob.employee
            if not emp:
                continue

            # NV nghỉ — Employee.end_date đã set
            if emp.end_date and emp.start_date:
                days_worked = (emp.end_date - emp.start_date).days
                if days_worked <= 3:
                    quit_within_3 += 1
                if days_worked <= 7:
                    quit_within_7 += 1
                continue

            # Pass thử việc — có ngày lên chính thức + ngày đó <= hôm nay + chưa nghỉ
            official = getattr(emp, 'official_start_date', None)
            if official and official <= today:
                passed += 1

        by_position = sorted(
            [{'position': name, 'count': cnt} for name, cnt in per_position.items()],
            key=lambda x: -x['count'],
        )

        return Response({
            'total': total,
            'quit_within_3_days': quit_within_3,
            'quit_within_7_days': quit_within_7,
            'passed_probation': passed,
            'by_position': by_position,
        })

    def perform_create(self, serializer):
        extra = self._upload_onboarding_files()
        onboarding = serializer.save(**extra)
        # Auto-start: tạo User + Employee, bump status IN_PROGRESS,
        # bật tất cả tasks IN_PROGRESS. DocumentTemplates đã auto-apply
        # trong save() (create_default_tasks + apply_document_templates).
        try:
            onboarding.start_process()
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                f"Auto-start failed for onboarding {onboarding.onboarding_code}: {e}"
            )

    def perform_update(self, serializer):
        extra = self._upload_onboarding_files()
        serializer.save(**extra)

    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        """Bắt đầu quy trình onboarding"""
        onboarding = self.get_object()
        
        if onboarding.start_process():
            return Response({
                'success': True,
                'message': 'Đã bắt đầu quy trình onboarding',
                'data': OnboardingProcessDetailSerializer(onboarding).data
            })
        
        return Response({
            'success': False,
            'message': 'Không thể bắt đầu quy trình onboarding'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Hoàn thành quy trình onboarding"""
        onboarding = self.get_object()
        result = onboarding.complete_process()
        
        if result['success']:
            return Response({
                'success': True,
                'message': result['message'],
                'data': OnboardingProcessDetailSerializer(onboarding).data
            })
        
        return Response({
            'success': False,
            'message': result['message']
        }, status=status.HTTP_400_BAD_REQUEST)
    
    
    @action(detail=True, methods=['get'])
    def tasks(self, request, pk=None):
        """Lấy danh sách tasks của onboarding process"""
        onboarding = self.get_object()
        tasks = onboarding.tasks.all().order_by('order')
        serializer = OnboardingTaskSerializer(tasks, many=True)
        return Response(serializer.data)
    
    @action(detail=True, methods=['get'])
    def documents(self, request, pk=None):
        """Lấy danh sách documents của onboarding process"""
        onboarding = self.get_object()
        documents = onboarding.documents.all().order_by('-uploaded_at')
        serializer = OnboardingDocumentSerializer(documents, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """Thống kê onboarding"""
        from django.db.models import Count, Q
        
        queryset = self.get_queryset()
        
        stats = {
            'total': queryset.count(),
            'by_status': queryset.values('status').annotate(count=Count('id')),
            'in_progress': queryset.filter(status='IN_PROGRESS').count(),
            'completed': queryset.filter(status='COMPLETED').count(),
            'pending': queryset.filter(status='PENDING').count(),
            'this_month': queryset.filter(
                start_date__month=timezone.now().month,
                start_date__year=timezone.now().year
            ).count()
        }
        
        return Response(stats)
    
    @action(detail=True, methods=['post', 'put'])
    def submit_employee_info(self, request, pk=None):
        """
        Nhân viên điền thông tin cá nhân (35+ fields)
        Tự động hoàn thành 4 tasks đầu tiên khi submit
        
        POST/PUT /api-hrm/onboardings/{id}/submit-employee-info/
        
        Body: {
            "candidate_name": "Nguyễn Văn A",
            "candidate_phone": "0123456789",
            "candidate_email": "nva@example.com",
            "date_of_birth": "1990-01-01",
            "gender": "M",
            "education_level": "Đại học",
            "facebook_link": "https://facebook.com/...",
            "region": "Miền Bắc",
            "block": "Khối Y tế",
            ... (35+ fields)
        }
        """
        
        onboarding = self.get_object()
        
        # Kiểm tra quyền: chỉ owner hoặc HR mới được submit
        user = request.user
        is_owner = False
        is_hr = False
        
        # Check if user is owner
        if onboarding.employee and onboarding.employee.user == user:
            is_owner = True
        
        # Check if user is HR
        try:
            employee = Employee.objects.get(user=user)
            is_hr = employee.is_hr or (employee.position and 'HR' in employee.position.title.upper())
        except Employee.DoesNotExist:
            pass
        
        if not (is_owner or is_hr or user.is_staff or user.is_superuser):
            return Response({
                'success': False,
                'message': 'Bạn không có quyền cập nhật thông tin này'
            }, status=status.HTTP_403_FORBIDDEN)
        
        # Sử dụng OnboardingProcessCreateSerializer để validate và update
        serializer = OnboardingProcessCreateSerializer(
            onboarding,
            data=request.data,
            partial=True,
            context={'request': request}
        )
        
        if not serializer.is_valid():
            return Response({
                'success': False,
                'errors': serializer.errors
            }, status=status.HTTP_400_BAD_REQUEST)
        
        # Lưu thông tin
        updated_onboarding = serializer.save()
        
        # ===== TỰ ĐỘNG HOÀN THÀNH 4 TASKS ĐẦU TIÊN =====
        tasks_to_complete = updated_onboarding.tasks.filter(
            order__lte=4,
            status='PENDING'
        )
        
        completed_tasks = []
        for task in tasks_to_complete:
            if task.complete_task(completion_note="Tự động hoàn thành khi nhân viên điền thông tin"):
                completed_tasks.append({
                    'id': task.id,
                    'name': task.name,
                    'order': task.order
                })
                logger.info(f"Auto-completed task {task.id}: {task.name}")
        
        return Response({
            'success': True,
            'message': f'Đã cập nhật thông tin và hoàn thành {len(completed_tasks)} công việc',
            'data': OnboardingProcessDetailSerializer(updated_onboarding).data,
            'completed_tasks': completed_tasks,
            'completed_count': len(completed_tasks)
        })
    @action(detail=True, methods=['post'])
    def generate_employee_token(self, request, pk=None):
        """
        Tạo token cho nhân viên để điền thông tin
        POST /api-hrm/onboardings/{id}/generate-employee-token/
        """
        import secrets

        onboarding = self.get_object()

        if onboarding.employee_info_completed:
            return Response({
                'success': False,
                'message': 'Nhân viên đã hoàn thành việc điền thông tin. Không thể tạo lại link.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Tạo token mới
        token = onboarding.generate_employee_token()
        
        # Lấy URL form
        employee_form_url = onboarding.get_employee_form_url()
        
        return Response({
            'success': True,
            'message': 'Đã tạo link cho nhân viên',
            'data': {
                'token': token,
                'employee_form_url': employee_form_url,
                'expires_at': onboarding.token_expires_at
            }
        })

    @action(detail=True, methods=['post'])
    def send_employee_email(self, request, pk=None):
        """
        Gửi email cho nhân viên với link điền thông tin
        POST /api-hrm/onboardings/{id}/send-employee-email/
        """
        
        onboarding = self.get_object()
        
        # Tạo token nếu chưa có
        if not onboarding.employee_token:
            onboarding.generate_employee_token()
        
        employee_form_url = onboarding.get_employee_form_url()
        
        # Log email details
        logger.info(f"""
        ====================================
        EMAIL CHO NHÂN VIÊN MỚI
        ====================================
        To: {onboarding.candidate_email}
        Subject: Hoàn thành thông tin onboarding - {onboarding.onboarding_code}
        
        Xin chào {onboarding.candidate_name},
        
        Chào mừng bạn đến với công ty!
        
        Để hoàn tất quy trình onboarding, vui lòng truy cập link dưới đây:
        {employee_form_url}
        
        Link có hiệu lực đến: {onboarding.token_expires_at.strftime("%d/%m/%Y %H:%M")}
        
        Nếu có thắc mắc, vui lòng liên hệ HR.
        
        Trân trọng,
        Phòng Nhân sự
        ====================================
        """)
        
        # Nếu có cấu hình email, gửi thật
        try:
            from django.conf import settings
            from hrm.utils import send_email_via_gmail
            
            subject = f'Hoàn thành thông tin onboarding - {onboarding.onboarding_code}'
            message = f'''
    Xin chào {onboarding.candidate_name},

    Chào mừng bạn đến với công ty! 

    Để hoàn tất quy trình onboarding, vui lòng truy cập link dưới đây để điền thông tin cá nhân:

    {employee_form_url}

    Link này có hiệu lực đến {onboarding.token_expires_at.strftime("%d/%m/%Y %H:%M")}.

    Nếu có thắc mắc, vui lòng liên hệ HR.

    Trân trọng,
    Phòng Nhân sự
                '''
            
            # Send via Gmail API
            success = send_email_via_gmail(
                to=onboarding.candidate_email,
                subject=subject,
                body=message
            )
            
            if success:
                return Response({
                    'success': True,
                    'message': f'Đã gửi email đến {onboarding.candidate_email} via Gmail API'
                })
            else:
                logger.error(f"Failed to send email to {onboarding.candidate_email} via Gmail API")
                return Response({
                    'success': False,
                    'message': f'Không thể gửi email đến {onboarding.candidate_email}. Vui lòng kiểm tra cấu hình Gmail API.',
                    'error': 'Gmail API error'
                })
                
        except Exception as e:
            logger.error(f"Failed to send email: {str(e)}")
            return Response({
                'success': False,
                'message': f'Lỗi khi gửi email: {str(e)}',
                'error': str(e)
            }, status=400)

    @action(detail=True, methods=['get'])
    def employee_info_status(self, request, pk=None):
        """
        Kiểm tra trạng thái điền thông tin của nhân viên
        GET /api-hrm/onboardings/{id}/employee-info-status/
        """
        onboarding = self.get_object()
        
        return Response({
            'onboarding_code': onboarding.onboarding_code,
            'employee_info_completed': onboarding.employee_info_completed,
            'completed_at': onboarding.employee_info_completed_at,
            'token_valid': onboarding.is_token_valid() if onboarding.employee_token else False,
            'token_expires_at': onboarding.token_expires_at,
            'employee_form_url': onboarding.get_employee_form_url() if onboarding.employee_token else None
        })
    @action(detail=True, methods=['post'])
    def resend_welcome_email(self, request, pk=None):
        """
        Gửi lại email chào mừng cho nhân viên
        POST /api-hrm/onboardings/{id}/resend-welcome-email/
        """
        import logging
        logger = logging.getLogger(__name__)
        
        onboarding = self.get_object()
        
        # Kiểm tra có employee không
        if not onboarding.employee:
            return Response({
                'success': False,
                'message': 'Onboarding chưa có nhân viên được tạo'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        employee = onboarding.employee
        user = employee.user
        
        # Lấy token (hoặc tạo mới nếu chưa có/hết hạn)
        if not onboarding.employee_token or not onboarding.is_token_valid():
            token = onboarding.generate_employee_token()
            logger.info(f"Generated new token for onboarding {onboarding.id}")
        else:
            token = onboarding.employee_token
        
        # Lấy password (giả định đã có method này)
        from hrm.serializers import OnboardingProcessCreateSerializer
        serializer_instance = OnboardingProcessCreateSerializer()
        password = serializer_instance.generate_default_password(employee.employee_id)
        
        # Gửi email
        try:
            success = serializer_instance.send_welcome_email(
                user=user,
                password=password,
                employee=employee,
                onboarding=onboarding,
                token=token
            )
            
            if success:
                return Response({
                    'success': True,
                    'message': f'Đã gửi lại email đến {employee.personal_email}'
                })
            else:
                return Response({
                    'success': False,
                    'message': 'Gửi email thất bại. Vui lòng kiểm tra log.'
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
                
        except Exception as e:
            logger.error(f"Failed to resend welcome email: {str(e)}")
            return Response({
                'success': False,
                'message': f'Lỗi khi gửi email: {str(e)}'
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class OnboardingTaskViewSet(viewsets.ModelViewSet):
    """ViewSet cho OnboardingTask"""
    permission_classes = [IsAuthenticated]
    serializer_class = OnboardingTaskSerializer
    
    def get_queryset(self):
        """Lọc tasks dựa trên onboarding_process_id"""
        onboarding_id = self.request.query_params.get('onboarding_process')
        
        queryset = OnboardingTask.objects.all().select_related(
            'onboarding_process', 'assigned_to'
        ).prefetch_related('checklist_items')
        
        if onboarding_id:
            queryset = queryset.filter(onboarding_process_id=onboarding_id)
        
        return queryset.order_by('order')
    
    def get_serializer_class(self):
        if self.action in ['update', 'partial_update']:
            return OnboardingTaskUpdateSerializer
        return OnboardingTaskSerializer

    def perform_update(self, serializer):
        """Upload attachment to Cloudfly S3 if provided"""
        extra = {}
        file = self.request.FILES.get('attachment')
        if file:
            try:
                from .utils import upload_file_to_cloudfly
                extra['attachment'] = upload_file_to_cloudfly(file, 'onboarding/tasks')
            except Exception as e:
                logger.error(f"Failed to upload task attachment to Cloudfly: {str(e)}")
                raise
        serializer.save(**extra)
    
    @action(detail=True, methods=['post'])
    def start(self, request, pk=None):
        """Bắt đầu task"""
        task = self.get_object()
        
        if task.start_task():
            return Response({
                'success': True,
                'message': 'Đã bắt đầu task',
                'data': OnboardingTaskSerializer(task).data
            })
        
        return Response({
            'success': False,
            'message': 'Không thể bắt đầu task'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Hoàn thành task"""
        task = self.get_object()
        completion_note = request.data.get('completion_note', '')

        # Kiểm tra quyền cho manager
        try:
            from employee.models import Employee
            employee = Employee.objects.select_related('position').get(user=request.user)
            is_manager = employee.position and employee.position.is_management
            is_hr = employee.is_hr

            # Manager chỉ được complete task order=1
            if is_manager and not is_hr:
                if task.order != 1:
                    return Response({
                        'success': False,
                        'message': 'Bạn chỉ có quyền duyệt task điền thông tin nhân sự'
                    }, status=status.HTTP_403_FORBIDDEN)
        except Employee.DoesNotExist:
            pass

        # Task READ_REGULATION chỉ complete được khi có tài liệu REGULATION và đã đọc hết
        if task.task_code == 'READ_REGULATION':
            required_docs = task.onboarding_process.documents.filter(
                document_type='REGULATION',
                is_required=True,
            )
            if not required_docs.exists():
                return Response({
                    'success': False,
                    'message': 'Chưa có tài liệu nội quy nào được gán cho onboarding này.'
                }, status=status.HTTP_400_BAD_REQUEST)
            unread_count = required_docs.filter(is_read=False).count()
            if unread_count > 0:
                return Response({
                    'success': False,
                    'message': f'Nhân viên chưa đọc {unread_count} tài liệu nội quy bắt buộc.'
                }, status=status.HTTP_400_BAD_REQUEST)

        if task.complete_task(completion_note=completion_note):
            # Task "Ký hợp đồng thử việc" hoàn thành → OnboardingTask.complete_task()
            # (hrm/models.py) đã tự get_or_create EmployeeContract SIGNED cho đúng
            # contract_type thực tế của onboarding (onboarding.contract_type or
            # employee.contract_type or 'PROBATION') rồi. Ở đây CHỈ gán thêm
            # template mặc định (is_default) cho bản ghi đó nếu nó chưa có template
            # — KHÔNG tự tạo thêm 1 EmployeeContract('PROBATION') riêng, vì nếu
            # contract_type thực tế khác 'PROBATION' (VD: 'INTERN') thì sẽ tạo dư
            # ra 1 bản Nháp trùng lặp bên cạnh bản SIGNED đã đúng.
            if task.task_code == 'SIGN_CONTRACT':
                onboarding = task.onboarding_process
                employee = onboarding.employee
                if employee:
                    contract_type = onboarding.contract_type or employee.contract_type or 'PROBATION'
                    contract = EmployeeContract.objects.filter(
                        onboarding_process=onboarding,
                        employee=employee,
                        contract_type=contract_type,
                    ).order_by('-created_at').first()
                    if contract and not contract.template:
                        default_template = ContractTemplate.objects.filter(
                            contract_type=contract_type, status='ACTIVE', is_default=True,
                            company_unit=employee.company_unit,
                        ).first()
                        if not default_template:
                            # Fallback: template mặc định dùng chung (không gắn riêng đơn vị nào)
                            default_template = ContractTemplate.objects.filter(
                                contract_type=contract_type, status='ACTIVE', is_default=True,
                                company_unit__isnull=True,
                            ).first()
                        if default_template:
                            contract.template = default_template
                            contract.save(update_fields=['template', 'updated_at'])

            return Response({
                'success': True,
                'message': 'Đã hoàn thành task',
                'data': OnboardingTaskSerializer(task).data
            })

        return Response({
            'success': False,
            'message': 'Không thể hoàn thành task'
        }, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def skip(self, request, pk=None):
        """Bỏ qua task"""
        task = self.get_object()
        reason = request.data.get('reason', '')
        
        if task.skip_task(reason=reason):
            return Response({
                'success': True,
                'message': 'Đã bỏ qua task',
                'data': OnboardingTaskSerializer(task).data
            })
        
        return Response({
            'success': False,
            'message': 'Không thể bỏ qua task'
        }, status=status.HTTP_400_BAD_REQUEST)


class OnboardingChecklistViewSet(viewsets.ModelViewSet):
    """ViewSet cho OnboardingChecklist"""
    permission_classes = [IsAuthenticated]
    serializer_class = OnboardingChecklistSerializer
    
    def get_queryset(self):
        """Lọc checklist dựa trên task_id"""
        task_id = self.request.query_params.get('task')
        
        queryset = OnboardingChecklist.objects.all().select_related(
            'task', 'completed_by'
        )
        
        if task_id:
            queryset = queryset.filter(task_id=task_id)
        
        return queryset.order_by('order')
    
    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        """Toggle trạng thái hoàn thành"""
        item = self.get_object()
        
        if item.is_completed:
            item.mark_incomplete()
            message = 'Đã đánh dấu chưa hoàn thành'
        else:
            # Lấy employee từ request
            try:
                from employee.models import Employee
                employee = Employee.objects.get(user=request.user)
                item.mark_complete(completed_by=employee)
                message = 'Đã đánh dấu hoàn thành'
            except Employee.DoesNotExist:
                item.mark_complete()
                message = 'Đã đánh dấu hoàn thành'
        
        return Response({
            'success': True,
            'message': message,
            'data': OnboardingChecklistSerializer(item).data
        })


class OnboardingDocumentViewSet(viewsets.ModelViewSet):
    """ViewSet cho OnboardingDocument"""
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        """Lọc documents dựa trên onboarding_process_id"""
        onboarding_id = self.request.query_params.get('onboarding_process')
        
        queryset = OnboardingDocument.objects.all().select_related(
            'onboarding_process', 'uploaded_by'
        )
        
        if onboarding_id:
            queryset = queryset.filter(onboarding_process_id=onboarding_id)
        
        return queryset.order_by('-uploaded_at')
    
    def get_serializer_class(self):
        if self.action == 'create':
            return OnboardingDocumentUploadSerializer
        return OnboardingDocumentSerializer
    
    def perform_create(self, serializer):
        """Upload file to Cloudfly S3 and save the S3 key"""
        from .utils import upload_file_to_cloudfly
        extra = {}

        file = self.request.FILES.get('file')
        if file:
            try:
                s3_key = upload_file_to_cloudfly(file, 'onboarding/documents')
                extra['file'] = s3_key
            except Exception as e:
                logger.error(f"Failed to upload onboarding document to Cloudfly: {str(e)}")
                raise

        try:
            from employee.models import Employee
            employee = Employee.objects.get(user=self.request.user)
            extra['uploaded_by'] = employee
        except Employee.DoesNotExist:
            pass

        serializer.save(**extra)
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Đánh dấu tài liệu đã đọc — auto-complete task liên quan dựa trên document_type"""
        document = self.get_object()

        if document.mark_as_read():
            try:
                onboarding = document.onboarding_process

                # Map document_type → task_code (stable, không phụ thuộc name/order)
                DOC_TYPE_TASK_CODE_MAP = {
                    'REGULATION': 'READ_REGULATION',
                }

                task_code = DOC_TYPE_TASK_CODE_MAP.get(document.document_type)
                if task_code and onboarding:
                    # Check TẤT CẢ document cùng type + required đã đọc chưa
                    all_same_type = onboarding.documents.filter(
                        document_type=document.document_type,
                        is_required=True
                    )
                    unread = all_same_type.filter(is_read=False)

                    # Chỉ complete task khi có document VÀ đã đọc hết
                    if all_same_type.exists() and not unread.exists():
                        task = onboarding.tasks.filter(
                            task_code=task_code,
                            status__in=['PENDING', 'IN_PROGRESS']
                        ).first()
                        if task:
                            task.complete_task(
                                completion_note=f'Nhân viên đã đọc tất cả tài liệu {document.get_document_type_display()}'
                            )

            except Exception as e:
                logging.getLogger(__name__).error(f"Failed to complete task after mark_read: {str(e)}")

            return Response({
                'success': True,
                'message': 'Đã đánh dấu tài liệu là đã đọc',
                'data': OnboardingDocumentSerializer(document).data
            })

        return Response({
            'success': False,
            'message': 'Tài liệu đã được đánh dấu đọc trước đó'
        })
        
    @action(detail=True, methods=['post'])
    def sign(self, request, pk=None):
        """Ký tài liệu"""
        document = self.get_object()
        signature_file = request.FILES.get('signature_file')

        signature_key = None
        if signature_file:
            try:
                from .utils import upload_file_to_cloudfly
                signature_key = upload_file_to_cloudfly(signature_file, 'onboarding/signatures')
            except Exception as e:
                logger.error(f"Failed to upload signature to Cloudfly: {str(e)}")
                return Response(
                    {'success': False, 'message': f'Lỗi upload chữ ký: {str(e)}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        if document.sign_document(signature_file=signature_key):
            return Response({
                'success': True,
                'message': 'Đã ký tài liệu thành công',
                'data': OnboardingDocumentSerializer(document).data
            })
        
        return Response({
            'success': False,
            'message': 'Không thể ký tài liệu'
        }, status=status.HTTP_400_BAD_REQUEST)
class OnboardingDocumentTemplateViewSet(viewsets.ModelViewSet):
    """
    ViewSet để quản lý Document Templates cho Onboarding
    
    Endpoints:
    - GET /api-hrm/onboarding-document-templates/ - List templates
    - POST /api-hrm/onboarding-document-templates/ - Create template
    - GET /api-hrm/onboarding-document-templates/{id}/ - Get template detail
    - PUT/PATCH /api-hrm/onboarding-document-templates/{id}/ - Update template
    - DELETE /api-hrm/onboarding-document-templates/{id}/ - Delete template
    - POST /api-hrm/onboarding-document-templates/{id}/sync_to_active/ - Sync to active onboardings
    - POST /api-hrm/onboarding-document-templates/bulk_apply/ - Apply selected templates to onboarding
    """
    permission_classes = [IsAuthenticated]
    queryset = OnboardingDocumentTemplate.objects.all()
    
    def get_serializer_class(self):
        if self.action == 'list':
            return OnboardingDocumentTemplateListSerializer
        return OnboardingDocumentTemplateSerializer
    
    def get_queryset(self):
        """Filter queryset based on query params"""
        queryset = super().get_queryset()
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        # Filter by document type
        document_type = self.request.query_params.get('document_type')
        if document_type:
            queryset = queryset.filter(document_type=document_type)
        
        # Filter by auto-apply
        auto_apply = self.request.query_params.get('apply_to_all_new_onboarding')
        if auto_apply is not None:
            queryset = queryset.filter(
                apply_to_all_new_onboarding=auto_apply.lower() == 'true'
            )
        
        # Search by name
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(template_name__icontains=search) |
                Q(description__icontains=search)
            )
        
        return queryset.select_related('created_by').prefetch_related(
            'apply_to_positions',
            'apply_to_departments'
        )

    def _upload_template_file(self, file):
        """Upload template file to Cloudfly S3 and return S3 key"""
        from .utils import upload_file_to_cloudfly
        return upload_file_to_cloudfly(file, 'onboarding_templates')

    def create(self, request, *args, **kwargs):
        """Override để catch lỗi upload và trả response rõ ràng"""
        import traceback
        logger.info(
            f"[OnboardingDocumentTemplate.create] user={request.user} "
            f"files={list(request.FILES.keys())} data_keys={list(request.data.keys())}"
        )
        try:
            return super().create(request, *args, **kwargs)
        except Exception as e:
            tb = traceback.format_exc()
            logger.error(
                f"[OnboardingDocumentTemplate.create] FAILED: {type(e).__name__}: {str(e)}\n{tb}"
            )
            return Response({
                'success': False,
                'error': f'{type(e).__name__}: {str(e)}',
                'detail': 'Không thể tạo template. Xem log server để biết chi tiết.',
            }, status=status.HTTP_400_BAD_REQUEST)

    def perform_create(self, serializer):
        """Upload template file to Cloudfly S3 before saving"""
        import traceback
        extra = {}

        # Set created_by từ user đang login
        user = self.request.user
        if user and user.is_authenticated:
            try:
                extra['created_by'] = Employee.objects.get(user=user)
            except Employee.DoesNotExist:
                # Fallback: tìm qua email
                if user.email:
                    emp = Employee.objects.filter(personal_email__iexact=user.email).first()
                    if emp:
                        extra['created_by'] = emp

        file = self.request.FILES.get('file')
        logger.info(
            f"[perform_create] file={getattr(file, 'name', None)} "
            f"size={getattr(file, 'size', None)}"
        )
        if file:
            try:
                extra['file'] = self._upload_template_file(file)
                logger.info(f"[perform_create] Cloudfly upload OK, s3_key={extra['file']}")
            except Exception as e:
                tb = traceback.format_exc()
                logger.error(
                    f"[perform_create] Cloudfly upload FAILED: "
                    f"{type(e).__name__}: {str(e)}\n{tb}"
                )
                raise
        try:
            serializer.save(**extra)
            logger.info("[perform_create] serializer.save OK")
        except Exception as e:
            tb = traceback.format_exc()
            logger.error(
                f"[perform_create] serializer.save FAILED: "
                f"{type(e).__name__}: {str(e)}\n{tb}"
            )
            raise

    def perform_update(self, serializer):
        """Upload template file to Cloudfly S3 on update"""
        import traceback
        extra = {}
        file = self.request.FILES.get('file')
        if file:
            try:
                extra['file'] = self._upload_template_file(file)
            except Exception as e:
                tb = traceback.format_exc()
                logger.error(
                    f"[perform_update] Cloudfly upload FAILED: "
                    f"{type(e).__name__}: {str(e)}\n{tb}"
                )
                raise
        serializer.save(**extra)

    @action(detail=True, methods=['post'])
    def sync_to_active(self, request, pk=None):
        """
        Đồng bộ template này tới tất cả onboarding đang active
        
        POST /api-hrm/onboarding-document-templates/{id}/sync_to_active/
        """
        template = self.get_object()
        
        # Get current user's employee
        user_employee = None
        try:
            user_employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            pass
        
        # Sync to active onboardings
        created_count = template.sync_to_active_onboardings(user_employee)
        
        return Response({
            'success': True,
            'message': f'Đã đồng bộ template tới {created_count} quy trình onboarding',
            'created_count': created_count,
            'template_name': template.template_name
        })
    
    @action(detail=False, methods=['post'])
    def bulk_apply(self, request):
        """
        Áp dụng nhiều templates cho một onboarding process
        
        POST /api-hrm/onboarding-document-templates/bulk_apply/
        Body: {
            "onboarding_id": 123,
            "template_ids": [1, 2, 3, 4]
        }
        """
        onboarding_id = request.data.get('onboarding_id')
        template_ids = request.data.get('template_ids', [])
        
        if not onboarding_id:
            return Response(
                {'error': 'onboarding_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not template_ids:
            return Response(
                {'error': 'template_ids is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            onboarding = OnboardingProcess.objects.get(id=onboarding_id)
        except OnboardingProcess.DoesNotExist:
            return Response(
                {'error': f'Onboarding with id {onboarding_id} not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get current user's employee
        user_employee = None
        try:
            user_employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            pass
        
        # Apply templates
        templates = OnboardingDocumentTemplate.objects.filter(id__in=template_ids)
        created_documents = []
        
        for template in templates:
            # Check if document from this template already exists
            if not onboarding.documents.filter(template_source=template).exists():
                document = template.apply_to_onboarding(onboarding, user_employee)
                created_documents.append({
                    'id': document.id,
                    'name': document.document_name,
                    'type': document.document_type
                })
        
        return Response({
            'success': True,
            'message': f'Đã áp dụng {len(created_documents)} template cho onboarding {onboarding.candidate_name}',
            'created_count': len(created_documents),
            'created_documents': created_documents
        })
    
    @action(detail=True, methods=['post'])
    def toggle_active(self, request, pk=None):
        """
        Toggle active status của template
        
        POST /api-hrm/onboarding-document-templates/{id}/toggle_active/
        """
        template = self.get_object()
        template.is_active = not template.is_active
        template.save()
        
        return Response({
            'success': True,
            'is_active': template.is_active,
            'message': f'Template đã được {"kích hoạt" if template.is_active else "vô hiệu hóa"}'
        })
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """
        Thống kê về templates
        
        GET /api-hrm/onboarding-document-templates/statistics/
        """
        queryset = self.get_queryset()
        
        stats = {
            'total_templates': queryset.count(),
            'active_templates': queryset.filter(is_active=True).count(),
            'auto_apply_templates': queryset.filter(apply_to_all_new_onboarding=True).count(),
            'total_usage': sum(queryset.values_list('usage_count', flat=True)),
            'by_document_type': {}
        }
        
        # Count by document type
        for doc_type, doc_label in OnboardingDocumentTemplate.DOCUMENT_TYPE:
            count = queryset.filter(document_type=doc_type).count()
            if count > 0:
                stats['by_document_type'][doc_type] = {
                    'label': doc_label,
                    'count': count
                }
        
        return Response(stats)

class EmployeeOnboardingFormViewSet(viewsets.GenericViewSet):
    """
    ViewSet cho nhân viên điền form onboarding (KHÔNG cần authentication)
    """
    permission_classes = [AllowAny]  # Không cần đăng nhập
    serializer_class = EmployeeOnboardingFormSerializer
    
    def get_queryset(self):
        return OnboardingProcess.objects.all()
    
    @action(detail=False, methods=['get'], url_path='by-token/(?P<token>[^/.]+)')
    def get_by_token(self, request, token=None):
        """
        Lấy thông tin onboarding bằng token
        GET /api-hrm/employee-onboarding-form/by-token/{token}/
        """
        try:
            onboarding = OnboardingProcess.objects.get(employee_token=token)
            
            # Kiểm tra token còn hiệu lực
            if not onboarding.is_token_valid():
                return Response({
                    'success': False,
                    'error': 'Token đã hết hạn. Vui lòng liên hệ HR để được cấp token mới.'
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Kiểm tra đã điền thông tin chưa
            if onboarding.employee_info_completed:
                return Response({
                    'success': False,
                    'error': 'Bạn đã hoàn thành việc điền thông tin.',
                    'completed_at': onboarding.employee_info_completed_at
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Trả về thông tin cơ bản
            return Response({
                'success': True,
                'data': {
                    'id': onboarding.id,
                    'onboarding_code': onboarding.onboarding_code,
                    'candidate_name': onboarding.candidate_name,
                    'candidate_email': onboarding.candidate_email,
                    'candidate_phone': onboarding.candidate_phone,
                    'start_date': onboarding.start_date,
                    'position_name': onboarding.position.title if onboarding.position else None,
                    'department_name': onboarding.department.name if onboarding.department else None,
                    'token_expires_at': onboarding.token_expires_at,
                }
            })
            
        except OnboardingProcess.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Token không hợp lệ'
            }, status=status.HTTP_404_NOT_FOUND)
    
    @action(detail=False, methods=['post'], url_path='submit/(?P<token>[^/.]+)')
    def submit_employee_info(self, request, token=None):
        """
        Nhân viên submit thông tin cá nhân qua token (KHÔNG cần login)
        POST /api-hrm/employee-onboarding-form/submit/{token}/

        Logic:
        1. Validate token
        2. Validate & save 35+ fields (EmployeeOnboardingFormSerializer.update())
           → update Employee, lưu file CCCD, task1 chuyển IN_PROGRESS (chờ ADMIN duyệt)
        3. Tự động chuyển status DRAFT -> IN_PROGRESS
        """

        # ── 1. Tìm onboarding theo token ──────────────────────────────────
        try:
            onboarding = OnboardingProcess.objects.get(employee_token=token)
        except OnboardingProcess.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Token không hợp lệ'
            }, status=status.HTTP_404_NOT_FOUND)

        # ── 2. Kiểm tra token còn hiệu lực ────────────────────────────────
        if not onboarding.is_token_valid():
            return Response({
                'success': False,
                'error': 'Token đã hết hạn. Vui lòng liên hệ HR để được cấp token mới.'
            }, status=status.HTTP_400_BAD_REQUEST)

        # ── 3. Kiểm tra đã submit chưa ────────────────────────────────────
        if onboarding.employee_info_completed:
            return Response({
                'success': False,
                'error': 'Bạn đã hoàn thành việc điền thông tin.',
                'completed_at': onboarding.employee_info_completed_at
            }, status=status.HTTP_400_BAD_REQUEST)

        # ── 4. Guard required fields TRƯỚC khi serializer ──────────────────
        # Lý do: serializer dùng partial=True + tất cả field declared
        # required=False/allow_blank=True → DRF không enforce.
        # Trong khi đó FE skip empty string khi build FormData → field rỗng
        # không gửi lên BE → record save thiếu silently (~10-20% hồ sơ).
        # Server-side guard này là single source of truth cho "submit cuối".
        REQUIRED_TEXT_FIELDS = [
            'candidate_name', 'date_of_birth', 'gender', 'candidate_phone',
            'education_level', 'ethnicity', 'birth_place', 'nationality',
            'facebook_link', 'company_unit', 'region', 'block',
            'sub_department', 'position', 'job_rank', 'work_form',
            'work_location', 'citizen_id', 'citizen_id_issue_date',
            'citizen_id_issue_place', 'permanent_address', 'current_address',
            'marital_status', 'emergency_contact_name',
            'emergency_contact_relationship', 'emergency_contact_phone',
            'emergency_contact_dob', 'emergency_contact_occupation',
            'emergency_contact_address', 'salary', 'bank_account',
            'bank_name', 'bank_account_holder',
        ]
        # File fields:
        #   - citizen_id_file: lưu S3 key trên OnboardingProcess.citizen_id_file
        #   - vneid_screenshot: FileField trên Employee.vneid_screenshot
        # → re-submit case: kiểm tra giá trị hiện có trước khi đòi upload mới.
        missing = []
        for f in REQUIRED_TEXT_FIELDS:
            raw = request.data.get(f)
            if raw is None or (isinstance(raw, str) and not raw.strip()):
                missing.append(f)

        if not request.FILES.get('citizen_id_file') and not getattr(onboarding, 'citizen_id_file', None):
            missing.append('citizen_id_file')

        emp = getattr(onboarding, 'employee', None)
        existing_vneid = bool(emp and getattr(emp, 'vneid_screenshot', None))
        if not request.FILES.get('vneid_screenshot') and not existing_vneid:
            missing.append('vneid_screenshot')

        if missing:
            return Response({
                'success': False,
                'errors': {f: ['Trường bắt buộc, vui lòng điền/upload'] for f in missing},
                'missing_fields': missing,
            }, status=status.HTTP_400_BAD_REQUEST)

        # ── 5. Validate & save dùng EmployeeOnboardingFormSerializer ───────
        # QUAN TRỌNG: Dùng EmployeeOnboardingFormSerializer vì nó có update()
        # đầy đủ: cập nhật Employee, lưu file CCCD, auto-complete tasks 1-4
        serializer = EmployeeOnboardingFormSerializer(
            onboarding,
            data=request.data,
            partial=True,
            context={'request': request}
        )

        if not serializer.is_valid():
            return Response({
                'success': False,
                'errors': serializer.errors
            }, status=status.HTTP_400_BAD_REQUEST)

        updated_onboarding = serializer.save()

        # status DRAFT -> IN_PROGRESS đã được handle bên trong serializer.update()
        # qua start_process() (single source of truth). Không cần raw bump nữa.
        status_changed = updated_onboarding.status == 'IN_PROGRESS'

        # ── Response ──────────────────────────────────────────────────────
        return Response({
            'success': True,
            'message': 'Cảm ơn bạn đã hoàn thành việc điền thông tin! HR sẽ liên hệ với bạn sớm.',
            'data': {
                'onboarding_code': updated_onboarding.onboarding_code,
                'completed_at': updated_onboarding.employee_info_completed_at,
                'status': updated_onboarding.status,
                'status_changed_to_in_progress': status_changed,
            },
        })
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    """
    API endpoint để đổi mật khẩu
    POST /api-hrm/change-password/
    
    Body:
    {
        "old_password": "password_cu",
        "new_password": "password_moi"
    }
    """
    user = request.user
    old_password = request.data.get('old_password')
    new_password = request.data.get('new_password')
    
    # Validate input
    if not old_password or not new_password:
        return Response({
            'error': 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới'
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Verify old password
    if not user.check_password(old_password):
        return Response({
            'old_password': ['Mật khẩu hiện tại không đúng']
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Check if new password is same as old
    if old_password == new_password:
        return Response({
            'new_password': ['Mật khẩu mới phải khác mật khẩu hiện tại']
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Validate new password strength
    try:
        validate_password(new_password, user)
    except ValidationError as e:
        return Response({
            'new_password': list(e.messages)
        }, status=status.HTTP_400_BAD_REQUEST)
    
    # Set new password
    user.set_password(new_password)
    user.save()
    
    return Response({
        'success': True,
        'message': 'Đổi mật khẩu thành công'
    }, status=status.HTTP_200_OK)

@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password(request):
    """
    Public endpoint: nhân viên tự yêu cầu cấp lại mật khẩu
    POST /api-hrm/forgot-password/
    Body: { "employee_id": "NV80018" }
    """
    import secrets, string, logging
    logger = logging.getLogger(__name__)

    employee_id = (request.data.get('employee_id') or '').strip().upper()
    if not employee_id:
        return Response({'error': 'Vui lòng nhập mã nhân viên'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        employee = Employee.objects.get(employee_id=employee_id)
        user = employee.user
    except Employee.DoesNotExist:
        return Response({'error': 'Không tìm thấy nhân viên với mã này'}, status=status.HTTP_404_NOT_FOUND)
    except AttributeError:
        return Response({'error': 'Tài khoản nhân viên chưa được tạo'}, status=status.HTTP_400_BAD_REQUEST)

    if not user.is_active:
        return Response({'error': 'Tài khoản đã bị vô hiệu hoá'}, status=status.HTTP_400_BAD_REQUEST)

    if not employee.personal_email:
        return Response({'error': 'Nhân viên chưa có email. Vui lòng liên hệ phòng Nhân sự.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        chars = string.ascii_uppercase + string.ascii_lowercase + string.digits + "!@#$%"
        new_password = ''.join(secrets.choice(chars) for _ in range(12))
        user.set_password(new_password)
        user.save()

        from hrm.serializers import send_account_info_email
        email_sent = send_account_info_email(user=user, employee=employee, new_password=new_password)

        if not email_sent:
            logger.error(f"forgot_password: failed to send email to {user.email}")
            return Response({'error': 'Không thể gửi email. Vui lòng liên hệ phòng Nhân sự.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        logger.info(f"forgot_password: reset OK for {employee_id}, email sent to {user.email}")
        return Response({
            'success': True,
            'message': f'Mật khẩu mới đã được gửi đến email của bạn.',
        }, status=status.HTTP_200_OK)

    except Exception as e:
        logger.error(f"forgot_password error for {employee_id}: {str(e)}", exc_info=True)
        return Response({'error': 'Có lỗi xảy ra. Vui lòng thử lại sau.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


import uuid
from django.contrib.auth.hashers import make_password
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework import status

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def send_account_emails(request):
    """Tạo queue để gửi email thông tin tài khoản cho nhân viên - FORCE RESET PASSWORD"""
    
    try:
        from employee.models import Employee
    except ImportError:
        from hrm.models import Employee
    
    from hrm.models import EmailQueue, EmailBatch
    from hrm.utils import generate_simple_password  # ✅ THÊM IMPORT
    
    try:
        send_all = request.data.get('send_all', False)
        employee_ids = request.data.get('employee_ids', [])

        # Query employees
        if send_all:
            employees = Employee.objects.filter(
                employment_status='ACTIVE'
            ).exclude(personal_email='').exclude(personal_email__isnull=True).select_related('user')
        else:
            if not employee_ids:
                return Response({
                    'success': False, 
                    'message': 'Vui lòng cung cấp danh sách nhân viên'
                }, status=status.HTTP_400_BAD_REQUEST)
                
            employees = Employee.objects.filter(
                id__in=employee_ids
            ).exclude(personal_email='').exclude(personal_email__isnull=True).select_related('user')

        employee_count = employees.count()
        
        if employee_count == 0:
            return Response({
                'success': False, 
                'message': 'Không tìm thấy nhân viên nào có email'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Tạo batch ID
        batch_id = f"EMAIL_{timezone.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
        
        # Tạo EmailBatch record
        email_batch = EmailBatch.objects.create(
            batch_id=batch_id,
            total_emails=employee_count,
            pending_count=employee_count,
            created_by=request.user,
            status='PENDING'
        )
        
        # ✅ FORCE RESET PASSWORD và tạo EmailQueue records
        email_queue_objects = []
        reset_count = 0
        
        for employee in employees:
            # ✅ LUÔN LUÔN tạo password mới
            new_password = generate_simple_password(length=8)
            employee.user.password = make_password(new_password)
            employee.user.save(update_fields=['password'])
            reset_count += 1
            logger.info(f"🔑 Reset password for {employee.user.username} -> {new_password}")
            
            email_queue_objects.append(
                EmailQueue(
                    employee=employee,
                    email_type='ACCOUNT_INFO',
                    recipient_email=employee.personal_email,
                    recipient_name=employee.full_name,
                    new_password=new_password,  # ✅ Lưu password mới
                    batch_id=batch_id,
                    created_by=request.user,
                    status='PENDING'
                )
            )
        
        # Bulk create để tối ưu performance
        EmailQueue.objects.bulk_create(email_queue_objects, batch_size=100)
        
        logger.info(f"📧 Created email batch {batch_id} with {employee_count} emails")
        logger.info(f"🔑 FORCE reset passwords for ALL {reset_count} users")

        return Response({
            'success': True,
            'message': f'Đã reset password và tạo {employee_count} email vào hàng đợi. Email sẽ được gửi trong vòng 5-10 phút.',
            'total': employee_count,
            'passwords_reset': reset_count,  # ✅ Thêm thông tin số password đã reset
            'batch_id': batch_id,
            'estimated_time': f'{(employee_count * 2) // 60 + 1} phút'
        }, status=status.HTTP_200_OK)
        
    except Exception as e:
        logger.error(f"Error creating email queue: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return Response({
            'success': False,
            'message': f'Lỗi hệ thống: {str(e)}'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def check_email_batch_status(request, batch_id):
    """Kiểm tra trạng thái batch email"""
    from hrm.models import EmailBatch
    
    try:
        batch = EmailBatch.objects.get(batch_id=batch_id)
        
        return Response({
            'success': True,
            'batch_id': batch.batch_id,
            'status': batch.status,
            'total': batch.total_emails,
            'sent': batch.sent_count,
            'failed': batch.failed_count,
            'pending': batch.pending_count,
            'progress_percentage': round((batch.sent_count / batch.total_emails * 100), 2) if batch.total_emails > 0 else 0,
            'created_at': batch.created_at,
            'completed_at': batch.completed_at,
        })
    except EmailBatch.DoesNotExist:
        return Response({
            'success': False,
            'message': 'Không tìm thấy batch'
        }, status=status.HTTP_404_NOT_FOUND)
def replace_placeholders_in_paragraph(para, placeholders):
    """
    Replace placeholders trong paragraph, xử lý trường hợp placeholder bị split thành nhiều run.
    """
    # Bước 1: Ghép toàn bộ text của paragraph lại
    full_text = ''.join([run.text for run in para.runs])
    
    # Bước 2: Kiểm tra có placeholder nào không
    has_placeholder = any(key in full_text for key in placeholders)
    if not has_placeholder:
        return
    
    # Bước 3: Replace tất cả placeholder trong full_text
    for key, value in placeholders.items():
        full_text = full_text.replace(key, value)
    
    # Bước 4: Ghi full_text vào run đầu tiên, xóa các run còn lại
    if para.runs:
        para.runs[0].text = full_text
        for i in range(1, len(para.runs)):
            para.runs[i].text = ''


def replace_all_placeholders(doc, placeholders):
    """
    Replace tất cả placeholder trong toàn bộ document (paragraphs + tables).
    """
    # Replace trong paragraphs thường
    for para in doc.paragraphs:
        replace_placeholders_in_paragraph(para, placeholders)
    
    # Replace trong tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for para in cell.paragraphs:
                    replace_placeholders_in_paragraph(para, placeholders)
    
    # Replace trong headers và footers
    for section in doc.sections:
        for para in section.header.paragraphs:
            replace_placeholders_in_paragraph(para, placeholders)
        for para in section.footer.paragraphs:
            replace_placeholders_in_paragraph(para, placeholders)
        # Header/footer riêng của trang đầu (template bật "Different First Page")
        if section.different_first_page_header_footer:
            for para in section.first_page_header.paragraphs:
                replace_placeholders_in_paragraph(para, placeholders)
            for para in section.first_page_footer.paragraphs:
                replace_placeholders_in_paragraph(para, placeholders)
# ============================================
# CONTRACT VIEWS
# ============================================
import boto3
class ContractTemplateViewSet(viewsets.ModelViewSet):
    """CRUD cho template hợp đồng - FIX MissingContentLength"""
    
    queryset = ContractTemplate.objects.select_related('created_by', 'company_unit').all()
    serializer_class = ContractTemplateSerializer
    permission_classes = [IsAuthenticated]
 
    def perform_create(self, serializer):
        """✅ FIX: Upload file lên S3 dùng presigned URLs"""
        from django.conf import settings
        import requests
        import boto3
        from io import BytesIO

        file = self.request.FILES.get('file')
        file_key = None

        if file:
            try:
                file.seek(0)
                file_content = file.read()
                if len(file_content) == 0:
                    raise ValueError("File is empty")
                
                file_key = f"contract_templates/{file.name}"
                logger.info(f"File read: {file.name} ({len(file_content)} bytes)")
                
                s3_client = boto3.client(
                    's3',
                    endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
                    aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
                    aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
                    region_name=settings.CLOUDFLY_REGION,
                )
                
                # Generate presigned URL for upload
                content_type = file.content_type or 'application/octet-stream'
                presigned_url = s3_client.generate_presigned_url(
                    'put_object',
                    Params={
                        'Bucket': settings.CLOUDFLY_BUCKET,
                        'Key': file_key,
                        'ContentType': content_type,
                    },
                    ExpiresIn=3600,
                )
                logger.info(f"Generated presigned URL: {presigned_url[:50]}...")
                
                # Upload using presigned URL - requests will auto-calculate Content-Length
                file_obj = BytesIO(file_content)
                response = requests.put(
                    presigned_url,
                    data=file_obj,
                    headers={
                        'Content-Type': content_type,
                    },
                    timeout=30
                )
                
                if response.status_code not in [200, 201]:
                    raise Exception(f"S3 upload failed with status {response.status_code}: {response.text}")
                logger.info(f"S3 upload success: {file_key}")
                
            except Exception as e:
                logger.error(f"S3 Upload Error: {str(e)}", exc_info=True)
                raise
 
        # ✅ Chỉ save nếu upload thành công (hoặc không có file)
        serializer.save(
            created_by=self.request.user,
            file=file_key
        )
 
    def perform_update(self, serializer):
        """✅ FIX: Update file lên S3 đúng cách - Use presigned URLs"""
        from django.conf import settings
        import requests
        import boto3
        from botocore.config import Config
        from io import BytesIO

        file = self.request.FILES.get('file')
        
        if file:
            try:
                file.seek(0)
                file_content = file.read()
                if len(file_content) == 0:
                    raise ValueError("File is empty")
                
                file_key = f"contract_templates/{file.name}"
                logger.info(f"File read: {file.name} ({len(file_content)} bytes)")
                
                s3_client = boto3.client(
                    's3',
                    endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
                    aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
                    aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
                    region_name=settings.CLOUDFLY_REGION,
                )
                
                content_type = file.content_type or 'application/octet-stream'
                presigned_url = s3_client.generate_presigned_url(
                    'put_object',
                    Params={
                        'Bucket': settings.CLOUDFLY_BUCKET,
                        'Key': file_key,
                        'ContentType': content_type,
                    },
                    ExpiresIn=3600,
                )
                logger.info(f"Generated presigned URL: {presigned_url[:50]}...")
                
                file_obj = BytesIO(file_content)
                response = requests.put(
                    presigned_url,
                    data=file_obj,
                    headers={
                        'Content-Type': content_type,
                    },
                    timeout=30
                )
                
                if response.status_code not in [200, 201]:
                    raise Exception(f"S3 update failed with status {response.status_code}: {response.text}")
                logger.info(f"S3 update success: {file_key}")
                
                # ✅ Save với file key mới
                serializer.save(file=file_key)
                
            except Exception as e:
                logger.error(f"S3 Upload Error: {str(e)}", exc_info=True)
                raise
        else:
            # Không có file mới - chỉ update thông tin khác
            serializer.save()


_VN_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']


def _read_three_digits_vn(n: int, full: bool) -> str:
    h, t, o = n // 100, (n % 100) // 10, n % 10
    parts = []
    if h > 0 or full:
        parts.append(f"{_VN_DIGITS[h]} trăm")
    if t > 1:
        parts.append(f"{_VN_DIGITS[t]} mươi")
        if o == 1:
            parts.append('mốt')
        elif o == 5:
            parts.append('lăm')
        elif o > 0:
            parts.append(_VN_DIGITS[o])
    elif t == 1:
        parts.append('mười')
        if o == 5:
            parts.append('lăm')
        elif o > 0:
            parts.append(_VN_DIGITS[o])
    elif t == 0 and o > 0:
        if h > 0 or full:
            parts.append('lẻ')
        parts.append(_VN_DIGITS[o])
    return ' '.join(parts)


def _parse_vnd_amount(value) -> int:
    """Parse tiền VNĐ về int, chấp nhận chuỗi có dấu chấm/phẩy ngăn cách ("6.000.000")."""
    if value is None or value == '':
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    digits = re.sub(r'[^\d]', '', str(value))
    return int(digits) if digits else 0


def _amount_to_vietnamese_words(amount) -> str:
    """Đọc số tiền (VNĐ) thành chữ, vd 30000000 -> 'Ba mươi triệu đồng'."""
    try:
        num = int(amount or 0)
    except (TypeError, ValueError):
        return ''
    if num <= 0:
        return ''
    groups = []
    n = num
    while n > 0:
        groups.insert(0, n % 1000)
        n //= 1000
    units = ['', 'nghìn', 'triệu', 'tỷ']
    total = len(groups)
    out = []
    for i, g in enumerate(groups):
        if g == 0:
            continue
        out.append(_read_three_digits_vn(g, len(out) > 0))
        unit = units[total - 1 - i] if total - 1 - i < len(units) else ''
        if unit:
            out.append(unit)
    result = ' '.join(out).strip()
    if not result:
        return ''
    return f"{result[0].upper()}{result[1:]} đồng"


def _month_count_to_vietnamese_words(n) -> str:
    """Đọc số tháng thành chữ, vd 2 -> 'hai' (cho dạng "02 (hai) tháng")."""
    try:
        num = int(n or 0)
    except (TypeError, ValueError):
        return ''
    if num <= 0:
        return ''
    return _read_three_digits_vn(num, False)


def _sync_word_placeholders(placeholders: dict) -> dict:
    """Phần "bằng chữ" luôn tính lại từ số cuối cùng (sau override của HCNS) để
    không bao giờ lệch với phần số trên hợp đồng."""
    placeholders['{{luong_co_ban_bang_chu}}'] = _amount_to_vietnamese_words(
        _parse_vnd_amount(placeholders.get('{{luong_co_ban}}'))
    )
    placeholders['{{so_thang_thu_viec_bang_chu}}'] = _month_count_to_vietnamese_words(
        placeholders.get('{{so_thang_thu_viec}}')
    )
    return placeholders


def _format_contract_date(d) -> str:
    """Định dạng ngày cho placeholder hợp đồng: 'ngày dd tháng mm năm yyyy'."""
    if not d:
        return ''
    try:
        return d.strftime('ngày %d tháng %m năm %Y')
    except (AttributeError, ValueError):
        return ''


class EmployeeContractViewSet(viewsets.ModelViewSet):
    """CRUD cho hợp đồng nhân viên"""
    queryset = EmployeeContract.objects.all()
    serializer_class = EmployeeContractSerializer
    permission_classes = [IsAuthenticated]
    CONTRACT_TYPE_TO_GROUP = {
        'INTERN': 'INTERN',
        'COLLABORATOR': 'INTERN',
        'PROBATION': 'PROBATION',
        'ONE_YEAR': 'LABOR',
        'THREE_YEAR': 'LABOR',
        'INDEFINITE': 'LABOR',
        'SERVICE': 'SERVICE',
        'COMPANY_RULES': 'COMPANY_RULES',
    }

    GROUP_PREFIX = {
        'INTERN': 'HĐTT',
        'PROBATION': 'HĐTV',
        'LABOR': 'HĐLĐ',
        'SERVICE': 'HĐDV',
        'COMPANY_RULES': 'CK',
    }

    @staticmethod
    def _contract_unit_code(company_unit) -> str:
        """Mã đơn vị hiển thị trên số HĐ — ưu tiên contract_unit_code (riêng cho hợp đồng),
        fallback về code (mã đơn vị dùng chung, ảnh hưởng cả mã nhân viên)."""
        if not company_unit:
            return ''
        if company_unit.contract_unit_code:
            return company_unit.contract_unit_code
        return company_unit.code

    def get_queryset(self):
        qs = EmployeeContract.objects.select_related(
            'employee', 'template', 'onboarding_process', 'created_by', 'company_unit'
        )
        onboarding_id = self.request.query_params.get('onboarding_id')
        if onboarding_id:
            qs = qs.filter(onboarding_process_id=onboarding_id)
        employee_id = self.request.query_params.get('employee_id')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        """Upload signed_file to Cloudfly S3 if provided"""
        extra = {}
        file = self.request.FILES.get('signed_file')
        if file:
            try:
                from .utils import upload_file_to_cloudfly
                onboarding_id = (
                    serializer.instance.onboarding_process_id
                    if serializer.instance
                    else 'unassigned'
                )
                extra['signed_file'] = upload_file_to_cloudfly(
                    file, f'contracts/{onboarding_id}'
                )
            except Exception as e:
                logger.error(f"Failed to upload signed contract to Cloudfly: {str(e)}")
                raise
        serializer.save(**extra)

    def destroy(self, request, *args, **kwargs):
        """Xoá hợp đồng và reset ContractCounter về max số còn lại cùng group/company_unit/year."""
        import re
        from hrm.models import ContractCounter
        from django.db import transaction
        from rest_framework.response import Response
        from rest_framework import status

        contract = self.get_object()
        group = self.CONTRACT_TYPE_TO_GROUP.get(contract.contract_type)
        company_unit = contract.company_unit
        contract_number = contract.contract_number

        self.perform_destroy(contract)

        # Nếu hợp đồng đã được gán số chính thức, reset counter về số lớn nhất còn
        # lại CÙNG chuỗi số hiện tại — không tính HĐ format cũ (vd "0403/2026/XX-HĐLĐ"),
        # trước đây tính lẫn khiến counter bị đặt thành 403 → HĐ sau nhảy 0404.
        if group and contract_number:
            match = re.match(r'^(\d+)/(\d{4})/', contract_number)
            if match:
                year = int(match.group(2))
                suffix = f"{self.GROUP_PREFIX[group]}-{self._contract_unit_code(company_unit)}"
                with transaction.atomic():
                    counter = ContractCounter.objects.select_for_update().filter(
                        group=group, company_unit=company_unit, year=year
                    ).first()
                    if counter:
                        counter.last_number = ContractCounter._max_number_in_db(
                            group, company_unit, year, expected_suffix=suffix,
                        )
                        counter.save()

        return Response(status=status.HTTP_204_NO_CONTENT)

    # ============================================
    # HELPER: Build default placeholders từ employee
    # ============================================

    PROBATION_RATE_MONTHS = {
        'OPTION_1': (85, 85),
        'OPTION_2': (85, 100),
        'OPTION_3': (100, 100),
    }

    def _build_placeholders(self, contract):
        """Trả về dict placeholder mặc định từ thông tin nhân viên và hợp đồng."""
        employee = contract.employee
        probation_month1, probation_month2 = self.PROBATION_RATE_MONTHS.get(
            employee.probation_rate, (None, None)
        )
        noi_cap = (
            'Cục cảnh sát Quản lý hành chính về Trật tự xã hội'
            if employee.cccd_issue_place == 'POLICE_ADMIN'
            else 'Bộ Công An'
            if employee.cccd_issue_place == 'MINISTRY_PUBLIC_SECURITY'
            else employee.cccd_issue_place or ''
        )
        return {
            '{{ho_ten}}': employee.full_name or '',
            '{{gioi_tinh}}': {'M': 'Nam', 'F': 'Nữ', 'O': 'Khác'}.get(employee.gender or '', employee.gender or ''),
            '{{ma_nhan_vien}}': employee.employee_id or '',
            '{{mnv}}': employee.employee_id or '',
            '{{ngay_sinh}}': employee.date_of_birth.strftime('%d/%m/%Y') if employee.date_of_birth else '',
            '{{so_dien_thoai}}': employee.phone_number or '',
            '{{email}}': employee.personal_email or '',
            '{{so_cccd}}': employee.cccd_number or '',
            '{{ngay_cap_cccd}}': employee.cccd_issue_date.strftime('%d/%m/%Y') if employee.cccd_issue_date else '',
            '{{noi_cap_cccd}}': noi_cap,
            '{{ngay_cap}}': employee.cccd_issue_date.strftime('%d/%m/%Y') if employee.cccd_issue_date else '',
            '{{noi_cap}}': noi_cap,
            '{{noi_sinh}}': employee.birth_place or '',
            '{{dia_chi}}': employee.permanent_residence or '',
            '{{dia_chi_hien_tai}}': employee.current_address or '',
            '{{tinh_trang_hon_nhan}}': employee.marital_status or '',
            '{{trinh_do_hoc_van}}': employee.education_level or '',
            '{{dan_toc}}': employee.ethnicity or '',
            '{{quoc_tich}}': employee.nationality or '',
            '{{ma_so_thue}}': employee.tax_code or '',
            '{{ma_bhxh}}': employee.social_insurance_number or '',
            '{{so_tai_khoan}}': employee.bank_account or '',
            '{{ten_ngan_hang}}': employee.bank_name or '',
            '{{chu_tai_khoan}}': employee.bank_account_holder or '',
            '{{phong_ban}}': employee.department.name if employee.department else '',
            '{{vi_tri}}': employee.position.title if employee.position else '',
            '{{chuc_vu}}': employee.rank or '',
            '{{rank}}': employee.rank or '',
            '{{quan_ly_truc_tiep}}': employee.manager.full_name if employee.manager else '',
            '{{hinh_thuc_lam_viec}}': employee.work_form or '',
            '{{dia_diem_lam_viec}}': employee.work_location or '',
            '{{ngay_bat_dau}}': (
                contract.start_date.strftime('%d/%m/%Y') if contract.start_date
                else (employee.start_date.strftime('%d/%m/%Y') if employee.start_date else '')
            ),
            '{{ngay_hieu_luc}}': contract.start_date.strftime('%d/%m/%Y') if contract.start_date else '',
            '{{ngay_bat_dau_hd_dv}}': contract.start_date.strftime('%d/%m/%Y') if contract.start_date else '',
            '{{ngay_chinh_thuc}}': employee.official_start_date.strftime('%d/%m/%Y') if employee.official_start_date else '',
            '{{ngay_ket_thuc_thu_viec}}': employee.probation_end_date.strftime('%d/%m/%Y') if employee.probation_end_date else '',
            '{{thang_thu_viec}}': str(employee.probation_months) if employee.probation_months else '',
            '{{so_thang_thu_viec}}': str(employee.probation_months) if employee.probation_months else '',
            '{{so_thang_thu_viec_bang_chu}}': _month_count_to_vietnamese_words(employee.probation_months),
            '{{phan_tram_luong_thu_viec}}': (
                f"Tháng đầu {probation_month1}%, tháng sau {probation_month2}%"
                if probation_month1 else ''
            ),
            '{{ty_le_luong_thang_dau}}': f"{probation_month1}%" if probation_month1 else '',
            '{{ty_le_luong_thang_hai}}': f"{probation_month2}%" if probation_month2 else '',
            '{{luong_co_ban}}': f"{int(employee.basic_salary):,}" if employee.basic_salary else '',
            '{{luong_co_ban_bang_chu}}': _amount_to_vietnamese_words(employee.basic_salary),
            '{{loai_hop_dong}}': contract.get_contract_type_display(),
            '{{loai_hop_dong_nv}}': employee.contract_type or '',
            # Nội dung/loại hình dịch vụ thuê (hợp đồng dịch vụ) — không có nguồn dữ
            # liệu tự động, HR gõ tay khi generate qua màn "Xem/chỉnh placeholder"
            # (get_placeholders trả về key này rỗng, editable=True như mọi placeholder khác).
            '{{loai_hinh_dich_vu}}': '',
            '{{ngay_ky}}': _format_contract_date(timezone.now()),
            '{{thoi_han_hop_dong}}': contract.end_date.strftime('%d/%m/%Y') if contract.end_date else '',
            '{{ngay_ket_thuc}}': contract.end_date.strftime('%d/%m/%Y') if contract.end_date else '',
            '{{ngay_ket_thuc_hd_dv}}': contract.end_date.strftime('%d/%m/%Y') if contract.end_date else '',
            '{{nguoi_lien_he_khan_cap}}': employee.emergency_contact_name or '',
            '{{sdt_nguoi_lien_he}}': employee.emergency_contact_phone or '',
            '{{quan_he_nguoi_lien_he}}': employee.emergency_contact_relationship or '',
            '{{so_hd}}': contract.contract_number or self._generate_contract_number(contract),
        }

    def _normalize_override_placeholders(self, overrides):
        """
        Chuẩn hóa payload overrides từ FE:
        - Chấp nhận key dạng `ho_ten` hoặc `{{ho_ten}}`
        - Ép value về string để tránh lỗi replace trong python-docx
        """
        if not isinstance(overrides, dict):
            return {}

        normalized = {}
        for raw_key, raw_value in overrides.items():
            if raw_key is None:
                continue

            key = str(raw_key).strip()
            if not key:
                continue

            if not (key.startswith('{{') and key.endswith('}}')):
                key = key.strip('{} ').strip()
                if not key:
                    continue
                key = f'{{{{{key}}}}}'

            normalized[key] = '' if raw_value is None else str(raw_value)

        return normalized

    # ============================================
    # HELPER: Download template, replace, convert, upload PDF
    # ============================================

    def _generate_and_upload_pdf(self, contract, placeholders):
        """
        Download template từ S3, replace placeholder, convert sang PDF, upload lại S3.
        Trả về presigned view URL.
        """
        from docx import Document
        import subprocess, tempfile, os, uuid, shutil, boto3, requests as req
        from django.conf import settings

        tmp_template_path = tmp_docx_path = tmp_pdf_path = None
        lo_profile_dir = tempfile.mkdtemp(prefix='lo_profile_')

        try:
            s3_client = boto3.client(
                's3',
                endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
                aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
                aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
                region_name=settings.CLOUDFLY_REGION,
            )

            # Download template
            with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
                s3_client.download_fileobj(settings.CLOUDFLY_BUCKET, str(contract.template.file), tmp)
                tmp_template_path = tmp.name

            # Replace placeholders
            doc = Document(tmp_template_path)
            replace_all_placeholders(doc, placeholders)

            with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
                doc.save(tmp.name)
                tmp_docx_path = tmp.name

            # Convert to PDF
            # SAL_USE_VCLPLUGIN=svp ép LibreOffice dùng backend render headless-safe,
            # tránh crash do cố dò tìm X11/OpenGL không tồn tại trong container.
            # HOME trỏ vào profile riêng để tránh xung đột quyền ghi ở $HOME mặc định.
            lo_env = {**os.environ, 'SAL_USE_VCLPLUGIN': 'svp', 'HOME': lo_profile_dir}
            result = subprocess.run(
                ['libreoffice', '--headless',
                 f'-env:UserInstallation=file://{lo_profile_dir}',
                 '--convert-to', 'pdf',
                 '--outdir', os.path.dirname(tmp_docx_path), tmp_docx_path],
                capture_output=True, timeout=60, env=lo_env,
            )
            pdf_file_path = tmp_docx_path.replace('.docx', '.pdf')
            # LibreOffice có thể trả về returncode != 0 chỉ vì cảnh báo javaldx
            # (không tìm thấy Java runtime) dù file PDF vẫn được tạo thành công
            # → chỉ coi là lỗi thật khi file PDF không tồn tại sau khi convert.
            if not os.path.exists(pdf_file_path):
                stdout_txt = (result.stdout or b'').decode(errors='replace')
                stderr_txt = (result.stderr or b'').decode(errors='replace')
                raise Exception(
                    f'Convert Word to PDF failed (return code {result.returncode}). '
                    f'stdout: {stdout_txt[:800]!r} stderr: {stderr_txt[:800]!r}'
                )
            tmp_pdf_path = pdf_file_path

            with open(pdf_file_path, 'rb') as f:
                pdf_content = f.read()

            # Upload PDF
            onboarding_id = contract.onboarding_process_id if contract.onboarding_process else 'unassigned'
            filename = f'contracts/{onboarding_id}/{contract.id}_contract_{timezone.now().timestamp()}.pdf'

            put_url = s3_client.generate_presigned_url(
                'put_object',
                Params={'Bucket': settings.CLOUDFLY_BUCKET, 'Key': filename, 'ContentType': 'application/pdf'},
                ExpiresIn=3600,
            )
            response = req.put(put_url, data=pdf_content, headers={'Content-Type': 'application/pdf'}, timeout=30)
            if response.status_code not in [200, 201]:
                raise Exception(f"PDF upload failed: {response.status_code} {response.text}")

            # Presigned view URL
            view_url = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': settings.CLOUDFLY_BUCKET, 'Key': filename},
                ExpiresIn=7 * 24 * 3600,
            )
            return view_url

        finally:
            for path in [tmp_template_path, tmp_docx_path, tmp_pdf_path]:
                if path and os.path.exists(path):
                    os.unlink(path)
            shutil.rmtree(lo_profile_dir, ignore_errors=True)

    # ============================================
    # ACTION: Quét template, trả về danh sách placeholder
    # ============================================

    def _generate_contract_number(self, contract) -> str:
        from hrm.models import ContractCounter
        group = self.CONTRACT_TYPE_TO_GROUP.get(contract.contract_type)
        if not group:
            return ''
        year = timezone.now().year
        company_unit = contract.company_unit
        unit_code = self._contract_unit_code(company_unit)
        prefix = self.GROUP_PREFIX[group]
        number = ContractCounter.peek_next(group, company_unit, year, expected_suffix=f"{prefix}-{unit_code}")
        return f"{number:04d}/{year}/{prefix}-{unit_code}"
    @action(detail=True, methods=['post'])
    def confirm_contract(self, request, pk=None):
        """
        Xác nhận dùng bản PDF hiện tại.
        Đây là lúc DUY NHẤT counter tăng và số HĐ được lưu chính thức.
        """
        from django.db import transaction
        from hrm.models import ContractCounter

        contract = self.get_object()
        file_url = request.data.get('file_url')
        if not file_url:
            return Response({'success': False, 'message': 'Thiếu file_url'}, status=400)

        # Tăng counter và lưu số HĐ chính thức — cùng 1 transaction để khoá counter
        # giữ tới lúc số đã nằm trên hợp đồng (next_number lấy MAX số HĐ trên DB).
        # CHỈ cấp số mới khi contract CHƯA có contract_number — tránh trường hợp
        # HR sửa thông tin & confirm lại sẽ tăng counter và đổi số HĐ.
        group = self.CONTRACT_TYPE_TO_GROUP.get(contract.contract_type)
        with transaction.atomic():
            if group and not contract.contract_number:
                year = timezone.now().year
                prefix = self.GROUP_PREFIX[group]
                company_unit = contract.company_unit
                unit_code = self._contract_unit_code(company_unit)
                number = ContractCounter.next_number(group, company_unit, year, expected_suffix=f"{prefix}-{unit_code}")
                contract.contract_number = f"{number:04d}/{year}/{prefix}-{unit_code}"

            contract.generated_file = file_url
            contract.status = 'PENDING_SIGN'
            contract.save()

        return Response({
            'success': True,
            'contract_number': getattr(contract, 'contract_number', ''),
            'data': EmployeeContractSerializer(contract, context={'request': request}).data
        })

    @action(detail=True, methods=['get'])
    def download_file(self, request, pk=None):
        """Proxy file hợp đồng từ S3 về client dưới dạng blob (tránh lộ presigned URL)."""
        import boto3
        from botocore.exceptions import ClientError, BotoCoreError
        from urllib.parse import urlparse, unquote
        from django.http import StreamingHttpResponse
        from django.conf import settings

        contract = self.get_object()
        if not contract.generated_file:
            return Response({'detail': 'Chưa có file hợp đồng'}, status=404)

        file_key = str(contract.generated_file)
        # Nếu là presigned URL, lấy key từ path
        if file_key.startswith('http'):
            parsed = urlparse(file_key)
            # unquote để trả về ký tự gốc cho key (xử lý dấu cách / unicode trong key)
            file_key = unquote(parsed.path.lstrip('/'))
            # Bỏ bucket name nếu có trong path
            bucket = settings.CLOUDFLY_BUCKET
            if file_key.startswith(bucket + '/'):
                file_key = file_key[len(bucket) + 1:]

        s3_client = boto3.client(
            's3',
            endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
            aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
            aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
            region_name=settings.CLOUDFLY_REGION,
        )
        try:
            obj = s3_client.get_object(Bucket=settings.CLOUDFLY_BUCKET, Key=file_key)
        except ClientError as e:
            code = e.response.get('Error', {}).get('Code', '')
            logger.warning(
                f"[download_file] S3 error contract={contract.id} key={file_key} code={code}: {e}"
            )
            if code in ('NoSuchKey', '404', 'NoSuchBucket'):
                return Response(
                    {
                        'detail': 'File hợp đồng đã bị xóa hoặc không tồn tại trên S3. '
                                  'Vui lòng tạo lại file PDF qua nút "Sửa thông tin" → "Tạo xem trước".',
                        'contract_id': contract.id,
                        's3_key': file_key,
                    },
                    status=404,
                )
            return Response(
                {'detail': f'Lỗi đọc file từ S3: {code or str(e)}', 's3_key': file_key},
                status=502,
            )
        except BotoCoreError as e:
            logger.error(f"[download_file] BotoCoreError contract={contract.id}: {e}")
            return Response({'detail': f'Lỗi kết nối S3: {e}'}, status=502)

        response = StreamingHttpResponse(
            obj['Body'].iter_chunks(),
            content_type='application/pdf',
        )
        filename = file_key.split('/')[-1] or 'contract.pdf'
        response['Content-Disposition'] = f'inline; filename="{filename}"'
        return response

    @action(detail=True, methods=['post'])
    def mark_signed(self, request, pk=None):
        """Đánh dấu hợp đồng đã ký và sync start_date/end_date/contract_type vào Employee."""
        contract = self.get_object()
        if contract.status != 'PENDING_SIGN':
            return Response(
                {'success': False, 'message': f'Chỉ có thể ký hợp đồng ở trạng thái Chờ ký (hiện tại: {contract.get_status_display()})'},
                status=400
            )

        # Nhân viên đã nghỉ việc thì không cho cập nhật hợp đồng thành "Đang hiệu lực" nữa.
        employee_for_check = contract.employee
        if not employee_for_check.is_active or employee_for_check.employment_status == 'INACTIVE':
            return Response(
                {'success': False, 'message': 'Nhân viên đã nghỉ việc, không thể cập nhật hợp đồng thành Đang hiệu lực.'},
                status=400
            )

        from django.utils import timezone as tz
        contract.status = 'SIGNED'
        contract.hr_signed_at = tz.now()
        contract.save(update_fields=['status', 'hr_signed_at'])

        # Tự động expire các hợp đồng SIGNED cũ của cùng nhân viên đã quá end_date
        today = tz.now().date()
        EmployeeContract.objects.filter(
            employee=contract.employee,
            status='SIGNED',
            end_date__lt=today,
        ).exclude(pk=contract.pk).update(status='EXPIRED')

        # Sync vào Employee
        employee = contract.employee
        update_fields = []
        if contract.start_date:
            employee.contract_start_date = contract.start_date
            update_fields.append('contract_start_date')
        if contract.end_date:
            employee.contract_end_date = contract.end_date
            update_fields.append('contract_end_date')
        if contract.contract_type:
            employee.contract_type = contract.contract_type
            update_fields.append('contract_type')
        if update_fields:
            employee.save(update_fields=update_fields)

        return Response({
            'success': True,
            'data': EmployeeContractSerializer(contract, context={'request': request}).data
        })

    @action(detail=True, methods=['post'], url_path='cancel_contract')
    def cancel_contract(self, request, pk=None):
        """Hủy hợp đồng (kể cả SIGNED) để ghi đè khi tạo mới hàng loạt."""
        contract = self.get_object()
        if contract.status in ('CANCELLED', 'EXPIRED'):
            return Response(
                {'success': False, 'message': 'Hợp đồng đã bị hủy hoặc hết hạn'},
                status=400
            )
        contract.status = 'CANCELLED'
        contract.save(update_fields=['status'])
        return Response({
            'success': True,
            'data': EmployeeContractSerializer(contract, context={'request': request}).data
        })

    @action(detail=False, methods=['get'], url_path='my-contracts')
    def my_contracts(self, request):
        """Nhân viên xem danh sách hợp đồng của chính mình."""
        if not hasattr(request.user, 'employee'):
            return Response({'error': 'Không tìm thấy hồ sơ nhân viên'}, status=403)
        employee = request.user.employee
        qs = (
            EmployeeContract.objects
            .filter(employee=employee)
            .select_related('template', 'company_unit', 'employee')
            .order_by('-created_at')
        )
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def get_placeholders(self, request, pk=None):
        """
        Quét template docx, trả về danh sách placeholder kèm giá trị đã fill từ nhân viên.
        Tất cả placeholder đều có thể chỉnh sửa trước khi generate/in.

        Response:
        {
            "placeholders": [
                {"key": "{{ho_ten}}", "value": "Nguyễn Văn A", "auto_filled": true},
                {"key": "{{so_hd}}", "value": "", "auto_filled": false},
                ...
            ]
        }
        """
        import re, tempfile, os, boto3
        from docx import Document
        from django.conf import settings

        contract = self.get_object()
        if not contract.template or not contract.template.file:
            return Response({'success': False, 'placeholders': []})

        tmp_path = None
        try:
            s3_client = boto3.client(
                's3',
                endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
                aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
                aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
                region_name=settings.CLOUDFLY_REGION,
            )
            with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
                s3_client.download_fileobj(settings.CLOUDFLY_BUCKET, str(contract.template.file), tmp)
                tmp_path = tmp.name

            doc = Document(tmp_path)

            # Thu thập toàn bộ text: paragraphs + table cells
            all_text = '\n'.join(p.text for p in doc.paragraphs)
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        all_text += '\n' + cell.text

            # Giữ thứ tự xuất hiện, loại trùng
            keys = list(dict.fromkeys(re.findall(r'\{\{[^}]+\}\}', all_text)))

            # Build default values từ employee
            defaults = self._build_placeholders(contract)

            result = []
            for key in keys:
                value = defaults.get(key, '')
                result.append({
                    'key': key,
                    'value': value,
                    'auto_filled': bool(value),
                    'editable': True,
                    'readonly': False,
                })

            return Response({'success': True, 'placeholders': result})

        except Exception as e:
            return Response({'success': False, 'message': str(e), 'placeholders': []}, status=500)

        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)

    # ============================================
    # ACTION: Generate PDF với override từ HR
    # ============================================

    @action(detail=True, methods=['post'])
    def generate_pdf_with_override(self, request, pk=None):
        contract = self.get_object()
        if not contract.template or not contract.template.file:
            return Response({'success': False, 'message': 'Chưa có template hợp đồng'}, status=400)

        # Xây default từ employee, merge override từ HR
        placeholders = self._build_placeholders(contract)
        raw_overrides = request.data.get('overrides') or request.data.get('placeholders') or {}
        normalized = self._normalize_override_placeholders(raw_overrides)
        placeholders.update(normalized)
        _sync_word_placeholders(placeholders)

        # Nếu HR sửa số HĐ qua placeholder {{so_hd}} hoặc request.data.contract_number
        # → sync sang field contract.contract_number trong DB. Đảm bảo _max_number_in_db
        # nhìn thấy số HR vừa "đánh anchor" (vd HĐ thủ công 0015) → HĐ kế tiếp = max+1.
        new_contract_number = (request.data.get('contract_number') or '').strip()
        if not new_contract_number:
            new_contract_number = (normalized.get('{{so_hd}}') or '').strip()

        try:
            view_url = self._generate_and_upload_pdf(contract, placeholders)
            update_fields = ['generated_file', 'status']
            contract.generated_file = view_url
            contract.status = 'PENDING_SIGN'
            if new_contract_number and new_contract_number != (contract.contract_number or ''):
                contract.contract_number = new_contract_number
                update_fields.append('contract_number')
            contract.save(update_fields=update_fields)

            return Response({
                'success': True,
                'message': 'Đã tạo file hợp đồng thành công',
                'file_url': view_url,
                'data': EmployeeContractSerializer(contract, context={'request': request}).data
            })

        except Exception as e:
            return Response({'success': False, 'message': f'Lỗi tạo PDF: {str(e)}'}, status=500)

    @action(detail=True, methods=['post'], url_path='generate_and_confirm')
    def generate_and_confirm(self, request, pk=None):
        """
        Tạo PDF và gán số HĐ chính thức trong một transaction atomic.
        Dùng cho bulk create — tránh race condition giữa peek_next và next_number
        khi nhiều HR tạo hợp đồng cùng lúc.
        """
        from django.db import transaction
        from hrm.models import ContractCounter

        contract = self.get_object()
        if not contract.template or not contract.template.file:
            return Response({'success': False, 'message': 'Chưa có template hợp đồng'}, status=400)

        overrides_payload = request.data.get('overrides') or request.data.get('placeholders') or {}
        overrides = self._normalize_override_placeholders(overrides_payload)

        # Ưu tiên số HĐ nhập tay (request -> overrides -> DB hiện tại)
        explicit_contract_number = (request.data.get('contract_number') or '').strip()
        if not explicit_contract_number:
            explicit_contract_number = (overrides.get('{{so_hd}}') or '').strip()
        if not explicit_contract_number:
            explicit_contract_number = (contract.contract_number or '').strip()

        try:
            with transaction.atomic():
                # 1. Lock counter row và lấy số HĐ chính thức (increment ngay)
                contract_number = explicit_contract_number or None
                if not contract_number:
                    group = self.CONTRACT_TYPE_TO_GROUP.get(contract.contract_type)
                    if group:
                        year = timezone.now().year
                        prefix = self.GROUP_PREFIX[group]
                        company_unit = contract.company_unit
                        unit_code = self._contract_unit_code(company_unit)
                        number = ContractCounter.next_number(group, company_unit, year, expected_suffix=f"{prefix}-{unit_code}")
                        contract_number = f"{number:04d}/{year}/{prefix}-{unit_code}"

                # 2. Build placeholders — override {{so_hd}} bằng số thật
                placeholders = self._build_placeholders(contract)
                placeholders.update(overrides)
                if contract_number:
                    placeholders['{{so_hd}}'] = contract_number
                _sync_word_placeholders(placeholders)

                # 3. Generate PDF và upload
                view_url = self._generate_and_upload_pdf(contract, placeholders)

                # 4. Lưu tất cả trong cùng transaction
                update_fields = ['generated_file', 'status']
                contract.generated_file = view_url
                contract.status = 'PENDING_SIGN'
                if contract_number:
                    contract.contract_number = contract_number
                    update_fields.append('contract_number')
                contract.save(update_fields=update_fields)

            return Response({
                'success': True,
                'data': EmployeeContractSerializer(contract, context={'request': request}).data
            })

        except Exception as e:
            return Response({'success': False, 'message': f'Lỗi tạo hợp đồng: {str(e)}'}, status=500)

    # ============================================
    # ACTION: Hợp đồng sắp hết hạn
    # ============================================

    @action(detail=False, methods=['get'])
    def expiring_soon(self, request):
        """Lấy danh sách hợp đồng sắp hết hạn trong 7 ngày."""
        import datetime
        today = timezone.now().date()
        in_7_days = today + datetime.timedelta(days=7)

        contracts = EmployeeContract.objects.filter(
            status='SIGNED',
            end_date__range=[today, in_7_days]
        ).select_related('employee', 'onboarding_process')

        return Response({
            'success': True,
            'count': contracts.count(),
            'data': EmployeeContractSerializer(contracts, many=True).data
        })

    @action(detail=False, methods=['get'], url_path='renewal-candidates')
    def renewal_candidates(self, request):
        """Lấy danh sách hợp đồng cần tái ký trong N ngày tới (mặc định 14 ngày)."""
        from datetime import timedelta

        raw_days = request.query_params.get('days', '14')
        try:
            days = int(raw_days)
        except (TypeError, ValueError):
            days = 14
        days = max(1, min(days, 90))

        today = timezone.now().date()
        deadline = today + timedelta(days=days)

        labor_contract_types = [
            'PROBATION', 'INTERN', 'COLLABORATOR',
            'ONE_YEAR', 'TWO_YEAR', 'INDEFINITE', 'SERVICE',
        ]

        qs = (
            EmployeeContract.objects
            .filter(
                status='SIGNED',
                contract_type__in=labor_contract_types,
                end_date__gte=today,
                end_date__lte=deadline,
            )
            .select_related('employee', 'employee__department', 'employee__position', 'template', 'company_unit')
            .order_by('end_date', 'employee__full_name')
        )

        serializer = EmployeeContractSerializer(qs, many=True, context={'request': request})
        return Response({
            'success': True,
            'days': days,
            'count': qs.count(),
            'data': serializer.data,
        })

    @action(detail=False, methods=['get', 'post'], url_path='expiring-alert')
    def expiring_alert(self, request):
        """
        GET  → Trả về danh sách hợp đồng SIGNED hết hạn trong 5 ngày
               kèm trạng thái dismissed_today của user hiện tại.
        POST → Đánh dấu user đã dismiss cảnh báo hôm nay (lưu vào cache).
        """
        from django.core.cache import cache
        from datetime import timedelta

        user_id = request.user.id
        today_str = timezone.now().date().isoformat()
        cache_key = f'contract_alert_dismissed_{user_id}_{today_str}'

        if request.method == 'POST':
            cache.set(cache_key, True, timeout=86400)
            return Response({'success': True, 'dismissed_today': True})

        dismissed_today = bool(cache.get(cache_key))
        today = timezone.now().date()
        in_5_days = today + timedelta(days=5)

        employee = Employee.objects.filter(user=request.user).first()
        if not employee:
            return Response({
                'dismissed_today': dismissed_today,
                'contracts': [],
            })

        LABOR_CONTRACT_TYPES = ['PROBATION', 'INTERN', 'COLLABORATOR', 'ONE_YEAR', 'TWO_YEAR', 'INDEFINITE', 'SERVICE']
        qs = (
            EmployeeContract.objects
            .filter(
                employee=employee,
                status='SIGNED',
                contract_type__in=LABOR_CONTRACT_TYPES,
                end_date__gte=today,
                end_date__lte=in_5_days,
            )
            .select_related('employee')
            .order_by('end_date')
        )
        serializer = EmployeeContractSerializer(qs, many=True, context={'request': request})
        return Response({
            'dismissed_today': dismissed_today,
            'contracts': serializer.data,
        })


# ======================
# GENERIC REQUEST VIEWSET (Đơn từ tổng hợp)
# ======================

class GenericRequestViewSet(viewsets.ModelViewSet):
    """
    ViewSet cho đơn từ tổng hợp.

    Workflow phê duyệt 2 cấp: NV → Manager → Admin
    Hỗ trợ ?scope=mine|manager|admin để filter theo vai trò:
    - mine (default): NV chỉ thấy đơn của chính mình
    - manager: Manager thấy đơn của cấp dưới trực tiếp
    - admin: Admin thấy đơn ở status PENDING_ADMIN trở đi
    """
    serializer_class = GenericRequestSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'request_type']
    search_fields = ['title', 'reason', 'request_code']
    ordering = ['-created_at']

    def _get_visible_q(self, employee, is_admin):
        """
        Trả về Q xác định những đơn mà user hiện tại được xem.

        Quy tắc:
        - Admin (is_staff/is_superuser): thấy TẤT CẢ đơn
        - Mọi user thấy đơn của chính mình
        - Manager thấy đơn của cấp dưới qua 3 nguồn:
          + Direct manager (`employee.manager == me`)
          + Trưởng phòng (`department.manager == me`)
          + Vị trí is_management → cùng phòng ban
        - HR thấy toàn bộ đơn nghỉ việc để xử lý offboarding; với các loại đơn
          khác, HR có quyền giống nhân viên/manager thông thường.
        """
        from django.db.models import Q

        if is_admin:
            return Q()  # Empty Q = không filter, thấy tất cả

        if not employee:
            return Q(pk__in=[])  # Không thấy gì

        q = Q(employee=employee)  # Đơn của chính mình

        # Trang Offboarding dành cho HCNS, nhưng không mở rộng visibility của HR
        # sang các loại đơn chung như PROPOSAL, CONFIRMATION...
        if getattr(employee, 'is_hr', False):
            q |= Q(request_type='RESIGNATION')

        # Cấp dưới trực tiếp
        q |= Q(employee__manager=employee)

        # Phòng ban mình quản lý
        if employee.department_id:
            q |= Q(employee__department__manager=employee)

        # Vị trí is_management → cùng phòng ban
        if employee.position and getattr(employee.position, 'is_management', False):
            if employee.department_id:
                q |= Q(employee__department_id=employee.department_id)

        return q

    def get_queryset(self):
        """
        Trả về danh sách đơn mà user hiện tại được xem (theo visible-Q).
        Hỗ trợ filter:
        - ?owner=me           — chỉ đơn của chính mình
        - ?owner=subordinates — chỉ đơn của cấp dưới (loại trừ đơn của chính mình)
        - ?status=...         — filter theo trạng thái
        - ?request_type=...   — filter theo loại đơn
        - ?month=&year=       — filter theo tháng/năm tạo đơn
        - ?search=...         — search title/reason/request_code
        """
        user = self.request.user
        is_admin = user.is_staff or user.is_superuser

        try:
            employee = Employee.objects.get(user=user)
        except Employee.DoesNotExist:
            employee = None

        # Loại bỏ đơn đã soft delete — chỉ Django admin hoặc audit mới thấy
        qs = GenericRequest.objects.filter(is_deleted=False).select_related(
            'employee',
            'employee__manager',
            'employee__department',
            'employee__department__manager',
            'employee__position',
            'manager_approved_by',
            'admin_approved_by',
        )

        owner = self.request.query_params.get('owner')

        # Tab "Đơn của tôi" (owner=me): strict filter theo employee của user hiện tại.
        # Kể cả admin/superuser ở tab này cũng CHỈ thấy đơn do chính mình tạo,
        # không thấy đơn của người khác.
        if owner == 'me':
            if not employee:
                qs = qs.none()
            else:
                qs = qs.filter(employee=employee).distinct()
        else:
            # Các tab khác: áp dụng visible-Q theo permission
            visible_q = self._get_visible_q(employee, is_admin)
            qs = qs.filter(visible_q).distinct()
            if owner == 'subordinates' and employee:
                # "subordinates" phải nghĩa là NGƯỜI MÌNH QUẢN LÝ, không phải
                # "mọi người trừ mình". Với Admin, visible_q là Q() rỗng (thấy
                # tất cả) nên exclude(self) để lại TOÀN CÔNG TY — hệ quả: Admin
                # kiêm quản lý trực tiếp mở tab duyệt cấp dưới sẽ thấy cả đơn
                # của cấp dưới người khác và duyệt thay bước 1 của họ, bỏ qua
                # quản lý thật (phát hiện 2026-10-01 khi sửa trang Tạm ứng lương).
                sub_q = Q(employee__manager=employee)
                if employee.department_id:
                    sub_q |= Q(employee__department__manager=employee)
                qs = qs.filter(sub_q).exclude(employee=employee)

        # Lọc theo tháng/năm dựa trên created_at
        month = self.request.query_params.get('month')
        year = self.request.query_params.get('year')
        try:
            if month:
                qs = qs.filter(created_at__month=int(month))
            if year:
                qs = qs.filter(created_at__year=int(year))
        except ValueError:
            pass

        return qs

    def perform_create(self, serializer):
        try:
            employee = Employee.objects.get(user=self.request.user)
        except Employee.DoesNotExist:
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError({'detail': 'Tài khoản chưa được liên kết với nhân viên.'})
        serializer.save(employee=employee)

    def partial_update(self, request, *args, **kwargs):
        """
        Sửa đơn:
        - NV (chủ đơn): chỉ sửa được khi status = DRAFT
        - HCNS/Admin: sửa đơn nghỉ việc khi status = DRAFT hoặc PENDING_ADMIN
        - Khi HCNS/Admin sửa ở PENDING_ADMIN: chỉ cho phép thay đổi `extra_data`
          (các field khác như title, reason, expected_date... bị loại bỏ
          để tránh sửa nhầm thông tin đơn đã được NV submit)
        """
        instance = self.get_object()
        is_admin = request.user.is_staff or request.user.is_superuser

        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            employee = None

        is_owner = employee and instance.employee_id == employee.id

        can_manage_offboarding = (
            is_admin
            or (
                employee
                and employee.is_hr
                and instance.request_type == 'RESIGNATION'
            )
        )

        if can_manage_offboarding:
            if instance.status not in ['DRAFT', 'PENDING_ADMIN']:
                return Response(
                    {'detail': 'HCNS/Admin chỉ có thể sửa đơn ở trạng thái Nháp hoặc Chờ HCNS duyệt.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            # Whitelist: ở PENDING_ADMIN chỉ cho HCNS/Admin sửa extra_data
            if instance.status == 'PENDING_ADMIN':
                allowed_fields = {'extra_data'}
                if hasattr(request.data, '_mutable'):
                    request.data._mutable = True
                for key in list(request.data.keys()):
                    if key not in allowed_fields:
                        del request.data[key]
        elif is_owner:
            if instance.status != 'DRAFT':
                return Response(
                    {'detail': 'Chỉ có thể sửa đơn ở trạng thái Nháp.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            return Response(
                {'detail': 'Bạn không có quyền sửa đơn này.'},
                status=status.HTTP_403_FORBIDDEN
            )

        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """
        Xoá đơn (soft delete cho HCNS/Admin, hard delete cho NV ở DRAFT):
        - NV (chủ đơn): chỉ xoá được khi status = DRAFT (hard delete)
        - HCNS/Admin: xoá đơn nghỉ việc ở MỌI trạng thái (soft delete)
        """
        instance = self.get_object()
        is_admin = request.user.is_staff or request.user.is_superuser

        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            employee = None

        is_owner = employee and instance.employee_id == employee.id

        can_manage_offboarding = (
            is_admin
            or (
                employee
                and employee.is_hr
                and instance.request_type == 'RESIGNATION'
            )
        )

        if can_manage_offboarding:
            # HCNS/Admin: soft delete ở mọi trạng thái
            instance.is_deleted = True
            instance.deleted_at = timezone.now()
            instance.deleted_by = request.user
            instance.save(update_fields=['is_deleted', 'deleted_at', 'deleted_by', 'updated_at'])
            return Response(status=status.HTTP_204_NO_CONTENT)

        if is_owner:
            if instance.status != 'DRAFT':
                return Response(
                    {'detail': 'Bạn chỉ có thể xoá đơn ở trạng thái Nháp.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            # NV xoá đơn Nháp của mình → hard delete (chưa submit thì không cần audit)
            return super().destroy(request, *args, **kwargs)

        return Response(
            {'detail': 'Bạn không có quyền xoá đơn này.'},
            status=status.HTTP_403_FORBIDDEN
        )

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """Gửi đơn để duyệt (DRAFT -> PENDING_MANAGER)"""
        req = self.get_object()

        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            employee = None

        if not employee or req.employee_id != employee.id:
            if not (request.user.is_staff or request.user.is_superuser):
                return Response(
                    {'error': 'Bạn không có quyền submit đơn này.'},
                    status=status.HTTP_403_FORBIDDEN
                )

        if req.status != 'DRAFT':
            return Response(
                {'error': 'Chỉ có thể submit đơn ở trạng thái Nháp.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        req.status = 'PENDING_MANAGER'
        req.submitted_at = timezone.now()
        req.save(update_fields=['status', 'submitted_at', 'updated_at'])
        return Response(GenericRequestSerializer(req).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """
        Huỷ đơn:
        - NV (chủ đơn): chỉ huỷ được ở DRAFT hoặc PENDING_MANAGER
          (khi Manager đã duyệt → PENDING_ADMIN thì không thể huỷ,
           vì đơn đã qua một bước phê duyệt chính thức)
        - Admin: huỷ được cả DRAFT, PENDING_MANAGER, PENDING_ADMIN
        """
        req = self.get_object()

        try:
            employee = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            employee = None

        is_admin = request.user.is_staff or request.user.is_superuser
        is_owner = employee and req.employee_id == employee.id

        if not is_admin and not is_owner:
            return Response(
                {'error': 'Bạn không có quyền huỷ đơn này.'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Whitelist status cho từng vai trò
        if is_admin:
            allowed_statuses = ['DRAFT', 'PENDING_MANAGER', 'PENDING_ADMIN']
        else:
            # NV: không huỷ được khi đơn đã qua Manager (PENDING_ADMIN)
            allowed_statuses = ['DRAFT', 'PENDING_MANAGER']

        if req.status not in allowed_statuses:
            if is_owner and req.status == 'PENDING_ADMIN':
                msg = 'Đơn đã được Quản lý duyệt và đang chờ HCNS xử lý. Bạn không thể tự huỷ, vui lòng liên hệ HCNS.'
            else:
                msg = 'Không thể huỷ đơn ở trạng thái hiện tại.'
            return Response(
                {'error': msg},
                status=status.HTTP_400_BAD_REQUEST
            )

        req.status = 'CANCELLED'
        req.save(update_fields=['status', 'updated_at'])
        return Response(GenericRequestSerializer(req).data)

    @action(detail=False, methods=['get', 'post'], url_path='approval-lock')
    def approval_lock(self, request):
        """
        Công tắc khoá/mở khoá rule "đơn tạm ứng lương chỉ được duyệt trong
        3 ngày đầu tháng" (xem SalaryAdvanceApprovalLock, _check_salary_advance_window).
        - GET: ai đã đăng nhập cũng xem được trạng thái hiện tại.
        - POST: chỉ Admin (is_staff/is_superuser) được bật/tắt.
        """
        from .models import SalaryAdvanceApprovalLock

        lock = SalaryAdvanceApprovalLock.get_solo()

        if request.method == 'GET':
            return Response({
                'is_locked': lock.is_locked,
                'updated_by_name': get_user_display_name(lock.updated_by) if lock.updated_by else None,
                'updated_at': lock.updated_at,
            })

        is_admin = request.user.is_staff or request.user.is_superuser
        if not is_admin:
            return Response(
                {'error': 'Chỉ Admin mới có quyền khoá/mở khoá duyệt đơn tạm ứng lương.'},
                status=status.HTTP_403_FORBIDDEN
            )

        is_locked = request.data.get('is_locked')
        if not isinstance(is_locked, bool):
            return Response(
                {'error': 'Thiếu trường is_locked (boolean).'},
                status=status.HTTP_400_BAD_REQUEST
            )

        lock.is_locked = is_locked
        lock.updated_by = request.user
        lock.save(update_fields=['is_locked', 'updated_by', 'updated_at'])
        return Response({
            'is_locked': lock.is_locked,
            'updated_by_name': get_user_display_name(lock.updated_by),
            'updated_at': lock.updated_at,
        })

    @action(detail=False, methods=['get', 'post'], url_path='creation-lock')
    def creation_lock(self, request):
        """
        Công tắc khoá/mở khoá rule "đơn tạm ứng lương chỉ được TẠO trong
        3 ngày đầu tháng" (xem SalaryAdvanceCreationLock,
        _validate_salary_advance ở serializers.py) — khác approval_lock ở
        trên (cái đó khoá phía DUYỆT).
        - GET: ai đã đăng nhập cũng xem được trạng thái hiệu lực hiện tại
          (is_effectively_locked() — mở khoá tự hết hiệu lực khi sang tháng mới).
        - POST: chỉ Admin (is_staff/is_superuser) được bật/tắt.
        """
        from .models import SalaryAdvanceCreationLock

        lock = SalaryAdvanceCreationLock.get_solo()

        if request.method == 'GET':
            return Response({
                'is_locked': lock.is_effectively_locked(),
                # Khung tạo đơn mặc định (00:00 ngày 1 - 15:30 ngày 3, giờ VN) theo
                # giờ server — FE dùng giá trị này thay vì đồng hồ máy người dùng.
                'window_open': GenericRequestSerializer.is_salary_advance_creation_window_open(),
                'updated_by_name': get_user_display_name(lock.updated_by) if lock.updated_by else None,
                'updated_at': lock.updated_at,
            })

        is_admin = request.user.is_staff or request.user.is_superuser
        if not is_admin:
            return Response(
                {'error': 'Chỉ Admin mới có quyền khoá/mở khoá tạo đơn tạm ứng lương.'},
                status=status.HTTP_403_FORBIDDEN
            )

        is_locked = request.data.get('is_locked')
        if not isinstance(is_locked, bool):
            return Response(
                {'error': 'Thiếu trường is_locked (boolean).'},
                status=status.HTTP_400_BAD_REQUEST
            )

        lock.is_locked = is_locked
        lock.updated_by = request.user
        lock.save(update_fields=['is_locked', 'updated_by', 'updated_at'])
        return Response({
            'is_locked': lock.is_effectively_locked(),
            'updated_by_name': get_user_display_name(lock.updated_by),
            'updated_at': lock.updated_at,
        })

    def _check_salary_advance_window(self, req):
        """
        Đơn SALARY_ADVANCE chỉ được duyệt (manager-approve/admin-approve) trong
        3 ngày đầu tháng, trừ khi SalaryAdvanceApprovalLock đang ở trạng thái
        mở khoá. Trả về Response lỗi 400 nếu bị chặn, ngược lại None.
        """
        if req.request_type != 'SALARY_ADVANCE':
            return None

        from .models import SalaryAdvanceApprovalLock

        lock = SalaryAdvanceApprovalLock.get_solo()
        if lock.is_locked and timezone.now().day not in (1, 2, 3):
            return Response(
                {'error': 'Đơn tạm ứng lương chỉ được duyệt trong 3 ngày đầu tháng. Liên hệ Admin để mở khoá nếu cần duyệt ngoài thời gian này.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        return None

    # ── APPROVAL ACTIONS ─────────────────────────────────────────────────
    # Pattern Manager / HR / Admin theo cùng cách với taodon_views.py:
    #   is_admin       = request.user.is_staff or is_superuser
    #   is_direct_mgr  = req.employee.manager == approver
    #   is_hr_user     = _is_hr(approver)
    #   has_perm       = _has_approve_permission(approver)
    #   is_creator_senior_mgr = is_senior_manager(req.employee)
    #
    # Workflow GenericRequest: NV → Manager → Admin
    # - HR KHÔNG nằm trong workflow chính (đơn nghỉ việc do Admin duyệt cuối)
    # - Admin (is_staff/is_superuser) có thể bypass cả 2 cấp
    # - Senior Manager exception: nếu NV là senior_mgr và không có manager → Admin có
    #   thể duyệt cả 2 cấp luôn (giống logic taodon_views).
    # - HR exception: nếu NV là HR thì Manager duyệt xong sẽ chuyển PENDING_ADMIN
    #   (không tự skip vì workflow có Admin riêng).

    def _apply_final_approval_effects(self, req, request, now):
        """Tác động phụ khi đơn được DUYỆT CUỐI (status -> APPROVED). Phải gọi ở
        MỌI đường duyệt cuối: admin_approve() và nhánh Admin bypass của
        manager_approve() — trước đây nhánh bypass bỏ sót, đơn tạm ứng APPROVED
        nhưng không có bản ghi SalaryAdvance (case NV80021, ADV-202610-0070)."""
        # Sync Employee.end_date khi RESIGNATION được duyệt cuối cùng.
        # Single source of truth: expected_date trên đơn đã duyệt.
        if req.request_type == 'RESIGNATION' and req.expected_date and req.employee_id:
            try:
                emp = Employee.objects.get(pk=req.employee_id)
                if emp.end_date != req.expected_date:
                    emp.end_date = req.expected_date
                    emp.save(update_fields=['end_date'])
            except Employee.DoesNotExist:
                pass

        # Sync salary.SalaryAdvance khi SALARY_ADVANCE được duyệt cuối cùng.
        # NV đăng ký ngày 1-3 của tháng X → là tạm ứng cho lương tháng (X-1)
        # (lương tháng trước được trả đầu tháng X). Vì vậy year/month của
        # SalaryAdvance phải lùi 1 tháng so với thời điểm tạo đơn.
        # finalization_views._get_advance() đọc bản ghi (year, month) → trừ vào
        # net_salary khi chốt công tháng đó.
        # Unique (employee, year, month): nếu đã có thì cộng dồn vào amount cũ
        # để tránh raise IntegrityError khi NV được duyệt nhiều đơn trong cùng tháng.
        if req.request_type == 'SALARY_ADVANCE' and req.employee_id:
            try:
                from salary.salary_data_models import SalaryAdvance as _SA
                from decimal import Decimal as _Dec
                _amount = _Dec(str((req.extra_data or {}).get('amount') or 0))
                if _amount > 0:
                    # Lùi 1 tháng so với thời điểm submit/create đơn (luôn trong
                    # window ngày 1-3) — không phụ thuộc thời điểm admin duyệt.
                    _ref = req.submitted_at or req.created_at or now
                    if _ref.month == 1:
                        _year, _month = _ref.year - 1, 12
                    else:
                        _year, _month = _ref.year, _ref.month - 1
                    _actor = getattr(request.user, 'employee', None)
                    _obj, _created = _SA.objects.get_or_create(
                        employee_id=req.employee_id,
                        year=_year,
                        month=_month,
                        defaults={
                            'amount': _amount,
                            'notes': f'Auto từ đơn {req.request_code}',
                            'created_by': _actor,
                        },
                    )
                    if not _created:
                        _obj.amount = (_obj.amount or _Dec(0)) + _amount
                        _obj.notes = (
                            (_obj.notes + '\n' if _obj.notes else '')
                            + f'+{_amount} từ đơn {req.request_code}'
                        )
                        _obj.save(update_fields=['amount', 'notes', 'updated_at'])
            except Exception:
                logger.exception(
                    "[final_approval] Không sync được SalaryAdvance từ đơn %s",
                    req.request_code,
                )

    @action(detail=True, methods=['post'], url_path='manager-approve')
    def manager_approve(self, request, pk=None):
        """
        Cấp 1: Quản lý trực tiếp duyệt (PENDING_MANAGER → PENDING_ADMIN).
        - Direct Manager (employee.manager == approver) → bước Manager
        - Admin → bypass, duyệt cả 2 bước → APPROVED ngay
        - Senior Manager creator (không có manager) + Admin → bypass
        - HR KHÔNG có đặc quyền với GenericRequest — phải giống staff thường
        """
        from django.shortcuts import get_object_or_404
        from .models import is_senior_manager

        req = get_object_or_404(GenericRequest, pk=pk)

        try:
            approver = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            approver = None

        is_admin = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = approver is not None and req.employee.manager_id == approver.id
        is_creator_senior_mgr = is_senior_manager(req.employee)

        # Chặn self-approval (phòng trường hợp data bug employee tự làm manager của mình)
        if approver is not None and approver.id == req.employee_id and not is_admin:
            return Response(
                {'error': 'Bạn không thể tự duyệt đơn của chính mình.'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Chỉ Quản lý trực tiếp hoặc Admin mới được duyệt
        if not (is_direct_mgr or is_admin):
            return Response(
                {'error': 'Bạn không có quyền duyệt đơn này (chỉ Quản lý trực tiếp hoặc Admin).'},
                status=status.HTTP_403_FORBIDDEN
            )

        if req.status != 'PENDING_MANAGER':
            return Response(
                {'error': f'Đơn đang ở trạng thái "{req.get_status_display()}", không thể duyệt cấp Quản lý.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        window_error = self._check_salary_advance_window(req)
        if window_error:
            return window_error

        now = timezone.now()
        note = request.data.get('approval_note') or request.data.get('note') or ''

        # Lưu thông tin bước Manager
        if approver:
            req.manager_approved_by = approver
        req.manager_approved_at = now

        if is_admin:
            # Admin bypass: duyệt cả 2 bước → APPROVED ngay
            req.admin_approved_by = request.user
            req.admin_approved_at = now
            req.approved_at = now
            req.status = 'APPROVED'
        elif is_creator_senior_mgr and not req.employee.manager:
            # Creator là senior manager không có quản lý trực tiếp → chỉ chuyển sang Admin step
            req.status = 'PENDING_ADMIN'
        else:
            # Bình thường: Manager duyệt → chờ Admin
            req.status = 'PENDING_ADMIN'

        if note:
            req.approval_note = note

        req.save(update_fields=[
            'status', 'manager_approved_at', 'manager_approved_by',
            'admin_approved_at', 'admin_approved_by', 'approved_at',
            'approval_note', 'updated_at',
        ])
        if req.status == 'APPROVED':
            self._apply_final_approval_effects(req, request, now)
        return Response(GenericRequestSerializer(req).data)

    @action(detail=True, methods=['post'], url_path='admin-approve')
    def admin_approve(self, request, pk=None):
        """
        Cấp 2 (cuối): HCNS/Admin duyệt (PENDING_ADMIN → APPROVED).
        HR được duyệt cuối đối với đơn nghỉ việc phục vụ offboarding.
        """
        from django.shortcuts import get_object_or_404
        req = get_object_or_404(GenericRequest, pk=pk)

        is_admin = request.user.is_staff or request.user.is_superuser
        try:
            approver = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            approver = None
        can_manage_offboarding = (
            is_admin
            or (
                approver
                and approver.is_hr
                and req.request_type == 'RESIGNATION'
            )
        )
        if not can_manage_offboarding:
            return Response(
                {'error': 'Chỉ HCNS/Admin được duyệt bước cuối.'},
                status=status.HTTP_403_FORBIDDEN
            )

        if req.status != 'PENDING_ADMIN':
            return Response(
                {'error': f'Đơn đang ở trạng thái "{req.get_status_display()}", không thể duyệt cấp Admin.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        window_error = self._check_salary_advance_window(req)
        if window_error:
            return window_error

        now = timezone.now()
        note = request.data.get('approval_note') or request.data.get('note') or ''

        req.status = 'APPROVED'
        req.admin_approved_by = request.user
        req.admin_approved_at = now
        req.approved_at = now
        if note:
            req.approval_note = note

        req.save(update_fields=[
            'status', 'admin_approved_at', 'admin_approved_by',
            'approved_at', 'approval_note', 'updated_at',
        ])

        self._apply_final_approval_effects(req, request, now)

        return Response(GenericRequestSerializer(req).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """
        Từ chối đơn — chung cho cả 2 cấp.
        - Manager từ chối ở status=PENDING_MANAGER → rejected_level=MANAGER
        - Admin từ chối ở status=PENDING_MANAGER hoặc PENDING_ADMIN → rejected_level=ADMIN
        - HR được từ chối ở bước HCNS đối với đơn nghỉ việc.
        """
        from django.shortcuts import get_object_or_404

        req = get_object_or_404(GenericRequest, pk=pk)
        note = request.data.get('approval_note') or request.data.get('note') or ''

        is_admin = request.user.is_staff or request.user.is_superuser
        try:
            approver = Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            approver = None

        is_direct_mgr = approver is not None and req.employee.manager_id == approver.id
        is_offboarding_hr = (
            approver is not None
            and approver.is_hr
            and req.request_type == 'RESIGNATION'
        )

        # Chặn self-reject (phòng trường hợp data bug employee tự làm manager của mình)
        if approver is not None and approver.id == req.employee_id and not is_admin:
            return Response(
                {'error': 'Bạn không thể tự từ chối đơn của chính mình.'},
                status=status.HTTP_403_FORBIDDEN
            )

        # Xác định cấp từ chối
        if is_admin or (is_offboarding_hr and req.status == 'PENDING_ADMIN'):
            level = 'ADMIN' if req.status == 'PENDING_ADMIN' else 'MANAGER'
        elif is_direct_mgr and req.status == 'PENDING_MANAGER':
            level = 'MANAGER'
        else:
            return Response(
                {'error': 'Bạn không có quyền từ chối đơn này ở trạng thái hiện tại.'},
                status=status.HTTP_403_FORBIDDEN
            )

        if req.status not in ['PENDING_MANAGER', 'PENDING_ADMIN']:
            return Response(
                {'error': f'Đơn đang ở trạng thái "{req.get_status_display()}", không thể từ chối.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        req.status = 'REJECTED'
        req.rejected_level = level
        req.rejected_at = timezone.now()
        req.approval_note = note
        req.save(update_fields=[
            'status', 'rejected_level', 'rejected_at', 'approval_note', 'updated_at'
        ])
        return Response(GenericRequestSerializer(req).data)

    @action(detail=True, methods=['get'], url_path='preview-pdf')
    def preview_pdf(self, request, pk=None):
        """
        Fill template DOCX (theo loại đơn + đơn vị) với dữ liệu đơn rồi convert PDF.
        Trả file PDF inline để FE hiển thị trong iframe modal.
        """
        from django.http import HttpResponse
        from django.shortcuts import get_object_or_404
        from .docx_pdf_utils import render_template_to_pdf
        from datetime import datetime

        req = get_object_or_404(GenericRequest, pk=pk)
        company_unit_id = (req.extra_data or {}).get('company_unit_id')

        if not company_unit_id:
            return Response(
                {'error': 'Đơn chưa chọn đơn vị làm việc'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            tpl = RequestTemplate.objects.get(
                request_type=req.request_type,
                company_unit_id=company_unit_id,
                is_active=True
            )
        except RequestTemplate.DoesNotExist:
            return Response(
                {'error': 'Chưa có template DOCX cho loại đơn + đơn vị này. HR cần upload template tại "Template đơn từ".'},
                status=status.HTTP_404_NOT_FOUND
            )

        if not tpl.file:
            return Response(
                {'error': 'Template không có file'},
                status=status.HTTP_400_BAD_REQUEST
            )

        emp = req.employee
        today = datetime.now()

        def fmt_date(d):
            if not d:
                return ''
            try:
                return d.strftime('%d/%m/%Y')
            except Exception:
                return str(d)

        # Map work_form từ đơn (do user chọn lúc tạo đơn) sang label hiển thị
        # User chọn 'PROBATION'/'OFFICIAL' → fill 'Thử việc'/'Chính thức' vào form
        extra = req.extra_data or {}
        work_form_value = extra.get('work_form', '')
        WORK_FORM_LABELS = {
            'PROBATION': 'Thử việc',
            'OFFICIAL': 'Chính thức',
        }
        work_form_label = WORK_FORM_LABELS.get(work_form_value, work_form_value or '')

        # Admin override từ extra_data (set ở PENDING_ADMIN), fallback Employee profile
        position_override = (extra.get('position_override') or '').strip()
        department_override = (extra.get('department_override') or '').strip()
        position_final = position_override or (emp.position.title if emp.position else '')
        department_final = department_override or (emp.department.name if emp.department else '')

        # Context cho docxtpl - placeholder dùng Jinja syntax {{ var }}
        context = {
            'full_name': emp.full_name or '',
            'employee_id': emp.employee_id or '',
            'employee_code': emp.employee_id or '',
            'gender': emp.get_gender_display() if emp.gender else '',
            'date_of_birth': fmt_date(emp.date_of_birth),
            'phone_number': emp.phone_number or '',
            'personal_email': emp.personal_email or '',
            'position': position_final,
            'department': department_final,
            'work_form': work_form_label,
            'contract_type': work_form_label,
            'start_date': fmt_date(emp.start_date),
            'reason': req.reason or '',
            'expected_date': fmt_date(req.expected_date),
            'expected_day': req.expected_date.day if req.expected_date else '',
            'expected_month': req.expected_date.month if req.expected_date else '',
            'expected_year': req.expected_date.year if req.expected_date else '',
            'today': fmt_date(today),
            'today_day': today.day,
            'today_month': today.month,
            'today_year': today.year,
            'request_code': req.request_code or '',
            'company_unit_name': (req.extra_data or {}).get('company_unit_name', ''),
            'handover_to': (req.extra_data or {}).get('handover_to', ''),
            'feedback': (req.extra_data or {}).get('feedback', ''),
        }

        try:
            pdf_bytes = render_template_to_pdf(tpl.file.path, context)
        except Exception as e:
            logger.exception("Lỗi render đơn sang PDF")
            return Response(
                {'error': f'Tạo PDF thất bại: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        resp = HttpResponse(pdf_bytes, content_type='application/pdf')
        resp['Content-Disposition'] = f'inline; filename="don_{req.request_code or req.id}.pdf"'
        return resp


# ======================
# REQUEST TEMPLATE VIEWSET
# ======================

class RequestTemplateViewSet(viewsets.ModelViewSet):
    """ViewSet quản lý template cho đơn từ tổng hợp (admin/HR upload, user xem)"""
    serializer_class = RequestTemplateSerializer
    queryset = RequestTemplate.objects.select_related('company_unit', 'created_by').all()
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['request_type', 'company_unit', 'is_active']
    search_fields = ['name', 'description']

    def get_permissions(self):
        # User thường được list/retrieve để biết có template nào
        # Chỉ admin/HR được create/update/delete
        if self.action in ['list', 'retrieve', 'preview_pdf']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsSuperUser()]

    def _normalize_uploaded_file(self):
        """
        Kiểm tra và auto-convert file upload sang DOCX chuẩn nếu cần.
        Trả về SimpleUploadedFile đã convert (hoặc None nếu file gốc đã hợp lệ).
        """
        from django.core.files.uploadedfile import SimpleUploadedFile
        from .docx_pdf_utils import normalize_docx_upload

        file_obj = self.request.FILES.get('file')
        if not file_obj:
            return None

        try:
            converted_bytes, was_converted = normalize_docx_upload(file_obj)
        except Exception as e:
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError({
                'file': f'Không thể xử lý file: {str(e)}. File phải là DOCX hợp lệ '
                        f'hoặc DOC sẽ được tự động convert.'
            })

        if not (was_converted and converted_bytes):
            return None

        # Đảm bảo extension là .docx
        original_name = file_obj.name
        base, _ = os.path.splitext(original_name)
        new_name = f"{base}.docx"
        return SimpleUploadedFile(
            new_name,
            converted_bytes,
            content_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )

    def perform_create(self, serializer):
        new_file = self._normalize_uploaded_file()
        extra = {'created_by': self.request.user}
        if new_file is not None:
            # Ghi đè file đã convert; DRF sẽ dùng file này thay vì file gốc
            extra['file'] = new_file
        serializer.save(**extra)

    def perform_update(self, serializer):
        new_file = self._normalize_uploaded_file()
        if new_file is not None:
            serializer.save(file=new_file)
        else:
            serializer.save()

    @action(detail=True, methods=['get'], url_path='preview-pdf')
    def preview_pdf(self, request, pk=None):
        """
        Convert template DOCX gốc sang PDF để xem trước (admin xem mẫu chưa fill).
        Trả về file PDF inline.
        """
        from django.http import HttpResponse
        from .docx_pdf_utils import render_raw_template_to_pdf

        tpl = self.get_object()
        if not tpl.file:
            return Response({'error': 'Template chưa có file'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            pdf_bytes = render_raw_template_to_pdf(tpl.file.path)
        except Exception as e:
            logger.exception("Lỗi convert template sang PDF")
            return Response(
                {'error': f'Convert PDF thất bại: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        resp = HttpResponse(pdf_bytes, content_type='application/pdf')
        resp['Content-Disposition'] = f'inline; filename="template_{tpl.id}.pdf"'
        return resp


class ChangeAvatarView(APIView):
    """
    API để đổi avatar của user HRM.
    POST /api-hrm/change-avatar/
    Body: multipart/form-data với trường 'avatar' là file ảnh.
    Trả về presigned URL của avatar mới.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        avatar_file = request.FILES.get('avatar')
        if not avatar_file:
            return Response({'error': 'Vui lòng tải lên file ảnh avatar'}, status=status.HTTP_400_BAD_REQUEST)

        # Kiểm tra content type
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
        content_type = getattr(avatar_file, 'content_type', '') or ''
        if content_type not in allowed_types:
            return Response(
                {'error': 'Chỉ hỗ trợ định dạng ảnh: JPEG, PNG, WebP, GIF'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            employee = request.user.employee
        except Exception:
            return Response({'error': 'Tài khoản không có hồ sơ nhân viên'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from .utils import upload_file_to_cloudfly, get_cloudfly_presigned_url
            s3_key = upload_file_to_cloudfly(avatar_file, folder='hrm/avatars')
        except Exception as e:
            logger.error(f"Avatar upload failed for employee {employee.employee_id}: {type(e).__name__}")
            return Response({'error': 'Upload ảnh thất bại, vui lòng thử lại'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        employee.avatar = s3_key
        employee.save(update_fields=['avatar'])

        avatar_url = get_cloudfly_presigned_url(s3_key)
        return Response({
            'success': True,
            'message': 'Cập nhật avatar thành công',
            'avatar_url': avatar_url,
        }, status=status.HTTP_200_OK)


class PublicStatsAPIView(APIView):
    """Public endpoint — no auth required. Returns minimal HR stats for landing page."""
    permission_classes = [AllowAny]

    def get(self, request):
        from .models import LeaveRequest
        today = timezone.now().date()
        active = Employee.objects.filter(employment_status='ACTIVE').count()
        department_count = Department.objects.filter(
            employees__employment_status='ACTIVE'
        ).distinct().count()
        monthly_leave = LeaveRequest.objects.filter(
            status='APPROVED',
            start_date__year=today.year,
            start_date__month=today.month,
        ).values('employee').distinct().count()
        return Response({
            'active': active,
            'department_count': department_count,
            'monthly_leave': monthly_leave,
        })

class BulkSalaryConfigImportView(APIView):
    """Bulk import cấu hình tính lương cho nhiều nhân viên từ Excel."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from users.utils import get_user_role
        if get_user_role(request.user) != 'admin':
            return Response(
                {'detail': 'Chỉ admin mới có quyền cập nhật cấu hình lương.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        from employee.models import Employee as EmployeeModel
        records = request.data.get('records', [])
        if not records:
            return Response({'error': 'Không có dữ liệu.'}, status=status.HTTP_400_BAD_REQUEST)

        success_list = []
        error_list = []

        for rec in records:
            employee_code = (rec.get('employee_code') or '').strip()
            if not employee_code:
                error_list.append({'employee_code': employee_code, 'error': 'Thiếu mã nhân viên.'})
                continue

            try:
                employee = EmployeeModel.objects.get(employee_id=employee_code)
            except EmployeeModel.DoesNotExist:
                error_list.append({'employee_code': employee_code, 'error': 'Không tìm thấy nhân viên.'})
                continue

            try:
                existing_adjustments = dict(employee.salary_adjustments or {})
                existing_config = dict(existing_adjustments.get('payroll_config') or {})
                merged = dict(existing_config)
                update_fields = ['salary_adjustments']

                # ── baseSalary ──────────────────────────────────────────────────
                base_updates = {}
                if rec.get('basic_salary') is not None:
                    base_updates['amount'] = float(rec['basic_salary'])
                    employee.basic_salary = rec['basic_salary']
                    update_fields.append('basic_salary')
                if rec.get('salary_factor') is not None:
                    base_updates['factor'] = float(rec['salary_factor'])
                if rec.get('effective_date'):
                    base_updates['effectiveDate'] = rec['effective_date']
                if base_updates:
                    merged['baseSalary'] = {**dict(merged.get('baseSalary') or {}), **base_updates}

                # ── lunchAllowancePolicy ────────────────────────────────────────
                lunch_updates = {}
                if rec.get('lunch_mode') is not None:
                    lunch_updates['mode'] = rec['lunch_mode']
                if rec.get('lunch_amount') is not None:
                    lunch_updates['monthlyCap'] = float(rec['lunch_amount'])
                if lunch_updates:
                    merged['lunchAllowancePolicy'] = {**dict(merged.get('lunchAllowancePolicy') or {}), **lunch_updates}

                # ── parkingAllowancePolicy ──────────────────────────────────────
                parking_updates = {}
                if rec.get('parking_mode') is not None:
                    parking_updates['mode'] = rec['parking_mode']
                if rec.get('parking_rate') is not None:
                    mode = rec.get('parking_mode') or (merged.get('parkingAllowancePolicy') or {}).get('mode', '')
                    if mode == 'daily':
                        parking_updates['dailyRate'] = float(rec['parking_rate'])
                    else:
                        parking_updates['monthlyRate'] = float(rec['parking_rate'])
                if parking_updates:
                    merged['parkingAllowancePolicy'] = {**dict(merged.get('parkingAllowancePolicy') or {}), **parking_updates}

                # ── responsibilityAllowancePolicy ───────────────────────────────
                resp_updates = {}
                if rec.get('responsibility_mode') is not None:
                    resp_updates['mode'] = rec['responsibility_mode']
                if rec.get('responsibility_amount') is not None:
                    resp_updates['monthlyMax'] = float(rec['responsibility_amount'])
                if resp_updates:
                    merged['responsibilityAllowancePolicy'] = {**dict(merged.get('responsibilityAllowancePolicy') or {}), **resp_updates}

                # ── taxPolicy ──────────────────────────────────────────────────
                tax_updates = {}
                if rec.get('region') is not None:
                    tax_updates['region'] = rec['region']
                if rec.get('insurance_mode') is not None:
                    tax_updates['insuranceSalaryMode'] = rec['insurance_mode']
                # Note: insurance_override is now saved directly to social_insurance_contribution_level field
                if rec.get('insurance_override') is not None:
                    from decimal import Decimal as _Decimal
                    employee.social_insurance_contribution_level = _Decimal(str(rec['insurance_override']))
                    update_fields.append('social_insurance_contribution_level')
                if rec.get('dependent_count') is not None:
                    tax_updates['dependentCount'] = int(rec['dependent_count'])
                if tax_updates:
                    merged['taxPolicy'] = {**dict(merged.get('taxPolicy') or {}), **tax_updates}

                # ── deductions ─────────────────────────────────────────────────
                if rec.get('union_fee') is not None:
                    merged['deductions'] = {**dict(merged.get('deductions') or {}), 'unionFee': float(rec['union_fee'])}

                employee.salary_adjustments = {**existing_adjustments, 'payroll_config': merged}
                employee.save(update_fields=list(set(update_fields)))
                success_list.append({'employee_code': employee_code, 'employee_name': employee.full_name})

            except Exception as exc:
                error_list.append({'employee_code': employee_code, 'error': str(exc)})

        return Response({'success': success_list, 'errors': error_list})


# ─────────────────────────────────────────────────────────────
# Livestream Allowance Config Views
# ─────────────────────────────────────────────────────────────

class LivestreamAllowanceConfigViewSet(viewsets.ModelViewSet):
    """
    API ViewSet cho quản lý cấu hình phụ cấp livestream.
    Cho phép CRUD operations cho admin.
    """
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsSetPagination
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['code', 'name', 'description']
    ordering_fields = ['effective_from', '-is_active', 'created_at']
    ordering = ['-effective_from', '-is_active', '-created_at']
    
    def get_queryset(self):
        from hrm.attendance_models import LivestreamAllowanceConfig
        return LivestreamAllowanceConfig.objects.all()
    
    def get_serializer_class(self):
        from hrm.serializers import LivestreamAllowanceConfigSerializer
        return LivestreamAllowanceConfigSerializer
    
    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user.employee if hasattr(self.request.user, 'employee') else None)

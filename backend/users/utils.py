"""
Utility functions for user roles and permissions
"""
from django.contrib.auth.models import User
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)


def get_user_display_name(user):
    """Họ tên hiển thị của 1 User.

    User Django lưu tên Việt Nam tách đôi: first_name = tên (từ cuối),
    last_name = họ + đệm, nên user.get_full_name() ("first last") ra tên bị
    đảo. Ưu tiên họ tên của hồ sơ nhân viên, thiếu thì ghép đúng thứ tự họ
    trước tên, cuối cùng mới tới username.
    """
    if not user:
        return ''
    # Không có hồ sơ: truy cập related OneToOne ném RelatedObjectDoesNotExist
    # (lớp con của AttributeError) -> getattr trả None.
    employee = getattr(user, 'employee', None)
    if employee is not None and getattr(employee, 'full_name', ''):
        return employee.full_name
    return ' '.join(p for p in (user.last_name, user.first_name) if p) or user.username


def get_user_role(user):
    """
    Determine the role of a user based on their profile associations
    
    Returns:
        str: Role name ('customer', 'nurse', 'doctor', 'customer_care', 'admin', 'staff', 'hr')
    """
    # Check if user is staff/admin (Django admin system)
    if user.is_staff or user.is_superuser:
        return 'admin'
    
    # # Check if user has employee record (HRM system staff)
    if hasattr(user, 'employee') and user.employee:
        # Check if employee is HR staff
        if hasattr(user.employee, 'is_hr') and user.employee.is_hr:
            return 'hr'
        return 'staff'
    
    # Check if user has customer profile
    if hasattr(user, 'customer_profile'):
        return 'customer'
    
    # Check if user has nurse profile
    if hasattr(user, 'nurse_profile'):
        return 'nurse'
    
    # Check if user has doctor profile
    if hasattr(user, 'doctor_profile'):
        return 'doctor'
    
    # Check if user has customer care staff profile
    if hasattr(user, 'customer_care_staff_profile'):
        return 'customer_care'
    
    # Default role for users without specific profiles
    return 'customer'


def get_user_role_display(user):
    """
    Get the display name for user role
    """
    role = get_user_role(user)
    role_display_map = {
        'admin': 'Quản trị viên',
        'staff': 'Nhân viên',
        'hr': 'Nhân sự',
        'customer': 'Khách hàng',
        'nurse': 'Y tá',
        'doctor': 'Bác sĩ',
        'customer_care': 'Chăm sóc khách hàng'
    }
    return role_display_map.get(role, 'Khách hàng')


def get_user_permissions(user):
    """
    Get permissions based on user role
    """
    role = get_user_role(user)
    
    permissions = {
        'admin': {
            'can_view_all_customers': True,
            'can_view_all_doctors': True,
            'can_view_all_nurses': True,
            'can_manage_users': True,
            'can_manage_appointments': True,
            'can_manage_surgeries': True,
            'can_manage_medical_records': True,
        },
        'staff': {
            'can_view_all_customers': False,
            'can_view_all_doctors': False,
            'can_view_all_nurses': False,
            'can_manage_users': False,
            'can_manage_appointments': False,
            'can_manage_surgeries': False,
            'can_manage_medical_records': False,
            'can_view_own_profile': True,
        },
        'doctor': {
            'can_view_all_customers': False,
            'can_view_assigned_customers': True,
            'can_view_all_doctors': False,
            'can_view_all_nurses': False,
            'can_manage_users': False,
            'can_manage_appointments': True,
            'can_manage_surgeries': True,
            'can_manage_medical_records': True,
        },
        'nurse': {
            'can_view_all_customers': False,
            'can_view_assigned_customers': True,
            'can_view_all_doctors': False,
            'can_view_all_nurses': False,
            'can_manage_users': False,
            'can_manage_appointments': True,
            'can_manage_surgeries': False,
            'can_manage_medical_records': True,
        },
        'customer_care': {
            'can_view_all_customers': True,
            'can_view_all_doctors': True,
            'can_view_all_nurses': True,
            'can_manage_users': False,
            'can_manage_appointments': True,
            'can_manage_surgeries': False,
            'can_manage_medical_records': False,
        },
        'customer': {
            'can_view_all_customers': False,
            'can_view_assigned_customers': False,
            'can_view_all_doctors': False,
            'can_view_all_nurses': False,
            'can_manage_users': False,
            'can_manage_appointments': False,
            'can_manage_surgeries': False,
            'can_manage_medical_records': False,
            'can_view_own_profile': True,
            'can_view_own_appointments': True,
            'can_view_own_surgeries': True,
            'can_view_own_medical_records': True,
        }
    }
    
    return permissions.get(role, permissions['customer'])


def has_permission(user, permission_name):
    """
    Check if user has specific permission
    """
    permissions = get_user_permissions(user)
    return permissions.get(permission_name, False)


# All boolean permission field names on the EmployeePermission model
_EMPLOYEE_PERMISSION_FIELDS = [
    'can_approve_attendance', 'can_approve_leave', 'can_approve_overtime',
    'can_create_employee', 'can_edit_employee', 'can_view_all_employees',
    'can_manage_attendance', 'can_import_attendance', 'can_adjust_attendance', 'can_edit_attendance',
    'can_manage_assets', 'can_assign_assets', 'can_approve_asset_requests',
    'can_manage_departments', 'can_manage_positions',
    'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
    'can_view_reports', 'can_export_reports',
    'can_manage_disciplinary_penalties',
    'can_view_dashboard_overview', 'can_view_dashboard_employee',
    'can_view_dashboard_recruitment', 'can_view_dashboard_insurance', 'can_view_dashboard_asset',
]


def get_employee_permission_data(employee):
    """
    Return a dict of employee permission flags for the given Employee instance.
    When no EmployeePermission record exists, all flags default to False (except
    can_approve_attendance which mirrors the is_hr flag).
    Returns None if employee is None.
    """
    if employee is None:
        return None

    from hrm.models import EmployeePermission

    try:
        perm = EmployeePermission.objects.get(employee=employee)
        data = {field: getattr(perm, field) for field in _EMPLOYEE_PERMISSION_FIELDS}
        # HR flag always grants attendance approval
        if employee.is_hr:
            data['can_approve_attendance'] = True
        data['has_any_permission'] = perm.has_any_permission or employee.is_hr
        data['permission_summary'] = perm.get_permission_summary()
    except EmployeePermission.DoesNotExist:
        data = {field: False for field in _EMPLOYEE_PERMISSION_FIELDS}
        data['can_approve_attendance'] = employee.is_hr
        data['has_any_permission'] = employee.is_hr
        data['permission_summary'] = (
            'Có quyền duyệt công (HR)' if employee.is_hr else 'Không có quyền đặc biệt'
        )

    return data


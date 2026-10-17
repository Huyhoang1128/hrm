from rest_framework import serializers
from django.db import models
import employee
from employee.models import Employee, Department, Position, CompanyUnit, compute_effective_employment_status
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.contrib.auth.hashers import make_password
import random
import string
from decimal import Decimal, InvalidOperation
from salary.salary_data_models import EmployeeSalaryHistory
from .models import (
    ContractTemplate, EmployeeContract, OnboardingDocumentTemplate, OnboardingProcess, OnboardingTask,
    OnboardingChecklist, OnboardingDocument, EmailQueue, EmailBatch, GenericRequest, RequestTemplate
)
from .utils import get_cloudfly_presigned_url, upload_file_to_cloudfly
from hrm import branding
import logging
from datetime import timedelta
from dateutil.relativedelta import relativedelta
from users.utils import get_user_display_name
from employee.models import PROBATION_CONTRACT_TYPES, OFFICIAL_LABOR_CONTRACT_TYPES, probation_months_for
from .models import OnlineWorkQuotaOverride, ChildCareRegime
logger = logging.getLogger(__name__)


def calculate_probation_end_date(start_date, probation_months):
    """Tính ngày kết thúc thử việc, đảm bảo không vượt quá 60 ngày."""
    if not start_date or not probation_months:
        return None

    months_end_date = start_date + relativedelta(months=int(probation_months)) - timedelta(days=1)
    max_60_days_end_date = start_date + timedelta(days=59)
    return min(months_end_date, max_60_days_end_date)


def calculate_official_start_date(probation_end_date):
    """Ngày lên chính thức = ngày kết thúc thử việc + 1 ngày. Field này là giá trị
    được tính tự động, không cho nhập tay — luôn derive lại từ probation_end_date."""
    if not probation_end_date:
        return None
    return probation_end_date + timedelta(days=1)


def _salary_decimal(value, default=Decimal('0')):
    if value is None or value == '':
        return default
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _salary_value_changed(old_value, new_value):
    return _salary_decimal(old_value) != _salary_decimal(new_value)


def _get_salary_history_created_by(context):
    request = context.get('request') if context else None
    user = getattr(request, 'user', None)
    if not user or not getattr(user, 'is_authenticated', False):
        return None
    try:
        return user.employee
    except Exception:
        return None


def _salary_history_start_date(employee_obj):
    return employee_obj.start_date or timezone.localdate()


def _upsert_salary_history(
    employee_obj,
    basic_salary,
    allowance,
    effective_from,
    *,
    effective_to=None,
    created_by=None,
    notes='',
):
    history = (
        EmployeeSalaryHistory.objects
        .filter(employee=employee_obj, effective_from=effective_from)
        .order_by('-id')
        .first()
    )
    if history:
        history.basic_salary = _salary_decimal(basic_salary)
        history.allowance = _salary_decimal(allowance)
        history.effective_to = effective_to
        if notes:
            history.notes = notes
        if created_by and not history.created_by_id:
            history.created_by = created_by
        history.save(update_fields=[
            'basic_salary', 'allowance', 'effective_to', 'notes', 'created_by', 'updated_at',
        ])
        return history

    return EmployeeSalaryHistory.objects.create(
        employee=employee_obj,
        basic_salary=_salary_decimal(basic_salary),
        allowance=_salary_decimal(allowance),
        effective_from=effective_from,
        effective_to=effective_to,
        notes=notes,
        created_by=created_by,
    )


def sync_employee_salary_history(
    employee_obj,
    *,
    old_basic_salary=None,
    old_allowance=None,
    salary_payload_present=False,
    context=None,
):
    if not salary_payload_present:
        return

    new_basic_salary = employee_obj.basic_salary
    new_allowance = employee_obj.allowance
    has_current_salary = new_basic_salary is not None or new_allowance is not None
    has_old_salary = old_basic_salary is not None or old_allowance is not None
    salary_changed = (
        _salary_value_changed(old_basic_salary, new_basic_salary)
        or _salary_value_changed(old_allowance, new_allowance)
    )
    histories = EmployeeSalaryHistory.objects.filter(employee=employee_obj)
    created_by = _get_salary_history_created_by(context)

    if not salary_changed:
        if not histories.exists() and has_current_salary:
            _upsert_salary_history(
                employee_obj,
                new_basic_salary,
                new_allowance,
                _salary_history_start_date(employee_obj),
                created_by=created_by,
                notes='Khởi tạo lịch sử lương từ hồ sơ nhân viên.',
            )
        return

    today = timezone.localdate()
    yesterday = today - timedelta(days=1)

    if not histories.exists() and has_old_salary:
        old_effective_from = _salary_history_start_date(employee_obj)
        if old_effective_from <= yesterday:
            _upsert_salary_history(
                employee_obj,
                old_basic_salary,
                old_allowance,
                old_effective_from,
                effective_to=yesterday,
                created_by=created_by,
                notes='Tự động ghi nhận mức lương cũ trước khi cập nhật hồ sơ.',
            )

    EmployeeSalaryHistory.objects.filter(
        employee=employee_obj,
        effective_from__lt=today,
    ).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gte=today)
    ).update(effective_to=yesterday)

    _upsert_salary_history(
        employee_obj,
        new_basic_salary,
        new_allowance,
        today,
        created_by=created_by,
        notes='Tự động ghi nhận khi cập nhật lương/phụ cấp từ hồ sơ nhân viên.',
    )


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'is_staff', 'is_superuser']
        ref_name = "HrmUserSerializer"


class CompanyUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompanyUnit
        fields = ['id', 'name', 'code', 'prefix_code', 'contract_unit_code', 'description', 'is_active', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class BranchLocationSerializer(serializers.ModelSerializer):
    company_unit_name = serializers.CharField(source='company_unit.name', read_only=True, allow_null=True)

    class Meta:
        from .attendance_models import BranchLocation
        model = BranchLocation
        fields = [
            'id', 'name', 'company_unit', 'company_unit_name', 'address',
            'latitude', 'longitude', 'radius_meters', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'company_unit_name', 'created_at', 'updated_at']

    def validate_latitude(self, value):
        if value < -90 or value > 90:
            raise serializers.ValidationError('Vĩ độ phải nằm trong khoảng -90 đến 90.')
        return value

    def validate_longitude(self, value):
        if value < -180 or value > 180:
            raise serializers.ValidationError('Kinh độ phải nằm trong khoảng -180 đến 180.')
        return value

    def validate_radius_meters(self, value):
        if value <= 0:
            raise serializers.ValidationError('Bán kính cho phép phải lớn hơn 0 mét.')
        return value


class DepartmentSerializer(serializers.ModelSerializer):
    manager_id = serializers.IntegerField(source='manager.id', read_only=True, allow_null=True, default=None)
    manager_name = serializers.CharField(source='manager.full_name', read_only=True, allow_null=True, default=None)

    class Meta:
        model = Department
        fields = [
            'id', 'name', 'code', 'description', 'parent_department', 'manager',
            'manager_id', 'manager_name', 'is_section',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at', 'manager_id', 'manager_name']


class PositionSerializer(serializers.ModelSerializer):
    department = DepartmentSerializer(read_only=True, many=True)
    department_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    department_ids = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(),
        source='department',
        many=True,
        write_only=True,
        required=False,
    )
    class Meta:
        model = Position
        fields = [
            'id', 'title', 'code', 'description', 'department', 'department_id', 'department_ids', 'level',
            'parent_position', 'is_management', 'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate(self, attrs):
        department_id = attrs.pop('department_id', None)
        if department_id and 'department' not in attrs:
            try:
                attrs['department'] = [Department.objects.get(id=department_id)]
            except Department.DoesNotExist:
                raise serializers.ValidationError({"department_id": f"Department with ID {department_id} does not exist"})
        return attrs


class EmployeeSerializer(serializers.ModelSerializer):
    def validate_social_insurance_contribution_level(self, value):
        # BHXH theo kỳ (employee/social_insurance.py): mức đóng trên hồ sơ tự cập nhật theo kỳ
        # hiện hành, sửa trực tiếp sẽ bị ghi đè và bảng lương cũng không dùng.
        from employee.social_insurance import has_periods
        instance = getattr(self, 'instance', None)
        if (instance is not None and value != instance.social_insurance_contribution_level
                and has_periods(instance)):
            raise serializers.ValidationError('Nhân viên đang quản lý BHXH theo kỳ đóng — sửa mức đóng trong "Kỳ đóng BHXH" thay vì trên hồ sơ.')
        return value

    user = UserSerializer(read_only=True)
    position = PositionSerializer(read_only=True)
    department = DepartmentSerializer(read_only=True)
    manager = serializers.PrimaryKeyRelatedField(
        queryset=Employee.objects.all(), 
        required=False, 
        allow_null=True
    )
    
    manager_name = serializers.CharField(
    source='manager.full_name',
    read_only=True
    )

    # Quản lý gián tiếp cấp 2
    manager_level_2 = serializers.PrimaryKeyRelatedField(
        queryset=Employee.objects.all(), required=False, allow_null=True
    )
    manager_level_2_name = serializers.CharField(
        source='manager_level_2.full_name', read_only=True, allow_null=True, default=None
    )
    manager_level_2_employee_id = serializers.CharField(
        source='manager_level_2.employee_id', read_only=True, allow_null=True, default=None
    )

    # Employee permission information
    permissions = serializers.SerializerMethodField()
    # is_manager: True nếu position có is_management=True
    is_manager = serializers.SerializerMethodField()
    
    # Writeable fields for foreign key IDs
    user_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    position_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    department_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    manager_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Display fields for new onboarding data
    contract_type_display = serializers.CharField(source='get_contract_type_display', read_only=True)
    file_status_display = serializers.CharField(source='get_file_status_display', read_only=True)
    probation_rate_display = serializers.CharField(source='get_probation_rate_display', read_only=True)
    work_location_display = serializers.CharField(source='get_work_location_display', read_only=True)
    work_form_display = serializers.CharField(source='get_work_form_display', read_only=True)

    # HĐ hiện tại (latest SIGNED EmployeeContract) — source of truth thay cho các
    # field denormalized contract_type / contract_start_date / contract_end_date
    # trên Employee model. Trả None nếu chưa có HĐ SIGNED.
    current_contract = serializers.SerializerMethodField()
    company_unit = CompanyUnitSerializer(read_only=True)
    company_unit_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    vneid_screenshot_url = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    # Accept S3 key string (uploaded by view before reaching serializer)
    vneid_screenshot = serializers.CharField(required=False, allow_null=True, allow_blank=True)

    # Onboarding files (OneToOne reverse qua onboarding_process)
    cv_file_url = serializers.SerializerMethodField()
    id_card_front_url = serializers.SerializerMethodField()
    id_card_back_url = serializers.SerializerMethodField()
    diploma_file_url = serializers.SerializerMethodField()
    citizen_id_file_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            'id', 'user', 'employee_id', 'position', 'department', 'manager', 'manager_name',
            'manager_level_2', 'manager_level_2_name', 'manager_level_2_employee_id',
            'full_name', 'gender', 'date_of_birth', 'phone_number', 'personal_email',
            'bank_name', 'bank_account', 'bank_account_holder', 'bank_branch', 'is_active', 'employment_status', 'employment_status_notes', 'start_date', 'end_date', 'termination_reason',
            'is_hr', 'is_manager',
            'avatar', 'avatar_url',
            'qr_code', 'extra_info', 'reporting_path', 'created_at', 'updated_at',
            'ethnicity', 'nationality', 'marital_status',
            # Thông tin tổ chức (Organization info)
            'region', 'block', 'subsidiary_legal_entity', 'section', 'rank', 'work_location', 'work_location_display',
            'work_form', 'work_form_display', 'doctor_team',
            'facebook_link', 'education_level',
            'company_unit', 'company_unit_id',
            
            # New fields for onboarding and HR
            'basic_salary', 'allowance', 'contract_type', 'contract_type_display',
            'probation_end_date', 'probation_months', 'probation_rate', 'probation_rate_display', 'official_start_date',
            'revenue_percentage', 'profit_percentage', 'contract_start_date', 'contract_end_date',
            'current_contract',
            'file_status', 'file_status_display', 'file_submission_deadline',
            'file_submission_date', 'file_review_notes',
            'doc_resume', 'doc_cccd', 'doc_degree', 'doc_health',
            'training_presentation_viewed', 'training_presentation_viewed_at',
            'vneid_screenshot', 'vneid_screenshot_url',
            'cv_file_url', 'id_card_front_url', 'id_card_back_url', 'diploma_file_url', 'citizen_id_file_url',
            'cccd_number', 'cccd_issue_date', 'cccd_issue_place', 'link_cccd',
            'birth_place', 'permanent_residence', 'current_address',
            'social_insurance_number', 'tax_code', 'household_code', 'old_id_number',
            'insurance_participation', 'insurance_increase_time',
            'social_insurance_participation_status', 'social_insurance_contribution_level',
            'social_insurance_start_date', 'social_insurance_end_date',

            # HR permission flag
            'is_hr',

            # Permission information
            'permissions',
            
            'user_id', 'position_id', 'department_id', 'manager_id',

            #Thông tin người liên hệ khẩn cấp
            'emergency_contact_name', 'emergency_contact_relationship',
            'emergency_contact_phone', 'emergency_contact_dob',
            'emergency_contact_occupation', 'emergency_contact_address',

            # Salary configuration
            'salary_adjustments',

            # Tài khoản Nurse App
            'nurse_app_username',
        ]
        read_only_fields = [
            'created_at', 'updated_at', 'reporting_path', 'qr_code', 'permissions',
            'work_location_display', 'work_form_display', 'vneid_screenshot_url', 'avatar_url',
            'cv_file_url', 'id_card_front_url', 'id_card_back_url', 'diploma_file_url', 'citizen_id_file_url',
        ]
    
    def get_is_manager(self, obj):
        """True nếu NV có vị trí quản lý, là trưởng phòng, hoặc có cấp dưới trực tiếp.

        Cấp dưới trực tiếp = NV khác có Employee.manager = obj. Đồng bộ với
        visibility Q trong GenericRequestViewSet (Q(employee__manager=employee))
        — không có check này thì FE ẩn tab "Cần tôi duyệt" trong khi BE vẫn
        cho phép xem/duyệt đơn của cấp dưới.
        """
        if obj.position and obj.position.is_management:
            return True
        try:
            if Department.objects.filter(manager=obj).exists():
                return True
        except Exception:
            pass
        try:
            if Employee.objects.filter(manager=obj).exists():
                return True
        except Exception:
            pass
        return False

    def get_current_contract(self, obj):
        """
        Trả HĐ hiện tại (latest SIGNED, end_date còn hiệu lực hoặc null).
        Source of truth là EmployeeContract — đảm bảo khi HR tạo HĐ mới qua
        BulkContracts / employee-contracts endpoint, employee detail hiển thị
        ngay HĐ mới mà không phải sync field denormalized trên Employee.
        """
        from .models import EmployeeContract
        from datetime import date

        today = date.today()
        qs = (
            EmployeeContract.objects
            .filter(employee=obj, status='SIGNED')
            .select_related('template', 'company_unit')
            .order_by('-start_date', '-created_at')
        )
        active = next(
            (c for c in qs if c.end_date is None or c.end_date >= today),
            None,
        )
        if active is None:
            return None
        return {
            'id': active.id,
            'contract_type': active.contract_type,
            'contract_type_display': active.get_contract_type_display(),
            'template_id': active.template_id,
            'template_name': active.template.name if active.template else None,
            'start_date': active.start_date.isoformat() if active.start_date else None,
            'end_date': active.end_date.isoformat() if active.end_date else None,
            'status': active.status,
            'company_unit_id': active.company_unit_id,
            'company_unit_name': active.company_unit.name if active.company_unit else None,
        }

    def get_vneid_screenshot_url(self, obj):
        # Ưu tiên field trên Employee; fallback OnboardingProcess.extra_info để
        # cover case onboarding upload VNEID khi employee chưa link (data chỉ
        # nằm extra_info, chưa propagate sang Employee.vneid_screenshot).
        key = None
        if obj.vneid_screenshot:
            key = str(obj.vneid_screenshot)
        else:
            op = getattr(obj, 'onboarding_process', None)
            if op and op.extra_info and op.extra_info.get('vneid_screenshot'):
                key = str(op.extra_info['vneid_screenshot'])
        return get_cloudfly_presigned_url(key) if key else None

    def get_avatar_url(self, obj):
        if obj.avatar:
            return get_cloudfly_presigned_url(str(obj.avatar))
        return None

    def _get_onboarding_file_url(self, obj, field_name):
        """Trả URL presigned cho file thuộc OnboardingProcess (đọc qua reverse OneToOne)."""
        op = getattr(obj, 'onboarding_process', None)
        if op is None:
            return None
        value = getattr(op, field_name, None)
        if value:
            return get_cloudfly_presigned_url(str(value))
        return None

    def get_cv_file_url(self, obj):
        return self._get_onboarding_file_url(obj, 'cv_file')

    def get_id_card_front_url(self, obj):
        return self._get_onboarding_file_url(obj, 'id_card_front')

    def get_id_card_back_url(self, obj):
        return self._get_onboarding_file_url(obj, 'id_card_back')

    def get_diploma_file_url(self, obj):
        return self._get_onboarding_file_url(obj, 'diploma_file')

    def get_citizen_id_file_url(self, obj):
        return self._get_onboarding_file_url(obj, 'citizen_id_file')
    def get_permissions(self, obj):
        """Get employee permissions"""
        try:
            from .models import EmployeePermission
            permission = EmployeePermission.objects.get(employee=obj)
            permissions_data = {
                'can_approve_attendance': permission.can_approve_attendance,
                'can_approve_leave': permission.can_approve_leave,
                'can_approve_overtime': permission.can_approve_overtime,
                'can_create_employee': permission.can_create_employee,
                'can_edit_employee': permission.can_edit_employee,
                'can_view_all_employees': permission.can_view_all_employees,
                'can_manage_attendance': permission.can_manage_attendance,
                'can_import_attendance': permission.can_import_attendance,
                'can_adjust_attendance': permission.can_adjust_attendance,
                'can_edit_attendance': permission.can_edit_attendance,
                'can_manage_assets': permission.can_manage_assets,
                'can_assign_assets': permission.can_assign_assets,
                'can_approve_asset_requests': permission.can_approve_asset_requests,
                'can_manage_departments': permission.can_manage_departments,
                'can_manage_positions': permission.can_manage_positions,
                'can_manage_company_config': permission.can_manage_company_config,
                'can_manage_attendance_rules': permission.can_manage_attendance_rules,
                'can_manage_leave_policies': permission.can_manage_leave_policies,
                'can_view_reports': permission.can_view_reports,
                'can_export_reports': permission.can_export_reports,
                'can_manage_disciplinary_penalties': permission.can_manage_disciplinary_penalties,
                'can_view_salary_advance': permission.can_view_salary_advance,
                'can_manage_recruitment': permission.can_manage_recruitment,
                'has_any_permission': permission.has_any_permission,
                'permission_summary': permission.get_permission_summary()
            }
            
            # Chỉ dùng cờ is_hr, không tự detect theo department hay position
            if not permissions_data['can_approve_attendance'] and obj.is_hr:
                permissions_data['can_approve_attendance'] = True
                if 'Không có quyền đặc biệt' in permissions_data['permission_summary']:
                    permissions_data['permission_summary'] = 'Có quyền duyệt công (HR)'
                elif 'HR' not in permissions_data['permission_summary']:
                    permissions_data['permission_summary'] += ', có quyền duyệt công (HR)'

            return permissions_data
        except EmployeePermission.DoesNotExist:
            # Chỉ dùng cờ is_hr
            is_hr = obj.is_hr

            return {
                'can_approve_attendance': is_hr,
                'can_approve_leave': False,
                'can_approve_overtime': False,
                'can_create_employee': False,
                'can_edit_employee': False,
                'can_view_all_employees': False,
                'can_manage_attendance': False,
                'can_import_attendance': False,
                'can_adjust_attendance': False,
                'can_edit_attendance': False,
                'can_manage_assets': False,
                'can_assign_assets': False,
                'can_approve_asset_requests': False,
                'can_manage_departments': False,
                'can_manage_positions': False,
                'can_manage_company_config': False,
                'can_manage_attendance_rules': False,
                'can_manage_leave_policies': False,
                'can_view_reports': False,
                'can_export_reports': False,
                'can_manage_disciplinary_penalties': False,
                'can_view_salary_advance': False,
                'can_manage_recruitment': False,
                'has_any_permission': is_hr,
                'permission_summary': 'Có quyền duyệt công (HR)' if is_hr else 'Không có quyền đặc biệt'
            }
    
    def create(self, validated_data):
        """
        Create employee with proper foreign key handling
        """
        salary_payload_present = 'basic_salary' in validated_data or 'allowance' in validated_data

        # Extract foreign key IDs
        user_id = validated_data.pop('user_id', None)
        position_id = validated_data.pop('position_id', None)
        department_id = validated_data.pop('department_id', None)
        manager_id = validated_data.pop('manager_id', None)
        
        # Handle user (optional - can create user automatically if needed)
        if user_id:
            try:
                user = User.objects.get(id=user_id)
                validated_data['user'] = user
            except User.DoesNotExist:
                raise serializers.ValidationError(f"User with ID {user_id} does not exist")
        
        # Handle position (optional)
        if position_id:
            try:
                position = Position.objects.get(id=position_id)
                validated_data['position'] = position
            except Position.DoesNotExist:
                raise serializers.ValidationError(f"Position with ID {position_id} does not exist")
        
        # Handle department (optional)
        if department_id:
            try:
                department = Department.objects.get(id=department_id)
                validated_data['department'] = department
            except Department.DoesNotExist:
                raise serializers.ValidationError(f"Department with ID {department_id} does not exist")
        
        # Handle manager (optional)
        if manager_id:
            try:
                manager = Employee.objects.get(id=manager_id)
                validated_data['manager'] = manager
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Manager with ID {manager_id} does not exist")
        
        # Create the employee
        with transaction.atomic():
            employee = Employee.objects.create(**validated_data)
            sync_employee_salary_history(
                employee,
                salary_payload_present=salary_payload_present,
                context=self.context,
            )
        return employee
    
    def update(self, instance, validated_data):
        """
        Update employee with proper foreign key handling
        """
        salary_payload_present = 'basic_salary' in validated_data or 'allowance' in validated_data
        old_basic_salary = instance.basic_salary
        old_allowance = instance.allowance

        # Extract foreign key IDs
        user_id = validated_data.pop('user_id', None)
        position_id = validated_data.pop('position_id', None)
        department_id = validated_data.pop('department_id', None)
        manager_id = validated_data.pop('manager_id', None)
        
        # Handle user (optional)
        if user_id is not None:
            try:
                user = User.objects.get(id=user_id)
                instance.user = user
            except User.DoesNotExist:
                raise serializers.ValidationError(f"User with ID {user_id} does not exist")
        
        # Handle position (optional)
        if position_id is not None:
            try:
                position = Position.objects.get(id=position_id)
                instance.position = position
            except Position.DoesNotExist:
                raise serializers.ValidationError(f"Position with ID {position_id} does not exist")
        
        # Handle department (optional)
        if department_id is not None:
            try:
                department = Department.objects.get(id=department_id)
                instance.department = department
            except Department.DoesNotExist:
                raise serializers.ValidationError(f"Department with ID {department_id} does not exist")
        
        # Handle manager (optional)
        if manager_id is not None:
            if manager_id == 0:  # Special case to clear manager
                instance.manager = None
            else:
                try:
                    manager = Employee.objects.get(id=manager_id)
                    instance.manager = manager
                except Employee.DoesNotExist:
                    raise serializers.ValidationError(f"Manager with ID {manager_id} does not exist")
        
        # Detect probation_months change trước khi setattr để auto-recompute probation_end_date
        probation_months_in_payload = 'probation_months' in validated_data
        probation_end_date_in_payload = 'probation_end_date' in validated_data

        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        # Auto-tính probation_end_date khi client PATCH probation_months
        # NHƯNG chỉ khi probation_end_date KHÔNG được gửi kèm (người dùng không tự nhập).
        # Nếu client gửi probation_end_date tường minh, ưu tiên giá trị đó.
        if probation_months_in_payload and not probation_end_date_in_payload and instance.start_date and instance.probation_months:
            instance.probation_end_date = calculate_probation_end_date(
                instance.start_date,
                instance.probation_months,
            )

        # official_start_date luôn là giá trị dẫn xuất (probation_end_date + 1 ngày) —
        # không nhận input tay, ghi đè bất kỳ giá trị nào client gửi kèm.
        instance.official_start_date = calculate_official_start_date(instance.probation_end_date)

        with transaction.atomic():
            instance.save()
            # Khi nhân viên đã nghỉ, mọi hợp đồng chưa hết hiệu lực phải được
            # đóng đồng bộ để Bulk Contracts không tiếp tục hiển thị là đang ký.
            effective_status = compute_effective_employment_status(
                instance.employment_status,
                instance.end_date,
            )
            if effective_status == 'INACTIVE':
                EmployeeContract.objects.filter(
                    employee=instance,
                    status__in=['DRAFT', 'PENDING_SIGN', 'SIGNED'],
                ).update(status='CANCELLED')

            sync_employee_salary_history(
                instance,
                old_basic_salary=old_basic_salary,
                old_allowance=old_allowance,
                salary_payload_present=salary_payload_present,
                context=self.context,
            )
        return instance

    def to_representation(self, instance):
        """
        Trả employment_status dạng computed (ưu tiên PAUSED override,
        còn lại derive từ end_date). Field stored vẫn ghi được qua update().
        """
        data = super().to_representation(instance)
        if 'employment_status' in data:
            data['employment_status'] = compute_effective_employment_status(
                instance.employment_status, instance.end_date
            )
        return data


class EmployeeCreateSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for creating employees with user creation
    """
    username = serializers.CharField(write_only=True, required=True)
    password = serializers.CharField(write_only=True, required=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    first_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    last_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    
    position_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    department_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    manager_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Employee
        fields = [
            'employee_id', 'full_name', 'gender', 'date_of_birth', 'phone_number',
            'personal_email', 'bank_name', 'bank_account', 'bank_account_holder', 'bank_branch', 'employment_status', 'employment_status_notes',
            'start_date', 'end_date', 'username', 'password', 'email',
            'first_name', 'last_name', 'position_id', 'department_id', 'manager_id',
            'subsidiary_legal_entity',
            
            # New fields for onboarding
            'basic_salary', 'allowance', 'contract_type', 'probation_months', 'official_start_date',
            'revenue_percentage', 'profit_percentage', 'contract_start_date', 'contract_end_date',
            'file_status', 'file_submission_deadline',
            'doc_resume', 'doc_cccd', 'doc_degree', 'doc_health',
            'training_presentation_viewed', 'cccd_number', 'cccd_issue_date',
            'cccd_issue_place', 'birth_place', 'permanent_residence',

            # HR permission
            'is_hr',

            # Active status
            'is_active'
        ]
    
    def create(self, validated_data):
        """
        Create user and employee together
        """
        salary_payload_present = 'basic_salary' in validated_data or 'allowance' in validated_data

        # Extract user data
        username = validated_data.pop('username')
        password = validated_data.pop('password')
        email = validated_data.pop('email', '')
        first_name = validated_data.pop('first_name', '')
        last_name = validated_data.pop('last_name', '')
        
        # Extract foreign key IDs
        position_id = validated_data.pop('position_id', None)
        department_id = validated_data.pop('department_id', None)
        manager_id = validated_data.pop('manager_id', None)
        
        # Create user
        user_data = {
            'username': username,
            'password': password,
        }
        
        if email:
            user_data['email'] = email
        if first_name:
            user_data['first_name'] = first_name
        if last_name:
            user_data['last_name'] = last_name
        
        user = User.objects.create_user(**user_data)
        
        # Set user in validated data
        validated_data['user'] = user
        
        # Handle position (optional)
        if position_id:
            try:
                position = Position.objects.get(id=position_id)
                validated_data['position'] = position
            except Position.DoesNotExist:
                # Clean up user if position doesn't exist
                user.delete()
                raise serializers.ValidationError(f"Position with ID {position_id} does not exist")
        
        # Handle department (optional)
        if department_id:
            try:
                department = Department.objects.get(id=department_id)
                validated_data['department'] = department
            except Department.DoesNotExist:
                # Clean up user if department doesn't exist
                user.delete()
                raise serializers.ValidationError(f"Department with ID {department_id} does not exist")
        
        # Handle manager (optional)
        if manager_id:
            try:
                manager = Employee.objects.get(id=manager_id)
                validated_data['manager'] = manager
            except Employee.DoesNotExist:
                # Clean up user if manager doesn't exist
                user.delete()
                raise serializers.ValidationError(f"Manager with ID {manager_id} does not exist")
        
        # Create the employee
        with transaction.atomic():
            employee = Employee.objects.create(**validated_data)
            sync_employee_salary_history(
                employee,
                salary_payload_present=salary_payload_present,
                context=self.context,
            )
        return employee


class EmployeeListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing employees
    """
    position_title = serializers.CharField(source='position.title', read_only=True)
    department_name = serializers.CharField(source='department.name', read_only=True)
    manager_name = serializers.CharField(source='manager.full_name', read_only=True)
    user_email = serializers.EmailField(source='user.email', read_only=True)
    position = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            'id', 'employee_id', 'full_name', 'gender', 'date_of_birth', 'position_title', 'department_name',
            'manager_name', 'phone_number', 'personal_email', 'user_email', 'is_active', 'employment_status', 'start_date',
            'end_date', 'position', 'department', 'rank', 'is_hr', 'official_start_date',
            'subsidiary_legal_entity',
            'social_insurance_number', 'tax_code', 'household_code',
            'social_insurance_participation_status', 'social_insurance_contribution_level',
            'social_insurance_start_date', 'social_insurance_end_date',
            'revenue_percentage', 'profit_percentage', 'contract_start_date', 'contract_end_date',
            'doc_resume', 'doc_cccd', 'doc_degree', 'doc_health',
            'avatar', 'avatar_url',
            'cccd_issue_place', 'education_level', 'marital_status', 'ethnicity', 'nationality',
            'basic_salary', 'allowance', 'salary_adjustments',
            'contract_type', 'work_location',
        ]
    
    def get_position(self, obj):
        if obj.position:
            return {
                'id': obj.position.id,
                'title': obj.position.title,
                'code': obj.position.code
            }
        return None
    
    def get_department(self, obj):
        if obj.department:
            return {
                'id': obj.department.id,
                'name': obj.department.name,
                'code': obj.department.code
            }
        return None

    def get_avatar_url(self, obj):
        if obj.avatar:
            return get_cloudfly_presigned_url(str(obj.avatar))
        return None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if 'employment_status' in data:
            data['employment_status'] = compute_effective_employment_status(
                instance.employment_status, instance.end_date
            )
        return data


class EmployeeBirthdaySerializer(serializers.ModelSerializer):
    """
    Serializer for birthday list - only returns employee_id, full_name, date_of_birth, department, and avatar_url
    """
    department = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = ['employee_id', 'full_name', 'date_of_birth', 'department', 'avatar_url']

    def get_department(self, obj):
        if obj.department:
            return {
                'id': obj.department.id,
                'name': obj.department.name,
                'code': obj.department.code
            }
        return None

    def get_avatar_url(self, obj):
        if obj.avatar:
            return get_cloudfly_presigned_url(str(obj.avatar))
        return None


# ======================
# ASSET MANAGEMENT SERIALIZERS
# ======================

from .models import Asset, AssetAssignmentHistory, AssetMaintenance, AssetInventoryCheck, normalize_asset_type, ASSET_TYPE_MAX_LENGTH


# Nhãn riêng cho SIM — cùng enum ASSET_STATUS nhưng ngữ cảnh khác.
# Dùng khi asset_type=SIM để override status_display.
_SIM_STATUS_DISPLAY = {
    'NEW': 'Mới (Chưa kích hoạt)',
    'IN_USE': 'Đang sử dụng',
    'UNDER_MAINTENANCE': 'Tạm khóa',
    'TERMINATED': 'Đã cắt',
    'LOST': 'Mất / Hỏng',
}


def _resolve_status_display(asset) -> str:
    """Trả về label hiển thị đúng cho status, xử lý SIM riêng."""
    raw = (asset.status or '').upper()
    if asset.asset_type == 'SIM' and raw in _SIM_STATUS_DISPLAY:
        return _SIM_STATUS_DISPLAY[raw]
    return asset.get_status_display()


def _build_holders_payload(asset) -> list:
    """Danh sách CONFIRMED holders — dùng cho multi-holder types.

    Non-multi-holder types trả về ``[]`` (FE đọc ``assigned_to_name`` như cũ).
    """
    from .models import Asset
    if not Asset.is_multi_holder_type(asset.asset_type):
        return []
    rows = (
        asset.assignment_history
        .filter(status='CONFIRMED')
        .select_related('assigned_to', 'assigned_to__department')
        .order_by('assigned_date', 'id')
    )
    result = []
    for h in rows:
        emp = h.assigned_to
        result.append({
            'history_id': h.id,
            'employee_id': emp.id if emp else None,
            'employee_code': emp.employee_id if emp else '',
            'name': emp.full_name if emp else '',
            'department_name': (emp.department.name if emp and emp.department else ''),
            'assigned_quantity': h.assigned_quantity or 1,
            'assigned_date': h.assigned_date.isoformat() if h.assigned_date else None,
            'assignment_notes': h.assignment_notes or '',
            'confirmed_at': h.confirmed_at.isoformat() if h.confirmed_at else None,
        })
    return result


class AssetSerializer(serializers.ModelSerializer):
    """Serializer cho tài sản"""
    department_name = serializers.CharField(source='department.name', read_only=True)
    usage_department_name = serializers.CharField(source='usage_department.name', read_only=True)
    usage_department_code = serializers.CharField(source='usage_department.code', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True)
    assigned_to_department_name = serializers.CharField(source='assigned_to.department.name', read_only=True)
    managed_by_name = serializers.CharField(source='managed_by.full_name', read_only=True)
    managed_by_employee_id = serializers.SerializerMethodField()
    assigned_to_employee_id = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    condition_display = serializers.CharField(source='get_condition_display', read_only=True)
    asset_type_display = serializers.CharField(source='get_asset_type_display', read_only=True)
    status_display = serializers.SerializerMethodField()
    # Multi-holder (MONITOR) fields
    total_quantity = serializers.IntegerField(read_only=True)
    remaining_quantity = serializers.IntegerField(read_only=True)
    assigned_quantity_total = serializers.IntegerField(read_only=True)
    holders = serializers.SerializerMethodField()
    pending_assignment = serializers.SerializerMethodField()
    # Khấu hao — tính động từ property trên model (xem Asset.current_value)
    depreciation_method_display = serializers.CharField(source='get_depreciation_method_display', read_only=True)
    monthly_depreciation = serializers.ReadOnlyField()
    accumulated_depreciation = serializers.ReadOnlyField()
    current_value = serializers.ReadOnlyField()
    # Hình ảnh — trả presigned URL, field gốc (S3 key) không expose ra ngoài
    current_image_url = serializers.SerializerMethodField()
    purchase_image_url = serializers.SerializerMethodField()

    def get_status_display(self, obj):
        return _resolve_status_display(obj)

    def get_current_image_url(self, obj):
        if not obj.current_image:
            return None
        from .utils import get_cloudfly_presigned_url
        return get_cloudfly_presigned_url(str(obj.current_image))

    def get_purchase_image_url(self, obj):
        if not obj.purchase_image:
            return None
        from .utils import get_cloudfly_presigned_url
        return get_cloudfly_presigned_url(str(obj.purchase_image))

    def get_managed_by_employee_id(self, obj):
        return obj.managed_by.employee_id if obj.managed_by else ""

    def get_assigned_to_employee_id(self, obj):
        return obj.assigned_to.employee_id if obj.assigned_to else ""

    def get_holders(self, obj):
        return _build_holders_payload(obj)

    def get_pending_assignment(self, obj):
        pending = obj.assignment_history.filter(status='PENDING').select_related(
            'assigned_to', 'assigned_by'
        ).first()
        if not pending:
            return None
        return {
            'id': pending.id,
            'assigned_to': pending.assigned_to_id,
            'assigned_to_name': pending.assigned_to.full_name if pending.assigned_to else None,
            'assigned_date': pending.assigned_date.isoformat() if pending.assigned_date else None,
            'assigned_by_name': pending.assigned_by.full_name if pending.assigned_by else None,
            'assignment_notes': pending.assignment_notes,
        }

    # Writeable fields for foreign key IDs
    department_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    usage_department_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    assigned_to_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    managed_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    # "Phân loại" và "Tình trạng vật lý" không còn dropdown cố định ở form
    # web (đồng bộ với Excel import/export) — override
    # ChoiceField mặc định (sinh tự động từ Asset.asset_type/condition có
    # choices=...) thành CharField thường để nhận text tự do, không bị
    # reject "is not a valid choice" khi FE gửi giá trị ngoài danh sách cũ.
    asset_type = serializers.CharField(max_length=ASSET_TYPE_MAX_LENGTH)
    condition = serializers.CharField(max_length=20, required=False, allow_blank=True)

    def validate_asset_type(self, value):
        # Cùng quy tắc với import Excel: gõ gì lưu nấy, chỉ gom về mã chuẩn khi
        # trùng y hệt nhãn/mã loại chuẩn (xem normalize_asset_type).
        value = normalize_asset_type(value)
        if not value:
            raise serializers.ValidationError("Phân loại không được để trống")
        return value

    class Meta:
        model = Asset
        fields = [
            'id', 'asset_code', 'name', 'asset_type', 'asset_type_display', 'description',
            'purchase_date', 'purchase_price', 'supplier', 'invoice_number',
            'brand', 'model', 'serial_number', 'specifications',
            'status', 'status_display', 'condition', 'condition_display',
            'warranty_period', 'warranty_expiry', 'warranty_provider',
            'depreciation_period_months', 'depreciation_method', 'depreciation_method_display',
            'monthly_depreciation', 'accumulated_depreciation', 'current_value',
            'current_image_url', 'purchase_image_url',
            'department', 'department_name', 'location', 'dimensions', 'facility_code',
            'usage_area', 'usage_department', 'usage_department_id', 'usage_department_name', 'usage_department_code',
            'managed_by', 'managed_by_name', 'managed_by_employee_id', 'managed_by_id',
            'assigned_to', 'assigned_to_name', 'assigned_to_employee_id', 'assigned_to_department_name', 'assigned_date',
            'total_quantity', 'remaining_quantity', 'assigned_quantity_total', 'holders', 'pending_assignment',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
            'department_id', 'assigned_to_id', 'created_by_id'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'asset_code']

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        if not representation.get('specifications'):
            representation['specifications'] = {}
        return representation

    def validate_name(self, value):
        """Chỉ strip khoảng trắng đầu/cuối. Việc chặn trùng Mã thiết bị được
        thực hiện ở validate() vì cần biết cả asset_type (1 mã thiết bị có
        thể có nhiều loại tài sản khác nhau, ví dụ NV0001 vừa có Màn hình
        vừa có Máy tính để bàn — chỉ chặn khi trùng CẢ mã thiết bị lẫn loại
        tài sản).
        """
        if not value:
            return value
        return value.strip()

    def validate(self, attrs):
        name = attrs.get('name', getattr(self.instance, 'name', None))
        asset_type = attrs.get('asset_type', getattr(self.instance, 'asset_type', None))
        if name:
            cleaned = name.strip()
            if cleaned:
                qs = Asset.objects.filter(name__iexact=cleaned, asset_type=asset_type)
                if self.instance is not None:
                    qs = qs.exclude(pk=self.instance.pk)
                if qs.exists():
                    existing = qs.first()
                    raise serializers.ValidationError({
                        'name': (
                            f'Mã thiết bị "{cleaned}" đã tồn tại cho loại tài sản '
                            f'"{existing.get_asset_type_display()}" (mã tài sản: '
                            f'{existing.asset_code}). Vui lòng nhập mã khác hoặc '
                            f'chọn loại tài sản khác.'
                        )
                    })
        return attrs

    def create(self, validated_data):
        """
        Create asset with proper foreign key handling
        """
        # Extract foreign key IDs
        department_id = validated_data.pop('department_id', None)
        usage_department_id = validated_data.pop('usage_department_id', None)
        assigned_to_id = validated_data.pop('assigned_to_id', None)
        managed_by_id = validated_data.pop('managed_by_id', None)
        created_by_id = validated_data.pop('created_by_id', None)

        # Handle department (optional)
        if department_id:
            try:
                from employee.models import Department
                department = Department.objects.get(id=department_id)
                validated_data['department'] = department
            except Department.DoesNotExist:
                raise serializers.ValidationError(f"Department with ID {department_id} does not exist")

        # Handle usage_department (optional) — phòng ban đang thực tế sử dụng,
        # tách biệt với department (phòng ban quản lý trong kho) ở trên.
        if usage_department_id:
            try:
                from employee.models import Department
                usage_department = Department.objects.get(id=usage_department_id)
                validated_data['usage_department'] = usage_department
            except Department.DoesNotExist:
                raise serializers.ValidationError(f"Department with ID {usage_department_id} does not exist")

        # Handle assigned_to (optional)
        if assigned_to_id:
            try:
                assigned_to = Employee.objects.get(id=assigned_to_id)
                validated_data['assigned_to'] = assigned_to
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {assigned_to_id} does not exist")
        
        # Handle managed_by (optional)
        if managed_by_id:
            try:
                managed_by = Employee.objects.get(id=managed_by_id)
                validated_data['managed_by'] = managed_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {managed_by_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Auto-calculate warranty_expiry from purchase_date + warranty_period
        purchase_date = validated_data.get('purchase_date')
        warranty_period = validated_data.get('warranty_period')
        if warranty_period and int(warranty_period) > 0 and purchase_date:
            validated_data['warranty_expiry'] = self._calc_warranty_expiry(purchase_date, warranty_period)
        else:
            validated_data['warranty_expiry'] = None

        # Create the asset
        asset = Asset.objects.create(**validated_data)
        return asset

    def _calc_warranty_expiry(self, purchase_date, warranty_period):
        """Tính ngày hết hạn bảo hành dựa trên ngày mua + số tháng.
        Nếu warranty_period = 0 hoặc None thì trả None."""
        if not purchase_date or not warranty_period:
            return None
        from dateutil.relativedelta import relativedelta
        return purchase_date + relativedelta(months=int(warranty_period))

    def update(self, instance, validated_data):
        """
        Update asset with proper foreign key handling
        """
        # Extract foreign key IDs
        department_id = validated_data.pop('department_id', None)
        usage_department_id = validated_data.pop('usage_department_id', None)
        assigned_to_id = validated_data.pop('assigned_to_id', None)
        managed_by_id = validated_data.pop('managed_by_id', None)
        created_by_id = validated_data.pop('created_by_id', None)

        # Handle department (optional)
        if department_id is not None:
            try:
                from employee.models import Department
                department = Department.objects.get(id=department_id)
                instance.department = department
            except Department.DoesNotExist:
                raise serializers.ValidationError(f"Department with ID {department_id} does not exist")

        # Handle usage_department (optional) — 0 xoá gán, giống pattern assigned_to/managed_by.
        if usage_department_id is not None:
            if usage_department_id == 0:
                instance.usage_department = None
            else:
                try:
                    from employee.models import Department
                    usage_department = Department.objects.get(id=usage_department_id)
                    instance.usage_department = usage_department
                except Department.DoesNotExist:
                    raise serializers.ValidationError(f"Department with ID {usage_department_id} does not exist")

        # Handle assigned_to (optional)
        if assigned_to_id is not None:
            if assigned_to_id == 0:  # Special case to clear assignment
                instance.assigned_to = None
                instance.assigned_date = None
                if instance.status == 'IN_USE':
                    instance.status = 'IDLE'
            else:
                try:
                    assigned_to = Employee.objects.get(id=assigned_to_id)
                    instance.assigned_to = assigned_to
                    instance.assigned_date = timezone.now().date()
                    instance.status = 'IN_USE'
                except Employee.DoesNotExist:
                    raise serializers.ValidationError(f"Employee with ID {assigned_to_id} does not exist")
        
        # Handle managed_by (optional)
        if managed_by_id is not None:
            if managed_by_id == 0:
                instance.managed_by = None
            else:
                try:
                    managed_by = Employee.objects.get(id=managed_by_id)
                    instance.managed_by = managed_by
                except Employee.DoesNotExist:
                    raise serializers.ValidationError(f"Employee with ID {managed_by_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        # Auto-recalculate warranty_expiry
        purchase_date = instance.purchase_date
        warranty_period = instance.warranty_period
        if warranty_period and int(warranty_period) > 0 and purchase_date:
            instance.warranty_expiry = self._calc_warranty_expiry(purchase_date, warranty_period)
        else:
            instance.warranty_expiry = None

        instance.save()
        return instance


class AssetListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing assets with flat hardware fields
    """
    department_name = serializers.CharField(source='department.name', read_only=True)
    usage_department_name = serializers.CharField(source='usage_department.name', read_only=True)
    usage_department_code = serializers.CharField(source='usage_department.code', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True)
    assigned_to_employee_id = serializers.SerializerMethodField()
    assigned_to_department_name = serializers.CharField(source='assigned_to.department.name', read_only=True)
    managed_by_name = serializers.CharField(source='managed_by.full_name', read_only=True)
    managed_by_employee_id = serializers.SerializerMethodField()
    asset_type_display = serializers.CharField(source='get_asset_type_display', read_only=True)
    # SIM dùng nhãn riêng cho status (Mới chưa kích hoạt / Đang sử dụng / Tạm khóa /
    # Đã cắt / Mất / Hỏng) — map từ ASSET_STATUS enum với ngữ cảnh SIM.
    status_display = serializers.SerializerMethodField()
    condition_display = serializers.CharField(source='get_condition_display', read_only=True)
    # Multi-holder (MONITOR) fields
    total_quantity = serializers.IntegerField(read_only=True)
    remaining_quantity = serializers.IntegerField(read_only=True)
    assigned_quantity_total = serializers.IntegerField(read_only=True)
    holders = serializers.SerializerMethodField()
    # Cho phép màn danh sách nhận diện tài sản đang chờ người được bàn giao xác nhận.
    # AssetSerializer đã có field này; giữ hai response nhất quán để các thao tác
    # từ màn danh sách (lọc, bàn giao hàng loạt) đều dùng đúng trạng thái.
    pending_assignment = serializers.SerializerMethodField()
    depreciation_method_display = serializers.CharField(source='get_depreciation_method_display', read_only=True)
    current_value = serializers.ReadOnlyField()

    def get_status_display(self, obj):
        return _resolve_status_display(obj)

    def get_assigned_to_employee_id(self, obj):
        return obj.assigned_to.employee_id if obj.assigned_to else ""

    def get_managed_by_employee_id(self, obj):
        return obj.managed_by.employee_id if obj.managed_by else ""

    def get_holders(self, obj):
        return _build_holders_payload(obj)

    def get_pending_assignment(self, obj):
        pending = obj.assignment_history.filter(status='PENDING').select_related(
            'assigned_to', 'assigned_by'
        ).first()
        if not pending:
            return None
        return {
            'id': pending.id,
            'assigned_to': pending.assigned_to_id,
            'assigned_to_name': pending.assigned_to.full_name if pending.assigned_to else None,
            'assigned_date': pending.assigned_date.isoformat() if pending.assigned_date else None,
            'assigned_by_name': pending.assigned_by.full_name if pending.assigned_by else None,
            'assignment_notes': pending.assignment_notes,
        }

    class Meta:
        model = Asset
        fields = [
            'id', 'asset_code', 'name', 'asset_type', 'asset_type_display',
            'brand', 'model', 'status', 'status_display', 'condition', 'condition_display',
            'department', 'department_name', 'dimensions', 'facility_code',
            'usage_area', 'usage_department', 'usage_department_name', 'usage_department_code',
            'managed_by', 'managed_by_name', 'managed_by_employee_id',
            'assigned_to', 'assigned_to_name', 'assigned_to_employee_id', 'assigned_to_department_name', 'assigned_date',
            'total_quantity', 'remaining_quantity', 'assigned_quantity_total', 'holders', 'pending_assignment',
            'purchase_date', 'purchase_price', 'warranty_expiry', 'supplier', 'specifications',
            'depreciation_period_months', 'depreciation_method_display', 'current_value',
            'created_at',
        ]

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        if not representation.get('specifications'):
            representation['specifications'] = {}
        return representation

class AssetAssignmentHistorySerializer(serializers.ModelSerializer):
    """Serializer cho lịch sử gán tài sản"""
    asset_code = serializers.CharField(source='asset.asset_code', read_only=True)
    asset_name = serializers.CharField(source='asset.name', read_only=True)
    # Detail của asset để FE hiển thị rõ "đang được bàn giao cái gì"
    asset_type = serializers.CharField(source='asset.asset_type', read_only=True)
    asset_type_display = serializers.CharField(source='asset.get_asset_type_display', read_only=True)
    asset_brand = serializers.CharField(source='asset.brand', read_only=True)
    asset_model = serializers.CharField(source='asset.model', read_only=True)
    asset_serial_number = serializers.CharField(source='asset.serial_number', read_only=True)
    asset_specifications = serializers.JSONField(source='asset.specifications', read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True)
    assigned_to_employee_id = serializers.SerializerMethodField()
    assigned_by_name = serializers.CharField(source='assigned_by.full_name', read_only=True)
    assigned_by_employee_id = serializers.SerializerMethodField()
    return_condition_display = serializers.CharField(source='get_return_condition_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    def get_assigned_to_employee_id(self, obj):
        return obj.assigned_to.employee_id if obj.assigned_to else ""

    def get_assigned_by_employee_id(self, obj):
        return obj.assigned_by.employee_id if obj.assigned_by else ""

    # Writeable fields for foreign key IDs
    asset_id = serializers.IntegerField(write_only=True, required=True)
    assigned_to_id = serializers.IntegerField(write_only=True, required=True)
    assigned_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = AssetAssignmentHistory
        fields = [
            'id', 'asset', 'asset_id', 'asset_code', 'asset_name',
            'asset_type', 'asset_type_display', 'asset_brand', 'asset_model',
            'asset_serial_number', 'asset_specifications',
            'assigned_to', 'assigned_to_id', 'assigned_to_name', 'assigned_to_employee_id',
            'assigned_date', 'returned_date',
            'status', 'status_display', 'confirmed_at', 'rejected_at', 'rejection_reason',
            'return_condition', 'return_condition_display', 'return_notes',
            'assignment_notes', 'assigned_by', 'assigned_by_name', 'assigned_by_employee_id', 'assigned_by_id',
            'assigned_quantity',
            'created_at', 'duration_days'
        ]
        read_only_fields = ['created_at', 'duration_days']
    
    def create(self, validated_data):
        """
        Create assignment history with proper foreign key handling
        """
        # Extract foreign key IDs
        asset_id = validated_data.pop('asset_id')
        assigned_to_id = validated_data.pop('assigned_to_id')
        assigned_by_id = validated_data.pop('assigned_by_id', None)
        
        # Handle asset
        try:
            asset = Asset.objects.get(id=asset_id)
            validated_data['asset'] = asset
        except Asset.DoesNotExist:
            raise serializers.ValidationError(f"Asset with ID {asset_id} does not exist")
        
        # Handle assigned_to
        try:
            assigned_to = Employee.objects.get(id=assigned_to_id)
            validated_data['assigned_to'] = assigned_to
        except Employee.DoesNotExist:
            raise serializers.ValidationError(f"Employee with ID {assigned_to_id} does not exist")
        
        # Handle assigned_by (optional)
        if assigned_by_id:
            try:
                assigned_by = Employee.objects.get(id=assigned_by_id)
                validated_data['assigned_by'] = assigned_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {assigned_by_id} does not exist")
        
        # Create the assignment history
        history = AssetAssignmentHistory.objects.create(**validated_data)
        return history


class AssetInventoryCheckSerializer(serializers.ModelSerializer):
    """Serializer cho lịch sử kiểm kê tài sản"""
    asset_code = serializers.CharField(source='asset.asset_code', read_only=True)
    asset_name = serializers.CharField(source='asset.name', read_only=True)
    checked_by_name = serializers.CharField(source='checked_by.full_name', read_only=True, default=None)
    actual_condition_display = serializers.CharField(source='get_actual_condition_display', read_only=True)
    result_display = serializers.CharField(source='get_result_display', read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True, default=None)

    # Ghi bằng ID
    asset_id = serializers.PrimaryKeyRelatedField(
        source='asset', queryset=Asset.objects.all(), write_only=True)
    checked_by_id = serializers.PrimaryKeyRelatedField(
        source='checked_by', queryset=Employee.objects.all(), write_only=True,
        required=False, allow_null=True)
    created_by_id = serializers.PrimaryKeyRelatedField(
        source='created_by', queryset=Employee.objects.all(), write_only=True,
        required=False, allow_null=True)

    class Meta:
        model = AssetInventoryCheck
        fields = [
            'id', 'asset', 'asset_id', 'asset_code', 'asset_name',
            'check_date', 'checked_by', 'checked_by_id', 'checked_by_name',
            'actual_condition', 'actual_condition_display',
            'result', 'result_display', 'notes',
            'created_at', 'created_by', 'created_by_id', 'created_by_name',
        ]
        read_only_fields = ['asset', 'checked_by', 'created_by', 'created_at']


class AssetMaintenanceSerializer(serializers.ModelSerializer):
    """Serializer cho lịch sử bảo trì tài sản"""
    asset_code = serializers.CharField(source='asset.asset_code', read_only=True)
    asset_name = serializers.CharField(source='asset.name', read_only=True)
    performed_by_employee_name = serializers.CharField(source='performed_by_employee.full_name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    
    # Writeable fields for foreign key IDs
    asset_id = serializers.IntegerField(write_only=True, required=True)
    performed_by_employee_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = AssetMaintenance
        fields = [
            'id', 'asset', 'asset_id', 'asset_code', 'asset_name',
            'maintenance_date', 'maintenance_type', 'description', 'cost',
            'performed_by', 'performed_by_employee', 'performed_by_employee_id', 'performed_by_employee_name',
            'result', 'next_maintenance_date',
            'created_at', 'created_by', 'created_by_id', 'created_by_name'
        ]
        read_only_fields = ['created_at']
    
    def create(self, validated_data):
        """
        Create maintenance record with proper foreign key handling
        """
        # Extract foreign key IDs
        asset_id = validated_data.pop('asset_id')
        performed_by_employee_id = validated_data.pop('performed_by_employee_id', None)
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle asset
        try:
            asset = Asset.objects.get(id=asset_id)
            validated_data['asset'] = asset
        except Asset.DoesNotExist:
            raise serializers.ValidationError(f"Asset with ID {asset_id} does not exist")
        
        # Handle performed_by_employee (optional)
        if performed_by_employee_id:
            try:
                performed_by_employee = Employee.objects.get(id=performed_by_employee_id)
                validated_data['performed_by_employee'] = performed_by_employee
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {performed_by_employee_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Create the maintenance record
        maintenance = AssetMaintenance.objects.create(**validated_data)
        return maintenance


# ======================
# ATTENDANCE SERIALIZERS
# ======================

from .models import Attendance, AttendanceImportLog


class AttendanceSerializer(serializers.ModelSerializer):
    """Serializer cho chấm công"""
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    shift_type_display = serializers.CharField(source='get_shift_type_display', read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    
    # Thông tin rule đã apply
    rule_history = serializers.SerializerMethodField()
    applied_rules = serializers.SerializerMethodField()
    work_coefficient = serializers.SerializerMethodField()
    
    # Writeable fields for foreign key IDs
    employee_id = serializers.IntegerField(write_only=True, required=True)
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = Attendance
        fields = [
            'id', 'attendance_code', 'employee', 'employee_id', 'employee_name', 'employee_code',
            'attendance_date', 'check_in', 'check_out', 'status', 'status_display',
            'shift_type', 'shift_type_display', 'working_hours', 'overtime_hours',
            'late_minutes', 'early_leave_minutes', 'notes',
            'imported_from_file', 'import_batch',
            'created_at', 'updated_at', 'created_by', 'created_by_name', 'created_by_id',
            'department_name',
            'rule_history', 'applied_rules', 'work_coefficient'
        ]
        read_only_fields = ['created_at', 'updated_at', 'attendance_code', 'working_hours']
    
    def to_representation(self, instance):
        """
        Recalculate attendance status before returning data
        """
        representation = super().to_representation(instance)
        
        # Recalculate attendance using rule engine
        from .rule_engine import AttendanceRuleEngine
        try:
            # Explicitly get applicable rules for this employee and date
            rules = AttendanceRuleEngine.get_applicable_rules_for_employee(
                instance.employee, instance.attendance_date
            )
            
            # Apply rules with explicit rules parameter
            calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(instance, rules)

            print("\n\n==================================================\n\n")
            print("Recalculated Attendance:", calculation_result)
            print("Applied Rules:", [rule.name for rule in rules])
            print("\n\n==================================================\n\n")
            
            # Update status and other fields with recalculated values
            representation['status'] = calculation_result.get('status', instance.status)
            representation['working_hours'] = float(calculation_result.get('work_hours', instance.working_hours))
            representation['late_minutes'] = calculation_result.get('late_minutes', instance.late_minutes)
            representation['early_leave_minutes'] = calculation_result.get('early_leave_minutes', instance.early_leave_minutes)
            representation['overtime_hours'] = float(calculation_result.get('overtime_hours', instance.overtime_hours))
            
            # Update status_display based on recalculated status
            status_mapping = {
                'PRESENT': 'Đủ công',
                'LATE': 'Đi muộn',
                'ABSENT': 'Vắng mặt',
                'EARLY_LEAVE': 'Về sớm',
                'HALF_DAY': 'Nửa ngày',
                'LEAVE': 'Nghỉ phép',
                'HOLIDAY': 'Ngày lễ',
                'DAY_OFF': 'Ngày nghỉ',
                'INCOMPLETE_ATTENDANCE': 'Quên chấm công'
            }
            representation['status_display'] = status_mapping.get(
                representation['status'], 
                representation['status']
            )
            
        except Exception as e:
            # If recalculation fails, keep original values
            print(f"Error recalculating attendance: {e}")
            pass
        
        return representation
    
    def get_rule_history(self, obj):
        """Lấy lịch sử áp dụng rule cho attendance này"""
        from .models import AttendanceRuleHistory
        history = AttendanceRuleHistory.objects.filter(attendance=obj).order_by('-applied_at')
        return AttendanceRuleHistorySerializer(history, many=True).data
    
    def get_applied_rules(self, obj):
        """Lấy thông tin rule đã apply"""
        from .models import AttendanceRuleHistory
        from .rule_engine import AttendanceRuleEngine
        
        # Lấy rule history
        history = AttendanceRuleHistory.objects.filter(attendance=obj).order_by('-applied_at')
        if history.exists():
            # Lấy từ history
            fields = [
                # Frontend fields
                'full_name', 'position_title', 'start_date',
                'employee_id',  # ← THÊM DÒNG NÀY
                # Backend fields
                'candidate_name', 'candidate_email', 'candidate_phone',
                'citizen_id', 'date_of_birth', 'gender',
                'permanent_address', 'current_address',
                'education_level', 'university', 'major', 'graduation_year',
                'position', 'department', 'direct_manager',
                'expected_end_date', 'contract_type', 'probation_period_months',
                'salary', 'salary_note',
                'bank_name', 'bank_account', 'bank_branch', 'bank_account_holder',
                'tax_code', 'tax_dependents',
                'hr_responsible', 'status', 'notes',
                'cv_file', 'id_card_front', 'id_card_back', 'diploma_file'
            ]
            return []
    
    def get_work_coefficient(self, obj):
        """Lấy hệ số công đã tính toán"""
        from .models import AttendanceRuleHistory
        from .rule_engine import AttendanceRuleEngine
        
        # Lấy từ rule history
        history = AttendanceRuleHistory.objects.filter(attendance=obj).order_by('-applied_at')
        if history.exists():
            # Lấy từ calculation_result mới nhất
            latest = history.first()
            if latest and latest.calculation_result:
                return latest.calculation_result.get('work_coefficient', 1.0)
        
        # Nếu chưa có, tính toán lại
        try:
            calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(obj)
            return calculation_result.get('work_coefficient', 1.0)
        except Exception as e:
            return 1.0
    
    def create(self, validated_data):
        """
        Create attendance record with proper foreign key handling
        """
        # Extract foreign key IDs
        employee_id = validated_data.pop('employee_id')
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle employee
        try:
            employee = Employee.objects.get(id=employee_id)
            validated_data['employee'] = employee
        except Employee.DoesNotExist:
            raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Check for duplicate attendance (same employee, date, shift_type)
        attendance_date = validated_data.get('attendance_date')
        shift_type = validated_data.get('shift_type', 'FULL_DAY')
        
        duplicate = Attendance.objects.filter(
            employee=employee,
            attendance_date=attendance_date,
            shift_type=shift_type
        ).exists()
        
        if duplicate:
            raise serializers.ValidationError(
                f"Attendance record already exists for employee {employee.full_name} "
                f"on {attendance_date} for shift {shift_type}"
            )
        
        # Create the attendance record
        attendance = Attendance.objects.create(**validated_data)
        return attendance
    
    def update(self, instance, validated_data):
        """
        Update attendance record with proper foreign key handling
        """
        # Extract foreign key IDs
        employee_id = validated_data.pop('employee_id', None)
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle employee (optional)
        if employee_id is not None:
            try:
                employee = Employee.objects.get(id=employee_id)
                instance.employee = employee
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        instance.save()
        return instance


class AttendanceListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing attendance records
    """
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    shift_type_display = serializers.CharField(source='get_shift_type_display', read_only=True)
    
    class Meta:
        model = Attendance
        fields = [
            'id', 'attendance_code', 'employee_name', 'employee_code',
            'attendance_date', 'check_in', 'check_out', 'status', 'status_display',
            'shift_type', 'shift_type_display', 'working_hours', 'overtime_hours',
            'late_minutes', 'early_leave_minutes', 'notes', 'department_name'
        ]
    
    def to_representation(self, instance):
        """
        Recalculate attendance status before returning data
        """
        representation = super().to_representation(instance)
        
        # Recalculate attendance using rule engine
        from .rule_engine import AttendanceRuleEngine
        try:
            # Explicitly get applicable rules for this employee and date
            rules = AttendanceRuleEngine.get_applicable_rules_for_employee(
                instance.employee, instance.attendance_date
            )
            
            # Apply rules with explicit rules parameter
            calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(instance, rules)
            
            # Update status and other fields with recalculated values
            representation['status'] = calculation_result.get('status', instance.status)
            representation['working_hours'] = float(calculation_result.get('work_hours', instance.working_hours))
            representation['late_minutes'] = calculation_result.get('late_minutes', instance.late_minutes)
            representation['early_leave_minutes'] = calculation_result.get('early_leave_minutes', instance.early_leave_minutes)
            representation['overtime_hours'] = float(calculation_result.get('overtime_hours', instance.overtime_hours))
            
            # Update status_display based on recalculated status
            status_mapping = {
                'PRESENT': 'Đủ công',
                'LATE': 'Đi muộn',
                'ABSENT': 'Vắng mặt',
                'EARLY_LEAVE': 'Về sớm',
                'HALF_DAY': 'Nửa ngày',
                'LEAVE': 'Nghỉ phép',
                'HOLIDAY': 'Ngày lễ',
                'DAY_OFF': 'Ngày nghỉ',
                'INCOMPLETE_ATTENDANCE': 'Quên chấm công'
            }
            representation['status_display'] = status_mapping.get(
                representation['status'], 
                representation['status']
            )
            
        except Exception as e:
            # If recalculation fails, keep original values
            pass
        
        return representation


class AttendanceImportLogSerializer(serializers.ModelSerializer):
    """Serializer cho lịch sử import chấm công"""
    imported_by_name = serializers.CharField(source='imported_by.full_name', read_only=True)
    
    # Writeable fields for foreign key IDs
    imported_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = AttendanceImportLog
        fields = [
            'id', 'import_code', 'file_name', 'file_size',
            'total_records', 'imported_records', 'failed_records', 'duplicate_records',
            'import_result', 'error_log',
            'imported_by', 'imported_by_id', 'imported_by_name',
            'created_at', 'completed_at'
        ]
        read_only_fields = ['created_at', 'completed_at', 'import_code']
    
    def create(self, validated_data):
        """
        Create import log with proper foreign key handling
        """
        # Extract foreign key IDs
        imported_by_id = validated_data.pop('imported_by_id', None)
        
        # Handle imported_by (optional)
        if imported_by_id:
            try:
                imported_by = Employee.objects.get(id=imported_by_id)
                validated_data['imported_by'] = imported_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {imported_by_id} does not exist")
        
        # Create the import log
        import_log = AttendanceImportLog.objects.create(**validated_data)
        return import_log


class AttendanceStatsSerializer(serializers.Serializer):
    """Serializer cho thống kê chấm công"""
    employee_id = serializers.IntegerField(required=False)
    department_id = serializers.IntegerField(required=False)
    start_date = serializers.DateField(required=True)
    end_date = serializers.DateField(required=True)
    
    total_days = serializers.IntegerField(read_only=True)
    present_days = serializers.IntegerField(read_only=True)
    absent_days = serializers.IntegerField(read_only=True)
    late_days = serializers.IntegerField(read_only=True)
    early_leave_days = serializers.IntegerField(read_only=True)
    half_days = serializers.IntegerField(read_only=True)
    
    total_working_hours = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    total_overtime_hours = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    total_late_minutes = serializers.IntegerField(read_only=True)
    total_early_leave_minutes = serializers.IntegerField(read_only=True)
    
    attendance_by_date = serializers.ListField(read_only=True)
    status_summary = serializers.DictField(read_only=True)
    
    def validate(self, data):
        """
        Validate date range
        """
        if data['start_date'] > data['end_date']:
            raise serializers.ValidationError("start_date must be before end_date")
        
        # Limit date range to 1 year
        from datetime import timedelta
        max_range = timedelta(days=365)
        if data['end_date'] - data['start_date'] > max_range:
            raise serializers.ValidationError("Date range cannot exceed 1 year")
        
        return data


# ======================
# COMPANY CONFIGURATION SERIALIZERS
# ======================

from .models import CompanyConfig, ShiftConfig, HolidayConfig


class CompanyConfigSerializer(serializers.ModelSerializer):
    """Serializer cho cấu hình công ty"""
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    # Writeable fields for foreign key IDs
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = CompanyConfig
        fields = [
            'id', 'name', 'code', 'description',
            'default_working_hours_per_day', 'default_working_days_per_week',
            'overtime_multiplier_weekday', 'overtime_multiplier_weekend', 'overtime_multiplier_holiday',
            'late_threshold_minutes', 'early_leave_threshold_minutes', 'half_day_threshold_hours',
            'annual_leave_days_per_year', 'sick_leave_days_per_year',
            'maternity_leave_days', 'paternity_leave_days',
            'max_explanation_count_per_month', 'supplement_work_hours_per_month',
            'max_leave_count_per_month', 'max_online_work_count_per_month',
            'lock_employee_self_edit',
            'is_active', 'effective_from', 'effective_to',
            'created_at', 'updated_at', 'created_by', 'created_by_name', 'created_by_id',
            'is_current'
        ]
        read_only_fields = ['created_at', 'updated_at', 'code', 'is_current']
    
    def create(self, validated_data):
        """
        Create company config with proper foreign key handling
        """
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Create the company config
        company_config = CompanyConfig.objects.create(**validated_data)
        return company_config
    
    def update(self, instance, validated_data):
        """
        Update company config with proper foreign key handling
        """
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        instance.save()
        return instance


class CompanyConfigListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing company configs
    """
    is_current = serializers.BooleanField(read_only=True)
    
    class Meta:
        model = CompanyConfig
        fields = [
            'id', 'code', 'name', 'description',
            'default_working_hours_per_day', 'default_working_days_per_week',
            'is_active', 'effective_from', 'effective_to',
            'created_at', 'is_current'
        ]


class ShiftConfigSerializer(serializers.ModelSerializer):
    """Serializer cho cấu hình ca làm"""
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    shift_type_display = serializers.CharField(source='get_shift_type_display', read_only=True)
    apply_scope_display = serializers.CharField(source='get_apply_scope_display', read_only=True)
    
    # Writeable fields for foreign key IDs
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Many-to-many fields
    apply_to_departments = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Department.objects.all(), required=False
    )
    apply_to_positions = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Position.objects.all(), required=False
    )
    apply_to_employees = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Employee.objects.all(), required=False
    )
    
    class Meta:
        model = ShiftConfig
        fields = [
            'id', 'name', 'code', 'description',
            'start_time', 'end_time', 'break_start_time', 'break_end_time', 'break_duration_minutes',
            'total_hours', 'working_hours', 'fixed_workday', 'shift_type', 'shift_type_display',
            'apply_scope', 'apply_scope_display',
            'apply_to_departments', 'apply_to_positions', 'apply_to_employees',
            'effective_from', 'effective_to',
            'is_active', 'is_default',
            'created_at', 'updated_at', 'created_by', 'created_by_name', 'created_by_id',
            'is_current'
        ]
        read_only_fields = ['created_at', 'updated_at', 'code', 'total_hours', 'working_hours', 'is_current']
    
    def create(self, validated_data):
        """
        Create shift config with proper foreign key handling
        """
        # Extract many-to-many data
        apply_to_departments = validated_data.pop('apply_to_departments', [])
        apply_to_positions = validated_data.pop('apply_to_positions', [])
        apply_to_employees = validated_data.pop('apply_to_employees', [])
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Create the shift config
        shift_config = ShiftConfig.objects.create(**validated_data)
        
        # Set many-to-many relationships
        shift_config.apply_to_departments.set(apply_to_departments)
        shift_config.apply_to_positions.set(apply_to_positions)
        shift_config.apply_to_employees.set(apply_to_employees)
        
        return shift_config
    
    def update(self, instance, validated_data):
        """
        Update shift config with proper foreign key handling
        
        Note: chỉ update many-to-many relationships khi field thực sự được gửi
        trong request (kiểm tra qua self.initial_data), để tránh xoá mất dữ liệu
        cũ khi client chỉ muốn cập nhật các field khác mà không gửi lại m2m fields.
        """
        # Extract many-to-many data
        apply_to_departments = validated_data.pop('apply_to_departments', None)
        apply_to_positions = validated_data.pop('apply_to_positions', None)
        apply_to_employees = validated_data.pop('apply_to_employees', None)
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        # Update many-to-many relationships ONLY if the field was actually sent in the request
        # Dùng self.initial_data để kiểm tra, vì validated_data luôn có thể có giá trị
        # mặc định (vd: mảng rỗng []) gây mất dữ liệu cũ.
        initial = self.initial_data
        if 'apply_to_departments' in initial:
            instance.apply_to_departments.set(apply_to_departments or [])
        if 'apply_to_positions' in initial:
            instance.apply_to_positions.set(apply_to_positions or [])
        if 'apply_to_employees' in initial:
            instance.apply_to_employees.set(apply_to_employees or [])
        
        instance.save()
        return instance


class ShiftConfigListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing shift configs
    """
    is_current = serializers.BooleanField(read_only=True)
    shift_type_display = serializers.CharField(source='get_shift_type_display', read_only=True)
    apply_scope_display = serializers.CharField(source='get_apply_scope_display', read_only=True)

    # VÁ LỖ HỔNG HIỂN THỊ: trước đây serializer này (dùng cho list()) thiếu
    # hẳn 3 field M2M này (chỉ ShiftConfigSerializer — dùng cho retrieve/
    # create/update — mới có) khiến FE gọi listShiftConfigs() không bao giờ
    # biết ca nào đang áp dụng cho phòng ban/vị trí/nhân viên nào (luôn ra
    # undefined) — xem trang "Cấu hình ca làm" > khối "Tổng quan phân ca".
    # Chỉ đọc (read_only) vì serializer này không dùng để ghi.
    apply_to_departments = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    apply_to_positions = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    apply_to_employees = serializers.PrimaryKeyRelatedField(many=True, read_only=True)

    class Meta:
        model = ShiftConfig
        fields = [
            'id', 'code', 'name', 'description',
            'start_time', 'end_time', 'total_hours', 'working_hours',
            'shift_type', 'shift_type_display',
            'apply_scope', 'apply_scope_display',
            'apply_to_departments', 'apply_to_positions', 'apply_to_employees',
            'effective_from', 'effective_to',
            'is_active', 'is_default',
            'created_at', 'is_current'
        ]


class HolidayConfigSerializer(serializers.ModelSerializer):
    """Serializer cho cấu hình ngày lễ"""
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    holiday_type_display = serializers.CharField(source='get_holiday_type_display', read_only=True)
    is_today = serializers.BooleanField(read_only=True)
    is_holiday_today = serializers.BooleanField(read_only=True)
    
    # Writeable fields for foreign key IDs
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Many-to-many fields
    excluded_departments = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Department.objects.all(), required=False
    )
    excluded_positions = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Position.objects.all(), required=False
    )
    excluded_employees = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Employee.objects.all(), required=False
    )
    
    class Meta:
        model = HolidayConfig
        fields = [
            'id', 'name', 'description',
            'holiday_date', 'is_recurring', 'holiday_type', 'holiday_type_display',
            'is_working_day', 'allow_voluntary_work', 'overtime_multiplier',
            'apply_to_all',
            'excluded_departments', 'excluded_positions', 'excluded_employees',
            'notes', 'is_active',
            'created_at', 'updated_at', 'created_by', 'created_by_name', 'created_by_id',
            'is_today', 'is_holiday_today'
        ]
        read_only_fields = ['created_at', 'updated_at', 'is_today', 'is_holiday_today']
    
    def create(self, validated_data):
        """
        Create holiday config with proper foreign key handling
        """
        # Extract many-to-many data
        excluded_departments = validated_data.pop('excluded_departments', [])
        excluded_positions = validated_data.pop('excluded_positions', [])
        excluded_employees = validated_data.pop('excluded_employees', [])
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Create the holiday config
        holiday_config = HolidayConfig.objects.create(**validated_data)
        
        # Set many-to-many relationships
        holiday_config.excluded_departments.set(excluded_departments)
        holiday_config.excluded_positions.set(excluded_positions)
        holiday_config.excluded_employees.set(excluded_employees)
        
        return holiday_config
    
    def update(self, instance, validated_data):
        """
        Update holiday config with proper foreign key handling
        """
        # Extract many-to-many data
        excluded_departments = validated_data.pop('excluded_departments', None)
        excluded_positions = validated_data.pop('excluded_positions', None)
        excluded_employees = validated_data.pop('excluded_employees', None)
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        # Update many-to-many relationships if provided
        if excluded_departments is not None:
            instance.excluded_departments.set(excluded_departments)
        if excluded_positions is not None:
            instance.excluded_positions.set(excluded_positions)
        if excluded_employees is not None:
            instance.excluded_employees.set(excluded_employees)
        
        instance.save()
        return instance


class HolidayConfigListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing holiday configs
    """
    holiday_type_display = serializers.CharField(source='get_holiday_type_display', read_only=True)
    is_today = serializers.BooleanField(read_only=True)
    
    class Meta:
        model = HolidayConfig
        fields = [
            'id', 'name', 'holiday_date', 'is_recurring',
            'holiday_type', 'holiday_type_display',
            'is_working_day', 'allow_voluntary_work',
            'apply_to_all', 'is_active',
            'created_at', 'is_today'
        ]


class CurrentCompanyConfigSerializer(serializers.Serializer):
    """Serializer cho cấu hình công ty hiện tại"""
    company_config = CompanyConfigSerializer(read_only=True)
    current_shifts = ShiftConfigListSerializer(many=True, read_only=True)
    upcoming_holidays = HolidayConfigListSerializer(many=True, read_only=True)
    today_holidays = HolidayConfigListSerializer(many=True, read_only=True)
    
    def to_representation(self, instance):
        """
        Get current company configuration
        """
        from django.utils import timezone
        today = timezone.now().date()
        
        # Get current company config
        company_config = CompanyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('-effective_from').first()
        
        # Get current shift configs
        current_shifts = ShiftConfig.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        ).order_by('start_time')
        
        # Get upcoming holidays (next 30 days)
        thirty_days_later = today + timezone.timedelta(days=30)
        upcoming_holidays = HolidayConfig.objects.filter(
            is_active=True,
            holiday_date__gte=today,
            holiday_date__lte=thirty_days_later
        ).order_by('holiday_date')
        
        # Get today's holidays
        today_holidays = HolidayConfig.objects.filter(
            is_active=True,
            holiday_date=today
        )
        
        # For recurring holidays, check if today matches month/day
        recurring_today = HolidayConfig.objects.filter(
            is_active=True,
            is_recurring=True,
            holiday_date__month=today.month,
            holiday_date__day=today.day
        ).exclude(id__in=today_holidays.values_list('id', flat=True))
        
        today_holidays = list(today_holidays) + list(recurring_today)
        
        return {
            'company_config': CompanyConfigSerializer(company_config).data if company_config else None,
            'current_shifts': ShiftConfigListSerializer(current_shifts, many=True).data,
            'upcoming_holidays': HolidayConfigListSerializer(upcoming_holidays, many=True).data,
            'today_holidays': HolidayConfigListSerializer(today_holidays, many=True).data,
            'today': today
        }


# ======================
# COMPANY INFORMATION SERIALIZERS
# ======================

from .models import CompanyDocument, CompanyAnnouncement, CompanyDocumentViewLog, CompanyAnnouncementViewLog, CompanyAnnouncementAttachment


class CompanyDocumentSerializer(serializers.ModelSerializer):
    """Serializer cho tài liệu công ty"""
    department_name = serializers.CharField(source='department.name', read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    published_by_name = serializers.CharField(source='published_by.full_name', read_only=True)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    access_level_display = serializers.CharField(source='get_access_level_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    # Writeable fields for foreign key IDs
    department_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    published_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = CompanyDocument
        fields = [
            'id', 'document_code', 'title', 'document_type', 'document_type_display',
            'description', 'file', 'file_name', 'file_size', 'file_type',
            'version', 'effective_from', 'effective_to',
            'status', 'status_display', 'access_level', 'access_level_display',
            'department', 'department_id', 'department_name',
            'tags', 'created_by', 'created_by_id', 'created_by_name',
            'published_by', 'published_by_id', 'published_by_name',
            'created_at', 'updated_at', 'published_at',
            'is_current'
        ]
        read_only_fields = ['created_at', 'updated_at', 'document_code', 'file_name', 'file_size', 'file_type']
    
    def create(self, validated_data):
        """
        Create company document with proper foreign key handling
        """
        # Extract foreign key IDs
        department_id = validated_data.pop('department_id', None)
        created_by_id = validated_data.pop('created_by_id', None)
        published_by_id = validated_data.pop('published_by_id', None)
        
        # Handle department (optional)
        if department_id:
            try:
                from employee.models import Department
                department = Department.objects.get(id=department_id)
                validated_data['department'] = department
            except Department.DoesNotExist:
                raise serializers.ValidationError(f"Department with ID {department_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Handle published_by (optional)
        if published_by_id:
            try:
                published_by = Employee.objects.get(id=published_by_id)
                validated_data['published_by'] = published_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {published_by_id} does not exist")
        
        # Create the company document
        document = CompanyDocument.objects.create(**validated_data)
        return document
    
    def update(self, instance, validated_data):
        """
        Update company document with proper foreign key handling
        """
        # Extract foreign key IDs
        department_id = validated_data.pop('department_id', None)
        created_by_id = validated_data.pop('created_by_id', None)
        published_by_id = validated_data.pop('published_by_id', None)
        
        # Handle department (optional)
        if department_id is not None:
            try:
                from employee.models import Department
                department = Department.objects.get(id=department_id)
                instance.department = department
            except Department.DoesNotExist:
                raise serializers.ValidationError(f"Department with ID {department_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Handle published_by (optional)
        if published_by_id is not None:
            try:
                published_by = Employee.objects.get(id=published_by_id)
                instance.published_by = published_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {published_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        instance.save()
        return instance


class CompanyDocumentListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing company documents
    """
    department_name = serializers.CharField(source='department.name', read_only=True)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    class Meta:
        model = CompanyDocument
        fields = [
            'id', 'document_code', 'title', 'document_type', 'document_type_display',
            'file_name', 'file_type', 'version',
            'effective_from', 'effective_to',
            'status', 'status_display',
            'department_name', 'created_at',
            'is_current'
        ]


class CompanyAnnouncementAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = CompanyAnnouncementAttachment
        fields = ['id', 'file_name', 'file_url', 'uploaded_at']

    def get_file_url(self, obj):
        if not obj.file:
            return None
        from django.conf import settings as s
        if getattr(s, 'CLOUDFLY_ENABLED', False):
            from .utils import get_cloudfly_presigned_url
            return get_cloudfly_presigned_url(str(obj.file))
        request = self.context.get('request')
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url


class CompanyAnnouncementSerializer(serializers.ModelSerializer):
    """Serializer cho thông báo công ty"""
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True)
    announcement_type_display = serializers.CharField(source='get_announcement_type_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    # Writeable fields for foreign key IDs
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    approved_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Many-to-many fields
    departments = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Department.objects.all(), required=False
    )
    positions = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Position.objects.all(), required=False
    )
    employees = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Employee.objects.all(), required=False
    )
    attachments = CompanyAnnouncementAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = CompanyAnnouncement
        fields = [
            'id', 'announcement_code', 'title', 'content',
            'announcement_type', 'announcement_type_display',
            'priority', 'priority_display',
            'apply_to_all', 'departments', 'positions', 'employees',
            'attachment', 'attachments', 'effective_from', 'effective_to',
            'is_active', 'created_by', 'created_by_id', 'created_by_name',
            'approved_by', 'approved_by_id', 'approved_by_name',
            'created_at', 'updated_at', 'published_at',
            'is_current'
        ]
        read_only_fields = ['created_at', 'updated_at', 'announcement_code']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.attachment:
            from django.conf import settings as django_settings
            if getattr(django_settings, 'CLOUDFLY_ENABLED', False):
                from .utils import get_cloudfly_presigned_url
                data['attachment'] = get_cloudfly_presigned_url(str(instance.attachment))
        return data

    def create(self, validated_data):
        """
        Create company announcement with proper foreign key handling
        """
        # Extract many-to-many data
        departments = validated_data.pop('departments', [])
        positions = validated_data.pop('positions', [])
        employees = validated_data.pop('employees', [])
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        approved_by_id = validated_data.pop('approved_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Handle approved_by (optional)
        if approved_by_id:
            try:
                approved_by = Employee.objects.get(id=approved_by_id)
                validated_data['approved_by'] = approved_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {approved_by_id} does not exist")
        
        # Create the company announcement
        announcement = CompanyAnnouncement.objects.create(**validated_data)
        
        # Set many-to-many relationships
        announcement.departments.set(departments)
        announcement.positions.set(positions)
        announcement.employees.set(employees)
        
        return announcement
    
    def update(self, instance, validated_data):
        """
        Update company announcement with proper foreign key handling
        """
        # Extract many-to-many data
        departments = validated_data.pop('departments', None)
        positions = validated_data.pop('positions', None)
        employees = validated_data.pop('employees', None)
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        approved_by_id = validated_data.pop('approved_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Handle approved_by (optional)
        if approved_by_id is not None:
            try:
                approved_by = Employee.objects.get(id=approved_by_id)
                instance.approved_by = approved_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {approved_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        # Update many-to-many relationships if provided
        if departments is not None:
            instance.departments.set(departments)
        if positions is not None:
            instance.positions.set(positions)
        if employees is not None:
            instance.employees.set(employees)
        
        instance.save()
        return instance


class CompanyAnnouncementListSerializer(serializers.ModelSerializer):
    """
    Serializer for listing company announcements
    """
    announcement_type_display = serializers.CharField(source='get_announcement_type_display', read_only=True)
    priority_display = serializers.CharField(source='get_priority_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True)
    attachments = CompanyAnnouncementAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = CompanyAnnouncement
        fields = [
            'id', 'announcement_code', 'title', 'content',
            'announcement_type', 'announcement_type_display',
            'priority', 'priority_display',
            'apply_to_all', 'attachment', 'attachments',
            'effective_from', 'effective_to',
            'is_active', 'created_at', 'updated_at', 'published_at',
            'created_by_name', 'approved_by_name',
            'is_current',
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if instance.attachment:
            from django.conf import settings as django_settings
            if getattr(django_settings, 'CLOUDFLY_ENABLED', False):
                from .utils import get_cloudfly_presigned_url
                data['attachment'] = get_cloudfly_presigned_url(str(instance.attachment))
        return data


class CompanyDocumentViewLogSerializer(serializers.ModelSerializer):
    """Serializer cho lịch sử xem tài liệu"""
    document_title = serializers.CharField(source='document.title', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    
    class Meta:
        model = CompanyDocumentViewLog
        fields = [
            'id', 'document', 'document_title', 'employee', 'employee_name',
            'viewed_at', 'duration_seconds', 'page_count',
            'user_agent', 'ip_address'
        ]
        read_only_fields = ['viewed_at']


class CompanyAnnouncementViewLogSerializer(serializers.ModelSerializer):
    """Serializer cho lịch sử xem thông báo"""
    announcement_title = serializers.CharField(source='announcement.title', read_only=True)
    employee_name = serializers.SerializerMethodField()

    def get_employee_name(self, obj):
        if obj.employee:
            return obj.employee.full_name
        return obj.user.username if obj.user else None
    
    class Meta:
        model = CompanyAnnouncementViewLog
        fields = [
            'id', 'announcement', 'announcement_title', 'employee', 'employee_name',
            'viewed_at', 'duration_seconds', 'acknowledged', 'acknowledged_at',
            'user_agent', 'ip_address'
        ]
        read_only_fields = ['viewed_at', 'acknowledged_at']


class EmployeeCompanyInfoSerializer(serializers.Serializer):
    """Serializer cho thông tin công ty của nhân viên"""
    documents = CompanyDocumentListSerializer(many=True, read_only=True)
    announcements = CompanyAnnouncementListSerializer(many=True, read_only=True)
    unread_announcements = serializers.IntegerField(read_only=True)
    document_categories = serializers.DictField(read_only=True)
    
    def to_representation(self, instance):
        """
        Get company information for employee
        """
        employee = instance
        today = timezone.now().date()
        
        # Get accessible documents
        documents = CompanyDocument.objects.filter(
            status='PUBLISHED',
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        )
        
        # Filter documents by access level
        accessible_documents = []
        for doc in documents:
            if doc.can_access(employee):
                accessible_documents.append(doc)
        
        # Get applicable announcements
        announcements = CompanyAnnouncement.objects.filter(
            is_active=True,
            effective_from__lte=today
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today)
        )
        
        # Filter announcements by applicability
        applicable_announcements = []
        for ann in announcements:
            if ann.should_apply_to_employee(employee):
                applicable_announcements.append(ann)
        
        # Count unread announcements
        unread_count = 0
        for ann in applicable_announcements:
            if not CompanyAnnouncementViewLog.objects.filter(
                announcement=ann,
                employee=employee,
                acknowledged=True
            ).exists():
                unread_count += 1
        
        # Group documents by type
        document_categories = {}
        for doc in accessible_documents:
            doc_type = doc.get_document_type_display()
            if doc_type not in document_categories:
                document_categories[doc_type] = []
            document_categories[doc_type].append(CompanyDocumentListSerializer(doc).data)
        
        return {
            'documents': CompanyDocumentListSerializer(accessible_documents, many=True).data,
            'announcements': CompanyAnnouncementListSerializer(applicable_announcements, many=True).data,
            'unread_announcements': unread_count,
            'document_categories': document_categories
        }


# ======================
# ATTENDANCE RULE CONFIGURATION SERIALIZERS
# ======================

from .models import AttendanceRuleConfig, AttendanceRuleHistory, LeavePolicyConfig


class AttendanceRuleConfigSerializer(serializers.ModelSerializer):
    """Serializer cho cấu hình quy tắc chấm công"""
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    rule_type_display = serializers.CharField(source='get_rule_type_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    # Writeable fields for foreign key IDs
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Many-to-many fields
    apply_to_departments = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Department.objects.all(), required=False
    )
    apply_to_positions = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Position.objects.all(), required=False
    )
    apply_to_employees = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Employee.objects.all(), required=False
    )
    
    class Meta:
        model = AttendanceRuleConfig
        fields = [
            'id', 'name', 'code', 'description',
            'rule_type', 'rule_type_display', 'configuration',
            'apply_to_all', 'apply_to_departments', 'apply_to_positions', 'apply_to_employees',
            'effective_from', 'effective_to',
            'is_active', 'is_default',
            'created_at', 'updated_at', 'created_by', 'created_by_name', 'created_by_id',
            'is_current'
        ]
        read_only_fields = ['created_at', 'updated_at', 'code', 'is_current']
    
    def create(self, validated_data):
        """
        Create attendance rule config with proper foreign key handling
        """
        # Extract many-to-many data
        apply_to_departments = validated_data.pop('apply_to_departments', [])
        apply_to_positions = validated_data.pop('apply_to_positions', [])
        apply_to_employees = validated_data.pop('apply_to_employees', [])
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Create the attendance rule config
        rule_config = AttendanceRuleConfig.objects.create(**validated_data)
        
        # Set many-to-many relationships
        rule_config.apply_to_departments.set(apply_to_departments)
        rule_config.apply_to_positions.set(apply_to_positions)
        rule_config.apply_to_employees.set(apply_to_employees)
        
        return rule_config
    
    def update(self, instance, validated_data):
        """
        Update attendance rule config with proper foreign key handling
        """
        # Extract many-to-many data
        apply_to_departments = validated_data.pop('apply_to_departments', None)
        apply_to_positions = validated_data.pop('apply_to_positions', None)
        apply_to_employees = validated_data.pop('apply_to_employees', None)
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        # Update many-to-many relationships if provided
        if apply_to_departments is not None:
            instance.apply_to_departments.set(apply_to_departments)
        if apply_to_positions is not None:
            instance.apply_to_positions.set(apply_to_positions)
        if apply_to_employees is not None:
            instance.apply_to_employees.set(apply_to_employees)
        
        instance.save()
        return instance


class AttendanceRuleConfigListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing attendance rule configs
    """
    rule_type_display = serializers.CharField(source='get_rule_type_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    # Many-to-many fields for scope display
    apply_to_departments = serializers.PrimaryKeyRelatedField(
        many=True, read_only=True
    )
    apply_to_positions = serializers.PrimaryKeyRelatedField(
        many=True, read_only=True
    )
    apply_to_employees = serializers.PrimaryKeyRelatedField(
        many=True, read_only=True
    )
    
    class Meta:
        model = AttendanceRuleConfig
        fields = [
            'id', 'code', 'name', 'description',
            'rule_type', 'rule_type_display',
            'apply_to_all', 'apply_to_departments', 'apply_to_positions', 'apply_to_employees',
            'effective_from', 'effective_to',
            'is_active', 'is_default',
            'created_at', 'is_current'
        ]


class AttendanceRuleHistorySerializer(serializers.ModelSerializer):
    """Serializer cho lịch sử áp dụng quy tắc chấm công"""
    attendance_code = serializers.CharField(source='attendance.attendance_code', read_only=True)
    rule_code = serializers.CharField(source='rule.code', read_only=True)
    rule_name = serializers.CharField(source='rule.name', read_only=True)
    applied_by_name = serializers.CharField(source='applied_by.full_name', read_only=True)
    
    # Writeable fields for foreign key IDs
    attendance_id = serializers.IntegerField(write_only=True, required=True)
    rule_id = serializers.IntegerField(write_only=True, required=True)
    applied_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    class Meta:
        model = AttendanceRuleHistory
        fields = [
            'id', 'attendance', 'attendance_id', 'attendance_code',
            'rule', 'rule_id', 'rule_code', 'rule_name',
            'applied_configuration', 'calculation_result',
            'applied_at', 'applied_by', 'applied_by_id', 'applied_by_name'
        ]
        read_only_fields = ['applied_at']
    
    def create(self, validated_data):
        """
        Create attendance rule history with proper foreign key handling
        """
        # Extract foreign key IDs
        attendance_id = validated_data.pop('attendance_id')
        rule_id = validated_data.pop('rule_id')
        applied_by_id = validated_data.pop('applied_by_id', None)
        
        # Handle attendance
        try:
            attendance = Attendance.objects.get(id=attendance_id)
            validated_data['attendance'] = attendance
        except Attendance.DoesNotExist:
            raise serializers.ValidationError(f"Attendance with ID {attendance_id} does not exist")
        
        # Handle rule
        try:
            rule = AttendanceRuleConfig.objects.get(id=rule_id)
            validated_data['rule'] = rule
        except AttendanceRuleConfig.DoesNotExist:
            raise serializers.ValidationError(f"AttendanceRuleConfig with ID {rule_id} does not exist")
        
        # Handle applied_by (optional)
        if applied_by_id:
            try:
                applied_by = Employee.objects.get(id=applied_by_id)
                validated_data['applied_by'] = applied_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {applied_by_id} does not exist")
        
        # Create the attendance rule history
        history = AttendanceRuleHistory.objects.create(**validated_data)
        return history


class LeavePolicyConfigSerializer(serializers.ModelSerializer):
    """Serializer cho cấu hình chính sách nghỉ phép"""
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    leave_type_display = serializers.CharField(source='get_leave_type_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    # Writeable fields for foreign key IDs
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Many-to-many fields
    apply_to_departments = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Department.objects.all(), required=False
    )
    apply_to_positions = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Position.objects.all(), required=False
    )
    apply_to_employees = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Employee.objects.all(), required=False
    )
    
    class Meta:
        model = LeavePolicyConfig
        fields = [
            'id', 'name', 'code', 'description',
            'leave_type', 'leave_type_display',
            'advance_notice_rules', 'emergency_notice_hours',
            'requires_medical_certificate', 'requires_approval',
            'max_days_per_year', 'max_consecutive_days',
            'apply_to_all', 'apply_to_departments', 'apply_to_positions', 'apply_to_employees',
            'effective_from', 'effective_to',
            'is_active',
            'created_at', 'updated_at', 'created_by', 'created_by_name', 'created_by_id',
            'is_current'
        ]
        read_only_fields = ['created_at', 'updated_at', 'code', 'is_current']
    
    def create(self, validated_data):
        """
        Create leave policy config with proper foreign key handling
        """
        # Extract many-to-many data
        apply_to_departments = validated_data.pop('apply_to_departments', [])
        apply_to_positions = validated_data.pop('apply_to_positions', [])
        apply_to_employees = validated_data.pop('apply_to_employees', [])
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Create the leave policy config
        policy_config = LeavePolicyConfig.objects.create(**validated_data)
        
        # Set many-to-many relationships
        policy_config.apply_to_departments.set(apply_to_departments)
        policy_config.apply_to_positions.set(apply_to_positions)
        policy_config.apply_to_employees.set(apply_to_employees)
        
        return policy_config
    
    def update(self, instance, validated_data):
        """
        Update leave policy config with proper foreign key handling
        """
        # Extract many-to-many data
        apply_to_departments = validated_data.pop('apply_to_departments', None)
        apply_to_positions = validated_data.pop('apply_to_positions', None)
        apply_to_employees = validated_data.pop('apply_to_employees', None)
        
        # Extract foreign key IDs
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        # Update many-to-many relationships if provided
        if apply_to_departments is not None:
            instance.apply_to_departments.set(apply_to_departments)
        if apply_to_positions is not None:
            instance.apply_to_positions.set(apply_to_positions)
        if apply_to_employees is not None:
            instance.apply_to_employees.set(apply_to_employees)
        
        instance.save()
        return instance


class LeavePolicyConfigListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing leave policy configs
    """
    leave_type_display = serializers.CharField(source='get_leave_type_display', read_only=True)
    is_current = serializers.BooleanField(read_only=True)
    
    # Many-to-many fields for scope display
    apply_to_departments = serializers.PrimaryKeyRelatedField(
        many=True, read_only=True
    )
    apply_to_positions = serializers.PrimaryKeyRelatedField(
        many=True, read_only=True
    )
    apply_to_employees = serializers.PrimaryKeyRelatedField(
        many=True, read_only=True
    )
    
    class Meta:
        model = LeavePolicyConfig
        fields = [
            'id', 'code', 'name', 'description',
            'leave_type', 'leave_type_display',
            'apply_to_all', 'apply_to_departments', 'apply_to_positions', 'apply_to_employees',
            'effective_from', 'effective_to',
            'is_active',
            'created_at', 'is_current'
        ]


class AttendanceRuleEngineSerializer(serializers.Serializer):
    """Serializer cho engine tính toán quy tắc chấm công"""
    attendance_id = serializers.IntegerField(required=False)
    employee_id = serializers.IntegerField(required=True)
    attendance_date = serializers.DateField(required=True)
    check_in = serializers.TimeField(required=False, allow_null=True)
    check_out = serializers.TimeField(required=False, allow_null=True)
    shift_type = serializers.CharField(required=False, default='FULL_DAY')
    
    # Kết quả tính toán
    calculated_status = serializers.CharField(read_only=True)
    calculated_work_hours = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)
    calculated_work_coefficient = serializers.DecimalField(max_digits=3, decimal_places=2, read_only=True)
    calculated_late_minutes = serializers.IntegerField(read_only=True)


# ======================
# ATTENDANCE EXPLANATION SERIALIZERS
# ======================

from .models import AttendanceExplanation


class AttendanceExplanationSerializer(serializers.ModelSerializer):
    """Serializer cho giải trình chấm công"""
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True)
    original_status_display = serializers.CharField(source='get_original_status_display', read_only=True)
    expected_status_display = serializers.CharField(source='get_expected_status_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    employee_position = serializers.CharField(source='employee.position.title', read_only=True, allow_null=True)
    position_name = serializers.CharField(source='employee.position.title', read_only=True, allow_null=True)
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True)
    
    # Thông tin quản lý cho kiểm tra quyền
    employee_manager_id = serializers.SerializerMethodField()
    employee_department_manager_id = serializers.SerializerMethodField()
    
    # Approval tracking fields
    direct_manager_approved_by_name = serializers.CharField(source='direct_manager_approved_by.full_name', read_only=True)
    hr_approved_by_name = serializers.CharField(source='hr_approved_by.full_name', read_only=True)
    
    # Writeable fields for foreign key IDs
    employee_id = serializers.IntegerField(write_only=True, required=True)
    approved_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    direct_manager_approved_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    hr_approved_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Explicitly define employee and approved_by as read-only
    employee = serializers.PrimaryKeyRelatedField(read_only=True)
    approved_by = serializers.PrimaryKeyRelatedField(read_only=True, allow_null=True)
    direct_manager_approved_by = serializers.PrimaryKeyRelatedField(read_only=True, allow_null=True)
    hr_approved_by = serializers.PrimaryKeyRelatedField(read_only=True, allow_null=True)
    
    class Meta:
        model = AttendanceExplanation
        fields = [
            'id', 'request_code', 'employee', 'employee_id', 'employee_name', 'employee_code',
            'attendance_date', 'original_status', 'original_status_display',
            'expected_status', 'expected_status_display',
            'reason', 'evidence',
            'actual_check_in', 'actual_check_out', 'expected_check_in', 'expected_check_out',
            'status', 'status_display', 'approved_by', 'approved_by_id', 'approved_by_name',
            'approval_decision',
            # Approval tracking fields
            'direct_manager_approved', 'hr_approved',
            'direct_manager_approved_at', 'hr_approved_at',
            'direct_manager_approved_by', 'direct_manager_approved_by_id', 'direct_manager_approved_by_name',
            'hr_approved_by', 'hr_approved_by_id', 'hr_approved_by_name',
            'created_at', 'updated_at', 'submitted_at', 'approved_at',
            'department_name', 'employee_position', 'position_name', 'employee_manager_id', 'employee_department_manager_id'
        ]
        read_only_fields = ['created_at', 'updated_at', 'request_code', 'submitted_at', 'approved_at',
                           'direct_manager_approved_at', 'hr_approved_at']
    
    def get_employee_manager_id(self, obj):
        """Lấy ID của quản lý trực tiếp của nhân viên"""
        if obj.employee and obj.employee.manager:
            return obj.employee.manager.id
        return None
    
    def get_employee_department_manager_id(self, obj):
        """Lấy ID của trưởng phòng của nhân viên"""
        if obj.employee and obj.employee.department and obj.employee.department.manager:
            return obj.employee.department.manager.id
        return None
    
    def create(self, validated_data):
        """
        Create attendance explanation with proper foreign key handling
        """
        # Extract foreign key IDs
        employee_id = validated_data.pop('employee_id')
        approved_by_id = validated_data.pop('approved_by_id', None)
        
        # Handle employee
        try:
            employee = Employee.objects.get(id=employee_id)
            validated_data['employee'] = employee
        except Employee.DoesNotExist:
            raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")
        
        # Handle approved_by (optional)
        if approved_by_id:
            try:
                approved_by = Employee.objects.get(id=approved_by_id)
                validated_data['approved_by'] = approved_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {approved_by_id} does not exist")
        
        # Create the attendance explanation
        explanation = AttendanceExplanation.objects.create(**validated_data)
        return explanation
    
    def update(self, instance, validated_data):
        """
        Update attendance explanation with proper foreign key handling
        """
        # Extract foreign key IDs
        employee_id = validated_data.pop('employee_id', None)
        approved_by_id = validated_data.pop('approved_by_id', None)
        
        # Handle employee (optional)
        if employee_id is not None:
            try:
                employee = Employee.objects.get(id=employee_id)
                instance.employee = employee
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")
        
        # Handle approved_by (optional)
        if approved_by_id is not None:
            try:
                approved_by = Employee.objects.get(id=approved_by_id)
                instance.approved_by = approved_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {approved_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        instance.save()
        return instance


class AttendanceExplanationListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing attendance explanations
    """
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_id = serializers.IntegerField(source='employee.id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True)
    original_status_display = serializers.CharField(source='get_original_status_display', read_only=True)
    expected_status_display = serializers.CharField(source='get_expected_status_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    # Thông tin quản lý cho kiểm tra quyền
    employee_manager_id = serializers.SerializerMethodField()
    employee_manager_name = serializers.SerializerMethodField()
    employee_department_manager_id = serializers.SerializerMethodField()
    employee_department_manager_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    
    # Approval tracking fields
    direct_manager_approved = serializers.BooleanField(read_only=True)
    hr_approved = serializers.BooleanField(read_only=True)
    direct_manager_approved_at = serializers.DateTimeField(read_only=True)
    hr_approved_at = serializers.DateTimeField(read_only=True)
    direct_manager_approved_by_name = serializers.SerializerMethodField()
    hr_approved_by_name = serializers.SerializerMethodField()
    rejected_by_name = serializers.SerializerMethodField()
    hr_rejected_by_name = serializers.SerializerMethodField()
    rejection_level = serializers.SerializerMethodField()
    
    class Meta:
        model = AttendanceExplanation
        fields = [
            'id', 'request_code', 'employee_name', 'employee_code', 'employee_id',
            'attendance_date', 'original_status', 'original_status_display',
            'expected_status', 'expected_status_display',
            'reason', 'status', 'status_display',
            'created_at', 'approved_at',
            'department_name',
            'employee_manager_id', 'employee_manager_name',
            'employee_department_manager_id', 'employee_department_manager_name',
            'approved_by_name',
            # Approval tracking fields
            'direct_manager_approved', 'hr_approved',
            'direct_manager_approved_at', 'hr_approved_at',
            'direct_manager_approved_by_name', 'hr_approved_by_name',
            'rejected_by_name', 'hr_rejected_by_name', 'rejection_level'
        ]
    
    def get_employee_manager_id(self, obj):
        """Lấy ID của quản lý trực tiếp của nhân viên"""
        if obj.employee and obj.employee.manager:
            return obj.employee.manager.id
        return None
    
    def get_employee_manager_name(self, obj):
        """Lấy tên của quản lý trực tiếp của nhân viên"""
        if obj.employee and obj.employee.manager:
            return obj.employee.manager.full_name
        return None
    
    def get_employee_department_manager_id(self, obj):
        """Lấy ID của trưởng phòng của nhân viên"""
        if obj.employee and obj.employee.department and obj.employee.department.manager:
            return obj.employee.department.manager.id
        return None
    
    def get_employee_department_manager_name(self, obj):
        """Lấy tên của trưởng phòng của nhân viên"""
        if obj.employee and obj.employee.department and obj.employee.department.manager:
            return obj.employee.department.manager.full_name
        return None
    
    def get_approved_by_name(self, obj):
        """Lấy tên của người duyệt"""
        if obj.approved_by:
            return obj.approved_by.full_name
        return None
    
    def get_direct_manager_approved_by_name(self, obj):
        """Lấy tên của quản lý trực tiếp đã duyệt"""
        if obj.direct_manager_approved_by:
            return obj.direct_manager_approved_by.full_name
        return None
    
    def get_hr_approved_by_name(self, obj):
        """Lấy tên của nhân sự HR đã duyệt"""
        if obj.hr_approved_by:
            return obj.hr_approved_by.full_name
        return None
    
    def get_rejected_by_name(self, obj):
        """Lấy tên của người từ chối"""
        # Ưu tiên từ data JSON lưu mới
        if obj.data and isinstance(obj.data, dict) and obj.data.get('rejected_by_name'):
            return obj.data.get('rejected_by_name')
        # Fallback về approved_by nếu status là REJECTED
        if obj.status == 'REJECTED' and obj.approved_by:
            return obj.approved_by.full_name
        return None

    def get_hr_rejected_by_name(self, obj):
        """Lấy tên của HR từ chối"""
        # Ưu tiên lấy từ data JSON
        if obj.data and isinstance(obj.data, dict) and obj.data.get('hr_rejected_by_name'):
            return obj.data.get('hr_rejected_by_name')
        # Fallback: nếu rejection_level là HR và có approved_by (tức là HR là người từ chối)
        if obj.status == 'REJECTED' and obj.approved_by:
            rejection_level = obj.data.get('rejection_level') if obj.data and isinstance(obj.data, dict) else None
            if rejection_level == 'HR' or rejection_level == 'ADMIN':
                return obj.approved_by.full_name
            # Nếu không có rejection_level, kiểm tra hr_approved_by
            if not rejection_level and obj.hr_approved_by:
                return obj.hr_approved_by.full_name
        # Fallback cuối: lấy từ hr_approved_by nếu tồn tại
        if obj.hr_approved_by:
            return obj.hr_approved_by.full_name
        return None

    def get_rejection_level(self, obj):
        """Lấy cấp độ từ chối"""
        if obj.data and isinstance(obj.data, dict):
            return obj.data.get('rejection_level')
        return None


class AttendanceExplanationStatsSerializer(serializers.Serializer):
    """Serializer cho thống kê giải trình chấm công"""
    employee_id = serializers.IntegerField(required=False)
    department_id = serializers.IntegerField(required=False)
    month = serializers.IntegerField(required=False)
    year = serializers.IntegerField(required=False)
    
    total_explanations = serializers.IntegerField(read_only=True)
    pending_explanations = serializers.IntegerField(read_only=True)
    approved_explanations = serializers.IntegerField(read_only=True)
    rejected_explanations = serializers.IntegerField(read_only=True)
    remaining_explanations = serializers.IntegerField(read_only=True)
    max_explanations_per_month = serializers.IntegerField(read_only=True)
    
    def validate(self, data):
        """
        Validate month and year
        """
        from datetime import datetime
        
        month = data.get('month')
        year = data.get('year')
        
        if month and (month < 1 or month > 12):
            raise serializers.ValidationError("Month must be between 1 and 12")
        
        if year and year < 2000:
            raise serializers.ValidationError("Year must be 2000 or later")
        
        # If month/year not provided, use current month/year
        if not month or not year:
            now = datetime.now()
            if not month:
                data['month'] = now.month
            if not year:
                data['year'] = now.year
        
        return data


# ======================
# EMPLOYEE PERMISSION SERIALIZERS
# ======================

from .models import EmployeePermission


class EmployeePermissionSerializer(serializers.ModelSerializer):
    """Serializer cho quyền hạn nhân viên"""
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True)
    position_title = serializers.CharField(source='employee.position.title', read_only=True)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    
    # Writeable fields for foreign key IDs
    employee_id = serializers.IntegerField(write_only=True, required=True)
    created_by_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    
    # Computed fields
    has_any_permission = serializers.BooleanField(read_only=True)
    permission_summary = serializers.CharField(source='get_permission_summary', read_only=True)
    
    class Meta:
        model = EmployeePermission
        fields = [
            'id', 'employee', 'employee_id', 'employee_name', 'employee_code',
            'department_name', 'position_title',
            
            # Quyền phê duyệt
            'can_approve_attendance', 'can_approve_leave', 'can_approve_overtime',
            
            # Quyền quản lý nhân sự
            'can_create_employee', 'can_edit_employee', 'can_view_all_employees',
            
            # Quyền quản lý chấm công
            'can_manage_attendance', 'can_import_attendance', 'can_adjust_attendance', 'can_edit_attendance',
            
            # Quyền quản lý tài sản
            'can_manage_assets', 'can_assign_assets', 'can_approve_asset_requests',
            
            # Quyền quản lý phòng ban
            'can_manage_departments', 'can_manage_positions',
            
            # Quyền cấu hình hệ thống
            'can_manage_company_config', 'can_manage_attendance_rules', 'can_manage_leave_policies',
            
            # Quyền báo cáo
            'can_view_reports', 'can_export_reports',

            # Quyền quản lý phê duyệt chốt công
            'can_manage_attendance_finalization_approval',

            # Quyền quản lý phạt biên bản
            'can_manage_disciplinary_penalties',

            # Quyền xem tab Dashboard
            'can_view_dashboard_overview', 'can_view_dashboard_employee',
            'can_view_dashboard_recruitment', 'can_view_dashboard_insurance', 'can_view_dashboard_asset',

            # Ghi chú và thông tin hệ thống
            'notes', 'created_at', 'updated_at', 'created_by', 'created_by_id', 'created_by_name',
            
            # Computed fields
            'has_any_permission', 'permission_summary'
        ]
        read_only_fields = ['created_at', 'updated_at', 'has_any_permission', 'permission_summary']
    
    def create(self, validated_data):
        """
        Create employee permission with proper foreign key handling
        """
        # Extract foreign key IDs
        employee_id = validated_data.pop('employee_id')
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle employee
        try:
            employee = Employee.objects.get(id=employee_id)
            validated_data['employee'] = employee
        except Employee.DoesNotExist:
            raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                validated_data['created_by'] = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Check if permission already exists for this employee
        if EmployeePermission.objects.filter(employee=employee).exists():
            raise serializers.ValidationError(f"Permission already exists for employee {employee.full_name}")
        
        # Create the employee permission
        permission = EmployeePermission.objects.create(**validated_data)
        return permission
    
    def update(self, instance, validated_data):
        """
        Update employee permission with proper foreign key handling
        """
        # Extract foreign key IDs
        employee_id = validated_data.pop('employee_id', None)
        created_by_id = validated_data.pop('created_by_id', None)
        
        # Handle employee (optional - usually shouldn't change)
        if employee_id is not None:
            try:
                employee = Employee.objects.get(id=employee_id)
                instance.employee = employee
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")
        
        # Handle created_by (optional)
        if created_by_id is not None:
            try:
                created_by = Employee.objects.get(id=created_by_id)
                instance.created_by = created_by
            except Employee.DoesNotExist:
                raise serializers.ValidationError(f"Employee with ID {created_by_id} does not exist")
        
        # Update other fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        
        instance.save()
        return instance


class EmployeePermissionListSerializer(serializers.ModelSerializer):
    """
    Simplified serializer for listing employee permissions
    """
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True)
    position_title = serializers.CharField(source='employee.position.title', read_only=True)
    has_any_permission = serializers.BooleanField(read_only=True)
    permission_summary = serializers.CharField(source='get_permission_summary', read_only=True)
    
    class Meta:
        model = EmployeePermission
        fields = [
            'id', 'employee_name', 'employee_code', 'department_name', 'position_title',
            'can_approve_attendance', 'can_create_employee', 'can_manage_attendance', 'can_manage_assets',
            'has_any_permission', 'permission_summary',
            'created_at', 'updated_at'
        ]


class EmployeePermissionCheckSerializer(serializers.Serializer):
    """Serializer để kiểm tra quyền hạn của nhân viên"""
    employee_id = serializers.IntegerField(required=True)
    
    # Quyền cần kiểm tra
    check_approve_attendance = serializers.BooleanField(default=False)
    check_create_employee = serializers.BooleanField(default=False)
    check_manage_attendance = serializers.BooleanField(default=False)
    check_manage_assets = serializers.BooleanField(default=False)
    check_approve_leave = serializers.BooleanField(default=False)
    check_approve_overtime = serializers.BooleanField(default=False)
    check_view_all_employees = serializers.BooleanField(default=False)
    check_manage_departments = serializers.BooleanField(default=False)
    check_manage_positions = serializers.BooleanField(default=False)
    
    # Kết quả kiểm tra
    has_permission = serializers.BooleanField(read_only=True)
    missing_permissions = serializers.ListField(read_only=True)
    permission_details = serializers.DictField(read_only=True)
    
    def validate(self, data):
        """
        Validate employee exists
        """
        employee_id = data.get('employee_id')
        try:
            employee = Employee.objects.get(id=employee_id)
            data['employee'] = employee
        except Employee.DoesNotExist:
            raise serializers.ValidationError(f"Employee with ID {employee_id} does not exist")
        
        return data
    
    def create(self, validated_data):
        """
        Check employee permissions
        """
        employee = validated_data.get('employee')
        
        # Get or create permission for employee
        permission, created = EmployeePermission.objects.get_or_create(employee=employee)
        
        # Check requested permissions
        permission_details = {}
        missing_permissions = []
        
        check_fields = [
            ('check_approve_attendance', 'can_approve_attendance', 'Phê duyệt công'),
            ('check_create_employee', 'can_create_employee', 'Tạo nhân viên'),
            ('check_manage_attendance', 'can_manage_attendance', 'Quản lý chấm công'),
            ('check_manage_assets', 'can_manage_assets', 'Quản lý tài sản'),
            ('check_approve_leave', 'can_approve_leave', 'Phê duyệt nghỉ phép'),
            ('check_approve_overtime', 'can_approve_overtime', 'Phê duyệt làm thêm giờ'),
            ('check_view_all_employees', 'can_view_all_employees', 'Xem tất cả nhân viên'),
            ('check_manage_departments', 'can_manage_departments', 'Quản lý phòng ban'),
            ('check_manage_positions', 'can_manage_positions', 'Quản lý vị trí'),
        ]
        
        has_all_permissions = True
        
        for check_field, permission_field, permission_name in check_fields:
            if validated_data.get(check_field, False):
                has_permission = getattr(permission, permission_field, False)
                permission_details[permission_field] = has_permission
                
                if not has_permission:
                    missing_permissions.append(permission_name)
                    has_all_permissions = False
        
        return {
            'has_permission': has_all_permissions,
            'missing_permissions': missing_permissions,
            'permission_details': permission_details,
            'employee': {
                'id': employee.id,
                'name': employee.full_name,
                'code': employee.employee_id
            }
        }
class SimpleUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name']


class SimpleDepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ['id', 'name', 'code']


class SimplePositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Position
        fields = ['id', 'title', 'code']


class SimpleEmployeeSerializer(serializers.ModelSerializer):
    email = serializers.CharField(source='personal_email', read_only=True)
    phone = serializers.CharField(source='phone_number', read_only=True)
    class Meta:
        model = Employee
        fields = ['id', 'employee_id', 'full_name', 'email', 'phone']


class OnboardingChecklistSerializer(serializers.ModelSerializer):
    """Serializer cho OnboardingChecklist"""
    completed_by_name = serializers.CharField(source='completed_by.full_name', read_only=True)
    
    class Meta:
        model = OnboardingChecklist
        fields = [
            'id', 'title', 'description', 'order',
            'is_completed', 'is_required',
            'completed_at', 'completed_by', 'completed_by_name'
        ]
        read_only_fields = ['completed_at']


class OnboardingTaskSerializer(serializers.ModelSerializer):
    """Serializer cho OnboardingTask"""
    checklist_items = OnboardingChecklistSerializer(many=True, read_only=True)
    assigned_to_name = serializers.CharField(source='assigned_to.full_name', read_only=True)
    days_until_deadline = serializers.IntegerField(read_only=True)
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingTask
        fields = [
            'id', 'name', 'description', 'task_type', 'task_code', 'order',
            'deadline', 'status', 'assigned_to', 'assigned_to_name',
            'completion_note', 'attachment', 'attachment_url',
            'started_at', 'completed_at', 'is_overdue', 'days_until_deadline',
            'checklist_items'
        ]
        read_only_fields = ['task_code', 'started_at', 'completed_at', 'is_overdue', 'days_until_deadline']

    def get_attachment_url(self, obj):
        if obj.attachment:
            return get_cloudfly_presigned_url(str(obj.attachment))
        return None


class OnboardingDocumentSerializer(serializers.ModelSerializer):
    """Serializer cho OnboardingDocument"""
    uploaded_by_name = serializers.SerializerMethodField()
    template_name = serializers.CharField(source='template_source.template_name', read_only=True)
    is_from_template = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    signature_file_url = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingDocument
        fields = [
            'id', 'document_name', 'document_type', 'description',
            'file', 'file_url', 'is_required', 'requires_signature',
            'is_read', 'is_signed', 'signed_at', 'signature_file', 'signature_file_url',
            'uploaded_at', 'uploaded_by', 'uploaded_by_name',
            'template_source', 'template_name', 'is_from_template',
        ]
        read_only_fields = ['uploaded_at', 'signed_at', 'is_from_template']

    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by:
            return obj.uploaded_by.full_name
        # Fallback: lấy tên người tạo template gốc
        if obj.template_source and obj.template_source.created_by:
            return obj.template_source.created_by.full_name
        return None

    def get_is_from_template(self, obj):
        """Kiểm tra document có được tạo từ template không"""
        return obj.template_source is not None

    def get_file_url(self, obj):
        if obj.file:
            return get_cloudfly_presigned_url(str(obj.file))
        return None

    def get_signature_file_url(self, obj):
        if obj.signature_file:
            return get_cloudfly_presigned_url(str(obj.signature_file))
        return None



class OnboardingProcessDetailSerializer(serializers.ModelSerializer):
    """Serializer chi tiết cho OnboardingProcess (detail view)"""
    position = SimplePositionSerializer(read_only=True)
    department = SimpleDepartmentSerializer(read_only=True)
    direct_manager = SimpleEmployeeSerializer(read_only=True)
    hr_responsible = SimpleEmployeeSerializer(read_only=True)
    employee = SimpleEmployeeSerializer(read_only=True)
    created_by = SimpleEmployeeSerializer(read_only=True)
    
    tasks = OnboardingTaskSerializer(many=True, read_only=True)
    documents = OnboardingDocumentSerializer(many=True, read_only=True)
    
    position_title = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    employee_id = serializers.SerializerMethodField()

    cv_file_url = serializers.SerializerMethodField()
    id_card_front_url = serializers.SerializerMethodField()
    id_card_back_url = serializers.SerializerMethodField()
    diploma_file_url = serializers.SerializerMethodField()
    citizen_id_file_url = serializers.SerializerMethodField()
    vneid_screenshot_url = serializers.SerializerMethodField()
    # Fields chỉ tồn tại trên Employee (không có trên OnboardingProcess) —
    # fallback chain: Employee → extra_info → None.
    facebook_link = serializers.SerializerMethodField()
    allowance = serializers.SerializerMethodField()
    work_type = serializers.SerializerMethodField()
    work_location = serializers.SerializerMethodField()
    sub_department = serializers.SerializerMethodField()
    team = serializers.SerializerMethodField()
    citizen_id_issue_date = serializers.SerializerMethodField()
    citizen_id_issue_place = serializers.SerializerMethodField()
    old_id_number = serializers.SerializerMethodField()
    probation_rate = serializers.SerializerMethodField()
    emergency_contact_name = serializers.SerializerMethodField()
    emergency_contact_relationship = serializers.SerializerMethodField()
    emergency_contact_phone = serializers.SerializerMethodField()
    emergency_contact_dob = serializers.SerializerMethodField()
    emergency_contact_occupation = serializers.SerializerMethodField()
    emergency_contact_address = serializers.SerializerMethodField()
    allowance_notes = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingProcess
        fields = [
            'id', 'onboarding_code', 'desired_employee_id',
            # Candidate info
            'candidate_name', 'candidate_email', 'candidate_phone',
            # Personal info
            'citizen_id', 'date_of_birth', 'gender',
            'permanent_address', 'current_address',
            'ethnicity', 'nationality',
            'birth_place', 'marital_status',
            'facebook_link',
            'citizen_id_issue_date', 'citizen_id_issue_place', 'old_id_number',
            # Education
            'education_level', 'university', 'major', 'graduation_year',
            # Job info
            'position', 'department', 'direct_manager',            'company_unit', 'rank', 'section', 'doctor_team',  # Explicitly include these fields
            'sub_department', 'team', 'work_type', 'work_location',
            'start_date', 'expected_end_date',
            'region', 'block', 'work_form',
            # Contract
            'contract_type', 'probation_period_months', 'probation_rate',
            'salary', 'salary_note', 'allowance', 'allowance_notes',
            # Emergency contact
            'emergency_contact_name', 'emergency_contact_relationship',
            'emergency_contact_phone', 'emergency_contact_dob',
            'emergency_contact_occupation', 'emergency_contact_address',
            # Banking
            'bank_name', 'bank_account', 'bank_branch', 'bank_account_holder',
            # Tax
            'tax_code', 'tax_dependents', 'social_insurance_number',
            # Status
            'status', 'progress_percentage',
            # HR
            'hr_responsible',
            # Files
            'cv_file', 'id_card_front', 'id_card_back', 'diploma_file', 'citizen_id_file',
            'cv_file_url', 'id_card_front_url', 'id_card_back_url', 'diploma_file_url', 'citizen_id_file_url',
            'vneid_screenshot_url',
            # Employee
            'employee', 'employee_id',
            # Tasks and Documents
            'tasks', 'documents',
            # System
            'notes', 'created_at', 'updated_at', 'completed_at', 'created_by',
            # Token
            'employee_token', 'token_expires_at', 'employee_info_completed', 'employee_info_completed_at',
            # Custom fields
            'position_title', 'department_name',
        ]
        read_only_fields = [
            'onboarding_code', 'progress_percentage',
            'created_at', 'updated_at', 'completed_at',
            'position_title', 'department_name', 'employee_id',
            'cv_file_url', 'id_card_front_url', 'id_card_back_url',
            'diploma_file_url', 'citizen_id_file_url', 'vneid_screenshot_url',
            'facebook_link', 'allowance', 'allowance_notes',
            'work_type', 'work_location', 'sub_department', 'team',
            'citizen_id_issue_date', 'citizen_id_issue_place', 'old_id_number',
            'probation_rate',
            'emergency_contact_name', 'emergency_contact_relationship',
            'emergency_contact_phone', 'emergency_contact_dob',
            'emergency_contact_occupation', 'emergency_contact_address',
        ]
    
    def get_position_title(self, obj):
        """Get position title from position object"""
        if obj.position:
            return obj.position.title
        return None
    
    def get_department_name(self, obj):
        """Get department name from department object"""
        if obj.department:
            return obj.department.name
        return None

    def get_employee_id(self, obj):
        """Get employee ID from linked employee record"""
        if obj.employee:
            return obj.employee.employee_id
        return obj.desired_employee_id or None

    def get_cv_file_url(self, obj):
        if obj.cv_file:
            return get_cloudfly_presigned_url(str(obj.cv_file))
        return None

    def get_id_card_front_url(self, obj):
        if obj.id_card_front:
            return get_cloudfly_presigned_url(str(obj.id_card_front))
        return None

    def get_id_card_back_url(self, obj):
        if obj.id_card_back:
            return get_cloudfly_presigned_url(str(obj.id_card_back))
        return None

    def get_diploma_file_url(self, obj):
        if obj.diploma_file:
            return get_cloudfly_presigned_url(str(obj.diploma_file))
        return None

    def get_citizen_id_file_url(self, obj):
        if obj.citizen_id_file:
            return get_cloudfly_presigned_url(str(obj.citizen_id_file))
        return None

    def get_vneid_screenshot_url(self, obj):
        # Ưu tiên Employee, fallback extra_info JSON (khi employee chưa link)
        key = None
        if obj.employee and obj.employee.vneid_screenshot:
            key = str(obj.employee.vneid_screenshot)
        elif obj.extra_info and obj.extra_info.get('vneid_screenshot'):
            key = str(obj.extra_info['vneid_screenshot'])
        if key:
            return get_cloudfly_presigned_url(key)
        return None

    # ── Helpers ─────────────────────────────────────────────────────────────
    # Khi obj.employee EXISTS → Employee là source of truth (kể cả khi field
    # = None, tức là admin vừa clear). KHÔNG fallback extra_info nữa, tránh
    # bug "clear field xong vẫn thấy giá trị cũ vì extra_info chưa được clear".
    # Khi obj.employee = None (NV stuck chưa link) → fallback extra_info.
    def _employee_or_extra(self, obj, employee_attr, extra_key):
        if obj.employee is not None:
            return getattr(obj.employee, employee_attr, None) or None
        return self._extra(obj, extra_key)

    def _extra(self, obj, key):
        return (obj.extra_info or {}).get(key) if obj.extra_info else None

    def get_facebook_link(self, obj):
        return self._employee_or_extra(obj, 'facebook_link', 'facebook_link')

    def get_allowance(self, obj):
        if obj.employee is not None:
            return float(obj.employee.allowance) if obj.employee.allowance is not None else None
        if obj.extra_info and obj.extra_info.get('allowance') is not None:
            try:
                return float(obj.extra_info['allowance'])
            except (TypeError, ValueError):
                return None
        return None

    def get_work_type(self, obj):
        return self._extra(obj, 'work_type') or None

    def get_work_location(self, obj):
        return self._employee_or_extra(obj, 'work_location', 'work_location')

    def get_sub_department(self, obj):
        return self._extra(obj, 'sub_department') or None

    def get_team(self, obj):
        return self._extra(obj, 'team') or None

    def get_citizen_id_issue_date(self, obj):
        if obj.employee is not None:
            return obj.employee.cccd_issue_date.isoformat() if obj.employee.cccd_issue_date else None
        return self._extra(obj, 'citizen_id_issue_date')

    def get_citizen_id_issue_place(self, obj):
        return self._employee_or_extra(obj, 'cccd_issue_place', 'citizen_id_issue_place')

    def get_old_id_number(self, obj):
        return self._employee_or_extra(obj, 'old_id_number', 'old_id_number')

    def get_probation_rate(self, obj):
        return self._employee_or_extra(obj, 'probation_rate', 'probation_rate')

    def get_emergency_contact_name(self, obj):
        return self._employee_or_extra(obj, 'emergency_contact_name', 'emergency_contact_name')

    def get_emergency_contact_relationship(self, obj):
        return self._employee_or_extra(obj, 'emergency_contact_relationship', 'emergency_contact_relationship')

    def get_emergency_contact_phone(self, obj):
        return self._employee_or_extra(obj, 'emergency_contact_phone', 'emergency_contact_phone')

    def get_emergency_contact_dob(self, obj):
        if obj.employee is not None:
            return obj.employee.emergency_contact_dob.isoformat() if obj.employee.emergency_contact_dob else None
        return self._extra(obj, 'emergency_contact_dob')

    def get_emergency_contact_occupation(self, obj):
        return self._employee_or_extra(obj, 'emergency_contact_occupation', 'emergency_contact_occupation')

    def get_emergency_contact_address(self, obj):
        return self._employee_or_extra(obj, 'emergency_contact_address', 'emergency_contact_address')

    def get_allowance_notes(self, obj):
        return self._extra(obj, 'allowance_notes')

class OnboardingProcessCreateSerializer(serializers.ModelSerializer):
    """Serializer để tạo OnboardingProcess - Hỗ trợ cả frontend và admin"""
    # Accept both frontend and backend field names
    full_name = serializers.CharField(write_only=True, required=False)
    position_title = serializers.CharField(write_only=True, required=False)
    employee_id = serializers.CharField(write_only=True, required=False)
    # Frontend currently sends "M/F/O" but model expects "MALE/FEMALE/OTHER"
    gender = serializers.CharField(write_only=True, required=False, allow_blank=True)
    
    # ===== THÊM CÁC FIELD MỚI CHO EMPLOYEE SELF-SERVICE =====
    # Thông tin cơ bản
    facebook_link = serializers.URLField(write_only=True, required=False, allow_blank=True)
    
    # Thông tin công việc
    REGION_CHOICES = [
        ("Miền Bắc", "Miền Bắc"),
        ("Miền Nam", "Miền Nam"),
    ]
    BLOCK_CHOICES = [
        ("Khối Back office", "Khối Back office"),
        ("Khối Marketing", "Khối Marketing"),
        ("Khối Kinh doanh", "Khối Kinh doanh"),
    ]
    SUB_DEPARTMENT_CHOICES = [
        ("ADS", "ADS"),
        ("ADS2", "ADS2"),
        ("KD 1", "KD 1"),
        ("KD 2", "KD 2"),
        ("KD 3", "KD 3"),
        ("KD 4", "KD 4"),
        ("KD MN", "KD MN"),
        ("CSKH MB", "CSKH MB"),
        ("CSKH MN", "CSKH MN"),
        ("Media MB", "Media MB"),
        ("Media MN", "Media MN"),
        ("Media", "Media"),
        ("Giám sát nội bộ", "Giám sát nội bộ"),
        ("HCNS", "HCNS"),
        ("Kế toán", "Kế toán"),
        ("Truyền thông", "Truyền thông"),
        ("TTTH 01", "TTTH 01"),
        ("TTTH 02", "TTTH 02"),
        ("TTTH 03", "TTTH 03"),
        ("TTTH 04", "TTTH 04"),
        ("TTTH 06", "TTTH 06"),
        ("Xây group", "Xây group"),
        ("TTTH 08", "TTTH 08"),
        ("TTTH 05", "TTTH 05"),
        ("TTTH 07", "TTTH 07"),
        ("TTTH 09", "TTTH 09"),
        ("TTTH 10", "TTTH 10"),
        ("TTTH 11", "TTTH 11"),
        ("Tiktok 1", "Tiktok 1"),
        ("Tiktok 2", "Tiktok 2"),
        ("Tiktok 3", "Tiktok 3"),
        ("Tiktok 5", "Tiktok 5"),
        ("TTTH 15", "TTTH 15"),
        ("Pháp chế", "Pháp chế"),
        ("Tiktok 4", "Tiktok 4"),
        ("KD 5", "KD 5"),
        ("Mua hàng", "Mua hàng"),
        ("IT", "IT"),
        ("AI", "AI"),
        ("Công nghệ thông tin", "Công nghệ thông tin"),
        ("Tiktok 6", "Tiktok 6"),
        ("Tiktok 7", "Tiktok 7"),
        ("Tiktok 8", "Tiktok 8"),
        ("Tiktok 9", "Tiktok 9"),
        ("Tiktok 10", "Tiktok 10"),
    ]
    SECTION_CHOICES = [
        ("ADS", "ADS"),
        ("BENH_VIEN_HA_THANH", "Bệnh viện Hà Thành"),
        ("BENH_VIEN_30_4", "Bệnh viện 30/4"),
        ("BENH_VIEN_AN_VIET", "Bệnh viện An Việt"),
        ("BENH_VIEN_HONG_HA", "Bệnh viện Hồng Hà"),
        ("BENH_VIEN_TAN_HUNG", "Bệnh Viện Tân Hưng"),
        ("BENH_VIEN_SAO_HAN", "Bệnh viện Sao Hàn"),
        ("BENH_VIEN_VAN_HANH", "Bệnh viện Vạn Hạnh"),
        ("CHECK_PAGE", "Check page"),
        ("XAY_GROUP", "Xây Group"),
        ("TIKTOK", "Tiktok"),
        ("GIAM_SAT_CHAT_LUONG", "Giám sát chất lượng"),
        ("GIAM_SAT_NOI_BO", "Giám sát nội bộ"),
        ("MEDIA", "Media"),
        ("NOI_DUNG_01", "Nội dung 01"),
        ("PHONG_HCNS", "Phòng HCNS"),
        ("PHONG_KE_TOAN", "Phòng kế toán"),
        ("PHONG_TTTH", "Phòng TTTH"),
        ("KINH_DOANH_VP_MIEN_BAC", "Kinh doanh - VP miền Bắc"),
        ("KINH_DOANH_VP_MIEN_NAM", "Kinh doanh - VP miền Nam"),
        ("PHAP_CHE", "Pháp chế"),
        ("MUA_HANG", "Mua hàng"),
        ("BO_PHAN_IT", "Bộ phận IT"),
        ("BO_PHAN_AI", "Bộ phận AI"),
    ]
    WORK_FORM_CHOICES = [
        ("FULL_TIME", "Full-time"),
        ("PART_TIME", "Part-time"),
    ]

    region = serializers.CharField(write_only=True, required=False, allow_blank=True)
    block = serializers.CharField(write_only=True, required=False, allow_blank=True)
    sub_department = serializers.CharField(write_only=True, required=False, allow_blank=True)
    section = serializers.CharField(write_only=True, required=False, allow_blank=True)
    team = serializers.CharField(write_only=True, required=False, allow_blank=True)
    rank = serializers.CharField(write_only=True, required=False, allow_blank=True)
    doctor_team = serializers.CharField(write_only=True, required=False, allow_blank=True)
    # work_form maps directly to Employee.work_form (enum), work_type is free-text note
    work_form = serializers.ChoiceField(
        choices=WORK_FORM_CHOICES,
        write_only=True,
        required=False,
        allow_blank=True,
    )
    work_type = serializers.CharField(write_only=True, required=False, allow_blank=True)
    work_location = serializers.CharField(write_only=True, required=False, allow_blank=True)
    
    # CCCD
    citizen_id_file = serializers.FileField(write_only=True, required=False, allow_null=True)
    # Ảnh VNEID — lưu vào Employee.vneid_screenshot (employee.models)
    vneid_screenshot = serializers.ImageField(write_only=True, required=False, allow_null=True)
    citizen_id_issue_date = serializers.DateField(write_only=True, required=False, allow_null=True)
    citizen_id_issue_place = serializers.CharField(write_only=True, required=False, allow_blank=True)
    old_id_number = serializers.CharField(write_only=True, required=False, allow_blank=True)
    
    # Địa chỉ
    current_address = serializers.CharField(write_only=True, required=False, allow_blank=True)
    
    # BHXH/Thuế
    social_insurance_number = serializers.CharField(write_only=True, required=False, allow_blank=True)
    
    # Hôn nhân
    marital_status = serializers.ChoiceField(
        choices=['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'],
        write_only=True, 
        required=False, 
        allow_blank=True
    )
    
    # Người liên hệ khẩn cấp
    emergency_contact_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    emergency_contact_relationship = serializers.CharField(write_only=True, required=False, allow_blank=True)
    emergency_contact_phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
    emergency_contact_dob = serializers.DateField(write_only=True, required=False, allow_null=True)
    emergency_contact_occupation = serializers.CharField(write_only=True, required=False, allow_blank=True)
    emergency_contact_address = serializers.CharField(write_only=True, required=False, allow_blank=True)
    
    # Lương
    allowance = serializers.DecimalField(max_digits=15, decimal_places=2, write_only=True, required=False, allow_null=True)
    
    direct_manager_id = serializers.PrimaryKeyRelatedField(queryset=Employee.objects.all(), source='direct_manager', write_only=True, required=False, allow_null=True,
)
    class Meta:
        model = OnboardingProcess
        fields = [
            # Frontend fields
            'full_name', 'position_title', 'start_date',
            'employee_id',
            # Backend fields
            'candidate_name', 'candidate_email', 'candidate_phone',
            'citizen_id', 'date_of_birth', 'gender',
            'permanent_address', 'current_address',
            'education_level', 'university', 'major', 'graduation_year',
            'position', 'department', 'direct_manager', 'direct_manager_id',
            'contract_type', 'probation_period_months',
            'salary', 'salary_note',
            'bank_name', 'bank_account', 'bank_branch', 'bank_account_holder',
            'tax_code', 'tax_dependents',
            'hr_responsible', 'notes',
            'cv_file', 'id_card_front', 'id_card_back', 'diploma_file',
            'desired_employee_id',
            # ===== FIELD MỚI =====
            'facebook_link', 'company_unit', 'region', 'block', 'sub_department', 'section', 'team',
            'rank', 'doctor_team', 'birth_place', 'work_form', 'work_type', 'work_location',
            'citizen_id_file', 'vneid_screenshot', 'citizen_id_issue_date', 'citizen_id_issue_place', 'old_id_number',
            'social_insurance_number', 'marital_status',
            'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone',
            'emergency_contact_dob', 'emergency_contact_occupation', 'emergency_contact_address',
            'allowance',
        ]
        extra_kwargs = {
            'candidate_name': {'required': False},
            'candidate_email': {'required': False},
        }
    
    def validate_citizen_id_file(self, value):
        """Validate CCCD file - must be PDF, max 5MB"""
        if value:
            # Check file extension
            if not value.name.lower().endswith('.pdf'):
                raise serializers.ValidationError("File CCCD phải là định dạng PDF")
            
            # Check file size (5MB = 5 * 1024 * 1024 bytes)
            if value.size > 5 * 1024 * 1024:
                raise serializers.ValidationError("File CCCD không được vượt quá 5MB")
        
        return value
    
    def validate_vneid_screenshot(self, value):
        """Ảnh VNEID — giới hạn theo ALLOWED_IMAGE_TYPES và dung lượng."""
        if value:
            from django.conf import settings as dj_settings
            allowed = getattr(dj_settings, 'ALLOWED_IMAGE_TYPES', [])
            ct = getattr(value, 'content_type', '') or ''
            if allowed and ct and ct not in allowed:
                raise serializers.ValidationError(
                    f'Định dạng ảnh không hợp lệ. Cho phép: {", ".join(allowed)}'
                )
            max_mb = 10
            if value.size > max_mb * 1024 * 1024:
                raise serializers.ValidationError(f'Ảnh VNEID không được vượt quá {max_mb}MB')
        return value
    
    def validate(self, attrs):
        """Validate và convert frontend fields sang backend fields"""
        # Map full_name -> candidate_name
        if 'full_name' in attrs and not attrs.get('candidate_name'):
            attrs['candidate_name'] = attrs.pop('full_name')
        elif 'full_name' in attrs:
            attrs.pop('full_name')
        
        # Map position_title -> position (tìm position object)
        if 'position_title' in attrs:
            position_title = attrs.pop('position_title')
            if not attrs.get('position'):
                from employee.models import Position
                try:
                    position = Position.objects.filter(title__icontains=position_title).first()
                    if position:
                        attrs['position'] = position
                except Position.DoesNotExist:
                    pass
        
        # Map employee_id -> desired_employee_id
        if 'employee_id' in attrs:
            attrs['desired_employee_id'] = attrs.pop('employee_id')

        company_unit_raw = attrs.get('company_unit')
        if company_unit_raw not in (None, ''):
            resolved_company_unit = Employee.resolve_company_unit(company_unit_raw)
            if not resolved_company_unit:
                raise serializers.ValidationError({'company_unit': 'Đơn vị làm việc không hợp lệ.'})
            attrs['company_unit'] = resolved_company_unit.code
            attrs['_resolved_company_unit'] = resolved_company_unit

        candidate_email = attrs.get('candidate_email')
        if candidate_email:
            existing = Employee.objects.filter(personal_email=candidate_email).first()
            if existing:
                if existing.employment_status == 'ACTIVE':
                    raise serializers.ValidationError({
                        f'Email này đã được sử dụng bởi nhân viên đang làm việc ({existing.full_name} - {existing.employee_id}).'
                    })
                elif existing.employment_status == 'INACTIVE':
                    attrs['_reactivate_employee'] = existing  # pass sang create()
        return attrs

    def validate_gender(self, value):
        """
        Accept both onboarding model values (MALE/FEMALE/OTHER) and short values (M/F/O).
        Normalize to onboarding model values so ModelSerializer doesn't reject input.
        """
        if value is None:
            return ''
        v = str(value).strip()
        if v == '':
            return ''
        v_upper = v.upper()

        if v_upper in ('M', 'MALE'):
            return 'MALE'
        if v_upper in ('F', 'FEMALE'):
            return 'FEMALE'
        if v_upper in ('O', 'OTHER'):
            return 'OTHER'

        raise serializers.ValidationError(f'"{value}" is not a valid choice.')
    
    def create(self, validated_data):
        """Override create để tự động tạo Employee và tasks"""
        from django.contrib.auth.models import User
        from employee.models import Department, Position  # ← THÊM import này
        import logging
        import json
        import re
        from dateutil.relativedelta import relativedelta
        
        logger = logging.getLogger(__name__)
        resolved_company_unit = validated_data.pop('_resolved_company_unit', None)
        
        # ===== EXTRACT CÁC FIELD MỚI =====
        direct_manager = validated_data.get('direct_manager')
        facebook_link = validated_data.pop('facebook_link', '')
        region = validated_data.pop('region', '')
        block = validated_data.pop('block', '')
        sub_department = validated_data.pop('sub_department', '')
        team = validated_data.pop('team', '')
        rank = validated_data.get('rank', '')
        section = validated_data.get('section', '')
        doctor_team = validated_data.get('doctor_team', '')
        work_form = validated_data.pop('work_form', '')
        work_type = validated_data.pop('work_type', '')
        work_location = validated_data.pop('work_location', '')
        
        citizen_id_file = validated_data.pop('citizen_id_file', None)
        vneid_screenshot_file = validated_data.pop('vneid_screenshot', None)
        vneid_screenshot_key = None
        if vneid_screenshot_file:
            try:
                vneid_screenshot_key = upload_file_to_cloudfly(vneid_screenshot_file, 'vneid_screenshots')
            except Exception as e:
                logger.error(f"Failed to upload vneid_screenshot: {str(e)}")
        citizen_id_issue_date = validated_data.pop('citizen_id_issue_date', None)
        citizen_id_issue_place = validated_data.pop('citizen_id_issue_place', '')
        old_id_number = validated_data.pop('old_id_number', '')
        
        current_address = validated_data.pop('current_address', '')
        social_insurance_number = validated_data.pop('social_insurance_number', '')
        marital_status = validated_data.pop('marital_status', '')
        
        emergency_contact_name = validated_data.pop('emergency_contact_name', '')
        emergency_contact_relationship = validated_data.pop('emergency_contact_relationship', '')
        emergency_contact_phone = validated_data.pop('emergency_contact_phone', '')
        emergency_contact_dob = validated_data.pop('emergency_contact_dob', None)
        emergency_contact_occupation = validated_data.pop('emergency_contact_occupation', '')
        emergency_contact_address = validated_data.pop('emergency_contact_address', '')
        
        allowance_notes = validated_data.pop('allowance_notes', None)                
        # ===== ✅ MỚI: TỰ ĐỘNG TẠO DEPARTMENT VÀ POSITION =====
        
        # 1. Tạo/lấy Department từ sub_department
        if sub_department and not validated_data.get('department'):
            try:
                department, created = Department.objects.get_or_create(
                    name=sub_department,
                    defaults={
                        'code': sub_department.upper().replace(' ', '_')[:64],
                        'description': f'Phòng/Ban {sub_department} (tự động tạo từ onboarding)'
                    }
                )
                validated_data['department'] = department
                logger.info(f"{'Created' if created else 'Found'} department: {department.name} (ID: {department.id})")
            except Exception as e:
                logger.error(f"Failed to create department from sub_department '{sub_department}': {str(e)}")
        
        # 2. Tạo/lấy Position từ rank
        if rank and not validated_data.get('position'):
            try:
                position, created = Position.objects.get_or_create(
                    title=rank,
                    defaults={
                        'code': rank.upper().replace(' ', '_')[:64],
                        'description': f'Vị trí {rank} (tự động tạo từ onboarding)',
                        'department': validated_data.get('department'),
                        'level': 1,
                    }
                )
                validated_data['position'] = position
                logger.info(f"{'Created' if created else 'Found'} position: {position.title} (ID: {position.id})")
            except Exception as e:
                logger.error(f"Failed to create position from rank '{rank}': {str(e)}")
        
        # Lấy user từ request context
        request = self.context.get('request')
        if request and hasattr(request, 'user'):
            try:
                employee = Employee.objects.get(user=request.user)
                validated_data['created_by'] = employee
            except Employee.DoesNotExist:
                pass
        
        # ===== BƯỚC 1: TẠO EMPLOYEE TỰ ĐỘNG =====
        candidate_email = validated_data.get('candidate_email')
        candidate_name = validated_data.get('candidate_name', '')
        desired_employee_id = validated_data.get('desired_employee_id', '')
        
        new_employee = None
        reactivate_employee = validated_data.pop('_reactivate_employee', None)

        if reactivate_employee:
            # ===== TÁI KÍCH HOẠT NHÂN VIÊN CŨ =====
            new_employee = reactivate_employee
            default_password = self.generate_default_password(new_employee.employee_id)
            
            # Reset password
            new_employee.user.set_password(default_password)
            new_employee.user.save()
            
            # Cập nhật thông tin mới
            new_employee.employment_status = 'ACTIVE'
            new_employee.is_active = True
            new_employee.start_date = validated_data.get('start_date')
            new_employee.end_date = None
            new_employee.termination_reason = None
            new_employee.department = validated_data.get('department') or new_employee.department
            new_employee.position = validated_data.get('position') or new_employee.position
            new_employee.basic_salary = validated_data.get('salary') or new_employee.basic_salary
            new_employee.contract_type = validated_data.get('contract_type', 'PROBATION')
            new_employee.probation_months = validated_data.get('probation_period_months', 2)
            new_employee.rank = rank or new_employee.rank
            new_employee.region = region or new_employee.region
            new_employee.block = block or new_employee.block
            new_employee.work_form = work_form or new_employee.work_form
            new_employee.work_location = work_location or new_employee.work_location
            new_employee.manager = direct_manager or new_employee.manager
            if resolved_company_unit:
                new_employee.company_unit = resolved_company_unit
            if vneid_screenshot_key:
                new_employee.vneid_screenshot = vneid_screenshot_key
            new_employee.save()
            # Lấy thông tin cũ của nhân viên để điền vào onboarding
            if not validated_data.get('position'):
                validated_data['position'] = new_employee.position
            if not validated_data.get('department'):
                validated_data['department'] = new_employee.department
            if not validated_data.get('direct_manager'):
                validated_data['direct_manager'] = new_employee.manager
            if not validated_data.get('salary'):
                validated_data['salary'] = new_employee.basic_salary
            if not validated_data.get('candidate_phone'):
                validated_data['candidate_phone'] = new_employee.phone_number
            logger.info(f"Reactivated employee: {new_employee.employee_id}")
        elif candidate_email:
            try:
                existing_employee = Employee.objects.filter(personal_email=candidate_email).first()
                if existing_employee:
                    logger.warning(f"Employee with email {candidate_email} already exists: {existing_employee.employee_id}")
                    new_employee = existing_employee
                    if vneid_screenshot_key:
                        new_employee.vneid_screenshot = vneid_screenshot_key
                        new_employee.save(update_fields=['vneid_screenshot'])
                else:
                    # ⚠️ FIX: toàn bộ khối tạo User + Employee bên dưới BẮT BUỘC atomic.
                    # Trước đây user = User.objects.create_user(...) chạy ngoài transaction —
                    # nếu bất kỳ bước nào sau đó (build extra_info, tạo Employee, IntegrityError
                    # do trùng employee_id vì generate_next_employee_id không lock DB...) ném lỗi,
                    # User đã tạo bị mồ côi vĩnh viễn (còn trong bảng User, không có Employee),
                    # còn except ngoài cùng chỉ log rồi NUỐT lỗi → OnboardingProcess vẫn được tạo
                    # thiếu employee, email chào mừng không gửi (vì new_employee=None ở bước 2).
                    # Bọc atomic() để bất kỳ lỗi nào ở đây tự rollback sạch User vừa tạo, không
                    # còn cần user.delete() thủ công (gọi delete() sau khi atomic block đã lỗi
                    # sẽ tự ném TransactionManagementError).
                    with transaction.atomic():
                        # Tạo/xác định employee_id
                        if desired_employee_id:
                            employee_id = desired_employee_id
                        else:
                            employee_id = self.generate_next_employee_id(
                                company_unit=resolved_company_unit or validated_data.get('company_unit')
                            )

                        logger.info(f"Using employee_id: {employee_id}")

                        # Username = employee_id (UPPERCASE) — đồng bộ với bulk import
                        # ở employee/import_serializers.py:861. Trước đây dùng .lower()
                        # khiến NV tạo qua onboarding có username taxxxxx, login bằng
                        # TAxxxxx (quy ước cũ) bị fail.
                        username = employee_id
                        default_password = self.generate_default_password(employee_id)

                        user = User.objects.create_user(
                            username=username,
                            email=candidate_email,
                            first_name=candidate_name.split()[-1] if candidate_name else '',
                            last_name=' '.join(candidate_name.split()[:-1]) if candidate_name else '',
                            password=default_password
                        )
                        logger.info(f"Created user account: {username} with auto-generated password")
                        # Chuẩn bị extra_info
                        extra_info = {}
                        if validated_data.get('citizen_id'):
                            extra_info['citizen_id'] = validated_data.get('citizen_id')
                        if validated_data.get('university'):
                            extra_info['university'] = validated_data.get('university')
                        if validated_data.get('major'):
                            extra_info['major'] = validated_data.get('major')
                        if validated_data.get('graduation_year'):
                            extra_info['graduation_year'] = validated_data.get('graduation_year')

                        # ✅ Lưu các field bổ sung vào extra_info (những field không có column riêng)
                        if facebook_link:
                            extra_info['facebook_link'] = facebook_link
                        if team:
                            extra_info['team'] = team
                        if work_type:
                            extra_info['work_type'] = work_type
                        if citizen_id_issue_date:
                            extra_info['citizen_id_issue_date'] = str(citizen_id_issue_date)
                        if citizen_id_issue_place:
                            extra_info['citizen_id_issue_place'] = citizen_id_issue_place
                        if old_id_number:
                            extra_info['old_id_number'] = old_id_number
                        if emergency_contact_name:
                            extra_info['emergency_contact'] = {
                                'name': emergency_contact_name,
                                'relationship': emergency_contact_relationship,
                                'phone': emergency_contact_phone,
                                'dob': str(emergency_contact_dob) if emergency_contact_dob else '',
                                'occupation': emergency_contact_occupation,
                                'address': emergency_contact_address,
                            }
                        if allowance_notes:
                            extra_info['allowance_notes'] = allowance_notes

                        # Map gender
                        employee_gender = {
                            'MALE': 'M',
                            'FEMALE': 'F',
                            'OTHER': 'O',
                        }.get(validated_data.get('gender', ''), '')

                        # Map education_level
                        education_label = (validated_data.get('education_level') or '').strip()
                        education_map = {
                            'Thạc sĩ': 'MASTER',
                            'Cử nhân đại học': 'BACHELOR',
                            'Cử nhân cao đẳng': 'ASSOCIATE',
                            'Trung cấp': 'HIGH_SCHOOL',
                            'Khác': 'OTHER',
                        }
                        employee_education_level = education_map.get(education_label) if education_label else None

                        # ✅ FIX: section chỉ lấy từ field section, KHÔNG fallback sub_department
                        section_value = section or None

                        # ✅ TẠO EMPLOYEE VỚI TẤT CẢ CÁC FIELD
                        new_employee = Employee.objects.create(
                            user=user,
                            employee_id=employee_id,
                            full_name=candidate_name,
                            company_unit=resolved_company_unit,
                            personal_email=candidate_email,
                            phone_number=validated_data.get('candidate_phone', ''),
                            position=validated_data.get('position'),  # ← Đã được tạo tự động
                            department=validated_data.get('department'),  # ← Đã được tạo tự động
                            date_of_birth=validated_data.get('date_of_birth'),
                            gender=employee_gender,
                            manager=direct_manager,
                            # ✅ CÁC FIELD THÔNG TIN CÔNG VIỆC
                            region=region or None,
                            block=block or None,
                            section=section_value,  # Bộ phận (Da liễu, Phẫu thuật thẩm mỹ)
                            rank=rank or None,  # Cấp bậc (Nhân viên, Trưởng phòng...)
                            work_form=work_form or None,  # FULL_TIME/PART_TIME
                            work_location=work_location or None,
                            doctor_team=doctor_team or None,
                            education_level=employee_education_level,
                            facebook_link=facebook_link or None,

                            # ✅ ĐỊA CHỈ
                            permanent_residence=validated_data.get('permanent_address', ''),
                            current_address=current_address or None,

                            # ✅ BHXH & THUẾ
                            social_insurance_number=social_insurance_number or None,
                            tax_code=validated_data.get('tax_code') or None,

                            # ✅ HÔN NHÂN
                            marital_status=marital_status or None,

                            # ✅ NGƯỜI LIÊN HỆ KHẨN CẤP
                            emergency_contact_name=emergency_contact_name or None,
                            emergency_contact_relationship=emergency_contact_relationship or None,
                            emergency_contact_phone=emergency_contact_phone or None,
                            emergency_contact_dob=emergency_contact_dob,
                            emergency_contact_occupation=emergency_contact_occupation or None,
                            emergency_contact_address=emergency_contact_address or None,

                            # ✅ CCCD
                            cccd_number=validated_data.get('citizen_id', ''),
                            old_id_number=old_id_number or None,
                            cccd_issue_date=citizen_id_issue_date,
                            cccd_issue_place=citizen_id_issue_place or '',

                            # ✅ LƯƠNG & HỢP ĐỒNG
                            bank_name=validated_data.get('bank_name', ''),
                            bank_account=validated_data.get('bank_account', ''),
                            bank_branch=validated_data.get('bank_branch', ''),
                            start_date=validated_data.get('start_date'),
                            basic_salary=validated_data.get('salary'),
                            allowance_notes=allowance_notes or None,
                            contract_type=validated_data.get('contract_type', 'PROBATION'),
                            probation_months=validated_data.get('probation_period_months', 2),
                            employment_status='ACTIVE',

                            # JSON extra_info
                            extra_info=json.dumps(extra_info, ensure_ascii=False) if extra_info else '',
                            vneid_screenshot=vneid_screenshot_key or None,
                        )

                        logger.info(f"Created employee: {new_employee.employee_id}")
                        logger.info(f"  - Department: {new_employee.department.name if new_employee.department else 'None'}")
                        logger.info(f"  - Position: {new_employee.position.title if new_employee.position else 'None'}")
                        logger.info(f"  - Region: {new_employee.region or 'None'}")
                        logger.info(f"  - Block: {new_employee.block or 'None'}")
                        logger.info(f"  - Section: {new_employee.section or 'None'}")
                        logger.info(f"  - Rank: {new_employee.rank or 'None'}")
                        logger.info(f"  - Emergency Contact: {new_employee.emergency_contact_name or 'None'}")
                        # self.send_welcome_email(user, default_password, new_employee)
                        # Tính probation_end_date — không critical, lỗi ở đây không nên rollback
                        # cả Employee vừa tạo, nên vẫn giữ try/except riêng (không phá atomic).
                        if new_employee.contract_type in PROBATION_CONTRACT_TYPES and new_employee.start_date:
                            try:
                                new_employee.probation_months = probation_months_for(
                                    new_employee.contract_type, new_employee.probation_months)
                                new_employee.probation_end_date = calculate_probation_end_date(
                                    new_employee.start_date,
                                    new_employee.probation_months,
                                )
                                new_employee.official_start_date = calculate_official_start_date(
                                    new_employee.probation_end_date
                                )
                                new_employee.save()
                                logger.info(f"Set probation_end_date: {new_employee.probation_end_date}")
                            except Exception as e:
                                logger.warning(f"Failed to calculate probation_end_date: {str(e)}")

            except Exception as e:
                # ⚠️ FIX: KHÔNG được nuốt lỗi ở đây nữa. Trước đây chỉ log rồi để code chạy
                # tiếp xuống BƯỚC 2 tạo OnboardingProcess với new_employee=None — tạo ra đúng
                # tình trạng "onboarding không có nhân viên, không gửi được mail chào mừng".
                # Giờ raise thẳng để toàn bộ request tạo onboarding fail rõ ràng, HR biết ngay
                # để thử lại thay vì âm thầm ra 1 bản ghi hỏng.
                logger.error(f"Failed to create employee during onboarding: {str(e)}")
                raise serializers.ValidationError({
                    'candidate_email': f'Không thể tạo tài khoản nhân viên tự động: {str(e)}. Vui lòng thử lại.'
                })
        else:
            logger.warning(f"No candidate_email provided, skipping employee creation")
        
        # ===== BƯỚC 2: TẠO ONBOARDING PROCESS =====
        if new_employee:
            validated_data['employee'] = new_employee
            if 'progress' in validated_data:
                validated_data.pop('progress')
            
        onboarding = OnboardingProcess.objects.create(**validated_data)
        logger.info(f"Created onboarding process: {onboarding.onboarding_code}")
        logger.info(f"  - Linked department: {onboarding.department.name if onboarding.department else 'None'}")
        logger.info(f"  - Linked position: {onboarding.position.title if onboarding.position else 'None'}")
        if onboarding and new_employee:
            try:
                # Generate token
                token = onboarding.generate_employee_token()
                logger.info(f"Generated token for onboarding {onboarding.onboarding_code}")
                
                # Gửi email với link onboarding
                self.send_welcome_email(
                    user=new_employee.user,
                    password=default_password,
                    employee=new_employee,
                    onboarding=onboarding,
                    token=token
                )
            except Exception as e:
                logger.error(f"Failed to generate token or send email: {str(e)}")
        # ===== LƯU CITIZEN_ID_FILE NẾU CÓ =====
        if citizen_id_file and onboarding:
            try:
                from .models import OnboardingDocument
                s3_key = upload_file_to_cloudfly(citizen_id_file, 'onboarding/documents')
                # Lưu S3 key trực tiếp vào field citizen_id_file của OnboardingProcess
                onboarding.citizen_id_file = s3_key
                onboarding.save(update_fields=['citizen_id_file'])
                OnboardingDocument.objects.create(
                    onboarding_process=onboarding,
                    document_name='CCCD (2 mặt)',
                    document_type='OTHER',
                    description='File CCCD 2 mặt được upload bởi nhân viên',
                    file=s3_key,
                    is_required=True,
                    uploaded_by=validated_data.get('created_by')
                )
                logger.info(f"Saved citizen_id_file for onboarding {onboarding.onboarding_code}")
            except Exception as e:
                logger.error(f"Failed to save citizen_id_file: {str(e)}")
        return onboarding

    def update(self, instance, validated_data):
        """
        PATCH/partial update: các field chỉ lưu Employee hoặc upload file phải pop trước khi ghi OnboardingProcess.
        """
        import logging
        from .models import OnboardingDocument

        logger = logging.getLogger(__name__)

        vneid_screenshot_file = validated_data.pop('vneid_screenshot', None)
        citizen_id_file = validated_data.pop('citizen_id_file', None)

        for _k in (
            'facebook_link', 'sub_department', 'team', 'work_type', 'work_location',
            'citizen_id_issue_date', 'citizen_id_issue_place', 'old_id_number',
            'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone',
            'emergency_contact_dob', 'emergency_contact_occupation', 'emergency_contact_address',
            'allowance', 'full_name', 'position_title', 'employee_id',
        ):
            validated_data.pop(_k, None)

        onboarding = super().update(instance, validated_data)

        if vneid_screenshot_file and onboarding.employee:
            try:
                key = upload_file_to_cloudfly(vneid_screenshot_file, 'vneid_screenshots')
                onboarding.employee.vneid_screenshot = key
                onboarding.employee.save(update_fields=['vneid_screenshot'])
            except Exception as e:
                logger.error(f"Failed to upload vneid_screenshot on onboarding update: {str(e)}")

        if citizen_id_file:
            try:
                s3_key = upload_file_to_cloudfly(citizen_id_file, 'onboarding/documents')
                onboarding.citizen_id_file = s3_key
                onboarding.save(update_fields=['citizen_id_file'])
                OnboardingDocument.objects.create(
                    onboarding_process=onboarding,
                    document_name='CCCD (2 mặt)',
                    document_type='OTHER',
                    description='File CCCD 2 mặt được upload bởi nhân viên',
                    file=s3_key,
                    is_required=True,
                    uploaded_by=None,
                )
                logger.info(f"Saved citizen_id_file for onboarding {onboarding.onboarding_code} (update)")
            except Exception as e:
                logger.error(f"Failed to save citizen_id_file on update: {str(e)}")

        return onboarding

    def generate_next_employee_id(self, company_unit=None):
        import logging
        logger = logging.getLogger(__name__)

        try:
            new_employee_id = Employee.generate_next_employee_id(company_unit=company_unit)
            logger.info(f"Generated new employee_id: {new_employee_id}")
            return new_employee_id

        except Exception as e:
            logger.error(f"Failed to generate employee_id: {str(e)}")
            return Employee.generate_next_employee_id()

    def generate_default_password(self, employee_id):
        """Mật khẩu mặc định: <DEFAULT_PASSWORD_PREFIX>@ + 5 số cuối mã nhân viên."""
        return branding.default_password(employee_id)

    def send_welcome_email(self, user, password, employee=None, onboarding=None, token=None):
        import logging
        from django.conf import settings
        from .utils import send_email_via_gmail
        
        logger = logging.getLogger(__name__)
        
        try:
            subject = "Thư chào mừng nhân viên mới"
            
            full_name = employee.full_name if employee else get_user_display_name(user)
            
            onboarding_link = ""
            if onboarding and token:
                domain = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')
                onboarding_link = f"{domain}/onboarding/employee-form/{token}"


            html_message = f"""
    <!DOCTYPE html> 
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; font-size: 14px; color: #333; margin: 0; padding: 0;">

    <table style="width: 100%; max-width: 600px; border-collapse: collapse;">
        <!-- Banner -->
        <tr>
        <td style="padding: 0;">
            {branding.email_banner_html()}
        </td>
        </tr>

        <!-- Content -->
        <tr>
        <td style="padding: 24px;">
            <p style="margin: 0 0 12px;">Dear <strong>{full_name}</strong>,</p>
            <p style="margin: 0 0 12px;">Chúng tôi rất vui mừng chào đón bạn đến với công ty, công ty rất tự hào vì có Bạn trên hành trình cùng nhau phát triển.</p>
            <p style="margin: 0 0 12px;">Chúng tôi tin rằng <strong>"Con người"</strong> là một trong những yếu tố quan trọng nhất trong cam kết giá trị dịch vụ 5 sao của công ty.</p>
            <p style="margin: 0 0 12px;">Chúng tôi sẽ luôn đồng hành cùng Bạn trong suốt quá trình làm việc.</p>
            <p style="margin: 0 0 12px;">Thời gian bắt đầu luôn là khoảng thời gian quan trọng, để hỗ trợ bạn tốt nhất Phòng Hành chính Nhân sự thân gửi bạn những thông tin sau:</p>

            <p style="color: #1a73e8; font-weight: bold; margin: 16px 0 8px;">1. Username / Password</p>
            <p style="margin: 0 0 8px;">Dùng để đăng nhập website HRM của công ty</p>
            <ul style="margin: 0 0 12px; padding-left: 20px;">
            <li><strong>Username:</strong> {user.username}</li>
            <li><strong>Password:</strong> {password}</li>
            </ul>

            <p style="color: #1a73e8; font-weight: bold; margin: 16px 0 8px;">2. Link điền thông tin cá nhân</p>
            <p style="margin: 0 0 8px;">Phòng HCNS cần thông tin để chuẩn hóa dữ liệu đầu vào trên hệ thống. Bạn vui lòng truy cập đường link và điền đầy đủ các thông tin cá nhân. Đường link sẽ hết hạn trong 2 ngày. Sau 2 ngày, vui lòng liên hệ Phòng HCNS để nhận đường link mới.</p>
            <p style="margin: 0 0 12px;">{'<a href="' + onboarding_link + '" style="color: #1a73e8;">' + onboarding_link + '</a>' if onboarding_link else 'Sẽ được gửi sau'}</p>
            <p style="margin: 0 0 8px;">Nếu bạn đã được HR gửi link trước đó, vui lòng bỏ qua bước này.</p>
            <p style="color: #1a73e8; font-weight: bold; margin: 16px 0 8px;">3. Link website HRM</p>
            <p style="margin: 0 0 12px;"><a href="{branding.portal_url()}" style="color: #1a73e8;">{branding.portal_url()}</a></p>

            <p style="margin: 0 0 12px;">Bạn vui lòng đăng nhập vào website HRM theo tài khoản và mật khẩu công ty đã cung cấp để hoàn thiện thông tin và hội nhập cùng công ty.</p>
            <p style="margin: 0 0 20px;">Trân trọng!</p>

            <!-- Footer -->
            <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
            <table style="border-collapse: collapse;">
            <tr>
                <td style="width: 80px; vertical-align: middle; padding-right: 16px;">
                {branding.email_logo_html()}
                </td>
                <td style="vertical-align: middle; color: #666; font-size: 13px;">
                {branding.hr_signature_html()}
                </td>
            </tr>
            </table>
        </td>
        </tr>
    </table>

    </body>
    </html>
            """

            plain_message = f"""Thân gửi bạn {full_name},

    Chúng tôi rất vui mừng chào đón bạn đến với công ty.

    1. Username / Password
    - Username: {user.username}
    - Password: {password}

    2. Link điền thông tin cá nhân
    - {onboarding_link if onboarding_link else 'Sẽ được gửi sau'}

    3. Link website HRM
    - {branding.portal_url()}

    Trân trọng!
    {branding.hr_signature_text('    ')}"""

            # Send via Gmail API — ưu tiên personal_email > candidate_email > user.email
            recipient_email = (employee.personal_email if employee and employee.personal_email else None) or (onboarding.candidate_email if onboarding else None) or user.email
            success = send_email_via_gmail(
                to=recipient_email,
                subject=subject,
                body=plain_message,
                html_body=html_message
            )

            if success:
                logger.info(f"✅ Sent welcome email to {recipient_email} via Gmail API")
                return True
            else:
                logger.error(f"❌ Failed to send welcome email to {recipient_email} via Gmail API")
                return False

        except Exception as e:
            logger.error(f"❌ Failed to send welcome email: {str(e)}")
            return False



class OnboardingProcessUpdateSerializer(serializers.ModelSerializer):
    """Serializer để cập nhật OnboardingProcess - Hỗ trợ cả frontend và admin"""
    # Accept both frontend and backend field names
    full_name = serializers.CharField(write_only=True, required=False)
    position_title = serializers.CharField(write_only=True, required=False)
    # Frontend currently sends "M/F/O" but model expects "MALE/FEMALE/OTHER"
    gender = serializers.CharField(write_only=True, required=False, allow_blank=True)
    # citizen_id_file trong model là CharField (S3 key), nhận file để upload lên S3
    citizen_id_file = serializers.FileField(required=False, allow_null=True)
    
    class Meta:
        model = OnboardingProcess
        fields = [
            # Frontend fields
            'full_name', 'position_title', 'start_date',
            # Backend fields
            'candidate_name', 'candidate_email', 'candidate_phone',
            'citizen_id', 'date_of_birth', 'gender',
            'marital_status', 'ethnicity', 'nationality',
            'permanent_address', 'current_address', 'birth_place',
            'education_level', 'university', 'major', 'graduation_year',
            'position', 'department', 'direct_manager',
            'company_unit', 'rank', 'section', 'doctor_team', 'work_form', 'region', 'block',
            'expected_end_date', 'contract_type', 'probation_period_months',
            'salary', 'salary_note',
            'bank_name', 'bank_account', 'bank_branch', 'bank_account_holder',
            'tax_code', 'tax_dependents', 'social_insurance_number',
            'hr_responsible', 'status', 'notes',
            'cv_file', 'id_card_front', 'id_card_back', 'diploma_file', 'citizen_id_file'
        ]
    
    def validate(self, attrs):
        """Validate và convert frontend fields sang backend fields"""
        # Map full_name -> candidate_name
        if 'full_name' in attrs:
            if not attrs.get('candidate_name'):
                attrs['candidate_name'] = attrs.pop('full_name')
            else:
                attrs.pop('full_name')
        
        # Map position_title -> position
        if 'position_title' in attrs:
            position_title = attrs.pop('position_title')
            if not attrs.get('position'):
                from employee.models import Position
                try:
                    position = Position.objects.filter(title__icontains=position_title).first()
                    if position:
                        attrs['position'] = position
                except Position.DoesNotExist:
                    pass
        
        return attrs

    def validate_gender(self, value):
        if value is None:
            return ''
        v = str(value).strip()
        if v == '':
            return ''
        v_upper = v.upper()

        if v_upper in ('M', 'MALE'):
            return 'MALE'
        if v_upper in ('F', 'FEMALE'):
            return 'FEMALE'
        if v_upper in ('O', 'OTHER'):
            return 'OTHER'

        raise serializers.ValidationError(f'"{value}" is not a valid choice.')

    def update(self, instance, validated_data):
        # citizen_id_file là CharField trên model (lưu S3 key) nên cần upload file
        # lên S3 trước khi set vào instance.
        citizen_id_file = validated_data.pop('citizen_id_file', None)
        if citizen_id_file is not None:
            try:
                s3_key = upload_file_to_cloudfly(citizen_id_file, 'onboarding/documents')
                instance.citizen_id_file = s3_key
            except Exception as e:
                raise serializers.ValidationError({'citizen_id_file': f'Upload thất bại: {str(e)}'})
        return super().update(instance, validated_data)


class OnboardingTaskUpdateSerializer(serializers.ModelSerializer):
    """Serializer để cập nhật OnboardingTask"""
    
    class Meta:
        model = OnboardingTask
        fields = ['status', 'completion_note', 'attachment', 'assigned_to']


class OnboardingDocumentUploadSerializer(serializers.ModelSerializer):
    """Serializer để upload tài liệu onboarding"""
    
    class Meta:
        model = OnboardingDocument
        fields = [
            'onboarding_process', 'document_name', 'document_type', 'description',
            'file', 'is_required', 'requires_signature'
        ]
class OnboardingDocumentTemplateSerializer(serializers.ModelSerializer):
    """Serializer cho OnboardingDocumentTemplate"""
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    
    # Position & Department details
    positions = SimplePositionSerializer(source='apply_to_positions', many=True, read_only=True)
    departments = SimpleDepartmentSerializer(source='apply_to_departments', many=True, read_only=True)
    
    # IDs for write operations
    position_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        allow_empty=True
    )
    department_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
        allow_empty=True
    )
    file_url = serializers.SerializerMethodField()
    
    class Meta:
        model = OnboardingDocumentTemplate
        fields = [
            'id', 'template_name', 'document_type', 'document_type_display',
            'description', 'file', 'file_url',
            'is_required', 'requires_signature', 'is_active',
            'apply_to_all_new_onboarding',
            'positions', 'departments',
            'position_ids', 'department_ids',
            'created_by', 'created_by_name',
            'usage_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at', 'usage_count']

    def get_file_url(self, obj):
        if obj.file:
            return get_cloudfly_presigned_url(str(obj.file))
        return None

    def create(self, validated_data):
        """Create template với position/department filtering"""
        position_ids = validated_data.pop('position_ids', [])
        department_ids = validated_data.pop('department_ids', [])
        
        # Lấy user từ request → tìm Employee để set created_by
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_authenticated:
            user = request.user
            emp = None
            # 1. Tìm qua user FK
            try:
                emp = Employee.objects.get(user=user)
            except Employee.DoesNotExist:
                pass
            # 2. Fallback: tìm qua email
            if not emp and user.email:
                emp = Employee.objects.filter(personal_email__iexact=user.email).first()
            # 3. Fallback: tìm qua username = employee_id
            if not emp:
                emp = Employee.objects.filter(employee_id__iexact=user.username).first()
            if emp:
                validated_data['created_by'] = emp
        
        template = OnboardingDocumentTemplate.objects.create(**validated_data)
        
        # Set positions & departments
        if position_ids:
            from employee.models import Position
            template.apply_to_positions.set(
                Position.objects.filter(id__in=position_ids)
            )
        
        if department_ids:
            from employee.models import Department
            template.apply_to_departments.set(
                Department.objects.filter(id__in=department_ids)
            )
        
        return template
    
    def update(self, instance, validated_data):
        """Update template"""
        position_ids = validated_data.pop('position_ids', None)
        department_ids = validated_data.pop('department_ids', None)
        
        # Update fields
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        
        # Update positions & departments
        if position_ids is not None:
            from employee.models import Position
            instance.apply_to_positions.set(
                Position.objects.filter(id__in=position_ids)
            )
        
        if department_ids is not None:
            from employee.models import Department
            instance.apply_to_departments.set(
                Department.objects.filter(id__in=department_ids)
            )
        
        return instance


class OnboardingDocumentTemplateListSerializer(serializers.ModelSerializer):
    """Simplified serializer for list view"""
    document_type_display = serializers.CharField(source='get_document_type_display', read_only=True)
    created_by_name = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    position_count = serializers.SerializerMethodField()
    department_count = serializers.SerializerMethodField()

    class Meta:
        model = OnboardingDocumentTemplate
        fields = [
            'id', 'template_name', 'document_type', 'document_type_display',
            'description', 'file', 'file_url',
            'is_required', 'requires_signature', 'is_active',
            'apply_to_all_new_onboarding',
            'position_count', 'department_count',
            'usage_count',
            'created_by_name', 'created_at'
        ]

    def get_file_url(self, obj):
        if obj.file:
            return get_cloudfly_presigned_url(str(obj.file))
        return None

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.full_name
        # Fallback: tìm User đã tạo qua request context (nếu có)
        return 'Admin'

    def get_position_count(self, obj):
        return obj.apply_to_positions.count()

    def get_department_count(self, obj):
        return obj.apply_to_departments.count()
    
class EmployeeOnboardingFormSerializer(serializers.ModelSerializer):
        """
        Serializer cho nhân viên điền thông tin (không cần authentication)
        Chỉ cho phép điền các field thông tin cá nhân
        """
        # Accept both frontend and backend field names
        full_name = serializers.CharField(write_only=True, required=False)
        position_title = serializers.CharField(write_only=True, required=False)
        employee_id = serializers.CharField(write_only=True, required=False)
        gender = serializers.CharField(write_only=True, required=False, allow_blank=True)
        job_rank = serializers.CharField(write_only=True, required=False, allow_blank=True)
        ethnicity = serializers.CharField(write_only=True, required=False, allow_blank=True)
        nationality = serializers.CharField(write_only=True, required=False, allow_blank=True)

        # Các field mới (giống OnboardingProcessCreateSerializer)
        facebook_link = serializers.URLField(write_only=True, required=False, allow_blank=True)
        
        REGION_CHOICES = [("Miền Bắc", "Miền Bắc"), ("Miền Nam", "Miền Nam")]
        BLOCK_CHOICES = [
            ("Khối Back office", "Khối Back office"),
            ("Khối Marketing", "Khối Marketing"),
            ("Khối Kinh doanh", "Khối Kinh doanh"),
        ]
        SUB_DEPARTMENT_CHOICES = OnboardingProcessCreateSerializer.SUB_DEPARTMENT_CHOICES
        SECTION_CHOICES = OnboardingProcessCreateSerializer.SECTION_CHOICES
        WORK_FORM_CHOICES = [
            ("FULL_TIME", "Full-time"),
            ("PART_TIME", "Part-time"),
        ]
        POSITION_CHOICES = [
            ("Nhân viên Sale", "Nhân viên Sale"),
            ("Nhân viên Kinh doanh", "Nhân viên Kinh doanh"),
            ("Nhân viên Telesale", "Nhân viên Telesale"),
            ("Trưởng phòng Telesale", "Trưởng phòng Telesale"),
            ("Nhân viên CSKH", "Nhân viên CSKH"),
            ("Trưởng phòng CSKH", "Trưởng phòng CSKH"),
            ("Nhân viên Tư vấn", "Nhân viên Tư vấn"),
            ("Chăm sóc, tiếp nhận khách", "Chăm sóc, tiếp nhận khách"),
            ("Chăm sóc hậu phẫu", "Chăm sóc hậu phẫu"),
            ("Nhân viên Marketing", "Nhân viên Marketing"),
            ("Nhân viên ADS", "Nhân viên ADS"),
            ("Trưởng phòng ADS", "Trưởng phòng ADS"),
            ("Nhân viên Content", "Nhân viên Content"),
            ("Trưởng phòng Content", "Trưởng phòng Content"),
            ("Nhân viên Seeding", "Nhân viên Seeding"),
            ("Trưởng phòng Seeding", "Trưởng phòng Seeding"),
            ("Nhân viên Truyền thông thương hiệu", "Nhân viên Truyền thông thương hiệu"),
            ("Trưởng phòng Truyền thông thương hiệu", "Trưởng phòng Truyền thông thương hiệu"),
            ("Nhân viên Media", "Nhân viên Media"),
            ("Trưởng phòng Media", "Trưởng phòng Media"),
            ("Nhân viên TikTok", "Nhân viên TikTok"),
            ("Xây group", "Xây group"),
            ("Nhân viên Thiết kế", "Nhân viên Thiết kế"),
            ("Nhân viên Editor/Dựng phim", "Nhân viên Editor/Dựng phim"),
            ("Biên tập viên", "Biên tập viên"),
            ("Biên kịch", "Biên kịch"),
            ("Checkpage", "Checkpage"),
            ("Trợ lý hình ảnh", "Trợ lý hình ảnh"),
            ("Quay - Chụp", "Quay - Chụp"),
            ("Tổ chức sản xuất", "Tổ chức sản xuất"),
            ("Bác sĩ", "Bác sĩ"),
            ("Trợ lý bác sĩ", "Trợ lý bác sĩ"),
            ("Điều dưỡng", "Điều dưỡng"),
            ("Y tá", "Y tá"),
            ("Kỹ thuật viên", "Kỹ thuật viên"),
            ("Phụ tá", "Phụ tá"),
            ("Nhân viên Hành chính - Nhân sự", "Nhân viên Hành chính - Nhân sự"),
            ("Trưởng phòng Hành chính - Nhân sự", "Trưởng phòng Hành chính - Nhân sự"),
            ("Giám đốc Hành chính - Nhân sự", "Giám đốc Hành chính - Nhân sự"),
            ("Nhân viên C&B", "Nhân viên C&B"),
            ("Nhân viên Tuyển dụng", "Nhân viên Tuyển dụng"),
            ("Trưởng phòng Tuyển dụng", "Trưởng phòng Tuyển dụng"),
            ("Nhân viên Pháp chế", "Nhân viên Pháp chế"),
            ("Trưởng phòng Pháp chế", "Trưởng phòng Pháp chế"),
            ("Giám đốc Pháp chế", "Giám đốc Pháp chế"),
            ("Phiên dịch viên", "Phiên dịch viên"),
            ("Nhân viên IT", "Nhân viên IT"),
            ("Nhân viên AI", "Nhân viên AI"),
            ("Trưởng phòng IT", "Trưởng phòng IT"),
            ("Trưởng phòng AI", "Trưởng phòng AI"),
            ("Nhân viên Kế toán", "Nhân viên Kế toán"),
            ("Thực tập sinh", "Thực tập sinh"),
            ("Lễ tân", "Lễ tân"),
            ("Giám sát nội bộ", "Giám sát nội bộ"),
            ("Giám sát chất lượng", "Giám sát chất lượng"),
            ("Trưởng phòng Giám sát", "Trưởng phòng Giám sát"),
            ("Lái xe", "Lái xe"),
            ("Tạp vụ", "Tạp vụ"),
            ("Bảo vệ", "Bảo vệ"),
            ("Giám đốc", "Giám đốc"),
            ("Phó Giám đốc", "Phó Giám đốc"),
        ]

        region = serializers.CharField(write_only=True, required=False, allow_blank=True)
        block = serializers.CharField(write_only=True, required=False, allow_blank=True)
        sub_department = serializers.CharField(write_only=True, required=False, allow_blank=True)
        section = serializers.CharField(write_only=True, required=False, allow_blank=True)
        position = serializers.CharField(write_only=True, required=False, allow_blank=True)
        team = serializers.CharField(write_only=True, required=False, allow_blank=True)
        doctor_team = serializers.CharField(write_only=True, required=False, allow_blank=True)
        work_form = serializers.ChoiceField(choices=WORK_FORM_CHOICES, write_only=True, required=False, allow_blank=True)
        work_type = serializers.CharField(write_only=True, required=False, allow_blank=True)
        work_location = serializers.CharField(write_only=True, required=False, allow_blank=True)
        
        citizen_id_file = serializers.FileField(write_only=True, required=False, allow_null=True)
        vneid_screenshot = serializers.ImageField(write_only=True, required=False, allow_null=True)
        citizen_id_issue_date = serializers.DateField(write_only=True, required=False, allow_null=True)
        citizen_id_issue_place = serializers.CharField(write_only=True, required=False, allow_blank=True)
        old_id_number = serializers.CharField(write_only=True, required=False, allow_blank=True)
        
        current_address = serializers.CharField(write_only=True, required=False, allow_blank=True)
        social_insurance_number = serializers.CharField(write_only=True, required=False, allow_blank=True)
        
        marital_status = serializers.ChoiceField(
            choices=['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'],
            write_only=True, required=False, allow_blank=True
        )
        
        emergency_contact_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
        emergency_contact_relationship = serializers.CharField(write_only=True, required=False, allow_blank=True)
        emergency_contact_phone = serializers.CharField(write_only=True, required=False, allow_blank=True)
        emergency_contact_dob = serializers.DateField(write_only=True, required=False, allow_null=True)
        emergency_contact_occupation = serializers.CharField(write_only=True, required=False, allow_blank=True)
        emergency_contact_address = serializers.CharField(write_only=True, required=False, allow_blank=True)
        allowance = serializers.DecimalField(max_digits=15, decimal_places=2, write_only=True, required=False, allow_null=True)
        allowance_notes = serializers.CharField(write_only=True, required=False, allow_blank=True)     
        salary = serializers.DecimalField(max_digits=12, decimal_places=2, write_only=True, required=False, allow_null=True)
        probation_period_months = serializers.IntegerField(write_only=True, required=False, allow_null=True)
        probation_rate = serializers.CharField(write_only=True, required=False, allow_blank=True)   
        class Meta:
            model = OnboardingProcess
            fields = [
                'full_name', 'position_title', 'employee_id',
                'candidate_name', 'candidate_phone',
                'citizen_id', 'date_of_birth', 'gender',
                'permanent_address', 'current_address',
                'job_rank', 'ethnicity', 'nationality',
                'education_level', 'university', 'major', 'graduation_year',
                'bank_name', 'bank_account', 'bank_branch', 'bank_account_holder',
                'tax_code', 'tax_dependents',
                'id_card_front', 'id_card_back', 'diploma_file',
                'facebook_link', 'company_unit', 'region', 'block', 'sub_department', 'section', 'team',
                'position', 'doctor_team', 'birth_place', 'work_form', 'work_type', 'work_location',
                'citizen_id_file', 'vneid_screenshot', 'citizen_id_issue_date', 'citizen_id_issue_place', 'old_id_number',
                'social_insurance_number', 'marital_status',
                'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone',
                'emergency_contact_dob', 'emergency_contact_occupation', 'emergency_contact_address',
                'allowance_notes', 'allowance', 'salary',
                'probation_period_months', 'probation_rate',
            ]
            read_only_fields = ['candidate_email']  # Email không cho phép sửa
        
        def validate_citizen_id_file(self, value):
            """Validate CCCD file"""
            if value:
                if not value.name.lower().endswith('.pdf'):
                    raise serializers.ValidationError("File CCCD phải là định dạng PDF")
                if value.size > 15 * 1024 * 1024:
                    raise serializers.ValidationError("File CCCD không được vượt quá 15MB")
            return value
        
        def validate_vneid_screenshot(self, value):
            if value:
                from django.conf import settings as dj_settings
                allowed = getattr(dj_settings, 'ALLOWED_IMAGE_TYPES', [])
                ct = getattr(value, 'content_type', '') or ''
                if allowed and ct and ct not in allowed:
                    raise serializers.ValidationError(
                        f'Định dạng ảnh không hợp lệ. Cho phép: {", ".join(allowed)}'
                    )
                max_mb = 10
                if value.size > max_mb * 1024 * 1024:
                    raise serializers.ValidationError(f'Ảnh VNEID không được vượt quá {max_mb}MB')
            return value
        
        def validate(self, attrs):
            """Validate và convert frontend fields"""
            # Map full_name -> candidate_name
            if 'full_name' in attrs and not attrs.get('candidate_name'):
                attrs['candidate_name'] = attrs.pop('full_name')
            elif 'full_name' in attrs:
                attrs.pop('full_name')
            
            # Map employee_id -> desired_employee_id
            if 'employee_id' in attrs:
                attrs['desired_employee_id'] = attrs.pop('employee_id')
            
            return attrs

        def validate_gender(self, value):
            """Accept M/F/O and convert to MALE/FEMALE/OTHER"""
            if value is None or value == '':
                return ''
            v_upper = str(value).strip().upper()
            
            if v_upper in ('M', 'MALE'):
                return 'MALE'
            if v_upper in ('F', 'FEMALE'):
                return 'FEMALE'
            if v_upper in ('O', 'OTHER'):
                return 'OTHER'
            
            raise serializers.ValidationError(f'"{value}" is not a valid choice.')
        
        def update(self, instance, validated_data):
            """Update onboarding process với thông tin từ nhân viên"""
            import logging
            import json
            from .models import SELF_UPDATE_KEPT_EMPLOYEE_FIELDS, SELF_UPDATE_KEPT_ONBOARDING_FIELDS
            logger = logging.getLogger(__name__)

            # Link tự cập nhật hồ sơ (NV đang làm): mọi trường HCNS quản lý giữ nguyên
            # giá trị cũ, kể cả khi request có gửi lên.
            self_update = bool(self.context.get('self_update'))
            kept_onboarding = (
                {f: getattr(instance, f) for f in SELF_UPDATE_KEPT_ONBOARDING_FIELDS if hasattr(instance, f)}
                if self_update else {}
            )
            
            # Extract các field mới
            facebook_link = validated_data.pop('facebook_link', '')
            region = validated_data.pop('region', '')
            block = validated_data.pop('block', '')
            sub_department = validated_data.pop('sub_department', '')
            section = validated_data.pop('section', '')
            team = validated_data.pop('team', '')
            position_title = validated_data.pop('position', '')
            doctor_team = validated_data.pop('doctor_team', '')
            work_form = validated_data.pop('work_form', '')
            work_type = validated_data.pop('work_type', '')
            work_location = validated_data.pop('work_location', '')

            rank = validated_data.pop('job_rank', '') or validated_data.pop('rank', '')
            ethnicity = validated_data.pop('ethnicity', '')
            nationality = validated_data.pop('nationality', '')
            birth_place = validated_data.pop('birth_place', '')

            citizen_id_file = validated_data.pop('citizen_id_file', None)
            vneid_screenshot_file = validated_data.pop('vneid_screenshot', None)
            request = self.context.get('request')
            if request:
                # Fallback: đảm bảo lấy được file từ multipart payload
                if not citizen_id_file:
                    citizen_id_file = request.FILES.get('citizen_id_file')
                if not vneid_screenshot_file:
                    vneid_screenshot_file = (
                        request.FILES.get('vneid_screenshot')
                        or request.FILES.get('vneidScreenshot')
                    )
            id_card_front_file = validated_data.pop('id_card_front', None)
            id_card_back_file = validated_data.pop('id_card_back', None)
            diploma_file_upload = validated_data.pop('diploma_file', None)
            citizen_id_issue_date = validated_data.pop('citizen_id_issue_date', None)
            citizen_id_issue_place = validated_data.pop('citizen_id_issue_place', '')
            old_id_number = validated_data.pop('old_id_number', '')
            
            current_address = validated_data.pop('current_address', '')
            social_insurance_number = validated_data.pop('social_insurance_number', '')
            marital_status = validated_data.pop('marital_status', '')
            
            emergency_contact_name = validated_data.pop('emergency_contact_name', '')
            emergency_contact_relationship = validated_data.pop('emergency_contact_relationship', '')
            emergency_contact_phone = validated_data.pop('emergency_contact_phone', '')
            emergency_contact_dob = validated_data.pop('emergency_contact_dob', None)
            emergency_contact_occupation = validated_data.pop('emergency_contact_occupation', '')
            emergency_contact_address = validated_data.pop('emergency_contact_address', '')
            allowance = validated_data.pop('allowance', None)
            allowance_notes = validated_data.pop('allowance_notes', '')
            salary = validated_data.pop('salary', None)
            probation_period_months = validated_data.pop('probation_period_months', None)
            probation_rate = validated_data.pop('probation_rate', '')
            # Tự động tạo/cập nhật Department và Position
            from employee.models import Department, Position
            
            if sub_department and not validated_data.get('department'):
                try:
                    department, created = Department.objects.get_or_create(
                        name=sub_department,
                        defaults={
                            'code': sub_department.upper().replace(' ', '_')[:64],
                            'description': f'Phòng/Ban {sub_department}'
                        }
                    )
                    validated_data['department'] = department
                except Exception as e:
                    logger.error(f"Failed to create department: {str(e)}")
            
            if position_title and not validated_data.get('position'):
                try:
                    position, created = Position.objects.get_or_create(
                        title=position_title,
                        defaults={
                            'code': position_title.upper().replace(' ', '_')[:64],
                            'description': f'Vị trí {position_title}',
                            'department': validated_data.get('department'),
                            'level': 1,
                        }
                    )
                    validated_data['position'] = position
                except Exception as e:
                    logger.error(f"Failed to create position: {str(e)}")
            
            # Update OnboardingProcess fields
            for attr, value in validated_data.items():
                setattr(instance, attr, value)
            
            # ===== UPLOAD CÁC FILE CCCD/BẰNG CẤP LÊN S3 =====
            file_field_folders = {
                'id_card_front': 'onboarding/id_cards',
                'id_card_back': 'onboarding/id_cards',
                'diploma_file': 'onboarding/diplomas',
            }
            file_field_map = {
                'id_card_front': id_card_front_file,
                'id_card_back': id_card_back_file,
                'diploma_file': diploma_file_upload,
            }
            for field_name, file_obj in file_field_map.items():
                if file_obj:
                    try:
                        s3_key = upload_file_to_cloudfly(file_obj, file_field_folders[field_name])
                        setattr(instance, field_name, s3_key)
                        logger.info(f"Uploaded {field_name} to S3 for {instance.onboarding_code}: {s3_key}")
                    except Exception as e:
                        logger.error(f"Failed to upload {field_name} to S3: {str(e)}")

            # Đánh dấu nhân viên đã điền thông tin
            instance.rank = rank or None  
            instance.section = section or None
            instance.doctor_team = doctor_team or None
            instance.ethnicity = ethnicity or None
            instance.nationality = nationality or None
            instance.birth_place = birth_place or instance.birth_place or ''
            instance.current_address = current_address or ''
            instance.social_insurance_number = social_insurance_number or None
            instance.region = region or None
            instance.block = block or None
            instance.work_form = work_form or None
            instance.marital_status = marital_status or None
            instance.probation_rate = probation_rate or None
            for attr, value in kept_onboarding.items():
                setattr(instance, attr, value)
            instance.employee_info_completed = True
            instance.employee_info_completed_at = timezone.now()
            instance.save()

            # Task1 (ORIENTATION) sẽ được ADMIN duyệt thủ công qua "Duyệt thông tin"
            # Không auto-complete ở đây để đảm bảo admin review trước khi xác nhận.

            # Đảm bảo có Employee + User skeleton trước khi populate field.
            # start_process() là single source of truth: tạo User + Employee, link
            # với onboarding, và bump status DRAFT -> IN_PROGRESS.
            if instance.status == 'DRAFT' and not instance.employee:
                try:
                    instance.start_process()
                    instance.refresh_from_db()
                except Exception as e:
                    logger.warning(
                        f"start_process() failed for onboarding "
                        f"{instance.onboarding_code}: {str(e)}. "
                        f"Continuing with Employee=None — admin sẽ phải bấm 'Bắt đầu' lại."
                    )

            # Cập nhật Employee nếu đã có; fallback theo email nếu chưa link
            employee = instance.employee
            if not employee and instance.candidate_email:
                employee = Employee.objects.filter(personal_email=instance.candidate_email).first()
                if employee:
                    instance.employee = employee
                    instance.save(update_fields=['employee'])

            if employee:
                
                kept_employee = (
                    {f: getattr(employee, f) for f in SELF_UPDATE_KEPT_EMPLOYEE_FIELDS} if self_update else {}
                )

                # Map gender
                employee_gender = {
                    'MALE': 'M',
                    'FEMALE': 'F',
                    'OTHER': 'O',
                }.get(instance.gender, '')
                
                # Map education_level
                education_label = (instance.education_level or '').strip()
                education_map = {
                    'Thạc sĩ': 'MASTER',
                    'Cử nhân đại học': 'BACHELOR',
                    'Cử nhân cao đẳng': 'ASSOCIATE',
                    'Trung cấp': 'HIGH_SCHOOL',
                    'Khác': 'OTHER',
                }
                employee_education_level = education_map.get(education_label) if education_label else None
                
                # Cập nhật các field
                employee.full_name = instance.candidate_name
                employee.phone_number = instance.candidate_phone
                employee.position = instance.position
                employee.department = instance.department
                employee.date_of_birth = instance.date_of_birth
                employee.gender = employee_gender
                employee.ethnicity = ethnicity or None
                employee.nationality = nationality or None
                employee.birth_place = birth_place or None
                employee.region = region or None
                employee.block = block or None
                employee.section = section or None
                employee.rank = rank or None
                employee.work_form = work_form or None
                employee.work_location = work_location or None
                employee.doctor_team = doctor_team or None
                employee.education_level = employee_education_level
                employee.facebook_link = facebook_link or None
                
                employee.permanent_residence = instance.permanent_address
                employee.current_address = current_address or None
                
                employee.social_insurance_number = social_insurance_number or None
                employee.tax_code = instance.tax_code or None
                
                employee.marital_status = marital_status or None
                
                employee.emergency_contact_name = emergency_contact_name or None
                employee.emergency_contact_relationship = emergency_contact_relationship or None
                employee.emergency_contact_phone = emergency_contact_phone or None
                employee.emergency_contact_dob = emergency_contact_dob
                employee.emergency_contact_occupation = emergency_contact_occupation or None
                employee.emergency_contact_address = emergency_contact_address or None
                
                employee.cccd_number = instance.citizen_id
                employee.old_id_number = old_id_number or None
                employee.cccd_issue_date = citizen_id_issue_date
                employee.cccd_issue_place = citizen_id_issue_place or ''
                
                employee.bank_name = instance.bank_name
                employee.bank_account = instance.bank_account
                employee.bank_account_holder = instance.bank_account_holder or ''
                employee.bank_branch = instance.bank_branch

                # Lưu extra_info
                extra_info = {}
                # Lương & hợp đồng
                if salary is not None:
                    employee.basic_salary = salary
                if allowance is not None:
                    employee.allowance = allowance
                if allowance_notes is not None:
                    employee.allowance_notes = allowance_notes
                if probation_period_months is not None:
                    employee.probation_months = int(probation_period_months)
                    # Tính lại probation_end_date
                    if employee.start_date:
                        employee.probation_end_date = calculate_probation_end_date(
                            employee.start_date,
                            probation_period_months,
                        )
                        employee.official_start_date = calculate_official_start_date(
                            employee.probation_end_date
                        )
                if probation_rate is not None:
                    employee.probation_rate = probation_rate or None
                if facebook_link:
                    extra_info['facebook_link'] = facebook_link
                if team:
                    extra_info['team'] = team
                if work_type:
                    extra_info['work_type'] = work_type
                if citizen_id_issue_date:
                    extra_info['citizen_id_issue_date'] = str(citizen_id_issue_date)
                if allowance_notes:
                    extra_info['allowance_notes'] = allowance_notes
                
                employee.extra_info = json.dumps(extra_info, ensure_ascii=False) if extra_info else ''
                for attr, value in kept_employee.items():
                    setattr(employee, attr, value)
                # VNEID upload chuyển ra ngoài block để cover case employee=None.
                # Xem code tiếp theo (sau if employee).
                employee.save()
                
                logger.info(f"Updated employee {employee.employee_id} from onboarding form")
            
            # Fallback storage cho các field chỉ tồn tại trên Employee model.
            # Luôn save vào OnboardingProcess.extra_info — tránh mất data khi
            # start_process() fail và employee=None tại block "if employee:".
            # OnboardingProcessDetailSerializer dùng fallback chain (Employee →
            # extra_info → None) để luôn đọc được giá trị.
            _extra = dict(instance.extra_info or {})

            def _set_if(key, val):
                if val not in (None, '', []):
                    _extra[key] = val

            _set_if('facebook_link', facebook_link)
            _set_if('probation_rate', probation_rate)
            _set_if('work_type', work_type)
            _set_if('work_location', work_location)
            _set_if('sub_department', sub_department)
            _set_if('team', team)
            _set_if('citizen_id_issue_place', citizen_id_issue_place)
            _set_if('old_id_number', old_id_number)
            _set_if('emergency_contact_name', emergency_contact_name)
            _set_if('emergency_contact_relationship', emergency_contact_relationship)
            _set_if('emergency_contact_phone', emergency_contact_phone)
            _set_if('emergency_contact_occupation', emergency_contact_occupation)
            _set_if('emergency_contact_address', emergency_contact_address)
            _set_if('allowance_notes', allowance_notes)
            if allowance is not None:
                try:
                    _extra['allowance'] = float(allowance)
                except (TypeError, ValueError):
                    pass
            if citizen_id_issue_date:
                _extra['citizen_id_issue_date'] = str(citizen_id_issue_date)
            if emergency_contact_dob:
                _extra['emergency_contact_dob'] = str(emergency_contact_dob)

            # Upload VNEID file: lưu S3 key vào extra_info, đồng thời sync sang
            # Employee nếu đã link. Cover được case employee=None.
            if vneid_screenshot_file:
                try:
                    s3_key = upload_file_to_cloudfly(vneid_screenshot_file, 'vneid_screenshots')
                    _extra['vneid_screenshot'] = s3_key
                    if employee:
                        employee.vneid_screenshot = s3_key
                        employee.save(update_fields=['vneid_screenshot'])
                except Exception as e:
                    logger.error(f"Failed to upload vneid_screenshot fallback: {str(e)}")

            if _extra != (instance.extra_info or {}):
                instance.extra_info = _extra
                instance.save(update_fields=['extra_info'])

            # Lưu citizen_id_file nếu có
            if citizen_id_file:
                try:
                    from .models import OnboardingDocument
                    s3_key = upload_file_to_cloudfly(citizen_id_file, 'onboarding/documents')
                    # Lưu S3 key trực tiếp vào field citizen_id_file của OnboardingProcess
                    instance.citizen_id_file = s3_key
                    instance.save(update_fields=['citizen_id_file'])
                    OnboardingDocument.objects.create(
                        onboarding_process=instance,
                        document_name='CCCD (2 mặt)',
                        document_type='OTHER',
                        description='File CCCD được upload bởi nhân viên',
                        file=s3_key,
                        is_required=True
                    )
                    logger.info(f"Saved citizen_id_file for {instance.onboarding_code}")
                except Exception as e:
                    logger.error(f"Failed to save citizen_id_file: {str(e)}")
            
            # Task 1: chuyển sang IN_PROGRESS thay vì COMPLETED
            task_1 = instance.tasks.filter(order=1).first()
            if task_1 and task_1.status in ['PENDING', 'IN_PROGRESS']:
                if task_1.status == 'PENDING':
                    task_1.start_task()
            return instance


class OnboardingProcessListSerializer(serializers.ModelSerializer):
        """Serializer cho danh sách - thêm thông tin token"""
        full_name = serializers.CharField(source='candidate_name')
        position_title = serializers.SerializerMethodField()
        position_name = serializers.SerializerMethodField()
        department_name = serializers.SerializerMethodField()
        hr_responsible_name = serializers.CharField(source='hr_responsible.full_name', read_only=True)
        employee_id = serializers.SerializerMethodField()

        # Thêm field token
        employee_form_url = serializers.SerializerMethodField()
        token_status = serializers.SerializerMethodField()
        task1_status = serializers.SerializerMethodField()

        # File URL fields
        cv_file_url = serializers.SerializerMethodField()
        id_card_front_url = serializers.SerializerMethodField()
        id_card_back_url = serializers.SerializerMethodField()
        diploma_file_url = serializers.SerializerMethodField()
        citizen_id_file_url = serializers.SerializerMethodField()

        class Meta:
            model = OnboardingProcess
            fields = [
                'id', 'onboarding_code',
                'full_name', 'position_title', 'start_date',
                'candidate_name', 'candidate_email',
                'position', 'position_name', 'department', 'department_name',
                'company_unit', 'rank', 'section', 'doctor_team', 'birth_place',
                'status', 'progress_percentage',
                'hr_responsible', 'hr_responsible_name',
                'employee_id',
                'created_at',
                'employee_info_completed',
                'employee_form_url',
                'token_status',
                'task1_status',
                'cv_file_url', 'id_card_front_url', 'id_card_back_url', 'diploma_file_url',
                'citizen_id_file_url',
                'contract_type', 'probation_period_months', 'expected_end_date',
            ]

        def get_employee_id(self, obj):
            """Get employee ID (mã nhân viên) from linked employee record"""
            if obj.employee:
                return obj.employee.employee_id
            return obj.desired_employee_id or None

        def get_position_title(self, obj):
            if obj.position:
                return obj.position.title
            if obj.employee and obj.employee.rank:
                return obj.employee.rank
            return 'N/A'

        def get_position_name(self, obj):
            return self.get_position_title(obj)

        def get_department_name(self, obj):
            if obj.department:
                return obj.department.name
            if obj.employee and obj.employee.section:
                return obj.employee.section
            return 'N/A'
        
        def get_stage_display(self, obj):
            """Hiển thị tên giai đoạn"""
            return obj.get_stage_display()
        
        def get_progress_display(self, obj):
            """Hiển thị tên tiến độ"""
            return obj.get_progress_display()
        
        def get_employee_form_url(self, obj):
            """Lấy URL form cho nhân viên"""
            if obj.employee_token:
                return obj.get_employee_form_url()
            return None

        def get_token_status(self, obj):
            """Trạng thái token"""
            if not obj.employee_token:
                return 'not_generated'
            if obj.employee_info_completed:
                return 'completed'
            if not obj.is_token_valid():
                return 'expired'
            return 'active'

        def get_task1_status(self, obj):
            task1 = obj.tasks.filter(order=1).first()
            return task1.status if task1 else None

        def get_cv_file_url(self, obj):
            if obj.cv_file:
                return get_cloudfly_presigned_url(str(obj.cv_file))
            return None

        def get_id_card_front_url(self, obj):
            if obj.id_card_front:
                return get_cloudfly_presigned_url(str(obj.id_card_front))
            return None

        def get_id_card_back_url(self, obj):
            if obj.id_card_back:
                return get_cloudfly_presigned_url(str(obj.id_card_back))
            return None

        def get_diploma_file_url(self, obj):
            if obj.diploma_file:
                return get_cloudfly_presigned_url(str(obj.diploma_file))
            return None

        def get_citizen_id_file_url(self, obj):
            if obj.citizen_id_file:
                return get_cloudfly_presigned_url(str(obj.citizen_id_file))
            return None

def send_account_info_email(user, employee=None, new_password=None):
    import logging
    from django.conf import settings
    from .utils import send_email_via_gmail
    
    logger = logging.getLogger(__name__)
    recipient_email = employee.personal_email if employee and employee.personal_email else user.email

    try:
        subject = "Thông tin tài khoản hệ thống HRM"
        full_name = employee.full_name if employee else get_user_display_name(user)
        password_display = new_password if new_password else user.username  # ✅ SỬA: dùng username thay vì password hash

        guide_url = branding.user_guide_url()

        html_message = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #333; margin: 0; padding: 0;">
<table style="width: 100%; max-width: 600px; border-collapse: collapse;">
    <tr>
    <td style="padding: 0;">
        {branding.email_banner_html()}
    </td>
    </tr>
    <tr>
    <td style="padding: 24px;">
        <p style="margin: 0 0 12px;">Dear <strong>{full_name}</strong>,</p>
        <p style="margin: 0 0 12px;">Phòng Hành chính Nhân sự gửi đến bạn thông tin tài khoản đăng nhập hệ thống HRM của công ty.</p>
        <p style="margin: 0 0 12px;">Bạn vui lòng sử dụng thông tin dưới đây để đăng nhập và <strong style="color: #dc2626;">ĐỔI MẬT KHẨU NGAY</strong> sau lần đăng nhập đầu tiên.</p>

        <p style="color: #1a73e8; font-weight: bold; margin: 16px 0 8px;">1. Thông tin tài khoản</p>
        <p style="margin: 0 0 8px;">Dùng để đăng nhập website HRM của công ty</p>
        <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin: 12px 0;">
            <p style="margin: 0 0 8px;"><strong>Username:</strong> <code style="background: white; padding: 4px 8px; border-radius: 4px; font-family: monospace;">{user.username}</code></p>
            <p style="margin: 0;"><strong>Password:</strong> <code style="background: white; padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #dc2626;">{password_display}</code></p>
        </div>
        <p style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 12px; margin: 16px 0; font-size: 13px;">
            ⚠️ <strong>LƯU Ý QUAN TRỌNG:</strong> Vui lòng đổi mật khẩu ngay sau khi đăng nhập lần đầu để bảo mật tài khoản của bạn.
        </p>

        <p style="color: #1a73e8; font-weight: bold; margin: 16px 0 8px;">2. Link website HRM</p>
        <p style="margin: 0 0 12px;"><a href="{branding.portal_url()}" style="color: #1a73e8; font-weight: bold; font-size: 16px;">{branding.portal_url()}</a></p>

        <p style="color: #1a73e8; font-weight: bold; margin: 16px 0 8px;">3. Hướng dẫn sử dụng website HRM</p>
        <p style="margin: 0 0 8px;">Để biết cách sử dụng hệ thống, vui lòng tham khảo tài liệu hướng dẫn chi tiết:</p>
        <div style="background-color: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 16px; margin: 12px 0;">
            <p style="margin: 0 0 8px; font-weight: bold; color: #1e40af;">📖 Tài liệu hướng dẫn sử dụng</p>
            <a href="{guide_url}" style="display: inline-block; background-color: #3b82f6; color: white; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: bold; margin-top: 8px;">
                👉 Xem hướng dẫn
            </a>
        </div>
        
        <p style="margin: 0 0 12px;">Nếu bạn gặp khó khăn trong quá trình đăng nhập hoặc sử dụng hệ thống, vui lòng liên hệ Phòng HCNS để được hỗ trợ.</p>
        <p style="margin: 0 0 20px;">Trân trọng!</p>

        <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
        <table style="border-collapse: collapse;">
        <tr>
            <td style="width: 80px; vertical-align: middle; padding-right: 16px;">
            {branding.email_logo_html()}
            </td>
            <td style="vertical-align: middle; color: #666; font-size: 13px;">
            {branding.hr_signature_html()}
            </td>
        </tr>
        </table>
    </td>
    </tr>
</table>
</body>
</html>"""

        plain_message = f"""Thân gửi bạn {full_name},

Phòng Hành chính Nhân sự gửi đến bạn thông tin tài khoản đăng nhập hệ thống HRM.

1. Thông tin tài khoản
- Username: {user.username}
- Password: {password_display}

⚠️ LƯU Ý QUAN TRỌNG: Vui lòng đổi mật khẩu ngay sau khi đăng nhập lần đầu.

2. Link website HRM
- {branding.portal_url()}

3. Hướng dẫn sử dụng website HRM
- Tài liệu hướng dẫn: {guide_url}

Nếu bạn gặp khó khăn, vui lòng liên hệ Phòng HCNS.

Trân trọng!
{branding.hr_signature_text('')}"""

        # Send via Gmail API
        success = send_email_via_gmail(
            to=recipient_email,
            subject=subject,
            body=plain_message,
            html_body=html_message
        )

        if success:
            logger.info(f"✅ Sent account info email to {recipient_email} via Gmail API")
            return True
        else:
            logger.error(f"❌ Failed to send account info email to {recipient_email} via Gmail API")
            return False

    except Exception as e:
        logger.error(f"❌ Failed to send account info email to {recipient_email}: {str(e)}")
        return False
class ContractTemplateSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    contract_type_display = serializers.CharField(source='get_contract_type_display', read_only=True)
    company_unit_name = serializers.SerializerMethodField()
    company_unit_code = serializers.SerializerMethodField()
    file = serializers.SerializerMethodField()

    class Meta:
        model = ContractTemplate
        fields = ['id', 'name', 'contract_type', 'contract_type_display',
                  'company_unit', 'company_unit_name', 'company_unit_code',
                  'file', 'description', 'status', 'is_default', 'created_by_name',
                  'created_at', 'updated_at']

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return None
        try:
            return obj.created_by.employee.full_name
        except Exception:
            full = f"{obj.created_by.first_name} {obj.created_by.last_name}".strip()
            return full or obj.created_by.username

    def get_company_unit_name(self, obj):
        return obj.company_unit.name if obj.company_unit else None

    def get_company_unit_code(self, obj):
        return obj.company_unit.code if obj.company_unit else None
    
    def get_file(self, obj):
        """✅ Generate presigned GET URL from S3"""
        if not obj.file:
            return None
        
        from django.conf import settings
        import boto3
        import logging
        
        logger = logging.getLogger(__name__)
        
        try:
            file_key = str(obj.file)
            
            # Create S3 client
            s3_client = boto3.client(
                's3',
                endpoint_url=settings.CLOUDFLY_S3_ENDPOINT,
                aws_access_key_id=settings.CLOUDFLY_ACCESS_KEY,
                aws_secret_access_key=settings.CLOUDFLY_SECRET_KEY,
                region_name=settings.CLOUDFLY_REGION,
            )
            
            # Generate presigned GET URL
            presigned_url = s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': settings.CLOUDFLY_BUCKET,
                    'Key': file_key
                },
                ExpiresIn=3600*24*7,  # 7 days
            )
            
            logger.info(f"Generated presigned GET URL for: {file_key}")
            return presigned_url
            
        except Exception as e:
            logger.error(f"Error generating file URL: {e}", exc_info=True)
            # Fallback - nếu error thì trả về direct S3 URL
            return f"{settings.CLOUDFLY_S3_ENDPOINT}/{settings.CLOUDFLY_BUCKET}/{obj.file}"

class EmployeeContractSerializer(serializers.ModelSerializer):
    contract_type_display = serializers.CharField(source='get_contract_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_department = serializers.CharField(source='employee.department.name', read_only=True)
    employee_position = serializers.CharField(source='employee.position.title', read_only=True)
    template_name = serializers.CharField(source='template.name', read_only=True)
    is_expiring_soon = serializers.SerializerMethodField()
    generated_file_url = serializers.SerializerMethodField()
    signed_file_url = serializers.SerializerMethodField()
    company_unit_name = serializers.SerializerMethodField()
    class Meta:
        model = EmployeeContract
        fields = ['id', 'onboarding_process', 'employee', 'employee_name', 'employee_code',
              'employee_department', 'employee_position',
                  'template', 'template_name', 'contract_type', 'contract_type_display',
                  'status', 'status_display', 'generated_file', 'generated_file_url',
                  'signed_file', 'signed_file_url',
                  'employee_signed_at', 'hr_signed_at',
                  'start_date', 'end_date', 'notes',
                  'is_expiring_soon', 'created_at', 'updated_at',
                  'company_unit', 'company_unit_name', 'contract_number',]
        extra_kwargs = {
            'onboarding_process': {'required': False, 'allow_null': True},
        }

    def get_company_unit_name(self, obj):
        return obj.company_unit.name if obj.company_unit else None

    def get_is_expiring_soon(self, obj):
        return obj.is_expiring_soon()

    def get_signed_file_url(self, obj):
        if obj.signed_file:
            return get_cloudfly_presigned_url(str(obj.signed_file))
        return None
    
    def get_generated_file_url(self, obj):
        if not obj.generated_file:
            return None
        return get_cloudfly_presigned_url(str(obj.generated_file))


# ======================
# GENERIC REQUEST SERIALIZER
# ======================

class GenericRequestSerializer(serializers.ModelSerializer):
    request_type_display = serializers.CharField(source='get_request_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_department = serializers.CharField(source='employee.department.name', read_only=True, default=None)
    employee_position = serializers.CharField(source='employee.position.title', read_only=True, default=None)
    manager_approved_by_name = serializers.CharField(source='manager_approved_by.full_name', read_only=True, default=None)
    admin_approved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = GenericRequest
        fields = [
            'id', 'request_code', 'request_type', 'request_type_display',
            'title', 'reason', 'expected_date', 'extra_data',
            'attachment', 'status', 'status_display',
            'employee', 'employee_name', 'employee_code',
            'employee_department', 'employee_position',
            'submitted_at', 'approved_at', 'created_at', 'updated_at',
            # Approval workflow tracking
            'manager_approved_at', 'manager_approved_by', 'manager_approved_by_name',
            'admin_approved_at', 'admin_approved_by', 'admin_approved_by_name',
            'rejected_level', 'approval_note', 'rejected_at',
        ]
        read_only_fields = [
            'request_code', 'status', 'employee', 'employee_name', 'employee_code',
            'submitted_at', 'approved_at', 'created_at', 'updated_at',
            'manager_approved_at', 'manager_approved_by', 'manager_approved_by_name',
            'admin_approved_at', 'admin_approved_by', 'admin_approved_by_name',
            'rejected_level', 'rejected_at',
        ]

    def get_admin_approved_by_name(self, obj):
        if not obj.admin_approved_by:
            return None
        try:
            emp = obj.admin_approved_by.employee
            return emp.full_name
        except Exception:
            u = obj.admin_approved_by
            return f"{u.first_name} {u.last_name}".strip() or u.username

    # ------------------------------------------------------------------
    # SALARY_ADVANCE specific validation
    # ------------------------------------------------------------------
    SALARY_ADVANCE_OFFICIAL_CONTRACTS = OFFICIAL_LABOR_CONTRACT_TYPES
    SALARY_ADVANCE_MAX_AMOUNT = 5_000_000
    SALARY_ADVANCE_MAX_RATIO = 0.8
    # Khung tạo đơn tạm ứng (yêu cầu HCNS 2026-10-03): từ 00:00 ngày 1 đến
    # 15:30 ngày 3 hàng tháng (giờ VN), sau đó khoá — Admin vẫn mở khoá được
    # qua SalaryAdvanceCreationLock.
    SALARY_ADVANCE_CREATE_LAST_DAY = 3
    SALARY_ADVANCE_CREATE_CUTOFF = (15, 30)

    @classmethod
    def is_salary_advance_creation_window_open(cls, now=None) -> bool:
        from datetime import time as _time
        from django.utils import timezone as _tz
        # Giờ địa phương, KHÔNG dùng now().date() (UTC) — trước đây 00:00-07:00
        # ngày 1 bị chặn nhầm còn 00:00-07:00 ngày 4 lại lọt.
        local = _tz.localtime(now or _tz.now())
        if local.day < cls.SALARY_ADVANCE_CREATE_LAST_DAY:
            return True
        if local.day == cls.SALARY_ADVANCE_CREATE_LAST_DAY:
            return local.time() <= _time(*cls.SALARY_ADVANCE_CREATE_CUTOFF)
        return False

    def validate(self, attrs):
        attrs = super().validate(attrs) if hasattr(super(), 'validate') else attrs
        request_type = attrs.get('request_type') or getattr(self.instance, 'request_type', None)
        if request_type == 'SALARY_ADVANCE':
            self._validate_salary_advance(attrs)
        return attrs

    def _validate_salary_advance(self, attrs):
        from django.utils import timezone as _tz
        from hrm.models import GenericRequest as _GR

        is_create = self.instance is None
        request = self.context.get('request')
        extra = attrs.get('extra_data') if 'extra_data' in attrs else (
            getattr(self.instance, 'extra_data', None) or {}
        )
        amount = extra.get('amount') if isinstance(extra, dict) else None

        # Amount luôn validate (cả create + update)
        if amount is None or amount == '':
            raise serializers.ValidationError({
                'extra_data': ['Vui lòng nhập số tiền tạm ứng (extra_data.amount).']
            })
        try:
            amount = int(float(amount))
        except (TypeError, ValueError):
            raise serializers.ValidationError({
                'extra_data': ['Số tiền tạm ứng phải là số.']
            })
        if amount <= 0:
            raise serializers.ValidationError({
                'extra_data': ['Số tiền tạm ứng phải lớn hơn 0.']
            })
        if amount > self.SALARY_ADVANCE_MAX_AMOUNT:
            raise serializers.ValidationError({
                'extra_data': [
                    f'Số tiền tạm ứng không vượt quá {self.SALARY_ADVANCE_MAX_AMOUNT:,}đ.'
                ]
            })

        # Các check phụ thuộc employee — lấy từ instance (update) hoặc request.user (create)
        employee = None
        if self.instance is not None:
            employee = self.instance.employee
        elif request is not None:
            from employee.models import Employee as _Emp
            employee = _Emp.objects.filter(user=request.user).first()

        if employee is not None:
            basic_salary = float(employee.basic_salary or 0)
            # Nếu NV chưa có lương cơ bản (=0): CHỈ áp cap tối đa 5M (đã check ở
            # trên), KHÔNG áp rule 80%. Trường hợp này thường xảy ra với NV mới
            # chưa được nhập lương vào hệ thống.
            if basic_salary > 0:
                cap_80 = int(basic_salary * self.SALARY_ADVANCE_MAX_RATIO)
                if amount > cap_80:
                    raise serializers.ValidationError({
                        'extra_data': [
                            f'Số tiền không vượt quá 80% lương cơ bản '
                            f'({cap_80:,}đ).'
                        ]
                    })

        # Create-only rules: khung 00:00 ngày 1 - 15:30 ngày 3, contract chính thức, no resignation
        if is_create:
            if not self.is_salary_advance_creation_window_open():
                from hrm.models import SalaryAdvanceCreationLock
                if SalaryAdvanceCreationLock.get_solo().is_effectively_locked():
                    raise serializers.ValidationError({
                        'non_field_errors': [
                            'Chỉ nhận đơn tạm ứng lương từ ngày 1 đến 15h30 ngày 3 hàng tháng. '
                            'Liên hệ Admin để mở khoá nếu cần tạo đơn ngoài thời gian này.'
                        ]
                    })

            if employee is not None:
                if (employee.employment_status or '').upper() != 'ACTIVE':
                    raise serializers.ValidationError({
                        'non_field_errors': [
                            'Chỉ nhân viên đang làm việc mới được tạm ứng lương.'
                        ]
                    })
                contract = (employee.contract_type or '').upper()
                if contract not in self.SALARY_ADVANCE_OFFICIAL_CONTRACTS:
                    raise serializers.ValidationError({
                        'non_field_errors': [
                            'Chỉ nhân viên chính thức (hợp đồng 12 tháng, 24 tháng hoặc vô thời hạn) mới được tạm ứng lương.'
                        ]
                    })
                # Đang có đơn xin nghỉ việc (PENDING_*/APPROVED) → chặn
                BLOCKING_STATUSES = ['PENDING_MANAGER', 'PENDING_ADMIN', 'APPROVED']
                has_resignation = _GR.objects.filter(
                    employee=employee,
                    request_type='RESIGNATION',
                    status__in=BLOCKING_STATUSES,
                    is_deleted=False,
                ).exists()
                if has_resignation:
                    raise serializers.ValidationError({
                        'non_field_errors': [
                            'Bạn đang có đơn xin nghỉ việc, không thể tạm ứng lương.'
                        ]
                    })

                # Mỗi NV chỉ được 1 đơn SALARY_ADVANCE / tháng (theo tháng tạo).
                # Loại trừ REJECTED/CANCELLED để NV có thể tạo lại sau khi bị từ chối.
                today = _tz.now()
                MONTHLY_BLOCKING = ['DRAFT', 'PENDING_MANAGER', 'PENDING_ADMIN', 'APPROVED']
                has_active_this_month = _GR.objects.filter(
                    employee=employee,
                    request_type='SALARY_ADVANCE',
                    status__in=MONTHLY_BLOCKING,
                    is_deleted=False,
                    created_at__year=today.year,
                    created_at__month=today.month,
                ).exists()
                if has_active_this_month:
                    raise serializers.ValidationError({
                        'non_field_errors': [
                            'Bạn đã có đơn tạm ứng lương trong tháng này. '
                            'Mỗi nhân viên chỉ được làm 1 đơn / tháng.'
                        ]
                    })


# ======================
# REQUEST TEMPLATE SERIALIZER
# ======================

class RequestTemplateSerializer(serializers.ModelSerializer):
    request_type_display = serializers.CharField(source='get_request_type_display', read_only=True)
    company_unit_name = serializers.CharField(source='company_unit.name', read_only=True)
    company_unit_code = serializers.CharField(source='company_unit.code', read_only=True)
    file_url = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source='created_by.username', read_only=True)
    file_size = serializers.SerializerMethodField()

    class Meta:
        model = RequestTemplate
        fields = [
            'id', 'name', 'request_type', 'request_type_display',
            'company_unit', 'company_unit_name', 'company_unit_code',
            'file', 'file_url', 'file_size', 'description', 'is_active',
            'created_by', 'created_by_name', 'created_by_username',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'created_by']
        # Override validators để tránh UniqueTogetherValidator mặc định (tiếng Anh).
        # Tự validate trong validate() để trả message tiếng Việt.
        validators = []

    def validate(self, attrs):
        """Validate unique cặp (request_type, company_unit) với message tiếng Việt."""
        request_type = attrs.get('request_type') or getattr(self.instance, 'request_type', None)
        company_unit = attrs.get('company_unit') or getattr(self.instance, 'company_unit', None)

        if request_type and company_unit:
            qs = RequestTemplate.objects.filter(
                request_type=request_type,
                company_unit=company_unit,
            )
            if self.instance is not None:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'non_field_errors': [
                        'Đã tồn tại template cho cặp Loại đơn + Đơn vị này. '
                        'Vui lòng chọn đơn vị khác hoặc chỉnh sửa template cũ.'
                    ]
                })
        return attrs

    def get_file_url(self, obj):
        request = self.context.get('request')
        if obj.file and request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url if obj.file else None

    def get_created_by_name(self, obj):
        if not obj.created_by:
            return None
        try:
            emp = obj.created_by.employee
            return emp.full_name
        except Exception:
            return f"{obj.created_by.first_name} {obj.created_by.last_name}".strip() or obj.created_by.username

    def get_file_size(self, obj):
        try:
            return obj.file.size if obj.file else 0
        except Exception:
            return 0


# ─────────────────────────────────────────────────────────────
# Livestream Allowance Config Serializer
# ─────────────────────────────────────────────────────────────

class LivestreamAllowanceConfigSerializer(serializers.ModelSerializer):
    department_names = serializers.SerializerMethodField()
    
    class Meta:
        model = None  # Will be set in __init__
        fields = [
            'id', 'code', 'name', 'description', 'amount_per_session',
            'apply_to_all', 'apply_to_departments', 'department_names',
            'effective_from', 'effective_to', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Dynamically set model to avoid circular import
        from hrm.attendance_models import LivestreamAllowanceConfig
        self.Meta.model = LivestreamAllowanceConfig
    
    def get_department_names(self, obj):
        dept_names = []
        if hasattr(obj, 'apply_to_departments'):
            for dept in obj.apply_to_departments.all():
                dept_names.append({'id': dept.id, 'name': dept.name})
        return dept_names


class OnlineWorkQuotaOverrideSerializer(serializers.ModelSerializer):
    """Một dòng ghi đè hạn mức ngày làm online — ĐÚNG 1 trong 3: nhân viên, vị trí, phòng ban."""
    employee_detail = serializers.SerializerMethodField()
    position_detail = serializers.SerializerMethodField()
    department_detail = serializers.SerializerMethodField()

    class Meta:
        model = OnlineWorkQuotaOverride
        fields = [
            'id', 'employee', 'position', 'department', 'max_online_days',
            'employee_detail', 'position_detail', 'department_detail', 'updated_at',
        ]
        read_only_fields = ['updated_at']

    def get_employee_detail(self, obj):
        if not obj.employee:
            return None
        return {'id': obj.employee.id, 'employee_id': obj.employee.employee_id, 'full_name': obj.employee.full_name}

    def get_position_detail(self, obj):
        return {'id': obj.position.id, 'title': obj.position.title} if obj.position else None

    def get_department_detail(self, obj):
        return {'id': obj.department.id, 'name': obj.department.name} if obj.department else None

    def validate(self, data):
        scopes = [data.get(f, getattr(self.instance, f, None)) for f in ('employee', 'position', 'department')]
        if sum(1 for v in scopes if v is not None) != 1:
            raise serializers.ValidationError("Phải chọn đúng 1 trong 3: nhân viên, vị trí hoặc phòng ban.")
        return data


class ChildCareRegimeSerializer(serializers.ModelSerializer):
    """Một người hưởng chế độ con nhỏ trong một khoảng ngày."""
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    department_name = serializers.SerializerMethodField()

    class Meta:
        model = ChildCareRegime
        fields = ['id', 'employee', 'employee_code', 'employee_name', 'department_name',
                  'start_date', 'end_date', 'allowance_minutes', 'note', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def get_department_name(self, obj):
        return obj.employee.department.name if obj.employee.department_id else None

    def validate(self, attrs):
        employee = attrs.get('employee', getattr(self.instance, 'employee', None))
        start = attrs.get('start_date', getattr(self.instance, 'start_date', None))
        end = attrs.get('end_date', getattr(self.instance, 'end_date', None))
        if start and end and end < start:
            raise serializers.ValidationError({'end_date': 'Đến ngày phải sau hoặc bằng Từ ngày.'})
        if employee and start:
            overlap = ChildCareRegime.objects.filter(employee=employee).filter(
                Q(end_date__isnull=True) | Q(end_date__gte=start)
            )
            if end:
                overlap = overlap.filter(start_date__lte=end)
            if self.instance is not None:
                overlap = overlap.exclude(pk=self.instance.pk)
            if overlap.exists():
                raise serializers.ValidationError({
                    'start_date': f'{employee.full_name} đã có chế độ con nhỏ trùng khoảng ngày này.',
                })
        return attrs

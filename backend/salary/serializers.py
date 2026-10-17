"""
salary/serializers.py – DRF serializers cho Payroll module.
"""
from rest_framework import serializers

from .models import MonthlySalaryRecord, SalaryComponent, SalaryFormula, SalaryComponentOverride
from .salary_data_models import EmployeeSalaryHistory, EmployeeKPIRecord, TaxBracketConfig, TaxBracket, DisciplinaryPenalty, SalesCommission, OvertimeRateConfig, SalaryAdvance, OtherAllowance, ParkingAllowanceOverride, LunchAllowanceOverride, EmployeeMonthlySalaryInput, MissingWorkdayPenalty
from employee.models import Department, Position, Employee as EmployeeModel


# ---------------------------------------------------------------------------
# SalaryComponent
# ---------------------------------------------------------------------------

class SalaryComponentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalaryComponent
        fields = [
            'id', 'formula', 'name', 'code', 'component_type', 'calc_method',
            'fixed_amount', 'percentage', 'expression', 'order', 'is_active', 'is_deduction',
        ]
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# SalaryFormula
# ---------------------------------------------------------------------------

class SalaryFormulaSerializer(serializers.ModelSerializer):
    components = SalaryComponentSerializer(many=True, read_only=True)

    class Meta:
        model = SalaryFormula
        fields = [
            'id', 'name', 'code', 'description',
            'apply_to_all',
            'apply_to_departments', 'apply_to_positions', 'apply_to_employees',
            'effective_from', 'effective_to',
            'is_active', 'priority',
            'components',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class SalaryFormulaListSerializer(serializers.ModelSerializer):
    """Serializer gọn cho danh sách (không kèm components)."""
    class Meta:
        model = SalaryFormula
        fields = [
            'id', 'name', 'code', 'apply_to_all',
            'effective_from', 'effective_to', 'is_active', 'priority',
            'created_at',
        ]


# ---------------------------------------------------------------------------
# MonthlySalaryRecord
# ---------------------------------------------------------------------------

class MonthlySalaryRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    formula_code = serializers.CharField(source='formula_used.code', read_only=True, default=None)

    class Meta:
        model = MonthlySalaryRecord
        fields = [
            'id', 'salary_code',
            'employee', 'employee_name',
            'year', 'month',
            'work_credit',
            'formula_used', 'formula_code',
            'formula_snapshot', 'input_snapshot',
            'gross_salary', 'total_deduction', 'net_salary',
            'components_detail', 'applied_rules',
            'status', 'notes',
            'approved_by', 'approved_at',
            'paid_at', 'payment_ref',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'salary_code',
            'formula_snapshot', 'input_snapshot',
            'gross_salary', 'total_deduction', 'net_salary',
            'components_detail', 'applied_rules',
            'approved_at', 'paid_at',
            'created_at', 'updated_at',
        ]


class MonthlySalaryRecordListSerializer(serializers.ModelSerializer):
    """Serializer gọn cho danh sách bảng lương."""
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)

    class Meta:
        model = MonthlySalaryRecord
        fields = [
            'id', 'salary_code',
            'employee', 'employee_name',
            'year', 'month',
            'gross_salary', 'total_deduction', 'net_salary',
            'status',
            'created_at',
        ]


# ---------------------------------------------------------------------------
# SalaryComponentOverride
# ---------------------------------------------------------------------------

class SalaryComponentOverrideSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)

    class Meta:
        model = SalaryComponentOverride
        fields = [
            'id', 'employee', 'employee_name', 'year', 'month',
            'component_code', 'component_name', 'component_type',
            'amount', 'is_addition', 'notes',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


# ---------------------------------------------------------------------------
# EmployeeSalaryHistory
# ---------------------------------------------------------------------------

class EmployeeSalaryHistorySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)

    class Meta:
        model = EmployeeSalaryHistory
        fields = [
            'id', 'employee', 'employee_name',
            'basic_salary', 'allowance',
            'effective_from', 'effective_to',
            'notes', 'created_by',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


# ---------------------------------------------------------------------------
# EmployeeKPIRecord
# ---------------------------------------------------------------------------

class EmployeeKPIRecordSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = EmployeeKPIRecord
        fields = [
            'id', 'employee', 'employee_name', 'employee_code', 'year', 'month',
            'kpi_score', 'revenue', 'kpi_bonus_amount', 'commission_amount',
            'notes', 'created_by',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'employee_name', 'employee_code', 'created_at', 'updated_at']


# ---------------------------------------------------------------------------
# DisciplinaryPenalty
# ---------------------------------------------------------------------------

class DisciplinaryPenaltySerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True, default=None)
    company_unit_name = serializers.CharField(source='employee.company_unit.name', read_only=True, default=None)
    created_by_name = serializers.CharField(source='created_by.full_name', read_only=True)
    direct_manager_approved_by_name = serializers.CharField(source='direct_manager_approved_by.full_name', read_only=True)
    approved_by_name = serializers.CharField(source='approved_by.full_name', read_only=True)
    rejected_by_name = serializers.CharField(source='rejected_by.full_name', read_only=True)

    class Meta:
        model = DisciplinaryPenalty
        fields = [
            'id', 'employee', 'employee_name', 'employee_code', 'department_name', 'company_unit_name',
            'year', 'month', 'amount', 'status', 'reason', 'notes',
            'created_by', 'created_by_name',
            'direct_manager_approved_by', 'direct_manager_approved_by_name',
            'direct_manager_approved_at',
            'approved_by', 'approved_by_name', 'approved_at',
            'rejected_by', 'rejected_by_name', 'rejected_at',
            'approval_note',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'employee_name', 'employee_code', 'department_name', 'company_unit_name',
            'created_by_name', 'direct_manager_approved_by_name',
            'approved_by_name', 'rejected_by_name',
            'created_at', 'updated_at'
        ]


class BulkImportPenaltyItemSerializer(serializers.Serializer):
    employee_code = serializers.CharField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    reason = serializers.CharField(default='', allow_blank=True)


class BulkImportPenaltySerializer(serializers.Serializer):
    year    = serializers.IntegerField(min_value=2000, max_value=2100)
    month   = serializers.IntegerField(min_value=1, max_value=12)
    records = serializers.ListField(child=BulkImportPenaltyItemSerializer(), min_length=1)


# ---------------------------------------------------------------------------
# SalaryAdvance
# ---------------------------------------------------------------------------

class SalaryAdvanceSerializer(serializers.ModelSerializer):
    employee_name   = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code   = serializers.CharField(source='employee.employee_id', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True, default=None)
    manager_name    = serializers.CharField(source='employee.manager.full_name', read_only=True, default=None)
    start_date      = serializers.DateField(source='employee.start_date', read_only=True, default=None)
    basic_salary    = serializers.DecimalField(source='employee.basic_salary', max_digits=12, decimal_places=2, read_only=True, default=None)
    region          = serializers.CharField(source='employee.region', read_only=True, default=None)
    bank_account    = serializers.CharField(source='employee.bank_account', read_only=True, default=None)
    bank_name       = serializers.CharField(source='employee.bank_name', read_only=True, default=None)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        user = getattr(request, 'user', None)

        # Lương cứng là dữ liệu nhạy cảm: chỉ ADMIN được nhận từ API.
        if not user or not user.is_authenticated:
            data.pop('basic_salary', None)
        else:
            from users.utils import get_user_role
            if not (user.is_superuser or get_user_role(user) == 'admin'):
                data.pop('basic_salary', None)

        return data

    class Meta:
        model = SalaryAdvance
        fields = [
            'id', 'employee',
            'employee_name', 'employee_code', 'department_name', 'manager_name',
            'start_date', 'basic_salary', 'region', 'bank_account', 'bank_name',
            'year', 'month', 'amount', 'notes',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'employee_name', 'employee_code', 'department_name', 'manager_name',
            'start_date', 'basic_salary', 'region', 'bank_account', 'bank_name',
            'created_at', 'updated_at',
        ]


class BulkImportAdvanceItemSerializer(serializers.Serializer):
    employee_code = serializers.CharField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)


class BulkImportAdvanceSerializer(serializers.Serializer):
    year    = serializers.IntegerField(min_value=2000, max_value=2100)
    month   = serializers.IntegerField(min_value=1, max_value=12)
    records = serializers.ListField(child=BulkImportAdvanceItemSerializer(), min_length=1)


# ---------------------------------------------------------------------------
# OtherAllowance
# ---------------------------------------------------------------------------

class OtherAllowanceSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = OtherAllowance
        fields = [
            'id', 'employee', 'employee_name', 'employee_code',
            'year', 'month', 'amount', 'description', 'notes',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'employee_name', 'employee_code', 'created_at', 'updated_at']


class BulkImportOtherAllowanceItemSerializer(serializers.Serializer):
    employee_code = serializers.CharField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    description = serializers.CharField(default='', allow_blank=True)


class BulkImportOtherAllowanceSerializer(serializers.Serializer):
    year    = serializers.IntegerField(min_value=2000, max_value=2100)
    month   = serializers.IntegerField(min_value=1, max_value=12)
    records = serializers.ListField(child=BulkImportOtherAllowanceItemSerializer(), min_length=1)


# ---------------------------------------------------------------------------
# ParkingAllowanceOverride
# ---------------------------------------------------------------------------

class ParkingAllowanceOverrideSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = ParkingAllowanceOverride
        fields = [
            'id', 'employee', 'employee_name', 'employee_code',
            'year', 'month', 'amount', 'notes',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'employee_name', 'employee_code', 'created_at', 'updated_at']


class BulkImportParkingAllowanceItemSerializer(serializers.Serializer):
    employee_code = serializers.CharField()
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)
    notes = serializers.CharField(default='', allow_blank=True)


class BulkImportParkingAllowanceSerializer(serializers.Serializer):
    year    = serializers.IntegerField(min_value=2000, max_value=2100)
    month   = serializers.IntegerField(min_value=1, max_value=12)
    records = serializers.ListField(child=BulkImportParkingAllowanceItemSerializer(), min_length=1)


# ---------------------------------------------------------------------------
# LunchAllowanceOverride (bulk-import dùng chung BulkImportParkingAllowanceSerializer
# vì cùng dạng dữ liệu: year, month, records[employee_code, amount, notes])
# ---------------------------------------------------------------------------

class LunchAllowanceOverrideSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = LunchAllowanceOverride
        fields = [
            'id', 'employee', 'employee_name', 'employee_code',
            'year', 'month', 'amount', 'notes',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'employee_name', 'employee_code', 'created_at', 'updated_at']


# ---------------------------------------------------------------------------
# TaxBracket + TaxBracketConfig
# ---------------------------------------------------------------------------

class TaxBracketSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxBracket
        fields = ['id', 'config', 'order', 'min_income', 'max_income', 'rate']
        read_only_fields = ['id']


class TaxBracketConfigSerializer(serializers.ModelSerializer):
    brackets = TaxBracketSerializer(many=True, read_only=True)

    class Meta:
        model = TaxBracketConfig
        fields = [
            'id', 'name', 'effective_from', 'effective_to', 'is_active',
            'personal_deduction', 'dependent_deduction',
            'brackets',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


# ---------------------------------------------------------------------------
# SalesCommission
# ---------------------------------------------------------------------------

class SalesCommissionSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = SalesCommission
        fields = [
            'id', 'employee', 'employee_name', 'employee_code',
            'year', 'month', 'amount', 'notes',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'employee_name', 'employee_code', 'created_at', 'updated_at']


class BulkImportCommissionItemSerializer(serializers.Serializer):
    employee_code     = serializers.CharField()
    commission_amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=0)


class BulkImportCommissionSerializer(serializers.Serializer):
    year    = serializers.IntegerField(min_value=2000, max_value=2100)
    month   = serializers.IntegerField(min_value=1, max_value=12)
    records = serializers.ListField(child=BulkImportCommissionItemSerializer(), min_length=1)


# ---------------------------------------------------------------------------
# EmployeeMonthlySalaryInput
# ---------------------------------------------------------------------------

class EmployeeMonthlySalaryInputSerializer(serializers.ModelSerializer):
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)

    class Meta:
        model = EmployeeMonthlySalaryInput
        fields = [
            'id', 'employee', 'employee_name', 'employee_code',
            'year', 'month',
            'luong_doanh_so', 'luong_ot', 'ban_san_pham', 'phu_mo', 'truc_ca', 'thuong',
            'notes',
            'created_by', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'employee_name', 'employee_code', 'created_at', 'updated_at']


class BulkImportEmployeeMonthlySalaryInputItemSerializer(serializers.Serializer):
    employee_code = serializers.CharField()
    luong_doanh_so = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    luong_ot = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    ban_san_pham = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    phu_mo = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    truc_ca = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    thuong = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)


class BulkImportEmployeeMonthlySalaryInputSerializer(serializers.Serializer):
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)
    records = serializers.ListField(child=BulkImportEmployeeMonthlySalaryInputItemSerializer(), min_length=1)


# ---------------------------------------------------------------------------
# OvertimeRateConfig
# ---------------------------------------------------------------------------

class OvertimeRateConfigSerializer(serializers.ModelSerializer):
    department_ids   = serializers.PrimaryKeyRelatedField(source='departments', many=True, queryset=Department.objects.all())
    department_names = serializers.SerializerMethodField()
    position_ids     = serializers.PrimaryKeyRelatedField(source='positions', many=True, queryset=Position.objects.all())
    position_names   = serializers.SerializerMethodField()
    employee_ids     = serializers.PrimaryKeyRelatedField(source='employees', many=True, queryset=EmployeeModel.objects.all())
    employee_names   = serializers.SerializerMethodField()

    class Meta:
        model  = OvertimeRateConfig
        fields = [
            'id',
            'department_ids', 'department_names',
            'position_ids',   'position_names',
            'employee_ids',   'employee_names',
            'apply_to_all',
            'calc_method', 'rate_per_hour', 'multiplier', 'use_kpi', 'kpi_multiplier', 'kpi_rate_per_hour', 'kpi_threshold',
            'effective_from', 'effective_to',
            'is_active', 'notes', 'created_at', 'updated_at',
        ]

    def get_department_names(self, obj):
        return list(obj.departments.values_list('name', flat=True))

    def get_position_names(self, obj):
        return list(obj.positions.values_list('title', flat=True))

    def get_employee_names(self, obj):
        return [
            {'id': e.id, 'name': e.full_name, 'code': e.employee_id}
            for e in obj.employees.all()
        ]


# ---------------------------------------------------------------------------
# Action serializers
# ---------------------------------------------------------------------------

class CalculateSalarySerializer(serializers.Serializer):
    """Input để tính lương cho một nhân viên."""
    employee_id = serializers.IntegerField()
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)
    work_credit_id = serializers.IntegerField(required=False, allow_null=True)


class UpdateSalaryStandardWorkDaysSerializer(serializers.Serializer):
    """Input để cập nhật công chuẩn của một phiếu lương."""
    employee_id = serializers.IntegerField()
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)
    standard_work_days_mode = serializers.ChoiceField(
        choices=['DEFAULT', 'FULL_MONTH'],
    )


class BulkCalculateSalarySerializer(serializers.Serializer):
    """Input để tính lương hàng loạt (toàn bộ tháng)."""
    year = serializers.IntegerField(min_value=2000, max_value=2100)
    month = serializers.IntegerField(min_value=1, max_value=12)
    department_id = serializers.IntegerField(required=False, allow_null=True)
    employee_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, allow_empty=True)


class ApproveSalarySerializer(serializers.Serializer):
    """Input để duyệt bảng lương."""
    note = serializers.CharField(required=False, allow_blank=True, default='')


class MarkPaidSerializer(serializers.Serializer):
    """Input để đánh dấu đã thanh toán."""
    payment_ref = serializers.CharField(required=False, allow_blank=True, default='')


class MissingWorkdayPenaltySerializer(serializers.ModelSerializer):
    """1 nhân viên trong danh sách phạt thiếu công, áp dụng từ tháng … đến tháng."""
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    department_name = serializers.CharField(source='employee.department.name', read_only=True, default=None)
    has_basic_salary = serializers.SerializerMethodField()

    class Meta:
        model = MissingWorkdayPenalty
        fields = ['id', 'employee', 'employee_code', 'employee_name', 'department_name', 'has_basic_salary',
                  'from_month', 'to_month', 'base_amount', 'note', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']

    def get_has_basic_salary(self, obj):
        return bool(obj.employee.basic_salary)

    def validate_base_amount(self, value):
        if value is None or value <= 0:
            raise serializers.ValidationError("Mốc lương phải lớn hơn 0.")
        return value

    def validate(self, attrs):
        from django.db.models import Q
        employee = attrs.get('employee', getattr(self.instance, 'employee', None))
        start = attrs.get('from_month', getattr(self.instance, 'from_month', None))
        end = attrs.get('to_month', getattr(self.instance, 'to_month', None))
        start = start.replace(day=1) if start else None
        end = end.replace(day=1) if end else None
        if start and end and end < start:
            raise serializers.ValidationError({'to_month': 'Đến tháng phải sau hoặc bằng Từ tháng.'})
        if employee and start:
            overlap = MissingWorkdayPenalty.objects.filter(employee=employee).filter(
                Q(to_month__isnull=True) | Q(to_month__gte=start)
            )
            if end:
                overlap = overlap.filter(from_month__lte=end)
            if self.instance is not None:
                overlap = overlap.exclude(pk=self.instance.pk)
            if overlap.exists():
                raise serializers.ValidationError({
                    'from_month': f'{employee.full_name} đã có trong danh sách phạt thiếu công ở khoảng tháng này.',
                })
        return attrs

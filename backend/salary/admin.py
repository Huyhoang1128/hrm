from django.contrib import admin

from .models import MonthlySalaryRecord, SalaryComponent, SalaryFormula, SalaryComponentOverride
from .salary_data_models import EmployeeSalaryHistory, EmployeeKPIRecord, TaxBracketConfig, TaxBracket, DisciplinaryPenalty, SalesCommission, OvertimeRateConfig, SalaryAdvance, OtherAllowance, EmployeeMonthlySalaryInput, MissingWorkdayPenalty


class SalaryComponentInline(admin.TabularInline):
    model = SalaryComponent
    extra = 1
    fields = ('code', 'name', 'component_type', 'calc_method',
              'fixed_amount', 'percentage', 'expression', 'order', 'is_active', 'is_deduction')


@admin.register(SalaryFormula)
class SalaryFormulaAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'priority', 'is_active', 'effective_from', 'effective_to')
    list_filter = ('is_active',)
    search_fields = ('code', 'name')
    inlines = [SalaryComponentInline]
    filter_horizontal = ('apply_to_departments', 'apply_to_positions', 'apply_to_employees')


@admin.register(SalaryComponent)
class SalaryComponentAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'formula', 'component_type', 'calc_method', 'order', 'is_active', 'is_deduction')
    list_filter = ('component_type', 'calc_method', 'is_active')
    search_fields = ('code', 'name')


@admin.register(MonthlySalaryRecord)
class MonthlySalaryRecordAdmin(admin.ModelAdmin):
    list_display = ('salary_code', 'employee', 'year', 'month',
                    'gross_salary', 'total_deduction', 'net_salary', 'status')
    list_filter = ('status', 'year', 'month')
    search_fields = ('salary_code', 'employee__full_name')
    readonly_fields = ('salary_code', 'formula_snapshot', 'input_snapshot',
                       'components_detail', 'applied_rules',
                       'gross_salary', 'total_deduction', 'net_salary',
                       'created_at', 'updated_at')


@admin.register(SalaryComponentOverride)
class SalaryComponentOverrideAdmin(admin.ModelAdmin):
    list_display = ('employee', 'year', 'month', 'component_code', 'component_name',
                    'component_type', 'amount', 'is_addition', 'created_by')
    list_filter = ('year', 'month', 'component_type', 'is_addition')
    search_fields = ('employee__full_name', 'component_code', 'component_name')
    raw_id_fields = ('employee', 'created_by')


@admin.register(EmployeeSalaryHistory)
class EmployeeSalaryHistoryAdmin(admin.ModelAdmin):
    list_display = ('employee', 'basic_salary', 'allowance', 'effective_from', 'effective_to', 'created_at')
    list_filter = ('effective_from',)
    search_fields = ('employee__full_name',)
    raw_id_fields = ('employee', 'created_by')


@admin.register(EmployeeKPIRecord)
class EmployeeKPIRecordAdmin(admin.ModelAdmin):
    list_display = ('employee', 'year', 'month', 'kpi_score', 'revenue',
                    'kpi_bonus_amount', 'commission_amount')
    list_filter = ('year', 'month')
    search_fields = ('employee__full_name',)
    raw_id_fields = ('employee', 'created_by')


class TaxBracketInline(admin.TabularInline):
    model = TaxBracket
    extra = 1
    fields = ('order', 'min_income', 'max_income', 'rate')


@admin.register(TaxBracketConfig)
class TaxBracketConfigAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'effective_from', 'effective_to',
                    'personal_deduction', 'dependent_deduction')
    list_filter = ('is_active',)
    search_fields = ('name',)
    inlines = [TaxBracketInline]


@admin.register(TaxBracket)
class TaxBracketAdmin(admin.ModelAdmin):
    list_display = ('config', 'order', 'min_income', 'max_income', 'rate')
    list_filter = ('config',)


@admin.register(SalesCommission)
class SalesCommissionAdmin(admin.ModelAdmin):
    list_display = ('employee', 'year', 'month', 'amount', 'created_at')
    list_filter = ('year', 'month')
    search_fields = ('employee__full_name', 'employee__employee_id')
    raw_id_fields = ('employee', 'created_by')


@admin.register(DisciplinaryPenalty)
class DisciplinaryPenaltyAdmin(admin.ModelAdmin):
    list_display = ('employee', 'year', 'month', 'amount', 'reason', 'created_at')
    list_filter = ('year', 'month')
    search_fields = ('employee__full_name', 'employee__employee_id', 'reason')
    raw_id_fields = ('employee', 'created_by')


@admin.register(SalaryAdvance)
class SalaryAdvanceAdmin(admin.ModelAdmin):
    list_display = ('employee', 'year', 'month', 'amount', 'created_at')
    list_filter = ('year', 'month')
    search_fields = ('employee__full_name', 'employee__employee_id', 'notes')
    raw_id_fields = ('employee', 'created_by')


@admin.register(OtherAllowance)
class OtherAllowanceAdmin(admin.ModelAdmin):
    list_display = ('employee', 'year', 'month', 'amount', 'description', 'created_at')
    list_filter = ('year', 'month')
    search_fields = ('employee__full_name', 'employee__employee_id', 'description', 'notes')
    raw_id_fields = ('employee', 'created_by')


@admin.register(EmployeeMonthlySalaryInput)
class EmployeeMonthlySalaryInputAdmin(admin.ModelAdmin):
    list_display = (
        'employee', 'year', 'month',
        'luong_doanh_so', 'luong_ot', 'ban_san_pham', 'phu_mo', 'truc_ca', 'thuong',
        'created_at'
    )
    list_filter = ('year', 'month')
    search_fields = ('employee__full_name', 'employee__employee_id')
    raw_id_fields = ('employee', 'created_by')


@admin.register(OvertimeRateConfig)
class OvertimeRateConfigAdmin(admin.ModelAdmin):
    list_display  = ('rate_per_hour', 'use_kpi', 'apply_to_all', 'effective_from', 'effective_to', 'is_active')
    list_filter   = ('is_active', 'use_kpi', 'apply_to_all')
    filter_horizontal = ('departments', 'positions', 'employees')
    raw_id_fields = ('created_by',)


@admin.register(MissingWorkdayPenalty)
class MissingWorkdayPenaltyAdmin(admin.ModelAdmin):
    list_display = ('employee', 'from_month', 'to_month', 'base_amount', 'note', 'updated_at')
    search_fields = ('employee__employee_id', 'employee__full_name')
    raw_id_fields = ('employee',)

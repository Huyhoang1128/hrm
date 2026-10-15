"""
salary_engine.py
SalaryRuleEngine: chọn SalaryFormula phù hợp và tính MonthlySalaryRecord.

Cải tiến so với phiên bản ban đầu:
  1. _build_context dùng EmployeeSalaryHistory (lương hiệu lực tại tháng tính)
     thay vì employee.basic_salary (mức hiện tại).
  2. Context bổ sung biến KPI/hoa hồng từ EmployeeKPIRecord.
  3. Context bổ sung ot_weekday_hours, ot_weekend_hours, ot_holiday_hours.
  4. _compute_components dùng is_deduction field thay vì hardcode type set.
  5. _apply_overrides merge SalaryComponentOverride sau khi tính formula.
  6. get_formula_for_employee tối ưu: tối đa 4 DB queries thay vì N queries.
  7. Validate và ghi warning vào applied_rules nếu work_credit bị thiếu.

Priority kế thừa từ AttendanceRuleEngine:
    employee-specific (4) > position (3) > department (2) > all (1)
"""
import calendar as _calendar
from datetime import date as date_type
from decimal import Decimal
from typing import Optional

from django.db import models as dj_models
from django.db.models import Sum

from .models import MonthlySalaryRecord, SalaryFormula, SalaryComponentOverride
from .salary_components import ComponentCalculator
from .salary_data_models import EmployeeSalaryHistory, EmployeeKPIRecord, TaxBracketConfig, DisciplinaryPenalty, SalesCommission, OvertimeRateConfig


# ---------------------------------------------------------------------------
# Deduction classifier
# ---------------------------------------------------------------------------

_DEFAULT_DEDUCTION_TYPES = {'DEDUCTION', 'TAX', 'INSURANCE', 'LATE_PENALTY'}


def _is_deduction(comp) -> bool:
    """
    Xác định component có là khoản khấu trừ không.
    Ưu tiên trường is_deduction nếu được set rõ ràng,
    fallback về component_type-based rule.
    """
    if comp.is_deduction is not None:
        return comp.is_deduction
    return comp.component_type in _DEFAULT_DEDUCTION_TYPES


def _is_override_deduction(component_type: str) -> bool:
    return component_type in _DEFAULT_DEDUCTION_TYPES


# ---------------------------------------------------------------------------
# Snapshot helper
# ---------------------------------------------------------------------------

def _snapshot_formula(formula: SalaryFormula) -> dict:
    """Tạo deep-copy JSON của formula để lưu audit trail."""
    return {
        'id': formula.id,
        'code': formula.code,
        'name': formula.name,
        'priority': formula.priority,
        'effective_from': str(formula.effective_from),
        'effective_to': str(formula.effective_to) if formula.effective_to else None,
        'components': [
            {
                'code': c.code,
                'name': c.name,
                'component_type': c.component_type,
                'calc_method': c.calc_method,
                'fixed_amount': float(c.fixed_amount) if c.fixed_amount is not None else None,
                'percentage': float(c.percentage) if c.percentage is not None else None,
                'expression': c.expression,
                'order': c.order,
                'is_deduction': c.is_deduction,
            }
            for c in formula.components.filter(is_active=True).order_by('order')
        ],
    }


# ---------------------------------------------------------------------------
# Context builder
# ---------------------------------------------------------------------------

def _build_context(
    employee,
    work_credit,
    year: int,
    month: int,
) -> tuple[dict, list]:
    """
    Tổng hợp các biến đầu vào cho engine.
    Trả về (ctx, warnings) – warnings là list các cảnh báo ghi vào applied_rules.
    """
    warnings: list = []
    # Dùng ngày cuối tháng để bao phủ config tạo giữa tháng
    _, days_in_month = _calendar.monthrange(year, month)
    calc_date = date_type(year, month, days_in_month)

    # --- Công chuẩn: mặc định là tổng ngày trong tháng trừ Chủ nhật và trừ thêm 1 ngày ---
    sundays = sum(1 for d in range(1, days_in_month + 1) if _calendar.weekday(year, month, d) == 6)
    default_standard_work_days = max(days_in_month - sundays - 1, 1)

    # --- Lương cơ bản: ưu tiên lịch sử lương hiệu lực tại tháng tính ---
    salary_history = EmployeeSalaryHistory.get_for_date(employee, calc_date)
    other_fixed_monthly_income = float(getattr(employee, 'other_fixed_monthly_income', 0) or 0)

    if salary_history:
        basic_salary = float(salary_history.basic_salary)
        allowance = float(salary_history.allowance)
    else:
        # Fallback về mức lương hiện tại trên Employee
        basic_salary = float(employee.basic_salary or 0)
        allowance = float(employee.allowance or 0)
        warnings.append({
            'type': 'WARNING',
            'message': (
                f"Không tìm thấy lịch sử lương cho {employee.full_name} "
                f"tại {month}/{year}. Dùng mức lương hiện tại trên hồ sơ nhân viên."
            ),
        })

    employee_default_mode = getattr(employee, 'standard_work_days_mode', 'DEFAULT') or 'DEFAULT'
    standard_work_days = default_standard_work_days
    if employee_default_mode == 'FULL_MONTH':
        standard_work_days = float(days_in_month)

    ctx: dict = {
        'basic_salary': basic_salary,
        'allowance': allowance,
        'other_fixed_monthly_income': other_fixed_monthly_income,
        'standard_work_days': standard_work_days,
        'tax_dependents': 0,
        # KPI defaults (sẽ override nếu có EmployeeKPIRecord)
        'kpi_score': 0.0,
        'revenue': 0.0,
        'kpi_bonus_amount': 0.0,
        'commission_amount': 0.0,
        # Phạt biên bản (tổng hợp từ DisciplinaryPenalty)
        'disciplinary_penalty': 0.0,
    }

    # --- Biến công / OT ---
    if work_credit:
        ctx.update({
            'work_days': float(work_credit.total_work_days),
            'work_hours': float(work_credit.total_work_hours),
            'ot_hours': float(work_credit.total_overtime_hours),
            'ot_weekday_hours': float(work_credit.ot_weekday_hours),
            'ot_weekend_hours': float(work_credit.ot_weekend_hours),
            'ot_holiday_hours': float(work_credit.ot_holiday_hours),
            'work_coefficient': float(work_credit.work_coefficient),
            'overtime_coefficient': float(work_credit.overtime_coefficient),
            'late_minutes': float(work_credit.total_late_minutes),
            'early_leave_minutes': float(work_credit.total_early_leave_minutes),
            'leave_days': float(work_credit.total_leave_days),
            'annual_leave_days': float(work_credit.annual_leave_days),
            'sick_leave_days': float(work_credit.sick_leave_days),
            'unpaid_leave_days': float(work_credit.unpaid_leave_days),
        })
    else:
        ctx.update({
            'work_days': 0.0,
            'work_hours': 0.0,
            'ot_hours': 0.0,
            'ot_weekday_hours': 0.0,
            'ot_weekend_hours': 0.0,
            'ot_holiday_hours': 0.0,
            'work_coefficient': 0.0,
            'overtime_coefficient': 0.0,
            'late_minutes': 0.0,
            'early_leave_minutes': 0.0,
            'leave_days': 0.0,
            'annual_leave_days': 0.0,
            'sick_leave_days': 0.0,
            'unpaid_leave_days': 0.0,
        })
        warnings.append({
            'type': 'WARNING',
            'message': (
                f"Không có bảng công (work_credit) cho {employee.full_name} "
                f"tháng {month}/{year}. Các biến ngày công và OT được đặt về 0."
            ),
        })

    # --- KPI / hoa hồng ---
    kpi = EmployeeKPIRecord.objects.filter(
        employee=employee, year=year, month=month
    ).first()
    if kpi:
        ctx.update({
            'kpi_score': float(kpi.kpi_score),
            'revenue': float(kpi.revenue),
            'kpi_bonus_amount': float(kpi.kpi_bonus_amount),
            'commission_amount': float(kpi.commission_amount),
        })

    # --- Hoa hồng từ SalesCommission (ưu tiên hơn KPI record) ---
    commission_rec = SalesCommission.objects.filter(
        employee=employee, year=year, month=month
    ).first()
    if commission_rec:
        ctx['commission_amount'] = float(commission_rec.amount)

    # --- Phạt biên bản (tổng hợp tất cả bản ghi trong tháng) ---
    total_penalty = DisciplinaryPenalty.objects.filter(
        employee=employee, year=year, month=month, status='APPROVED'
    ).aggregate(total=Sum('amount'))['total']
    if total_penalty:
        ctx['disciplinary_penalty'] = float(total_penalty)

    # --- Số người phụ thuộc thuế (nếu có từ hồ sơ onboarding đã liên kết) ---
    onboarding_process = getattr(employee, 'onboarding_process', None)
    if onboarding_process is not None:
        ctx['tax_dependents'] = max(int(getattr(onboarding_process, 'tax_dependents', 0) or 0), 0)

    # --- Đơn giá tăng ca ---
    ot_rate = OvertimeRateConfig.get_for_employee(
        employee, calc_date,
        kpi_score=ctx.get('kpi_score', 0.0),
        basic_salary=basic_salary,
        standard_work_days=float(standard_work_days),
    )
    ctx['ot_rate_per_hour'] = ot_rate
    ctx['ot_pay'] = round(ctx.get('ot_hours', 0.0) * ot_rate, 2)

    return ctx, warnings


def _prepare_progressive_tax_context(
    ctx: dict,
    calc_date: date_type,
    gross: Decimal,
    total_deduction: Decimal,
) -> None:
    """
    Chuẩn bị taxable income mặc định cho component PROGRESSIVE_TAX:
    taxable = gross - deduction_before_tax - personal_deduction - dependent_deduction_total.

    Nếu formula đã tự set ctx['taxable_income'] thì sẽ được ưu tiên khi tính component.
    """
    tax_cfg = TaxBracketConfig.get_for_date(calc_date) or TaxBracketConfig.get_active()
    if not tax_cfg:
        ctx['tax_bracket_config'] = None
        ctx['gross_salary'] = float(gross)
        ctx['deduction_before_tax'] = float(total_deduction)
        ctx['personal_deduction'] = 0.0
        ctx['dependent_deduction_per_person'] = 0.0
        ctx['dependent_deduction_total'] = 0.0
        ctx['auto_taxable_income'] = float(max(gross - total_deduction, Decimal('0')))
        return

    dependent_count = max(int(ctx.get('tax_dependents', 0) or 0), 0)
    personal_deduction = tax_cfg.personal_deduction or Decimal('0')
    dependent_deduction_per_person = tax_cfg.dependent_deduction or Decimal('0')
    dependent_deduction_total = dependent_deduction_per_person * Decimal(dependent_count)

    auto_taxable_income = gross - total_deduction - personal_deduction - dependent_deduction_total

    ctx['tax_bracket_config'] = tax_cfg
    ctx['gross_salary'] = float(gross)
    ctx['deduction_before_tax'] = float(total_deduction)
    ctx['personal_deduction'] = float(personal_deduction)
    ctx['dependent_deduction_per_person'] = float(dependent_deduction_per_person)
    ctx['dependent_deduction_total'] = float(dependent_deduction_total)
    ctx['auto_taxable_income'] = float(max(auto_taxable_income, Decimal('0')))


# ---------------------------------------------------------------------------
# SalaryRuleEngine
# ---------------------------------------------------------------------------

class SalaryRuleEngine:
    """
    Chọn SalaryFormula có priority cao nhất và tính MonthlySalaryRecord.
    """

    @staticmethod
    def get_formula_for_employee(employee, calc_date: date_type) -> Optional[SalaryFormula]:
        """
        Tìm formula áp dụng cho nhân viên tại calc_date.
        Priority: cá nhân > vị trí > bộ phận (trực tiếp) > phòng ban (parent) > tất cả.
        """
        base_qs = SalaryFormula.objects.filter(
            is_active=True,
            effective_from__lte=calc_date,
        ).filter(
            dj_models.Q(effective_to__isnull=True) | dj_models.Q(effective_to__gte=calc_date)
        )

        # 1. Cá nhân (ưu tiên cao nhất)
        formula = (
            base_qs.filter(apply_to_employees=employee)
            .order_by('-priority', '-effective_from')
            .first()
        )
        if formula:
            return formula

        # 2. Vị trí
        if employee.position_id:
            formula = (
                base_qs.filter(apply_to_positions=employee.position_id)
                .order_by('-priority', '-effective_from')
                .first()
            )
            if formula:
                return formula

        # 3. Bộ phận (department trực tiếp)
        if employee.department_id:
            formula = (
                base_qs.filter(apply_to_departments=employee.department_id)
                .order_by('-priority', '-effective_from')
                .first()
            )
            if formula:
                return formula

        # 4. Phòng ban (parent_department — leo lên 1 cấp)
        dept = getattr(employee, 'department', None)
        parent_dept = getattr(dept, 'parent_department', None) if dept else None
        if parent_dept:
            formula = (
                base_qs.filter(apply_to_departments=parent_dept)
                .order_by('-priority', '-effective_from')
                .first()
            )
            if formula:
                return formula

        # 5. Tất cả (fallback)
        return (
            base_qs.filter(apply_to_all=True)
            .order_by('-priority', '-effective_from')
            .first()
        )

    @staticmethod
    def _validate_recalculate(employee, year: int, month: int) -> None:
        """Raise ValueError nếu bản ghi đã APPROVED/PAID (không được tính lại)."""
        existing = MonthlySalaryRecord.objects.filter(
            employee=employee, year=year, month=month
        ).first()
        if existing and existing.status in ('APPROVED', 'PAID'):
            raise ValueError(
                f"Bảng lương {existing.salary_code} đã ở trạng thái '{existing.status}', "
                "không thể tính lại."
            )

    @staticmethod
    def _compute_components(formula, ctx: dict, calc_date: date_type) -> tuple[dict, list, Decimal, Decimal]:
        """
        Tính tất cả components theo thứ tự, trả về:
            (components_detail, applied_rules, gross, total_deduction)
        """
        components_detail: dict = {}
        applied_rules: list = []
        gross = Decimal('0')
        total_deduction = Decimal('0')

        components = list(formula.components.filter(is_active=True).order_by('order'))
        component_codes = {comp.code for comp in components}

        # --- Tự động cộng thu nhập cố định khác từ hồ sơ nhân viên (trước PIT) ---
        other_fixed_income = Decimal(str(ctx.get('other_fixed_monthly_income', 0) or 0))
        if other_fixed_income > 0 and 'OTHER_FIXED_MONTHLY_INCOME' not in component_codes:
            components_detail['OTHER_FIXED_MONTHLY_INCOME'] = {
                'name': 'Thu nhập cố định khác',
                'type': 'EARNING',
                'calc_method': 'EMPLOYEE_PROFILE',
                'amount': float(other_fixed_income),
            }
            gross += other_fixed_income
            applied_rules.append({
                'component_code': 'OTHER_FIXED_MONTHLY_INCOME',
                'component_name': 'Thu nhập cố định khác',
                'calc_method': 'EMPLOYEE_PROFILE',
                'amount': float(other_fixed_income),
            })

        for comp in components:
            if comp.calc_method == 'PROGRESSIVE_TAX':
                _prepare_progressive_tax_context(ctx, calc_date, gross, total_deduction)

            amount = ComponentCalculator.calculate(comp, ctx)
            components_detail[comp.code] = {
                'name': comp.name,
                'type': comp.component_type,
                'calc_method': comp.calc_method,
                'amount': float(amount),
            }

            if comp.calc_method == 'PROGRESSIVE_TAX':
                tax_meta = ctx.pop('_progressive_tax_meta', None)
                if tax_meta:
                    components_detail[comp.code]['tax_breakdown'] = tax_meta

            ctx[comp.code] = float(amount)

            if _is_deduction(comp):
                total_deduction += abs(amount)
            else:
                gross += amount

            rule_entry = {
                'component_code': comp.code,
                'component_name': comp.name,
                'calc_method': comp.calc_method,
                'amount': float(amount),
            }
            if comp.calc_method == 'PROGRESSIVE_TAX' and components_detail[comp.code].get('tax_breakdown'):
                rule_entry['tax_breakdown'] = components_detail[comp.code]['tax_breakdown']

            applied_rules.append(rule_entry)

        return components_detail, applied_rules, gross, total_deduction

    @staticmethod
    def _apply_overrides(
        components_detail: dict,
        applied_rules: list,
        gross: Decimal,
        total_deduction: Decimal,
        ctx: dict,
        overrides,
    ) -> tuple[dict, list, Decimal, Decimal]:
        """
        Merge SalaryComponentOverride vào kết quả tính formula.
        - is_addition=True  → cộng thêm vào giá trị cũ của component đó.
        - is_addition=False → thay thế hoàn toàn giá trị cũ.
        """
        for override in overrides:
            code = override.component_code
            new_amount = Decimal(str(override.amount))
            is_ded = _is_override_deduction(override.component_type)

            if code in components_detail:
                old_amount = Decimal(str(components_detail[code]['amount']))
                # Hoàn trả contribution cũ
                if _is_override_deduction(components_detail[code]['type']):
                    total_deduction -= abs(old_amount)
                else:
                    gross -= old_amount

                if override.is_addition:
                    new_amount = old_amount + new_amount

            components_detail[code] = {
                'name': override.component_name,
                'type': override.component_type,
                'calc_method': 'OVERRIDE',
                'amount': float(new_amount),
                'override_id': override.id,
                'notes': override.notes,
            }
            ctx[code] = float(new_amount)

            if is_ded:
                total_deduction += abs(new_amount)
            else:
                gross += new_amount

            applied_rules.append({
                'component_code': code,
                'component_name': override.component_name,
                'calc_method': 'OVERRIDE',
                'amount': float(new_amount),
                'override_id': override.id,
            })

        return components_detail, applied_rules, gross, total_deduction

    @staticmethod
    def calculate(
        employee,
        year: int,
        month: int,
        work_credit=None,
    ) -> MonthlySalaryRecord:
        """
        Tính lương và lưu MonthlySalaryRecord (update_or_create).
        Chỉ tính lại nếu bản ghi chưa APPROVED/PAID.
        """
        SalaryRuleEngine._validate_recalculate(employee, year, month)

        calc_date = date_type(year, month, 1)
        formula = SalaryRuleEngine.get_formula_for_employee(employee, calc_date)
        if not formula:
            raise ValueError(
                f"Không tìm thấy công thức lương cho nhân viên '{employee.full_name}' "
                f"tháng {month}/{year}"
            )

        ctx, warnings = _build_context(
            employee,
            work_credit,
            year,
            month,
        )
        ctx['standard_work_days_mode'] = getattr(employee, 'standard_work_days_mode', 'DEFAULT') or 'DEFAULT'

        components_detail, applied_rules, gross, total_deduction = (
            SalaryRuleEngine._compute_components(formula, ctx, calc_date)
        )

        # --- Tự động cộng lương tăng ca từ OvertimeRateConfig (không cần SalaryComponent) ---
        ot_pay = Decimal(str(ctx.get('ot_pay', 0)))
        if ot_pay > 0:
            components_detail['OT_PAY'] = {
                'name': 'Lương tăng ca',
                'type': 'EARNING',
                'calc_method': 'OT_RATE_CONFIG',
                'amount': float(ot_pay),
                'ot_hours': ctx.get('ot_hours', 0),
                'ot_rate_per_hour': ctx.get('ot_rate_per_hour', 0),
            }
            gross += ot_pay
            applied_rules.append({
                'component_code': 'OT_PAY',
                'component_name': 'Lương tăng ca',
                'calc_method': 'OT_RATE_CONFIG',
                'amount': float(ot_pay),
            })

        ctx['gross_salary'] = float(gross)

        # Áp dụng override cho tháng này
        overrides = list(SalaryComponentOverride.objects.filter(
            employee=employee, year=year, month=month
        ))
        if overrides:
            components_detail, applied_rules, gross, total_deduction = (
                SalaryRuleEngine._apply_overrides(
                    components_detail, applied_rules, gross, total_deduction, ctx, overrides
                )
            )
            ctx['gross_salary'] = float(gross)

        net = gross - total_deduction

        # Gộp warnings vào đầu applied_rules để dễ tra cứu
        final_rules = warnings + applied_rules

        record, _ = MonthlySalaryRecord.objects.update_or_create(
            employee=employee, year=year, month=month,
            defaults={
                'work_credit': work_credit,
                'formula_used': formula,
                'formula_snapshot': _snapshot_formula(formula),
                'input_snapshot': ctx,
                'gross_salary': gross,
                'total_deduction': total_deduction,
                'net_salary': net,
                'components_detail': components_detail,
                'applied_rules': final_rules,
                'status': 'DRAFT',
            },
        )
        return record
"""
bonus_calculator.py - Logic tính dự đoán chi phí thưởng cho toàn công ty và phòng ban
"""

from datetime import date
from decimal import Decimal
from typing import Dict, Any, Tuple
from django.db.models import Q

from employee.models import CompanyUnit, Employee

DEFAULT_UNDER_ONE_YEAR_AMOUNT = Decimal('3000000')


class BonusScheme:
    """Định nghĩa các phương án thưởng"""
    
    # Phương án 1: mức cố định (mặc định 3 triệu) nếu < 1 năm, N tháng lương nếu >= 1 năm
    SCHEME_FIXED_3M_BASIC = "fixed_3m_basic"
    
    # Phương án 2: Tính theo tháng làm việc (< 1 năm = 1 tháng lương / 12 * số tháng)
    SCHEME_PRORATED = "prorated"
    
    # Phương án 3: Custom - nhập số tiền và số tháng thưởng
    SCHEME_CUSTOM = "custom"


class BonusCalculator:
    """Tính dự đoán chi phí thưởng"""
    
    def __init__(self):
        self.today = date.today()
    
    def _get_fiscal_year_end(self, fiscal_year: int | None = None) -> date:
        """Lấy mốc cuối năm tài chính (mặc định 31/12 năm hiện tại)."""
        target_year = fiscal_year or self.today.year
        return date(target_year, 12, 31)

    def _calculate_months_worked(self, start_date: date, as_of_date: date | None = None) -> int:
        """Tính số tháng làm việc từ start_date đến mốc as_of_date."""
        if not start_date:
            return 0

        reference_date = as_of_date or self.today
        
        years_diff = reference_date.year - start_date.year
        months_diff = reference_date.month - start_date.month
        
        total_months = years_diff * 12 + months_diff
        
        # Nếu chưa đến ngày bắt đầu trong tháng tham chiếu thì chưa đủ tròn tháng
        if reference_date.day < start_date.day:
            total_months -= 1
        
        return max(0, total_months)
    
    def _is_worked_over_1_year(self, start_date: date) -> bool:
        """Kiểm tra xem nhân viên đã làm việc >= 1 năm chưa"""
        return self._calculate_months_worked(start_date) >= 12
    
    def calculate_employee_bonus(
        self,
        employee: Employee,
        scheme: str = BonusScheme.SCHEME_FIXED_3M_BASIC,
        fixed_amount: Decimal = None,
        bonus_months: int = 1,
        fiscal_year_end: date | None = None,
        under_one_year_amount: Decimal = DEFAULT_UNDER_ONE_YEAR_AMOUNT,
    ) -> Tuple[Decimal, Dict[str, Any]]:
        """
        Tính thưởng cho một nhân viên
        
        Args:
            employee: Employee object
            scheme: Phương án thưởng
            fixed_amount: Số tiền cố định (cho phương án CUSTOM)
            bonus_months: Số tháng thưởng (cho phương án CUSTOM)
        
        Returns:
            Tuple[bonus_amount, detail_dict]
        """
        bonus_amount = Decimal('0')
        detail = {
            'employee_id': employee.id,
            'employee_code': employee.employee_id,
            'employee_name': employee.full_name,
            'department': employee.department.name if employee.department else '—',
            'basic_salary': float(employee.basic_salary or 0),
            'start_date': str(employee.start_date) if employee.start_date else None,
            'months_worked': 0,
            'is_over_1_year': False,
            'scheme': scheme,
            'bonus_amount': 0,
            'bonus_months': bonus_months,
            'reason': '',
        }
        
        # Không có lương cơ bản
        if not employee.basic_salary or employee.basic_salary <= 0:
            detail['reason'] = 'Không có lương cơ bản'
            return bonus_amount, detail
        
        # Không có ngày bắt đầu
        if not employee.start_date:
            detail['reason'] = 'Không có ngày bắt đầu làm việc'
            return bonus_amount, detail
        
        projection_point = fiscal_year_end or self._get_fiscal_year_end()
        months_worked = self._calculate_months_worked(employee.start_date, as_of_date=projection_point)
        is_over_1_year = months_worked >= 12
        
        detail['months_worked'] = months_worked
        detail['is_over_1_year'] = is_over_1_year
        detail['bonus_months'] = bonus_months
        detail['projection_date'] = str(projection_point)
        
        if scheme == BonusScheme.SCHEME_FIXED_3M_BASIC:
            # < 1 năm: mức cố định, >= 1 năm: N tháng lương cơ bản
            if is_over_1_year:
                bonus_amount = Decimal(str(employee.basic_salary)) * bonus_months
                detail['reason'] = f'≥ 1 năm (đã làm {months_worked} tháng): {bonus_months} tháng lương cơ bản'
            else:
                bonus_amount = Decimal(str(under_one_year_amount)) * bonus_months
                detail['reason'] = (f'< 1 năm (đã làm {months_worked} tháng): '
                                    f'{int(under_one_year_amount):,}đ × {bonus_months}').replace(',', '.')
        
        elif scheme == BonusScheme.SCHEME_PRORATED:
            # < 1 năm: 1 tháng lương / 12 * số tháng làm, >= 1 năm: 1 tháng lương
            if is_over_1_year:
                bonus_amount = Decimal(str(employee.basic_salary)) * bonus_months
                detail['reason'] = f'≥ 1 năm (đã làm {months_worked} tháng): {bonus_months} tháng lương cơ bản'
            else:
                # Tính theo tháng: (lương cơ bản / 12) * số tháng làm * số tháng thưởng
                monthly_prorated = Decimal(str(employee.basic_salary)) / Decimal('12')
                bonus_amount = monthly_prorated * Decimal(months_worked) * Decimal(bonus_months)
                detail['reason'] = f'< 1 năm (tính đến cuối năm tài chính: {months_worked} tháng): (lương/12)×{months_worked} × {bonus_months}'
        
        elif scheme == BonusScheme.SCHEME_CUSTOM:
            # Custom: dùng fixed_amount và bonus_months
            if fixed_amount and fixed_amount > 0:
                bonus_amount = Decimal(str(fixed_amount)) * bonus_months
                detail['reason'] = f'Tuỳ chỉnh: {fixed_amount} × {bonus_months} tháng'
            else:
                detail['reason'] = 'Phương án tuỳ chỉnh nhưng không có số tiền'
        
        detail['bonus_amount'] = float(bonus_amount)
        
        return bonus_amount, detail
    
    def predict_company_bonus(
        self,
        scheme: str = BonusScheme.SCHEME_FIXED_3M_BASIC,
        fixed_amount: Decimal = None,
        bonus_months: int = 1,
        department_id: int = None,
        legal_entity: str = None,
        fiscal_year: int = None,
        under_one_year_amount: Decimal = DEFAULT_UNDER_ONE_YEAR_AMOUNT,
    ) -> Dict[str, Any]:
        """
        Dự đoán chi phí thưởng cho công ty hoặc phòng ban
        
        Args:
            scheme: Phương án thưởng
            fixed_amount: Số tiền cố định (cho phương án CUSTOM)
            bonus_months: Số tháng thưởng
            department_id: Nếu có, chỉ tính cho phòng ban này
            legal_entity: Nếu có, chỉ tính cho pháp nhân này
        
        Returns:
            Dict với kết quả dự đoán
        """
        # Lấy danh sách nhân viên
        employees = Employee.objects.filter(
            is_active=True,
            employment_status='ACTIVE',
            basic_salary__isnull=False,
            start_date__isnull=False,
        ).select_related('department')
        
        if department_id:
            employees = employees.filter(department_id=department_id)
        
        if legal_entity:
            # Employee chỉ còn company_unit (FK) — legal_entity có thể là
            # code hoặc tên đầy đủ, resolve về đúng 1 đơn vị.
            unit = CompanyUnit.objects.filter(Q(code__iexact=legal_entity) | Q(name__iexact=legal_entity)).first()
            employees = employees.filter(company_unit_id=unit.pk) if unit else employees.none()
        
        fiscal_year_end = self._get_fiscal_year_end(fiscal_year)

        # Tính thưởng cho từng nhân viên
        results_by_employee = []
        total_bonus = Decimal('0')
        
        # Tính theo phòng ban
        department_summary = {}
        
        for emp in employees:
            bonus_amount, detail = self.calculate_employee_bonus(
                emp,
                scheme=scheme,
                fixed_amount=fixed_amount,
                bonus_months=bonus_months,
                fiscal_year_end=fiscal_year_end,
                under_one_year_amount=under_one_year_amount,
            )
            
            results_by_employee.append(detail)
            total_bonus += bonus_amount
            
            # Tính tổng theo phòng ban
            dept_key = emp.department.id if emp.department else None
            dept_name = emp.department.name if emp.department else '(Không xác định)'
            
            if dept_key not in department_summary:
                department_summary[dept_key] = {
                    'department_id': dept_key,
                    'department_name': dept_name,
                    'employee_count': 0,
                    'total_bonus': Decimal('0'),
                    'employees': [],
                }
            
            department_summary[dept_key]['employee_count'] += 1
            department_summary[dept_key]['total_bonus'] += bonus_amount
            department_summary[dept_key]['employees'].append(detail)
        
        # Chuyển Decimal sang float
        department_breakdown = []
        for dept_key, dept_data in sorted(department_summary.items()):
            department_breakdown.append({
                'department_id': dept_data['department_id'],
                'department_name': dept_data['department_name'],
                'employee_count': dept_data['employee_count'],
                'total_bonus': float(dept_data['total_bonus']),
                'employees': dept_data['employees'],
            })
        
        return {
            'scheme': scheme,
            'fixed_amount': float(fixed_amount) if fixed_amount else None,
            'bonus_months': bonus_months,
            'fiscal_year': fiscal_year_end.year,
            'fiscal_year_end': str(fiscal_year_end),
            'under_one_year_amount': float(under_one_year_amount),
            'department_filter': department_id,
            'legal_entity_filter': legal_entity,
            'total_employee_count': len(results_by_employee),
            'total_bonus': float(total_bonus),
            'employees': results_by_employee,
            'departments': department_breakdown,
            'generated_at': str(self.today),
        }

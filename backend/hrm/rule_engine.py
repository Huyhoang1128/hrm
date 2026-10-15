"""
Attendance Rule Engine - Logic for applying rules to employees by department
"""

from django.utils import timezone
from django.db import models
from datetime import date, datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from .models import (
    AttendanceRuleConfig, LeavePolicyConfig, Attendance
)
from employee.models import Employee, Department, Position


class AttendanceRuleEngine:
    """
    Engine for applying attendance rules to employees
    """
    
    @staticmethod
    def get_applicable_rules_for_employee(
        employee: Employee, 
        date: datetime.date = None
    ) -> List[AttendanceRuleConfig]:
        """
        Get all attendance rules that apply to an employee on a specific date
        
        Args:
            employee: Employee object
            date: Date to check (default: today)
            
        Returns:
            List of applicable AttendanceRuleConfig objects
        """
        if date is None:
            date = timezone.now().date()
        
        # Get all active rules effective on the date
        rules = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=date
        )

        print("========RULES========")
        print(f"Total active rules on {date}: {rules.count()}")
        print("========RULES LIST========")
        
        applicable_rules = []
        for rule in rules:
            if rule.should_apply_to_employee(employee):
                applicable_rules.append(rule)
        
        # Sort by priority: specific rules first, then general rules
        # Priority order: employee-specific > position-specific > department-specific > general
        applicable_rules.sort(key=lambda x: AttendanceRuleEngine._get_rule_priority(x, employee), reverse=True)
        
        return applicable_rules
    
    @staticmethod
    def _get_rule_priority(rule: AttendanceRuleConfig, employee: Employee) -> int:
        """
        Calculate priority score for a rule (higher = more specific)
        
        Priority levels:
        4: Rule applies specifically to this employee
        3: Rule applies to employee's position
        2: Rule applies to employee's department
        1: Rule applies to all (general rule)
        0: Rule doesn't apply (shouldn't happen)
        """
        if rule.apply_to_employees.filter(id=employee.id).exists():
            return 4
        
        if employee.position and rule.apply_to_positions.filter(id=employee.position.id).exists():
            return 3
        
        if employee.department and rule.apply_to_departments.filter(id=employee.department.id).exists():
            return 2
        
        if rule.apply_to_all:
            return 1
        
        return 0
    
    @staticmethod
    def get_applicable_rules_for_department(
        department: Department,
        date: datetime.date = None
    ) -> Dict[Employee, List[AttendanceRuleConfig]]:
        """
        Get applicable rules for all employees in a department
        
        Args:
            department: Department object
            date: Date to check (default: today)
            
        Returns:
            Dictionary mapping employees to their applicable rules
        """
        if date is None:
            date = timezone.now().date()
        
        employees = Employee.objects.filter(department=department, employment_status='ACTIVE')
        result = {}
        
        for employee in employees:
            rules = AttendanceRuleEngine.get_applicable_rules_for_employee(employee, date)
            result[employee] = rules
        
        return result
    
    @staticmethod
    def apply_rules_to_attendance(
        attendance: Attendance,
        rules: List[AttendanceRuleConfig] = None
    ) -> Dict[str, Any]:
        """
        Apply attendance rules to an attendance record
        
        Args:
            attendance: Attendance object
            rules: List of rules to apply (if None, will get applicable rules)
            
        Returns:
            Dictionary with calculation results
        """
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info(f"=== APPLYING RULES TO ATTENDANCE ===")
        # logger.info(f"Attendance ID: {attendance.id}")
        # logger.info(f"Employee: {attendance.employee.full_name} ({attendance.employee.id})")
        logger.info(f"Date: {attendance.attendance_date}")
        # logger.info(f"Check_in: {attendance.check_in}, Check_out: {attendance.check_out}")
        # logger.info(f"Initial status: {attendance.status}")
        
        if rules is None:
            rules = AttendanceRuleEngine.get_applicable_rules_for_employee(
                attendance.employee, attendance.attendance_date
            )
        
        # logger.info(f"Found {len(rules)} applicable rules")
        for i, rule in enumerate(rules):
            logger.info(f"  Rule {i+1}: {rule.name} ({rule.code}) - Type: {rule.rule_type}")
        
        # Check for incomplete attendance (missing check_in or check_out)
        has_check_in = attendance.check_in is not None
        has_check_out = attendance.check_out is not None
        
        print(f"Has check_in: {has_check_in}, Has check_out: {has_check_out}")
        # If BOTH check_in and check_out are null, set status to ABSENT
        # If only ONE is null, set status to INCOMPLETE_ATTENDANCE
        if not has_check_in or not has_check_out:
            missing_fields = []
            if not has_check_in:
                missing_fields.append('check_in')
            if not has_check_out:
                missing_fields.append('check_out')
            
            # Determine status based on which fields are missing
            if not has_check_in and not has_check_out:
                # Both are null → ABSENT
                status = 'ABSENT'
                note = "Vắng mặt"
                logger.info(f"Both check_in and check_out are null → ABSENT")
            else:
                # Only one is null → INCOMPLETE_ATTENDANCE
                status = 'INCOMPLETE_ATTENDANCE'
                note = f"Quên chấm công"
                logger.info(f"Incomplete attendance detected: missing {', '.join(missing_fields)}")
            
            calculation_result = {
                'status': status,
                'work_hours': 0.0,
                'work_coefficient': 0.0,
                'late_minutes': 0,
                'early_leave_minutes': 0,
                'overtime_hours': 0.0,
                'applied_rules': [],
                'notes': [note],
                'shift_coefficients': []
            }
            
            logger.info(f"=== FINAL CALCULATION RESULT ===")
            logger.info(f"Status: {calculation_result['status']}")
            logger.info(f"Missing fields: {', '.join(missing_fields)}")
            
            return calculation_result
        
        # Both check_in and check_out are present, calculate work coefficient
        # Calculate default work_coefficient based on actual working hours
        default_work_coefficient = 0.0
        
        # Calculate actual work hours
        from datetime import datetime as dt
        check_in_dt = dt.combine(attendance.attendance_date, attendance.check_in)
        check_out_dt = dt.combine(attendance.attendance_date, attendance.check_out)
        
        if attendance.check_out <= attendance.check_in:
            check_out_dt = dt.combine(
                attendance.attendance_date + timedelta(days=1),
                attendance.check_out
            )
        
        delta = check_out_dt - check_in_dt
        work_hours = delta.total_seconds() / 3600
        
        # Apply break time only if it's a full day shift (check_out after 17:00)
        # Morning/afternoon shifts (ending before 17:00) don't have break time
        if attendance.check_out.hour >= 17:  # 5PM or later
            work_hours = max(0, work_hours - 1.0)  # Subtract 1 hour break
            # logger.info(f"Full day shift (ends at/after 17:00), applied 1 hour break. Work hours after break: {work_hours:.2f}")
        else:
            logger.info(f"Morning/afternoon shift (ends before 17:00), no break applied. Work hours: {work_hours:.2f}")
        
        # Calculate work_coefficient based on hours worked
        # For morning shifts (no break):
        # - Full day: >= 4 hours = 1.0 coefficient
        # - Half day: >= 2 hours = 0.5 coefficient  
        # For full day shifts (with break):
        # - Full day: >= 7 hours = 1.0 coefficient (8 hours minus 1 hour break)
        # - Half day: >= 3.5 hours = 0.5 coefficient (4.5 hours minus 1 hour break)
        
        if attendance.check_out.hour >= 17:  # Full day shift with break
            if work_hours >= 7.0:
                default_work_coefficient = 1.0
            elif work_hours >= 3.3:
                default_work_coefficient = 0.5
            else:
                default_work_coefficient = 0.0
            # logger.info(f"Full day shift thresholds applied: {work_hours:.2f} hours -> coefficient {default_work_coefficient}")
        else:  # Morning shift without break
            if work_hours >= 4.0:
                default_work_coefficient = 1.0
            elif work_hours >= 2.0:
                default_work_coefficient = 0.5
            else:
                default_work_coefficient = 0.0
            # logger.info(f"Morning shift thresholds applied: {work_hours:.2f} hours -> coefficient {default_work_coefficient}")
        
        # logger.info(f"Calculated default work_coefficient: {default_work_coefficient} based on {work_hours:.2f} hours worked")
        
        calculation_result = {
            'status': attendance.status,
            'work_hours': float(attendance.working_hours),
            'work_coefficient': default_work_coefficient,
            'late_minutes': attendance.late_minutes,
            'early_leave_minutes': attendance.early_leave_minutes,
            'overtime_hours': float(attendance.overtime_hours),
            'applied_rules': [],
            'notes': [],
            'shift_coefficients': []  # Thêm để track từng ca
        }
        # logger.info(f"Initial work_coefficient: {calculation_result['work_coefficient']} (check_in: {attendance.check_in}, check_out: {attendance.check_out})")
        
        # Group rules by type for easier processing
        shift_rules = [r for r in rules if r.rule_type == 'SHIFT_RULE']
        late_rules = [r for r in rules if r.rule_type == 'LATE_EARLY_RULE']
        work_hour_rules = [r for r in rules if r.rule_type == 'WORK_HOUR_CALCULATION']
        overtime_rules = [r for r in rules if r.rule_type == 'OVERTIME_RULE']
        
        # Apply shift rules (highest priority) - Cộng dồn work_coefficient
        total_shift_coefficient = 0.0
        # logger.info(f"Processing {len(shift_rules)} shift rules")
        
        for rule in shift_rules:
            # logger.info(f"  Applying shift rule: {rule.name} ({rule.code})")
            result = AttendanceRuleEngine._apply_shift_rule(attendance, rule)
            # logger.info(f"    Shift rule result: {result}")
            
            # Cộng dồn work_coefficient từ các shift rule
            if 'work_coefficient' in result:
                shift_coefficient = result['work_coefficient']
                total_shift_coefficient += shift_coefficient
                # logger.info(f"    Shift coefficient: {shift_coefficient}, Total so far: {total_shift_coefficient}")
                
                # Lưu thông tin từng ca
                # Try to get config from shift_rule key first, then fall back to root level
                shift_config = rule.configuration.get('shift_rule', {})
                if not shift_config and rule.configuration:
                    # If no shift_rule key, check if shift configuration is at root level
                    shift_config = rule.configuration
                
                calculation_result['shift_coefficients'].append({
                    'rule_id': rule.id,
                    'rule_code': rule.code,
                    'rule_name': rule.name,
                    'coefficient': shift_coefficient,
                    'start_time': shift_config.get('start_time'),
                    'end_time': shift_config.get('end_time')
                })
            
            # Cập nhật các field khác (trừ work_coefficient)
            for key, value in result.items():
                if key != 'work_coefficient':
                    if key in calculation_result and isinstance(calculation_result[key], list) and isinstance(value, list):
                        calculation_result[key].extend(value)
                    else:
                        calculation_result[key] = value
            
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type
            })
        
        # Cập nhật tổng work_coefficient từ các shift rule
        # If shift rules were applied, use their total coefficient (overrides default)
        if total_shift_coefficient > 0:
            calculation_result['work_coefficient'] = min(total_shift_coefficient, 2.0)  # Max 2.0 công/ngày
            # logger.info(f"Using shift rule coefficient: {calculation_result['work_coefficient']} (overrides default)")
            calculation_result['notes'].append(f"Tổng hệ số công: {calculation_result['work_coefficient']} từ {len(shift_rules)} ca")
        elif shift_rules:
            # Shift rules exist but no coefficient calculated (e.g., check_in/check_out null or don't match)
            calculation_result['work_coefficient'] = 0.0
            calculation_result['notes'].append(f"Không có ca nào được tính công (check_in/check_out null hoặc không khớp ca)")
            # logger.info(f"No shift rule coefficient calculated, setting to 0.0")
        else:
            # No shift rules, keep the default coefficient calculated above
            # logger.info(f"No shift rules, using calculated default coefficient: {calculation_result['work_coefficient']}")
            if calculation_result['work_coefficient'] >= 1.0:
                calculation_result['notes'].append(f"Không có shift rules, tính hệ số theo giờ làm: {calculation_result['work_coefficient']} công")
            elif calculation_result['work_coefficient'] >= 0.5:
                calculation_result['notes'].append(f"Không có shift rules, tính hệ số theo giờ làm: {calculation_result['work_coefficient']} công (nửa ngày)")
            elif calculation_result['work_coefficient'] > 0:
                calculation_result['notes'].append(f"Không có shift rules, tính hệ số theo giờ làm: {calculation_result['work_coefficient']} công (ít hơn nửa ngày)")
        
        # Apply late/early rules - cần thông tin từ shift rules
        for rule in late_rules:
            print("CHẠY LATE/EARLY RULE")
            # Lấy thông tin shift rules đã được áp dụng để có start_time và end_time
            applied_shift_coefficients = calculation_result.get('shift_coefficients', [])
            result = AttendanceRuleEngine._apply_late_early_rule(attendance, rule, applied_shift_coefficients)
            # Cập nhật các field (có thể ghi đè status từ shift rules)
            for key, value in result.items():
                if key in calculation_result and isinstance(calculation_result[key], list) and isinstance(value, list):
                    calculation_result[key].extend(value)
                else:
                    calculation_result[key] = value
            
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type
            })
        
        # Apply work hour calculation rules
        for rule in work_hour_rules:
            result = AttendanceRuleEngine._apply_work_hour_rule(attendance, rule)
            # Cập nhật work_hours (có thể ghi đè)
            if 'work_hours' in result:
                calculation_result['work_hours'] = result['work_hours']
            
            # Cập nhật các field khác
            for key, value in result.items():
                if key != 'work_hours':
                    if key in calculation_result and isinstance(calculation_result[key], list) and isinstance(value, list):
                        calculation_result[key].extend(value)
                    else:
                        calculation_result[key] = value
            
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type
            })
        
        # Apply overtime rules
        for rule in overtime_rules:
            result = AttendanceRuleEngine._apply_overtime_rule(attendance, rule)
            # Cộng dồn overtime_hours
            if 'overtime_hours' in result:
                calculation_result['overtime_hours'] += result['overtime_hours']
            
            # Cập nhật các field khác
            for key, value in result.items():
                if key != 'overtime_hours':
                    if key in calculation_result and isinstance(calculation_result[key], list) and isinstance(value, list):
                        calculation_result[key].extend(value)
                    else:
                        calculation_result[key] = value
            
            calculation_result['applied_rules'].append({
                'rule_id': rule.id,
                'rule_code': rule.code,
                'rule_name': rule.name,
                'rule_type': rule.rule_type
            })
        
        # Xác định status cuối cùng dựa trên work_coefficient
        if calculation_result['work_coefficient'] >= 1.0:
            calculation_result['status'] = 'PRESENT'
            logger.info(f"Status determined: PRESENT (work_coefficient >= 1.0)")
        elif calculation_result['work_coefficient'] >= 0.5:
            calculation_result['status'] = 'HALF_DAY'
            logger.info(f"Status determined: HALF_DAY (work_coefficient >= 0.5)")
        else:
            calculation_result['status'] = 'ABSENT'
            logger.info(f"Status determined: ABSENT (work_coefficient < 0.5)")
        
        logger.info(f"=== FINAL CALCULATION RESULT ===")
        logger.info(f"Status: {calculation_result['status']}")
        logger.info(f"Work coefficient: {calculation_result['work_coefficient']}")
        logger.info(f"Work hours: {calculation_result['work_hours']}")
        logger.info(f"Applied rules: {len(calculation_result['applied_rules'])}")
        logger.info(f"Notes: {calculation_result['notes']}")
        
        return calculation_result
    
    @staticmethod
    def _apply_shift_rule(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Apply shift rule to attendance
        Trả về work_coefficient cho ca này (0.5 cho ca nửa ngày, 1.0 cho ca đầy đủ)
        """
        import logging
        logger = logging.getLogger(__name__)
        
        # Try to get config from shift_rule key first, then fall back to root level
        config = rule.configuration.get('shift_rule', {})
        if not config and rule.configuration:
            # If no shift_rule key, check if shift configuration is at root level
            config = rule.configuration
            # logger.info(f"    Using root level configuration for shift rule")
        
        result = {}
        
        # logger.info(f"    _apply_shift_rule called for rule: {rule.name}")
        # logger.info(f"    Rule config: {config}")
        # logger.info(f"    Attendance check_in: {attendance.check_in}, check_out: {attendance.check_out}")
        
        # Check if attendance matches shift time
        if attendance.check_in and attendance.check_out:
            expected_start = config.get('start_time')
            expected_end = config.get('end_time')
            
            # logger.info(f"    Expected shift: {expected_start} - {expected_end}")
            
            if expected_start and expected_end:
                # Convert string times to time objects
                from datetime import datetime as dt
                try:
                    expected_start_time = dt.strptime(expected_start, '%H:%M').time()
                    expected_end_time = dt.strptime(expected_end, '%H:%M').time()
                    
                    # logger.info(f"    Parsed times: start={expected_start_time}, end={expected_end_time}")
                    
                    # Tính thời gian attendance có nằm trong ca không
                    # Cho phép linh hoạt: attendance có thể bắt đầu sớm hơn hoặc kết thúc muộn hơn một chút
                    attendance_start = attendance.check_in
                    attendance_end = attendance.check_out
                    
                    # Tính phần trăm thời gian attendance nằm trong ca
                    total_shift_minutes = (expected_end_time.hour * 60 + expected_end_time.minute) - \
                                         (expected_start_time.hour * 60 + expected_start_time.minute)
                    
                    if total_shift_minutes <= 0:
                        total_shift_minutes += 24 * 60  # Nếu ca qua ngày hôm sau
                    
                    # logger.info(f"    Total shift minutes: {total_shift_minutes}")
                    
                    # Tính thời gian attendance nằm trong ca
                    overlap_start = max(
                        attendance_start.hour * 60 + attendance_start.minute,
                        expected_start_time.hour * 60 + expected_start_time.minute
                    )
                    overlap_end = min(
                        attendance_end.hour * 60 + attendance_end.minute,
                        expected_end_time.hour * 60 + expected_end_time.minute
                    )
                    
                    # logger.info(f"    Overlap start: {overlap_start}, end: {overlap_end}")
                    
                    # Nếu attendance_end < attendance_start (qua ngày)
                    if attendance_end < attendance_start:
                        attendance_end_minutes = (attendance_end.hour * 60 + attendance_end.minute) + 24 * 60
                        overlap_end = min(
                            attendance_end_minutes,
                            expected_end_time.hour * 60 + expected_end_time.minute
                        )
                        # logger.info(f"    Attendance spans midnight, adjusted overlap_end: {overlap_end}")
                    
                    overlap_minutes = max(0, overlap_end - overlap_start)
                    # logger.info(f"    Overlap minutes: {overlap_minutes}")
                    
                    # Tính hệ số công dựa trên phần trăm thời gian làm việc trong ca
                    if overlap_minutes > 0:
                        attendance_ratio = overlap_minutes / total_shift_minutes
                        # logger.info(f"    Attendance ratio: {attendance_ratio:.2f}")
                        
                        # Lấy hệ số công từ config, mặc định 1.0
                        base_coefficient = config.get('work_coefficient', 1.0)
                        
                        # Tính hệ số công thực tế dựa trên thời gian làm việc
                        # Nếu làm ít nhất 50% ca thì tính full coefficient của ca đó
                        if attendance_ratio >= 0.5:
                            result['work_coefficient'] = base_coefficient
                            result['notes'] = [f"Áp dụng ca {rule.name}: {base_coefficient} công ({overlap_minutes} phút trong ca)"]
                            # logger.info(f"    Full shift coefficient applied: {base_coefficient}")
                        elif attendance_ratio >= 0.25:
                            # Làm ít hơn 50% nhưng trên 25% -> tính nửa coefficient
                            result['work_coefficient'] = base_coefficient * 0.5
                            result['notes'] = [f"Áp dụng nửa ca {rule.name}: {base_coefficient * 0.5} công ({overlap_minutes} phút trong ca)"]
                            # logger.info(f"    Half shift coefficient applied: {base_coefficient * 0.5}")
                        else:
                            # Làm ít hơn 25% -> không tính công cho ca này
                            result['notes'] = [f"Không đủ thời gian cho ca {rule.name}: chỉ {overlap_minutes} phút"]
                            # logger.info(f"    Insufficient time for shift: {overlap_minutes} minutes (<25%)")
                    
                except ValueError as e:
                    result['notes'] = [f"Lỗi định dạng thời gian trong rule {rule.name}: {str(e)}"]
                    logger.error(f"    Time format error: {e}")
        
        # Nếu không có check_in/check_out hoặc không khớp ca nào
        if 'work_coefficient' not in result:
            result['work_coefficient'] = 0.0
            # logger.info(f"    No work coefficient calculated, defaulting to 0.0")
        
        # logger.info(f"    Final shift rule result: {result}")
        return result
    
    @staticmethod
    def _apply_late_early_rule(attendance: Attendance, rule: AttendanceRuleConfig, applied_shift_coefficients: List[Dict] = None) -> Dict[str, Any]:
        """
        Apply late/early rule to attendance
        """
        import logging
        logger = logging.getLogger(__name__)
        
        logger.info(f"    _apply_late_early_rule called for rule: {rule.name} ({rule.code})")
        logger.info(f"    Rule configuration: {rule.configuration}")
        logger.info(f"    Applied shift coefficients: {applied_shift_coefficients}")
        
        # Try to get config from late_early_rule key first, then fall back to root level
        config = rule.configuration.get('late_early_rule', {})
        if not config and rule.configuration:
            # If no late_early_rule key, check if thresholds are at root level
            config = rule.configuration
            # logger.info(f"    Using root level configuration for thresholds")
        
        late_threshold = config.get('late_threshold_minutes', 15)
        early_leave_threshold = config.get('early_leave_threshold_minutes', 15)
        
        # logger.info(f"    Late threshold: {late_threshold} minutes, Early leave threshold: {early_leave_threshold} minutes")
        # logger.info(f"    Attendance check_in: {attendance.check_in}, check_out: {attendance.check_out}")
        
        result = {}
        
        # Check for late arrival - compare with ALL applicable shifts
        max_late_minutes = 0
        late_shift_name = None
        
        if attendance.check_in:
            # Try to get shift times from rule configuration first
            expected_start = rule.configuration.get('shift_rule', {}).get('start_time')
            if not expected_start:
                # Also check at root level
                expected_start = rule.configuration.get('start_time')
            
            # If no start time in rule config, check ALL applied shift coefficients
            if not expected_start and applied_shift_coefficients:
                logger.info(f"    No start_time in rule config, checking ALL applied_shift_coefficients")
                # Check ALL shifts with coefficient > 0
                applicable_shifts = [s for s in applied_shift_coefficients if s.get('coefficient', 0) > 0]
                logger.info(f"    Found {len(applicable_shifts)} applicable shifts with coefficient > 0")
                
                from datetime import datetime as dt
                # Check late for EACH shift
                for shift in applicable_shifts:
                    shift_start = shift.get('start_time')
                    if shift_start:
                        try:
                            shift_start_time = dt.strptime(shift_start, '%H:%M').time()
                            # Check if check_in is within or before this shift
                            # Only check late if check_in time is relevant to this shift
                            if attendance.check_in > shift_start_time:
                                late_for_this_shift = (attendance.check_in.hour * 60 + attendance.check_in.minute) - \
                                                     (shift_start_time.hour * 60 + shift_start_time.minute)
                                logger.info(f"    Shift {shift.get('rule_name')}: check_in {attendance.check_in} vs start {shift_start_time} = {late_for_this_shift} min late")
                                
                                # Track maximum late minutes across all shifts
                                if late_for_this_shift > max_late_minutes:
                                    max_late_minutes = late_for_this_shift
                                    late_shift_name = shift.get('rule_name')
                            else:
                                logger.info(f"    Shift {shift.get('rule_name')}: check_in {attendance.check_in} <= start {shift_start_time} - not late for this shift")
                        except ValueError as e:
                            logger.error(f"    Error parsing shift start time {shift_start}: {e}")
                
                if max_late_minutes > 0:
                    result['late_minutes'] = max_late_minutes
                    logger.info(f"    Maximum late: {max_late_minutes} minutes (from shift {late_shift_name})")
                    
                    if max_late_minutes > late_threshold:
                        result['status'] = 'LATE'
                        result['notes'] = result.get('notes', []) + [f"Late arrival for {late_shift_name}: {max_late_minutes} minutes (threshold: {late_threshold} minutes)"]
                        logger.info(f"    Late detected: {max_late_minutes} minutes > {late_threshold} threshold")
                    else:
                        result['notes'] = result.get('notes', []) + [f"On time (within threshold) for {late_shift_name}: {max_late_minutes} minutes late (threshold: {late_threshold} minutes)"]
                        logger.info(f"    Not late enough: {max_late_minutes} minutes <= {late_threshold} threshold")
                else:
                    result['late_minutes'] = 0
                    logger.info(f"    Not late for any shift")
            elif expected_start:
                # Single shift time from rule config
                from datetime import datetime as dt
                try:
                    expected_start_time = dt.strptime(expected_start, '%H:%M').time()
                    logger.info(f"    Parsed expected start time: {expected_start_time}")
                    logger.info(f"    Comparing check_in {attendance.check_in} with expected_start_time {expected_start_time}")
                    
                    if attendance.check_in > expected_start_time:
                        late_minutes = (attendance.check_in.hour * 60 + attendance.check_in.minute) - \
                                      (expected_start_time.hour * 60 + expected_start_time.minute)
                        
                        logger.info(f"    Late calculation: {attendance.check_in} > {expected_start_time}, late_minutes = {late_minutes}")
                        
                        result['late_minutes'] = late_minutes
                        
                        if late_minutes > late_threshold:
                            result['status'] = 'LATE'
                            result['notes'] = result.get('notes', []) + [f"Late arrival: {late_minutes} minutes (threshold: {late_threshold} minutes)"]
                            logger.info(f"    Late detected: {late_minutes} minutes > {late_threshold} threshold")
                        else:
                            result['notes'] = result.get('notes', []) + [f"On time (within threshold): {late_minutes} minutes late (threshold: {late_threshold} minutes)"]
                            logger.info(f"    Not late enough: {late_minutes} minutes <= {late_threshold} threshold")
                    else:
                        result['late_minutes'] = 0
                        logger.info(f"    Not late: {attendance.check_in} <= {expected_start_time}")
                        
                except ValueError as e:
                    logger.error(f"    Error parsing start time {expected_start}: {e}")
                    result['notes'] = result.get('notes', []) + [f"Error parsing start time: {str(e)}"]
            else:
                logger.warning(f"    No expected start time found in rule configuration or applied shifts")
                result['notes'] = result.get('notes', []) + ["No expected start time configured"]
        else:
            logger.info(f"    No check_in time available")
        
        # Check for early leave - compare with ALL applicable shifts
        max_early_minutes = 0
        early_shift_name = None
        
        if attendance.check_out:
            # Try to get shift times from rule configuration
            expected_end = rule.configuration.get('shift_rule', {}).get('end_time')
            if not expected_end:
                # Also check at root level
                expected_end = rule.configuration.get('end_time')
            
            # If no end time in rule config, check ALL applied shift coefficients
            if not expected_end and applied_shift_coefficients:
                logger.info(f"    No end_time in rule config, checking ALL applied_shift_coefficients")
                # Check ALL shifts with coefficient > 0
                applicable_shifts = [s for s in applied_shift_coefficients if s.get('coefficient', 0) > 0]
                logger.info(f"    Found {len(applicable_shifts)} applicable shifts with coefficient > 0")
                
                from datetime import datetime as dt
                # Check early leave for EACH shift
                for shift in applicable_shifts:
                    shift_end = shift.get('end_time')
                    if shift_end:
                        try:
                            shift_end_time = dt.strptime(shift_end, '%H:%M').time()
                            # Only check early leave if check_out time is relevant to this shift
                            if attendance.check_out < shift_end_time:
                                early_for_this_shift = (shift_end_time.hour * 60 + shift_end_time.minute) - \
                                                      (attendance.check_out.hour * 60 + attendance.check_out.minute)
                                logger.info(f"    Shift {shift.get('rule_name')}: check_out {attendance.check_out} vs end {shift_end_time} = {early_for_this_shift} min early")
                                
                                # Track maximum early minutes across all shifts
                                if early_for_this_shift > max_early_minutes:
                                    max_early_minutes = early_for_this_shift
                                    early_shift_name = shift.get('rule_name')
                            else:
                                logger.info(f"    Shift {shift.get('rule_name')}: check_out {attendance.check_out} >= end {shift_end_time} - not early for this shift")
                        except ValueError as e:
                            logger.error(f"    Error parsing shift end time {shift_end}: {e}")
                
                if max_early_minutes > 0:
                    result['early_leave_minutes'] = max_early_minutes
                    logger.info(f"    Maximum early leave: {max_early_minutes} minutes (from shift {early_shift_name})")
                    
                    if max_early_minutes > early_leave_threshold:
                        if result.get('status') != 'LATE':
                            result['status'] = 'EARLY_LEAVE'
                        result['notes'] = result.get('notes', []) + [f"Early leave from {early_shift_name}: {max_early_minutes} minutes (threshold: {early_leave_threshold} minutes)"]
                        logger.info(f"    Early leave detected: {max_early_minutes} minutes > {early_leave_threshold} threshold")
                    else:
                        result['notes'] = result.get('notes', []) + [f"Left on time (within threshold) for {early_shift_name}: {max_early_minutes} minutes early (threshold: {early_leave_threshold} minutes)"]
                        logger.info(f"    Not early enough: {max_early_minutes} minutes <= {early_leave_threshold} threshold")
                else:
                    result['early_leave_minutes'] = 0
                    logger.info(f"    Not early leave for any shift")
            elif expected_end:
                # Single shift time from rule config
                from datetime import datetime as dt
                try:
                    expected_end_time = dt.strptime(expected_end, '%H:%M').time()
                    logger.info(f"    Parsed expected end time: {expected_end_time}")
                    logger.info(f"    Comparing check_out {attendance.check_out} with expected_end_time {expected_end_time}")
                    
                    if attendance.check_out < expected_end_time:
                        early_minutes = (expected_end_time.hour * 60 + expected_end_time.minute) - \
                                       (attendance.check_out.hour * 60 + attendance.check_out.minute)
                        
                        logger.info(f"    Early leave calculation: {attendance.check_out} < {expected_end_time}, early_minutes = {early_minutes}")
                        
                        result['early_leave_minutes'] = early_minutes
                        
                        if early_minutes > early_leave_threshold:
                            if result.get('status') != 'LATE':
                                result['status'] = 'EARLY_LEAVE'
                            result['notes'] = result.get('notes', []) + [f"Early leave: {early_minutes} minutes (threshold: {early_leave_threshold} minutes)"]
                            logger.info(f"    Early leave detected: {early_minutes} minutes > {early_leave_threshold} threshold")
                        else:
                            result['notes'] = result.get('notes', []) + [f"Left on time (within threshold): {early_minutes} minutes early (threshold: {early_leave_threshold} minutes)"]
                            logger.info(f"    Not early enough: {early_minutes} minutes <= {early_leave_threshold} threshold")
                    else:
                        result['early_leave_minutes'] = 0
                        logger.info(f"    Not early leave: {attendance.check_out} >= {expected_end_time}")
                        
                except ValueError as e:
                    logger.error(f"    Error parsing end time {expected_end}: {e}")
                    result['notes'] = result.get('notes', []) + [f"Error parsing end time: {str(e)}"]
            else:
                logger.warning(f"    No expected end time found in rule configuration or applied shifts")
                result['notes'] = result.get('notes', []) + ["No expected end time configured"]
        else:
            logger.info(f"    No check_out time available")
        
        logger.info(f"    Late/early rule result: {result}")
        return result
    
    @staticmethod
    def _apply_work_hour_rule(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Apply work hour calculation rule
        """
        config = rule.configuration.get('work_hour_calculation', {})
        result = {}
        
        if attendance.check_in and attendance.check_out:
            # Calculate actual work hours
            from datetime import datetime as dt
            check_in_dt = dt.combine(attendance.attendance_date, attendance.check_in)
            check_out_dt = dt.combine(attendance.attendance_date, attendance.check_out)
            
            if attendance.check_out <= attendance.check_in:
                check_out_dt = dt.combine(
                    attendance.attendance_date + timedelta(days=1),
                    attendance.check_out
                )
            
            delta = check_out_dt - check_in_dt
            work_hours = delta.total_seconds() / 3600
            
            # Apply break time if configured
            break_hours = config.get('break_hours', 1.0)
            work_hours = max(0, work_hours - break_hours)
            
            result['work_hours'] = work_hours
            
            # Check for half day
            half_day_threshold = config.get('half_day_threshold_hours', 4.0)
            if work_hours < half_day_threshold:
                result['status'] = 'HALF_DAY'
                result['notes'] = result.get('notes', []) + [f"Half day: {work_hours} hours worked"]
        
        return result
    
    @staticmethod
    def _apply_overtime_rule(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Apply overtime rule
        """
        config = rule.configuration.get('overtime_rule', {})
        result = {}
        
        regular_hours_threshold = config.get('regular_hours_threshold', 8.0)
        work_hours = attendance.working_hours
        
        if work_hours > regular_hours_threshold:
            overtime_hours = work_hours - regular_hours_threshold
            result['overtime_hours'] = overtime_hours
            
            # Apply overtime multiplier based on day type
            day_type = AttendanceRuleEngine._get_day_type(attendance.attendance_date)
            multiplier = config.get(f'{day_type.lower()}_multiplier', 1.5)
            
            result['notes'] = result.get('notes', []) + [
                f"Overtime: {overtime_hours} hours at {multiplier}x rate"
            ]
        
        return result
    
    @staticmethod
    def _get_day_type(date: datetime.date) -> str:
        """
        Determine day type (WEEKDAY, WEEKEND, HOLIDAY)
        """
        # Check if it's a weekend
        if date.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
            return 'WEEKEND'
        
        # TODO: Check if it's a holiday from HolidayConfig
        # For now, assume weekday
        return 'WEEKDAY'


class LeavePolicyEngine:
    """
    Engine for applying leave policies to employees
    """
    
    @staticmethod
    def get_applicable_policies_for_employee(
        employee: Employee,
        date: datetime.date = None
    ) -> List[LeavePolicyConfig]:
        """
        Get all leave policies that apply to an employee
        
        Args:
            employee: Employee object
            date: Date to check (default: today)
            
        Returns:
            List of applicable LeavePolicyConfig objects
        """
        if date is None:
            date = timezone.now().date()
        
        # Get all active policies effective on the date
        policies = LeavePolicyConfig.objects.filter(
            is_active=True,
            effective_from__lte=date
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=date)
        )
        
        applicable_policies = []
        for policy in policies:
            if policy.should_apply_to_employee(employee):
                applicable_policies.append(policy)
        
        return applicable_policies
    
    @staticmethod
    def validate_leave_request(
        employee: Employee,
        leave_type: str,
        start_date: datetime.date,
        end_date: datetime.date,
        total_days: float
    ) -> Dict[str, Any]:
        """
        Validate a leave request against applicable policies
        
        Args:
            employee: Employee object
            leave_type: Type of leave
            start_date: Start date of leave
            end_date: End date of leave
            total_days: Total days of leave
            
        Returns:
            Dictionary with validation results
        """
        applicable_policies = LeavePolicyEngine.get_applicable_policies_for_employee(employee, start_date)
        
        # Filter policies by leave type
        type_policies = [p for p in applicable_policies if p.leave_type == leave_type]
        
        if not type_policies:
            return {
                'valid': False,
                'errors': [f'No applicable leave policy found for type: {leave_type}'],
                'warnings': []
            }
        
        # Use the most specific policy (first in list after sorting)
        policy = type_policies[0]
        
        errors = []
        warnings = []
        
        # Check max days per year
        if policy.max_days_per_year:
            # TODO: Calculate used days for this year
            used_days = 0  # Placeholder
            remaining_days = policy.max_days_per_year - used_days
            
            if total_days > remaining_days:
                errors.append(
                    f'Requested {total_days} days exceeds remaining {remaining_days} days for this year'
                )
        
        # Check max consecutive days
        if policy.max_consecutive_days and total_days > policy.max_consecutive_days:
            errors.append(
                f'Requested {total_days} consecutive days exceeds maximum of {policy.max_consecutive_days} days'
            )
        
        # Check advance notice
        advance_notice = LeavePolicyEngine._calculate_advance_notice(policy, total_days)
        if advance_notice:
            days_until_start = (start_date - timezone.now().date()).days
            if days_until_start < advance_notice:
                warnings.append(
                    f'Advance notice of {advance_notice} days recommended for {total_days} day leave'
                )
        
        # Check medical certificate requirement
        if policy.requires_medical_certificate and leave_type == 'SICK':
            if total_days >= policy.medical_certificate_days_threshold:
                warnings.append(
                    f'Medical certificate required for sick leave of {total_days} days or more'
                )
        
        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings,
            'policy': {
                'id': policy.id,
                'code': policy.code,
                'name': policy.name
            }
        }
    
    @staticmethod
    def _calculate_advance_notice(policy: LeavePolicyConfig, total_days: float) -> Optional[int]:
        """
        Calculate required advance notice based on policy rules
        """
        advance_rules = policy.advance_notice_rules
        
        if not advance_rules:
            return None
        
        for rule in advance_rules:
            max_days = rule.get('max_days')
            advance_days = rule.get('advance_days')
            
            if max_days is None or total_days <= max_days:
                return advance_days
        
        # If no rule matches, return the last rule's advance_days
        return advance_rules[-1].get('advance_days')


class DepartmentRuleManager:
    """
    Manager for applying rules at department level
    """
    
    @staticmethod
    def get_department_rules_summary(
        department: Department,
        date: datetime.date = None
    ) -> Dict[str, Any]:
        """
        Get summary of rules for all employees in a department
        
        Args:
            department: Department object
            date: Date to check (default: today)
            
        Returns:
            Dictionary with department rules summary
        """
        if date is None:
            date = timezone.now().date()
        
        employees = Employee.objects.filter(department=department, employment_status='ACTIVE')
        
        summary = {
            'department_id': department.id,
            'department_name': department.name,
            'date': date,
            'total_employees': employees.count(),
            'employee_rules': [],
            'rule_statistics': {
                'total_rules_applied': 0,
                'rules_by_type': {},
                'employees_with_rules': 0
            }
        }
        
        total_rules_applied = 0
        rules_by_type = {}
        employees_with_rules = 0
        
        for employee in employees:
            rules = AttendanceRuleEngine.get_applicable_rules_for_employee(employee, date)
            leave_policies = LeavePolicyEngine.get_applicable_policies_for_employee(employee, date)
            
            if rules or leave_policies:
                employees_with_rules += 1
            
            employee_rules = {
                'employee_id': employee.id,
                'employee_name': employee.full_name,
                'employee_code': employee.employee_id,
                'attendance_rules': [
                    {
                        'id': rule.id,
                        'code': rule.code,
                        'name': rule.name,
                        'type': rule.rule_type
                    }
                    for rule in rules
                ],
                'leave_policies': [
                    {
                        'id': policy.id,
                        'code': policy.code,
                        'name': policy.name,
                        'type': policy.leave_type
                    }
                    for policy in leave_policies
                ]
            }
            
            summary['employee_rules'].append(employee_rules)
            
            # Update statistics
            total_rules_applied += len(rules) + len(leave_policies)
            
            for rule in rules:
                rule_type = rule.rule_type
                rules_by_type[rule_type] = rules_by_type.get(rule_type, 0) + 1
            
            for policy in leave_policies:
                policy_type = f"LEAVE_{policy.leave_type}"
                rules_by_type[policy_type] = rules_by_type.get(policy_type, 0) + 1
        
        summary['rule_statistics'] = {
            'total_rules_applied': total_rules_applied,
            'rules_by_type': rules_by_type,
            'employees_with_rules': employees_with_rules,
            'employees_without_rules': employees.count() - employees_with_rules
        }
        
        return summary
    
    @staticmethod
    def apply_department_rules_batch(
        department: Department,
        start_date: datetime.date,
        end_date: datetime.date
    ) -> Dict[str, Any]:
        """
        Apply rules to all attendance records in a department for a date range
        
        Args:
            department: Department object
            start_date: Start date of range
            end_date: End date of range
            
        Returns:
            Dictionary with batch application results
        """
        employees = Employee.objects.filter(department=department, employment_status='ACTIVE')
        
        results = {
            'department_id': department.id,
            'department_name': department.name,
            'date_range': {
                'start_date': start_date,
                'end_date': end_date
            },
            'total_employees': employees.count(),
            'processed_attendances': 0,
            'successful_applications': 0,
            'failed_applications': 0,
            'employee_results': []
        }
        
        # Get attendance records for the date range
        attendances = Attendance.objects.filter(
            employee__department=department,
            attendance_date__gte=start_date,
            attendance_date__lte=end_date
        )
        
        results['total_attendances'] = attendances.count()
        
        for attendance in attendances:
            try:
                # Apply rules to this attendance
                calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(attendance)
                
                # Update attendance record with calculation results
                attendance.status = calculation_result.get('status', attendance.status)
                attendance.working_hours = calculation_result.get('work_hours', attendance.working_hours)
                attendance.late_minutes = calculation_result.get('late_minutes', attendance.late_minutes)
                attendance.early_leave_minutes = calculation_result.get('early_leave_minutes', attendance.early_leave_minutes)
                attendance.overtime_hours = calculation_result.get('overtime_hours', attendance.overtime_hours)
                
                # Save the updated attendance
                attendance.save()
                
                # Create rule history record
                from .models import AttendanceRuleHistory
                for rule_info in calculation_result.get('applied_rules', []):
                    AttendanceRuleHistory.objects.create(
                        attendance=attendance,
                        rule_id=rule_info['rule_id'],
                        applied_configuration=rule_info,
                        calculation_result=calculation_result
                    )
                
                results['successful_applications'] += 1
                
                employee_result = next(
                    (er for er in results['employee_results'] if er['employee_id'] == attendance.employee.id),
                    None
                )
                
                if not employee_result:
                    employee_result = {
                        'employee_id': attendance.employee.id,
                        'employee_name': attendance.employee.full_name,
                        'processed_attendances': 0,
                        'successful_applications': 0,
                        'failed_applications': 0
                    }
                    results['employee_results'].append(employee_result)
                
                employee_result['processed_attendances'] += 1
                employee_result['successful_applications'] += 1
                
            except Exception as e:
                results['failed_applications'] += 1
                
                employee_result = next(
                    (er for er in results['employee_results'] if er['employee_id'] == attendance.employee.id),
                    None
                )
                
                if not employee_result:
                    employee_result = {
                        'employee_id': attendance.employee.id,
                        'employee_name': attendance.employee.full_name,
                        'processed_attendances': 0,
                        'successful_applications': 0,
                        'failed_applications': 0
                    }
                    results['employee_results'].append(employee_result)
                
                employee_result['processed_attendances'] += 1
                employee_result['failed_applications'] += 1
                employee_result['last_error'] = str(e)
            
            results['processed_attendances'] += 1
        
        return results
    
    @staticmethod
    def get_department_rule_compliance_report(
        department: Department,
        start_date: datetime.date,
        end_date: datetime.date
    ) -> Dict[str, Any]:
        """
        Generate compliance report for department rules
        
        Args:
            department: Department object
            start_date: Start date of report
            end_date: End date of report
            
        Returns:
            Dictionary with compliance report
        """
        employees = Employee.objects.filter(department=department, employment_status='ACTIVE')
        
        report = {
            'department_id': department.id,
            'department_name': department.name,
            'report_period': {
                'start_date': start_date,
                'end_date': end_date
            },
            'total_employees': employees.count(),
            'compliance_summary': {
                'total_attendances': 0,
                'compliant_attendances': 0,
                'non_compliant_attendances': 0,
                'compliance_rate': 0.0
            },
            'rule_violations': {},
            'employee_compliance': []
        }
        
        # Get attendance records for the period
        attendances = Attendance.objects.filter(
            employee__department=department,
            attendance_date__gte=start_date,
            attendance_date__lte=end_date
        )
        
        total_attendances = attendances.count()
        compliant_attendances = 0
        rule_violations = {}
        
        for attendance in attendances:
            # Get applicable rules
            rules = AttendanceRuleEngine.get_applicable_rules_for_employee(
                attendance.employee, attendance.attendance_date
            )
            
            # Check compliance with each rule
            is_compliant = True
            violations = []
            
            for rule in rules:
                compliance_check = DepartmentRuleManager._check_rule_compliance(attendance, rule)
                if not compliance_check['is_compliant']:
                    is_compliant = False
                    violations.append({
                        'rule_id': rule.id,
                        'rule_code': rule.code,
                        'rule_name': rule.name,
                        'violation_type': compliance_check['violation_type'],
                        'description': compliance_check['description']
                    })
                    
                    # Update rule violations statistics
                    rule_violations[rule.rule_type] = rule_violations.get(rule.rule_type, 0) + 1
            
            if is_compliant:
                compliant_attendances += 1
            
            # Update employee compliance
            employee_compliance = next(
                (ec for ec in report['employee_compliance'] if ec['employee_id'] == attendance.employee.id),
                None
            )
            
            if not employee_compliance:
                employee_compliance = {
                    'employee_id': attendance.employee.id,
                    'employee_name': attendance.employee.full_name,
                    'total_attendances': 0,
                    'compliant_attendances': 0,
                    'non_compliant_attendances': 0,
                    'violations': []
                }
                report['employee_compliance'].append(employee_compliance)
            
            employee_compliance['total_attendances'] += 1
            
            if is_compliant:
                employee_compliance['compliant_attendances'] += 1
            else:
                employee_compliance['non_compliant_attendances'] += 1
                employee_compliance['violations'].extend(violations)
        
        # Calculate compliance rate
        compliance_rate = (compliant_attendances / total_attendances * 100) if total_attendances > 0 else 0
        
        report['compliance_summary'] = {
            'total_attendances': total_attendances,
            'compliant_attendances': compliant_attendances,
            'non_compliant_attendances': total_attendances - compliant_attendances,
            'compliance_rate': round(compliance_rate, 2)
        }
        
        report['rule_violations'] = rule_violations
        
        return report
    
    @staticmethod
    def _check_rule_compliance(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Check if attendance complies with a specific rule
        
        Args:
            attendance: Attendance object
            rule: AttendanceRuleConfig object
            
        Returns:
            Dictionary with compliance check results
        """
        if rule.rule_type == 'SHIFT_RULE':
            return DepartmentRuleManager._check_shift_rule_compliance(attendance, rule)
        elif rule.rule_type == 'LATE_EARLY_RULE':
            return DepartmentRuleManager._check_late_early_rule_compliance(attendance, rule)
        elif rule.rule_type == 'WORK_HOUR_CALCULATION':
            return DepartmentRuleManager._check_work_hour_rule_compliance(attendance, rule)
        elif rule.rule_type == 'OVERTIME_RULE':
            return DepartmentRuleManager._check_overtime_rule_compliance(attendance, rule)
        else:
            return {
                'is_compliant': True,
                'violation_type': 'UNKNOWN_RULE_TYPE',
                'description': f'Unknown rule type: {rule.rule_type}'
            }
    
    @staticmethod
    def _check_shift_rule_compliance(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Check compliance with shift rule
        """
        config = rule.configuration.get('shift_rule', {})
        
        if not attendance.check_in or not attendance.check_out:
            return {
                'is_compliant': False,
                'violation_type': 'MISSING_CHECK_IN_OUT',
                'description': 'Missing check-in or check-out time'
            }
        
        expected_start = config.get('start_time')
        expected_end = config.get('end_time')
        
        if not expected_start or not expected_end:
            return {
                'is_compliant': True,  # No specific time requirements
                'violation_type': None,
                'description': 'No specific shift time requirements'
            }
        
        # Convert string times to time objects
        from datetime import datetime as dt
        try:
            expected_start_time = dt.strptime(expected_start, '%H:%M').time()
            expected_end_time = dt.strptime(expected_end, '%H:%M').time()
        except ValueError:
            return {
                'is_compliant': True,  # Invalid time format in config
                'violation_type': 'INVALID_TIME_FORMAT',
                'description': f'Invalid time format in rule configuration: {expected_start} - {expected_end}'
            }
        
        # Check if attendance is within shift
        is_within_shift = (
            attendance.check_in >= expected_start_time and
            attendance.check_out <= expected_end_time
        )
        
        if not is_within_shift:
            return {
                'is_compliant': False,
                'violation_type': 'OUTSIDE_SHIFT_HOURS',
                'description': f'Attendance outside shift hours: {expected_start} - {expected_end}'
            }
        
        return {
            'is_compliant': True,
            'violation_type': None,
            'description': 'Compliant with shift rule'
        }
    
    @staticmethod
    def _check_late_early_rule_compliance(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Check compliance with late/early rule
        """
        # Try to get config from late_early_rule key first, then fall back to root level
        config = rule.configuration.get('late_early_rule', {})
        if not config and rule.configuration:
            # If no late_early_rule key, check if thresholds are at root level
            config = rule.configuration
        
        late_threshold = config.get('late_threshold_minutes', 15)
        early_leave_threshold = config.get('early_leave_threshold_minutes', 15)
        
        violations = []
        
        # Check for late arrival
        if attendance.check_in:
            # Try to get shift times from rule configuration
            expected_start = rule.configuration.get('shift_rule', {}).get('start_time')
            if not expected_start:
                # Also check at root level
                expected_start = rule.configuration.get('start_time')
            
            if expected_start:
                from datetime import datetime as dt
                try:
                    expected_start_time = dt.strptime(expected_start, '%H:%M').time()
                    
                    if attendance.check_in > expected_start_time:
                        late_minutes = (attendance.check_in.hour * 60 + attendance.check_in.minute) - \
                                      (expected_start_time.hour * 60 + expected_start_time.minute)
                        
                        if late_minutes > late_threshold:
                            violations.append({
                                'type': 'LATE_ARRIVAL',
                                'minutes': late_minutes,
                                'threshold': late_threshold
                            })
                except ValueError:
                    pass
        
        # Check for early leave
        if attendance.check_out:
            # Try to get shift times from rule configuration
            expected_end = rule.configuration.get('shift_rule', {}).get('end_time')
            if not expected_end:
                # Also check at root level
                expected_end = rule.configuration.get('end_time')
            
            if expected_end:
                from datetime import datetime as dt
                try:
                    expected_end_time = dt.strptime(expected_end, '%H:%M').time()
                    
                    if attendance.check_out < expected_end_time:
                        early_minutes = (expected_end_time.hour * 60 + expected_end_time.minute) - \
                                       (attendance.check_out.hour * 60 + attendance.check_out.minute)
                        
                        if early_minutes > early_leave_threshold:
                            violations.append({
                                'type': 'EARLY_LEAVE',
                                'minutes': early_minutes,
                                'threshold': early_leave_threshold
                            })
                except ValueError:
                    pass
        
        if violations:
            violation_descriptions = [
                f"{v['type']}: {v['minutes']} minutes (threshold: {v['threshold']} minutes)"
                for v in violations
            ]
            
            return {
                'is_compliant': False,
                'violation_type': 'LATE_EARLY_VIOLATION',
                'description': '; '.join(violation_descriptions)
            }
        
        return {
            'is_compliant': True,
            'violation_type': None,
            'description': 'Compliant with late/early rule'
        }
    
    @staticmethod
    def _check_work_hour_rule_compliance(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Check compliance with work hour rule
        """
        config = rule.configuration.get('work_hour_calculation', {})
        
        if not attendance.check_in or not attendance.check_out:
            return {
                'is_compliant': False,
                'violation_type': 'MISSING_CHECK_IN_OUT',
                'description': 'Missing check-in or check-out time for work hour calculation'
            }
        
        # Calculate actual work hours
        from datetime import datetime as dt
        check_in_dt = dt.combine(attendance.attendance_date, attendance.check_in)
        check_out_dt = dt.combine(attendance.attendance_date, attendance.check_out)
        
        if attendance.check_out <= attendance.check_in:
            check_out_dt = dt.combine(
                attendance.attendance_date + timedelta(days=1),
                attendance.check_out
            )
        
        delta = check_out_dt - check_in_dt
        work_hours = delta.total_seconds() / 3600
        
        # Apply break time if configured
        break_hours = config.get('break_hours', 1.0)
        work_hours = max(0, work_hours - break_hours)
        
        # Check minimum work hours
        min_work_hours = config.get('min_work_hours')
        if min_work_hours and work_hours < min_work_hours:
            return {
                'is_compliant': False,
                'violation_type': 'INSUFFICIENT_WORK_HOURS',
                'description': f'Work hours ({work_hours:.2f}) below minimum ({min_work_hours})'
            }
        
        return {
            'is_compliant': True,
            'violation_type': None,
            'description': f'Compliant with work hour rule: {work_hours:.2f} hours worked'
        }
    
    @staticmethod
    def _check_overtime_rule_compliance(attendance: Attendance, rule: AttendanceRuleConfig) -> Dict[str, Any]:
        """
        Check compliance with overtime rule
        """
        # Overtime rules typically don't have compliance violations
        # They just calculate overtime hours
        return {
            'is_compliant': True,
            'violation_type': None,
            'description': 'Overtime rule compliance check passed'
        }
    
    @staticmethod
    def get_department_rule_configuration(
        department: Department,
        rule_type: str = None
    ) -> Dict[str, Any]:
        """
        Get rule configuration for a department
        
        Args:
            department: Department object
            rule_type: Optional filter for rule type
            
        Returns:
            Dictionary with department rule configuration
        """
        # Get rules that apply to this department
        rules = AttendanceRuleConfig.objects.filter(
            is_active=True,
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).filter(
            models.Q(apply_to_departments=department) | models.Q(apply_to_all=True)
        ).distinct()
        
        if rule_type:
            rules = rules.filter(rule_type=rule_type)
        
        leave_policies = LeavePolicyConfig.objects.filter(
            is_active=True,
            effective_from__lte=timezone.now().date()
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=timezone.now().date())
        ).filter(
            models.Q(apply_to_departments=department) | models.Q(apply_to_all=True)
        ).distinct()
        
        return {
            'department_id': department.id,
            'department_name': department.name,
            'attendance_rules': [
                {
                    'id': rule.id,
                    'code': rule.code,
                    'name': rule.name,
                    'type': rule.rule_type,
                    'configuration': rule.configuration,
                    'effective_from': rule.effective_from,
                    'effective_to': rule.effective_to,
                    'applies_to': 'DEPARTMENT' if rule.apply_to_departments.filter(id=department.id).exists() else 'ALL'
                }
                for rule in rules
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
                    'effective_to': policy.effective_to,
                    'applies_to': 'DEPARTMENT' if policy.apply_to_departments.filter(id=department.id).exists() else 'ALL'
                }
                for policy in leave_policies
            ]
        }


# Utility functions for rule application
def apply_rules_to_employee_attendance(employee_id: int, date: datetime.date) -> Dict[str, Any]:
    """
    Apply rules to all attendance records for an employee on a specific date
    
    Args:
        employee_id: Employee ID
        date: Date to apply rules
        
    Returns:
        Dictionary with application results
    """
    try:
        employee = Employee.objects.get(id=employee_id)
    except Employee.DoesNotExist:
        return {
            'success': False,
            'error': f'Employee with ID {employee_id} does not exist'
        }
    
    # Get attendance records for the date
    attendances = Attendance.objects.filter(
        employee=employee,
        attendance_date=date
    )
    
    results = {
        'employee_id': employee.id,
        'employee_name': employee.full_name,
        'date': date,
        'total_attendances': attendances.count(),
        'processed_attendances': 0,
        'successful_applications': 0,
        'failed_applications': 0,
        'attendance_results': []
    }
    
    for attendance in attendances:
        try:
            # Apply rules to this attendance
            calculation_result = AttendanceRuleEngine.apply_rules_to_attendance(attendance)
            
            # Update attendance record
            attendance.status = calculation_result.get('status', attendance.status)
            attendance.working_hours = calculation_result.get('work_hours', attendance.working_hours)
            attendance.late_minutes = calculation_result.get('late_minutes', attendance.late_minutes)
            attendance.early_leave_minutes = calculation_result.get('early_leave_minutes', attendance.early_leave_minutes)
            attendance.overtime_hours = calculation_result.get('overtime_hours', attendance.overtime_hours)
            
            attendance.save()
            
            # Create rule history
            from .models import AttendanceRuleHistory
            for rule_info in calculation_result.get('applied_rules', []):
                AttendanceRuleHistory.objects.create(
                    attendance=attendance,
                    rule_id=rule_info['rule_id'],
                    applied_configuration=rule_info,
                    calculation_result=calculation_result
                )
            
            results['successful_applications'] += 1
            results['attendance_results'].append({
                'attendance_id': attendance.id,
                'attendance_code': attendance.attendance_code,
                'status': attendance.status,
                'work_hours': float(attendance.working_hours),
                'success': True
            })
            
        except Exception as e:
            results['failed_applications'] += 1
            results['attendance_results'].append({
                'attendance_id': attendance.id,
                'attendance_code': attendance.attendance_code,
                'success': False,
                'error': str(e)
            })
        
        results['processed_attendances'] += 1
    
    return results


def apply_rules_to_department_attendance(department_id: int, start_date: datetime.date, end_date: datetime.date) -> Dict[str, Any]:
    """
    Apply rules to all attendance records in a department for a date range
    
    Args:
        department_id: Department ID
        start_date: Start date
        end_date: End date
        
    Returns:
        Dictionary with batch application results
    """
    try:
        department = Department.objects.get(id=department_id)
    except Department.DoesNotExist:
        return {
            'success': False,
            'error': f'Department with ID {department_id} does not exist'
        }
    
    return DepartmentRuleManager.apply_department_rules_batch(department, start_date, end_date)


def validate_employee_leave_request(employee_id: int, leave_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate a leave request for an employee
    
    Args:
        employee_id: Employee ID
        leave_data: Dictionary with leave request data
        
    Returns:
        Dictionary with validation results
    """
    try:
        employee = Employee.objects.get(id=employee_id)
    except Employee.DoesNotExist:
        return {
            'valid': False,
            'errors': [f'Employee with ID {employee_id} does not exist'],
            'warnings': []
        }
    
    leave_type = leave_data.get('leave_type')
    start_date = leave_data.get('start_date')
    end_date = leave_data.get('end_date')
    total_days = leave_data.get('total_days', 1)
    
    if not all([leave_type, start_date, end_date]):
        return {
            'valid': False,
            'errors': ['Missing required fields: leave_type, start_date, end_date'],
            'warnings': []
        }
    
    # Parse dates if they're strings
    if isinstance(start_date, str):
        start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
    if isinstance(end_date, str):
        end_date = datetime.strptime(end_date, '%Y-%m-%d').date()
    
    return LeavePolicyEngine.validate_leave_request(
        employee, leave_type, start_date, end_date, total_days
    )


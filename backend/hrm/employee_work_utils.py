from datetime import date

from employee.models import Employee


def is_employee_active_on_date(employee: Employee, target_date: date) -> bool:
    if employee.start_date and target_date < employee.start_date:
        return False
    if employee.end_date and target_date > employee.end_date:
        return False
    return True


def is_holiday_creditable(employee: Employee, holiday_date: date) -> bool:
    """Ngày lễ `holiday_date` có được cộng công lễ cho nhân viên không.

    Giống is_employee_active_on_date nhưng LOẠI cả ngày lễ trùng đúng
    end_date: HCNS nhập "Ngày kết thúc làm việc" là ngày bắt đầu nghỉ (vd
    nghỉ từ 01/09 thì end_date = 01/09), nên lễ rơi đúng ngày đó là lễ SAU
    khi đã nghỉ việc — không được cộng công lễ (yêu cầu 2026-10-03, cả 3
    tenant). Chỉ áp cho công lễ; công đi làm thực tế ngày end_date vẫn tính
    như cũ."""
    if not is_employee_active_on_date(employee, holiday_date):
        return False
    return not (employee.end_date and holiday_date == employee.end_date)


def get_holiday_credit_for_employee(employee: Employee, on_date: date = None, assignment=None) -> float:
    """Công lễ 1 ngày: part-time 0.5, còn lại 1.0. Có on_date thì xét hình thức
    làm việc VÀO NGÀY ĐÓ (lịch sử điều chuyển, employee/assignment.py) — case
    NV02848: T9 part-time, T10 lên full-time thì lễ 01-02/09 vẫn 0.5/ngày."""
    if on_date is not None and employee is not None:
        from employee.assignment import AssignmentResolver
        employee = (assignment or AssignmentResolver()).employee_on(employee, on_date)
    return 0.5 if str(getattr(employee, 'work_form', None) or '').upper() == 'PART_TIME' else 1.0

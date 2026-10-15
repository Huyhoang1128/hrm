"""
Tra lịch làm việc của phòng ban THEO NGÀY — dùng thay cho việc đọc thẳng 3 cờ trên
Department (works_on_sunday, saturday_afternoon_always_workday, online_weekend_unlimited).

Giá trị của cờ vào ngày D = dòng DepartmentScheduleChange gần nhất có
effective_from <= D; chưa có dòng nào thì lấy cờ trên Department (lịch gốc). Nhờ vậy
đổi lịch từ 15/10 thì các ngày 01–14/10 vẫn tính theo lịch cũ khi tính lại công.

Cờ ghi đè riêng của nhân viên (Employee.saturday_afternoon_always_workday, khác None)
vẫn ưu tiên tuyệt đối như trước, không phụ thuộc ngày.

Dùng 1 ScheduleResolver cho cả một lượt tính (1 truy vấn cho toàn bộ bảng đổi lịch,
bảng rất nhỏ). Phòng ban không phải bản ghi thật (object giả trong test) thì chỉ đọc
cờ gốc, không truy vấn DB.
"""
from collections import defaultdict

SCHEDULE_FLAGS = ("works_on_sunday", "saturday_afternoon_always_workday", "online_weekend_unlimited")


class ScheduleResolver:
    def __init__(self, assignment=None):
        self._by_department = None
        self._assignment = assignment

    @property
    def assignment(self):
        if self._assignment is None:
            from .assignment import AssignmentResolver
            self._assignment = AssignmentResolver()
        return self._assignment

    def department_on(self, employee, on_date):
        """Phòng ban của nhân viên VÀO NGÀY on_date (lịch sử điều chuyển,
        employee/assignment.py) — chuyển phòng không đổi lịch các ngày trước đó."""
        return self.assignment.department_on(employee, on_date)

    def _load(self):
        from .models import DepartmentScheduleChange

        by_department = defaultdict(list)
        for change in DepartmentScheduleChange.objects.order_by('effective_from', 'id'):
            by_department[change.department_id].append(change)
        self._by_department = by_department

    def flag(self, department, flag, on_date) -> bool:
        if department is None:
            return False
        value = bool(getattr(department, flag, False))
        department_id = getattr(department, 'pk', None)
        if on_date is None or not isinstance(department_id, int):
            return value
        if self._by_department is None:
            self._load()
        for change in self._by_department.get(department_id, ()):
            if change.effective_from > on_date:
                break
            value = bool(getattr(change, flag))
        return value

    def saturday_afternoon_workday(self, employee, on_date) -> bool:
        """Chiều thứ 7 có là giờ làm (mọi tuần) với nhân viên này vào ngày on_date."""
        if employee is None:
            return False
        override = getattr(employee, 'saturday_afternoon_always_workday', None)
        if override is not None:
            return bool(override)
        return self.flag(self.department_on(employee, on_date), 'saturday_afternoon_always_workday', on_date)


def saturday_afternoon_by_date(department, year, month, schedule=None) -> dict:
    """{ngày thứ 7: có làm chiều không} cho mọi thứ 7 của tháng, theo lịch phòng ban
    của chính ngày đó — engine chấm công (hrm/main_api.py replay_month) dùng."""
    import calendar
    import datetime as _dt

    schedule = schedule or ScheduleResolver()
    result = {}
    for day in range(1, calendar.monthrange(year, month)[1] + 1):
        d = _dt.date(year, month, day)
        if d.weekday() == 5:
            result[d] = schedule.flag(department, "saturday_afternoon_always_workday", d)
    return result


def department_flag(department, flag, on_date) -> bool:
    return ScheduleResolver().flag(department, flag, on_date)


def saturday_afternoon_workday(employee, on_date) -> bool:
    return ScheduleResolver().saturday_afternoon_workday(employee, on_date)

"""
Phòng ban / vị trí / Team bác sĩ / hình thức làm việc / ca cá nhân của nhân viên
THEO NGÀY — dùng thay cho việc đọc thẳng các trường đó trên Employee khi tính công,
để điều chuyển không làm đổi công của các tháng trước (yêu cầu 2026-10-15).

Mỗi lần HR đổi một trong các thông tin trên, employee/signals.py ghi 1 dòng
EmployeeAssignmentHistory chứa giá trị CŨ, áp cho các ngày TRƯỚC `changed_from`.
Giá trị vào ngày D = dòng có changed_from > D gần D nhất (các dòng trùng ngày lấy
dòng tạo trước); không có dòng nào thì dùng dữ liệu hiện tại trên Employee.

Dùng 1 AssignmentResolver cho cả một lượt tính (1 truy vấn/nhân viên). Nhân viên
không phải bản ghi thật (object giả trong test) thì luôn dùng dữ liệu hiện tại.
"""
import copy

TRACKED_FIELDS = ('department_id', 'position_id', 'doctor_team', 'work_form')


class AssignmentResolver:
    def __init__(self):
        self._rows = {}

    def _rows_for(self, employee):
        pk = getattr(employee, 'pk', None)
        if not isinstance(pk, int):
            return ()
        rows = self._rows.get(pk)
        if rows is None:
            from .models import EmployeeAssignmentHistory

            rows = list(
                EmployeeAssignmentHistory.objects.filter(employee_id=pk)
                .select_related('department', 'position')
                .order_by('changed_from', 'id')
            )
            self._rows[pk] = rows
        return rows

    def snapshot(self, employee, on_date):
        """Dòng lịch sử áp cho on_date, hoặc None (= dữ liệu hiện tại)."""
        if employee is None or on_date is None:
            return None
        for row in self._rows_for(employee):
            if row.changed_from > on_date:
                return row
        return None

    def employee_on(self, employee, on_date):
        """Employee như vào ngày on_date: bản sao mang phòng ban/vị trí/Team bác sĩ/
        hình thức cũ nếu có lịch sử, ngược lại chính `employee`. Bản sao giữ nguyên
        pk nên mọi truy vấn theo nhân viên (đơn, chấm công, ca đăng ký) vẫn đúng."""
        row = self.snapshot(employee, on_date)
        if row is None:
            return employee
        clone = copy.copy(employee)
        clone.department = row.department
        clone.position = row.position
        clone.doctor_team = row.doctor_team
        clone.work_form = row.work_form
        clone._assignment_snapshot = row
        return clone

    def department_on(self, employee, on_date):
        if employee is None:
            return None
        return getattr(self.employee_on(employee, on_date), 'department', None)

    def personal_shift_ids(self, employee, on_date):
        """id các ca cá nhân (ShiftConfig.apply_to_employees) vào on_date, hoặc None
        = dùng ca cá nhân hiện tại."""
        row = self.snapshot(employee, on_date)
        return None if row is None else row.personal_shift_ids


def employee_on(employee, on_date):
    return AssignmentResolver().employee_on(employee, on_date)


def current_personal_shift_ids(employee_id) -> list:
    from hrm.models import ShiftConfig

    return sorted(ShiftConfig.objects.filter(apply_to_employees=employee_id).values_list('id', flat=True))


def record_assignment_snapshot(employee_id, old_values: dict, personal_shift_ids):
    """Ghi phòng ban/vị trí/Team bác sĩ/hình thức/ca cá nhân CŨ trước khi đổi, áp
    cho các ngày trước hôm nay. Trong ngày đã có dòng thì thôi: dòng đó đã giữ dữ
    liệu đầu ngày, các lần đổi sau trong cùng ngày không làm khác gì các ngày trước."""
    from django.utils import timezone
    from .models import EmployeeAssignmentHistory

    today = timezone.localdate()
    if EmployeeAssignmentHistory.objects.filter(employee_id=employee_id, changed_from=today).exists():
        return None
    return EmployeeAssignmentHistory.objects.create(
        employee_id=employee_id,
        changed_from=today,
        department_id=old_values.get('department_id'),
        position_id=old_values.get('position_id'),
        doctor_team=old_values.get('doctor_team'),
        work_form=old_values.get('work_form'),
        personal_shift_ids=list(personal_shift_ids),
    )

from django.core.management.base import BaseCommand

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.models import _is_hr
from hrm.registration_serializers import REGISTRATION_EVENT_TYPES


class Command(BaseCommand):
    """
    Debug: QLTT báo không thấy đơn "Nghỉ không phép" của nhân viên ở mục phê
    duyệt. Đây là lệnh READ-ONLY, chỉ đọc dữ liệu đã có sẵn trong DB — KHÔNG
    tạo/sửa/xoá gì — để trả lời 2 câu hỏi:

      1. Đơn (EmployeeEvent) có thực sự tồn tại trong DB cho khoảng ngày này
         không? (loại trừ khả năng lần gửi đơn đó thất bại thật, không tạo
         được gì — khác với lỗi hiển thị lịch đã fix trước đó)
      2. Nếu có tồn tại, nó có khớp điều kiện hiển thị cho QLTT của nhân viên
         đó ở trang phê duyệt không? (_get_visible_q trong registration_views.py:
         quản lý chỉ thấy đơn của chính mình + cấp dưới TRỰC TIẾP — employee.manager
         phải trỏ đúng người)

    Usage: python manage.py diagnose_unauthorized_absence_status <employee_id> [start_date YYYY-MM-DD] [end_date YYYY-MM-DD]
    """
    help = "Debug: kiểm tra đơn nghỉ không phép đã tạo (nếu có) có tồn tại và có hiển thị đúng cho QLTT không (read-only)"

    def add_arguments(self, parser):
        parser.add_argument('employee_id', type=str)
        parser.add_argument('start_date', type=str, nargs='?', default='2026-09-01')
        parser.add_argument('end_date', type=str, nargs='?', default='2026-09-30')

    def handle(self, *args, **options):
        employee_code = options['employee_id']
        start_date = options['start_date']
        end_date = options['end_date']

        try:
            employee = Employee.objects.select_related('manager', 'department', 'department__manager').get(
                employee_id=employee_code
            )
        except Employee.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Không tìm thấy nhân viên {employee_code}"))
            return

        self.stdout.write(f"=== Nhân viên: {employee.employee_id} - {employee.full_name} (id={employee.id}) ===")

        manager = employee.manager
        if manager:
            self.stdout.write(
                f"QLTT (employee.manager): {manager.employee_id} - {manager.full_name} "
                f"(id={manager.id}, is_hr={_is_hr(manager)})"
            )
        else:
            self.stdout.write(self.style.WARNING(
                "employee.manager = NULL — nhân viên này KHÔNG có QLTT trực tiếp nào được "
                "gán trong hệ thống! Nếu đúng vậy, sẽ KHÔNG CÓ AI thấy đơn của họ ở mục phê "
                "duyệt (theo vai trò Manager) trừ khi người xem là HR."
            ))

        dept = employee.department
        if dept:
            dept_manager = dept.manager
            self.stdout.write(
                f"Phòng ban: {dept.name} — Trưởng phòng: "
                f"{f'{dept_manager.employee_id} - {dept_manager.full_name}' if dept_manager else '(không có)'}"
            )
        else:
            self.stdout.write("Phòng ban: (không có)")

        # ── 1. Đơn có thực sự tồn tại trong DB không? ───────────────────────
        self.stdout.write(f"\n=== EmployeeEvent loại registration-request trong [{start_date} .. {end_date}] ===")
        events = (
            EmployeeEvent.objects
            .filter(employee=employee, event_type__in=REGISTRATION_EVENT_TYPES,
                    event_date__gte=start_date, event_date__lte=end_date)
            .order_by('event_date')
        )
        if not events.exists():
            self.stdout.write(self.style.ERROR(
                "KHÔNG tìm thấy EmployeeEvent (registration-request) nào cho nhân viên này "
                "trong khoảng ngày trên — đơn CHƯA TỪNG được tạo thành công trong DB (khác "
                "với lỗi hiển thị lịch đã fix trước đó, lỗi đó vẫn tạo được event thật)."
            ))
        else:
            for ev in events:
                d = ev.data or {}
                self.stdout.write(
                    f"  id={ev.id} | event_date={ev.event_date} | event_type={ev.event_type} | "
                    f"status={d.get('status')} | request_code={d.get('request_code')} | "
                    f"start_date={d.get('start_date')} | end_date={d.get('end_date')} | "
                    f"direct_manager_approved={d.get('direct_manager_approved')} | "
                    f"created_by_id={ev.created_by_id} | created_at={ev.created_at}"
                )

        # ── 2. Nếu có, QLTT có thấy được không? ─────────────────────────────
        unauthorized_events = [
            ev for ev in events
            if ev.event_type == EmployeeEvent.EventType.UNAUTHORIZED_ABSENCE
        ]
        if unauthorized_events and manager:
            self.stdout.write(f"\n=== Kiểm tra điều kiện hiển thị cho QLTT ({manager.employee_id}) ===")
            manager_sees_as_subordinate = (employee.manager_id == manager.id)
            self.stdout.write(
                f"employee.manager_id ({employee.manager_id}) == QLTT.id ({manager.id}) ? "
                f"{manager_sees_as_subordinate}"
            )
            if manager_sees_as_subordinate:
                self.stdout.write(self.style.SUCCESS(
                    "-> QLTT này ĐÚNG LÀ manager trực tiếp -> theo code, các đơn PENDING của "
                    "nhân viên PHẢI hiện trong mục phê duyệt của QLTT. Nếu QLTT vẫn báo không "
                    "thấy, khả năng cao là đang xem NHẦM tài khoản/nhân viên, hoặc filter "
                    "status/khoảng ngày trên UI đang thu hẹp danh sách, hoặc lỗi FE khác — "
                    "không phải do thiếu dữ liệu hay sai employee.manager."
                ))
            else:
                self.stdout.write(self.style.ERROR(
                    "-> QLTT KHÔNG phải employee.manager trực tiếp của nhân viên này trong hệ "
                    "thống -> đây là lý do đơn không hiện ở mục phê duyệt của họ (dữ liệu tổ "
                    "chức/employee.manager sai hoặc chưa cập nhật, không phải bug ở luồng tạo "
                    "đơn hay hiển thị lịch)."
                ))
        elif unauthorized_events and not manager:
            self.stdout.write(self.style.ERROR(
                "\nCó đơn UNAUTHORIZED_ABSENCE PENDING nhưng employee.manager = NULL -> "
                "không ai được coi là QLTT trực tiếp của nhân viên này trong hệ thống, nên "
                "không ai thấy đơn ở mục phê duyệt theo vai trò Manager -> cần gán lại "
                "employee.manager cho đúng."
            ))

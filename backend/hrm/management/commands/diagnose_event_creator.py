from django.core.management.base import BaseCommand

from employee.models import Employee
from hrm.event_models import EmployeeEvent, EmployeeEventAuditLog


class Command(BaseCommand):
    """
    Debug: xác định AI đã tạo 1 (hoặc nhiều) EmployeeEvent cụ thể — dùng khi phát
    hiện đơn "rác"/test bị tạo nhầm trên tài khoản nhân viên thật (vd đơn tăng ca
    "test con han", "test admin bypass" xuất hiện trên bảng chấm công của 1 NV
    không liên quan). Lệnh READ-ONLY, không sửa/xoá gì.

    In ra:
      1. EmployeeEvent.created_by (Employee tương ứng với request.user đã gọi
         API tạo đơn — xem RegistrationRequestViewSet._get_approver()).
      2. EmployeeEventAuditLog liên quan (nếu có) — chi tiết hơn: user thực
         hiện, vai trò tại thời điểm đó, payload request gốc.

    Usage:
      python manage.py diagnose_event_creator <employee_id_NV_bị_ảnh_hưởng> <attendance_date YYYY-MM-DD>
      python manage.py diagnose_event_creator <employee_id_NV_bị_ảnh_hưởng> <attendance_date> --contains "test con han"
    """
    help = "Debug: xác định ai đã tạo 1 EmployeeEvent cụ thể (đơn tăng ca/nghỉ/... bị tạo nhầm) (read-only)"

    def add_arguments(self, parser):
        parser.add_argument('employee_id', type=str, help='Mã NV (employee_id) bị ảnh hưởng, vd NV80001')
        parser.add_argument('attendance_date', type=str, help='Ngày của đơn, định dạng YYYY-MM-DD')
        parser.add_argument(
            '--contains', type=str, default=None,
            help='(tuỳ chọn) chỉ lọc các đơn có notes/reason chứa chuỗi này (không phân biệt hoa/thường)',
        )

    def handle(self, *args, **options):
        employee_id = options['employee_id']
        attendance_date = options['attendance_date']
        contains = options.get('contains')

        target = Employee.objects.filter(employee_id=employee_id).first()
        if not target:
            self.stdout.write(self.style.ERROR(f"Không tìm thấy Employee employee_id='{employee_id}'"))
            return

        self.stdout.write(f"=== NV bị ảnh hưởng: {target.employee_id} - {target.full_name} (id={target.id}) ===\n")

        events = EmployeeEvent.objects.filter(
            employee=target, event_date=attendance_date,
        ).select_related('created_by', 'created_by__user').order_by('id')

        if contains:
            events = [
                e for e in events
                if contains.lower() in (e.notes or '').lower()
                or contains.lower() in str((e.data or {}).get('reason', '')).lower()
            ]

        if not events:
            self.stdout.write(self.style.WARNING(
                f"Không tìm thấy EmployeeEvent nào cho {employee_id} ngày {attendance_date}"
                + (f" chứa '{contains}'" if contains else "")
            ))
            return

        for ev in events:
            self.stdout.write(f"--- EmployeeEvent id={ev.id} | event_type={ev.event_type} | ngày={ev.event_date} ---")
            data = ev.data or {}
            self.stdout.write(f"  registration_type={data.get('registration_type', '')} | status={data.get('status', '')}")
            self.stdout.write(f"  notes={ev.notes!r}")
            self.stdout.write(f"  data.reason={data.get('reason', '')!r}")
            self.stdout.write(f"  created_at={ev.created_at}")

            if ev.created_by:
                creator = ev.created_by
                self.stdout.write(self.style.SUCCESS(
                    f"  -> created_by (Employee): {creator.employee_id} - {creator.full_name} "
                    f"(id={creator.id}, username={creator.user.username if creator.user else '(không có)'})"
                ))
            else:
                self.stdout.write(self.style.WARNING(
                    "  -> created_by = NULL (không xác định được qua EmployeeEvent.created_by, "
                    "kiểm tra thêm audit log bên dưới)"
                ))

            audit_logs = EmployeeEventAuditLog.objects.filter(event=ev).select_related(
                'performed_by_user', 'performed_by_employee'
            ).order_by('created_at')
            if audit_logs:
                self.stdout.write("  Audit log:")
                for log in audit_logs:
                    self.stdout.write(
                        f"    [{log.created_at}] {log.get_action_display()} bởi "
                        f"user={log.performed_by_user.username if log.performed_by_user else '(không có)'} "
                        f"employee={log.performed_by_employee.full_name if log.performed_by_employee else '(không có)'} "
                        f"role={log.performed_by_role or '(không rõ)'}"
                    )
            else:
                self.stdout.write("  (Không có audit log riêng cho event này)")
            self.stdout.write("")

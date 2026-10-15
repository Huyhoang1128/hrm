import traceback

from django.core.management.base import BaseCommand
from django.db import transaction

from employee.models import Employee
from hrm.registration_serializers import RegistrationRequestCreateSerializer


class Command(BaseCommand):
    """
    Debug lỗi tạo đơn "Nghỉ không phép" nhiều ngày (UNAUTHORIZED_ABSENCE,
    end_date != attendance_date): mô phỏng LẠI đúng request bị lỗi bằng cách
    chạy qua RegistrationRequestCreateSerializer y hệt luồng thật, nhưng bọc
    trong transaction.atomic() rồi CHỦ ĐỘNG rollback ở cuối — không tạo/lưu
    bất kỳ dữ liệu thật nào dù có tạo event thành công trong lúc chạy.

    In ra: lỗi validate() (nếu có, y hệt lỗi 400 thật) hoặc traceback đầy đủ
    nếu có exception thật (lỗi 500) trong lúc save().

    Usage: python manage.py diagnose_unauthorized_absence_multiday <employee_id> <start_date YYYY-MM-DD> <end_date YYYY-MM-DD> [reason]
    """
    help = "Debug lỗi tạo đơn Nghỉ không phép nhiều ngày (dry-run, tự rollback, không lưu gì thật)"

    def add_arguments(self, parser):
        parser.add_argument('employee_id', type=str)
        parser.add_argument('start_date', type=str)
        parser.add_argument('end_date', type=str)
        parser.add_argument('reason', type=str, nargs='?', default='Nghỉ ốm (chẩn đoán)')

    def handle(self, *args, **options):
        employee_code = options['employee_id']
        start_date = options['start_date']
        end_date = options['end_date']
        reason = options['reason']

        try:
            employee = Employee.objects.get(employee_id=employee_code)
        except Employee.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Không tìm thấy nhân viên {employee_code}"))
            return

        self.stdout.write(
            f"=== Mô phỏng tạo đơn Nghỉ không phép nhiều ngày cho {employee_code} "
            f"({employee.full_name}), {start_date} -> {end_date} ==="
        )

        payload = {
            'employee_id': employee.id,
            'attendance_date': start_date,
            'end_date': end_date,
            'registration_type': 'UNAUTHORIZED_ABSENCE',
            'reason': reason,
            'status': 'PENDING',
        }
        self.stdout.write(f"Payload: {payload}")

        serializer = RegistrationRequestCreateSerializer(data=payload)
        if not serializer.is_valid():
            self.stdout.write(self.style.ERROR(
                f"\n>>> serializer.is_valid() = False (đây chính là lỗi 400 người dùng sẽ thấy)\n"
                f"errors = {serializer.errors}"
            ))
            return

        self.stdout.write(self.style.SUCCESS("\n>>> serializer.is_valid() = True — thử save() (sẽ tự rollback)..."))

        try:
            with transaction.atomic():
                result = serializer.save(created_by=None)
                if isinstance(result, dict) and 'created' in result:
                    self.stdout.write(self.style.SUCCESS(
                        f">>> save() THÀNH CÔNG — sẽ tạo {len(result['created'])} event, "
                        f"skip {len(result.get('skipped_dates', []))} ngày đã có sẵn: "
                        f"{result.get('skipped_dates')}"
                    ))
                else:
                    self.stdout.write(self.style.SUCCESS(f">>> save() THÀNH CÔNG — event id={result.id}"))
                # Chủ động rollback — không lưu gì thật dù save() thành công ở trên.
                raise _RollbackSentinel()
        except _RollbackSentinel:
            self.stdout.write(self.style.WARNING(
                ">>> Đã rollback (dry-run) — KHÔNG có dữ liệu thật nào được lưu vào DB."
            ))
        except Exception as exc:  # noqa: BLE001 — cố tình bắt tất cả để in traceback debug
            self.stdout.write(self.style.ERROR(
                f"\n>>> EXCEPTION THẬT trong save() (đây chính là lỗi 500 người dùng sẽ thấy): "
                f"{type(exc).__name__}: {exc}\n"
            ))
            self.stdout.write(traceback.format_exc())


class _RollbackSentinel(Exception):
    """Exception nội bộ chỉ để buộc transaction.atomic() rollback — không phải lỗi thật."""
    pass

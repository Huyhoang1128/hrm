"""
Backfill Employee.vneid_screenshot từ OnboardingProcess.extra_info.

Bug đã có: khi NV upload VNEID lúc onboarding mà chưa link Employee
(employee=None), file chỉ được lưu vào OnboardingProcess.extra_info[
'vneid_screenshot'] và KHÔNG đẩy sang Employee.vneid_screenshot. Sau khi
Employee được tạo / link, field này vẫn rỗng → UI "Quản lý nhân viên"
không thấy ảnh.

Command này quét mọi Employee có vneid_screenshot rỗng, kiểm tra
onboarding_process.extra_info, copy lại S3 key.

Usage:
    python manage.py backfill_vneid_screenshot --dry-run    # đếm + preview
    python manage.py backfill_vneid_screenshot              # apply
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from employee.models import Employee


class Command(BaseCommand):
    help = "Copy vneid_screenshot từ OnboardingProcess.extra_info → Employee.vneid_screenshot"

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Chỉ đếm + preview, không thay đổi DB",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Giới hạn số lượng update (debug)",
        )

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        limit = opts["limit"]

        # Employee có vneid_screenshot rỗng
        qs = Employee.objects.filter(
            Q(vneid_screenshot__isnull=True) | Q(vneid_screenshot="")
        ).select_related("onboarding_process")

        candidates = []
        scanned = 0
        for emp in qs.iterator():
            scanned += 1
            op = getattr(emp, "onboarding_process", None)
            if op is None or not op.extra_info:
                continue
            key = op.extra_info.get("vneid_screenshot")
            if not key:
                continue
            candidates.append((emp, str(key)))
            if limit and len(candidates) >= limit:
                break

        self.stdout.write(
            f"Scan {scanned} employees thiếu vneid_screenshot → "
            f"{len(candidates)} có data trong onboarding_process.extra_info"
        )

        if dry:
            self.stdout.write("--- DRY RUN preview (top 10) ---")
            for emp, key in candidates[:10]:
                self.stdout.write(
                    f"  emp_id={emp.employee_id} name={emp.full_name!r} → key={key}"
                )
            self.stdout.write(self.style.WARNING("Không update DB (--dry-run)"))
            return

        # Apply
        updated = 0
        with transaction.atomic():
            for emp, key in candidates:
                emp.vneid_screenshot = key
                emp.save(update_fields=["vneid_screenshot"])
                updated += 1

        self.stdout.write(self.style.SUCCESS(f"✓ Đã backfill {updated} employees"))

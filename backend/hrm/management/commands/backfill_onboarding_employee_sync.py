"""
Backfill Employee cho các OnboardingProcess mà dữ liệu chỉ được sửa qua nút
"Chỉnh sửa" trên trang chi tiết onboarding (OnboardingProcessUpdateSerializer)
— trước đây serializer đó KHÔNG có logic đồng bộ sang Employee (chỉ form tự
điền của ứng viên qua link token mới có), nên OnboardingProcess hiển thị đầy
đủ nhưng Employee tương ứng bị trống. Xem fix tại
_sync_employee_from_onboarding() trong hrm/serializers.py.

Khác với backfill_unsynced_onboarding_employees.py (chỉ nhắm case sync bị
crash giữa chừng lúc submit form, filter employee_info_completed=True), script
này quét TẤT CẢ OnboardingProcess đã có Employee link (không cần
employee_info_completed=True, vì HR có thể đã "Chỉnh sửa" trực tiếp mà nhân
viên chưa từng dùng form tự điền) và chạy lại đúng hàm đồng bộ dùng chung hiện
tại — nên phục hồi được ĐẦY ĐỦ field (kể cả liên hệ khẩn cấp, lương/phụ cấp
thử việc... mà script cũ không phục hồi được), miễn là dữ liệu đó vẫn còn nằm
trên OnboardingProcess.

An toàn / idempotent: dùng lại _sync_employee_from_onboarding(), chỉ ghi đè
field Employee khi OnboardingProcess có giá trị (không xoá dữ liệu Employee
bằng giá trị rỗng) — chạy lại nhiều lần trên cùng 1 bản ghi không gây hại.

Usage:
    python manage.py backfill_onboarding_employee_sync --dry-run
    python manage.py backfill_onboarding_employee_sync
    python manage.py backfill_onboarding_employee_sync --employee-id NV80003
    python manage.py backfill_onboarding_employee_sync --onboarding-id 54
"""

import logging

from django.core.management.base import BaseCommand

from hrm.models import OnboardingProcess
from hrm.serializers import _sync_employee_from_onboarding

logger = logging.getLogger(__name__)

# Các field Employee dùng để so sánh trước/sau — chỉ để báo cáo cho HR biết
# case nào thực sự có thay đổi, không ảnh hưởng logic đồng bộ.
DIFF_FIELDS = [
    'full_name', 'phone_number', 'position_id', 'department_id', 'company_unit_id',
    'date_of_birth', 'gender', 'ethnicity', 'nationality', 'birth_place',
    'region', 'block', 'section', 'rank', 'work_form', 'work_location', 'doctor_team',
    'education_level', 'facebook_link',
    'permanent_residence', 'current_address', 'start_date',
    'social_insurance_number', 'tax_code', 'marital_status',
    'emergency_contact_name', 'emergency_contact_relationship', 'emergency_contact_phone',
    'emergency_contact_dob', 'emergency_contact_occupation', 'emergency_contact_address',
    'cccd_number', 'old_id_number', 'cccd_issue_date', 'cccd_issue_place',
    'bank_name', 'bank_account', 'bank_account_holder', 'bank_branch',
    'basic_salary', 'allowance', 'probation_months', 'probation_end_date', 'probation_rate',
]


def _snapshot(employee):
    return {f: getattr(employee, f, None) for f in DIFF_FIELDS}


class Command(BaseCommand):
    help = (
        "Chạy lại _sync_employee_from_onboarding() cho mọi OnboardingProcess đã có "
        "Employee link, để backfill các bản ghi bị lệch do trước đây nút 'Chỉnh sửa' "
        "onboarding không đồng bộ sang Employee."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Chỉ đếm + preview field sẽ thay đổi, không ghi DB")
        parser.add_argument("--employee-id", type=str, default=None, help="Chỉ xử lý 1 employee_id cụ thể (debug)")
        parser.add_argument("--onboarding-id", type=int, default=None, help="Chỉ xử lý 1 OnboardingProcess.id cụ thể (debug)")

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        only_employee_id = opts["employee_id"]
        only_onboarding_id = opts["onboarding_id"]

        qs = OnboardingProcess.objects.filter(employee__isnull=False).select_related('employee')
        if only_employee_id:
            qs = qs.filter(employee__employee_id=only_employee_id)
        if only_onboarding_id:
            qs = qs.filter(id=only_onboarding_id)

        total = qs.count()
        self.stdout.write(f"Quét {total} onboarding đã có Employee link...")

        changed = 0
        unchanged = 0
        failed = []

        for ob in qs.iterator():
            employee = ob.employee
            before = _snapshot(employee)

            if dry:
                # Preview: gọi trực tiếp trên instance trong bộ nhớ, KHÔNG lưu DB.
                # Tận dụng lại đúng logic đồng bộ nhưng chặn save() bằng cách chạy
                # trong transaction rollback để không ảnh hưởng dữ liệu thật.
                from django.db import transaction
                try:
                    with transaction.atomic():
                        _sync_employee_from_onboarding(ob)
                        after = _snapshot(employee)
                        diff = {f: (before[f], after[f]) for f in DIFF_FIELDS if before[f] != after[f]}
                        if diff:
                            self.stdout.write(f"  [SẼ SỬA] {employee.employee_id} | {employee.full_name!r} (onboarding={ob.onboarding_code}):")
                            for f, (b, a) in diff.items():
                                self.stdout.write(f"      {f}: {b!r} -> {a!r}")
                            changed += 1
                        else:
                            unchanged += 1
                        raise _RollbackDryRun()
                except _RollbackDryRun:
                    pass
                except Exception as e:
                    logger.error(f"Preview thất bại cho {ob.onboarding_code}: {str(e)}", exc_info=True)
                    failed.append((ob, str(e)))
                continue

            try:
                _sync_employee_from_onboarding(ob)
                employee.refresh_from_db()
                after = _snapshot(employee)
                diff = {f: (before[f], after[f]) for f in DIFF_FIELDS if before[f] != after[f]}
                if diff:
                    changed += 1
                    self.stdout.write(f"✓ Đã backfill {employee.employee_id} ({len(diff)} field) từ {ob.onboarding_code}")
                else:
                    unchanged += 1
            except Exception as e:
                logger.error(f"Backfill thất bại cho {ob.onboarding_code}: {str(e)}", exc_info=True)
                failed.append((ob, str(e)))

        if dry:
            self.stdout.write(self.style.WARNING(
                f"--- DRY RUN: {changed} Employee sẽ được cập nhật, {unchanged} đã khớp sẵn, "
                f"{len(failed)} lỗi. Không có gì được ghi vào DB. ---"
            ))
        else:
            self.stdout.write(self.style.SUCCESS(f"✓ Đã backfill {changed} Employee ({unchanged} đã khớp sẵn, không đổi gì)."))

        if failed:
            self.stdout.write(self.style.WARNING(f"⚠ {len(failed)} case lỗi:"))
            for ob, reason in failed:
                self.stdout.write(f"  {ob.onboarding_code}: {reason}")


class _RollbackDryRun(Exception):
    """Exception nội bộ dùng để rollback transaction.atomic() trong chế độ --dry-run,
    đảm bảo preview không ghi bất kỳ thay đổi nào xuống DB."""
    pass

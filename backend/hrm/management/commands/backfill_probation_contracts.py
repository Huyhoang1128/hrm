"""
Backfill EmployeeContract cho các onboarding cũ đã hoàn thành task "Ký hợp đồng
thử việc" (SIGN_CONTRACT) TRƯỚC KHI có logic tự động tạo EmployeeContract khi
hoàn thành task này. Các hồ sơ này không có hợp đồng nào → không hiện trong
trang "Hợp đồng hàng loạt".

Đây là backfill cho việc đã xảy ra trong thực tế (task SIGN_CONTRACT đã
COMPLETED nghĩa là nhân viên đã ký hợp đồng thử việc thật ngoài đời từ trước),
nên tạo thẳng bản ghi ở trạng thái đã ký — KHÔNG tạo bản Nháp bắt HR phải
chọn template/tạo PDF/ký lại qua "Hợp đồng hàng loạt" cho việc đã xong rồi.

Xử lý 3 nhóm:
1. Nhân viên còn trong giai đoạn thử việc (chưa có official_start_date):
   tạo 1 EmployeeContract, status=SIGNED thẳng, contract_type LẤY THEO
   onboarding.contract_type (hoặc employee.contract_type, fallback
   'PROBATION') — GIỐNG HỆT cách OnboardingTask.complete_task() (hrm/models.py)
   resolve loại hợp đồng khi task SIGN_CONTRACT hoàn thành lần đầu. Không
   hardcode 'PROBATION' vì onboarding có thể thuộc loại khác (VD 'INTERN').
2. Nhân viên đã lên chính thức (có official_start_date) — nghĩa là đã hoàn
   thành thử việc và đang có hợp đồng lao động, nhưng cả 2 hợp đồng đó chưa
   từng được ghi nhận vào EmployeeContract:
   - Tạo 1 EmployeeContract PROBATION, status=EXPIRED (đã qua giai đoạn này).
   - Tạo 1 EmployeeContract loại lao động (map từ Employee.contract_type),
     status=SIGNED, NẾU Employee.contract_type khớp với 1 giá trị hợp lệ
     trong CONTRACT_TYPE. Nếu không khớp (dữ liệu tự do, không đoán được),
     KHÔNG tự tạo — liệt kê vào danh sách "cần xử lý thủ công" để HR tự tạo
     tay qua "Hợp đồng hàng loạt".
3. Dọn dẹp các EmployeeContract('PROBATION', status='DRAFT') dư thừa do 1 bug
   trước đây ở OnboardingTaskViewSet.complete() (hrm/views.py) — bug này từng
   LUÔN tạo thêm 1 bản PROBATION/DRAFT mỗi khi hoàn thành SIGN_CONTRACT, kể cả
   khi onboarding thực chất thuộc loại khác (VD 'INTERN') và đã có 1 bản SIGNED
   đúng loại rồi từ complete_task() → 2 bản trùng cho cùng 1 sự kiện ký hợp
   đồng, 1 bản đúng (SIGNED) + 1 bản rác (DRAFT). Với case này:
   - Nếu contract_type thực tế (bước 1) KHÁC 'PROBATION' và có 1 bản SIGNED/
     PENDING_SIGN đúng loại đó rồi → bản PROBATION/DRAFT dư thừa (chưa từng
     generate PDF) bị chuyển sang CANCELLED (không xoá cứng, có thể khôi phục).
   - Nếu contract_type thực tế ĐÚNG LÀ 'PROBATION' → bản DRAFT (chưa generate
     PDF) đó chính là bản ghi hợp lệ → nâng cấp thẳng lên SIGNED (không phải
     rác, xem nhóm 1).

Không tự sinh contract_number (để nguyên, HR gán số hợp đồng thủ công qua UI
nếu cần — tránh làm lệch ContractCounter dùng cho hợp đồng mới).

Usage:
    python manage.py backfill_probation_contracts --dry-run    # đếm + preview
    python manage.py backfill_probation_contracts              # apply
    python manage.py backfill_probation_contracts --limit 50 --dry-run
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from hrm.models import CONTRACT_TYPE, ContractTemplate, EmployeeContract, OnboardingTask

LABOR_TYPES = {'ONE_YEAR', 'TWO_YEAR', 'THREE_YEAR', 'INDEFINITE'}
VALID_CONTRACT_TYPES = {c[0] for c in CONTRACT_TYPE}


def _default_template(contract_type, company_unit):
    tpl = ContractTemplate.objects.filter(
        contract_type=contract_type, status='ACTIVE', is_default=True,
        company_unit=company_unit,
    ).first()
    if not tpl:
        tpl = ContractTemplate.objects.filter(
            contract_type=contract_type, status='ACTIVE', is_default=True,
            company_unit__isnull=True,
        ).first()
    return tpl


class Command(BaseCommand):
    help = (
        "Tạo EmployeeContract cho các onboarding cũ đã hoàn thành task "
        "SIGN_CONTRACT nhưng chưa có hợp đồng nào trong hệ thống."
    )

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
            help="Giới hạn số lượng onboarding xử lý (debug)",
        )

    def handle(self, *args, **opts):
        dry = opts["dry_run"]
        limit = opts["limit"]

        tasks = OnboardingTask.objects.filter(
            task_code='SIGN_CONTRACT', status='COMPLETED',
        ).select_related('onboarding_process', 'onboarding_process__employee')

        to_create_probation = []   # (employee, onboarding, contract_type, status)
        to_create_labor = []       # (employee, onboarding, contract_type)
        to_upgrade_draft = []      # EmployeeContract (status=DRAFT, đúng loại, chưa qua PDF) → SIGNED
        to_cancel_dup_draft = []   # EmployeeContract PROBATION/DRAFT dư thừa (sai loại) → CANCELLED
        needs_manual = []          # (employee, reason)
        skipped_has_contract = 0
        skipped_no_employee = 0
        scanned = 0

        for task in tasks.iterator():
            if limit and scanned >= limit:
                break
            scanned += 1

            onboarding = task.onboarding_process
            employee = onboarding.employee if onboarding else None
            if not employee:
                skipped_no_employee += 1
                continue

            existing_contracts = list(
                EmployeeContract.objects.filter(employee=employee)
                .exclude(status__in=['CANCELLED', 'EXPIRED'])
            )
            existing_types = [c.contract_type for c in existing_contracts]
            has_active_probation = 'PROBATION' in existing_types
            has_active_labor = any(t in LABOR_TYPES for t in existing_types)

            is_official = bool(employee.official_start_date)

            if not is_official:
                # Còn trong giai đoạn thử việc — task SIGN_CONTRACT đã COMPLETED
                # nghĩa là đã ký thật ngoài đời rồi → ghi nhận thẳng SIGNED, đúng
                # loại hợp đồng thực tế (giống complete_task() ở models.py).
                contract_type = onboarding.contract_type or employee.contract_type or 'PROBATION'

                active_same_type = next(
                    (c for c in existing_contracts if c.contract_type == contract_type), None,
                )
                draft_probation = next(
                    (c for c in existing_contracts
                     if c.contract_type == 'PROBATION' and c.status == 'DRAFT'
                     and not c.generated_file),
                    None,
                )

                if active_same_type:
                    # Đã có bản đúng loại (thường do complete_task() tạo SIGNED sẵn).
                    if active_same_type.status == 'DRAFT' and not active_same_type.generated_file:
                        to_upgrade_draft.append(active_same_type)
                    # Nếu loại thực tế không phải PROBATION mà vẫn tồn tại 1 bản
                    # PROBATION/DRAFT khác (dư do bug cũ) → dọn luôn.
                    if contract_type != 'PROBATION' and draft_probation:
                        to_cancel_dup_draft.append(draft_probation)
                    if active_same_type.status != 'DRAFT' or active_same_type.generated_file:
                        skipped_has_contract += 1
                elif contract_type != 'PROBATION' and draft_probation:
                    # Không có bản đúng loại, nhưng có 1 bản PROBATION/DRAFT dư
                    # (do bug cũ tạo nhầm) → dọn bản rác + tạo bản đúng loại.
                    to_cancel_dup_draft.append(draft_probation)
                    to_create_probation.append((employee, onboarding, contract_type, 'SIGNED'))
                else:
                    to_create_probation.append((employee, onboarding, contract_type, 'SIGNED'))
                continue

            # Đã lên chính thức: cần cả 2 — PROBATION (đã hết hạn) + hợp đồng lao động
            need_something = False
            if not has_active_probation and not EmployeeContract.objects.filter(
                employee=employee, contract_type='PROBATION',
            ).exists():
                to_create_probation.append((employee, onboarding, 'PROBATION', 'EXPIRED'))
                need_something = True

            if not has_active_labor:
                mapped_type = employee.contract_type if employee.contract_type in VALID_CONTRACT_TYPES else None
                if mapped_type and mapped_type in LABOR_TYPES:
                    to_create_labor.append((employee, onboarding, mapped_type))
                    need_something = True
                else:
                    needs_manual.append((
                        employee,
                        f"official_start_date đã có nhưng Employee.contract_type="
                        f"{employee.contract_type!r} không khớp loại hợp đồng lao động hợp lệ "
                        f"({sorted(LABOR_TYPES)}) — cần HR tự tạo hợp đồng qua Hợp đồng hàng loạt.",
                    ))
                    need_something = True

            if not need_something:
                skipped_has_contract += 1

        self.stdout.write(
            f"Scan {scanned} task SIGN_CONTRACT đã COMPLETED → "
            f"{len(to_create_probation)} cần tạo HĐ thử việc, "
            f"{len(to_create_labor)} cần tạo HĐ lao động, "
            f"{len(to_upgrade_draft)} bản Nháp cần nâng cấp thành Đã ký, "
            f"{len(to_cancel_dup_draft)} bản Nháp dư thừa (sai loại) cần huỷ, "
            f"{len(needs_manual)} cần xử lý thủ công, "
            f"{skipped_has_contract} đã đủ hợp đồng, "
            f"{skipped_no_employee} onboarding không có employee liên kết."
        )

        if needs_manual:
            self.stdout.write(self.style.WARNING("--- Cần xử lý thủ công (top 20) ---"))
            for emp, reason in needs_manual[:20]:
                self.stdout.write(f"  emp_id={emp.employee_id} name={emp.full_name!r} → {reason}")

        if dry:
            self.stdout.write("--- DRY RUN preview (top 10 mỗi loại) ---")
            for emp, ob, ct, st in to_create_probation[:10]:
                self.stdout.write(
                    f"  [{ct}/{st}] emp_id={emp.employee_id} name={emp.full_name!r} "
                    f"onboarding={ob.onboarding_code}"
                )
            for emp, ob, ct in to_create_labor[:10]:
                self.stdout.write(
                    f"  [{ct}/SIGNED] emp_id={emp.employee_id} name={emp.full_name!r} "
                    f"onboarding={ob.onboarding_code}"
                )
            for c in to_upgrade_draft[:10]:
                self.stdout.write(
                    f"  [{c.contract_type}/DRAFT→SIGNED] emp_id={c.employee.employee_id} "
                    f"name={c.employee.full_name!r} contract_id={c.id}"
                )
            for c in to_cancel_dup_draft[:10]:
                self.stdout.write(
                    f"  [PROBATION/DRAFT→CANCELLED (dư thừa)] emp_id={c.employee.employee_id} "
                    f"name={c.employee.full_name!r} contract_id={c.id}"
                )
            self.stdout.write(self.style.WARNING("Không tạo hợp đồng nào (--dry-run)"))
            return

        created_probation = 0
        created_labor = 0
        upgraded_draft = 0
        cancelled_dup = 0
        with transaction.atomic():
            for contract in to_upgrade_draft:
                contract.status = 'SIGNED'
                contract.save(update_fields=['status', 'updated_at'])
                upgraded_draft += 1

            for contract in to_cancel_dup_draft:
                contract.status = 'CANCELLED'
                contract.notes = (
                    (contract.notes + '\n' if contract.notes else '')
                    + 'Tự động huỷ bởi backfill_probation_contracts: bản dư thừa do bug '
                      'tạo trùng ở OnboardingTaskViewSet.complete() (đã có bản đúng loại '
                      'hợp đồng ở trạng thái Đã ký).'
                )
                contract.save(update_fields=['status', 'notes', 'updated_at'])
                cancelled_dup += 1

            for employee, onboarding, contract_type, st in to_create_probation:
                EmployeeContract.objects.create(
                    employee=employee,
                    onboarding_process=onboarding,
                    company_unit=employee.company_unit,
                    template=_default_template(contract_type, employee.company_unit),
                    contract_type=contract_type,
                    status=st,
                    start_date=employee.start_date,
                    end_date=employee.probation_end_date,
                )
                created_probation += 1

            for employee, onboarding, contract_type in to_create_labor:
                EmployeeContract.objects.create(
                    employee=employee,
                    onboarding_process=onboarding,
                    company_unit=employee.company_unit,
                    template=_default_template(contract_type, employee.company_unit),
                    contract_type=contract_type,
                    status='SIGNED',
                    start_date=employee.contract_start_date or employee.official_start_date,
                    end_date=employee.contract_end_date,
                )
                created_labor += 1

        self.stdout.write(self.style.SUCCESS(
            f"✓ Đã tạo {created_probation} hợp đồng thử việc + {created_labor} hợp đồng lao động"
            + (f" + nâng cấp {upgraded_draft} bản Nháp cũ thành Đã ký" if upgraded_draft else "")
            + (f" + huỷ {cancelled_dup} bản Nháp dư thừa (sai loại, do bug cũ)" if cancelled_dup else "")
        ))
        if needs_manual:
            self.stdout.write(self.style.WARNING(
                f"⚠ Còn {len(needs_manual)} nhân viên cần HR tự tạo hợp đồng thủ công (xem log ở trên)."
            ))

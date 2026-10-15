"""
hrm/management/commands/seed_leave_policy.py
════════════════════════════════════════════
Management command để khởi tạo dữ liệu cấu hình chính sách nghỉ phép (LeavePolicyConfig) vào DB.

Bao gồm 7 chính sách:
  1. Nghỉ phép năm    (ANNUAL)    – 12 ngày/năm, báo trước theo thang
  2. Nghỉ ốm          (SICK)      – 5 ngày/năm, có thể ≤ 2 ngày ko cần giấy
  3. Nghỉ thai sản    (MATERNITY) – 180 ngày, cần giấy xác nhận thai sản
  4. Nghỉ thai sản cha(PATERNITY) – 5 ngày
  5. Nghỉ cưới        (MARRIAGE)  – 3 ngày
  6. Nghỉ tang lễ     (FUNERAL)   – 3 ngày (thân nhân ruột)
  7. Nghỉ không lương (UNPAID)    – không giới hạn, cần duyệt Giám đốc

Cách dùng:
  python manage.py seed_leave_policy
  python manage.py seed_leave_policy --force               # ghi đè nếu đã tồn tại
  python manage.py seed_leave_policy --dry-run             # chỉ in ra, không lưu
  python manage.py seed_leave_policy --code LEAVE-ANNUAL   # chỉ seed 1 chính sách
"""

import datetime
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone


# ─────────────────────────────────────────────────────────────────────────────
# DATA SEED
# ─────────────────────────────────────────────────────────────────────────────

LEAVE_POLICY_DATA = [
    # ── 1. Nghỉ phép năm ─────────────────────────────────────────────────────
    {
        "code":        "LEAVE-ANNUAL",
        "name":        "Chính sách nghỉ phép năm",
        "description": (
            "Nghỉ phép hưởng lương theo luật lao động. "
            "Nhân viên có thể nghỉ tối đa 12 ngày/năm (đủ 12 tháng làm việc). "
            "Chưa đủ 12 tháng: cộng dồn 1 ngày/tháng."
        ),
        "leave_type":  "ANNUAL",
        "max_days_per_year":    12,
        "max_consecutive_days": 10,
        "requires_approval":    True,
        "requires_medical_certificate": False,
        "emergency_notice_hours": 4,
        "is_active":  True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
        # Quy định báo trước:
        # - Nghỉ ≤ 1 ngày: báo trước 4 giờ làm việc
        # - Nghỉ 2–3 ngày: báo trước 1 ngày làm việc
        # - Nghỉ 4–7 ngày: báo trước 5 ngày làm việc
        # - Nghỉ ≥ 8 ngày: báo trước 10 ngày làm việc
        "advance_notice_rules": [
            {
                "max_days": 1,
                "advance_hours": 4,
                "advance_days": None,
                "description": "Nghỉ ≤ 1 ngày: báo trước 4 giờ làm việc",
            },
            {
                "max_days": 3,
                "advance_hours": None,
                "advance_days": 1,
                "description": "Nghỉ 2–3 ngày: báo trước 1 ngày làm việc",
            },
            {
                "max_days": 7,
                "advance_hours": None,
                "advance_days": 5,
                "description": "Nghỉ 4–7 ngày: báo trước 5 ngày làm việc",
            },
            {
                "max_days": None,
                "advance_hours": None,
                "advance_days": 10,
                "description": "Nghỉ ≥ 8 ngày: báo trước 10 ngày làm việc",
            },
        ],
    },
    # ── 2. Nghỉ ốm ───────────────────────────────────────────────────────────
    {
        "code":        "LEAVE-SICK",
        "name":        "Chính sách nghỉ ốm",
        "description": (
            "Nghỉ ốm có lương tối đa 5 ngày/năm. "
            "Nghỉ ≤ 2 ngày không cần giấy khám bệnh. "
            "Nghỉ > 2 ngày cần có giấy chứng nhận của cơ sở y tế. "
            "Trường hợp khẩn cấp (ốm đột xuất): báo trước trong 2 giờ đầu ca làm."
        ),
        "leave_type":  "SICK",
        "max_days_per_year":    5,
        "max_consecutive_days": 5,
        "requires_approval":    True,
        "requires_medical_certificate": True,
        # Cần giấy KS từ ngày thứ 3 trở đi → encode trong advance_notice_rules
        "emergency_notice_hours": 2,
        "is_active":  True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
        "advance_notice_rules": [
            {
                "max_days": 2,
                "advance_hours": 2,
                "advance_days": None,
                "description": (
                    "Nghỉ ốm ≤ 2 ngày: báo quản lý trong vòng 2 giờ đầu ca. "
                    "Không cần giấy khám bệnh."
                ),
                "requires_medical_certificate": False,
            },
            {
                "max_days": None,
                "advance_hours": None,
                "advance_days": 0,
                "description": (
                    "Nghỉ ốm > 2 ngày liên tiếp: báo ngay khi biết, "
                    "xuất trình giấy khám bệnh/nhập viện sau khi đi làm lại."
                ),
                "requires_medical_certificate": True,
            },
        ],
    },
    # ── 3. Nghỉ thai sản ─────────────────────────────────────────────────────
    {
        "code":        "LEAVE-MATERNITY",
        "name":        "Chính sách nghỉ thai sản (nữ)",
        "description": (
            "Nghỉ thai sản 6 tháng (180 ngày) theo quy định Luật BHXH. "
            "Trong thời gian nghỉ thai sản, nhân viên nữ được hưởng chế độ thai sản từ BHXH. "
            "Cần thông báo dự kiến ngày nghỉ trước ít nhất 30 ngày."
        ),
        "leave_type":  "MATERNITY",
        "max_days_per_year":    180,
        "max_consecutive_days": 180,
        "requires_approval":    True,
        "requires_medical_certificate": True,
        "emergency_notice_hours": 0,
        "is_active":  True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
        "advance_notice_rules": [
            {
                "max_days": None,
                "advance_hours": None,
                "advance_days": 30,
                "description": (
                    "Thông báo ngày nghỉ dự kiến trước ít nhất 30 ngày. "
                    "Kèm theo giấy xác nhận thai sản của bác sĩ."
                ),
                "requires_medical_certificate": True,
            },
        ],
    },
    # ── 4. Nghỉ thai sản (cha) ───────────────────────────────────────────────
    {
        "code":        "LEAVE-PATERNITY",
        "name":        "Chính sách nghỉ thai sản (nam / cha)",
        "description": (
            "Nhân viên nam có vợ sinh con được nghỉ 5 ngày làm việc (sinh thường) "
            "hoặc 7 ngày (sinh mổ / sinh đôi trở lên). "
            "Phải nghỉ trong vòng 30 ngày kể từ ngày vợ sinh."
        ),
        "leave_type":  "PATERNITY",
        "max_days_per_year":    7,    # tối đa 7 ngày (sinh mổ / sinh đôi)
        "max_consecutive_days": 7,
        "requires_approval":    True,
        "requires_medical_certificate": True,
        "emergency_notice_hours": 2,
        "is_active":  True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
        "advance_notice_rules": [
            {
                "max_days": None,
                "advance_hours": None,
                "advance_days": 0,
                "description": (
                    "Báo quản lý và HR ngay khi vợ sinh. "
                    "Kèm giấy khai sinh / giấy chứng sinh của bệnh viện."
                ),
                "requires_medical_certificate": True,
            },
        ],
    },
    # ── 5. Nghỉ cưới ────────────────────────────────────────────────────────
    {
        "code":        "LEAVE-MARRIAGE",
        "name":        "Chính sách nghỉ cưới",
        "description": (
            "Nhân viên kết hôn được nghỉ 3 ngày làm việc có lương. "
            "Thông báo và nộp đơn trước ít nhất 7 ngày. "
            "Kèm theo giấy đăng ký kết hôn (nộp trong vòng 30 ngày sau khi đi làm lại)."
        ),
        "leave_type":  "MARRIAGE",
        "max_days_per_year":    3,
        "max_consecutive_days": 3,
        "requires_approval":    True,
        "requires_medical_certificate": False,
        "emergency_notice_hours": 24,
        "is_active":  True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
        "advance_notice_rules": [
            {
                "max_days": None,
                "advance_hours": None,
                "advance_days": 7,
                "description": (
                    "Báo trước ít nhất 7 ngày làm việc. "
                    "Nộp giấy đăng ký kết hôn trong vòng 30 ngày sau khi đi làm lại."
                ),
                "requires_medical_certificate": False,
            },
        ],
    },
    # ── 6. Nghỉ tang lễ ──────────────────────────────────────────────────────
    {
        "code":        "LEAVE-FUNERAL",
        "name":        "Chính sách nghỉ tang lễ",
        "description": (
            "Nhân viên có thân nhân ruột (bố, mẹ, vợ/chồng, con, anh/chị/em ruột) "
            "qua đời được nghỉ 3 ngày có lương. "
            "Trường hợp ông/bà nội ngoại: 1 ngày có lương. "
            "Báo quản lý ngay khi sự việc xảy ra."
        ),
        "leave_type":  "FUNERAL",
        "max_days_per_year":    3,
        "max_consecutive_days": 3,
        "requires_approval":    True,
        "requires_medical_certificate": False,
        "emergency_notice_hours": 2,
        "is_active":  True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
        "advance_notice_rules": [
            {
                "max_days": None,
                "advance_hours": None,
                "advance_days": 0,
                "description": (
                    "Báo quản lý ngay khi sự việc xảy ra. "
                    "Nộp giấy tờ chứng minh quan hệ thân nhân sau khi đi làm lại."
                ),
                "requires_medical_certificate": False,
            },
        ],
    },
    # ── 7. Nghỉ không lương ──────────────────────────────────────────────────
    {
        "code":        "LEAVE-UNPAID",
        "name":        "Chính sách nghỉ không lương",
        "description": (
            "Nghỉ phép không hưởng lương theo thỏa thuận với công ty. "
            "Cần được Giám đốc phê duyệt. "
            "Thông báo trước ít nhất 10 ngày làm việc. "
            "Tối đa 30 ngày liên tiếp trong một lần, tổng cộng không quá 60 ngày/năm."
        ),
        "leave_type":  "UNPAID",
        "max_days_per_year":    60,
        "max_consecutive_days": 30,
        "requires_approval":    True,
        "requires_medical_certificate": False,
        "emergency_notice_hours": 48,
        "is_active":  True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
        "advance_notice_rules": [
            {
                "max_days": 5,
                "advance_hours": None,
                "advance_days": 5,
                "description": "Nghỉ không lương ≤ 5 ngày: báo trước 5 ngày làm việc.",
                "requires_medical_certificate": False,
            },
            {
                "max_days": 15,
                "advance_hours": None,
                "advance_days": 10,
                "description": "Nghỉ không lương 6–15 ngày: báo trước 10 ngày làm việc.",
                "requires_medical_certificate": False,
            },
            {
                "max_days": None,
                "advance_hours": None,
                "advance_days": 15,
                "description": (
                    "Nghỉ không lương > 15 ngày: báo trước 15 ngày làm việc, "
                    "cần được Giám đốc ký duyệt."
                ),
                "requires_medical_certificate": False,
            },
        ],
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

_LEAVE_TYPE_LABELS = {
    "ANNUAL":    "Nghỉ phép năm",
    "SICK":      "Nghỉ ốm",
    "MATERNITY": "Nghỉ thai sản",
    "PATERNITY": "Nghỉ thai sản cho cha",
    "MARRIAGE":  "Nghỉ cưới",
    "FUNERAL":   "Nghỉ tang lễ",
    "UNPAID":    "Nghỉ không lương",
    "OTHER":     "Khác",
}


class Command(BaseCommand):
    help = (
        "Khởi tạo dữ liệu cấu hình chính sách nghỉ phép (LeavePolicyConfig) vào DB. "
        "Bao gồm 7 loại: nghỉ năm, ốm, thai sản, thai sản cha, cưới, tang lễ, không lương."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Ghi đè (update) nếu chính sách đã tồn tại trong DB.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Chỉ in ra những gì sẽ được tạo, không lưu vào DB.",
        )
        parser.add_argument(
            "--code",
            type=str,
            default=None,
            help=(
                "Chỉ seed một chính sách cụ thể theo mã "
                "(ví dụ: LEAVE-ANNUAL). Để trống = seed tất cả."
            ),
        )
        parser.add_argument(
            "--deactivate-others",
            action="store_true",
            default=False,
            help="Deactivate tất cả LeavePolicyConfig khác không có trong danh sách seed.",
        )

    # ─────────────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        from hrm.models import LeavePolicyConfig

        force             = options["force"]
        dry_run           = options["dry_run"]
        code_filter       = options["code"]
        deactivate_others = options["deactivate_others"]

        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n════════════════════════════════════════════════════════\n"
            "  HRM – Cấu hình Chính sách Nghỉ phép (LeavePolicyConfig) Seeder\n"
            "════════════════════════════════════════════════════════"
        ))

        if dry_run:
            self.stdout.write(self.style.WARNING("  ⚡ DRY-RUN mode – không lưu vào DB\n"))

        # Filter data
        data_to_seed = LEAVE_POLICY_DATA
        if code_filter:
            data_to_seed = [p for p in LEAVE_POLICY_DATA if p["code"] == code_filter]
            if not data_to_seed:
                valid = [p["code"] for p in LEAVE_POLICY_DATA]
                raise CommandError(
                    f"Không tìm thấy mã chính sách '{code_filter}'. Hợp lệ: {valid}"
                )

        if not dry_run and deactivate_others:
            seed_codes = [p["code"] for p in data_to_seed]
            deactivated = LeavePolicyConfig.objects.exclude(code__in=seed_codes).update(is_active=False)
            if deactivated:
                self.stdout.write(
                    self.style.WARNING(f"  ⚠  Đã deactivate {deactivated} chính sách ngoài danh sách.")
                )

        total_created = 0
        total_updated = 0
        total_skipped = 0

        for pdata in data_to_seed:
            code = pdata["code"]
            lt   = pdata["leave_type"]
            self.stdout.write(
                f"\n  📋 Chính sách: {self.style.SUCCESS(code)} – {pdata['name']}"
            )
            self.stdout.write(
                f"     Loại: {lt} ({_LEAVE_TYPE_LABELS.get(lt, lt)})"
            )
            self.stdout.write(
                f"     Ngày tối đa/năm: {pdata['max_days_per_year'] or '—'}  |  "
                f"Liên tiếp tối đa: {pdata['max_consecutive_days'] or '—'} ngày"
            )
            self.stdout.write(
                f"     Yêu cầu giấy KS: {pdata['requires_medical_certificate']}  |  "
                f"Yêu cầu duyệt: {pdata['requires_approval']}"
            )
            self.stdout.write(
                f"     Khẩn cấp báo trước: {pdata['emergency_notice_hours']} giờ"
            )
            self.stdout.write(
                f"     Hiệu lực từ: {pdata['effective_from']}  |  Active: {pdata['is_active']}"
            )
            self.stdout.write(f"     Mô tả: {pdata['description'][:90]}…" if len(pdata['description']) > 90 else f"     Mô tả: {pdata['description']}")
            self.stdout.write(f"     Quy định báo trước ({len(pdata['advance_notice_rules'])} mức):")
            for rule in pdata["advance_notice_rules"]:
                self.stdout.write(f"       • {rule['description']}")

            if dry_run:
                self.stdout.write("     → [DRY-RUN] Bỏ qua, không lưu.")
                continue

            with transaction.atomic():
                existing = LeavePolicyConfig.objects.filter(code=code).first()

                if existing and not force:
                    self.stdout.write(
                        self.style.WARNING(
                            f"     ⚠  code='{code}' đã tồn tại. Dùng --force để ghi đè."
                        )
                    )
                    total_skipped += 1
                    continue

                fields = {
                    "name":                         pdata["name"],
                    "description":                  pdata["description"],
                    "leave_type":                   pdata["leave_type"],
                    "advance_notice_rules":         pdata["advance_notice_rules"],
                    "emergency_notice_hours":       pdata["emergency_notice_hours"],
                    "requires_medical_certificate": pdata["requires_medical_certificate"],
                    "requires_approval":            pdata["requires_approval"],
                    "max_days_per_year":            pdata["max_days_per_year"],
                    "max_consecutive_days":         pdata["max_consecutive_days"],
                    "apply_to_all":                 pdata["apply_to_all"],
                    "effective_from":               pdata["effective_from"],
                    "effective_to":                 pdata["effective_to"],
                    "is_active":                    pdata["is_active"],
                }

                if existing and force:
                    for attr, val in fields.items():
                        setattr(existing, attr, val)
                    existing.save()
                    policy_obj = existing
                    self.stdout.write(
                        f"     ✏  Đã cập nhật LeavePolicyConfig '{code}' (id={policy_obj.id})."
                    )
                    total_updated += 1
                else:
                    policy_obj = LeavePolicyConfig.objects.create(code=code, **fields)
                    self.stdout.write(
                        f"     {self.style.SUCCESS('✔')}  Đã tạo LeavePolicyConfig '{code}' "
                        f"(id={policy_obj.id})."
                    )
                    total_created += 1

        # ── Summary ──────────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n════════════════════════════════════════════════════════"
        ))
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"  ✔ DRY-RUN hoàn thành – {len(data_to_seed)} chính sách sẽ được xử lý (không lưu)."
                )
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"  ✔ Hoàn thành!  "
                    f"Tạo mới: {total_created}  |  "
                    f"Cập nhật: {total_updated}  |  "
                    f"Bỏ qua: {total_skipped}"
                )
            )
            if total_created or total_updated:
                self.stdout.write(
                    "\n  Kiểm tra kết quả:\n"
                    "    python manage.py shell -c "
                    "\"from hrm.models import LeavePolicyConfig; "
                    "[print(p.code, p.leave_type, p.max_days_per_year) "
                    "for p in LeavePolicyConfig.objects.all()]\"\n"
                )
        self.stdout.write("")

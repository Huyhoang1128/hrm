"""
hrm/management/commands/seed_attendance_policy.py
══════════════════════════════════════════════════
Management command để khởi tạo dữ liệu chính sách chấm công ban đầu vào DB.

Bao gồm:
  - AttendancePolicyVersion  v2024_08  (hiệu lực từ 01/08/2024, đang active)
  - PenaltyTierConfig        5 tiers theo bảng phạt 08/2024
  - AttendancePolicyConfig   tất cả tham số nghiệp vụ

Cách dùng:
  python manage.py seed_attendance_policy
  python manage.py seed_attendance_policy --force        # ghi đè nếu đã tồn tại
  python manage.py seed_attendance_policy --dry-run      # chỉ in ra, không lưu
  python manage.py seed_attendance_policy --deactivate-others  # deactivate các version khác
"""

import datetime
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


# ─────────────────────────────────────────────────────────────────────────────
# DATA SEED
# ─────────────────────────────────────────────────────────────────────────────

POLICY_VERSIONS = [
    {
        "version_code":   "v2024_08",
        "name":           "Chính sách chấm công 08/2024",
        "description": (
            "Bảng phạt cập nhật tháng 08/2024. "
            "Áp dụng cho toàn bộ nhân viên từ 01/08/2024."
        ),
        "effective_from": datetime.date(2024, 8, 1),
        "effective_to":   None,
        "is_active":      True,
        # Penalty tiers cho version này
        "penalty_tiers": [
            # order, max_minutes, fine_regular, fine_manager, work_deduction, description
            (1, 10,   50_000,  50_000, 0.0, "Muộn/sớm ≤ 10 phút: 50.000 VNĐ"),
            (2, 30,  100_000, 100_000, 0.0, "Muộn/sớm 11-30 phút: 100.000 VNĐ"),
            (3, 60,  120_000, 150_000, 0.0, "Muộn/sớm 31-60 phút: 120k/150k (Mgr)"),
            (4, 120, 200_000, 250_000, 0.0, "Muộn/sớm 61-120 phút: 200k/250k (Mgr)"),
            (5, None,      0,       0, 0.5, "Muộn/sớm > 120 phút: trừ 0.5 công (không phạt tiền)"),
        ],
        # Policy config
        "policy_config": {
            "max_explanation_quota":           3,      # 3 lần giải trình/tháng
            "penalty_multiplier_threshold":    7,      # từ lần thứ 7: nhân x2
            "penalty_multiplier_value":        2.0,    # hệ số nhân
            "parking_allowance_per_day":       5_000,  # 5.000 VNĐ/ngày
            "live_prime_time_allowance":       100_000,  # 100.000 VNĐ/phiên 21h-23h
            "live_prime_start_hour":           21,
            "live_prime_end_hour":             23,
            "max_live_prime_time_pct":         0.2000, # 20% tổng phiên live team/tháng
            "max_ot_live_pct":                 0.2000, # 20% tổng OT cá nhân/tháng
            "incomplete_no_expl_deduction":    1.0,    # quên chấm công không giải trình: -1 công
            "incomplete_approved_deduction":   0.5,    # quên chấm công – giải trình duyệt: -0.5 công
        },
    },
]


class Command(BaseCommand):
    help = (
        "Khởi tạo dữ liệu chính sách chấm công (AttendancePolicyVersion, "
        "PenaltyTierConfig, AttendancePolicyConfig) vào DB."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Ghi đè (update) nếu version đã tồn tại trong DB.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Chỉ in ra những gì sẽ được tạo, không lưu vào DB.",
        )
        parser.add_argument(
            "--deactivate-others",
            action="store_true",
            default=False,
            help="Deactivate tất cả các version khác trước khi seed.",
        )
        parser.add_argument(
            "--version-code",
            type=str,
            default=None,
            help="Chỉ seed một version cụ thể (để trống = seed tất cả).",
        )

    # ─────────────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        from hrm.attendance_models import (
            AttendancePolicyVersion,
            PenaltyTierConfig,
            AttendancePolicyConfig,
        )

        force            = options["force"]
        dry_run          = options["dry_run"]
        deactivate_others = options["deactivate_others"]
        version_filter   = options["version_code"]

        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════\n"
            "  HRM Attendance Policy Seeder\n"
            "══════════════════════════════════════════════"
        ))

        if dry_run:
            self.stdout.write(self.style.WARNING("  ⚡ DRY-RUN mode – không lưu vào DB\n"))

        versions_to_seed = POLICY_VERSIONS
        if version_filter:
            versions_to_seed = [v for v in POLICY_VERSIONS if v["version_code"] == version_filter]
            if not versions_to_seed:
                raise CommandError(
                    f"Không tìm thấy version_code='{version_filter}' trong danh sách seed."
                )

        if not dry_run and deactivate_others:
            deactivated = AttendancePolicyVersion.objects.filter(is_active=True).exclude(
                version_code__in=[v["version_code"] for v in versions_to_seed if v.get("is_active")]
            ).update(is_active=False)
            if deactivated:
                self.stdout.write(
                    self.style.WARNING(f"  ⚠  Đã deactivate {deactivated} version cũ.")
                )

        total_created = 0
        total_updated = 0

        for vdata in versions_to_seed:
            vc = vdata["version_code"]
            self.stdout.write(f"\n  📋 Version: {self.style.SUCCESS(vc)}")
            self.stdout.write(f"     Tên: {vdata['name']}")
            self.stdout.write(f"     Hiệu lực từ: {vdata['effective_from']}")
            self.stdout.write(f"     Active: {vdata['is_active']}")

            if dry_run:
                self.stdout.write(f"     Tiers: {len(vdata['penalty_tiers'])} mức phạt")
                for t in vdata["penalty_tiers"]:
                    order, max_min, fine_r, fine_m, work_d, desc = t
                    self.stdout.write(f"       [{order}] {desc}")
                self.stdout.write(f"     Policy config: {vdata['policy_config']}")
                self.stdout.write(f"     → [DRY-RUN] Bỏ qua, không lưu.")
                continue

            with transaction.atomic():
                # ── AttendancePolicyVersion ──────────────────────────────────
                existing = AttendancePolicyVersion.objects.filter(version_code=vc).first()

                if existing and not force:
                    self.stdout.write(
                        self.style.WARNING(
                            f"     ⚠  version_code='{vc}' đã tồn tại. "
                            f"Dùng --force để ghi đè."
                        )
                    )
                    continue

                if existing and force:
                    existing.name           = vdata["name"]
                    existing.description    = vdata["description"]
                    existing.effective_from = vdata["effective_from"]
                    existing.effective_to   = vdata["effective_to"]
                    existing.is_active      = vdata["is_active"]
                    existing.save()
                    version_obj = existing
                    self.stdout.write(f"     ✏  Đã cập nhật AttendancePolicyVersion '{vc}'.")
                    total_updated += 1
                else:
                    version_obj = AttendancePolicyVersion.objects.create(
                        version_code   = vc,
                        name           = vdata["name"],
                        description    = vdata["description"],
                        effective_from = vdata["effective_from"],
                        effective_to   = vdata["effective_to"],
                        is_active      = vdata["is_active"],
                    )
                    self.stdout.write(
                        f"     {self.style.SUCCESS('✔')}  Đã tạo AttendancePolicyVersion '{vc}' (id={version_obj.id})."
                    )
                    total_created += 1

                # ── PenaltyTierConfig ────────────────────────────────────────
                if force:
                    deleted_count, _ = PenaltyTierConfig.objects.filter(version=version_obj).delete()
                    if deleted_count:
                        self.stdout.write(
                            f"     🗑  Đã xóa {deleted_count} tier cũ."
                        )

                self.stdout.write("     📊 Tạo PenaltyTierConfig:")
                for t in vdata["penalty_tiers"]:
                    order, max_min, fine_r, fine_m, work_d, desc = t
                    tier = PenaltyTierConfig.objects.create(
                        version             = version_obj,
                        order               = order,
                        max_minutes         = max_min,
                        fine_amount_regular = fine_r,
                        fine_amount_manager = fine_m,
                        deduct_work_credit  = work_d,
                        description         = desc,
                    )
                    label = f"≤{max_min}p" if max_min else ">prev"
                    self.stdout.write(
                        f"        [{order}] {label:8s} "
                        f"Thường: {fine_r:>10,}đ  "
                        f"Mgr: {fine_m:>10,}đ  "
                        f"Trừ công: {work_d}  "
                        f"→ id={tier.id}"
                    )

                # ── AttendancePolicyConfig ───────────────────────────────────
                cfg, cfg_created = AttendancePolicyConfig.objects.get_or_create(
                    version=version_obj
                )
                pc = vdata["policy_config"]
                cfg.max_explanation_quota          = pc["max_explanation_quota"]
                cfg.penalty_multiplier_threshold   = pc["penalty_multiplier_threshold"]
                cfg.penalty_multiplier_value       = pc["penalty_multiplier_value"]
                cfg.parking_allowance_per_day      = pc["parking_allowance_per_day"]
                cfg.live_prime_time_allowance      = pc["live_prime_time_allowance"]
                cfg.live_prime_start_hour          = pc["live_prime_start_hour"]
                cfg.live_prime_end_hour            = pc["live_prime_end_hour"]
                cfg.max_live_prime_time_pct        = pc["max_live_prime_time_pct"]
                cfg.max_ot_live_pct                = pc["max_ot_live_pct"]
                cfg.incomplete_no_expl_deduction   = pc["incomplete_no_expl_deduction"]
                cfg.incomplete_approved_deduction  = pc["incomplete_approved_deduction"]
                cfg.save()

                action_label = "Đã tạo" if cfg_created else "Đã cập nhật"
                self.stdout.write(
                    f"     {self.style.SUCCESS('✔')}  {action_label} AttendancePolicyConfig (id={cfg.id})."
                )
                self.stdout.write(
                    f"        Quota giải trình: {cfg.max_explanation_quota} lần/tháng"
                )
                self.stdout.write(
                    f"        Nhân x{cfg.penalty_multiplier_value} từ lần vi phạm thứ {cfg.penalty_multiplier_threshold}"
                )
                self.stdout.write(
                    f"        Gửi xe: {cfg.parking_allowance_per_day:,} VNĐ/ngày"
                )
                self.stdout.write(
                    f"        Live prime-time: {cfg.live_prime_time_allowance:,} VNĐ/phiên "
                    f"({cfg.live_prime_start_hour}h-{cfg.live_prime_end_hour}h, "
                    f"max {float(cfg.max_live_prime_time_pct)*100:.0f}%)"
                )
                self.stdout.write(
                    f"        OT live tối đa: {float(cfg.max_ot_live_pct)*100:.0f}% tổng OT"
                )
                self.stdout.write(
                    f"        Quên chấm công – không giải trình: trừ {cfg.incomplete_no_expl_deduction} công"
                )
                self.stdout.write(
                    f"        Quên chấm công – giải trình duyệt: trừ {cfg.incomplete_approved_deduction} công"
                )

        # ── Clear PolicyLoader cache ─────────────────────────────────────────
        if not dry_run:
            try:
                from hrm.attendance_engine import PolicyLoader
                PolicyLoader.clear_cache()
                self.stdout.write(
                    f"\n  {self.style.SUCCESS('✔')}  PolicyLoader cache đã được clear."
                )
            except Exception as exc:
                self.stdout.write(
                    self.style.WARNING(f"\n  ⚠  Không thể clear PolicyLoader cache: {exc}")
                )

        # ── Summary ──────────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════"
        ))
        if dry_run:
            self.stdout.write(
                self.style.WARNING("  ✔ DRY-RUN hoàn thành – không có gì được lưu vào DB.")
            )
        else:
            self.stdout.write(
                self.style.SUCCESS(
                    f"  ✔ Hoàn thành! "
                    f"Tạo mới: {total_created} version  |  "
                    f"Cập nhật: {total_updated} version"
                )
            )
            self.stdout.write(
                "\n  Bước tiếp theo:\n"
                "    python manage.py makemigrations hrm\n"
                "    python manage.py migrate\n"
            )
        self.stdout.write("")

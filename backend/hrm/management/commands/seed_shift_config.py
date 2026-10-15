"""
hrm/management/commands/seed_shift_config.py
════════════════════════════════════════════
Management command để khởi tạo dữ liệu cấu hình ca làm việc vào DB.

Bao gồm 12 ca làm việc mặc định:
  - HC-FULL        Ca hành chính        (08:30 – 17:30, 1.0 công)
  - HC-MORNING     Ca sáng hành chính   (08:30 – 12:00, 0.5 công)  ← is_default
  - HC-AFTERNOON   Ca chiều hành chính  (13:00 – 17:30, 0.5 công)  ← is_default
  - ADS-FULL       Ca ADS               (09:00 – 17:30, 1.0 công)
  - ADS-MORNING    Ca sáng ADS          (09:00 – 12:00, 0.5 công)
  - ADS-AFTERNOON  Ca chiều ADS         (13:00 – 17:30, 0.5 công)
  - CSKH-FULL      Ca CSKH MB           (08:00 – 17:00, 1.0 công)
  - CSKH-MORNING   Ca sáng CSKH MB      (08:00 – 12:00, 0.5 công)
  - CSKH-AFTERNOON Ca chiều CSKH MB     (13:00 – 17:00, 0.5 công)
  - KD-FULL        Ca kinh doanh        (13:00 – 21:00, 1.0 công)
  - KD-SPLIT       Ca gãy kinh doanh    (08:30 – 12:00 + trực tối, 1.0 công)
  - EVENING        Ca tối               (17:30 – 21:00, 0.5 công)

Mặc định công ty (is_default=True): HC-MORNING + HC-AFTERNOON.
Engine replay tải cả hai và tổng hợp 0.5 + 0.5 = 1.0 công cho ngày đủ công.

Cách dùng:
  python manage.py seed_shift_config
  python manage.py seed_shift_config --clear           # xóa tất cả ShiftConfig cũ trước khi seed
  python manage.py seed_shift_config --force           # ghi đè nếu đã tồn tại
  python manage.py seed_shift_config --dry-run         # chỉ in ra, không lưu
  python manage.py seed_shift_config --code HC-FULL    # chỉ seed 1 ca cụ thể
"""

import datetime
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone


# ─────────────────────────────────────────────────────────────────────────────
# DATA SEED
# ─────────────────────────────────────────────────────────────────────────────

SHIFT_DATA = [
    # ──────────────────────────────────────────────────────────────────
    # Nhóm hành chính (HC)
    # ──────────────────────────────────────────────────────────────────
    {
        "code":        "HC-FULL",
        "name":        "Ca hành chính",
        "description": "Ca hành chính toàn ngày (8h30-17h30). Áp dụng cho toàn bộ văn phòng.",
        "shift_type":  "MORNING",
        "start_time":  datetime.time(8, 30),
        "end_time":    datetime.time(17, 30),
        "break_start_time":       datetime.time(12, 0),
        "break_end_time":         datetime.time(13, 0),
        "break_duration_minutes": 60,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    {
        "code":        "HC-MORNING",
        "name":        "Ca sáng hành chính",
        "description": "Ca sáng hành chính (8h30-12h00). Áp dụng khi làm nửa buổi sáng.",
        "shift_type":  "MORNING",
        "start_time":  datetime.time(8, 30),
        "end_time":    datetime.time(12, 0),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  True,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    {
        "code":        "HC-AFTERNOON",
        "name":        "Ca chiều hành chính",
        "description": "Ca chiều hành chính (13h00-17h30). Áp dụng khi làm nửa buổi chiều.",
        "shift_type":  "AFTERNOON",
        "start_time":  datetime.time(13, 0),
        "end_time":    datetime.time(17, 30),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  True,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    # ──────────────────────────────────────────────────────────────────
    # Nhóm ADS
    # ──────────────────────────────────────────────────────────────────
    {
        "code":        "ADS-FULL",
        "name":        "Ca ADS",
        "description": "Ca ADS toàn ngày (9h00-17h30). Áp dụng cho bộ phận ADS.",
        "shift_type":  "MORNING",
        "start_time":  datetime.time(9, 0),
        "end_time":    datetime.time(17, 30),
        "break_start_time":       datetime.time(12, 0),
        "break_end_time":         datetime.time(13, 0),
        "break_duration_minutes": 60,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    {
        "code":        "ADS-MORNING",
        "name":        "Ca sáng ADS",
        "description": "Ca sáng ADS (9h00-12h00). Áp dụng khi làm nửa buổi sáng bộ phận ADS.",
        "shift_type":  "MORNING",
        "start_time":  datetime.time(9, 0),
        "end_time":    datetime.time(12, 0),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    {
        "code":        "ADS-AFTERNOON",
        "name":        "Ca chiều ADS",
        "description": "Ca chiều ADS (13h00-17h30). Áp dụng khi làm nửa buổi chiều bộ phận ADS.",
        "shift_type":  "AFTERNOON",
        "start_time":  datetime.time(13, 0),
        "end_time":    datetime.time(17, 30),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    # ──────────────────────────────────────────────────────────────────
    # Nhóm CSKH MB
    # ──────────────────────────────────────────────────────────────────
    {
        "code":        "CSKH-FULL",
        "name":        "Ca CSKH MB",
        "description": "Ca CSKH MB toàn ngày (8h00-17h00). Áp dụng cho bộ phận CSKH miền Bắc.",
        "shift_type":  "MORNING",
        "start_time":  datetime.time(8, 0),
        "end_time":    datetime.time(17, 0),
        "break_start_time":       datetime.time(12, 0),
        "break_end_time":         datetime.time(13, 0),
        "break_duration_minutes": 60,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    {
        "code":        "CSKH-MORNING",
        "name":        "Ca sáng CSKH MB",
        "description": "Ca sáng CSKH MB (8h00-12h00). Áp dụng khi làm nửa buổi sáng bộ phận CSKH.",
        "shift_type":  "MORNING",
        "start_time":  datetime.time(8, 0),
        "end_time":    datetime.time(12, 0),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    {
        "code":        "CSKH-AFTERNOON",
        "name":        "Ca chiều CSKH MB",
        "description": "Ca chiều CSKH MB (13h00-17h00). Áp dụng khi làm nửa buổi chiều bộ phận CSKH.",
        "shift_type":  "AFTERNOON",
        "start_time":  datetime.time(13, 0),
        "end_time":    datetime.time(17, 0),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    # ──────────────────────────────────────────────────────────────────
    # Nhóm kinh doanh (KD)
    # ──────────────────────────────────────────────────────────────────
    {
        "code":        "KD-FULL",
        "name":        "Ca kinh doanh",
        "description": "Ca kinh doanh toàn ngày (13h00-21h00). Áp dụng cho bộ phận kinh doanh.",
        "shift_type":  "AFTERNOON",
        "start_time":  datetime.time(13, 0),
        "end_time":    datetime.time(21, 0),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    {
        "code":        "KD-SPLIT",
        "name":        "Ca gãy kinh doanh",
        "description": (
            "Ca gãy kinh doanh (8h30-12h00 + trực tối). "
            "Ca chia đôi: sáng từ 8h30-12h00, tối từ 17h30-21h00. Tính 1.0 công."
        ),
        "shift_type":  "OTHER",
        "start_time":  datetime.time(8, 30),
        "end_time":    datetime.time(21, 0),
        "break_start_time":       datetime.time(12, 0),
        "break_end_time":         datetime.time(17, 30),
        "break_duration_minutes": 330,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
    # ──────────────────────────────────────────────────────────────────
    # Ca tối
    # ──────────────────────────────────────────────────────────────────
    {
        "code":        "EVENING",
        "name":        "Ca tối",
        "description": "Ca tối (17h30-21h00). Áp dụng cho nhân viên làm ca tối / trực tối.",
        "shift_type":  "EVENING",
        "start_time":  datetime.time(17, 30),
        "end_time":    datetime.time(21, 0),
        "break_start_time":       None,
        "break_end_time":         None,
        "break_duration_minutes": 0,
        "is_default":  False,
        "is_active":   True,
        "effective_from": datetime.date(2024, 1, 1),
        "effective_to":   None,
        "apply_to_all": True,
    },
]


def _fmt_time(t):
    return t.strftime("%H:%M") if t else "—"


class Command(BaseCommand):
    help = (
        "Khởi tạo dữ liệu cấu hình ca làm việc (ShiftConfig) vào DB. "
        "Bao gồm 12 ca: HC-FULL, HC-MORNING, HC-AFTERNOON, ADS-FULL, ADS-MORNING, "
        "ADS-AFTERNOON, CSKH-FULL, CSKH-MORNING, CSKH-AFTERNOON, KD-FULL, KD-SPLIT, EVENING."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            default=False,
            help="Xóa tất cả ShiftConfig hiện có trước khi seed lại từ đầu.",
        )
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Ghi đè (update) nếu ca đã tồn tại trong DB.",
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
            help="Chỉ seed một ca cụ thể theo mã (ví dụ: SHIFT-HC). Để trống = seed tất cả.",
        )
        parser.add_argument(
            "--deactivate-others",
            action="store_true",
            default=False,
            help="Deactivate tất cả ShiftConfig khác không có trong danh sách seed.",
        )

    # ─────────────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        from hrm.models import ShiftConfig

        clear             = options["clear"]
        force             = options["force"]
        dry_run           = options["dry_run"]
        code_filter       = options["code"]
        deactivate_others = options["deactivate_others"]

        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════════\n"
            "  HRM – Cấu hình Ca làm việc (ShiftConfig) Seeder\n"
            "══════════════════════════════════════════════════"
        ))

        if dry_run:
            self.stdout.write(self.style.WARNING("  ⚡ DRY-RUN mode – không lưu vào DB\n"))

        # ── Xóa tất cả ShiftConfig cũ trước khi seed ──────────────────────
        if clear and not dry_run:
            deleted_count, _ = ShiftConfig.objects.all().delete()
            self.stdout.write(
                self.style.WARNING(
                    f"  🗑  Đã xóa {deleted_count} ShiftConfig cũ trước khi seed lại."
                )
            )
        elif clear and dry_run:
            count = ShiftConfig.objects.count()
            self.stdout.write(
                self.style.WARNING(
                    f"  🗑  [DRY-RUN] Sẽ xóa {count} ShiftConfig cũ trước khi seed."
                )
            )

        # Filter data
        data_to_seed = SHIFT_DATA
        if code_filter:
            data_to_seed = [s for s in SHIFT_DATA if s["code"] == code_filter]
            if not data_to_seed:
                raise CommandError(
                    f"Không tìm thấy mã ca '{code_filter}'. "
                    f"Các mã hợp lệ: {[s['code'] for s in SHIFT_DATA]}"
                )

        if not dry_run and deactivate_others:
            seed_codes = [s["code"] for s in data_to_seed]
            deactivated = ShiftConfig.objects.exclude(code__in=seed_codes).update(is_active=False)
            if deactivated:
                self.stdout.write(
                    self.style.WARNING(f"  ⚠  Đã deactivate {deactivated} ca ngoài danh sách seed.")
                )

        total_created = 0
        total_updated = 0
        total_skipped = 0

        for sdata in data_to_seed:
            code = sdata["code"]
            self.stdout.write(f"\n  🕐 Ca: {self.style.SUCCESS(code)} – {sdata['name']}")
            self.stdout.write(f"     Loại: {sdata['shift_type']}")
            self.stdout.write(
                f"     Thời gian: {_fmt_time(sdata['start_time'])} → {_fmt_time(sdata['end_time'])}"
            )
            self.stdout.write(
                f"     Nghỉ giữa ca: {_fmt_time(sdata['break_start_time'])} – "
                f"{_fmt_time(sdata['break_end_time'])} "
                f"({sdata['break_duration_minutes']} phút)"
            )
            self.stdout.write(f"     Mặc định: {sdata['is_default']}  |  Active: {sdata['is_active']}")
            self.stdout.write(f"     Hiệu lực từ: {sdata['effective_from']}")
            self.stdout.write(f"     Mô tả: {sdata['description'][:80]}…" if len(sdata['description']) > 80 else f"     Mô tả: {sdata['description']}")

            if dry_run:
                self.stdout.write(f"     → [DRY-RUN] Bỏ qua, không lưu.")
                continue

            with transaction.atomic():
                existing = ShiftConfig.objects.filter(code=code).first()

                if existing and not force:
                    self.stdout.write(
                        self.style.WARNING(
                            f"     ⚠  code='{code}' đã tồn tại. Dùng --force để ghi đè."
                        )
                    )
                    total_skipped += 1
                    continue

                # Chuẩn bị fields
                fields = {
                    "name":                   sdata["name"],
                    "description":            sdata["description"],
                    "shift_type":             sdata["shift_type"],
                    "start_time":             sdata["start_time"],
                    "end_time":               sdata["end_time"],
                    "break_start_time":       sdata["break_start_time"],
                    "break_end_time":         sdata["break_end_time"],
                    "break_duration_minutes": sdata["break_duration_minutes"],
                    "is_default":             sdata["is_default"],
                    "is_active":              sdata["is_active"],
                    "effective_from":         sdata["effective_from"],
                    "effective_to":           sdata["effective_to"],
                }

                if existing and force:
                    for attr, val in fields.items():
                        setattr(existing, attr, val)
                    # Dùng update() để bypass auto-recalc save nếu cần
                    existing.save()
                    shift_obj = existing
                    self.stdout.write(
                        f"     ✏  Đã cập nhật ShiftConfig '{code}' (id={shift_obj.id})."
                    )
                    total_updated += 1
                else:
                    shift_obj = ShiftConfig.objects.create(code=code, **fields)
                    self.stdout.write(
                        f"     {self.style.SUCCESS('✔')}  Đã tạo ShiftConfig '{code}' (id={shift_obj.id})."
                    )
                    total_created += 1

                # In tóm tắt giờ làm sau khi model.save() tự tính
                shift_obj.refresh_from_db()
                self.stdout.write(
                    f"     📊 Tổng giờ ca: {shift_obj.total_hours}h  |  "
                    f"Giờ làm thực tế: {shift_obj.working_hours}h"
                )

        # ── Summary ──────────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════════"
        ))
        if dry_run:
            self.stdout.write(
                self.style.WARNING(
                    f"  ✔ DRY-RUN hoàn thành – {len(data_to_seed)} ca sẽ được xử lý (không lưu)."
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
                    "\"from hrm.models import ShiftConfig; "
                    "[print(s) for s in ShiftConfig.objects.all()]\"\n"
                )
        self.stdout.write("")

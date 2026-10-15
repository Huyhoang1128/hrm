"""
hrm/management/commands/seed_livestream_config.py
══════════════════════════════════════════════════
Management command để khởi tạo dữ liệu cấu hình phiên livestream
(LivestreamSessionConfig) vào DB.

LivestreamSessionConfig gắn với từng phòng ban (Department) × tháng/năm.
Seeder này:
  1. Lấy danh sách tất cả phòng ban đang hoạt động từ DB.
  2. Tạo LivestreamSessionConfig cho tháng hiện tại (và tháng tiếp theo).
  3. Tham chiếu AttendancePolicyVersion đang active để link policy_version.

Nếu muốn seed với tổng phiên live tùy chỉnh theo từng phòng ban,
chỉnh bảng DEPARTMENT_SESSION_PLAN bên dưới (tên phòng ban → số phiên/tháng).
Phòng ban nào không có trong bảng → dùng DEFAULT_TOTAL_SESSIONS.

Cách dùng:
  python manage.py seed_livestream_config
  python manage.py seed_livestream_config --force
  python manage.py seed_livestream_config --dry-run
  python manage.py seed_livestream_config --year 2024 --month 8
  python manage.py seed_livestream_config --year 2024 --month 8 --next-month
  python manage.py seed_livestream_config --department "Phòng Marketing"
"""

import datetime
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone


# ─────────────────────────────────────────────────────────────────────────────
# THAM SỐ MẶC ĐỊNH
# ─────────────────────────────────────────────────────────────────────────────

# Số phiên live dự kiến mặc định nếu phòng ban không có trong bảng bên dưới
DEFAULT_TOTAL_SESSIONS = 20

# Kế hoạch phiên live theo tên phòng ban (tên khớp một phần, không phân biệt HOA/thường)
# Cấu trúc: { "keyword_trong_tên_phòng_ban": total_planned_sessions }
DEPARTMENT_SESSION_PLAN = {
    # ── Team Live / Livestream ─────────────────────────────────────────────
    "live":          60,   # Phòng/Team chuyên live: 60 phiên/tháng
    "tiktok":        50,   # Team TikTok Shop Live
    "stream":        50,   # Bất kỳ team nào có "stream"

    # ── Marketing / Content ────────────────────────────────────────────────
    "marketing":     30,   # Phòng Marketing: 30 phiên
    "content":       25,   # Phòng Content
    "social":        25,   # Phòng Social Media

    # ── Sales / Kinh doanh ────────────────────────────────────────────────
    "sales":         15,
    "kinh doanh":    15,
    "bán hàng":      20,

    # ── Phòng khác ────────────────────────────────────────────────────────
    "kỹ thuật":       5,
    "it":             5,
    "hr":             3,
    "nhân sự":        3,
    "hành chính":     3,
    "kế toán":        2,
    "finance":        2,
}

# Số phiên prime-time (21h-23h) tối đa override theo phòng ban
# None = áp dụng quy tắc 20% tự động theo policy
DEPARTMENT_PRIME_TIME_OVERRIDE = {
    "live":    None,     # Giữ quy tắc 20% tự động
    "tiktok":  None,
    "stream":  None,
}


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _get_planned_sessions(dept_name: str) -> int:
    """Tra bảng kế hoạch phiên theo tên phòng ban (khớp keyword)."""
    name_lower = dept_name.lower()
    for keyword, sessions in DEPARTMENT_SESSION_PLAN.items():
        if keyword in name_lower:
            return sessions
    return DEFAULT_TOTAL_SESSIONS


def _get_prime_time_override(dept_name: str):
    """Tra bảng prime-time override. Trả None = dùng quy tắc 20%."""
    name_lower = dept_name.lower()
    for keyword, override in DEPARTMENT_PRIME_TIME_OVERRIDE.items():
        if keyword in name_lower:
            return override
    return None


def _month_label(year: int, month: int) -> str:
    return f"{month:02d}/{year}"


# ─────────────────────────────────────────────────────────────────────────────
# COMMAND
# ─────────────────────────────────────────────────────────────────────────────

class Command(BaseCommand):
    help = (
        "Khởi tạo cấu hình phiên livestream (LivestreamSessionConfig) cho tất cả "
        "phòng ban × tháng được chỉ định. Mặc định: tháng hiện tại + tháng tiếp theo."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            default=False,
            help="Ghi đè (update) nếu cấu hình đã tồn tại.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            default=False,
            help="Chỉ in ra những gì sẽ được tạo, không lưu vào DB.",
        )
        parser.add_argument(
            "--year",
            type=int,
            default=None,
            help="Năm cần seed (mặc định: năm hiện tại).",
        )
        parser.add_argument(
            "--month",
            type=int,
            default=None,
            help="Tháng cần seed (1-12, mặc định: tháng hiện tại).",
        )
        parser.add_argument(
            "--next-month",
            action="store_true",
            default=True,
            help="Seed thêm tháng tiếp theo (mặc định: True).",
        )
        parser.add_argument(
            "--no-next-month",
            dest="next_month",
            action="store_false",
            help="Không seed tháng tiếp theo.",
        )
        parser.add_argument(
            "--department",
            type=str,
            default=None,
            help="Chỉ seed cho phòng ban có tên khớp (tìm kiếm một phần). Để trống = tất cả.",
        )
        parser.add_argument(
            "--policy-version",
            type=str,
            default=None,
            help="Mã version chính sách (version_code). Để trống = lấy version đang active.",
        )
        parser.add_argument(
            "--sessions",
            type=int,
            default=None,
            help="Override tổng số phiên live cho TẤT CẢ phòng ban (bỏ qua bảng kế hoạch).",
        )

    # ─────────────────────────────────────────────────────────────────────────

    def _seed_livestream_rule(self, dry_run: bool, force: bool):
        """
        Tạo/cập nhật LIVESTREAM_RULE trong RuleDefinition.

        Rule này:
          • Đếm mỗi buổi live APPROVED là 1 live_session
          • Cộng +100.000 VNĐ phụ cấp nếu phiên live nằm trong khung 21:00-23:00
          • Ghi nhận giới hạn: số phiên prime-time của phòng ≤ 20% tổng phiên của team
            (20% cap được thực thi ở tầng approval workflow, không tính lại tại đây)
        """
        from hrm.event_models import RuleDefinition

        rule_name = "Livestream Rule"
        rule_data = {
            "rule_type": "LIVESTREAM_RULE",
            "conditions": {
                # Đếm session: tất cả buổi live đã duyệt (không yêu cầu thời lượng tối thiểu)
                "min_duration_for_count": 0,
                # Phụ cấp cơ bản (0 = không có phụ cấp cơ bản mỗi phiên)
                "allowance_per_session": 0,
                # Phụ cấp khung giờ vàng 21h-23h
                "prime_time_start_hour": 21,
                "prime_time_end_hour": 23,
                "prime_time_allowance": 100_000,
                # Giới hạn 20% phiên prime-time/team (dùng cho reporting; enforcement ở approval flow)
                "max_prime_time_pct": 0.20,
                # Không giới hạn cứng số buổi/tháng tại đây
                "max_sessions_per_month": 999,
            },
            "scope": "COMPANY",
            "identifier": "ALL",
            "priority": 10,
            "effective_from": datetime.date(2024, 1, 1),
            "effective_to": None,
            "is_active": True,
            "description": (
                "Rule tính live_sessions và phụ cấp livestream: "
                "+100.000 VNĐ cho mỗi phiên live 21h-23h. "
                "Số phiên prime-time của phòng không vượt 20% tổng phiên của team."
            ),
        }

        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n  ── Seed LIVESTREAM_RULE ─────────────────────────────────────────────"
        ))
        self.stdout.write(f"  📋 Rule: {rule_name}")
        self.stdout.write(f"     Loại: {rule_data['rule_type']}")
        self.stdout.write(f"     Phạm vi: {rule_data['scope']} - {rule_data['identifier']}")

        if dry_run:
            self.stdout.write(f"     Điều kiện: {rule_data['conditions']}")
            self.stdout.write("     → [DRY-RUN] Bỏ qua, không lưu.")
            return

        from django.db import transaction as _tx
        with _tx.atomic():
            existing = RuleDefinition.objects.filter(rule_name=rule_name).first()
            if existing and not force:
                self.stdout.write(
                    self.style.WARNING(
                        f"     ⚠  rule_name='{rule_name}' đã tồn tại. Dùng --force để ghi đè."
                    )
                )
                return

            if existing and force:
                for attr, val in rule_data.items():
                    setattr(existing, attr, val)
                existing.save()
                self.stdout.write(f"     ✏  Đã cập nhật RuleDefinition '{rule_name}' (id={existing.id}).")
            else:
                rule_obj = RuleDefinition.objects.create(rule_name=rule_name, **rule_data)
                self.stdout.write(
                    f"     {self.style.SUCCESS('✔')}  Đã tạo RuleDefinition '{rule_name}' (id={rule_obj.id})."
                )

    # ─────────────────────────────────────────────────────────────────────────

    def handle(self, *args, **options):
        from hrm.attendance_models import AttendancePolicyVersion, LivestreamSessionConfig
        from employee.models import Department

        force            = options["force"]
        dry_run          = options["dry_run"]
        dept_filter      = options["department"]
        policy_ver_code  = options["policy_version"]
        sessions_override = options["sessions"]
        include_next     = options["next_month"]

        # ── Xác định tháng/năm ────────────────────────────────────────────
        today = timezone.now().date()
        year  = options["year"]  or today.year
        month = options["month"] or today.month

        try:
            datetime.date(year, month, 1)
        except ValueError:
            raise CommandError(f"Tháng/năm không hợp lệ: {month:02d}/{year}")

        months_to_seed = [(year, month)]
        if include_next:
            if month == 12:
                months_to_seed.append((year + 1, 1))
            else:
                months_to_seed.append((year, month + 1))

        # ── Lấy policy version ────────────────────────────────────────────
        if policy_ver_code:
            policy_version = AttendancePolicyVersion.objects.filter(
                version_code=policy_ver_code
            ).first()
            if not policy_version:
                raise CommandError(
                    f"Không tìm thấy AttendancePolicyVersion với version_code='{policy_ver_code}'."
                )
        else:
            policy_version = AttendancePolicyVersion.get_active()
            if not policy_version:
                self.stdout.write(
                    self.style.WARNING(
                        "  ⚠  Không có AttendancePolicyVersion nào đang active. "
                        "policy_version sẽ được để NULL.\n"
                        "     Chạy: python manage.py seed_attendance_policy"
                    )
                )

        # ── Lấy danh sách phòng ban ───────────────────────────────────────
        departments = Department.objects.all().order_by("name")
        if dept_filter:
            departments = departments.filter(name__icontains=dept_filter)
            if not departments.exists():
                raise CommandError(
                    f"Không tìm thấy phòng ban nào khớp với '{dept_filter}'."
                )

        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════════════════\n"
            "  HRM – Cấu hình Phiên Livestream (LivestreamSessionConfig) Seeder\n"
            "══════════════════════════════════════════════════════════"
        ))

        if dry_run:
            self.stdout.write(self.style.WARNING("  ⚡ DRY-RUN mode – không lưu vào DB\n"))

        # ── Tóm tắt tham số ──────────────────────────────────────────────
        months_label = "  &  ".join(_month_label(y, m) for y, m in months_to_seed)
        self.stdout.write(f"  Tháng seed:       {months_label}")
        self.stdout.write(f"  Phòng ban:        {departments.count()} phòng ban")
        pv_label = f"{policy_version.version_code} – {policy_version.name}" if policy_version else "NULL (chưa có)"
        self.stdout.write(f"  Phiên bản CS:     {pv_label}")
        if sessions_override:
            self.stdout.write(
                self.style.WARNING(f"  Override sessions: {sessions_override} phiên (tất cả phòng ban)")
            )
        self.stdout.write("")

        total_created = 0
        total_updated = 0
        total_skipped = 0

        for (yr, mo) in months_to_seed:
            self.stdout.write(self.style.MIGRATE_HEADING(
                f"\n  ── Tháng {_month_label(yr, mo)} ──────────────────────────────────────────"
            ))

            for dept in departments:
                total_sessions = (
                    sessions_override
                    if sessions_override is not None
                    else _get_planned_sessions(dept.name)
                )
                prime_override = _get_prime_time_override(dept.name)

                # Tính số phiên prime-time tối đa theo quy tắc 20%
                auto_prime_max = max(1, int(total_sessions * 0.20))
                prime_label = (
                    f"override={prime_override}"
                    if prime_override is not None
                    else f"auto 20% ≈ {auto_prime_max}"
                )

                self.stdout.write(
                    f"\n  🏢 {dept.name}"
                    f"  |  Phiên dự kiến: {total_sessions}"
                    f"  |  Prime-time: {prime_label}"
                )

                if dry_run:
                    self.stdout.write("     → [DRY-RUN] Bỏ qua, không lưu.")
                    continue

                with transaction.atomic():
                    existing = LivestreamSessionConfig.objects.filter(
                        department=dept, year=yr, month=mo
                    ).first()

                    if existing and not force:
                        self.stdout.write(
                            self.style.WARNING(
                                f"     ⚠  Đã tồn tại ({dept.name} – {_month_label(yr, mo)}). "
                                f"Dùng --force để ghi đè."
                            )
                        )
                        total_skipped += 1
                        continue

                    fields = {
                        "total_planned_sessions": total_sessions,
                        "max_prime_time_override": prime_override,
                        "policy_version":         policy_version,
                        # OT override: mặc định False, trưởng phòng sẽ set sau nếu cần
                        "ot_override_approved":   False,
                        "ot_override_approved_by": None,
                        "ot_override_approved_at": None,
                        "ot_override_note":        "",
                    }

                    if existing and force:
                        for attr, val in fields.items():
                            setattr(existing, attr, val)
                        existing.save()
                        cfg = existing
                        self.stdout.write(
                            f"     ✏  Đã cập nhật (id={cfg.id})  "
                            f"{dept.name} – {_month_label(yr, mo)}  "
                            f"sessions={total_sessions}  prime={prime_label}"
                        )
                        total_updated += 1
                    else:
                        cfg = LivestreamSessionConfig.objects.create(
                            department=dept,
                            year=yr,
                            month=mo,
                            **fields,
                        )
                        self.stdout.write(
                            f"     {self.style.SUCCESS('✔')}  Đã tạo (id={cfg.id})  "
                            f"{dept.name} – {_month_label(yr, mo)}  "
                            f"sessions={total_sessions}  prime={prime_label}"
                        )
                        total_created += 1

        # ── Seed LIVESTREAM_RULE vào RuleDefinition ──────────────────────────
        self._seed_livestream_rule(dry_run, force)

        # ── Summary ──────────────────────────────────────────────────────────
        self.stdout.write(self.style.MIGRATE_HEADING(
            "\n══════════════════════════════════════════════════════════"
        ))
        if dry_run:
            total_rows = departments.count() * len(months_to_seed)
            self.stdout.write(
                self.style.WARNING(
                    f"  ✔ DRY-RUN hoàn thành – {total_rows} bản ghi sẽ được xử lý (không lưu)."
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
                    "\n  Lưu ý:\n"
                    "    • Trưởng phòng cần cập nhật total_planned_sessions trước ngày 02 hàng tháng.\n"
                    "    • Nếu cần OT vượt 20% prime-time, Trưởng phòng set ot_override_approved=True\n"
                    "      qua Admin hoặc API: PATCH /api/v1/hrm/livestream-config/{id}/approve-ot/\n"
                )
            if policy_version is None:
                self.stdout.write(
                    self.style.WARNING(
                        "  ⚠  policy_version là NULL. Chạy seed_attendance_policy để tạo version.\n"
                    )
                )
        self.stdout.write("")

        # ── Hướng dẫn chạy thêm ──────────────────────────────────────────
        if not dry_run and (total_created or total_updated):
            self.stdout.write(
                "  Các lệnh liên quan:\n"
                "    python manage.py seed_attendance_policy\n"
                "    python manage.py seed_shift_config\n"
                "    python manage.py seed_leave_policy\n"
            )
        self.stdout.write("")

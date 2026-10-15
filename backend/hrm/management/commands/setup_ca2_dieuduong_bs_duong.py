"""
hrm/management/commands/setup_ca2_dieuduong_bs_duong.py
═════════════════════════════════════════════════════════
Command 1 lần: thiết lập "Ca 2" mới (9h30-18h30, nghỉ trưa 13h30-14h30) và
sửa nghỉ trưa "Ca 1" (7h30-16h30) thành 11h30-12h30 cho nhóm 8 Điều dưỡng
BS Ma Doãn Dương (ShiftRegistrationScopeConfig id đã có sẵn, phòng "Chăm sóc
khách hàng Miền Bắc" + vị trí "Điều dưỡng" + Team BS "Bác sĩ Ma Doãn Dương").

KHÔNG sửa các ShiftConfig đang dùng chung với config khác (CA_CSKH_CA_SANG_7h30,
CA_CSKH_CA_CHIEU_16h30, CA_CSKH_HC_MORNING, CA_CSKH_HC_AFTERNOON — đang dùng
chung với ShiftRegistrationScopeConfig của Phòng AI/CNTT) — tạo 4 ShiftConfig
MỚI riêng cho nhóm này rồi trỏ config sang bản mới, tránh ảnh hưởng nhầm.

Cách dùng:
  python manage.py setup_ca2_dieuduong_bs_duong --dry-run   # chỉ in ra, không lưu
  python manage.py setup_ca2_dieuduong_bs_duong             # chạy thật
"""
import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from hrm.models import ShiftConfig
from hrm.shift_registration_models import ShiftRegistrationScopeConfig

DEPARTMENT_NAME = "Chăm sóc khách hàng Miền Bắc"
POSITION_TITLE = "Điều dưỡng"
DOCTOR_TEAM = "Bác sĩ Ma Doãn Dương"

NEW_SHIFT_DATA = [
    {
        "code": "CA1_DIEUDUONG_BS_DUONG_SANG",
        "name": "Ca 1 sáng - Điều dưỡng BS Dương",
        "description": "Ca 1 (mặc định) - buổi sáng, 07:30-11:30, cho Điều dưỡng BS Ma Doãn Dương.",
        "shift_type": "MORNING",
        "start_time": datetime.time(7, 30),
        "end_time": datetime.time(11, 30),
    },
    {
        "code": "CA1_DIEUDUONG_BS_DUONG_CHIEU",
        "name": "Ca 1 chiều - Điều dưỡng BS Dương",
        "description": "Ca 1 (mặc định) - buổi chiều, 12:30-16:30, cho Điều dưỡng BS Ma Doãn Dương.",
        "shift_type": "AFTERNOON",
        "start_time": datetime.time(12, 30),
        "end_time": datetime.time(16, 30),
    },
    {
        "code": "CA2_DIEUDUONG_BS_DUONG_SANG",
        "name": "Ca 2 sáng - Điều dưỡng BS Dương",
        "description": "Ca 2 (đăng ký, cần quản lý trực tiếp duyệt trước 0h) - buổi sáng, 09:30-13:30.",
        "shift_type": "MORNING",
        "start_time": datetime.time(9, 30),
        "end_time": datetime.time(13, 30),
    },
    {
        "code": "CA2_DIEUDUONG_BS_DUONG_CHIEU",
        "name": "Ca 2 chiều - Điều dưỡng BS Dương",
        "description": "Ca 2 (đăng ký, cần quản lý trực tiếp duyệt trước 0h) - buổi chiều, 14:30-18:30.",
        "shift_type": "AFTERNOON",
        "start_time": datetime.time(14, 30),
        "end_time": datetime.time(18, 30),
    },
]


class Command(BaseCommand):
    help = "Thiết lập Ca 1 (nghỉ trưa 11h30-12h30) + Ca 2 mới (9h30-18h30) cho Điều dưỡng BS Ma Doãn Dương."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Chỉ in ra, không lưu vào DB")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        try:
            config = ShiftRegistrationScopeConfig.objects.get(
                departments__name=DEPARTMENT_NAME,
                positions__title=POSITION_TITLE,
                doctor_teams__icontains=DOCTOR_TEAM,
            )
        except ShiftRegistrationScopeConfig.DoesNotExist:
            raise CommandError(
                f"Không tìm thấy ShiftRegistrationScopeConfig cho phòng '{DEPARTMENT_NAME}' "
                f"+ vị trí '{POSITION_TITLE}' + team '{DOCTOR_TEAM}'. Kiểm tra lại dữ liệu."
            )
        except ShiftRegistrationScopeConfig.MultipleObjectsReturned:
            raise CommandError("Khớp nhiều hơn 1 ShiftRegistrationScopeConfig — cần xác định lại thủ công.")

        self.stdout.write(f"Config hiện tại: id={config.id}, requires_manager_approval={config.requires_manager_approval}")
        self.stdout.write(f"  Ca 1 hiện tại: {config.shift_1_morning} / {config.shift_1_afternoon}")
        self.stdout.write(f"  Ca 2 hiện tại: {config.shift_2_morning} / {config.shift_2_afternoon}")

        created_shifts = {}
        with transaction.atomic():
            for data in NEW_SHIFT_DATA:
                existing = ShiftConfig.objects.filter(code=data["code"]).first()
                if existing:
                    self.stdout.write(self.style.WARNING(
                        f"  ShiftConfig code={data['code']} đã tồn tại (id={existing.id}) — dùng lại, không tạo mới."
                    ))
                    created_shifts[data["code"]] = existing
                    continue
                if dry_run:
                    self.stdout.write(f"  [DRY-RUN] sẽ tạo ShiftConfig {data['code']}: {data['start_time']}-{data['end_time']}")
                    continue
                sc = ShiftConfig.objects.create(
                    code=data["code"],
                    name=data["name"],
                    description=data["description"],
                    shift_type=data["shift_type"],
                    start_time=data["start_time"],
                    end_time=data["end_time"],
                    apply_scope="CA_NHAN",
                    is_default=False,
                    is_active=True,
                    effective_from=datetime.date.today(),
                    effective_to=None,
                )
                created_shifts[data["code"]] = sc
                self.stdout.write(self.style.SUCCESS(f"  Đã tạo ShiftConfig id={sc.id} code={sc.code}"))

            if dry_run:
                self.stdout.write(self.style.WARNING(
                    "[DRY-RUN] Không sửa ShiftRegistrationScopeConfig — chạy lại không có --dry-run để áp dụng thật."
                ))
                transaction.set_rollback(True)
                return

            config.shift_1_morning = created_shifts["CA1_DIEUDUONG_BS_DUONG_SANG"]
            config.shift_1_afternoon = created_shifts["CA1_DIEUDUONG_BS_DUONG_CHIEU"]
            config.shift_2_morning = created_shifts["CA2_DIEUDUONG_BS_DUONG_SANG"]
            config.shift_2_afternoon = created_shifts["CA2_DIEUDUONG_BS_DUONG_CHIEU"]
            config.requires_manager_approval = True
            config.save()
            self.stdout.write(self.style.SUCCESS(
                f"Đã cập nhật config id={config.id}: Ca 1 = 07:30-11:30/12:30-16:30, "
                f"Ca 2 = 09:30-13:30/14:30-18:30, requires_manager_approval=True."
            ))

import datetime

from django.core.management.base import BaseCommand

from employee.models import Employee
from hrm.event_models import EmployeeEvent
from hrm.main_api import EmployeeState

try:
    from hrm.attendance_engine import PolicyLoader
except Exception:
    PolicyLoader = None


class Command(BaseCommand):
    """
    Debug: vì sao 1 lần đi muộn/về sớm (ít phút) lại bị phạt gấp đôi so với
    lần khác cùng số phút trong CÙNG tháng. Đây là lệnh READ-ONLY: chỉ replay
    lại tháng (giống hệt cách trang lịch/chốt công tính) và in ra, KHÔNG
    tạo/sửa/xoá gì.

    Cơ chế nhân đôi tiền phạt (_calc_penalty ở main_api.py): nếu tổng số lần
    vi phạm TÍCH LŨY trong tháng (di_muon_ve_som + quên_chấm_công, kể cả
    những lần ĐÃ ĐƯỢC DUYỆT GIẢI TRÌNH — trừ loại "Đi công tác" BUSINESS_TRIP
    là loại DUY NHẤT thực sự trừ lại số đếm này khi duyệt) đạt tới ngưỡng
    (mặc định 7) thì TỪ LẦN VI PHẠM ĐÓ TRỞ ĐI, tiền phạt bị nhân đôi — dù số
    phút vi phạm y hệt lần trước đó chỉ bị phạt mức thường.

    Usage: python manage.py diagnose_penalty_multiplier <employee_id> <year> <month>
    """
    help = "Debug: in chi tiết từng lần đi muộn/về sớm trong tháng + số đếm vi phạm tích lũy dùng để tính hệ số nhân phạt (read-only)"

    def add_arguments(self, parser):
        parser.add_argument('employee_id', type=str)
        parser.add_argument('year', type=int)
        parser.add_argument('month', type=int)

    def handle(self, *args, **options):
        employee_code = options['employee_id']
        year = options['year']
        month = options['month']

        try:
            employee = Employee.objects.get(employee_id=employee_code)
        except Employee.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"Không tìm thấy nhân viên {employee_code}"))
            return

        self.stdout.write(f"=== Nhân viên: {employee.employee_id} - {employee.full_name} ===")

        employee_info = {}
        if employee.department_id:
            employee_info["department_id"] = str(employee.department_id)
        if employee.position_id:
            employee_info["position_id"] = str(employee.position_id)

        result = EmployeeState.replay_month(employee_code, year, month, employee_info)
        calendar = result.get("calendar", [])
        final_state = result.get("state", {})

        policy = {}
        tiers = []
        threshold = 7
        multiplier_val = 2.0
        if PolicyLoader is not None:
            try:
                cfg = PolicyLoader.load(datetime.date.today())
                policy = cfg.get("policy", {})
                tiers = cfg.get("penalty_tiers", [])
                threshold = int(policy.get("penalty_multiplier_threshold", 7))
                multiplier_val = float(policy.get("penalty_multiplier_value", 2.0))
            except Exception as exc:
                self.stdout.write(self.style.WARNING(f"Không tải được policy từ DB ({exc}), dùng mặc định 7 / x2"))

        self.stdout.write(
            f"Ngưỡng nhân đôi (penalty_multiplier_threshold): {threshold} lần vi phạm | "
            f"Hệ số nhân (penalty_multiplier_value): x{multiplier_val}"
        )

        # Tra các đơn giải trình LATE/EARLY_LEAVE đã duyệt trong tháng, để biết
        # lần vi phạm nào "trông có vẻ đã xử lý xong" trên UI (nhưng KHÔNG
        # được trừ khỏi số đếm tích lũy, trừ BUSINESS_TRIP).
        explanations = (
            EmployeeEvent.objects
            .filter(
                employee=employee, event_type=EmployeeEvent.EventType.EXPLANATION,
                event_date__year=year, event_date__month=month,
            )
            .order_by('event_date')
        )
        approved_explanations_by_date = {}
        for ev in explanations:
            d = ev.data or {}
            if d.get("status") == "APPROVED":
                approved_explanations_by_date.setdefault(ev.event_date.isoformat(), []).append(
                    d.get("explanation_type", "?")
                )

        self.stdout.write(f"\n=== Chi tiết từng lần đi muộn / về sớm trong tháng {month}/{year} ===")
        self.stdout.write(
            f"{'Ngày':<12}{'Loại':<8}{'Phút':<6}{'Phạt thực tế':<14}{'Phạt gốc (bảng)':<16}"
            f"{'x2?':<6}{'Vi phạm tích lũy TRƯỚC ngày này':<32}{'Đã duyệt giải trình?'}"
        )
        for entry in calendar:
            if entry.get("event_type") != "attendance":
                continue
            effects = entry.get("effects", {})
            date_str = entry.get("date")
            before = entry.get("state_before", {})
            cumulative_before = before.get("di_muon_ve_som", 0) + before.get("quen_cham_cong", 0)

            for label, minutes_key, penalty_key in (
                ("Đi muộn", "late_minutes", "late_penalty"),
                ("Về sớm", "early_leave_minutes", "early_leave_penalty"),
            ):
                minutes = effects.get(minutes_key)
                if not minutes:
                    continue
                actual_penalty = effects.get(penalty_key, 0)
                base_fine = None
                if PolicyLoader is not None and tiers:
                    try:
                        base_fine, _work_ded = PolicyLoader.lookup_penalty(int(minutes), False, tiers)
                    except Exception:
                        base_fine = None
                is_doubled = (
                    base_fine is not None and base_fine > 0
                    and abs(actual_penalty) > base_fine * 1.01
                )
                approved_types = approved_explanations_by_date.get(date_str, [])
                approved_str = ", ".join(approved_types) if approved_types else "-"
                self.stdout.write(
                    f"{date_str:<12}{label:<8}{int(minutes):<6}{actual_penalty:>10,} đ  "
                    f"{(f'{base_fine:,.0f} đ' if base_fine is not None else '?'):<16}"
                    f"{'CÓ' if is_doubled else '-':<6}{cumulative_before:<32}{approved_str}"
                )

        self.stdout.write(f"\n=== Tổng kết tháng ===")
        self.stdout.write(
            f"di_muon_ve_som (cuối tháng) = {final_state.get('di_muon_ve_som')} | "
            f"quen_cham_cong (cuối tháng) = {final_state.get('quen_cham_cong')} | "
            f"tổng 2 loại = {final_state.get('di_muon_ve_som', 0) + final_state.get('quen_cham_cong', 0)} "
            f"(số này dùng để so với ngưỡng {threshold} — CỘNG DỒN, KHÔNG trừ đi các lần đã được duyệt "
            f"giải trình, trừ duy nhất loại 'Đi công tác' BUSINESS_TRIP)"
        )
        self.stdout.write(f"tong_phat (cuối tháng) = {final_state.get('tong_phat'):,} đ")

        if approved_explanations_by_date:
            date_summaries = []
            for d, types in sorted(approved_explanations_by_date.items()):
                types_str = ", ".join(types)
                date_summaries.append(f"{d} ({types_str})")
            self.stdout.write(
                "\nCác ngày có đơn giải trình ĐÃ DUYỆT trong tháng: " + ", ".join(date_summaries)
            )
            non_business_trip_late_dates = [
                d for d, types in approved_explanations_by_date.items()
                if any(t in ("LATE", "EARLY_LEAVE", "FORGOT", "INCOMPLETE_ATTENDANCE") for t in types)
            ]
            if non_business_trip_late_dates:
                self.stdout.write(self.style.WARNING(
                    "-> Các ngày trên đã được duyệt giải trình (miễn TIỀN PHẠT của chính ngày đó), "
                    "nhưng loại giải trình không phải 'Đi công tác' (BUSINESS_TRIP) nên KHÔNG được "
                    "trừ khỏi số đếm vi phạm tích lũy — số đếm đó vẫn tính các ngày này, có thể là "
                    "nguyên nhân khiến hệ số x2 kích hoạt sớm hơn dự kiến."
                ))

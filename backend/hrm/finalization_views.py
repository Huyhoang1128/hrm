"""
API views for Work Finalization (Chốt công).
"""
import io
import math
import calendar as cal_module
from dataclasses import dataclass
import datetime as _dt
from collections import defaultdict
from datetime import date
from decimal import Decimal

import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from employee.models import Department, Employee
from .main_api import EmployeeState
from .models import WorkFinalization
from .attendance_models import LivestreamAllowanceConfig
from .finalization_lock_mixin import check_finalization_lock, require_both_halves_locked, _is_hr_or_admin
from .employee_work_utils import is_holiday_creditable, get_holiday_credit_for_employee
from users.utils import get_user_role
from django.db.models import Q, Sum
from salary.models import MonthlySalaryRecord
from salary.salary_data_models import (
    EmployeeSalaryHistory,
    OtherAllowance,
    ParkingAllowanceOverride,
    LunchAllowanceOverride,
    SalaryAdvance,
    DisciplinaryPenalty,
    OvertimeRateConfig,
    TaxBracketConfig,
    SalesCommission,
)
from django.utils import timezone


MAX_LUNCH_ALLOWANCE_CAP = Decimal("500000")
NON_OFFICIAL_CONTRACT_TYPES = {"PROBATION", "INTERN", "COLLABORATOR"}
DEFAULT_PROBATION_RATE_PERCENT = Decimal("85")
PROBATION_RATE_PERCENT_MAP = {
    "OPTION_1": Decimal("85"),
    "OPTION_2": Decimal("85"),
    "OPTION_3": Decimal("100"),
}


def _started_on_or_before_month_q(year: int, month: int):
    last_day = cal_module.monthrange(year, month)[1]
    month_end = _dt.date(year, month, last_day)
    return Q(start_date__isnull=True) | Q(start_date__lte=month_end)


def _active_in_month_q(year: int, month: int):
    first_day = _dt.date(year, month, 1)
    last_day = cal_module.monthrange(year, month)[1]
    month_end = _dt.date(year, month, last_day)
    return (
        (Q(start_date__isnull=True) | Q(start_date__lte=month_end))
        & (Q(end_date__isnull=True) | Q(end_date__gte=first_day))
    )


def _to_decimal(value, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value is None or value == "":
            return default
        return Decimal(str(value))
    except Exception:
        return default


def _as_dict(value):
    if isinstance(value, dict):
        return value
    return {}


def _resolve_probation_rate_percent(employee: Employee) -> Decimal:
    raw_rate = str(getattr(employee, "probation_rate", "") or "").upper().strip()
    if raw_rate in PROBATION_RATE_PERCENT_MAP:
        return PROBATION_RATE_PERCENT_MAP[raw_rate]
    parsed = _to_decimal(raw_rate, DEFAULT_PROBATION_RATE_PERCENT)
    if parsed <= Decimal("0"):
        return DEFAULT_PROBATION_RATE_PERCENT
    return parsed


def _get_salary_standard_work_days(year: int, month: int) -> Decimal:
    days_in_month = cal_module.monthrange(year, month)[1]
    sundays_in_month = sum(
        1 for d in range(1, days_in_month + 1)
        if cal_module.weekday(year, month, d) == 6
    )
    return Decimal(str(max(days_in_month - sundays_in_month - 1, 1)))


def _get_salary_profile_for_month(employee: Employee, year: int, month: int) -> tuple[Decimal, Decimal]:
    days_in_month = cal_module.monthrange(year, month)[1]
    calc_date = _dt.date(year, month, days_in_month)
    salary_history = EmployeeSalaryHistory.get_for_date(employee, calc_date)
    if salary_history:
        return (
            _to_decimal(salary_history.basic_salary),
            _to_decimal(salary_history.allowance),
        )
    return (
        _to_decimal(employee.basic_salary),
        _to_decimal(employee.allowance),
    )


def _compute_progressive_tax(taxable_income: Decimal, tax_config: TaxBracketConfig | None) -> Decimal:
    if taxable_income <= Decimal("0") or not tax_config:
        return Decimal("0")

    total_tax = Decimal("0")
    for bracket in tax_config.brackets.order_by("order"):
        lower = bracket.min_income
        upper = bracket.max_income

        if taxable_income <= lower:
            break

        taxable_in_bracket = (
            taxable_income - lower if upper is None else min(taxable_income, upper) - lower
        )

        if taxable_in_bracket <= Decimal("0"):
            continue

        total_tax += taxable_in_bracket * bracket.rate

    return total_tax


def _get_default_tax_brackets(year: int) -> list[dict]:
    """
    Fallback bảng thuế theo tháng khi DB chưa cấu hình TaxBracketConfig.
    - Từ kỳ thuế 2026: biểu 5 bậc.
    - Trước 2026: biểu 7 bậc.
    """
    if year >= 2026:
        return [
            {"min": Decimal("0"), "max": Decimal("10000000"), "rate": Decimal("0.05")},
            {"min": Decimal("10000000"), "max": Decimal("30000000"), "rate": Decimal("0.10")},
            {"min": Decimal("30000000"), "max": Decimal("60000000"), "rate": Decimal("0.20")},
            {"min": Decimal("60000000"), "max": Decimal("100000000"), "rate": Decimal("0.30")},
            {"min": Decimal("100000000"), "max": None, "rate": Decimal("0.35")},
        ]

    return [
        {"min": Decimal("0"), "max": Decimal("5000000"), "rate": Decimal("0.05")},
        {"min": Decimal("5000000"), "max": Decimal("10000000"), "rate": Decimal("0.10")},
        {"min": Decimal("10000000"), "max": Decimal("18000000"), "rate": Decimal("0.15")},
        {"min": Decimal("18000000"), "max": Decimal("32000000"), "rate": Decimal("0.20")},
        {"min": Decimal("32000000"), "max": Decimal("52000000"), "rate": Decimal("0.25")},
        {"min": Decimal("52000000"), "max": Decimal("80000000"), "rate": Decimal("0.30")},
        {"min": Decimal("80000000"), "max": None, "rate": Decimal("0.35")},
    ]


def _compute_progressive_tax_with_default(taxable_income: Decimal, year: int, tax_config: TaxBracketConfig | None) -> Decimal:
    """Tính thuế lũy tiến: ưu tiên DB config, fallback bảng mặc định theo năm."""
    if taxable_income <= Decimal("0"):
        return Decimal("0")

    # Ưu tiên config từ DB nếu có bậc thuế
    if tax_config and tax_config.brackets.exists():
        return _compute_progressive_tax(taxable_income, tax_config)

    # Fallback theo luật mặc định
    total_tax = Decimal("0")
    for bracket in _get_default_tax_brackets(year):
        lower = bracket["min"]
        upper = bracket["max"]
        rate = bracket["rate"]

        if taxable_income <= lower:
            break

        taxable_in_bracket = (
            taxable_income - lower if upper is None else min(taxable_income, upper) - lower
        )

        if taxable_in_bracket <= Decimal("0"):
            continue

        total_tax += taxable_in_bracket * rate

    return total_tax


def _resolve_lunch_policy(employee: Employee) -> dict:
    adjustments = _as_dict(employee.salary_adjustments)
    payroll_config = _as_dict(adjustments.get("payroll_config"))
    allowances = _as_dict(payroll_config.get("allowances"))
    policy = _as_dict(payroll_config.get("lunchAllowancePolicy"))

    mode = str(policy.get("mode") or "fixed")
    if mode not in ("fixed", "actual_working_day"):
        mode = "fixed"

    fixed_amount = _to_decimal(policy.get("fixed_amount"), _to_decimal(allowances.get("lunch"), Decimal("0")))
    amount_per_work_day = _to_decimal(policy.get("amount_per_work_day"), Decimal("0"))
    # Support both snake_case and camelCase for backward compatibility
    monthly_cap = _to_decimal(policy.get("monthly_cap") or policy.get("monthlyCap"), MAX_LUNCH_ALLOWANCE_CAP)
    monthly_cap = min(monthly_cap if monthly_cap > 0 else Decimal("0"), MAX_LUNCH_ALLOWANCE_CAP)

    return {
        "mode": mode,
        "fixed_amount": fixed_amount,
        "amount_per_work_day": amount_per_work_day,
        "monthly_cap": monthly_cap,
    }


def _calculate_lunch_allowance(employee: Employee, actual_work_days: Decimal, year: int, month: int) -> Decimal:
    """
    Phụ cấp ăn trưa của nhân viên trong kỳ. Bản ghi nhập tay của kỳ
    (`LunchAllowanceOverride`) thắng tất cả, kể cả khi là 0; không có thì tính
    theo lunchAllowancePolicy.
    """
    override = LunchAllowanceOverride.objects.filter(
        employee=employee, year=year, month=month,
    ).values_list('amount', flat=True).first()
    if override is not None:
        return _to_decimal(override)
    policy = _resolve_lunch_policy(employee)
    cap = policy["monthly_cap"]
    if policy["mode"] == "actual_working_day":
        standard_work_days = _get_salary_standard_work_days(year, month)
        if standard_work_days > 0:
            rate_per_day = cap / standard_work_days
            return min(max(actual_work_days, Decimal("0")) * rate_per_day, cap)
        return Decimal("0")
    return min(max(policy["fixed_amount"], Decimal("0")), cap)


def _calculate_parking_allowance(employee: Employee, actual_work_days: Decimal, fallback: Decimal) -> Decimal:
    adjustments = _as_dict(employee.salary_adjustments)
    policy = _as_dict(_as_dict(adjustments.get("payroll_config")).get("parkingAllowancePolicy"))
    mode = str(policy.get("mode") or "")
    if mode == "daily":
        # Support both snake_case and camelCase for backward compatibility
        daily_rate = _to_decimal(policy.get("daily_rate") or policy.get("dailyRate"), Decimal("0"))
        return Decimal(str(math.ceil(max(float(actual_work_days), 0)))) * daily_rate
    if mode == "monthly":
        # Support both snake_case and camelCase for backward compatibility
        monthly_rate = _to_decimal(policy.get("monthly_rate") or policy.get("monthlyRate"), Decimal("0"))
        return monthly_rate
    if mode == "none":
        return Decimal("0")
    return fallback


def _resolve_config_allowances(employee: Employee) -> Decimal:
    """Tổng phụ cấp cố định từ payroll_config: transport, phone, housing, hazardous."""
    adjustments = _as_dict(employee.salary_adjustments)
    allowances = _as_dict(_as_dict(adjustments.get("payroll_config")).get("allowances"))
    keys = ["transport", "phone", "housing", "hazardous"]
    return sum(_to_decimal(allowances.get(k), Decimal("0")) for k in keys)


def _calculate_responsibility_allowance(employee: Employee, actual_work_days: Decimal, year: int, month: int) -> Decimal:
    adjustments = _as_dict(employee.salary_adjustments)
    policy = _as_dict(_as_dict(adjustments.get("payroll_config")).get("responsibilityAllowancePolicy"))
    mode = str(policy.get("mode") or "none")
    # Support both snake_case and camelCase for backward compatibility
    monthly_max = _to_decimal(policy.get("monthly_max") or policy.get("monthlyMax"), Decimal("0"))
    if mode == "fixed":
        return max(monthly_max, Decimal("0"))
    if mode == "actual_working_day":
        standard_work_days = _get_salary_standard_work_days(year, month)
        if standard_work_days > 0:
            rate = monthly_max / standard_work_days
            return min(max(actual_work_days, Decimal("0")) * rate, monthly_max)
        return Decimal("0")
    return Decimal("0")


def _get_other_allowance(employee: Employee, year: int, month: int) -> Decimal:
    try:
        obj = OtherAllowance.objects.get(employee=employee, year=year, month=month)
        return _to_decimal(obj.amount)
    except OtherAllowance.DoesNotExist:
        return Decimal("0")


def _get_parking_allowance_override(employee: Employee, year: int, month: int):
    """Trả về Decimal nếu HR đã import số PC gửi xe thủ công cho kỳ này, None nếu chưa có."""
    try:
        obj = ParkingAllowanceOverride.objects.get(employee=employee, year=year, month=month)
        return _to_decimal(obj.amount)
    except ParkingAllowanceOverride.DoesNotExist:
        return None


def _get_advance(employee: Employee, year: int, month: int) -> Decimal:
    try:
        obj = SalaryAdvance.objects.get(employee=employee, year=year, month=month)
        return _to_decimal(obj.amount)
    except SalaryAdvance.DoesNotExist:
        return Decimal("0")


def _resolve_livestream_allowance_config(employee: Employee, calc_date: _dt.date) -> LivestreamAllowanceConfig | None:
    qs = LivestreamAllowanceConfig.objects.filter(
        is_active=True,
        effective_from__lte=calc_date,
    ).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gte=calc_date)
    )

    if employee.department_id:
        qs = qs.filter(Q(apply_to_all=True) | Q(apply_to_departments=employee.department))
    else:
        qs = qs.filter(apply_to_all=True)

    return qs.order_by('-effective_from', '-id').distinct().first()


# Pass-through: already a display abbreviation stored in WorkFinalization
_HTLV_DISPLAY_PASSTHROUGH = {"CT", "TV", "TTS", "CTV"}

# Raw codes from Employee.contract_type choices → display abbreviation
_HTLV_CODE_MAP = {
    "PROBATION": "TV",
    "INTERN": "TTS",
    "COLLABORATOR": "CTV",
    "ONE_YEAR": "CT",
    "THREE_YEAR": "CT",
    "INDEFINITE": "CT",
    "SERVICE": "CT",
}


def _format_hinh_thuc_lam_viec(contract_type: str | None) -> str | None:
    """Convert raw contract_type code (or already-stored display value) to display abbreviation.

    Pass-through display values (already stored in WorkFinalization):
      CT → CT  (chính thức)
      TV → TV  (thử việc)
      TTS → TTS (thực tập sinh)
      CTV → CTV (cộng tác viên)

    Raw codes from Employee.contract_type choices:
      PROBATION        → TV  (thử việc)
      INTERN           → TTS (thực tập sinh)
      COLLABORATOR     → CTV (cộng tác viên)
      ONE_YEAR         → CT  (HĐ lao động 1 năm)
      THREE_YEAR       → CT  (HĐ lao động 3 năm)
      INDEFINITE       → CT  (HĐ vô thời hạn)
      SERVICE          → CT  (HĐ dịch vụ)
      everything else  → CT  (mặc định chính thức)
    None/empty → None
    """
    if not contract_type:
        return None
    if contract_type in _HTLV_DISPLAY_PASSTHROUGH:
        return contract_type
    return _HTLV_CODE_MAP.get(contract_type, "CT")


_WEEKDAY_LABELS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"]


def _build_daily_summary(calendar_data: list, year: int, month: int, employee: Employee) -> list:
    """
    Aggregate per-event calendar_data into a per-day summary list.
    Each entry: {date, day, weekday_label, is_weekend, work_credit, day_type, holiday_name}
    day_type: "" (normal), "P" (nghỉ phép), "OLW" (online work), "L" (nghỉ lễ),
              "KP" (nghỉ không phép)
    """
    from .event_models import EmployeeEvent
    from .attendance_views import AttendanceCalendarView

    num_days = cal_module.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, num_days)

    # Query EmployeeEvent objects (cần object đầy đủ để tái dùng
    # AttendanceCalendarView._day_status_from_events_data khi xét "nghỉ không phép")
    all_events = list(EmployeeEvent.objects.filter(
        employee=employee,
        event_date__range=(start, end),
    ))

    day_type_map: dict[date, str] = {}
    events_by_date: dict[date, list] = defaultdict(list)
    for ev in all_events:
        events_by_date[ev.event_date].append(ev)
        ev_data = ev.data or {}
        ev_status = ev_data.get("status", "").upper()
        # Leave: explanation with explanation_type=LEAVE
        if (
            ev.event_type == "explanation"
            and ev_data.get("explanation_type") == "LEAVE"
            and ev_status == "APPROVED"
        ):
            day_type_map.setdefault(ev.event_date, "P")
        elif ev.event_type == "online_work" and ev_status == "APPROVED":
            day_type_map.setdefault(ev.event_date, "OLW")

    # Aggregate calendar_data (per-event) → per-day work_credit / delta / effects
    # Also detect leave from delta (nghi_phep > 0) as a fallback
    day_credits: dict[str, float] = defaultdict(float)
    day_leave_from_delta: set[str] = set()
    day_agg_delta: dict[str, dict] = defaultdict(dict)
    day_agg_effects: dict[str, dict] = defaultdict(dict)
    for entry in calendar_data:
        d = entry.get("date")
        if not d:
            continue
        delta = entry.get("delta", {})
        credit = delta.get("ngay_du_cong", 0) + delta.get("nua_ngay_cong", 0)
        day_credits[d] += credit
        # If delta shows nghi_phep > 0, this day has leave
        if delta.get("nghi_phep", 0) > 0 or delta.get("nghi_khong_luong", 0) > 0:
            day_leave_from_delta.add(d)
        for k, v in delta.items():
            day_agg_delta[d][k] = day_agg_delta[d].get(k, 0) + v
        for k, v in (entry.get("effects") or {}).items():
            day_agg_effects[d][k] = day_agg_effects[d].get(k, 0) + v

    # Holidays
    holiday_map = AttendanceCalendarView._build_holiday_map(year, month)

    # Build summary for each day of the month
    from employee.assignment import AssignmentResolver
    assignment = AssignmentResolver()
    daily = []
    for day_num in range(1, num_days + 1):
        cur = date(year, month, day_num)
        weekday = cur.weekday()  # 0=Monday
        base_credit = round(day_credits.get(cur.isoformat(), 0), 2)
        # Part-time/full-time VÀO NGÀY LỄ (lịch sử điều chuyển) — đổi hình thức
        # làm việc từ tháng sau không đổi công lễ tháng này (case NV80028).
        holiday_credit_unit = get_holiday_credit_for_employee(employee, cur, assignment)
        holiday_creditable = cur in holiday_map and is_holiday_creditable(employee, cur)
        holiday_credit = holiday_credit_unit if holiday_creditable else 0.0
        credit = round(base_credit + holiday_credit, 2)

        day_type = day_type_map.get(cur, "")
        # Fallback: if delta detected leave but event query missed it
        if not day_type and cur.isoformat() in day_leave_from_delta:
            day_type = "P"
        if holiday_creditable:
            day_type = "L"

        # Nghỉ không phép: chỉ xét khi ngày này chưa được gán loại nào khác
        # (không phải nghỉ phép/online/lễ) — tái dùng đúng logic phân loại
        # ngày đã dùng cho lịch chấm công để đảm bảo nhất quán 2 nơi. Từ khi
        # có "Đơn nghỉ không phép", việc này chỉ được gán khi có đơn tương
        # ứng đã duyệt cho đúng ngày (không tự suy luận từ thiếu dữ liệu).
        # Ngày có vi phạm ở buổi còn lại vẫn đếm đơn KP; ngày nghỉ phép/online
        # chỉ đếm đơn KP nửa ngày (giữ nguyên P/OLW) — xem _unauthorized_absence_days.
        kp_amount = 0.0
        try:
            if not day_type:
                day_status, _badge = AttendanceCalendarView._day_status_from_events_data(
                    day_agg_delta.get(cur.isoformat(), {}),
                    day_agg_effects.get(cur.isoformat(), {}),
                    events_by_date.get(cur, []),
                    holiday_map,
                    cur,
                )
                kp_amount = AttendanceCalendarView._unauthorized_absence_days(day_status, events_by_date.get(cur, []))
                if kp_amount:
                    day_type = "KP"
            elif day_type in ("P", "OLW"):
                kp_amount = AttendanceCalendarView._unauthorized_absence_days(
                    "LEAVE" if day_type == "P" else "ONLINE_WORK", events_by_date.get(cur, []),
                )
        except Exception:
            pass  # không để lỗi phân loại phụ làm hỏng cả bảng công

        daily.append({
            "date": cur.isoformat(),
            "day": day_num,
            "weekday_label": _WEEKDAY_LABELS[weekday],
            "is_weekend": weekday >= 5,
            "work_credit": credit,
            "holiday_credit": holiday_credit,
            "day_type": day_type,
            "kp_amount": kp_amount,
            "holiday_name": holiday_map.get(cur),
        })
    return daily


def _build_finalization_record(employee: Employee, year: int, month: int) -> dict:
    """
    Calculate all work-finalization fields for a given employee / period using
    EmployeeState.replay_month() and return a dict ready to create/update a
    WorkFinalization row.
    """
    # Không truyền department_id: replay_month tự lấy phòng ban/vị trí THEO THÁNG
    # (lịch sử điều chuyển) — truyền phòng ban hiện tại là tính tháng cũ theo phòng mới.
    employee_info = {
        "group_ids": [],
    }

    result = EmployeeState.replay_month(
        employee_code=employee.employee_id,
        year=year,
        month=month,
        employee_info=employee_info,
    )

    state = result.get("state", {})
    calendar_data = result.get("calendar", [])
    daily_summary = _build_daily_summary(calendar_data, year, month, employee)

    # ---- Split probation / official work days --------------------------------
    probation_end_date = employee.probation_end_date

    cong_thu_viec = 0
    cong_chinh_thuc = 0

    for day_entry in calendar_data:
        delta = day_entry.get("delta", {})
        day_work = (
            delta.get("tong_ngay_cong", 0)
            or delta.get("ngay_du_cong", 0)
            or delta.get("nua_ngay_cong", 0)
        )
        if not day_work:
            continue
        try:
            entry_date = date.fromisoformat(day_entry.get("date", ""))
        except (ValueError, TypeError):
            continue

        if probation_end_date and entry_date <= probation_end_date:
            cong_thu_viec += float(day_work)
        else:
            cong_chinh_thuc += float(day_work)

    # Công lễ vẫn hiển thị riêng (co_le), KHÔNG cộng vào Công thử việc/chính
    # thức — nhưng tách theo ranh giới thử việc để bảng lương tính công lễ
    # trong thời gian thử việc như công thử việc (xem _holiday_credit_split).
    cong_le_thu_viec, cong_le_chinh_thuc = _split_holiday_credit(
        daily_summary, probation_end_date, _holiday_unit_for(employee),
    )
    cong_ngay_le = round(cong_le_thu_viec + cong_le_chinh_thuc, 2)
    # Công thử việc/chính thức LƯU luôn phần công lễ tương ứng (yêu cầu
    # 2026-10-03) để màn hình, Excel và bảng lương dùng chung 1 con số; đánh
    # dấu cong_includes_holiday để phân biệt với bản chốt cũ (chưa gồm lễ).
    cong_thu_viec += cong_le_thu_viec
    cong_chinh_thuc += cong_le_chinh_thuc

    tong_ngay_cong = float(state.get("tong_ngay_cong", 0))
    nghi_phep_thang = float(state.get("nghi_phep", 0))
    cong_thuc_te = round(tong_ngay_cong - nghi_phep_thang, 2)
    tong_cong = round(cong_thuc_te + nghi_phep_thang + cong_ngay_le, 2)
    # Gồm cả kp_amount của ngày P/OLW (nửa ngày nghỉ phép/online + nửa ngày KP).
    nghi_khong_phep_thang = round(sum(
        item.get("kp_amount", 1.0 if item.get("day_type") == "KP" else 0.0) for item in daily_summary
    ), 2)

    parking_override = _get_parking_allowance_override(employee, year, month)
    phu_cap_gui_xe = float(parking_override) if parking_override is not None else float(state.get("tong_phu_cap_gui_xe", 0))

    # Phòng ban/vị trí ghi vào bản chốt: của THÁNG ĐƯỢC CHỐT (lịch sử điều chuyển).
    from employee.assignment import employee_on
    employee_month = employee_on(employee, date(year, month, cal_module.monthrange(year, month)[1]))

    return {
        "employee_code": employee.employee_id,
        "ho_va_ten": employee.full_name,
        "phong_ban": employee_month.department.name if employee_month.department else None,
        "vi_tri": employee_month.position.title if employee_month.position else None,
        "bac_si": employee.doctor_team or None,
        "ngay_bat_dau_lam_viec": employee.start_date,
        "ngay_ket_thuc_thu_viec": employee.probation_end_date,
        "ngay_len_chinh_thuc": employee.official_start_date,
        "on_off": "OFF" if employee.employment_status == "INACTIVE" else "ON",
        "trang_thai_lam_viec": employee.employment_status,
        "ngay_nghi_viec": employee.end_date,
        "hinh_thuc_lam_viec": _format_hinh_thuc_lam_viec(employee.contract_type),
        "cong_thu_viec": round(cong_thu_viec, 2),
        "cong_chinh_thuc": round(cong_chinh_thuc, 2),
        "co_le": cong_ngay_le,
        "cong_thuc_te": cong_thuc_te,
        "tong_cong": tong_cong,
        "tong_phat": float(state.get("tong_phat", 0)),
        "tang_ca": float(state.get("tang_ca", 0)),
        "lam_toi": float(state.get("lam_them_gio", 0)), # Dự phòng: Làm tối lấy từ lam_them_gio
        "truc_toi": float(state.get("truc_toi", 0)),
        "lam_them_gio": float(state.get("lam_them_gio", 0)), # Thống nhất: Làm thêm giờ (EXTRA_HOURS)
        "live": int(state.get("live", 0)),
        "phu_cap_gui_xe": phu_cap_gui_xe,
        "nghi_phep_thang": nghi_phep_thang,
        "nghi_khong_phep_thang": nghi_khong_phep_thang,
        "raw_state": {
            **state,
            "holiday_credit": cong_ngay_le,
            "co_le_thu_viec": cong_le_thu_viec,
            "co_le_chinh_thuc": cong_le_chinh_thuc,
            "cong_includes_holiday": True,
            "daily_summary": daily_summary,
        },
    }


def _holiday_unit_for(employee):
    """Hàm (ngày lễ) -> công lễ của ngày đó theo hình thức làm việc VÀO NGÀY ĐÓ."""
    from employee.assignment import AssignmentResolver
    assignment = AssignmentResolver()
    return lambda holiday_date: get_holiday_credit_for_employee(employee, holiday_date, assignment)


def _split_holiday_credit(daily_summary: list, probation_end_date, unit=1.0) -> tuple[float, float]:
    """(công lễ thử việc, công lễ chính thức): ngày lễ ("L") <= ngày kết thúc
    thử việc tính là thử việc. Mỗi ngày lễ lấy `holiday_credit` đã lưu trong
    daily_summary (part-time 0.5, còn lại 1.0 — theo hình thức làm việc vào ngày
    lễ); bản chốt cũ chưa lưu thì dùng `unit`: số, hoặc hàm (ngày lễ) -> số.
    Trước 2026-10-15 luôn đếm 1.0 nên NV part-time bị gấp đôi công lễ khi chốt
    công (case NV80024 T9/2026: lịch 0.5 + 0.5 nhưng chốt ra 2 công lễ)."""
    thu_viec = chinh_thuc = 0.0
    for item in daily_summary or []:
        if item.get("day_type") != "L":
            continue
        try:
            holiday_date = date.fromisoformat(item.get("date", ""))
        except (ValueError, TypeError):
            continue
        amount = item.get("holiday_credit")
        if amount is None:
            amount = unit(holiday_date) if callable(unit) else unit
        if probation_end_date and holiday_date <= probation_end_date:
            thu_viec += amount
        else:
            chinh_thuc += amount
    return round(thu_viec, 2), round(chinh_thuc, 2)


def _holiday_credit_to_add(rec, employee: Employee) -> tuple[Decimal, Decimal]:
    """Phần công lễ (thử việc, chính thức) CÒN PHẢI cộng vào cong_thu_viec /
    cong_chinh_thuc đang lưu: bản chốt mới (cờ cong_includes_holiday, hoặc số
    nhập tay/import) đã gồm sẵn -> (0, 0); bản chốt cũ chưa gồm -> phần tách."""
    if rec is None or (rec.raw_state or {}).get("cong_includes_holiday"):
        return Decimal('0'), Decimal('0')
    return _holiday_credit_split(rec, employee)


def _holiday_credit_split(rec, employee: Employee) -> tuple[Decimal, Decimal]:
    """Công lễ (thử việc, chính thức) của 1 bản chốt công — dùng ở bảng lương:
    công lễ trong thời gian thử việc được trả như công thử việc (yêu cầu
    2026-10-03, case NV80031 T9/2026: hết thử việc 04/09, lễ 01-02/09 trước
    đây không được tính vào lương ngày công nhánh có ngày thử việc). Bản chốt
    cũ chưa lưu tách thì tính lại từ daily_summary + ngày kết thúc thử việc."""
    if rec is None:
        return Decimal('0'), Decimal('0')
    raw = rec.raw_state or {}
    if "co_le_thu_viec" in raw:
        return _to_decimal(raw.get("co_le_thu_viec")), _to_decimal(raw.get("co_le_chinh_thuc"))
    thu_viec, chinh_thuc = _split_holiday_credit(
        raw.get("daily_summary"), employee.probation_end_date, _holiday_unit_for(employee),
    )
    return _to_decimal(thu_viec), _to_decimal(chinh_thuc)


def _get_disciplinary_penalty(employee_id: int, year: int, month: int) -> float:
    """Get total DisciplinaryPenalty amount for an employee in a month."""
    try:
        result = DisciplinaryPenalty.objects.filter(
            employee_id=employee_id, year=year, month=month
        ).aggregate(total=Sum('amount'))
        return float(result.get('total') or 0)
    except Exception:
        return 0.0


def locked_finalizations(year: int, month: int, employees=None) -> dict:
    """Map employee_id -> WorkFinalization đã khoá của tháng (nạp 1 lượt, không query trong vòng lặp)."""
    qs = WorkFinalization.objects.filter(year=year, month=month, is_locked=True)
    if employees is not None:
        qs = qs.filter(employee__in=employees)
    return {rec.employee_id: rec for rec in qs}


def _skipped_locked_result(employee: Employee, rec: WorkFinalization) -> dict:
    """Một dòng kết quả cho nhân viên bị bỏ qua vì đã khoá số công."""
    return {
        "employee_code": employee.employee_id,
        "ho_va_ten": employee.full_name,
        "status": "SKIPPED_LOCKED",
        "lock_note": rec.lock_note,
        "tong_cong": rec.tong_cong,
    }


def _serialize_record(rec: WorkFinalization, stt: int = None) -> dict:
    """Convert a WorkFinalization instance to the API response dict."""
    giam_tru_khac = _get_disciplinary_penalty(rec.employee_id, rec.year, rec.month)
    raw_state = rec.raw_state or {}
    daily_summary = raw_state.get("daily_summary", []) if raw_state else []
    co_le_thu_viec, co_le_chinh_thuc = _holiday_credit_split(rec, rec.employee)
    le_tv_to_add, le_ct_to_add = _holiday_credit_to_add(rec, rec.employee)
    co_le = rec.co_le
    if not co_le:
        co_le = raw_state.get("holiday_credit")
    if not co_le and daily_summary:
        co_le = round(sum(_split_holiday_credit(daily_summary, None, _holiday_unit_for(rec.employee))), 2)
    tong_cong = rec.tong_cong
    if raw_state.get("holiday_credit") is None and co_le:
        tong_cong = round(float(rec.tong_cong or 0) + float(co_le or 0), 2)
    data = {
        "id": rec.pk,
        "employee_id": rec.employee_id,
        "ma_nv": rec.employee_code,
        "ho_va_ten": rec.ho_va_ten,
        "phong_ban": rec.phong_ban,
        "vi_tri": rec.vi_tri,
        "bac_si": rec.bac_si,
        "ngay_bat_dau_lam_viec": rec.ngay_bat_dau_lam_viec,
        "ngay_ket_thuc_thu_viec": rec.ngay_ket_thuc_thu_viec,
        "ngay_len_chinh_thuc": rec.ngay_len_chinh_thuc,
        "on_off": rec.on_off,
        "trang_thai_lam_viec": rec.trang_thai_lam_viec,
        "ngay_nghi_viec": rec.ngay_nghi_viec,
        "hinh_thuc_lam_viec": _format_hinh_thuc_lam_viec(rec.hinh_thuc_lam_viec),
        # Đã gồm công lễ theo ngày kết thúc thử việc (bản chốt cũ: cộng tại đây).
        "cong_thu_viec": float(_to_decimal(rec.cong_thu_viec) + le_tv_to_add),
        "cong_chinh_thuc": float(_to_decimal(rec.cong_chinh_thuc) + le_ct_to_add),
        "co_le": co_le,
        "co_le_thu_viec": float(co_le_thu_viec),
        "co_le_chinh_thuc": float(co_le_chinh_thuc),
        "cong_thuc_te": rec.cong_thuc_te,
        "tong_cong": tong_cong,
        "tong_phat": rec.tong_phat,
        "tang_ca": rec.tang_ca,
        "lam_toi": rec.lam_toi,
        "truc_toi": rec.truc_toi,
        "lam_them_gio": rec.lam_them_gio,
        "live": rec.live,
        "phu_cap_gui_xe": rec.phu_cap_gui_xe,
        "nghi_phep": rec.nghi_phep_thang,
        "nghi_khong_phep": rec.nghi_khong_phep_thang,
        "lam_viec_online": float(rec.raw_state.get("lam_viec_online", 0)) if rec.raw_state else 0,
        "giam_tru_khac": giam_tru_khac,
        "year": rec.year,
        "month": rec.month,
        "finalized_at": rec.finalized_at,
        "is_locked": rec.is_locked,
        "lock_note": rec.lock_note,
        "locked_at": rec.locked_at,
        "locked_by": rec.locked_by.full_name if rec.locked_by_id else None,
        "daily_summary": daily_summary,
    }
    if stt is not None:
        data["stt"] = stt
    return data


def _serialize_employee_no_record(employee: Employee, year: int, month: int, stt: int = None) -> dict:
    """Serialize an active employee that has no WorkFinalization record yet."""
    data = {
        "id": None,
        "employee_id": employee.pk,
        "ma_nv": employee.employee_id,
        "ho_va_ten": employee.full_name,
        "phong_ban": employee.department.name if employee.department else None,
        "vi_tri": employee.position.title if employee.position else None,
        "bac_si": employee.doctor_team or None,
        "ngay_bat_dau_lam_viec": employee.start_date,
        "ngay_ket_thuc_thu_viec": employee.probation_end_date,
        "ngay_len_chinh_thuc": employee.official_start_date,
        "on_off": "OFF" if employee.employment_status == "INACTIVE" else "ON",
        "trang_thai_lam_viec": employee.employment_status,
        "ngay_nghi_viec": employee.end_date,
        "hinh_thuc_lam_viec": _format_hinh_thuc_lam_viec(employee.contract_type),
        "cong_chinh_thuc": None,
        "co_le": None,
        "cong_thuc_te": None,
        "tong_cong": None,
        "tong_phat": None,
        "tang_ca": None,
        "lam_toi": None,
        "truc_toi": None,
        "lam_them_gio": None,
        "live": None,
        "phu_cap_gui_xe": None,
        "nghi_phep": None,
        "nghi_khong_phep": None,
        "lam_viec_online": None,
        "giam_tru_khac": _get_disciplinary_penalty(employee.pk, year, month),
        "year": year,
        "month": month,
        "finalized_at": None,
    }
    if stt is not None:
        data["stt"] = stt
    return data


class FinalizeAttendanceView(APIView):
    """
    POST /hrm/work-finalization/finalize/
    Body: { "employee_code": "NV001", "year": 2026, "month": 3 }

    Tính toán và lưu (upsert) dữ liệu chốt công cho nhân viên + tháng/năm.
    Trả về bản ghi đã lưu.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        employee_code = request.data.get("employee_code")
        year = request.data.get("year")
        month = request.data.get("month")

        # ---- Validate input ----
        if not employee_code:
            return Response(
                {"error": "employee_code là bắt buộc"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {"error": "year và month phải là số nguyên hợp lệ"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (1 <= month <= 12):
            return Response(
                {"error": "month phải từ 1 đến 12"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (2000 <= year <= 2100):
            return Response(
                {"error": "year phải từ 2000 đến 2100"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ---- Chỉ ADMIN/HR được chốt công (Trưởng phòng chỉ được XEM trang này) ----
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # ---- Kiểm tra khóa chốt công (HR/Admin bypass) ----
        is_locked, _, lock_resp = check_finalization_lock(year, month)
        if is_locked and not _is_hr_or_admin(request):
            return lock_resp

        # ---- Lookup employee ----
        try:
            employee = Employee.objects.select_related(
                "department", "position"
            ).get(employee_id=employee_code)
        except Employee.DoesNotExist:
            return Response(
                {"error": f"Không tìm thấy nhân viên với mã '{employee_code}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # ---- Bỏ qua nếu số công tháng này đã được khoá bằng tay ----
        existing_record = WorkFinalization.objects.filter(
            employee=employee, year=year, month=month, is_locked=True
        ).first()
        if existing_record:
            return Response(
                {
                    "message": "Số công tháng này đã được khoá, không tính lại.",
                    "skipped_locked": True,
                    "lock_note": existing_record.lock_note,
                    "data": _serialize_record(existing_record),
                },
                status=status.HTTP_200_OK,
            )

        # ---- Calculate using rule engine ----
        try:
            fields = _build_finalization_record(employee, year, month)
        except Exception as exc:
            return Response(
                {"error": f"Lỗi khi tính toán công: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        # ---- Upsert WorkFinalization ----
        record, created = WorkFinalization.objects.update_or_create(
            employee=employee,
            year=year,
            month=month,
            defaults=fields,
        )

        return Response(
            {
                "message": "Chốt công thành công" if created else "Đã cập nhật chốt công",
                "created": created,
                "data": _serialize_record(record),
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class FinalizeAllAttendanceView(APIView):
    """
    POST /hrm/work-finalization/finalize-all/
    Body: { "year": 2026, "month": 3 }

    Tính toán và lưu (upsert) dữ liệu chốt công cho toàn bộ nhân viên đang
    hoạt động (is_active=True) trong tháng/năm chỉ định.
    Trả về tổng kết số lượng thành công và thất bại.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        year = request.data.get("year")
        month = request.data.get("month")

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {"error": "year và month phải là số nguyên hợp lệ"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (1 <= month <= 12):
            return Response(
                {"error": "month phải từ 1 đến 12"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (2000 <= year <= 2100):
            return Response(
                {"error": "year phải từ 2000 đến 2100"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ---- Chỉ ADMIN/HR được chốt công (Trưởng phòng chỉ được XEM trang này) ----
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # ---- Yêu cầu CẢ HAI nửa tháng phải khoá trước khi chốt tất cả ----
        both_locked, lock_err = require_both_halves_locked(year, month)
        if not both_locked:
            return lock_err

        employees = Employee.objects.select_related(
            "department", "position"
        ).filter(is_active=True).filter(_active_in_month_q(year, month))

        locked = locked_finalizations(year, month, employees)

        results = []
        errors = []
        skipped = []

        for employee in employees:
            try:
                locked_rec = locked.get(employee.pk)
                if locked_rec is not None:
                    skipped.append(_skipped_locked_result(employee, locked_rec))
                    continue

                fields = _build_finalization_record(employee, year, month)
                record, created = WorkFinalization.objects.update_or_create(
                    employee=employee,
                    year=year,
                    month=month,
                    defaults=fields,
                )
                results.append(
                    {
                        "employee_code": employee.employee_id,
                        "ho_va_ten": employee.full_name,
                        "created": created,
                    }
                )
            except Exception as exc:
                errors.append(
                    {
                        "employee_code": employee.employee_id,
                        "ho_va_ten": employee.full_name,
                        "error": str(exc),
                    }
                )

        return Response(
            {
                "year": year,
                "month": month,
                "total_processed": len(results),
                "total_errors": len(errors),
                "total_skipped_locked": len(skipped),
                "results": results,
                "errors": errors,
                "skipped_locked": skipped,
            },
            status=status.HTTP_200_OK,
        )


class FinalizeDepartmentAttendanceView(APIView):
    """
    POST /hrm/work-finalization/finalize-department/
    Body: { "department_id": 1, "year": 2026, "month": 3 }
       or { "department_code": "KD", "year": 2026, "month": 3 }

    Tính toán và lưu (upsert) dữ liệu chốt công cho toàn bộ nhân viên đang
    hoạt động (is_active=True) thuộc phòng ban chỉ định.
    Trả về tổng kết số lượng thành công và thất bại.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        year = request.data.get("year")
        month = request.data.get("month")
        department_id = request.data.get("department_id")
        department_code = request.data.get("department_code")

        # ---- Validate year / month ----
        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {"error": "year và month phải là số nguyên hợp lệ"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (1 <= month <= 12):
            return Response(
                {"error": "month phải từ 1 đến 12"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (2000 <= year <= 2100):
            return Response(
                {"error": "year phải từ 2000 đến 2100"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ---- Chỉ ADMIN/HR được chốt công (Trưởng phòng chỉ được XEM trang này) ----
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        both_locked, lock_err = require_both_halves_locked(year, month)
        if not both_locked:
            return lock_err

        # ---- Validate department input ----
        if not department_id and not department_code:
            return Response(
                {"error": "department_id hoặc department_code là bắt buộc"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # ---- Lookup department ----
        try:
            if department_id:
                department = Department.objects.get(pk=int(department_id))
            else:
                department = Department.objects.get(code=department_code)
        except (Department.DoesNotExist, ValueError):
            identifier = department_id if department_id else department_code
            return Response(
                {"error": f"Không tìm thấy phòng ban '{identifier}'"},
                status=status.HTTP_404_NOT_FOUND,
            )

        employees = Employee.objects.select_related(
            "department", "position"
        ).filter(is_active=True, department=department).filter(_active_in_month_q(year, month))

        locked = locked_finalizations(year, month, employees)

        results = []
        errors = []
        skipped = []

        for employee in employees:
            try:
                locked_rec = locked.get(employee.pk)
                if locked_rec is not None:
                    skipped.append(_skipped_locked_result(employee, locked_rec))
                    continue

                fields = _build_finalization_record(employee, year, month)
                record, created = WorkFinalization.objects.update_or_create(
                    employee=employee,
                    year=year,
                    month=month,
                    defaults=fields,
                )
                results.append(
                    {
                        "employee_code": employee.employee_id,
                        "ho_va_ten": employee.full_name,
                        "created": created,
                    }
                )
            except Exception as exc:
                errors.append(
                    {
                        "employee_code": employee.employee_id,
                        "ho_va_ten": employee.full_name,
                        "error": str(exc),
                    }
                )

        return Response(
            {
                "year": year,
                "month": month,
                "department_id": department.pk,
                "department_code": department.code,
                "department_name": department.name,
                "total_processed": len(results),
                "total_errors": len(errors),
                "total_skipped_locked": len(skipped),
                "results": results,
                "errors": errors,
                "skipped_locked": skipped,
            },
            status=status.HTTP_200_OK,
        )


class WorkFinalizationListView(APIView):
    """
    GET /hrm/work-finalization/
    Query params:
      - year (required)
      - month (required)
      - employee_code (optional) — khớp chính xác mã NV
      - search (optional) — chứa trong mã NV hoặc họ tên, không phân biệt hoa thường
      - department_id (optional)

    Trả về toàn bộ nhân sự active, kèm dữ liệu chốt công nếu đã được chốt.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        year = request.query_params.get("year")
        month = request.query_params.get("month")
        employee_code = request.query_params.get("employee_code")
        search = (request.query_params.get("search") or "").strip()
        department_id = request.query_params.get("department_id")

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {"error": "year và month là bắt buộc và phải là số nguyên"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # records_only: chỉ các bản ghi ĐANG CÓ trong bảng chốt công của tháng (kể cả
        # NV đã nghỉ) — dùng cho trang "Data chốt công" của HCNS/Admin.
        if str(request.query_params.get("records_only", "")).lower() in {"1", "true", "yes"}:
            if not _is_hr_or_admin(request):
                return Response({"error": "Chỉ HCNS hoặc Admin được xem data chốt công."},
                                status=status.HTTP_403_FORBIDDEN)
            records_qs = WorkFinalization.objects.select_related(
                "employee", "employee__department", "employee__position", "locked_by"
            ).filter(year=year, month=month)
            if department_id:
                records_qs = records_qs.filter(employee__department_id=department_id)
            if employee_code:
                records_qs = records_qs.filter(employee_code__iexact=employee_code)
            if search:
                records_qs = records_qs.filter(
                    Q(employee_code__icontains=search) | Q(ho_va_ten__icontains=search)
                    | Q(employee__full_name__icontains=search)
                )
            records = list(records_qs.order_by("employee_code"))
            results = [_serialize_record(rec, stt=idx + 1) for idx, rec in enumerate(records)]
            return Response({"year": year, "month": month, "total": len(results), "results": results})

        # Lấy toàn bộ nhân sự active (không giới hạn số lượng)
        employees_qs = Employee.objects.select_related(
            "department", "position"
        ).filter(is_active=True).filter(_active_in_month_q(year, month))

        if employee_code:
            employees_qs = employees_qs.filter(employee_id=employee_code)
        # Cùng kiểu tìm với ô tìm kiếm danh sách NV ở trang Chốt công (tên hoặc
        # mã) — trước đây FE gửi chữ gõ vào employee_code (khớp chính xác) nên
        # tìm theo tên/gõ thiếu mã thì không lấy được bản chốt, trang báo "Chưa
        # chốt công" và ẩn khung "Kết quả chốt công".
        if search:
            employees_qs = employees_qs.filter(
                Q(employee_id__icontains=search) | Q(full_name__icontains=search)
            )

        if not _is_hr_or_admin(request):
            # Trưởng phòng (is_manager) chỉ được XEM chốt công của nhân viên
            # đang có mình là "quản lý trực tiếp" (Employee.manager). NV
            # thường (không phải trưởng phòng) không có quyền xem trang này
            # -> trả rỗng.
            #
            # LƯU Ý: trước đây lọc theo Department.manager ("Trưởng phòng
            # ban"), nhưng dữ liệu thực tế cho thấy Department.manager hầu
            # như không được gán (chẩn đoán qua diagnose_manager_scope) —
            # cấu trúc báo cáo thật nằm ở Employee.manager, nên đổi sang
            # dùng field này (chỉ cấp dưới TRỰC TIẾP, không đệ quy). Vì
            # phạm vi giờ không còn gắn với 1 phòng ban cụ thể,
            # department_id (nếu client vẫn gửi) chỉ đóng vai trò lọc thêm
            # trong tập nhân viên đã được giới hạn — không thể lộ dữ liệu
            # ngoài phạm vi được phép dù giá trị gửi lên là gì.
            request_employee = Employee.objects.filter(
                user=request.user
            ).select_related('position').first()
            allowed_employee_ids = []
            if request_employee and request_employee.position and request_employee.position.is_management:
                allowed_employee_ids = list(
                    Employee.objects.filter(manager=request_employee).values_list('id', flat=True)
                )
            employees_qs = employees_qs.filter(id__in=allowed_employee_ids)
            if department_id:
                employees_qs = employees_qs.filter(department_id=department_id)
        elif department_id:
            employees_qs = employees_qs.filter(department_id=department_id)

        employees_qs = employees_qs.order_by("employee_id")

        # Evaluate queryset once to avoid two DB hits
        employees = list(employees_qs)

        # Xây dựng map employee_pk → WorkFinalization record
        employee_pks = [e.pk for e in employees]
        records_map = {
            rec.employee_id: rec
            for rec in WorkFinalization.objects.filter(
                year=year, month=month, employee_id__in=employee_pks
            )
        }

        results = []
        for idx, employee in enumerate(employees):
            stt = idx + 1
            rec = records_map.get(employee.pk)
            if rec:
                results.append(_serialize_record(rec, stt=stt))
            else:
                results.append(_serialize_employee_no_record(employee, year, month, stt=stt))

        return Response(
            {
                "year": year,
                "month": month,
                "total": len(results),
                "results": results,
            }
        )


class WorkFinalizationDetailView(APIView):
    """
    GET    /hrm/work-finalization/<employee_code>/<year>/<month>/  — HR/Admin, chính NV đó hoặc QLTT
    PATCH  /hrm/work-finalization/<employee_code>/<year>/<month>/  — HR/Admin
      Body (partial): { tong_cong, tang_ca, tong_phat, cong_thuc_te, ..., is_locked, lock_note }
    DELETE /hrm/work-finalization/<employee_code>/<year>/<month>/  — HR/Admin
    """

    permission_classes = [IsAuthenticated]

    _PATCHABLE_FIELDS = {
        'tong_cong', 'cong_thuc_te', 'tong_phat', 'tang_ca',
        'cong_thu_viec', 'cong_chinh_thuc',
        'lam_them_gio', 'truc_toi', 'live', 'phu_cap_gui_xe',
    }

    def get(self, request, employee_code, year, month):
        try:
            record = WorkFinalization.objects.select_related(
                "employee", "employee__department", "employee__position"
            ).get(employee_code=employee_code, year=year, month=month)
        except WorkFinalization.DoesNotExist:
            return Response(
                {"error": "Chưa có dữ liệu chốt công cho nhân viên và tháng này"},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not _is_hr_or_admin(request):
            viewer = getattr(request.user, 'employee', None)
            if viewer is None or (record.employee_id != viewer.pk and record.employee.manager_id != viewer.pk):
                return Response({"error": "Bạn không có quyền xem dữ liệu chốt công này."},
                                status=status.HTTP_403_FORBIDDEN)

        return Response(_serialize_record(record))

    def patch(self, request, employee_code, year, month):
        if not _is_hr_or_admin(request):
            return Response({"error": "Chỉ HCNS hoặc Admin được sửa dữ liệu chốt công."},
                            status=status.HTTP_403_FORBIDDEN)
        try:
            record = WorkFinalization.objects.get(
                employee_code=employee_code, year=year, month=month
            )
        except WorkFinalization.DoesNotExist:
            return Response(
                {"error": "Chưa có dữ liệu chốt công cho nhân viên và tháng này"},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Số công thử việc/chính thức nhập tay là số ĐÃ GỒM công lễ (đúng như
        # màn hình hiển thị) -> bản chốt cũ thì cộng sẵn công lễ vào trường
        # không bị sửa rồi gắn cờ, để 2 trường luôn cùng 1 kiểu số.
        credit_fields = {"cong_thu_viec", "cong_chinh_thuc"}
        bake_holiday = bool(credit_fields & set(request.data)) and not (record.raw_state or {}).get("cong_includes_holiday")
        if bake_holiday:
            le_tv, le_ct = _holiday_credit_to_add(record, record.employee)
            record.cong_thu_viec = _to_decimal(record.cong_thu_viec) + le_tv
            record.cong_chinh_thuc = _to_decimal(record.cong_chinh_thuc) + le_ct

        updated = []
        for field in self._PATCHABLE_FIELDS:
            if field in request.data:
                setattr(record, field, request.data[field])
                updated.append(field)

        # Khoá/mở khoá đi kèm luôn trong cùng một lần PATCH: sửa công rồi khoá là
        # một thao tác, tách ra hai request thì "chốt công tất cả" có thể chen vào
        # giữa và ghi đè mất số vừa sửa.
        if 'is_locked' in request.data:
            want_lock = str(request.data['is_locked']).lower() in ('true', '1')
            record.is_locked = want_lock
            if want_lock:
                record.lock_note = str(request.data.get('lock_note', '') or '')
                record.locked_at = timezone.now()
                record.locked_by = getattr(request.user, 'employee', None)
            else:
                record.lock_note = ''
                record.locked_at = None
                record.locked_by = None
            updated += ['is_locked', 'lock_note', 'locked_at', 'locked_by']
        elif 'lock_note' in request.data and record.is_locked:
            record.lock_note = str(request.data['lock_note'] or '')
            updated.append('lock_note')

        if not updated:
            allowed = sorted(self._PATCHABLE_FIELDS | {'is_locked', 'lock_note'})
            return Response(
                {"error": f"Không có trường hợp lệ. Cho phép: {allowed}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if bake_holiday:
            record.raw_state = {**(record.raw_state or {}), "cong_includes_holiday": True}
            updated = sorted(set(updated) | credit_fields | {"raw_state"})
        record.save(update_fields=updated)
        return Response(_serialize_record(record))

    def delete(self, request, employee_code, year, month):
        if not _is_hr_or_admin(request):
            return Response({"error": "Chỉ HCNS hoặc Admin được xoá dữ liệu chốt công."},
                            status=status.HTTP_403_FORBIDDEN)
        deleted, _ = WorkFinalization.objects.filter(
            employee_code=employee_code, year=year, month=month
        ).delete()
        if not deleted:
            return Response({"error": "Chưa có dữ liệu chốt công cho nhân viên và tháng này"},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _get_dependent_record_counts(employee_ids, period_start, period_end) -> dict:
    """
    Số người phụ thuộc có hiệu lực trong kỳ, đếm từ hồ sơ người phụ thuộc.

    Chỉ trả về khoá cho NV ĐÃ có ít nhất một hồ sơ (chưa xoá); NV chưa có hồ sơ nào
    thì vắng mặt trong kết quả để bảng lương giữ nguyên con số khai trong
    `payroll_config.taxPolicy.dependentCount`. NV có hồ sơ nhưng không hồ sơ nào
    phủ kỳ tính thì được 0.
    """
    from django.db.models import Q
    from employee.models import EmployeeDependent

    base = EmployeeDependent.objects.filter(employee_id__in=employee_ids, is_deleted=False)
    counts = {emp_id: 0 for emp_id in base.values_list('employee_id', flat=True).distinct()}
    effective = (
        base.filter(is_active=True)
        .filter(Q(dependent_from__isnull=True) | Q(dependent_from__lte=period_end))
        .filter(Q(dependent_to__isnull=True) | Q(dependent_to__gte=period_start))
        .values_list('employee_id', flat=True)
    )
    for emp_id in effective:
        counts[emp_id] = counts.get(emp_id, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# BẢNG LƯƠNG THÁNG — dùng chung cho GET /hrm/salary/department/ và các API lương
# (tổng lương, phiếu lương, email phiếu lương). Không kiểm tra quyền: nơi gọi tự lo.
# ---------------------------------------------------------------------------

# Tỷ lệ BH/CĐ phần người lao động
EMPLOYEE_BHXH_RATE = Decimal('0.08')
EMPLOYEE_BHYT_RATE = Decimal('0.015')
EMPLOYEE_BHTN_RATE = Decimal('0.01')
EMPLOYEE_CD_RATE = Decimal('0.01')
EMPLOYEE_INSURANCE_RATE = EMPLOYEE_BHXH_RATE + EMPLOYEE_BHYT_RATE + EMPLOYEE_BHTN_RATE  # 0.105, trừ khi tính thuế
EMPLOYEE_BH_TOTAL_RATE = EMPLOYEE_INSURANCE_RATE + EMPLOYEE_CD_RATE  # 0.115, trừ vào lương


@dataclass
class SalaryMonthContext:
    """Dữ liệu dùng chung của cả tháng, nạp 1 lần cho mọi dòng lương."""
    year: int
    month: int
    calc_date: _dt.date
    standard_work_days: Decimal
    tax_cfg: object
    personal_deduction: Decimal
    dependent_deduction_per_person: Decimal
    records: dict            # employee_id -> WorkFinalization
    salary_records: dict     # employee_id -> MonthlySalaryRecord
    dependent_counts: dict   # employee_id -> số người phụ thuộc có hồ sơ trong tháng
    bien_ban_penalties: dict  # employee_id -> tổng phạt biên bản
    sales_commissions: dict   # employee_id -> tổng hoa hồng


def resolve_salary_employees(year: int, month: int, department_id=None, legal_entity: str = '',
                             employee_code=None) -> list:
    """Nhân viên có dòng lương trong tháng: đang hoạt động và còn làm trong tháng."""
    employees_qs = Employee.objects.select_related("department", "position").filter(is_active=True).filter(_active_in_month_q(year, month))
    if department_id:
        employees_qs = employees_qs.filter(department_id=department_id)
    if legal_entity:
        employees_qs = employees_qs.filter(subsidiary_legal_entity=legal_entity)
    if employee_code:
        employees_qs = employees_qs.filter(
            Q(employee_id__icontains=employee_code) | Q(full_name__icontains=employee_code)
        )
    return list(employees_qs.order_by("employee_id"))


def build_salary_context(employees: list, year: int, month: int) -> SalaryMonthContext:
    employee_ids = [e.id for e in employees]
    _, days_in_month = cal_module.monthrange(year, month)
    calc_date = _dt.date(year, month, days_in_month)
    tax_cfg = TaxBracketConfig.get_for_date(calc_date) or TaxBracketConfig.get_active()
    default_personal_deduction = Decimal('15500000') if year >= 2026 else Decimal('11000000')
    default_dependent_deduction = Decimal('6200000') if year >= 2026 else Decimal('4400000')

    def sums_by_employee(model):
        rows = (
            model.objects
            .filter(employee_id__in=employee_ids, year=year, month=month)
            .values('employee_id')
            .annotate(total=Sum('amount'))
        )
        return {row['employee_id']: _to_decimal(row['total']) for row in rows}

    return SalaryMonthContext(
        year=year,
        month=month,
        calc_date=calc_date,
        standard_work_days=_get_salary_standard_work_days(year, month),
        tax_cfg=tax_cfg,
        personal_deduction=(tax_cfg.personal_deduction if tax_cfg else default_personal_deduction),
        dependent_deduction_per_person=(tax_cfg.dependent_deduction if tax_cfg else default_dependent_deduction),
        records={
            rec.employee_id: rec
            for rec in WorkFinalization.objects.filter(year=year, month=month, employee_id__in=employee_ids)
        },
        salary_records={
            sr.employee_id: sr
            for sr in MonthlySalaryRecord.objects.filter(year=year, month=month, employee_id__in=employee_ids)
        },
        dependent_counts=_get_dependent_record_counts(
            employee_ids, _dt.date(year, month, 1), _dt.date(year, month, days_in_month)
        ),
        bien_ban_penalties=sums_by_employee(DisciplinaryPenalty),
        sales_commissions=sums_by_employee(SalesCommission),
    )


def build_salary_row(employee: Employee, ctx: SalaryMonthContext) -> dict:
    """Một dòng bảng lương của nhân viên trong tháng của ctx."""
    year, month = ctx.year, ctx.month
    calc_date = ctx.calc_date
    standard_work_days = ctx.standard_work_days
    tax_cfg = ctx.tax_cfg
    personal_deduction = ctx.personal_deduction
    dependent_deduction_per_person = ctx.dependent_deduction_per_person
    rec = ctx.records.get(employee.id)
    sr = ctx.salary_records.get(employee.id)
    contract_type = (employee.contract_type or "").upper()
    is_non_official_contract = contract_type in NON_OFFICIAL_CONTRACT_TYPES
    contract_status = "THU_VIEC" if is_non_official_contract else "CHINH_THUC"

    basic_salary, fixed_allowance = _get_salary_profile_for_month(employee, year, month)
    actual_work_days = _to_decimal(rec.cong_thuc_te if rec else 0)
    total_work_days = _to_decimal(rec.tong_cong if rec else 0)
    holiday_probation_days, holiday_official_days = _holiday_credit_to_add(rec, employee)
    probation_work_days = _to_decimal(rec.cong_thu_viec if rec else 0) + holiday_probation_days
    official_work_days = _to_decimal(rec.cong_chinh_thuc if rec else 0) + holiday_official_days
    has_probation_days = probation_work_days > Decimal('0')
    has_official_days = official_work_days > Decimal('0')
    probation_only = has_probation_days and not has_official_days
    mixed_probation_official = has_probation_days and has_official_days
    mixed_official_days_eligible_progressive_tax = mixed_probation_official and official_work_days >= Decimal('14')
    probation_rate_percent = _resolve_probation_rate_percent(employee)
    probation_rate_multiplier = probation_rate_percent / Decimal('100')
    base_day_salary = (basic_salary / standard_work_days) if standard_work_days > 0 else Decimal('0')
    probation_workday_salary = base_day_salary * probation_work_days * probation_rate_multiplier
    official_workday_salary = base_day_salary * official_work_days
    split_workday_salary = probation_workday_salary + official_workday_salary
    lunch_allowance = _calculate_lunch_allowance(employee, total_work_days, year, month)
    stored_parking = _to_decimal(rec.phu_cap_gui_xe if rec else 0)
    parking_override = _get_parking_allowance_override(employee, year, month)
    parking_allowance = parking_override if parking_override is not None else _calculate_parking_allowance(employee, actual_work_days, stored_parking)

    config_allowances = _resolve_config_allowances(employee)
    responsibility_allowance = _calculate_responsibility_allowance(employee, total_work_days, year, month)
    other_allowance = _get_other_allowance(employee, year, month)
    other_fixed_income = _to_decimal(employee.other_fixed_monthly_income)
    advance_amount = _get_advance(employee, year, month)
    sales_commission = ctx.sales_commissions.get(employee.id, Decimal('0'))
    livestream_sessions = max(int(_to_decimal(rec.live if rec else 0)), 0)
    livestream_allowance_config = _resolve_livestream_allowance_config(employee, calc_date)
    livestream_amount_per_session = _to_decimal(
        livestream_allowance_config.amount_per_session if livestream_allowance_config else 0
    )
    livestream_allowance = livestream_amount_per_session * Decimal(str(livestream_sessions))
    total_allowance = (
        fixed_allowance
        + lunch_allowance
        + parking_allowance
        + config_allowances
        + responsibility_allowance
        + other_allowance
        + livestream_allowance
    )

    attendance_penalty = _to_decimal(rec.tong_phat if rec else 0)
    bien_ban_penalty = ctx.bien_ban_penalties.get(employee.id, Decimal('0'))
    total_penalty = attendance_penalty + bien_ban_penalty

    # Lương tăng ca: ưu tiên từ salary record đã tính, fallback tính từ OT rate config
    ot_pay = Decimal('0')
    if sr and sr.components_detail:
        ot_component = sr.components_detail.get('OT_PAY', {})
        ot_pay = _to_decimal(ot_component.get('amount', 0))

    tang_ca_hours = _to_decimal(rec.tang_ca if rec else 0)
    if ot_pay == Decimal('0') and tang_ca_hours > 0:
        _, std_days = cal_module.monthrange(year, month)
        sundays = sum(1 for d in range(1, std_days + 1) if cal_module.weekday(year, month, d) == 6)
        standard_work_days_f = float(max(std_days - sundays - 1, 1))
        ot_rate = OvertimeRateConfig.get_for_employee(
            employee, calc_date,
            basic_salary=float(basic_salary),
            standard_work_days=standard_work_days_f,
        )
        ot_pay = _to_decimal(round(float(tang_ca_hours) * ot_rate, 2))

    # Compute insurance base salary from Employee field (Mức đóng BHXH)
    ins_base = max(_to_decimal(employee.social_insurance_contribution_level), Decimal('0'))

    adjustments = _as_dict(employee.salary_adjustments)
    tax_policy = _as_dict(_as_dict(adjustments.get('payroll_config')).get('taxPolicy'))
    if probation_only:
        ins_base = Decimal('0')
        bh_deduction = Decimal('0')
    elif is_non_official_contract and not mixed_probation_official:
        ins_base = Decimal('0')
        bh_deduction = Decimal('0')
    else:
        bh_deduction = ins_base * EMPLOYEE_BH_TOTAL_RATE

    if employee.id in ctx.dependent_counts:
        dependent_count = ctx.dependent_counts[employee.id]
    else:
        dependent_count = max(int(_to_decimal(tax_policy.get('dependentCount'), Decimal('0'))), 0)
    deductions_config = _as_dict(_as_dict(adjustments.get('payroll_config')).get('deductions'))
    union_fee = _to_decimal(deductions_config.get('unionFee'), Decimal('0'))
    insurance_deduction_for_tax = Decimal('0') if (probation_only or (is_non_official_contract and not mixed_probation_official)) else (ins_base * EMPLOYEE_INSURANCE_RATE)
    taxable_allowance = max(total_allowance - lunch_allowance, Decimal('0'))
    actual_total_days = _to_decimal(rec.tong_cong if rec else 0)
    if has_probation_days:
        taxable_basic_income = split_workday_salary
    else:
        taxable_basic_income = (
            (basic_salary / standard_work_days) * actual_total_days
            if actual_total_days > 0
            else Decimal('0')
        )
    gross_income_for_tax = (
        taxable_basic_income
        + taxable_allowance
        + sales_commission
        + other_fixed_income
        + _to_decimal(rec.truc_toi if rec else 0)
        + ot_pay
    )
    # Nếu đã đóng BHXH/BHYT/BHTN thì phải tính thuế luỹ tiến;
    # không được vừa trừ bảo hiểm vừa khấu trừ thêm 10% flat.
    has_mandatory_insurance = insurance_deduction_for_tax > Decimal('0')

    if probation_only:
        # Thử việc thuần tuý: không đóng BH → áp 10%
        taxable_income = max(gross_income_for_tax, Decimal('0'))
        pit_amount = taxable_income * Decimal('0.10')
        personal_deduction_applied = Decimal('0')
        dependent_deduction_applied = Decimal('0')
        tax_method = 'FLAT_10_PROBATION'
    elif mixed_probation_official and not mixed_official_days_eligible_progressive_tax and not has_mandatory_insurance:
        # Có cả công TV + CT, CT < 14 ngày, nhưng KHÔNG đóng BH → 10%
        taxable_income = max(gross_income_for_tax, Decimal('0'))
        pit_amount = taxable_income * Decimal('0.10')
        personal_deduction_applied = Decimal('0')
        dependent_deduction_applied = Decimal('0')
        tax_method = 'FLAT_10_MIXED_LT14'
    elif is_non_official_contract and not has_mandatory_insurance:
        # Hợp đồng không chính thức, không đóng BH → 10%
        taxable_income = max(gross_income_for_tax, Decimal('0'))
        pit_amount = taxable_income * Decimal('0.10')
        personal_deduction_applied = Decimal('0')
        dependent_deduction_applied = Decimal('0')
        tax_method = 'FLAT_10_NON_OFFICIAL'
    else:
        taxable_income = max(
            gross_income_for_tax
            - insurance_deduction_for_tax
            - personal_deduction
            - (dependent_deduction_per_person * Decimal(dependent_count)),
            Decimal('0'),
        )
        pit_amount = _compute_progressive_tax_with_default(taxable_income, year, tax_cfg)
        personal_deduction_applied = personal_deduction
        dependent_deduction_applied = dependent_deduction_per_person * Decimal(dependent_count)
        tax_method = 'PROGRESSIVE'

    salary_income_for_net = taxable_basic_income
    net_salary = salary_income_for_net + total_allowance + sales_commission + other_fixed_income - total_penalty - advance_amount - bh_deduction
    con_phai_thanh_toan = net_salary - pit_amount

    return {
        "employee_id": employee.id,
        "ma_nv": employee.employee_id,
        "ho_va_ten": employee.full_name,
        "phong_ban": employee.department.name if employee.department else None,
        "phap_nhan_con": employee.subsidiary_legal_entity,
        "vi_tri": employee.position.title if employee.position else None,
        "luong_co_ban": float(basic_salary),
        "phu_cap": float(total_allowance),
        "luong_doanh_so": float(sales_commission),
        "thu_nhap_khac": float(other_fixed_income),
        "ngay_cong": float(actual_work_days),
        "cong_thu_viec": float(probation_work_days),
        # Công tính lương: đã gồm công lễ theo ranh giới thử việc.
        "cong_chinh_thuc": float(official_work_days),
        "probation_rate_percent": float(probation_rate_percent),
        "luong_ngay_cong_thu_viec": float(probation_workday_salary),
        "luong_ngay_cong_chinh_thuc": float(official_workday_salary),
        "luong_ngay_cong": float(taxable_basic_income),
        "tang_ca": float(_to_decimal(rec.tang_ca if rec else 0)),
        "truc_toi": float(_to_decimal(rec.truc_toi if rec else 0)),
        "lam_them_gio": float(_to_decimal(rec.lam_them_gio if rec else 0)),
        "phu_cap_gui_xe": float(parking_allowance),
        "phu_cap_khac": float(other_allowance),
        "phu_cap_livestream": float(livestream_allowance),
        "so_phien_livestream": livestream_sessions,
        "muc_phu_cap_moi_phien_livestream": float(livestream_amount_per_session),
        "tong_cong": float(_to_decimal(rec.tong_cong if rec else 0)),
        "cong_chuan": float(standard_work_days),
        "tong_phat": float(attendance_penalty),
        "tong_phat_bienban": float(bien_ban_penalty),
        "bh_deduction": float(bh_deduction),
        "muc_luong_dong_bh": float(ins_base),
        "luong_tang_ca": float(ot_pay),
        "so_gio_tang_ca": float(tang_ca_hours),
        "contract_type": employee.contract_type,
        "contract_status": contract_status,
        "phu_cap_an_trua": float(lunch_allowance),
        "tong_thu_nhap_chiu_thue": float(gross_income_for_tax),
        "thue_tncn": float(pit_amount),
        "tax_method": tax_method,
        "so_nguoi_phu_thuoc": dependent_count,
        "thu_nhap_tinh_thue": float(taxable_income),
        "giam_tru_ban_than": float(personal_deduction_applied),
        "giam_tru_nguoi_phu_thuoc": float(dependent_deduction_applied),
        "bao_hiem_bat_buoc": float(insurance_deduction_for_tax),
        "cong_doan": float(union_fee),
        "tam_ung": float(advance_amount),
        "luong_thuc_linh": float(net_salary),
        "con_phai_thanh_toan": float(con_phai_thanh_toan),
        "year": year,
        "month": month,
    }


def get_salary_rows(year: int, month: int, department_id=None, legal_entity: str = '', employee_code=None) -> dict:
    """Bảng lương tháng — đúng dữ liệu GET /hrm/salary/department/ trả về."""
    legal_entity = (legal_entity or '').strip()
    employees = resolve_salary_employees(year, month, department_id, legal_entity, employee_code)
    department_name = None
    if employees and department_id:
        dept = Department.objects.filter(id=department_id).first()
        department_name = dept.name if dept else None
    results = []
    if employees:
        ctx = build_salary_context(employees, year, month)
        results = [build_salary_row(employee, ctx) for employee in employees]
    return {
        "year": year,
        "month": month,
        "department_id": int(department_id) if department_id else None,
        "legal_entity": legal_entity or None,
        "department_name": department_name,
        "total": len(results),
        "results": results,
    }


class SalaryDepartmentView(APIView):
    """
    GET /hrm/salary/department/
    Query params:
      - year (required)
      - month (required)
      - department_id (optional)
      - legal_entity (optional)
      - employee_code (optional)
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if get_user_role(request.user) != 'admin':
            return Response(
                {'detail': 'Chỉ admin mới có quyền truy cập dữ liệu lương.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            year = int(request.query_params.get("year"))
            month = int(request.query_params.get("month"))
        except (TypeError, ValueError):
            return Response(
                {"error": "year và month là bắt buộc và phải là số nguyên"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(get_salary_rows(
            year,
            month,
            department_id=request.query_params.get("department_id"),
            legal_entity=request.query_params.get("legal_entity") or "",
            employee_code=request.query_params.get("employee_code"),
        ))


# ---------------------------------------------------------------------------
# EXCEL EXPORT
# ---------------------------------------------------------------------------

# Mapping: field → Vietnamese header label
_EXCEL_COLUMNS = [
    ("stt",                    "STT"),
    ("ma_nv",                  "Mã NV"),
    ("ho_va_ten",              "Họ và tên"),
    ("phong_ban",              "Phòng ban"),
    ("vi_tri",                 "Vị trí"),
    ("bac_si",                 "Bác sĩ"),
    ("ngay_bat_dau_lam_viec",  "Ngày bắt đầu LV"),
    ("ngay_ket_thuc_thu_viec", "Ngày KT thử việc"),
    ("ngay_len_chinh_thuc",    "Ngày lên chính thức"),
    ("on_off",                 "ON/OFF"),
    ("trang_thai_lam_viec",    "Tình trạng LV"),
    ("ngay_nghi_viec",         "Ngày nghỉ việc"),
    ("hinh_thuc_lam_viec",     "Hình thức LV (HĐ)"),
    ("cong_thu_viec",          "Công thử việc"),
    ("cong_chinh_thuc",        "Công chính thức"),
    ("co_le",                  "Cỗ lễ"),
    ("cong_thuc_te",           "Công thực tế"),
    ("tong_cong",              "Tổng công"),
    ("tong_phat",              "Tổng phạt"),
    ("tang_ca",                "Tăng ca"),
    ("lam_toi",                "Làm tối"),
    ("truc_toi",               "Trực tối"),
    ("lam_them_gio",           "Làm thêm giờ"),
    ("live",                   "Live"),
    ("phu_cap_gui_xe",         "PC gửi xe"),
    ("lam_viec_online",        "Làm việc online"),
]


def _build_excel(rows: list, year: int, month: int) -> bytes:
    """Build an xlsx workbook from a list of serialized row dicts."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f"Chot cong {month:02d}-{year}"

    header_fill = PatternFill("solid", fgColor="4472C4")
    header_font = Font(bold=True, color="FFFFFF")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin = Side(style="thin")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # Title row
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(_EXCEL_COLUMNS))
    title_cell = ws.cell(row=1, column=1, value=f"BẢNG CHỐT CÔNG THÁNG {month:02d}/{year}")
    title_cell.font = Font(bold=True, size=13)
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 25

    # Header row
    for col_idx, (field, label) in enumerate(_EXCEL_COLUMNS, start=1):
        cell = ws.cell(row=2, column=col_idx, value=label)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = header_align
        cell.border = border
    ws.row_dimensions[2].height = 35

    # Data rows
    for row_idx, rec_data in enumerate(rows, start=1):
        for col_idx, (field, _) in enumerate(_EXCEL_COLUMNS, start=1):
            value = rec_data.get(field)
            cell = ws.cell(row=row_idx + 2, column=col_idx, value=value)
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border

    # Auto-fit column widths (approximate)
    for col_idx, (field, label) in enumerate(_EXCEL_COLUMNS, start=1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = max(len(label) * 1.5, 12)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class WorkFinalizationExportExcelView(APIView):
    """
    GET /hrm/work-finalization/export-excel/
    Query params:
      - year  (required)
      - month (required)
      - employee_code (optional)
      - department_id (optional)

    Xuất file Excel chốt công theo tháng/năm, bao gồm toàn bộ nhân sự active.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        year = request.query_params.get("year")
        month = request.query_params.get("month")
        employee_code = request.query_params.get("employee_code")
        department_id = request.query_params.get("department_id")

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {"error": "year và month là bắt buộc và phải là số nguyên"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Lấy toàn bộ nhân sự active
        employees_qs = Employee.objects.select_related(
            "department", "position"
        ).filter(is_active=True).filter(_active_in_month_q(year, month))

        if employee_code:
            employees_qs = employees_qs.filter(employee_id=employee_code)

        if department_id:
            employees_qs = employees_qs.filter(department_id=department_id)

        employees_qs = employees_qs.order_by("employee_id")

        # Evaluate queryset once to avoid two DB hits
        employees = list(employees_qs)

        # Xây dựng map employee_pk → WorkFinalization record
        employee_pks = [e.pk for e in employees]
        records_map = {
            rec.employee_id: rec
            for rec in WorkFinalization.objects.filter(
                year=year, month=month, employee_id__in=employee_pks
            )
        }

        rows = []
        for idx, employee in enumerate(employees):
            stt = idx + 1
            rec = records_map.get(employee.pk)
            if rec:
                rows.append(_serialize_record(rec, stt=stt))
            else:
                rows.append(_serialize_employee_no_record(employee, year, month, stt=stt))

        xlsx_bytes = _build_excel(rows, year, month)
        filename = f"chot_cong_{month:02d}_{year}.xlsx"
        response = HttpResponse(
            xlsx_bytes,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


# ---------------------------------------------------------------------------
# DETAIL EXPORT: giờ vào/ra + toàn bộ đơn từ theo từng ngày
# ---------------------------------------------------------------------------

# Chỉ lấy đơn Tăng ca và Livestream vào cột "Đơn Từ Trong Ngày" — bỏ qua mọi
# loại khác (giải trình, nghỉ phép, làm việc online, ...). Không hiển thị
# trạng thái duyệt/từ chối, chỉ cần có đơn là liệt kê.
_TIME_REQUEST_LABELS = {
    "overtime": "Tăng ca",
    "live":     "Live",
}

# Loại đơn tính theo số giờ (overtime_hours) — khi không có giờ bắt đầu/kết thúc
# thì hiển thị số giờ thay thế.
_HOURS_BASED_EVENT_TYPES = {"overtime"}


def _fmt_hhmm(t) -> str:
    return str(t)[:5] if t else None


def _build_request_label(ev) -> str:
    """Build 1 dòng mô tả ngắn gọn cho 1 EmployeeEvent Tăng ca/Livestream."""
    d = ev.data or {}
    et = ev.event_type

    if et not in _TIME_REQUEST_LABELS:
        return None

    ci = _fmt_hhmm(ev.check_in)
    co = _fmt_hhmm(ev.check_out)
    hours = ev.overtime_hours if ev.overtime_hours is not None else d.get("hours")

    if et in _HOURS_BASED_EVENT_TYPES:
        # Tăng ca: luôn hiển thị số giờ, kèm giờ bắt đầu/kết thúc nếu có
        if ci or co:
            time_part = f" {ci or '?'}-{co or '?'}"
            if hours is not None:
                time_part += f" ({hours}h)"
        elif hours is not None:
            time_part = f" {hours}h"
        else:
            time_part = ""
    elif ci or co:
        # Live có giờ bắt đầu/kết thúc (1 trong 2 mốc có thể thiếu → hiển thị "?")
        time_part = f" {ci or '?'}-{co or '?'}"
    else:
        # Live tính theo buổi/ca, không có giờ
        sessions = d.get("sessions")
        time_part = f" {sessions} ca" if sessions is not None else ""
    return f"{_TIME_REQUEST_LABELS[et]}{time_part}"


class WorkFinalizationDetailExportView(APIView):
    """
    GET /hrm/work-finalization/export-detail/
    Query params:
      - year, month (required)
      - employee_code, department_id, search (optional — lọc giống WorkFinalizationListView)

    Trả về, với mỗi nhân viên, chi tiết theo TỪNG NGÀY trong tháng: giờ vào,
    giờ ra (từ EmployeeEvent ATTENDANCE), và danh sách toàn bộ đơn từ phát sinh
    trong ngày đó (giải trình, tăng ca, nghỉ phép, làm việc online, ...).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from .event_models import EmployeeEvent

        # Chỉ ADMIN/HR được xuất chi tiết (Trưởng phòng chỉ được XEM trang này).
        if not _is_hr_or_admin(request):
            return Response(
                {"error": "Bạn không có quyền xuất chi tiết chốt công."},
                status=status.HTTP_403_FORBIDDEN,
            )

        year = request.query_params.get("year")
        month = request.query_params.get("month")
        employee_code = request.query_params.get("employee_code")
        department_id = request.query_params.get("department_id")
        department_ids_param = request.query_params.get("department_ids")
        search = request.query_params.get("search")

        try:
            year = int(year)
            month = int(month)
        except (TypeError, ValueError):
            return Response(
                {"error": "year và month là bắt buộc và phải là số nguyên"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        employees_qs = Employee.objects.select_related("department", "position").filter(is_active=True).filter(_active_in_month_q(year, month))
        if employee_code:
            employees_qs = employees_qs.filter(employee_id=employee_code)
        if department_ids_param:
            # Xuất cho nhiều phòng ban cùng lúc: department_ids=1,2,3 (ưu tiên hơn department_id)
            department_ids = [
                int(x) for x in department_ids_param.split(",") if x.strip().isdigit()
            ]
            if department_ids:
                employees_qs = employees_qs.filter(department_id__in=department_ids)
        elif department_id:
            employees_qs = employees_qs.filter(department_id=department_id)
        keyword = (search or "").strip()
        if keyword:
            employees_qs = employees_qs.filter(
                Q(employee_id__icontains=keyword) | Q(full_name__icontains=keyword)
            )
        employees = list(employees_qs.order_by("employee_id"))

        num_days = cal_module.monthrange(year, month)[1]
        start = date(year, month, 1)
        end = date(year, month, num_days)

        results = []
        for employee in employees:
            events = list(
                EmployeeEvent.objects.filter(employee=employee, event_date__range=(start, end))
                .order_by("event_date", "id")
            )
            by_date = defaultdict(list)
            for ev in events:
                by_date[ev.event_date].append(ev)

            days = []
            for day_num in range(1, num_days + 1):
                cur = date(year, month, day_num)
                day_events = by_date.get(cur, [])

                check_in = None
                check_out = None
                for ev in day_events:
                    if ev.event_type != "attendance":
                        continue
                    if ev.check_in and not check_in:
                        check_in = _fmt_hhmm(ev.check_in)
                    if ev.check_out and not check_out:
                        check_out = _fmt_hhmm(ev.check_out)

                requests_list = []
                request_contents = []
                for ev in day_events:
                    label = _build_request_label(ev)
                    if label:
                        requests_list.append(label)
                        content = (ev.notes or (ev.data or {}).get("reason") or "").strip()
                        request_contents.append(content)

                days.append({
                    "date": cur.isoformat(),
                    "day": day_num,
                    "check_in": check_in,
                    "check_out": check_out,
                    "requests": requests_list,
                    "request_contents": request_contents,
                })

            results.append({
                "ma_nv": employee.employee_id,
                "ho_va_ten": employee.full_name,
                "phong_ban": employee.department.name if employee.department else "",
                "vi_tri": employee.position.title if employee.position else "",
                "days": days,
            })

        return Response({
            "year": year,
            "month": month,
            "total": len(results),
            "results": results,
        })

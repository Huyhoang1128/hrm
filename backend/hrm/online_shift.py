"""
Ca online cộng thêm (ShiftConfig.no_attendance_required).

Ca online không có giờ vào / ra: nhân viên chọn ở ô "Ca online thêm" của kế hoạch ca tuần
(WeeklyShiftPlanDay.extra_shift), kế hoạch đã duyệt thì được cộng số công cố định của ca
(fixed_workday, để trống = 0,5) — cộng thêm vào công ca chính cùng ngày, không cần chấm công.

replay_month (main_api) đọc các ngày này rồi phát sự kiện tổng hợp "registered_online_shift"
SAU mọi sự kiện của tháng, để phần "bù đủ công" của đơn giải trình (mục tiêu − công đã có)
không tính nhầm công ca online vào ca chính.
"""
import calendar
import datetime as dt

DEFAULT_ONLINE_WORKDAY = 0.5


def online_shift_workday(shift) -> float:
    return float(shift.fixed_workday) if shift.fixed_workday is not None else DEFAULT_ONLINE_WORKDAY


def approved_online_shifts(employee_id, year, month) -> dict:
    """{ngày: ShiftConfig} — ca online thêm trong kế hoạch ca tuần ĐÃ DUYỆT của tháng."""
    from .shift_plan_models import WeeklyShiftPlan, WeeklyShiftPlanDay

    start = dt.date(year, month, 1)
    end = dt.date(year, month, calendar.monthrange(year, month)[1])
    days = (WeeklyShiftPlanDay.objects
            .filter(plan__employee_id=employee_id, plan__status=WeeklyShiftPlan.Status.APPROVED,
                    date__range=(start, end), extra_shift__isnull=False,
                    extra_shift__no_attendance_required=True)
            .select_related('extra_shift'))
    return {day.date: day.extra_shift for day in days}

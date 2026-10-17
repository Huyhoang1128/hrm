"""
BHXH theo kỳ (employee.SocialInsurancePeriod).

- contribution_levels_for_month(): mức đóng của tháng cho các nhân viên ĐÃ có kỳ đóng
  (tháng không thuộc kỳ nào → 0). Nhân viên chưa có kỳ nào không có trong kết quả — bảng
  lương dùng Employee.social_insurance_contribution_level như trước.
- sync_profile_level(): cập nhật mức đóng "hiện tại" trên hồ sơ theo kỳ của tháng này.
"""
import datetime as dt

from django.utils import timezone


def contribution_levels_for_month(employee_ids, year: int, month: int) -> dict:
    from .models import SocialInsurancePeriod

    month_start = dt.date(year, month, 1)
    levels = {}
    for period in SocialInsurancePeriod.objects.filter(employee_id__in=list(employee_ids)).order_by('from_month'):
        levels.setdefault(period.employee_id, 0)
        if period.from_month <= month_start and (period.to_month is None or period.to_month >= month_start):
            levels[period.employee_id] = period.contribution_level
    return levels


def has_periods(employee) -> bool:
    return bool(employee and employee.pk) and employee.social_insurance_periods.exists()


def sync_profile_level(employee) -> None:
    """Mức đóng trên hồ sơ = mức của kỳ có hiệu lực tháng này (0 nếu đã có kỳ nhưng tháng
    này không đóng). Ghi thẳng bằng update() — không chạy lại logic lưu hồ sơ nhân viên."""
    from .models import Employee

    today = timezone.localdate()
    level = contribution_levels_for_month([employee.pk], today.year, today.month).get(employee.pk)
    if level is not None and employee.social_insurance_contribution_level != level:
        Employee.objects.filter(pk=employee.pk).update(social_insurance_contribution_level=level)
        employee.social_insurance_contribution_level = level

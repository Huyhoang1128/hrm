"""
Chế độ con nhỏ: Admin/HCNS chọn người hưởng (tab "Chế độ con nhỏ" ở Quản lý phân
quyền), mỗi người kèm khoảng ngày và số phút N (mặc định 60). Trong khoảng đó, mỗi
ngày nhân viên được đi muộn tối đa N phút VÀ về sớm tối đa N phút (mỗi chiều riêng)
mà không tính lỗi / phạt; phần vượt N phút tính như bình thường.

Engine (main_api.EmployeeState._child_care_bounds) dời mốc tính đi muộn của ca thêm
N phút và mốc tính về sớm sớm hơn N phút vào những ngày này. Lưu theo khoảng ngày để
tính lại tháng cũ vẫn đúng sau khi đã kết thúc chế độ.
"""
import datetime as dt

from django.db.models import Q

DEFAULT_CHILD_CARE_MINUTES = 60


def child_care_minutes_by_date(employee_id, start_date, end_date) -> dict:
    """{'YYYY-MM-DD': số phút} cho các ngày trong [start_date, end_date] NV đang hưởng."""
    from .models import ChildCareRegime

    if not employee_id:
        return {}
    minutes_by_date = {}
    periods = ChildCareRegime.objects.filter(
        employee_id=employee_id, start_date__lte=end_date,
    ).filter(Q(end_date__isnull=True) | Q(end_date__gte=start_date))
    for period in periods:
        day = max(period.start_date, start_date)
        last = min(period.end_date or end_date, end_date)
        while day <= last:
            minutes_by_date[day.isoformat()] = period.allowance_minutes
            day += dt.timedelta(days=1)
    return minutes_by_date

from django.utils import timezone
from .event_models import EmployeeEvent

def get_all_event_in_month(employee_id, year, month):
    """Lấy tất cả sự kiện của nhân viên trong tháng, bao gồm cả chấm công, nghỉ phép, làm thêm giờ, v.v."""
    start_date = timezone.datetime(year, month, 1).date()
    if month == 12:
        end_date = timezone.datetime(year + 1, 1, 1).date() - timezone.timedelta(days=1)
    else:
        end_date = timezone.datetime(year, month + 1, 1).date() - timezone.timedelta(days=1)
    
    events = EmployeeEvent.objects.filter(
        employee_id=employee_id,
        event_date__range=(start_date, end_date)
    ).order_by('event_date', 'created_at')
    
    return events



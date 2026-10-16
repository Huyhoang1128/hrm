
import datetime

from django.db import models
from .event_models import EmployeeEvent
from .models import CompanyConfig
from .constant import ExplanationType

def _get_quota_used(employee, date):
    """Tính số lượng quota giải trình đã sử dụng trong tháng."""
    if not date: return 0
    # Chỉ đếm những đơn đã về trạng thái APPROVED (Duyệt xong bước cuối)
    # Các loại đơn bị tính vào Quota: Đi muộn, Về sớm, Đi muộn/Về sớm, Quên chấm công
    quota_types = [
        ExplanationType.LATE,
        ExplanationType.EARLY_LEAVE,
        ExplanationType.LATE_EARLY,
        ExplanationType.INCOMPLETE_ATTENDANCE
    ]
    return EmployeeEvent.objects.filter(
        employee=employee,
        event_type=EmployeeEvent.EventType.EXPLANATION,
        event_date__year=date.year,
        event_date__month=date.month,
        data__status='APPROVED',
        data__explanation_type__in=quota_types
    ).distinct().count()




def _get_quota_remaining(employee, date):
    """Tính số lượng quota giải trình còn lại trong tháng."""
    if not date: return 3
    used = _get_quota_used(employee, date)
    company_config = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
    max_quota = company_config.max_explanation_count_per_month if company_config else 3
    return max(0, max_quota - used)

def online_quota_amount(employee, event_date, data) -> float:
    """Số ngày mà 1 đơn làm việc online TÍNH VÀO hạn mức online/tháng.

    Mặc định: nửa ngày 0.5, cả ngày 1.0. Phòng ban bật cờ
    Department.online_weekend_unlimited (vd Kế toán, chốt 2026-10-02) thì phần
    rơi vào buổi chiều thứ 7 tuần 2/4 và ngày Chủ nhật KHÔNG tính:
      - Chủ nhật: 0.
      - Thứ 7 tuần 2/4: buổi chiều 0; cả ngày 0.5 (chỉ buổi sáng tính); buổi
        sáng 0.5 như thường. Nếu nhân viên/phòng ban làm chiều thứ 7 mọi tuần
        (saturday_afternoon_always_workday) thì chiều thứ 7 là giờ làm bình
        thường -> không miễn.
    Dùng chung cho đếm số đã dùng, duyệt lẻ, duyệt hàng loạt và phần hiển thị
    "còn lại" — để các nơi không bao giờ lệch nhau.
    """
    data = data or {}
    base = 0.5 if data.get('expected_status') == 'HALF_DAY' else 1.0
    if not (event_date and employee is not None):
        return base
    weekday = event_date.weekday()
    half_saturday = weekday == 5 and (event_date.day - 1) // 7 + 1 in (2, 4)
    if weekday != 6 and not half_saturday:
        return base  # ngày thường — khỏi tra lịch
    # Phòng ban + cờ lịch tra theo NGÀY của đơn (employee/schedule.py) — lịch phòng
    # ban đổi giữa tháng / NV chuyển phòng thì đơn trước đó vẫn theo lịch cũ.
    from employee.schedule import ScheduleResolver
    schedule = ScheduleResolver()
    dept = schedule.department_on(employee, event_date)
    if not dept:
        return base
    if not schedule.flag(dept, 'online_weekend_unlimited', event_date):
        return base
    if weekday == 6:
        return 0.0
    if half_saturday:
        if schedule.saturday_afternoon_workday(employee, event_date):
            return base
        from .registration_views import _resolve_online_work_half
        half = _resolve_online_work_half(data)
        if half == 'AFTERNOON':
            return 0.0
        return 0.5
    return base


def _get_online_work_used(employee, date):
    """Tính số ngày làm online đã duyệt trong tháng (theo online_quota_amount)."""
    if not date: return 0
    events = EmployeeEvent.objects.filter(
        employee=employee,
        event_type=EmployeeEvent.EventType.ONLINE_WORK,
        event_date__year=date.year,
        event_date__month=date.month,
        data__status='APPROVED'
    )
    return sum(online_quota_amount(employee, e.event_date, e.data) for e in events)

def _get_registrations_used(employee, date):
    """Tính số đơn đăng ký (OT, Live...) đã duyệt trong tháng từ EmployeeEvent."""
    if not date: return 0
    return EmployeeEvent.objects.filter(
        employee=employee,
        event_type__in=[
            EmployeeEvent.EventType.OVERTIME, 
            EmployeeEvent.EventType.LIVESTREAM
        ],
        event_date__year=date.year,
        event_date__month=date.month,
        data__status='APPROVED'
    ).count()

def _get_leave_used(employee, date):
    """Tính số đơn nghỉ phép tháng đã duyệt."""
    if not date: return 0
    events = EmployeeEvent.objects.filter(
        employee=employee,
        event_type=EmployeeEvent.EventType.EXPLANATION,
        event_date__year=date.year,
        event_date__month=date.month,
        data__explanation_type=ExplanationType.LEAVE,
        data__status='APPROVED'
    )
    total = 0
    for e in events:
        if e.data and e.data.get('expected_status') == 'HALF_DAY':
            total += 0.5
        else:
            total += 1
    return total

def get_max_online_work_quota(employee, company_config=None) -> float:
    """Hạn mức số ngày làm online tối đa/tháng của nhân viên: ghi đè theo nhân viên >
    vị trí > phòng ban (OnlineWorkQuotaOverride) > CompanyConfig (mặc định 3)."""
    if employee is not None:
        for scope in (employee, getattr(employee, 'position', None), getattr(employee, 'department', None)):
            override = getattr(scope, 'online_work_quota_override', None) if scope is not None else None
            if override is not None:
                return float(override.max_online_days)
    if company_config is None:
        company_config = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
    return float(company_config.max_online_work_count_per_month) if company_config else 3.0


def get_employee_monthly_stats(employee, date, company_config=None):
    """Trả về dict chứa toàn bộ thống kê quota/số lần duyệt của nhân viên trong tháng.

    `company_config`: truyền sẵn nếu caller đã tự fetch (vd batch_get_employee_monthly_stats
    bên dưới) để khỏi query lại — mặc định tự fetch nếu không truyền, giữ
    nguyên hành vi cũ cho các lời gọi đơn lẻ hiện có.
    """
    if company_config is None:
        company_config = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
    max_quota = company_config.max_explanation_count_per_month if company_config else 3
    max_online_quota = get_max_online_work_quota(employee, company_config)
    max_leave_quota = float(company_config.max_leave_count_per_month) if company_config else 1.0

    # Tính quota_used 1 LẦN rồi suy ra quota_remaining trực tiếp — trước đây
    # _get_quota_remaining() tự gọi lại _get_quota_used() (query trùng) VÀ tự
    # fetch lại CompanyConfig (query trùng thứ 2), nhân đôi số query không cần
    # thiết cho MỌI lời gọi hàm này (kể cả đơn lẻ).
    quota_used = _get_quota_used(employee, date)
    quota_remaining = max(0, max_quota - quota_used) if date else 3

    return {
        'quota_used': quota_used,
        'quota_remaining': quota_remaining,
        'max_explanation_quota': max_quota,
        'online_work_used': _get_online_work_used(employee, date),
        'max_online_quota': max_online_quota,
        'leave_used': _get_leave_used(employee, date),
        'max_leave_quota': max_leave_quota,
        'registrations_used': _get_registrations_used(employee, date),
    }


def batch_get_employee_monthly_stats(items):
    """Tính get_employee_monthly_stats() cho MỘT LOẠT (employee, date) cùng
    lúc, chỉ tính 1 LẦN cho mỗi cặp (employee_id, năm, tháng) DUY NHẤT — dùng
    cho danh sách nhiều đơn (vd /api-hrm/duyet-don/) để tránh N+1: trước đây
    gọi get_employee_monthly_stats() riêng cho TỪNG đơn (~5-7 query DB/lần,
    không cache), dù 1 nhân viên có NHIỀU đơn trong cùng tháng vẫn tính lại y
    hệt nhiều lần — với vài trăm đơn/tháng (thực tế đã xảy ra, gây trang Phê
    duyệt load cực chậm/treo) sẽ ra hàng nghìn query dư thừa.

    items: iterable các (employee, date) — employee/date None sẽ bị bỏ qua.
    Trả về dict {(employee_id, year, month): stats_dict}; lookup theo đúng
    key này khi serialize từng item.
    """
    company_config = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()

    unique: dict = {}
    for employee, date in items:
        if not employee or not date:
            continue
        key = (employee.id, date.year, date.month)
        if key not in unique:
            unique[key] = employee

    return {
        key: get_employee_monthly_stats(employee, datetime.date(key[1], key[2], 1), company_config=company_config)
        for key, employee in unique.items()
    }

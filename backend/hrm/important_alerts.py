"""
Màn "Cảnh báo quan trọng" — hiện ngay khi Admin / HR đăng nhập hoặc mở HRM.

Hai loại cảnh báo:
- Hợp đồng sắp hết hạn: `Employee.contract_end_date` trong vòng CONTRACT_ALERT_DAYS
  ngày tới, kèm cả hợp đồng ĐÃ quá hạn mà chưa có hợp đồng mới (ký hợp đồng mới thì
  `contract_end_date` được đồng bộ lại nên người đó tự rời danh sách). Dùng trường
  trên hồ sơ chứ không chỉ bảng EmployeeContract: hồ sơ import từ trước không có dòng
  EmployeeContract nào.
- Sắp đến hạn đóng BHXH: công ty đóng BHXH sau khi hết INSURANCE_PROBATION_MONTHS
  tháng đầu làm việc, báo trước INSURANCE_ALERT_DAYS ngày. Đã ghi nhận đang tham gia
  BHXH (trạng thái hoặc ngày bắt đầu tham gia trên hồ sơ) thì không cảnh báo nữa. Người đã quá hạn mà vẫn chưa có hồ sơ chỉ giữ lại
  INSURANCE_OVERDUE_DAYS ngày, để danh sách không ngập người cũ chưa từng nhập BHXH.
"""
import datetime as _dt

from dateutil.relativedelta import relativedelta
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from employee.models import CONTRACT_TYPE, Employee

# Các ngưỡng cấu hình qua settings / biến môi trường (xem .env.example).
CONTRACT_ALERT_DAYS = getattr(settings, 'IMPORTANT_ALERT_CONTRACT_DAYS', 15)
INSURANCE_PROBATION_MONTHS = getattr(settings, 'IMPORTANT_ALERT_INSURANCE_AFTER_MONTHS', 2)
INSURANCE_ALERT_DAYS = getattr(settings, 'IMPORTANT_ALERT_INSURANCE_DAYS', 10)
INSURANCE_OVERDUE_DAYS = getattr(settings, 'IMPORTANT_ALERT_INSURANCE_OVERDUE_DAYS', 30)

# Hợp đồng không có ngày hết hạn thật.
_NO_EXPIRY_CONTRACT_TYPES = ('INDEFINITE',)
# Không thuộc diện đóng BHXH bắt buộc.
_NO_INSURANCE_CONTRACT_TYPES = ('COLLABORATOR', 'SERVICE', 'INTERN')
_CONTRACT_TYPE_LABELS = dict(CONTRACT_TYPE)


def _alert_population(today):
    """Người còn làm việc (kể cả tạm nghỉ / tạm dừng) — hợp đồng của họ vẫn phải theo dõi."""
    return (
        Employee.objects.filter(is_active=True)
        .exclude(employment_status='INACTIVE')
        .filter(Q(end_date__isnull=True) | Q(end_date__gt=today))
        .select_related('department', 'position', 'company_unit')
    )


def _employee_info(employee):
    return {
        'id': employee.id,
        'employee_code': employee.employee_id,
        'full_name': employee.full_name,
        'department': employee.department.name if employee.department_id else '',
        'position': employee.position.title if employee.position_id else '',
        # Pháp nhân = đơn vị làm việc của nhân viên (mã + tên đầy đủ).
        'legal_entity': employee.company_unit.code if employee.company_unit_id else '',
        'legal_entity_name': employee.company_unit.name if employee.company_unit_id else '',
        'contract_type': employee.contract_type or '',
        'contract_type_display': _CONTRACT_TYPE_LABELS.get(employee.contract_type, employee.contract_type or ''),
    }


def contract_alerts(today):
    limit = today + _dt.timedelta(days=CONTRACT_ALERT_DAYS)
    rows = []
    qs = (
        _alert_population(today)
        .filter(contract_end_date__isnull=False, contract_end_date__lte=limit)
        .exclude(contract_type__in=_NO_EXPIRY_CONTRACT_TYPES)
        .order_by('contract_end_date', 'employee_id')
    )
    for employee in qs:
        days_left = (employee.contract_end_date - today).days
        rows.append({
            **_employee_info(employee),
            'contract_end_date': employee.contract_end_date.isoformat(),
            'days_left': days_left,
            'status': 'EXPIRED' if days_left < 0 else 'EXPIRING',
        })
    return rows


def insurance_due_date(start_date):
    return start_date + relativedelta(months=INSURANCE_PROBATION_MONTHS)


def insurance_alerts(today):
    window_start = today - _dt.timedelta(days=INSURANCE_OVERDUE_DAYS)
    window_end = today + _dt.timedelta(days=INSURANCE_ALERT_DAYS)
    # Lọc thô theo ngày vào làm (nới 3 ngày cho tháng ngắn/dài), lọc chính xác bên dưới.
    start_from = window_start - relativedelta(months=INSURANCE_PROBATION_MONTHS) - _dt.timedelta(days=3)
    start_to = window_end - relativedelta(months=INSURANCE_PROBATION_MONTHS) + _dt.timedelta(days=3)
    qs = (
        _alert_population(today)
        .filter(start_date__isnull=False, start_date__range=(start_from, start_to))
        .exclude(contract_type__in=_NO_INSURANCE_CONTRACT_TYPES)
        .exclude(social_insurance_participation_status='PARTICIPATING')
        .filter(social_insurance_start_date__isnull=True)
    )
    rows = []
    for employee in qs:
        due = insurance_due_date(employee.start_date)
        if not (window_start <= due <= window_end):
            continue
        days_left = (due - today).days
        rows.append({
            **_employee_info(employee),
            'start_date': employee.start_date.isoformat(),
            'due_date': due.isoformat(),
            'days_left': days_left,
            'status': 'OVERDUE' if days_left < 0 else 'UPCOMING',
        })
    rows.sort(key=lambda r: (r['due_date'], r['employee_code']))
    return rows


def build_important_alerts(today=None) -> dict:
    today = today or timezone.localdate()
    contracts = contract_alerts(today)
    insurance = insurance_alerts(today)
    return {
        'today': today.isoformat(),
        'rules': {
            'contract_alert_days': CONTRACT_ALERT_DAYS,
            'insurance_probation_months': INSURANCE_PROBATION_MONTHS,
            'insurance_alert_days': INSURANCE_ALERT_DAYS,
            'insurance_overdue_days': INSURANCE_OVERDUE_DAYS,
        },
        'contracts': contracts,
        'insurance': insurance,
        'counts': {
            'contracts_expiring': sum(1 for r in contracts if r['status'] == 'EXPIRING'),
            'contracts_expired': sum(1 for r in contracts if r['status'] == 'EXPIRED'),
            'insurance_upcoming': sum(1 for r in insurance if r['status'] == 'UPCOMING'),
            'insurance_overdue': sum(1 for r in insurance if r['status'] == 'OVERDUE'),
            'total': len(contracts) + len(insurance),
        },
    }

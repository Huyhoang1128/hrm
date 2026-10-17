"""
Hạn mức giải trình chấm công.

Hai chế độ (CompanyConfig.explanation_quota_mode):
- COMBINED (mặc định, như trước): mọi loại Đi muộn / Về sớm / Đi muộn-Về sớm / Quên chấm
  công dùng chung 1 hạn mức max_explanation_count_per_month lượt/tháng.
- PER_TYPE: mỗi "giỏ" một hạn mức riêng — Đi muộn (gồm Đi muộn-Về sớm), Về sớm, Quên chấm
  công. Nhân viên trong ManagerExplanationQuotaConfig dùng 1 rổ gộp chung cho mọi loại
  (manager_combined_explanation_quota lượt/tháng).

Chỉ đếm đơn ĐÃ DUYỆT. Lỗi máy chấm công, Công tác, Ngày đầu đi làm… không tính hạn mức.
Mọi nơi đếm / kiểm tra hạn mức (duyệt đơn, duyệt hàng loạt, engine, thống kê, lịch,
danh sách phê duyệt, xếp hạng) đọc qua module này để không lệch nhau.
"""
from collections import defaultdict

from .constant import ExplanationType

COMBINED = 'COMBINED'
PER_TYPE = 'PER_TYPE'
BUCKETS = (ExplanationType.LATE, ExplanationType.EARLY_LEAVE, ExplanationType.INCOMPLETE_ATTENDANCE)
BUCKET_LABELS = {
    ExplanationType.LATE: 'Đi muộn',
    ExplanationType.EARLY_LEAVE: 'Về sớm',
    ExplanationType.INCOMPLETE_ATTENDANCE: 'Quên chấm công',
}
# Loại đơn → giỏ hạn mức. 'FORGOT' là tên cũ của Quên chấm công trong engine.
BUCKET_OF = {
    ExplanationType.LATE: ExplanationType.LATE,
    ExplanationType.LATE_EARLY: ExplanationType.LATE,
    ExplanationType.EARLY_LEAVE: ExplanationType.EARLY_LEAVE,
    ExplanationType.INCOMPLETE_ATTENDANCE: ExplanationType.INCOMPLETE_ATTENDANCE,
    'FORGOT': ExplanationType.INCOMPLETE_ATTENDANCE,
}
QUOTA_TYPES = [ExplanationType.LATE, ExplanationType.EARLY_LEAVE, ExplanationType.LATE_EARLY,
               ExplanationType.INCOMPLETE_ATTENDANCE]


def active_company_config():
    from .models import CompanyConfig
    return CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()


def quota_rules(employee_id, company_config=None, manager_ids=None) -> dict:
    """{'mode', 'is_manager_combined_quota', 'combined_max' (giỏ chung hoặc None),
    'limits' ({giỏ: n} khi tính theo từng loại, ngược lại None)}."""
    from .explanation_quota_models import ManagerExplanationQuotaConfig

    cfg = company_config if company_config is not None else active_company_config()
    combined_max = cfg.max_explanation_count_per_month if cfg else 3
    if not cfg or getattr(cfg, 'explanation_quota_mode', COMBINED) != PER_TYPE:
        return {'mode': COMBINED, 'is_manager_combined_quota': False, 'combined_max': combined_max, 'limits': None}
    if manager_ids is None:
        manager_ids = ManagerExplanationQuotaConfig.eligible_ids()
    if employee_id in manager_ids:
        return {'mode': PER_TYPE, 'is_manager_combined_quota': True,
                'combined_max': cfg.manager_combined_explanation_quota, 'limits': None}
    return {'mode': PER_TYPE, 'is_manager_combined_quota': False, 'combined_max': None, 'limits': {
        ExplanationType.LATE: cfg.max_late_explanation_per_month,
        ExplanationType.EARLY_LEAVE: cfg.max_early_leave_explanation_per_month,
        ExplanationType.INCOMPLETE_ATTENDANCE: cfg.max_incomplete_attendance_explanation_per_month,
    }}


def approved_counts(employee_ids, year: int, month: int) -> dict:
    """{employee_id: {giỏ: số đơn đã duyệt}} trong tháng (1 query)."""
    from django.db.models import Count
    from .event_models import EmployeeEvent

    rows = (EmployeeEvent.objects
            .filter(employee_id__in=list(employee_ids), event_type=EmployeeEvent.EventType.EXPLANATION,
                    event_date__year=year, event_date__month=month, data__status='APPROVED',
                    data__explanation_type__in=QUOTA_TYPES)
            .values('employee_id', 'data__explanation_type').annotate(n=Count('id')))
    counts = defaultdict(lambda: dict.fromkeys(BUCKETS, 0))
    for row in rows:
        counts[row['employee_id']][BUCKET_OF[row['data__explanation_type']]] += row['n']
    return counts


def _entry(used, max_):
    return {'used': used, 'max': max_, 'remaining': max(0, max_ - used)}


def build_status(rules: dict, counts: dict) -> dict:
    total = sum(counts.values())
    if rules['limits'] is None:   # 1 giỏ chung (COMBINED hoặc rổ gộp)
        combined = _entry(total, rules['combined_max'])
        by_type = {bucket: dict(combined) for bucket in BUCKETS}
        shared = True
    else:
        by_type = {bucket: _entry(counts[bucket], rules['limits'][bucket]) for bucket in BUCKETS}
        combined = {'used': total, 'max': sum(v['max'] for v in by_type.values()),
                    'remaining': sum(v['remaining'] for v in by_type.values())}
        shared = False
    return {'mode': rules['mode'], 'is_manager_combined_quota': rules['is_manager_combined_quota'],
            'shared': shared, 'combined': combined, 'by_type': by_type}


def explanation_quota_status(employee, date, company_config=None) -> dict:
    """Hạn mức giải trình của nhân viên trong tháng của `date`: tổng (combined) và theo giỏ
    (by_type). shared=True nghĩa là mọi loại dùng chung 1 giỏ (by_type giống nhau)."""
    employee_id = getattr(employee, 'pk', employee)
    rules = quota_rules(employee_id, company_config)
    counts = approved_counts([employee_id], date.year, date.month)[employee_id] if date else dict.fromkeys(BUCKETS, 0)
    return build_status(rules, counts)


def bucket_entry(status: dict, explanation_type):
    """Hạn mức của giỏ chứa `explanation_type` (None nếu loại này không tính hạn mức)."""
    bucket = BUCKET_OF.get(str(explanation_type or '').upper())
    return status['by_type'][bucket] if bucket else None


def remaining_map(employee_ids, year: int, month: int, company_config=None) -> dict:
    """{employee_id: số lượt còn lại (tổng các giỏ)} cho nhiều nhân viên, ít query."""
    from .explanation_quota_models import ManagerExplanationQuotaConfig

    cfg = company_config if company_config is not None else active_company_config()
    manager_ids = ManagerExplanationQuotaConfig.eligible_ids()
    counts = approved_counts(employee_ids, year, month)
    return {
        employee_id: build_status(quota_rules(employee_id, cfg, manager_ids), counts[employee_id])['combined']['remaining']
        for employee_id in employee_ids
    }

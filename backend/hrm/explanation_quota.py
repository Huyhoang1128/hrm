"""
Hạn mức giải trình chấm công.

Hai chế độ (CompanyConfig.explanation_quota_mode):
- COMBINED (mặc định, như trước): mọi loại Đi muộn / Về sớm / Đi muộn-Về sớm / Quên chấm
  công dùng chung 1 hạn mức max_explanation_count_per_month lượt/tháng.
- PER_TYPE: mỗi "giỏ" một hạn mức riêng — Đi muộn (gồm Đi muộn-Về sớm), Về sớm, Quên chấm
  công. Nhân viên trong ManagerExplanationQuotaConfig dùng 1 rổ gộp chung cho mọi loại
  (manager_combined_explanation_quota lượt/tháng); nếu có manager_incomplete_explanation_quota
  thì Quên chấm công tách rổ riêng, rổ gộp chỉ còn Đi muộn + Về sớm.

"Rổ" (pool) = 1 hay nhiều giỏ dùng chung 1 hạn mức: quota_rules() trả 'pools' ({rổ: hạn mức})
và 'pool_of' ({giỏ: rổ}); build_status() trả thêm 'groups' (nhãn, loại đơn, used/max) để giao
diện hiển thị đúng rổ, không tự đoán loại nào gộp với loại nào.

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

# Rổ: ALL = mọi giỏ chung 1 hạn mức; LATE_EARLY = Đi muộn + Về sớm; còn lại tên rổ = tên giỏ.
POOL_ALL = 'ALL'
POOL_LATE_EARLY = 'LATE_EARLY'
POOL_LABELS = {POOL_ALL: 'Giải trình', POOL_LATE_EARLY: 'Đi muộn/Về sớm', **BUCKET_LABELS}
_ALL_IN_ONE = {bucket: POOL_ALL for bucket in BUCKETS}
_ONE_EACH = {bucket: bucket for bucket in BUCKETS}
_LATE_EARLY_SPLIT = {
    ExplanationType.LATE: POOL_LATE_EARLY,
    ExplanationType.EARLY_LEAVE: POOL_LATE_EARLY,
    ExplanationType.INCOMPLETE_ATTENDANCE: ExplanationType.INCOMPLETE_ATTENDANCE,
}


def active_company_config():
    from .models import CompanyConfig
    return CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()


def _rules(mode, is_manager, pools, pool_of) -> dict:
    return {
        'mode': mode, 'is_manager_combined_quota': is_manager, 'pools': pools, 'pool_of': pool_of,
        # Tương thích chỗ cũ: 1 rổ chung -> combined_max; mỗi giỏ 1 rổ -> limits.
        'combined_max': pools[POOL_ALL] if list(pools) == [POOL_ALL] else None,
        'limits': dict(pools) if pool_of == _ONE_EACH else None,
    }


def quota_rules(employee_id, company_config=None, manager_ids=None) -> dict:
    """{'mode', 'is_manager_combined_quota', 'pools' ({rổ: hạn mức}), 'pool_of' ({giỏ: rổ}),
    'combined_max' (khi chỉ có 1 rổ chung, ngược lại None), 'limits' ({giỏ: n} khi mỗi giỏ 1 rổ,
    ngược lại None)}."""
    from .explanation_quota_models import ManagerExplanationQuotaConfig

    cfg = company_config if company_config is not None else active_company_config()
    if not cfg or getattr(cfg, 'explanation_quota_mode', COMBINED) != PER_TYPE:
        combined_max = cfg.max_explanation_count_per_month if cfg else 3
        return _rules(COMBINED, False, {POOL_ALL: combined_max}, _ALL_IN_ONE)
    if manager_ids is None:
        manager_ids = ManagerExplanationQuotaConfig.eligible_ids()
    if employee_id in manager_ids:
        incomplete_max = getattr(cfg, 'manager_incomplete_explanation_quota', None)
        if incomplete_max is None:
            return _rules(PER_TYPE, True, {POOL_ALL: cfg.manager_combined_explanation_quota}, _ALL_IN_ONE)
        return _rules(PER_TYPE, True, {
            POOL_LATE_EARLY: cfg.manager_combined_explanation_quota,
            ExplanationType.INCOMPLETE_ATTENDANCE: incomplete_max,
        }, _LATE_EARLY_SPLIT)
    return _rules(PER_TYPE, False, {
        ExplanationType.LATE: cfg.max_late_explanation_per_month,
        ExplanationType.EARLY_LEAVE: cfg.max_early_leave_explanation_per_month,
        ExplanationType.INCOMPLETE_ATTENDANCE: cfg.max_incomplete_attendance_explanation_per_month,
    }, _ONE_EACH)


def pool_key(rules: dict, explanation_type):
    """Rổ chứa loại đơn `explanation_type` (None nếu loại này không tính hạn mức)."""
    bucket = BUCKET_OF.get(str(explanation_type or '').upper())
    return rules['pool_of'][bucket] if bucket else None


def pool_max(rules: dict, explanation_type):
    """Hạn mức của rổ chứa `explanation_type` (None nếu không tính hạn mức)."""
    key = pool_key(rules, explanation_type)
    return rules['pools'][key] if key else None


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
    """shared=True: mọi loại chung 1 rổ. by_type[giỏ] = số của RỔ chứa giỏ đó (các giỏ cùng rổ
    có cùng số). groups: danh sách rổ để hiển thị — key, label, types (loại đơn), used/max/remaining."""
    pools, pool_of = rules['pools'], rules['pool_of']
    entries = {
        key: _entry(sum(counts[b] for b in BUCKETS if pool_of[b] == key), max_)
        for key, max_ in pools.items()
    }
    by_type = {bucket: dict(entries[pool_of[bucket]]) for bucket in BUCKETS}
    shared = len(pools) == 1
    if shared:
        combined = dict(next(iter(entries.values())))
    else:
        combined = {'used': sum(e['used'] for e in entries.values()),
                    'max': sum(e['max'] for e in entries.values()),
                    'remaining': sum(e['remaining'] for e in entries.values())}
    groups = [
        {'key': key, 'label': POOL_LABELS[key],
         'types': [t for t in QUOTA_TYPES if pool_of[BUCKET_OF[t]] == key], **entries[key]}
        for key in pools
    ]
    return {'mode': rules['mode'], 'is_manager_combined_quota': rules['is_manager_combined_quota'],
            'shared': shared, 'combined': combined, 'by_type': by_type, 'groups': groups}


def explanation_quota_status(employee, date, company_config=None) -> dict:
    """Hạn mức giải trình của nhân viên trong tháng của `date`: tổng (combined) và theo giỏ
    (by_type). shared=True nghĩa là mọi loại dùng chung 1 giỏ (by_type giống nhau)."""
    employee_id = getattr(employee, 'pk', employee)
    rules = quota_rules(employee_id, company_config)
    counts = approved_counts([employee_id], date.year, date.month)[employee_id] if date else dict.fromkeys(BUCKETS, 0)
    return build_status(rules, counts)


def bucket_entry(status: dict, explanation_type):
    """Hạn mức của RỔ chứa `explanation_type` (None nếu loại này không tính hạn mức)."""
    bucket = BUCKET_OF.get(str(explanation_type or '').upper())
    return status['by_type'][bucket] if bucket else None


def group_entry(status: dict, explanation_type):
    """Phần tử của status['groups'] (có nhãn rổ) chứa `explanation_type`, hoặc None."""
    explanation_type = str(explanation_type or '').upper()
    return next((g for g in status.get('groups', []) if explanation_type in g['types']), None)


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

"""
Phạt thiếu công (salary.MissingWorkdayPenalty): nhân viên trong danh sách không đi
đủ công chuẩn của tháng thì bị trừ trên bảng lương
    phạt = mốc lương / công chuẩn × số công thiếu
    số công thiếu = công chuẩn − tổng công chốt (không âm)
VD công chuẩn 26, tổng công 24, mốc 10.000.000 → 10.000.000 / 26 × 2 = 769.231đ.

Công chuẩn là công chuẩn của bảng lương (finalization_views._get_salary_standard_work_days);
tổng công là tổng công của bản chốt công (gồm nghỉ phép có lương, lễ).
"""
import datetime as dt
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Q


def active_penalty_bases(employee_ids, year: int, month: int) -> dict:
    """{employee_id: mốc lương} của các NV đang trong danh sách phạt ở tháng year/month."""
    from .salary_data_models import MissingWorkdayPenalty

    month_start = dt.date(year, month, 1)
    rows = MissingWorkdayPenalty.objects.filter(
        employee_id__in=list(employee_ids), from_month__lte=month_start,
    ).filter(Q(to_month__isnull=True) | Q(to_month__gte=month_start))
    return {row.employee_id: Decimal(row.base_amount) for row in rows}


def compute_missing_workday_penalty(base_amount, standard_work_days, total_work_days) -> tuple:
    """(số công thiếu, tiền phạt làm tròn đồng) — đều là Decimal."""
    standard = Decimal(str(standard_work_days or 0))
    if standard <= 0:
        return Decimal('0'), Decimal('0')
    missing = max(standard - Decimal(str(total_work_days or 0)), Decimal('0'))
    penalty = (Decimal(base_amount) / standard * missing).quantize(Decimal('1'), rounding=ROUND_HALF_UP)
    return missing, penalty

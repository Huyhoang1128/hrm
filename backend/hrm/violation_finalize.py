"""Chốt tháng: biến dòng phạt trên trang đối soát thành biên bản phạt bên lương.

HCNS 2026-10-12: *"chức năng phạt này cuối tháng bạn cho 1 cái chốt để gửi
về làm biên bản phạt được ko?"*. Trước đó hai cơ chế chạy song song mà không
nối nhau: trang đối soát kết luận "người này bị phạt 500k" nhưng **không có
đường nào thu tiền**, còn `salary.DisciplinaryPenalty` (trừ thẳng vào lương qua
`salary_engine`) thì bỏ không dùng từ 01/08/2026.

Hai quyết định của HCNS, cả hai đều nằm trong code bên dưới:

1. **Biên bản sinh ra ở trạng thái APPROVED luôn.** Trang đối soát CHÍNH LÀ
   bước rà soát — HCNS đã xem từng dòng và đã áp/gỡ phạt tay trước khi chốt.
   Bắt duyệt thêm một vòng nữa chính là thứ đang làm kẹt 9 biên bản tháng 6
   suốt 3 tháng (1.550.000 đ chưa hề bị trừ).
2. **Chốt lại chỉ THÊM cái thiếu, không đụng cái cũ.** Ràng buộc unique trên
   ViolationPenaltyIssue bảo đảm ở tầng CSDL, không phụ thuộc code nhớ kiểm.

Thông báo: cố ý KHÔNG đi qua `DisciplinaryPenaltyViewSet.perform_create` (nó
bắn 2 thông báo mỗi bản ghi — chốt tháng 9 sẽ ra 294 thông báo, đúng mớ rác mà
HCNS vừa phàn nàn). Ở đây gộp mỗi người 1 thông báo, và vì biên bản đã
APPROVED nên không có thông báo "cần duyệt" nào bắn cho quản lý.
"""
import datetime as _dt
import logging
from collections import defaultdict

from django.db import transaction
from django.utils import timezone

from .violation_models import ViolationPenaltyIssue

logger = logging.getLogger(__name__)


def _charged_rows(year, month):
    """Các dòng RA TIỀN của tháng, đã tính đủ gộp đơn/gộp ngày và quyết định tay."""
    from .violation_report_views import LeaveViolationReportView, _month_range

    first, last = _month_range(year, month)
    rows = LeaveViolationReportView().compute_rows(first, last)
    return [r for r in rows
            if (r.get("penalty_amount") or 0) > 0 and r.get("responsible_id")]


def _key(row):
    d = row.get("event_date")
    if not isinstance(d, _dt.date):
        d = _dt.date.fromisoformat(str(d)[:10])
    return (row["employee_id"], d, row.get("violation_code"), row.get("fault_side"))


def preview_finalize(year, month):
    """Chốt tháng này sẽ tạo bao nhiêu biên bản, bao nhiêu tiền — KHÔNG ghi gì.

    Để giao diện hỏi lại trước khi bấm, vì đây là thao tác trừ tiền thật.
    """
    rows = _charged_rows(year, month)
    done = {
        (i.employee_id, i.event_date, i.violation_code, i.fault_side)
        for i in ViolationPenaltyIssue.objects.filter(year=year, month=month)
    }
    new = [r for r in rows if _key(r) not in done]
    by_person = defaultdict(lambda: {"count": 0, "amount": 0})
    for r in new:
        p = by_person[r["responsible_id"]]
        p["count"] += 1
        p["amount"] += r["penalty_amount"]
    return {
        "year": year, "month": month,
        "charged_rows": len(rows),
        "already_issued": len(rows) - len(new),
        "to_create": len(new),
        "people": len(by_person),
        "total_amount": sum(r["penalty_amount"] for r in new),
    }


@transaction.atomic
def finalize_month(year, month, *, actor=None):
    """Tạo biên bản phạt cho mọi dòng ra tiền CHƯA được chốt của tháng."""
    from salary.salary_data_models import DisciplinaryPenalty

    rows = _charged_rows(year, month)
    done = {
        (i.employee_id, i.event_date, i.violation_code, i.fault_side)
        for i in ViolationPenaltyIssue.objects.filter(year=year, month=month)
    }
    new_rows = [r for r in rows if _key(r) not in done]

    now = timezone.now()
    created = []
    by_person = defaultdict(list)

    for r in new_rows:
        emp_id, event_date, code, side = _key(r)
        from .violation_report_views import VIOLATION_LABEL
        label = VIOLATION_LABEL.get(code, code)
        reason = (f"Vi phạm đơn từ ngày {event_date:%d/%m/%Y}: {label}. "
                  f"Chốt từ trang Đối soát vi phạm đơn từ.")
        dp = DisciplinaryPenalty.objects.create(
            employee_id=r["responsible_id"],
            year=year, month=month,
            amount=r["penalty_amount"],
            status="APPROVED",
            reason=reason,
            notes=f"[doi-soat] {code} {event_date.isoformat()} "
                  f"nhan-su={r.get('employee_code') or emp_id}",
            created_by=actor,
            approved_by=actor,
            approved_at=now,
        )
        ViolationPenaltyIssue.objects.create(
            employee_id=emp_id, event_date=event_date,
            violation_code=code, fault_side=side,
            responsible_id=r["responsible_id"],
            year=year, month=month, amount=r["penalty_amount"],
            disciplinary_penalty=dp, created_by=actor,
        )
        created.append(dp)
        by_person[r["responsible_id"]].append(r)

    _notify_people(by_person, year, month, actor)

    return {
        "year": year, "month": month,
        "created": len(created),
        "skipped_already_issued": len(rows) - len(new_rows),
        "people": len(by_person),
        "total_amount": sum(r["penalty_amount"] for r in new_rows),
    }


def _notify_people(by_person, year, month, actor):
    """Mỗi người bị phạt nhận ĐÚNG MỘT thông báo gộp cả tháng.

    Luồng tạo biên bản sẵn có gửi 2 thông báo cho mỗi bản ghi (1 cho nhân sự,
    1 "cần duyệt" cho quản lý). Tháng 9 có 147 dòng ra tiền -> 294 thông báo.
    Best-effort: lỗi gửi thông báo KHÔNG được làm hỏng việc chốt.
    """
    if not by_person:
        return
    try:
        from employee.models import Employee
        from hrm.models import CompanyAnnouncement
        from .violation_report_views import VIOLATION_LABEL

        emps = {e.id: e for e in Employee.objects.filter(id__in=by_person.keys())}
        for emp_id, items in by_person.items():
            emp = emps.get(emp_id)
            if not emp:
                continue
            total = sum(i["penalty_amount"] for i in items)
            lines = "\n".join(
                f"- {_dt.date.fromisoformat(str(i['event_date'])[:10]):%d/%m}: "
                f"{VIOLATION_LABEL.get(i.get('violation_code'), i.get('violation_code'))}"
                for i in sorted(items, key=lambda x: str(x.get("event_date")))
            )
            ann = CompanyAnnouncement.objects.create(
                title=f"Phạt vi phạm đơn từ tháng {month:02d}/{year}",
                content=(f"Bạn có {len(items)} vi phạm đơn từ trong tháng "
                         f"{month:02d}/{year}, tổng {total:,.0f} đ.\n{lines}\n\n"
                         f"Chi tiết xem tại trang Đối soát vi phạm đơn từ."),
                announcement_type="NOTICE",
                priority="HIGH",
                apply_to_all=False,
                effective_from=timezone.now().date(),
                # Có hạn 30 ngày — thông báo biên bản phạt cũ không bao giờ đặt
                # effective_to nên tháng 6 vẫn còn treo tới tận tháng 10.
                effective_to=timezone.now().date() + _dt.timedelta(days=30),
                is_active=True,
                created_by=actor,
                approved_by=actor,
            )
            ann.employees.add(emp)
    except Exception:
        logger.exception("[violation_finalize] Không gửi được thông báo phạt tháng %s/%s",
                         month, year)

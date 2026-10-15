"""Lưu vết bảng đối soát vi phạm đơn từ.

HCNS 2026-10-12: *"cái bảng này cần được lưu chứ. Với áp phạt, xóa phạt đều
phải lưu vết hết"*, và khi hỏi chốt sổ lúc nào thì chọn **"phải cho tự save khi
có thay đổi bất kì"** — không dùng nút "Chốt tháng".

Cách ghi: append-only theo nội dung. Mỗi lần chạy, so `content_hash` của từng
dòng với bản ĐANG HIỆU LỰC cùng khoá:
  - giống  -> chỉ đẩy `last_seen_at` (chạy lại 10 lần không sinh thêm bản ghi)
  - khác   -> đóng bản cũ (`superseded_at`) rồi ghi bản mới
  - mất    -> đóng bản cũ, không ghi gì thêm

Nhờ vậy trả lời được "ngày X hệ thống kết luận gì", thay vì chỉ trả lời được
"hôm nay nó đang nghĩ gì" như trước — xem ghi chú ở ViolationLedgerEntry.
"""
import datetime as _dt
import hashlib
import json
import logging

from django.db import transaction
from django.utils import timezone

from .violation_models import ViolationLedgerEntry, ViolationLedgerRun

logger = logging.getLogger(__name__)

# Các trường QUYẾT ĐỊNH nội dung một dòng. Cố ý KHÔNG gồm thứ gì đổi theo thời
# điểm chạy (generated_at, last_seen_at...) — nếu không thì lần chạy nào cũng
# "khác" và bảng lưu vết phình ra vô ích.
_HASHED_FIELDS = (
    "violation_code", "fault_side", "responsible_id", "request_code",
    "request_type", "status", "deadline", "created_at", "approved_at",
    "has_grant", "overdue_minutes", "penalty_amount", "penalty_reason", "detail",
)


def _hash_row(row):
    payload = {k: row.get(k) for k in _HASHED_FIELDS}
    blob = json.dumps(payload, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _as_date(value):
    if isinstance(value, _dt.date):
        return value
    try:
        return _dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


@transaction.atomic
def record_violation_snapshot(year, month, *, source, import_log=None,
                              triggered_by=None, note=""):
    """Tính lại tháng `month/year` rồi ghi phần ĐÃ THAY ĐỔI vào sổ.

    Trả về ViolationLedgerRun. Gọi trong transaction để một lần chạy hoặc ghi
    trọn vẹn, hoặc không ghi gì — nửa vời thì sổ sẽ nói dối.
    """
    # Import tại chỗ: violation_report_views import ngược lại models/penalty.
    from .violation_report_views import LeaveViolationReportView, _month_range

    first, last = _month_range(year, month)
    rows = LeaveViolationReportView().compute_rows(first, last)

    run = ViolationLedgerRun.objects.create(
        year=year, month=month, source=source,
        import_log=import_log, triggered_by=triggered_by, note=note,
    )

    live = {
        (e.employee_id, e.event_date, e.violation_code, e.fault_side): e
        for e in ViolationLedgerEntry.objects.filter(
            event_date__gte=first, event_date__lte=last, superseded_at__isnull=True,
        )
    }

    now = timezone.now()
    seen = set()
    new_rows = changed_rows = 0

    for r in rows:
        d = _as_date(r.get("event_date"))
        if d is None or not r.get("employee_id"):
            continue
        key = (r["employee_id"], d, r.get("violation_code"), r.get("fault_side"))
        if key in seen:
            # _dedup_one_per_day đã bảo đảm 1 dòng/ngày/bên, nhưng dòng tổng
            # hợp từ override có thể trùng -> bỏ qua thay vì vỡ ràng buộc unique.
            continue
        seen.add(key)

        content_hash = _hash_row(r)
        current = live.get(key)
        if current is not None and current.content_hash == content_hash:
            current.last_seen_at = now
            current.save(update_fields=["last_seen_at"])
            continue

        if current is not None:
            current.superseded_at = now
            current.save(update_fields=["superseded_at"])
            changed_rows += 1
        else:
            new_rows += 1

        ViolationLedgerEntry.objects.create(
            run=run,
            employee_id=r["employee_id"],
            event_date=d,
            violation_code=r.get("violation_code") or "",
            fault_side=r.get("fault_side") or "",
            responsible_id=r.get("responsible_id"),
            request_code=r.get("request_code") or "",
            penalty_amount=r.get("penalty_amount") or 0,
            penalty_reason=r.get("penalty_reason") or "",
            detail=r.get("detail") or "",
            payload=r,
            content_hash=content_hash,
            last_seen_at=now,
        )

    # Dòng từng có mà nay không còn (đơn được duyệt bù, HCNS mở khoá, sửa chấm
    # công...) -> đóng lại chứ KHÔNG xoá, để còn tra ngược.
    closed_rows = 0
    for key, entry in live.items():
        if key not in seen:
            entry.superseded_at = now
            entry.save(update_fields=["superseded_at"])
            closed_rows += 1

    run.total_rows = len(seen)
    run.new_rows = new_rows
    run.changed_rows = changed_rows
    run.closed_rows = closed_rows
    run.total_penalty = sum(r.get("penalty_amount") or 0 for r in rows)
    run.finished_at = timezone.now()
    run.save(update_fields=["total_rows", "new_rows", "changed_rows",
                            "closed_rows", "total_penalty", "finished_at"])
    return run


def months_in_range(first, last):
    """Các (năm, tháng) mà một đợt nạp chấm công chạm vào."""
    out = []
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out

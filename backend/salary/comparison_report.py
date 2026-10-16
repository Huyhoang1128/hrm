"""
Báo cáo biến động lương: so lương của từng nhân viên giữa hai tháng.

Nguồn số là `get_salary_rows` — đúng nguồn của trang Bảng lương, nên số trên báo
cáo khớp bảng lương.

Ba chỉ số, HR chọn chỉ số để so trên giao diện:
- Tổng thu nhập: suy ngược từ Thực lĩnh mà bảng lương đã tính,
  thực lĩnh + bảo hiểm + phạt chấm công + phạt biên bản + tạm ứng
  (= lương ngày công + phụ cấp + doanh số + thu nhập khác). Suy ngược để luôn khớp
  với số thực lĩnh đang hiển thị.
- Lương thực lĩnh và Còn phải thanh toán: lấy thẳng số của bảng lương.
"""
from decimal import Decimal

METRICS = (
    ('tong_thu_nhap', 'Tổng thu nhập'),
    ('luong_thuc_linh', 'Lương thực lĩnh'),
    ('con_phai_thanh_toan', 'Còn phải thanh toán'),
)
METRIC_KEYS = [key for key, _ in METRICS]


def _dec(row, key) -> Decimal:
    try:
        return Decimal(str(row.get(key) or 0))
    except Exception:
        return Decimal('0')


def row_metrics(row) -> dict:
    gross = (
        _dec(row, 'luong_thuc_linh') + _dec(row, 'bh_deduction') + _dec(row, 'tong_phat')
        + _dec(row, 'tong_phat_bienban') + _dec(row, 'tam_ung')
    )
    return {
        'tong_thu_nhap': gross,
        'luong_thuc_linh': _dec(row, 'luong_thuc_linh'),
        'con_phai_thanh_toan': _dec(row, 'con_phai_thanh_toan'),
    }


def parse_period(value):
    """'2026-09' hoặc '09/2026' -> (2026, 9); sai định dạng -> None."""
    text = (value or '').strip()
    try:
        if '/' in text:
            month, year = text.split('/')
        else:
            year, month = text.split('-')[:2]
        year, month = int(year), int(month)
    except (ValueError, TypeError):
        return None
    if not (1 <= month <= 12 and 2000 <= year <= 2100):
        return None
    return year, month


def build_comparison(period_a, period_b, department_id=None, legal_entity='', employee=None) -> dict:
    from hrm.finalization_views import get_salary_rows

    def load(period):
        data = get_salary_rows(
            period[0], period[1], department_id=department_id,
            legal_entity=legal_entity or '', employee_code=employee or None,
        )
        return {str(r.get('ma_nv') or ''): r for r in data['results']}

    rows_a, rows_b = load(period_a), load(period_b)

    zero = {key: Decimal('0') for key in METRIC_KEYS}
    totals_a, totals_b = dict(zero), dict(zero)
    result = []
    for code in sorted(set(rows_a) | set(rows_b)):
        if not code:
            continue
        row_a, row_b = rows_a.get(code), rows_b.get(code)
        latest = row_b or row_a
        metrics_a = row_metrics(row_a) if row_a else None
        metrics_b = row_metrics(row_b) if row_b else None
        diff, diff_percent = {}, {}
        for key in METRIC_KEYS:
            value_a = metrics_a[key] if metrics_a else Decimal('0')
            value_b = metrics_b[key] if metrics_b else Decimal('0')
            totals_a[key] += value_a
            totals_b[key] += value_b
            diff[key] = float(value_b - value_a)
            diff_percent[key] = float((value_b - value_a) / value_a * 100) if metrics_a and value_a else None
        legal_entity_b = (latest.get('phap_nhan_con') or '').strip()
        legal_entity_a = ((row_a or {}).get('phap_nhan_con') or '').strip()
        result.append({
            'employee_id': latest.get('employee_id'),
            'employee_code': code,
            'full_name': latest.get('ho_va_ten') or '',
            'department': latest.get('phong_ban') or '',
            'position': latest.get('vi_tri') or '',
            # Phòng ban / pháp nhân lấy theo tháng sau; khác tháng trước thì ghi kèm để HR
            # hiểu vì sao lương đổi (chuyển phòng ban, chuyển pháp nhân).
            'legal_entity': legal_entity_b,
            'legal_entity_name': legal_entity_b,
            'department_a': (row_a or {}).get('phong_ban') or '',
            'legal_entity_a': legal_entity_a,
            'legal_entity_a_name': legal_entity_a,
            'in_month_a': row_a is not None,
            'in_month_b': row_b is not None,
            'month_a': {k: float(v) for k, v in metrics_a.items()} if metrics_a else None,
            'month_b': {k: float(v) for k, v in metrics_b.items()} if metrics_b else None,
            'diff': diff,
            'diff_percent': diff_percent,
        })

    def period_info(period):
        return {'year': period[0], 'month': period[1], 'label': f'{period[1]:02d}/{period[0]}'}

    return {
        'month_a': period_info(period_a),
        'month_b': period_info(period_b),
        'metrics': [{'key': key, 'label': label} for key, label in METRICS],
        'rows': result,
        'totals': {
            'month_a': {k: float(v) for k, v in totals_a.items()},
            'month_b': {k: float(v) for k, v in totals_b.items()},
            'diff': {k: float(totals_b[k] - totals_a[k]) for k in METRIC_KEYS},
            'employee_count': len(result),
        },
    }

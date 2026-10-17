"""
Chốt lương tháng (salary.MonthlyPayrollSnapshot).

- finalize_salary_month(): tính lại bảng lương CẢ CÔNG TY của tháng (không chốt theo
  phòng ban) và lưu nguyên từng dòng trong 1 transaction; xoá dòng của người không còn
  trong bảng lương tháng đó (chốt lại sau khi có người nghỉ / vào làm).
- unfinalize_salary_month(): xoá snapshot của tháng → mở khoá, bảng lương tính lại.
- snapshot_salary_rows(): dòng đã chốt cho get_salary_rows() khi tháng đã chốt.
- get_finalize_state(): đã chốt chưa, lúc nào, ai chốt, và dữ liệu hiện tại có khác bản
  đã chốt không (is_stale) — tính lại để so, không dựa vào updated_at.
- payslip_send_block(): chặn gửi phiếu lương khi chưa chốt hoặc dữ liệu đã đổi sau khi chốt.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Q
from rest_framework import status
from rest_framework.response import Response

# Phần cấu hình lương của nhân viên mà giao diện dùng để dựng phiếu lương (chính sách
# phụ cấp / thuế / công đoàn trong salary_adjustments, mức đóng BH, tỷ lệ thử việc) —
# lưu kèm dòng để phiếu lương tháng đã chốt không đổi khi cấu hình hiện tại thay đổi.
EMPLOYEE_SNAPSHOT_FIELDS = ('salary_adjustments', 'social_insurance_contribution_level', 'probation_rate')
# Đánh dấu dòng đọc từ bản đã chốt — không ghép lại dữ liệu lương tháng nhập tay
# (đã ghép sẵn lúc chốt), xem salary/views.py _merge_monthly_inputs_into_salary_rows.
FINALIZED_ROW_FLAG = 'payroll_finalized'
# So dòng đã chốt với dòng tính lại: số chênh quá ngưỡng này mới tính là khác.
_COMPARE_TOLERANCE = 0.005


def _json_safe(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    return value


def _employee_snapshot(employee) -> dict:
    return {name: _json_safe(getattr(employee, name, None)) for name in EMPLOYEE_SNAPSHOT_FIELDS}


def compute_live_rows(year: int, month: int, employees=None) -> tuple:
    """(employees, rows) tính lại từ dữ liệu hiện tại — đúng dòng sẽ được chốt: dòng
    lương + dữ liệu lương tháng nhập tay + cấu hình lương của nhân viên."""
    from hrm.finalization_views import build_salary_context, build_salary_row, resolve_salary_employees
    from .views import _merge_monthly_inputs_into_salary_rows

    if employees is None:
        employees = resolve_salary_employees(year, month)
    if not employees:
        return [], []
    ctx = build_salary_context(employees, year, month)
    rows = _merge_monthly_inputs_into_salary_rows([build_salary_row(e, ctx) for e in employees], year, month)
    for employee, row in zip(employees, rows):
        row['employee_snapshot'] = _employee_snapshot(employee)
    return employees, [_json_safe(row) for row in rows]


def _snapshot_qs(year, month, department_id=None, legal_entity='', employee_code=None):
    from .salary_data_models import MonthlyPayrollSnapshot

    qs = MonthlyPayrollSnapshot.objects.filter(year=year, month=month)
    if department_id:
        qs = qs.filter(department_id_snapshot=department_id)
    if legal_entity:
        qs = qs.filter(phap_nhan_con=legal_entity)
    if employee_code:
        qs = qs.filter(Q(employee_code__icontains=employee_code) | Q(ho_va_ten__icontains=employee_code))
    return qs.order_by('employee_code')


def _last_finalized_at(year, month):
    from .salary_data_models import MonthlyPayrollSnapshot
    return MonthlyPayrollSnapshot.objects.filter(year=year, month=month).aggregate(at=Max('finalized_at'))['at']


def snapshot_salary_rows(year, month, department_id=None, legal_entity='', employee_code=None):
    """None nếu tháng chưa chốt; ngược lại (rows, finalized_at) đọc từ bản đã chốt.
    Lọc theo phòng ban / pháp nhân lúc chốt, không theo hiện tại."""
    finalized_at = _last_finalized_at(year, month)
    if finalized_at is None:
        return None
    rows = [{**snap.row, FINALIZED_ROW_FLAG: True}
            for snap in _snapshot_qs(year, month, department_id, legal_entity, employee_code)]
    return rows, finalized_at


def finalize_salary_month(year: int, month: int, user=None) -> dict:
    """Chốt (hoặc chốt lại) lương cả công ty của tháng."""
    from .salary_data_models import MonthlyPayrollSnapshot

    employees, rows = compute_live_rows(year, month)
    created = updated = 0
    with transaction.atomic():
        removed, _ = (MonthlyPayrollSnapshot.objects.filter(year=year, month=month)
                      .exclude(employee_id__in=[e.id for e in employees]).delete())
        for employee, row in zip(employees, rows):
            _, was_created = MonthlyPayrollSnapshot.objects.update_or_create(
                employee=employee, year=year, month=month,
                defaults={
                    'employee_code': employee.employee_id,
                    'ho_va_ten': employee.full_name,
                    'department_id_snapshot': employee.department_id,
                    'phong_ban': row.get('phong_ban') or '',
                    'phap_nhan_con': employee.subsidiary_legal_entity or '',
                    'luong_thuc_linh': Decimal(str(row.get('luong_thuc_linh') or 0)),
                    'con_phai_thanh_toan': Decimal(str(row.get('con_phai_thanh_toan') or 0)),
                    'row': row,
                    'finalized_by': user if getattr(user, 'is_authenticated', False) else None,
                },
            )
            created += int(was_created)
            updated += int(not was_created)
    return {'year': year, 'month': month, 'total': len(rows), 'created': created, 'updated': updated,
            'removed': removed, 'finalized_at': _last_finalized_at(year, month)}


def unfinalize_salary_month(year: int, month: int) -> int:
    """Bỏ chốt: xoá bản đã chốt của tháng, trả số dòng đã xoá."""
    from .salary_data_models import MonthlyPayrollSnapshot
    deleted, _ = MonthlyPayrollSnapshot.objects.filter(year=year, month=month).delete()
    return deleted


def _changed_keys(snapshot_row: dict, live_row: dict) -> list:
    """Các khoá của dòng đã chốt có giá trị khác dòng tính lại. Chỉ so các khoá có trong
    bản đã chốt — khoá mới thêm sau này không làm các tháng cũ bị coi là đã đổi."""
    changed = []
    for key, old in snapshot_row.items():
        if key == FINALIZED_ROW_FLAG:
            continue
        new = live_row.get(key)
        is_num = (isinstance(old, (int, float)) and isinstance(new, (int, float))
                  and not isinstance(old, bool) and not isinstance(new, bool))
        if (abs(old - new) > _COMPARE_TOLERANCE) if is_num else (old != new):
            changed.append(key)
    return changed


def get_finalize_state(year: int, month: int, employee_ids=None) -> dict:
    """Trạng thái chốt lương của tháng. employee_ids: chỉ so các nhân viên này (gửi phiếu
    lương 1 người / 1 phòng ban) thay vì cả công ty."""
    from hrm.finalization_views import resolve_salary_employees
    from users.utils import get_user_display_name
    from .salary_data_models import MonthlyPayrollSnapshot

    month_qs = MonthlyPayrollSnapshot.objects.filter(year=year, month=month)
    state = {'year': year, 'month': month, 'is_finalized': False, 'finalized_at': None, 'finalized_by': None,
             'total_finalized': month_qs.count(), 'is_stale': False, 'changed_count': 0, 'changed': []}
    if not state['total_finalized']:
        return state
    last = month_qs.select_related('finalized_by').order_by('-finalized_at').first()
    state.update(is_finalized=True, finalized_at=last.finalized_at,
                 finalized_by=get_user_display_name(last.finalized_by) if last.finalized_by else None)

    wanted = set(employee_ids) if employee_ids is not None else None
    snapshots = {s.employee_id: s for s in month_qs if wanted is None or s.employee_id in wanted}
    employees = [e for e in resolve_salary_employees(year, month) if wanted is None or e.id in wanted]
    _, live_rows = compute_live_rows(year, month, employees)
    live = {row['employee_id']: row for row in live_rows}

    changed = []
    for employee_id, snap in snapshots.items():
        if employee_id not in live:
            changed.append({'employee_code': snap.employee_code, 'ho_va_ten': snap.ho_va_ten,
                            'reason': 'Không còn trong bảng lương tháng'})
            continue
        keys = _changed_keys(snap.row, live[employee_id])
        if keys:
            changed.append({'employee_code': snap.employee_code, 'ho_va_ten': snap.ho_va_ten,
                            'reason': 'Dữ liệu đã thay đổi', 'fields': keys[:10]})
    for employee_id, row in live.items():
        if employee_id not in snapshots:
            changed.append({'employee_code': row.get('ma_nv'), 'ho_va_ten': row.get('ho_va_ten'),
                            'reason': 'Chưa có trong bản đã chốt'})
    state.update(is_stale=bool(changed), changed_count=len(changed), changed=changed[:50])
    return state


def payslip_send_block(year: int, month: int, department_id=None, legal_entity='', employee_ids=None):
    """Response 409 nếu chưa chốt lương tháng, hoặc dữ liệu của những người sắp gửi phiếu
    lương đã đổi sau khi chốt; ngược lại None."""
    from hrm.finalization_views import resolve_salary_employees

    if employee_ids is None:
        employee_ids = {e.id for e in resolve_salary_employees(year, month, department_id, legal_entity)}
        employee_ids |= set(_snapshot_qs(year, month, department_id, legal_entity).values_list('employee_id', flat=True))
    state = get_finalize_state(year, month, employee_ids)
    period = f'{int(month):02d}/{int(year)}'
    if not state['is_finalized']:
        return Response({**state, 'code': 'SALARY_NOT_FINALIZED',
                         'detail': f'Cần chốt lương tháng {period} trước khi gửi phiếu lương.'},
                        status=status.HTTP_409_CONFLICT)
    if state['is_stale']:
        return Response({**state, 'code': 'SALARY_SNAPSHOT_STALE',
                         'detail': (f'Dữ liệu lương tháng {period} đã thay đổi sau khi chốt '
                                    f'({state["changed_count"]} nhân viên). Chốt lại trước khi gửi phiếu lương.')},
                        status=status.HTTP_409_CONFLICT)
    return None

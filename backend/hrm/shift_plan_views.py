"""
/api-hrm/weekly-shift-plans/ — kế hoạch ca theo tuần (hrm/shift_plan_models.py).

Nhân viên lập kế hoạch tuần (Nháp) → Gửi duyệt (Chờ duyệt) → quản lý trực tiếp duyệt → HCNS
duyệt (Đã duyệt). Bị từ chối thì sửa lại (về Nháp) và gửi lại. Admin duyệt cả 2 bước một lần;
quản lý trực tiếp có quyền duyệt bước HCNS (hoặc nhân viên là HCNS) cũng xong luôn; quản lý cấp
cao không có quản lý trực tiếp thì HCNS duyệt cả 2 bước.

Khoá (WeeklyShiftPlanLock): chặn tạo / sửa / gửi với MỌI người; không chặn duyệt, từ chối,
xoá và nhập Excel. Nhập Excel (HCNS / Admin) ghi thẳng kế hoạch Đã duyệt.

Nhân viên đang thuộc phạm vi "Đăng ký ca" (ShiftRegistrationScopeConfig) không lập kế hoạch
tuần — tránh 2 cơ chế chọn ca cùng lúc cho 1 người.

Ca online (ShiftConfig.no_attendance_required) chỉ chọn ở ô "Ca online thêm" (extra_shift),
không chọn làm ca chính / ca thứ 2 — xem hrm/online_shift.py.
"""
import datetime as dt
import io
import re
from collections import defaultdict

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from employee.models import Employee

from .models import ShiftConfig, _has_approve_permission, _is_hr, is_senior_manager
from .shift_plan_models import WeeklyShiftPlan, WeeklyShiftPlanDay, WeeklyShiftPlanLock

LOCKED_MSG = 'Kế hoạch ca đang bị khoá — không tạo / sửa / gửi được. Liên hệ HCNS.'
WEEKDAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật']
UPLOAD_COLUMNS = {
    'employee': ('mã nhân viên', 'mã nv', 'mã n.viên', 'employee code', 'mã'),
    'date': ('ngày', 'date', 'ngày làm', 'ngày làm việc'),
    'shift': ('mã ca', 'ca làm', 'ca', 'shift', 'shift code'),
}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class PlanError(Exception):
    def __init__(self, message, http_status=status.HTTP_400_BAD_REQUEST):
        super().__init__(message)
        self.http_status = http_status


# ── serializer ────────────────────────────────────────────────────────────

class ShiftBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShiftConfig
        fields = ['id', 'code', 'name', 'start_time', 'end_time', 'shift_type', 'no_attendance_required',
                  'fixed_workday']


class WeeklyShiftPlanDaySerializer(serializers.ModelSerializer):
    shift_detail = ShiftBriefSerializer(source='shift', read_only=True)
    shift_2_detail = ShiftBriefSerializer(source='shift_2', read_only=True)
    extra_shift_detail = ShiftBriefSerializer(source='extra_shift', read_only=True)

    class Meta:
        model = WeeklyShiftPlanDay
        fields = ['date', 'shift', 'shift_2', 'extra_shift', 'shift_detail', 'shift_2_detail', 'extra_shift_detail']


def _name(employee):
    return employee.full_name if employee else None


class WeeklyShiftPlanSerializer(serializers.ModelSerializer):
    employee_code = serializers.CharField(source='employee.employee_id', read_only=True)
    employee_name = serializers.CharField(source='employee.full_name', read_only=True)
    department_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    source_display = serializers.CharField(source='get_source_display', read_only=True)
    direct_manager_approved_by_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    rejected_by_name = serializers.SerializerMethodField()
    days = WeeklyShiftPlanDaySerializer(many=True, read_only=True)

    class Meta:
        model = WeeklyShiftPlan
        fields = [
            'id', 'employee', 'employee_code', 'employee_name', 'department_name',
            'week_start_date', 'week_end_date', 'status', 'status_display', 'source', 'source_display',
            'submitted_at', 'direct_manager_approved', 'direct_manager_approved_at', 'direct_manager_approved_by_name',
            'approved_at', 'approved_by_name', 'rejected_at', 'rejected_by_name', 'reject_reason',
            'days', 'created_at', 'updated_at',
        ]

    def get_department_name(self, obj):
        return obj.employee.department.name if obj.employee.department_id else None

    def get_direct_manager_approved_by_name(self, obj):
        return _name(obj.direct_manager_approved_by)

    def get_approved_by_name(self, obj):
        return _name(obj.approved_by)

    def get_rejected_by_name(self, obj):
        return _name(obj.rejected_by)


# ── helper ────────────────────────────────────────────────────────────────

def _actor(request):
    return Employee.objects.filter(user=request.user).select_related('manager').first()


def _manage_all(request, actor) -> bool:
    """Admin / HCNS: lập hộ, xoá mọi trạng thái, khoá / mở, nhập / xuất Excel."""
    return request.user.is_staff or request.user.is_superuser or bool(actor and actor.is_hr)


def _can_hr_step(actor) -> bool:
    return bool(actor) and (_is_hr(actor) or _has_approve_permission(actor))


def _parse_date(value):
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _week_start(value):
    day = _parse_date(value)
    if day is None or day.weekday() != 0:
        raise PlanError('week_start_date phải là ngày thứ Hai (YYYY-MM-DD).')
    return day


def _scope_conflict(employee):
    from .shift_registration_models import ShiftRegistrationScopeConfig
    if ShiftRegistrationScopeConfig.for_employee(employee):
        return (f'{employee.full_name} đang chọn ca theo "Đăng ký ca" (Ca 1 / Ca 2) — không lập kế hoạch ca '
                f'tuần cho người này.')
    return None


def _check_overlap(first, second):
    if first and second and not (second.start_time >= first.end_time or second.end_time <= first.start_time):
        raise PlanError(f'Ca {first.code} và {second.code} bị trùng giờ.')


def _check_kinds(shift, shift_2, extra):
    """Ca chính / ca thứ 2 phải là ca chấm công; ca online thêm phải là ca online."""
    for main in (shift, shift_2):
        if main and main.no_attendance_required:
            raise PlanError(f'Ca {main.code} là ca online — chọn ở ô "Ca online thêm".')
    if extra and not extra.no_attendance_required:
        raise PlanError(f'Ca {extra.code} không phải ca online — chọn ở ô ca chính.')


def _parse_days(raw_days, week_start):
    """[(ngày, ca, ca thứ 2, ca online thêm)] từ payload days=[{date, shift, shift_2?, extra_shift?}]."""
    if not isinstance(raw_days, list):
        raise PlanError('days phải là danh sách.')
    week_end = week_start + dt.timedelta(days=6)
    ids = {item.get(k) for item in raw_days if isinstance(item, dict)
           for k in ('shift', 'shift_2', 'extra_shift') if item.get(k)}
    shifts = ShiftConfig.objects.in_bulk(list(ids))
    seen, parsed = set(), []
    for item in raw_days:
        day = _parse_date((item or {}).get('date'))
        if day is None or not (week_start <= day <= week_end):
            raise PlanError(f'Ngày {(item or {}).get("date")} không thuộc tuần {week_start:%d/%m/%Y}.')
        if day in seen:
            raise PlanError(f'Ngày {day:%d/%m/%Y} bị trùng.')
        seen.add(day)
        picked = []
        for key in ('shift', 'shift_2', 'extra_shift'):
            sid = item.get(key)
            if not sid:
                picked.append(None)
                continue
            shift = shifts.get(int(sid)) if str(sid).isdigit() else None
            if shift is None or not shift.is_active:
                raise PlanError(f'Ca #{sid} không tồn tại hoặc đã ngừng dùng.')
            picked.append(shift)
        if picked[1] and not picked[0]:
            picked = [picked[1], None, picked[2]]
        _check_kinds(*picked)
        _check_overlap(picked[0], picked[1])
        parsed.append((day, *picked))
    return parsed


def _replace_days(plan, parsed):
    plan.days.all().delete()
    WeeklyShiftPlanDay.objects.bulk_create([
        WeeklyShiftPlanDay(plan=plan, date=day, shift=shift, shift_2=shift_2, extra_shift=extra)
        for day, shift, shift_2, extra in parsed
    ])


def _approval_mode(plan, request, actor, can_hr=None):
    """Bước actor duyệt được lúc này: 'both' (xong luôn) / 'manager' / 'final'. Không được → PlanError."""
    if plan.status != WeeklyShiftPlan.Status.PENDING:
        raise PlanError('Chỉ duyệt được kế hoạch đang chờ duyệt.')
    employee = plan.employee
    is_admin = request.user.is_staff or request.user.is_superuser
    is_direct_mgr = bool(actor) and employee.manager_id == actor.id
    can_hr = _can_hr_step(actor) if can_hr is None else can_hr
    if is_admin or (can_hr and is_senior_manager(employee) and not employee.manager_id):
        return 'both'
    if is_direct_mgr:
        # Quản lý trực tiếp có quyền duyệt bước HCNS, hoặc nhân viên là HCNS → xong luôn
        if can_hr or _is_hr(employee):
            return 'both'
        if plan.direct_manager_approved:
            raise PlanError('Bạn đã duyệt bước quản lý trực tiếp — kế hoạch đang chờ HCNS.')
        return 'manager'
    if can_hr:
        if not plan.direct_manager_approved:
            raise PlanError('HCNS chỉ duyệt được sau khi quản lý trực tiếp đã duyệt.', status.HTTP_403_FORBIDDEN)
        return 'final'
    raise PlanError('Bạn không có quyền duyệt kế hoạch này.', status.HTTP_403_FORBIDDEN)


def _approve(plan, request, actor):
    """Duyệt 2 bước. Trả plan đã cập nhật hoặc ném PlanError."""
    mode = _approval_mode(plan, request, actor)
    now = timezone.now()
    if mode in ('both', 'manager') and not plan.direct_manager_approved:
        plan.direct_manager_approved = True
        plan.direct_manager_approved_at = now
        plan.direct_manager_approved_by = actor
    if mode in ('both', 'final'):
        plan.status = WeeklyShiftPlan.Status.APPROVED
        plan.approved_at = now
        plan.approved_by = actor
    plan.save()
    return plan


def _shift_label(day):
    return ' + '.join(s.code for s in (day.shift, day.shift_2, day.extra_shift) if s)


# ── viewset ───────────────────────────────────────────────────────────────

class WeeklyShiftPlanViewSet(viewsets.ModelViewSet):
    serializer_class = WeeklyShiftPlanSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'delete']

    def get_queryset(self):
        actor = _actor(self.request)
        qs = WeeklyShiftPlan.objects.select_related(
            'employee__department', 'direct_manager_approved_by', 'approved_by', 'rejected_by',
        ).prefetch_related('days__shift', 'days__shift_2', 'days__extra_shift')
        if not (_manage_all(self.request, actor) or _can_hr_step(actor)):
            if actor is None:
                return qs.none()
            qs = qs.filter(Q(employee=actor) | Q(employee__manager=actor))
        params = self.request.query_params
        if week := _parse_date(params.get('week_start_date')):
            qs = qs.filter(week_start_date=week)
        if statuses := [s for s in (params.get('status') or '').split(',') if s]:
            qs = qs.filter(status__in=statuses)
        if employee := params.get('employee'):
            qs = qs.filter(employee_id=employee)
        if department := params.get('department_id'):
            qs = qs.filter(employee__department_id=department)
        if (year := params.get('year')) and (month := params.get('month')):
            try:
                start = dt.date(int(year), int(month), 1)
            except ValueError:
                return qs.none()
            end = (start + dt.timedelta(days=32)).replace(day=1)
            qs = qs.filter(week_start_date__lt=end, week_end_date__gte=start)
        if search := (params.get('search') or '').strip():
            qs = qs.filter(Q(employee__employee_id__icontains=search) | Q(employee__full_name__icontains=search))
        return qs

    def _respond(self, fn):
        try:
            return fn()
        except PlanError as exc:
            return Response({'detail': str(exc)}, status=exc.http_status)

    def _ensure_unlocked(self):
        if WeeklyShiftPlanLock.get_solo().is_locked:
            raise PlanError(LOCKED_MSG, status.HTTP_423_LOCKED)

    def _ensure_can_edit(self, plan, actor):
        if not (_manage_all(self.request, actor) or (actor and plan.employee_id == actor.id)):
            raise PlanError('Bạn không có quyền sửa kế hoạch này.', status.HTTP_403_FORBIDDEN)
        if plan.status not in (WeeklyShiftPlan.Status.DRAFT, WeeklyShiftPlan.Status.REJECTED):
            raise PlanError('Chỉ sửa được kế hoạch ở trạng thái Nháp hoặc Từ chối.')

    # tạo / sửa / xoá
    def create(self, request, *args, **kwargs):
        def run():
            self._ensure_unlocked()
            actor = _actor(request)
            manage_all = _manage_all(request, actor)
            employee = actor
            if request.data.get('employee_id') not in (None, ''):
                if not manage_all and str(request.data.get('employee_id')) != str(getattr(actor, 'id', '')):
                    raise PlanError('Chỉ HCNS / Admin lập kế hoạch hộ người khác.', status.HTTP_403_FORBIDDEN)
                employee = Employee.objects.filter(pk=request.data.get('employee_id')).first()
            if employee is None:
                raise PlanError('Không tìm thấy nhân viên.')
            if conflict := _scope_conflict(employee):
                raise PlanError(conflict)
            week_start = _week_start(request.data.get('week_start_date'))
            if WeeklyShiftPlan.objects.filter(employee=employee, week_start_date=week_start).exists():
                raise PlanError(f'{employee.full_name} đã có kế hoạch ca tuần {week_start:%d/%m/%Y}.')
            parsed = _parse_days(request.data.get('days') or [], week_start)
            with transaction.atomic():
                plan = WeeklyShiftPlan.objects.create(
                    employee=employee, week_start_date=week_start, week_end_date=week_start + dt.timedelta(days=6),
                    source=WeeklyShiftPlan.Source.MANUAL if employee == actor else WeeklyShiftPlan.Source.HR,
                )
                _replace_days(plan, parsed)
            return Response(self.get_serializer(self.get_queryset().get(pk=plan.pk)).data,
                            status=status.HTTP_201_CREATED)
        return self._respond(run)

    def partial_update(self, request, *args, **kwargs):
        def run():
            self._ensure_unlocked()
            plan = self.get_object()
            self._ensure_can_edit(plan, _actor(request))
            with transaction.atomic():
                if 'days' in request.data:
                    _replace_days(plan, _parse_days(request.data.get('days') or [], plan.week_start_date))
                if plan.status == WeeklyShiftPlan.Status.REJECTED:
                    plan.status = WeeklyShiftPlan.Status.DRAFT
                plan.save()
            return Response(self.get_serializer(self.get_queryset().get(pk=plan.pk)).data)
        return self._respond(run)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        def run():
            plan = self.get_object()
            actor = _actor(request)
            if not _manage_all(request, actor):
                self._ensure_can_edit(plan, actor)
            plan.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        return self._respond(run)

    # gửi / duyệt / từ chối
    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        def run():
            self._ensure_unlocked()
            plan = self.get_object()
            self._ensure_can_edit(plan, _actor(request))
            if not plan.days.exists():
                raise PlanError('Kế hoạch chưa có ngày nào.')
            plan.status = WeeklyShiftPlan.Status.PENDING
            plan.submitted_at = timezone.now()
            plan.direct_manager_approved = False
            plan.direct_manager_approved_at = plan.direct_manager_approved_by = None
            plan.rejected_at = plan.rejected_by = None
            plan.reject_reason = ''
            plan.save()
            return Response(self.get_serializer(plan).data)
        return self._respond(run)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return self._respond(lambda: Response(self.get_serializer(
            _approve(self.get_object(), request, _actor(request))).data))

    @action(detail=False, methods=['post'], url_path='bulk-approve')
    def bulk_approve(self, request):
        ids = request.data.get('ids') or []
        if not isinstance(ids, list) or not ids:
            return Response({'detail': 'Cần danh sách ids.'}, status=status.HTTP_400_BAD_REQUEST)
        actor = _actor(request)
        results, errors = [], []
        for plan in self.get_queryset().filter(pk__in=ids):
            try:
                plan = _approve(plan, request, actor)
                results.append({'id': plan.id, 'status': plan.status})
            except PlanError as exc:
                errors.append({'id': plan.id, 'error': str(exc)})
        return Response({'success_count': len(results), 'error_count': len(errors), 'results': results, 'errors': errors})

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        def run():
            plan = self.get_object()
            actor = _actor(request)
            is_admin = request.user.is_staff or request.user.is_superuser
            is_direct_mgr = bool(actor) and plan.employee.manager_id == actor.id
            if not (is_admin or is_direct_mgr or _can_hr_step(actor)):
                raise PlanError('Bạn không có quyền từ chối kế hoạch này.', status.HTTP_403_FORBIDDEN)
            if plan.status != WeeklyShiftPlan.Status.PENDING:
                raise PlanError('Chỉ từ chối được kế hoạch đang chờ duyệt.')
            reason = (request.data.get('reject_reason') or '').strip()
            if not reason:
                raise PlanError('Vui lòng nhập lý do từ chối.')
            plan.status = WeeklyShiftPlan.Status.REJECTED
            plan.rejected_at, plan.rejected_by, plan.reject_reason = timezone.now(), actor, reason
            plan.save()
            return Response(self.get_serializer(plan).data)
        return self._respond(run)

    @action(detail=False, methods=['get'], url_path='pending-approvals')
    def pending_approvals(self, request):
        actor = _actor(request)
        qs = self.get_queryset().filter(status=WeeklyShiftPlan.Status.PENDING)
        is_admin = request.user.is_staff or request.user.is_superuser
        can_hr = _can_hr_step(actor)
        if not (is_admin or can_hr):
            qs = qs.filter(employee__manager=actor) if actor else qs.none()
        data = self.get_serializer(qs, many=True).data
        for row, plan in zip(data, qs):
            try:
                _approval_mode(plan, request, actor, can_hr)
                row['can_approve_now'] = True
            except PlanError:
                row['can_approve_now'] = False
        return Response(data)

    # khoá
    @action(detail=False, methods=['get'], url_path='lock-status')
    def lock_status(self, request):
        lock = WeeklyShiftPlanLock.get_solo()
        return Response({'is_locked': lock.is_locked, 'note': lock.note, 'updated_at': lock.updated_at})

    @action(detail=False, methods=['post'], url_path='lock-toggle')
    def lock_toggle(self, request):
        if not _manage_all(request, _actor(request)):
            return Response({'detail': 'Chỉ HCNS / Admin khoá / mở kế hoạch ca.'}, status=status.HTTP_403_FORBIDDEN)
        lock = WeeklyShiftPlanLock.get_solo()
        lock.is_locked = bool(request.data.get('is_locked'))
        lock.note = (request.data.get('note') or '').strip()[:255]
        lock.updated_by = request.user
        lock.save()
        return Response({'is_locked': lock.is_locked, 'note': lock.note, 'updated_at': lock.updated_at})

    # ca được chọn
    @action(detail=False, methods=['get'], url_path='allowed-shifts')
    def allowed_shifts(self, request):
        today = timezone.localdate()
        shifts = (ShiftConfig.objects.filter(is_active=True, detection_only=False)
                  .filter(Q(effective_to__isnull=True) | Q(effective_to__gte=today))
                  .order_by('start_time', 'code'))
        return Response(ShiftBriefSerializer(shifts, many=True).data)

    # Excel
    @action(detail=False, methods=['post'], url_path='upload')
    def upload(self, request):
        actor = _actor(request)
        if not _manage_all(request, actor):
            return Response({'detail': 'Chỉ HCNS / Admin nhập kế hoạch ca.'}, status=status.HTTP_403_FORBIDDEN)
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'detail': 'Thiếu file.'}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_UPLOAD_BYTES:
            return Response({'detail': 'File quá 10 MB.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            rows = _read_upload(upload)
        except PlanError as exc:
            return Response({'detail': str(exc)}, status=exc.http_status)
        return Response(_import_rows(rows, actor))

    @action(detail=False, methods=['get'], url_path='upload-template')
    def upload_template(self, request):
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Kế hoạch ca'
        ws.append(['Mã NV', 'Ngày', 'Mã ca'])
        ws.append(['NV00001', timezone.localdate().strftime('%d/%m/%Y'), 'CA_SANG + CA_CHIEU'])
        ws.append(['NV00001', (timezone.localdate() + dt.timedelta(days=1)).strftime('%d/%m/%Y'), ''])
        return _xlsx_response(wb, 'mau-ke-hoach-ca.xlsx')

    @action(detail=False, methods=['get'], url_path='export-monthly')
    def export_monthly(self, request):
        import openpyxl
        try:
            year, month = int(request.query_params.get('year')), int(request.query_params.get('month'))
            start = dt.date(year, month, 1)
        except (TypeError, ValueError):
            return Response({'detail': 'year và month là bắt buộc.'}, status=status.HTTP_400_BAD_REQUEST)
        end = (start + dt.timedelta(days=32)).replace(day=1)
        statuses = [s for s in (request.query_params.get('status') or 'APPROVED').split(',') if s]
        days = (WeeklyShiftPlanDay.objects
                .filter(plan__in=self.get_queryset().filter(status__in=statuses), date__gte=start, date__lt=end)
                .select_related('plan__employee__department', 'shift', 'shift_2', 'extra_shift')
                .order_by('plan__employee__employee_id', 'date'))
        if department := request.query_params.get('department_id'):
            days = days.filter(plan__employee__department_id=department)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f'Ca {month:02d}-{year}'
        ws.append(['STT', 'Mã NV', 'Họ tên', 'Phòng ban', 'Ngày', 'Thứ', 'Mã ca', 'Tên ca', 'Giờ vào', 'Giờ ra'])
        for i, day in enumerate(days, start=1):
            employee = day.plan.employee
            shifts = [s for s in (day.shift, day.shift_2, day.extra_shift) if s]
            ws.append([
                i, employee.employee_id, employee.full_name, employee.department.name if employee.department_id else '',
                day.date.strftime('%d/%m/%Y'), WEEKDAY_LABELS[day.date.weekday()], _shift_label(day),
                ' + '.join(s.name for s in shifts) or 'Nghỉ',
                shifts[0].start_time.strftime('%H:%M') if shifts else '',
                shifts[-1].end_time.strftime('%H:%M') if shifts else '',
            ])
        return _xlsx_response(wb, f'ke-hoach-ca-{month:02d}-{year}.xlsx')


def _xlsx_response(workbook, filename):
    buf = io.BytesIO()
    workbook.save(buf)
    response = HttpResponse(buf.getvalue(),
                            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    return response


def _read_upload(upload):
    """[(số dòng, mã NV, chuỗi ngày, chuỗi ca)] từ file .xlsx / .xls / .csv."""
    import pandas as pd

    name = (upload.name or '').lower()
    try:
        if name.endswith('.csv'):
            frame = pd.read_csv(upload, dtype=str, keep_default_na=False)
        elif name.endswith(('.xlsx', '.xls')):
            frame = pd.read_excel(upload, dtype=str, keep_default_na=False)
        else:
            raise PlanError('Chỉ nhận file .xlsx, .xls hoặc .csv.')
    except PlanError:
        raise
    except Exception as exc:  # noqa: BLE001 — file hỏng / sai định dạng
        raise PlanError(f'Không đọc được file: {exc}')
    columns = {}
    for col in frame.columns:
        key = str(col).strip().lower()
        for field, aliases in UPLOAD_COLUMNS.items():
            if key in aliases:
                if field in columns:
                    raise PlanError(f'File có 2 cột cùng nghĩa "{field}" ({columns[field]} và {col}).')
                columns[field] = col
    missing = [f for f in ('employee', 'date', 'shift') if f not in columns]
    if missing:
        raise PlanError('Thiếu cột: ' + ', '.join({'employee': 'Mã NV', 'date': 'Ngày', 'shift': 'Mã ca'}[m] for m in missing))
    return [
        (index + 2, str(row[columns['employee']]).strip(), str(row[columns['date']]).strip(),
         str(row[columns['shift']]).strip())
        for index, row in frame.iterrows()
        if str(row[columns['employee']]).strip()
    ]


def _parse_upload_date(text):
    for fmt in ('%d/%m/%Y', '%Y-%m-%d', '%Y-%m-%d %H:%M:%S', '%d-%m-%Y', '%m/%d/%Y'):
        try:
            return dt.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


@transaction.atomic
def _import_rows(rows, actor):
    """Ghi các dòng hợp lệ thành kế hoạch ĐÃ DUYỆT (nguồn: Excel). Dòng lỗi báo riêng, không
    chặn các dòng khác; trùng (NV, ngày) thì dòng sau thắng và có cảnh báo."""
    employees = {e.employee_id: e for e in Employee.objects.filter(employee_id__in={r[1] for r in rows})}
    shifts = {s.code: s for s in ShiftConfig.objects.filter(is_active=True)}
    failed, warnings, cells, scope_checked = [], [], {}, {}
    for line, code, date_text, shift_text in rows:
        employee = employees.get(code)
        if employee is None:
            failed.append({'row': line, 'error': f'Không tìm thấy nhân viên {code}.'})
            continue
        if employee.id not in scope_checked:
            scope_checked[employee.id] = _scope_conflict(employee)
        if scope_checked[employee.id]:
            failed.append({'row': line, 'error': scope_checked[employee.id]})
            continue
        day = _parse_upload_date(date_text)
        if day is None:
            failed.append({'row': line, 'error': f'Ngày "{date_text}" không đúng định dạng (dd/mm/yyyy).'})
            continue
        codes = [c.strip() for c in re.split(r'[+,]', shift_text) if c.strip()]
        unknown = [c for c in codes if c not in shifts]
        if unknown:
            failed.append({'row': line, 'error': f'Không có ca {", ".join(unknown)} (hoặc ca đã ngừng dùng).'})
            continue
        # "CA_SANG + CA_ONLINE": ca online (no_attendance_required) vào ô ca online thêm
        mains = [shifts[c] for c in codes if not shifts[c].no_attendance_required]
        extras = [shifts[c] for c in codes if shifts[c].no_attendance_required]
        if len(mains) > 2 or len(extras) > 1:
            failed.append({'row': line, 'error': 'Mỗi ngày tối đa 2 ca chấm công + 1 ca online.'})
            continue
        picked = mains + [None] * (2 - len(mains))
        try:
            _check_overlap(*picked)
        except PlanError as exc:
            failed.append({'row': line, 'error': str(exc)})
            continue
        if (employee.id, day) in cells:
            warnings.append({'row': line, 'warning': f'{code} ngày {day:%d/%m/%Y} xuất hiện nhiều lần — lấy dòng này.'})
        cells[(employee.id, day)] = (employee, picked[0], picked[1], extras[0] if extras else None)

    by_week = defaultdict(list)
    for (employee_id, day), (employee, shift, shift_2, extra) in cells.items():
        by_week[(employee, day - dt.timedelta(days=day.weekday()))].append((day, shift, shift_2, extra))
    now = timezone.now()
    created = updated = 0
    for (employee, week_start), days in by_week.items():
        plan, was_created = WeeklyShiftPlan.objects.update_or_create(
            employee=employee, week_start_date=week_start,
            defaults={'week_end_date': week_start + dt.timedelta(days=6), 'status': WeeklyShiftPlan.Status.APPROVED,
                      'source': WeeklyShiftPlan.Source.UPLOAD, 'approved_at': now, 'approved_by': actor,
                      'direct_manager_approved': True, 'direct_manager_approved_at': now,
                      'direct_manager_approved_by': actor},
        )
        created += int(was_created)
        updated += int(not was_created)
        for day, shift, shift_2, extra in days:
            WeeklyShiftPlanDay.objects.update_or_create(
                plan=plan, date=day, defaults={'shift': shift, 'shift_2': shift_2, 'extra_shift': extra})
    return {'total_rows': len(rows), 'imported_days': len(cells), 'created_plans': created,
            'updated_plans': updated, 'failed': failed, 'warnings': warnings}

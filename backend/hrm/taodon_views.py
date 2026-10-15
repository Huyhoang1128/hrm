
import uuid as _uuid

import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.views import APIView

logger = logging.getLogger(__name__)
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from django.db import models
from django.utils import timezone
from datetime import date, timedelta
from django.shortcuts import get_object_or_404

from .models import EmployeePermission, is_senior_manager, _is_hr, _has_approve_permission
from .models import (record_request_edit, soft_cancel_request, log_request_cancel,
                     reset_approval_for_privileged_edit)
from .models import CompanyConfig
from .constant import ExplanationType
from .pagination import StandardResultsSetPagination
from rest_framework import serializers as drf_serializers
from employee.models import Employee, Department, Position
from .models import Asset, AssetAssignmentHistory, AssetMaintenance, OnboardingDocumentTemplate
from .event_models import EmployeeEvent
from .attendance_models import OnlineWorkRequest
from .main_api import EmployeeState
from collections import defaultdict
from .serializers import (
    EmployeeSerializer, EmployeeCreateSerializer, EmployeeListSerializer,
    DepartmentSerializer, OnboardingDocumentTemplateListSerializer, OnboardingDocumentTemplateListSerializer, OnboardingDocumentTemplateSerializer, PositionSerializer,
    AssetSerializer, AssetListSerializer, AssetAssignmentHistorySerializer, AssetMaintenanceSerializer,
    OnboardingProcessListSerializer, OnboardingProcessDetailSerializer, OnboardingProcessCreateSerializer,
    OnboardingProcessUpdateSerializer, OnboardingTaskSerializer, OnboardingTaskUpdateSerializer,
    OnboardingChecklistSerializer, OnboardingDocumentSerializer, OnboardingDocumentUploadSerializer, EmployeeOnboardingFormSerializer,
)


# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

ATTENDANCE_STATUS_DISPLAY = {
    'PRESENT': 'Có mặt',
    'LATE': 'Đi muộn',
    'EARLY_LEAVE': 'Về sớm',
    'LATE_EARLY': 'Đi muộn/Về sớm',
    'ABSENT': 'Vắng mặt',
    'HALF_DAY': 'Nửa ngày',
    'INCOMPLETE_ATTENDANCE': 'Quên chấm công',
    "LEAVE": "Nghỉ phép tháng"
}


EXPECTED_STATUS_DISPLAY = {
    **ATTENDANCE_STATUS_DISPLAY,
    'PRESENT': 'Đủ công'
}

def serialize_explanation_event(event: EmployeeEvent, batch_results=None) -> dict:
    """Convert an EmployeeEvent (EXPLANATION type) to the explanation response dict."""
    d = event.data or {}
    emp = event.employee
    
    # Lấy thông tin vi phạm (ưu tiên từ kết quả tính toán hàng loạt)
    violation_info = {}
    if batch_results and event.id in batch_results:
        violation_info = batch_results[event.id]
    else:
        violation_info = _get_attendance_violation_info(emp, event.event_date, event)
    
    # Logic default cho đơn Nghỉ phép tháng (LEAVE)
    is_leave = d.get('explanation_type') == ExplanationType.LEAVE
    
    if is_leave:
        original_status = 'ABSENT'
        expected_status = d.get('expected_status', 'PRESENT')
    else:
        original_status = d.get('original_status') or ''
        expected_status = d.get('expected_status') or ''
    
    status_val = d.get('status', 'PENDING')
    status_display_map = {
        'DRAFT': 'Nháp',
        'PENDING': 'Chờ duyệt',
        'APPROVED': 'Đã duyệt',
        'REJECTED': 'Từ chối',
        'CANCELLED': 'Đã hủy',
    }
    from .stats_utils import get_employee_monthly_stats
    stats = get_employee_monthly_stats(emp, event.event_date)

    from .deadline_exception_models import can_owner_self_cancel
    # Chỉ Nghỉ phép tháng (LEAVE) và Công tác (BUSINESS_TRIP) có category
    # "loại chính" tương ứng bên DeadlineExceptionGrant — các loại giải trình
    # khác (LATE/EARLY_LEAVE/...) truyền None, can_owner_self_cancel() vẫn tự
    # xét được loại dự phòng CANCEL_EDIT_REQUEST_TYPE.
    _explanation_type_val = d.get('explanation_type')
    _grant_request_type = (
        'LEAVE' if is_leave
        else 'BUSINESS_TRIP' if _explanation_type_val == ExplanationType.BUSINESS_TRIP
        else None
    )

    return {
        'id': event.id,
        'request_code': d.get('request_code', ''),
        'employee': emp.id,
        'employee_id': emp.id,
        'employee_name': emp.full_name,
        'employee_code': emp.employee_id,
        'employee_is_hr': _is_hr(emp),
        'employee_is_senior_manager': is_senior_manager(emp),
        'employee_position': emp.position.title if emp.position else None,
        'position_name': emp.position.title if emp.position else None,
        'department_name': emp.department.name if emp.department else None,
        'attendance_date': str(event.event_date),
        'original_status': original_status,
        'original_status_display': ATTENDANCE_STATUS_DISPLAY.get(original_status, original_status),
        'expected_status': expected_status,
        'expected_status_display': EXPECTED_STATUS_DISPLAY.get(expected_status, expected_status),
        'explanation_type': d.get('explanation_type', ''),
        'reason': event.explanation or d.get('reason', ''),
        'half_day_period': d.get('half_day_period', ''),
        'actual_check_in': d.get('actual_check_in'),
        'actual_check_out': d.get('actual_check_out'),
        'expected_check_in': str(event.check_in) if event.check_in else None,
        'expected_check_out': str(event.check_out) if event.check_out else None,
        'forgot_punch_type': d.get('forgot_punch_type'),
        'forgot_checkin_time': d.get('forgot_checkin_time'),
        'forgot_checkout_time': d.get('forgot_checkout_time'),
        'status': status_val,
        'status_display': status_display_map.get(status_val, status_val),
        'can_self_cancel': can_owner_self_cancel(event, _grant_request_type),
        'approved_by_name': d.get('approved_by_name'),
        'approved_at': d.get('approved_at'),
        'approval_decision': d.get('approval_decision', ''),
        'approval_note': d.get('approval_note', ''),
        'direct_manager_approved': d.get('direct_manager_approved', False),
        'hr_approved': d.get('hr_approved', False),
        'direct_manager_approved_at': d.get('direct_manager_approved_at'),
        'hr_approved_at': d.get('hr_approved_at'),
        'direct_manager_approved_by_name': d.get('direct_manager_approved_by_name'),
        'hr_approved_by_name': d.get('hr_approved_by_name'),
        'rejected_by_name': d.get('rejected_by_name'),
        'rejected_at': d.get('rejected_at'),
        'rejection_level': d.get('rejection_level'),
        'hr_rejected_by_name': d.get('hr_rejected_by_name'),
        'hr_rejected_at': d.get('hr_rejected_at'),
        'direct_manager_rejected_by_name': d.get('direct_manager_rejected_by_name'),
        'direct_manager_rejected_at': d.get('direct_manager_rejected_at'),
        'employee_manager_id': emp.manager.id if emp.manager else None,

        'employee_manager_name': emp.manager.full_name if emp.manager else None,
        'employee_department_manager_id': (
            emp.department.manager.id
            if emp.department and emp.department.manager
            else None
        ),
        'employee_department_manager_name': (
            emp.department.manager.full_name
            if emp.department and emp.department.manager
            else None
        ),
        'submitted_at': d.get('submitted_at'),
        'start_date': d.get('start_date') or str(event.event_date),
        'end_date': d.get('end_date') or str(event.event_date),
        'created_at': event.created_at.isoformat(),
        'updated_at': event.updated_at.isoformat(),
        'created_by': event.created_by.full_name if event.created_by else None,
        'created_by_name': event.created_by.full_name if event.created_by else None,
        'is_hr_created': _is_hr(event.created_by) if event.created_by else False,
        **stats,
        **violation_info
    }

def _get_attendance_violation_info(employee, date, event=None):
    """
    Lấy thông tin vi phạm (phút muộn/sớm, tiền phạt) từ EmployeeEvent.
    Nguồn: CHECKIN/CHECKOUT event → data snapshot → LATE_ARRIVAL/EARLY_LEAVE event.
    Không còn dùng bảng Attendance hay AttendanceEventLog.
    """
    info = {
        'late_minutes': 0,
        'early_leave_minutes': 0,
        'penalty_amount': 0,
        'violation_notes': []
    }
    
    if not date:
        return info

    try:
        # Lấy loại giải trình từ EmployeeEvent để biết có phải đơn vi phạm không
        explanation_type = ""
        if event and event.event_type == EmployeeEvent.EventType.EXPLANATION:
            # Ưu tiên lấy từ EmployeeEvent.data (đã lưu khi tạo đơn)
            explanation_type = (event.data or {}).get('explanation_type', '')
        elif not event:
            # Nếu không có event, tra cứu EmployeeEvent EXPLANATION mới nhất cho ngày đó
            ee = (
                EmployeeEvent.objects
                .filter(
                    employee=employee,
                    event_date=date,
                    event_type=EmployeeEvent.EventType.EXPLANATION,
                )
                .order_by('-created_at')
                .first()
            )
            if ee and ee.data:
                explanation_type = ee.data.get('explanation_type', '')

        # ──────────────────────────────────────────────────────────────────────
        # 1. Tra cứu EmployeeEvent ATTENDANCE của ngày đó
        # Event ATTENDANCE lưu late_minutes / early_leave_minutes trong data
        # ──────────────────────────────────────────────────────────────────────
        attendance_event = (
            EmployeeEvent.objects
            .filter(
                employee=employee,
                event_date=date,
                event_type=EmployeeEvent.EventType.ATTENDANCE,
            )
            .order_by('-created_at')
            .first()
        )

        if attendance_event and attendance_event.data:
            d_att = attendance_event.data
            info['late_minutes']        = int(d_att.get('late_minutes', 0) or 0)
            info['early_leave_minutes'] = int(d_att.get('early_leave_minutes', 0) or 0)

        # ──────────────────────────────────────────────────────────────────────
        # 2. Nếu vẫn là 0, tra snapshot trong event.data (dữ liệu lúc tạo đơn)
        # ──────────────────────────────────────────────────────────────────────
        if event and event.data and (info['late_minutes'] == 0 and info['early_leave_minutes'] == 0):
            d = event.data
            info['late_minutes']        = d.get('late_minutes') or d.get('late_min') or d.get('late_minutes_snapshot') or 0
            info['early_leave_minutes'] = d.get('early_leave_minutes') or d.get('early_min') or d.get('early_minutes_snapshot') or 0

        # ──────────────────────────────────────────────────────────────────────
        # 3. Fallback: quét tất cả ATTENDANCE events trong ngày tìm late/early
        # ──────────────────────────────────────────────────────────────────────
        if info['late_minutes'] == 0 and info['early_leave_minutes'] == 0:
            for ae in EmployeeEvent.objects.filter(
                employee=employee,
                event_date=date,
                event_type=EmployeeEvent.EventType.ATTENDANCE,
            ):
                ae_data = ae.data or {}
                late  = ae_data.get('late_minutes') or ae_data.get('late_min') or 0
                early = ae_data.get('early_leave_minutes') or ae_data.get('early_min') or 0
                info['late_minutes']        = max(info['late_minutes'], int(late))
                info['early_leave_minutes'] = max(info['early_leave_minutes'], int(early))

        # ──────────────────────────────────────────────────────────────────────
        # Áp dụng bộ lọc theo explanation_type
        # ──────────────────────────────────────────────────────────────────────
        if explanation_type == ExplanationType.LATE:
            info['early_leave_minutes'] = 0
        elif explanation_type == ExplanationType.EARLY_LEAVE:
            info['late_minutes'] = 0
        # Nếu là loại khác (ví dụ: INCOMPLETE_ATTENDANCE, LEAVE) hoặc không có explanation_type, giữ nguyên cả hai

        # ──────────────────────────────────────────────────────────────────────
        # 4. Tính vi phạm trong tháng: đếm ngày có ATTENDANCE event có late/early > 0
        # ──────────────────────────────────────────────────────────────────────
        violation_count = EmployeeEvent.objects.filter(
            employee=employee,
            event_date__year=date.year,
            event_date__month=date.month,
            event_date__lte=date,
            event_type=EmployeeEvent.EventType.ATTENDANCE,
        ).filter(
            models.Q(data__late_minutes__gt=0) | models.Q(data__early_leave_minutes__gt=0)
        ).values('event_date').distinct().count()

        # ──────────────────────────────────────────────────────────────────────
        # 5. Tính tiền phạt
        # ──────────────────────────────────────────────────────────────────────
        from .attendance_engine import calculate_penalty_preview
        is_manager = getattr(employee.position, 'is_management', False) if employee.position else False
        penalty = calculate_penalty_preview(
            late_minutes=int(info['late_minutes']),
            early_minutes=int(info['early_leave_minutes']),
            violation_count_month=max(1, violation_count),
            is_manager=is_manager,
            date=date
        )
        info['penalty_amount']  = penalty.get('penalty_amount_vnd', 0)
        info['violation_notes'] = penalty.get('notes', [])

    except Exception as e:
        import traceback
        print(f"Error fetching attendance violation info: {e}")
        traceback.print_exc()

    return info

def _batch_get_violation_info(explanation_events):
    """
    Tính toán hàng loạt thông tin vi phạm cho danh sách các đơn giải trình.
    Sử dụng EmployeeState.replay_month để đồng bộ logic với calendar-view.
    """
    if not explanation_events:
        return {}
        
    # Nhóm theo nhân viên và tháng để tối ưu số lần gọi replay_month
    groups = defaultdict(list)
    for event in explanation_events:
        groups[(event.employee.employee_id, event.event_date.year, event.event_date.month)].append(event)
    
    results = {}
    for (emp_code, year, month), events in groups.items():
        try:
            # Replay cho cả tháng của nhân viên đó
            replay_data = EmployeeState.replay_month(emp_code, year, month)
            calendar = replay_data.get('calendar', [])
            
            # Index kết quả theo ngày và loại event
            # Chúng ta cần 'attendance' effects của ngày đó
            day_map = {}
            for entry in calendar:
                dt_str = entry.get('date')
                # Ưu tiên effects từ event attendance (nơi chứa late_minutes/early_leave_minutes)
                if entry.get('event_type') == 'attendance':
                    eff = entry.get('effects', {})
                    if dt_str not in day_map:
                        day_map[dt_str] = {
                            'late_minutes': 0, 
                            'early_leave_minutes': 0, 
                            'penalty_amount': 0,
                            'late_penalty': 0,
                            'early_leave_penalty': 0,
                            'violation_notes': [],
                            'violation_count': 0
                        }
                    
                    dm = day_map[dt_str]
                    dm['late_minutes'] += int(eff.get('late_minutes', 0))
                    dm['early_leave_minutes'] += int(eff.get('early_leave_minutes', 0))
                    dm['penalty_amount'] += eff.get('tong_phat', 0)
                    dm['late_penalty'] += eff.get('late_penalty', 0)
                    dm['early_leave_penalty'] += eff.get('early_leave_penalty', 0)
                    
                    if entry.get('rules_applied'):
                        dm['violation_notes'].extend([r.get('rule_name') for r in entry.get('rules_applied', []) if isinstance(r, dict)])

                    # Cập nhật số lần vi phạm chốt tại entry này
                    state_after = entry.get('state_after', {})
                    dm['violation_count'] = state_after.get('di_muon_ve_som', 0) + state_after.get('quen_cham_cong', 0)

                elif dt_str not in day_map:
                     # Nếu chưa có attendance entry, lấy state sau cùng của ngày đó làm dự phòng
                     day_map[dt_str] = {
                        'late_minutes': 0, 
                        'early_leave_minutes': 0, 
                        'penalty_amount': 0,
                        'late_penalty': 0,
                        'early_leave_penalty': 0,
                        'violation_notes': [],
                        'violation_count': 0
                    }
            
            # Gán kết quả vào ID của đơn giải trình
            # QUAN TRỌNG: Lọc theo explanation_type của từng đơn để tránh hiển thị nhầm
            for event in events:
                date_str = event.event_date.isoformat()
                raw = day_map.get(date_str, {
                    'late_minutes': 0, 'early_leave_minutes': 0,
                    'penalty_amount': 0, 'late_penalty': 0, 'early_leave_penalty': 0,
                    'violation_notes': [], 'violation_count': 0
                })

                explanation_type = (event.data or {}).get('explanation_type', '')
                
                # Ưu tiên sử dụng kết quả đã tính toán từ engine (đã bao gồm hệ số nhân x2, x3...)
                if explanation_type == ExplanationType.LATE:
                    late_out, early_out = raw['late_minutes'], 0
                    penalty_amount = raw['late_penalty']
                elif explanation_type == ExplanationType.EARLY_LEAVE:
                    late_out, early_out = 0, raw['early_leave_minutes']
                    penalty_amount = raw['early_leave_penalty']
                else:
                    # LATE_EARLY, INCOMPLETE_ATTENDANCE, LEAVE, v.v.
                    late_out, early_out = raw['late_minutes'], raw['early_leave_minutes']
                    penalty_amount = raw['penalty_amount']

                results[event.id] = {
                    'late_minutes':        late_out,
                    'early_leave_minutes': early_out,
                    'penalty_amount':      penalty_amount,
                    'violation_notes':     raw['violation_notes'],
                    'violation_count':     raw.get('violation_count', 0),
                }

        except Exception as e:
            print(f"Error batch calculating violations for {emp_code}: {e}")
            for event in events:
                results[event.id] = {
                    'late_minutes': 0, 'early_leave_minutes': 0,
                    'penalty_amount': 0, 'violation_notes': [], 'violation_count': 0,
                }
    return results


def _check_explanation_approve_deadline(event, bypass: bool) -> str | None:
    """Chặn DUYỆT đơn Nghỉ phép tháng/Công tác quá hạn — đọc lại mốc đã
    snapshot lúc tạo đơn (`data['advance_deadline']`, tính 1 lần ở
    ExplanationEventCreateSerializer.validate() để tránh lệch nếu "hôm nay"
    đổi giữa lúc tạo và lúc duyệt). Dùng chung cho approve() VÀ bulk_approve()
    của cả AttendanceExplanationViewSet (Công tác) lẫn MonthlyLeaveViewSet
    (Nghỉ phép tháng) — trước đây bulk_approve hoàn toàn không kiểm tra, khác
    hẳn nút duyệt từng đơn. `bypass=True` (Admin/HR) luôn được bỏ qua.

    Các loại giải trình khác (LATE/EARLY_LEAVE/INCOMPLETE_ATTENDANCE/FIRST_DAY)
    không có `advance_deadline` trong data nên hàm này tự động no-op (None).

    LƯU Ý (đã từng thiếu, gây bug thật 2026-09-16): phải kiểm tra
    has_deadline_exception() ở ĐÂY nữa — trước đó chỉ có validate() (lúc tạo
    đơn) tự check "Mở khoá đặc biệt", còn hàm này (lúc duyệt) hoàn toàn không
    biết đến bảng DeadlineExceptionGrant, nên HCNS mở khoá xong quản lý vẫn bị
    chặn y hệt khi bấm duyệt.
    """
    if bypass:
        return None
    d = event.data or {}
    from .deadline_utils import is_locked_effective
    advance_deadline_str = d.get('advance_deadline')
    if not (is_locked_effective() and advance_deadline_str):
        return None

    from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
    explanation_type = d.get('explanation_type')
    grant_request_type = {
        ExplanationType.LEAVE: 'LEAVE',
        ExplanationType.BUSINESS_TRIP: 'BUSINESS_TRIP',
    }.get(explanation_type)
    if has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE):
        return None
    if grant_request_type and has_deadline_exception(event.employee, event.event_date, grant_request_type):
        return None

    from datetime import datetime as _datetime
    deadline_dt = _datetime.fromisoformat(advance_deadline_str)
    if timezone.now() > deadline_dt:
        return (f'Đã quá hạn duyệt đơn (phải duyệt trước '
                f'{deadline_dt.strftime("%H:%M %d/%m/%Y")}). '
                f'Chỉ HCNS/Admin mới có thể duyệt ngoại lệ trường hợp này.')
    return None


def _generate_explanation_code(attendance_date=None, explanation_type=None) -> str:
    """Generate a unique request code for an explanation event.

    Uses the attendance_date month (not today) so codes are correctly
    scoped to the month the explanation covers.
    """
    if attendance_date is not None:
        year_month = attendance_date.strftime('%Y%m')
    else:
        year_month = timezone.now().strftime('%Y%m')
    
    prefix = "NPM" if explanation_type == ExplanationType.LEAVE else "ATT-EXPL"
    return f"{prefix}-{year_month}-{str(_uuid.uuid4())[:8].upper()}"


class ExplanationEventCreateSerializer(drf_serializers.Serializer):
    """Input serializer for POST /api-hrm/attendance-explanations/."""
    employee_id = drf_serializers.IntegerField()
    attendance_date = drf_serializers.DateField()
    # Chỉ dùng cho Nghỉ phép tháng (explanation_type=LEAVE): cho phép chọn 1
    # khoảng ngày liên tiếp (attendance_date = ngày bắt đầu) thay vì phải tạo
    # từng đơn 1 ngày một — mượn đúng pattern multi-day đã có ở
    # UNAUTHORIZED_ABSENCE (registration_serializers.py).
    end_date = drf_serializers.DateField(required=False, allow_null=True, default=None)
    original_status = drf_serializers.CharField()
    expected_status = drf_serializers.CharField()
    explanation_type = drf_serializers.CharField(required=False, allow_blank=True, default='')
    reason = drf_serializers.CharField(required=False, allow_blank=True, default='')
    # Chỉ dùng khi expected_status=HALF_DAY (hiện chỉ áp dụng Nghỉ phép
    # tháng): buổi nghỉ là sáng hay chiều — BẮT BUỘC dùng field riêng này
    # thay vì suy đoán qua chữ "sáng"/"chiều" trong `reason` (trước đây làm
    # vậy: nếu nhân sự gõ ghi chú riêng không chứa đúng chữ "chiều", hạn tạo
    # đơn bị tính nhầm theo ca sáng — hạn sẽ sớm hơn thực tế rất nhiều, có
    # thể coi như "đã quá hạn" ngay từ sáng hôm đó). FE cũ chưa gửi field
    # này thì validate() bên dưới fallback lại đúng cách cũ (suy đoán qua
    # `reason`) để không vỡ tương thích ngược.
    half_day_period = drf_serializers.CharField(required=False, allow_blank=True, default='')
    actual_check_in = drf_serializers.TimeField(required=False, allow_null=True, default=None)
    actual_check_out = drf_serializers.TimeField(required=False, allow_null=True, default=None)
    expected_check_in = drf_serializers.TimeField(required=False, allow_null=True, default=None)
    expected_check_out = drf_serializers.TimeField(required=False, allow_null=True, default=None)
    status = drf_serializers.CharField(required=False, default='PENDING')
    forgot_punch_type = drf_serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    forgot_checkin_time = drf_serializers.TimeField(required=False, allow_null=True, default=None)
    forgot_checkout_time = drf_serializers.TimeField(required=False, allow_null=True, default=None)

    def validate_employee_id(self, value):
        if not Employee.objects.filter(id=value).exists():
            raise drf_serializers.ValidationError(f'Employee with ID {value} does not exist')
        return value

    def validate(self, data):
        explanation_type = data.get('explanation_type')
        attendance_date = data.get('attendance_date')
        employee_id = data.get('employee_id')
        reason = data.get('reason', '').strip()

        # Enforce reason for all types except INCOMPLETE_ATTENDANCE and LEAVE
        if explanation_type not in [ExplanationType.INCOMPLETE_ATTENDANCE, ExplanationType.LEAVE] and not reason:
            raise drf_serializers.ValidationError({'reason': 'Ghi chú là bắt buộc cho loại giải trình này.'})

        # Chặn đơn giải trình vi phạm TRÙNG cùng ngày: mỗi đơn được duyệt hoàn
        # lại tiền phạt của ngày đó, nên 2 đơn trùng từng làm hoàn phạt 2 lần
        # (NV80002 30/09/2026: 2 đơn Đi muộn cách nhau 4 phút -> tổng phạt -50.000đ).
        # Chỉ Đi muộn/Về sớm — quên chấm công sáng + chiều là 2 đơn hợp lệ cùng ngày.
        if explanation_type in (ExplanationType.LATE, ExplanationType.EARLY_LEAVE) and attendance_date and employee_id:
            existing_event = EmployeeEvent.objects.filter(
                employee_id=employee_id,
                event_type=EmployeeEvent.EventType.EXPLANATION,
                event_date=attendance_date,
                data__explanation_type=explanation_type,
                data__status__in=['PENDING', 'APPROVED'],
            ).first()
            if existing_event:
                existing = existing_event.data or {}
                raise drf_serializers.ValidationError({
                    'attendance_date': (
                        f"Ngày {attendance_date.strftime('%d/%m/%Y')} đã có đơn giải trình loại này "
                        f"({existing.get('request_code') or 'đang chờ/đã duyệt'}). "
                        "Vui lòng sửa đơn đã tạo thay vì tạo đơn mới."
                    )
                })

        # 1. Kiểm tra logic Nghỉ phép tháng (LEAVE): giới hạn theo CompanyConfig
        end_date = data.get('end_date')
        is_multiday_leave = bool(
            explanation_type == ExplanationType.LEAVE and end_date and end_date != attendance_date
        )
        if is_multiday_leave:
            if end_date < attendance_date:
                raise drf_serializers.ValidationError(
                    {'end_date': 'Ngày kết thúc phải từ ngày bắt đầu trở đi'}
                )
            if (end_date - attendance_date).days >= 60:
                raise drf_serializers.ValidationError(
                    {'end_date': 'Khoảng ngày nghỉ phép tối đa 60 ngày'}
                )
            # CHỦ Ý: KHÔNG áp dụng max_leave_count_per_month (hạn mức phép "linh
            # hoạt trong tháng", mặc định ~1 ngày/tháng, thiết kế cho nghỉ 1
            # ngày/nửa ngày) cho nghỉ NHIỀU NGÀY — 2 cơ chế khác bản chất
            # (nghỉ nhiều ngày thường trừ vào phép năm `annual_leave_balance`,
            # không phải quota tháng này). Việc trừ phép năm khi duyệt đơn
            # nhiều ngày chưa được nối dây ở đây — nằm ngoài phạm vi xử lý
            # deadline lần này, cần làm riêng.
        elif explanation_type == ExplanationType.LEAVE:
            if attendance_date and employee_id:
                _cfg = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
                max_leave = float(_cfg.max_leave_count_per_month) if _cfg else 1.0

                existing_leaves = EmployeeEvent.objects.filter(
                    employee_id=employee_id,
                    event_type=EmployeeEvent.EventType.EXPLANATION,
                    data__explanation_type=ExplanationType.LEAVE,
                    data__status='APPROVED',
                    event_date__year=attendance_date.year,
                    event_date__month=attendance_date.month
                )

                total_used = sum(
                    0.5 if (e.data or {}).get('expected_status') == 'HALF_DAY' else 1.0
                    for e in existing_leaves
                )

                requested_credit = 0.5 if data.get('expected_status') == 'HALF_DAY' else 1.0

                if total_used + requested_credit > max_leave + 0.01:
                    raise drf_serializers.ValidationError({
                        'non_field_errors': [f'Bạn đã dùng {total_used} ngày phép tháng. Hạn mức tối đa là {max_leave} ngày/tháng.']
                    })

        # ── Khoá hạn tạo đơn nghỉ phép theo quy định thời hạn tạo/duyệt đơn, hiệu
        # lực từ 09/09/2026 (xem hrm/deadline_utils.py::leave_deadline) —
        # Admin/HR tự tạo hộ được bỏ qua ("HCNS mở cho trường hợp đặc biệt").
        if explanation_type == ExplanationType.LEAVE and attendance_date and employee_id:
            from .deadline_utils import (
                is_locked_effective, leave_deadline, hours_before_deadline, get_shift_start_time,
                _combine_aware,
            )
            request_ctx = self.context.get('request')
            is_admin_or_hr_creator = bool(
                request_ctx and (
                    request_ctx.user.is_staff or request_ctx.user.is_superuser
                    or _is_hr(Employee.objects.filter(user=request_ctx.user).first())
                )
            )
            from .deadline_utils import in_backlog_grace_period
            from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
            employee_obj_for_grant = Employee.objects.filter(id=employee_id).first()
            # "Mở khoá đặc biệt" HCNS cấp cho đúng NV/ngày này (loại LEAVE)
            # — hoặc loại "Huỷ/Sửa đơn đã duyệt" (CANCEL_EDIT_REQUEST_TYPE),
            # vd dùng khi HCNS cho phép nhân sự chuyển đổi đơn Nghỉ không
            # phép đã duyệt thành Nghỉ phép tháng (hoặc ngược lại) sau khi
            # ngày đó đã qua hạn tạo đơn bình thường — luồng "Đổi loại đơn"
            # cần cả huỷ đơn cũ (dùng grant CANCEL_EDIT) LẪN tạo đơn mới quá
            # hạn (ở đây).
            if (
                is_locked_effective() and not is_admin_or_hr_creator
                and not in_backlog_grace_period(attendance_date)
                and not has_deadline_exception(employee_obj_for_grant, attendance_date, 'LEAVE')
                and not has_deadline_exception(employee_obj_for_grant, attendance_date, CANCEL_EDIT_REQUEST_TYPE)
            ):
                employee_obj = employee_obj_for_grant
                if is_multiday_leave:
                    total_days = (end_date - attendance_date).days + 1
                    deadline = leave_deadline(attendance_date, total_days, employee_obj)
                elif data.get('expected_status') == 'HALF_DAY':
                    explicit_period = str(data.get('half_day_period') or '').strip().upper()
                    if explicit_period in ('MORNING', 'AFTERNOON'):
                        half = explicit_period
                    else:
                        # Fallback cho request cũ (FE chưa gửi half_day_period)
                        half = 'AFTERNOON' if str(data.get('reason', '')).lower().find('chiều') >= 0 else 'MORNING'
                    shift_start = get_shift_start_time(employee_obj, attendance_date, half=half) if employee_obj else None
                    deadline = hours_before_deadline(_combine_aware(attendance_date, shift_start), 4) if shift_start else None
                else:
                    deadline = leave_deadline(attendance_date, 1, employee_obj)

                # HCNS chốt lại 2026-09-28 (Quy định thời gian tạo đơn trên
                # HRM, mục II.1): BỎ cơ chế tự động nới hạn 3h-sau-khi-đi-làm-
                # trở-lại cho Nghỉ phép/Nghỉ không lương — trường hợp phát
                # sinh đột xuất (không kịp báo trước theo bậc thang) nay phải
                # được HCNS cấp quyền THỦ CÔNG qua "Mở khoá đặc biệt"
                # (has_deadline_exception, đã check ở điều kiện bao ngoài
                # khối if này), KHÔNG còn tự động cho qua trong vòng 3 giờ
                # nữa. Quá hạn báo trước bình thường (leave_deadline) là bị
                # chặn thẳng, bất kể ngày nghỉ đã qua hay chưa.
                if deadline and timezone.now() > deadline:
                    msg = (f'Đã quá hạn tạo đơn nghỉ phép (phải tạo trước '
                           f'{deadline.strftime("%H:%M %d/%m/%Y")}).')
                    # Giữ dấu vết lần bấm bị chặn — xem hrm/violation_models.py
                    from .violation_models import log_blocked_attempt, actor_employee
                    log_blocked_attempt(
                        employee=employee_obj, event_date=attendance_date,
                        request_type='LEAVE', deadline=deadline,
                        error_message=msg, attempted_by=actor_employee(request_ctx),
                        end_date=str(end_date) if is_multiday_leave and end_date else None,
                        expected_status=data.get('expected_status') or '',
                        half_day_period=data.get('half_day_period') or '',
                    )
                    raise drf_serializers.ValidationError({'attendance_date': msg})
                data['_advance_deadline'] = deadline.isoformat() if deadline else None

        # ── Khoá hạn tạo đơn công tác theo Thông báo mục II.5 — Admin/HR tự
        # tạo hộ được bỏ qua. Hiện FE mới chỉ hỗ trợ công tác 1 ngày (không
        # có chọn khoảng ngày) nên chỉ 2 trường hợp: nửa ngày (2 giờ trước
        # giờ bắt đầu buổi) và 1 ngày (1 ngày làm việc trước).
        elif explanation_type == ExplanationType.BUSINESS_TRIP and attendance_date and employee_id:
            from .deadline_utils import (
                is_locked_effective, business_trip_deadline, hours_before_deadline,
                get_shift_start_time, _combine_aware,
            )
            request_ctx = self.context.get('request')
            is_admin_or_hr_creator = bool(
                request_ctx and (
                    request_ctx.user.is_staff or request_ctx.user.is_superuser
                    or _is_hr(Employee.objects.filter(user=request_ctx.user).first())
                )
            )
            from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
            from .deadline_utils import in_backlog_grace_period
            employee_obj_for_grant = Employee.objects.filter(id=employee_id).first()
            # HCNS cho phép bổ sung nốt đơn Công tác phát sinh trước ngày
            # hiệu lực mà nhân sự chưa kịp tạo (chỉ trong thời gian ân hạn —
            # xem BACKLOG_GRACE_PERIOD_END). Trước đây comment ở deadline_utils
            # nói ÁP DỤNG cho Công tác nhưng code chưa từng nối vào đây — bổ
            # sung đúng theo thiết kế gốc + yêu cầu HCNS 2026-09-16/17.
            if (
                is_locked_effective() and not is_admin_or_hr_creator
                and not in_backlog_grace_period(attendance_date)
                and not has_deadline_exception(employee_obj_for_grant, attendance_date, 'BUSINESS_TRIP')
                and not has_deadline_exception(employee_obj_for_grant, attendance_date, CANCEL_EDIT_REQUEST_TYPE)
            ):
                employee_obj = employee_obj_for_grant
                if data.get('expected_status') == 'HALF_DAY':
                    explicit_period = str(data.get('half_day_period') or '').strip().upper()
                    if explicit_period in ('MORNING', 'AFTERNOON'):
                        half = explicit_period
                    else:
                        # Fallback cho request cũ (FE chưa gửi half_day_period)
                        half = 'AFTERNOON' if str(data.get('reason', '')).lower().find('chiều') >= 0 else 'MORNING'
                    shift_start = get_shift_start_time(employee_obj, attendance_date, half=half) if employee_obj else None
                    deadline = hours_before_deadline(_combine_aware(attendance_date, shift_start), 2) if shift_start else None
                else:
                    deadline = business_trip_deadline(attendance_date, 1, employee_obj)
                if deadline and timezone.now() > deadline:
                    raise drf_serializers.ValidationError({
                        'attendance_date': f'Đã quá hạn tạo đơn công tác (phải tạo trước '
                                           f'{deadline.strftime("%H:%M %d/%m/%Y")}).'
                    })
                data['_advance_deadline'] = deadline.isoformat() if deadline else None

        # 2. Kiểm tra quota giải trình công (LATE, EARLY_LEAVE, LATE_EARLY, INCOMPLETE_ATTENDANCE):
        elif explanation_type in [ExplanationType.LATE, ExplanationType.EARLY_LEAVE,
                                  ExplanationType.LATE_EARLY, ExplanationType.INCOMPLETE_ATTENDANCE]:
            # Đã phản hồi: Cho phép gửi đơn, hệ thống sẽ tự động từ chối nếu hết quota
            pass


            
        return data

    def create(self, validated_data):
        employee = Employee.objects.get(id=validated_data['employee_id'])
        check_in = validated_data.get('expected_check_in')
        check_out = validated_data.get('expected_check_out')
        actual_in = validated_data.get('actual_check_in')
        actual_out = validated_data.get('actual_check_out')
        attendance_date = validated_data['attendance_date']
        end_date = validated_data.get('end_date')
        forgot_punch_type = validated_data.get('forgot_punch_type')
        forgot_checkin_time = validated_data.get('forgot_checkin_time')
        forgot_checkout_time = validated_data.get('forgot_checkout_time')

        explanation_type = validated_data.get('explanation_type', '')
        status_val = validated_data.get('status', 'PENDING')
        advance_deadline = validated_data.get('_advance_deadline')

        # Nghỉ phép NHIỀU NGÀY liên tiếp (chỉ LEAVE, end_date != attendance_date):
        # 1 request_code dùng chung, mỗi ngày trong khoảng là 1 EmployeeEvent
        # riêng — mượn đúng pattern đã có ở UNAUTHORIZED_ABSENCE
        # (registration_serializers.py) để tái sử dụng nguyên vẹn logic
        # duyệt/tính công hiện có (vốn hoạt động theo từng ngày một).
        if explanation_type == ExplanationType.LEAVE and end_date and end_date != attendance_date:
            request_code = _generate_explanation_code(attendance_date, explanation_type)
            created_events = []
            cur = attendance_date
            while cur <= end_date:
                created_events.append(EmployeeEvent.objects.create(
                    employee=employee,
                    event_date=cur,
                    event_type=EmployeeEvent.EventType.EXPLANATION,
                    explanation=validated_data.get('reason', ''),
                    created_by=validated_data.get('created_by'),
                    data={
                        'request_code': request_code,
                        'date': cur.isoformat(),
                        'start_date': attendance_date.isoformat(),
                        'end_date': end_date.isoformat(),
                        'original_status': validated_data['original_status'],
                        'expected_status': validated_data['expected_status'],
                        'explanation_type': explanation_type,
                        'reason': validated_data.get('reason', ''),
                        'half_day_period': validated_data.get('half_day_period', ''),
                        'status': status_val,
                        'direct_manager_approved': False,
                        'hr_approved': False,
                        'advance_deadline': advance_deadline,
                    },
                ))
                cur += timedelta(days=1)
            return {'created': created_events}

        event = EmployeeEvent.objects.create(
            employee=employee,
            event_date=attendance_date,
            event_type=EmployeeEvent.EventType.EXPLANATION,
            explanation=validated_data.get('reason', ''),
            check_in=check_in,
            check_out=check_out,
            created_by=validated_data.get('created_by'),
            data={
                'request_code': _generate_explanation_code(attendance_date, explanation_type),
                'date': attendance_date.isoformat(),
                'original_status': validated_data['original_status'],
                'expected_status': validated_data['expected_status'],
                'explanation_type': explanation_type,
                'reason': validated_data.get('reason', ''),
                'half_day_period': validated_data.get('half_day_period', ''),
                'actual_check_in': str(actual_in) if actual_in else None,
                'actual_check_out': str(actual_out) if actual_out else None,
                'forgot_punch_type': forgot_punch_type or None,
                'forgot_checkin_time': str(forgot_checkin_time) if forgot_checkin_time else None,
                'forgot_checkout_time': str(forgot_checkout_time) if forgot_checkout_time else None,
                'status': status_val,
                'direct_manager_approved': False,
                'hr_approved': False,
                **({'advance_deadline': advance_deadline} if explanation_type in (ExplanationType.LEAVE, ExplanationType.BUSINESS_TRIP) else {}),
            },
        )
        return event






# ─────────────────────────────────────────────────────────────────────────────
# ATTENDANCE EXPLANATION VIEWSET  (backed by EmployeeEvent)
# ─────────────────────────────────────────────────────────────────────────────

def _create_approval_event(explanation_event, approver, approval_level, action, note, now_str):
    """Create an EXPLANATION_APPROVAL EmployeeEvent that references the original request."""
    original_data = explanation_event.data or {}
    EmployeeEvent.objects.create(
        employee=explanation_event.employee,
        event_date=explanation_event.event_date,
        event_type=EmployeeEvent.EventType.EXPLANATION_APPROVAL,
        reference_event=explanation_event,
        data={
            'approved_for_event_id': explanation_event.id,
            'explanation_type': original_data.get('explanation_type', ''),
            'date': original_data.get('date') or str(explanation_event.event_date),
            'expected_status': original_data.get('expected_status', ''),
            'forgot_punch_type': original_data.get('forgot_punch_type', ''),
            'forgot_checkin_time': original_data.get('forgot_checkin_time', ''),
            'forgot_checkout_time': original_data.get('forgot_checkout_time', ''),
            'actual_check_in': original_data.get('actual_check_in', ''),
            'actual_check_out': original_data.get('actual_check_out', ''),
            'approval_level': approval_level,
            'action': action,
            'note': note,
            'approved_by_id': approver.id,
            'approved_by_name': approver.full_name,
            'approved_at': now_str,
        },
    )


from .finalization_lock_mixin import FinalizationLockMixin


class AttendanceExplanationViewSet(FinalizationLockMixin, viewsets.ViewSet):
    """
    ViewSet cho attendance explanations lưu trực tiếp vào EmployeeEvent.

    POST   – Tạo đơn giải trình → lưu vào EmployeeEvent (EXPLANATION).
    GET    – Danh sách, hỗ trợ ?status=PENDING&employee_id=...
    GET <pk>/ – Chi tiết
    POST <pk>/approve/ – Duyệt 2 bước (quản lý → HR)
    POST <pk>/reject/  – Từ chối
    POST <pk>/submit_for_approval/ – Nộp đơn nháp để duyệt
    GET stats/ – Thống kê
    GET employee_remaining_count/ – Số giải trình còn lại trong tháng

    Khi duyệt, thêm EmployeeEvent EXPLANATION_APPROVAL (reference_event trỏ về
    đơn gốc) để giữ lịch sử duyệt mà không cần bảng AttendanceExplanation.
    """

    permission_classes = [IsAuthenticated]

    def _base_qs(self):
        return (
            EmployeeEvent.objects
            .filter(event_type=EmployeeEvent.EventType.EXPLANATION)
            .exclude(data__explanation_type=ExplanationType.LEAVE)
            .select_related(
                'employee',
                'employee__manager',
                'employee__department',
                'employee__department__manager',
                'employee__position',
            )
        )

    def _get_current_employee(self, request):
        try:
            return Employee.objects.get(user=request.user)
        except Employee.DoesNotExist:
            return None

    def _apply_permission_filter(self, qs, request):
        """Filter queryset based on user permissions."""
        current_user = request.user
        current_employee = self._get_current_employee(request)
        if current_employee is None:
            return qs.none()

        is_admin = current_user.is_staff or current_user.is_superuser
        is_hr = _is_hr(current_employee)

        # 1. Admin: Thấy tất cả
        if is_admin:
            return qs

        # Lấy danh sách nhân viên cấp dưới (nếu là manager)
        sub_ids = list(Employee.objects.filter(
            models.Q(manager=current_employee) | models.Q(department__manager=current_employee)
        ).values_list('id', flat=True))

        if is_hr:
            return qs.filter(
                models.Q(employee_id=current_employee.id) | # Đơn của chính mình
                models.Q(employee_id__in=sub_ids) | # Đơn của cấp dưới
                models.Q(data__status__in=['APPROVED', 'REJECTED']) | # Toàn bộ đơn đã xử lý xong
                models.Q(data__status='PENDING', data__direct_manager_approved=True) # Đơn chờ HR duyệt sau QLTT
            ).distinct()



        # 3. Manager/Staff: Thấy đơn của mình + đơn của cấp dưới trực tiếp
        # Chỉ lấy những người báo cáo TRỰC TIẾP cho manager này
        direct_sub_ids = list(Employee.objects.filter(manager=current_employee).values_list('id', flat=True))
        
        return qs.filter(
            models.Q(employee_id=current_employee.id) |  # Đơn của chính mình
            models.Q(employee_id__in=direct_sub_ids)     # Đơn của cấp dưới trực tiếp
        ).distinct()

    def _apply_filters(self, qs, request):
        """Apply query param filters to queryset."""
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(data__status=status_filter)

        employee_id = request.query_params.get('employee_id')
        if employee_id:
            qs = qs.filter(employee_id=employee_id)

        department_id = request.query_params.get('department_id')
        if department_id:
            qs = qs.filter(employee__department_id=department_id)

        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        if start_date and end_date:
            qs = qs.filter(event_date__gte=start_date, event_date__lte=end_date)
        elif start_date:
            qs = qs.filter(event_date__gte=start_date)
        elif end_date:
            qs = qs.filter(event_date__lte=end_date)

        month = request.query_params.get('month')
        year = request.query_params.get('year')
        if month and year:
            qs = qs.filter(event_date__year=year, event_date__month=month)

        ordering = request.query_params.get('ordering', '-created_at')
        field = ordering.lstrip('-')
        valid_ordering_fields = {'created_at', 'updated_at', 'event_date'}
        if field in valid_ordering_fields:
            qs = qs.order_by(ordering)
        else:
            qs = qs.order_by('-created_at')

        return qs

    def list(self, request):
        qs = self._apply_permission_filter(self._base_qs(), request)
        qs = self._apply_filters(qs, request)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(qs, request)
        if page is not None:
            batch_results = _batch_get_violation_info(page)
            return paginator.get_paginated_response(
                [serialize_explanation_event(e, batch_results) for e in page]
            )
        
        batch_results = _batch_get_violation_info(qs)
        return Response([serialize_explanation_event(e, batch_results) for e in qs])

    def create(self, request):
        # --- Kiểm tra khóa chốt công ---
        # Đơn nghỉ phép tháng (LEAVE) cũng bị khóa như các loại giải trình khác
        # khi HR bấm khóa chốt công cho nửa tháng đó.
        attendance_date = request.data.get('attendance_date')
        if attendance_date:
            from datetime import date as _date
            try:
                d = _date.fromisoformat(str(attendance_date))
                target_employee = None
                emp_id = request.data.get('employee_id')
                if emp_id:
                    target_employee = Employee.objects.filter(id=emp_id).first()
                lock_resp = self.assert_not_locked(
                    d.year, d.month, request, day=d.day, allow_admin=True,
                    employee=target_employee,
                )
                if lock_resp:
                    return lock_resp
            except (ValueError, TypeError):
                pass

        serializer = ExplanationEventCreateSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        result = serializer.save(created_by=self._get_current_employee(request))

        # Phòng hờ: nghỉ phép NHIỀU NGÀY (explanation_type=LEAVE + end_date)
        # trả về {"created": [...]} thay vì 1 event — endpoint đúng cho loại
        # này là /api-hrm/monthly-leave-requests/ (MonthlyLeaveViewSet, đã xử
        # lý shape này), nhưng vẫn xử lý luôn ở đây để không crash 500 nếu ai
        # gọi thẳng /attendance-explanations/ với end_date.
        if isinstance(result, dict) and 'created' in result:
            return Response(
                {'results': [serialize_explanation_event(e) for e in result['created']]},
                status=status.HTTP_201_CREATED,
            )

        return Response(
            serialize_explanation_event(result),
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        event = get_object_or_404(self._base_qs(), pk=pk)
        # Tính toán duy nhất cho 1 item
        results = _batch_get_violation_info([event])
        return Response(serialize_explanation_event(event, results))

    def update(self, request, pk=None):
        """Chủ đơn sửa lý do/trạng thái khi đơn còn PENDING/DRAFT, chưa ai
        duyệt, và chưa quá hạn tạo/duyệt đơn loại này (yêu cầu HCNS
        2026-09-17: edit cũng phải theo đúng hạn tạo đơn — tái dùng nguyên
        _check_explanation_approve_deadline(), tự bỏ qua nếu HCNS đã "mở
        khoá"; loại không có hạn riêng — vd LATE/EARLY_LEAVE — tự no-op).
        Admin/HR/Quản lý sửa được bất kỳ lúc nào."""
        event = get_object_or_404(self._base_qs(), pk=pk)

        current_employee = self._get_current_employee(request)
        if not current_employee:
            return Response({'error': 'Employee profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(current_employee)
        has_perm = _has_approve_permission(current_employee)
        is_management = (
            (current_employee.position.is_management if current_employee.position else False) or
            current_employee.managed_departments.exists() or
            current_employee.subordinates.exists()
        )
        is_owner = event.employee == current_employee
        is_privileged = is_admin or is_hr_user or has_perm or is_management
        if not (is_owner or is_privileged):
            return Response({'error': 'Bạn không có quyền sửa đơn này'}, status=status.HTTP_403_FORBIDDEN)

        d = dict(event.data or {})
        # is_privileged (Admin/HR/Quản lý) được sửa bất kỳ trạng thái nào —
        # sửa lại 2026-09-21, trước đây check này chặn nhầm cả họ dù docstring
        # đã ghi rõ ý định ngược lại. Áp dụng cho Nghỉ phép tháng (LEAVE, qua
        # MonthlyLeaveViewSet) lẫn Công tác (BUSINESS_TRIP) vì cùng dùng
        # chung update() này.
        if not is_privileged and d.get('status') not in ('DRAFT', 'PENDING'):
            return Response(
                {'error': 'Chỉ có thể cập nhật đơn ở trạng thái DRAFT hoặc PENDING'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Đổi ngày (attendance_date) — làm TRƯỚC bước check hạn bên dưới để
        # hạn tạo/duyệt được tính theo NGÀY MỚI, không phải ngày cũ (yêu cầu
        # HCNS 2026-09-17: đơn Nghỉ phép tháng cần cho sửa được ngày nghỉ).
        old_event_date = event.event_date
        if request.data.get('attendance_date'):
            from datetime import date as _date
            try:
                new_event_date = _date.fromisoformat(str(request.data['attendance_date']))
            except (ValueError, TypeError):
                return Response({'error': 'Ngày không hợp lệ'}, status=status.HTTP_400_BAD_REQUEST)
            if new_event_date != old_event_date:
                conflict = (
                    self._base_qs()
                    .filter(employee=event.employee, event_date=new_event_date)
                    .exclude(pk=event.pk)
                    .exclude(data__status__in=['REJECTED', 'CANCELLED'])
                    .exists()
                )
                if conflict:
                    return Response(
                        {'error': f'Đã có đơn khác vào ngày {new_event_date.strftime("%d/%m/%Y")}'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                event.event_date = new_event_date

        # Chủ đơn: chỉ được sửa khi chưa ai duyệt và chưa quá hạn (bổ sung/sửa
        # lý do trước khi có người xử lý).
        if is_owner and not is_privileged:
            if d.get('direct_manager_approved') or d.get('hr_approved'):
                return Response(
                    {'error': 'Không thể sửa đơn đã có người phê duyệt'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            deadline_error = _check_explanation_approve_deadline(event, bypass=False)
            if deadline_error:
                return Response({'error': deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        updatable = [
            'original_status', 'expected_status', 'explanation_type', 'reason',
            'actual_check_in', 'actual_check_out',
        ]
        old_values = {f: d.get(f) for f in updatable}
        changed_fields = [f for f in updatable if f in request.data and request.data[f] != d.get(f)]
        for field in updatable:
            if field in request.data:
                d[field] = request.data[field]
        if 'expected_check_in' in request.data:
            event.check_in = request.data['expected_check_in'] or None
        if 'expected_check_out' in request.data:
            event.check_out = request.data['expected_check_out'] or None
        if 'reason' in request.data:
            event.explanation = request.data['reason']
        if event.event_date != old_event_date:
            changed_fields = changed_fields + ['attendance_date']
            old_values['attendance_date'] = old_event_date.isoformat()
            d['attendance_date'] = event.event_date.isoformat()
        if changed_fields:
            # QLTT sửa đơn ĐÃ DUYỆT (Nghỉ phép tháng/Công tác) -> quay lại
            # chờ HCNS duyệt lại (yêu cầu HCNS 2026-09-21) — Admin/HR/
            # has_perm tự sửa thì không cần.
            was_reset = reset_approval_for_privileged_edit(
                d, current_employee, is_admin=is_admin, is_hr_user=is_hr_user,
                has_perm=has_perm, is_management=is_management,
            )
            d = record_request_edit(d, current_employee, changed_fields, old_values)
            if was_reset:
                d['edit_history'][-1]['reset_to_pending'] = True
        event.data = d
        event.save()
        return Response(serialize_explanation_event(event))

    def partial_update(self, request, pk=None):
        return self.update(request, pk=pk)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """
        Huỷ đơn — soft-delete qua soft_cancel_request() (set status=CANCELLED
        + is_deleted/deleted_at/deleted_by trong data, giữ lại log ai huỷ/lúc
        nào/lý do gì). Đây là CƠ CHẾ DUY NHẤT để bỏ 1 đơn (không còn xoá cứng
        — yêu cầu HCNS 2026-09-17: "bỏ hẳn phần xoá destroy() đi, chỉ giữ lại
        phần cancel").

        - Chủ đơn: chỉ huỷ được khi đơn còn PENDING, CHƯA được quản lý trực
          tiếp duyệt bước nào, VÀ chưa quá hạn tạo/duyệt đơn loại này (xem
          _check_explanation_approve_deadline() — chỉ áp dụng cho LEAVE/
          BUSINESS_TRIP, loại khác tự no-op; tự bỏ qua nếu HCNS đã mở khoá)
          — quá 1 trong các điều kiện thì không tự huỷ được nữa, phải liên
          hệ HCNS.
        - Admin/HR/quản lý: huỷ được ở BẤT KỲ trạng thái nào (kể cả đã
          APPROVED — thay cho việc xoá cứng trước đây để xử lý duyệt nhầm),
          không bị chặn bởi hạn tạo/duyệt.
        - HCNS đã mở khoá cho đúng NV/ngày này — HOẶC đúng loại LEAVE (nếu
          đây là đơn Nghỉ phép tháng qua MonthlyLeaveViewSet: mở khoá LEAVE
          thì được huỷ/sửa LEAVE luôn) HOẶC loại dự phòng "Huỷ/Sửa đơn đã
          duyệt" (CANCEL_EDIT_REQUEST_TYPE, dùng cho mọi loại giải trình
          khác không có category riêng — LATE/EARLY_LEAVE/...): CHỦ ĐƠN
          (chỉ chủ đơn, không mở rộng cho người khác) CŨNG được bypass y hệt
          Admin/HR/quản lý — cho cả bước "đã duyệt" lẫn hạn tạo/duyệt
          (_check_explanation_approve_deadline tự kiểm tra lại grant này).
        """
        event = get_object_or_404(self._base_qs(), pk=pk)

        current_employee = self._get_current_employee(request)
        if not current_employee:
            return Response({'error': 'Employee profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        approver = current_employee

        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)
        is_management = (
            (approver.position.is_management if approver.position else False) or
            approver.managed_departments.exists() or
            approver.subordinates.exists()
        )
        is_privileged = is_admin or is_hr_user or has_perm or is_management
        is_owner = event.employee_id == approver.id

        # ── Đơn Nghỉ phép tháng: quyền huỷ bị siết (HCNS 10/2026) ──────────
        # Quản lý KHÔNG còn được coi là "privileged" với đơn nghỉ phép. Dưới cơ
        # chế phạt 500k, quản lý duyệt muộn chỉ cần huỷ đơn là biến lỗi "Duyệt
        # đơn quá hạn" của mình thành lỗi "Nghỉ không tạo đơn" của nhân viên
        # (báo cáo đối soát coi ngày có đơn CANCELLED là ngày không có đơn —
        # xem violation_report_views._from_absent_days). HCNS chốt
        # 2026-10-09: "thu hồi quyền xoá đơn của quản lý".
        # Các loại giải trình khác (LATE/EARLY_LEAVE/BUSINESS_TRIP...) giữ nguyên.
        from .models import _is_hr_or_admin_strict
        _is_leave_req = (event.data or {}).get('explanation_type') == ExplanationType.LEAVE
        if _is_leave_req:
            is_privileged = _is_hr_or_admin_strict(approver)
            if not is_owner and not is_privileged:
                return Response(
                    {'error': 'Quản lý không còn quyền huỷ đơn nghỉ phép. '
                              'Liên hệ HCNS nếu cần huỷ đơn này.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            # HCNS/Admin là cửa duy nhất còn lại cho đơn đã duyệt, nên PHẢI nêu
            # lý do — mọi lần huỷ đều vào EmployeeEventAuditLog kèm người huỷ.
            if is_privileged:
                _r = request.data.get('reason') or request.query_params.get('reason')
                if not str(_r or '').strip():
                    return Response(
                        {'error': 'HCNS phải nhập lý do khi huỷ đơn nghỉ phép.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        if not is_owner and not is_privileged:
            return Response(
                {'error': 'Bạn không có quyền huỷ đơn này'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Chỉ chủ đơn mới được hưởng grant này (không mở rộng cho người
        # khác) — xem docstring RegistrationRequestViewSet.cancel(). Chấp
        # nhận CẢ loại dự phòng (CANCEL_EDIT) LẪN đúng loại tương ứng của
        # đơn này (LEAVE/BUSINESS_TRIP — 2 loại giải trình duy nhất có
        # category riêng bên DeadlineExceptionGrant; các loại khác như LATE/
        # EARLY_LEAVE chỉ còn CANCEL_EDIT làm điều kiện bypass).
        from .deadline_exception_models import has_deadline_exception, CANCEL_EDIT_REQUEST_TYPE
        d_for_grant = event.data or {}
        _explanation_type_for_grant = d_for_grant.get('explanation_type')
        _grant_type_map = {
            ExplanationType.LEAVE: 'LEAVE',
            ExplanationType.BUSINESS_TRIP: 'BUSINESS_TRIP',
        }
        has_owner_grant = is_owner and (
            has_deadline_exception(event.employee, event.event_date, CANCEL_EDIT_REQUEST_TYPE)
            or (
                _explanation_type_for_grant in _grant_type_map
                and has_deadline_exception(event.employee, event.event_date, _grant_type_map[_explanation_type_for_grant])
            )
        )
        # Riêng đơn NGHỈ PHÉP: mở khoá không còn giúp chủ đơn tự huỷ đơn đã
        # duyệt (HCNS 2026-10-10: "Đơn đã duyệt sẽ ko được sửa/xóa",
        # "muốn cancel hay edit gì thì bảo HCNS xử lí cho").
        if _is_leave_req:
            has_owner_grant = False
        effective_bypass = is_privileged or has_owner_grant

        d = dict(event.data or {})
        # Admin/HR/quản lý: huỷ được ở bất kỳ trạng thái nào (thay cho xoá
        # cứng trước đây) — chỉ chủ đơn mới bị giới hạn "còn PENDING".
        if not is_privileged and d.get('status') != 'PENDING':
            return Response(
                {'error': 'Chỉ có thể huỷ đơn đang ở trạng thái chờ duyệt.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if d.get('direct_manager_approved') and not effective_bypass:
            return Response(
                {'error': 'Đơn đã được quản lý trực tiếp duyệt, không thể tự huỷ nữa. '
                          'Liên hệ HCNS nếu cần huỷ.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Quá hạn duyệt thì KHÔNG AI huỷ được đơn nghỉ phép, kể cả HCNS — anh
        # HCNS chốt 2026-10-09: "ko được phép xóa đơn nếu đã quá hạn duyệt".
        # Cửa thoát hợp lệ: HCNS cấp "Mở khoá đặc biệt" cho NV/ngày đó —
        # _check_explanation_approve_deadline() tự trả None khi có grant, nên
        # mọi lần huỷ sau hạn đều để lại người chịu trách nhiệm ở
        # DeadlineExceptionGrant.granted_by.
        # Lưu ý: hàm này đọc snapshot data['advance_deadline'] và tự no-op khi
        # snapshot rỗng (đơn tạo trước 08/09/2026, hoặc do HR tạo) — những đơn
        # đó vẫn huỷ được, giống mọi chỗ khác trong hệ thống.
        if _is_leave_req and not is_privileged:
            # Quá hạn duyệt thì chủ đơn hết tự huỷ được. HCNS KHÔNG bị chặn ở
            # đây nữa — nếu chặn cả HCNS thì không còn ai sửa được đơn duyệt nhầm.
            over = _check_explanation_approve_deadline(event, bypass=False)
            if over:
                return Response(
                    {'error': 'Đã quá hạn duyệt nên bạn không tự huỷ được đơn này. '
                              f'Liên hệ HCNS để được xử lý. ({over})'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        elif is_owner and not is_privileged:
            deadline_error = _check_explanation_approve_deadline(event, bypass=False)
            if deadline_error:
                return Response({'error': deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        reason = request.data.get('reason') or request.query_params.get('reason')
        old_snapshot = dict(d)
        d = soft_cancel_request(d, approver, reason=reason)
        event.data = d
        event.save(update_fields=['data', 'updated_at'])
        log_request_cancel(event, approver, old_snapshot, reason=reason)
        return Response(serialize_explanation_event(event))

    # ── Approve ───────────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """
        Duyệt đơn giải trình – 2 bước: quản lý trực tiếp → HR.
        Admin duyệt cả 2 bước ngay lập tức.
        Khi duyệt, tạo thêm EmployeeEvent EXPLANATION_APPROVAL tham chiếu về đơn gốc.
        """
        event = get_object_or_404(self._base_qs(), pk=pk)

        # Chặn duyệt lại 1 đơn ĐÃ Ở TRẠNG THÁI CUỐI (APPROVED/REJECTED) — thiếu guard
        # này từng cho phép bấm duyệt 2 lần (vd: đã duyệt qua "Duyệt nhanh hàng loạt"
        # bởi ADMIN, sau đó ai đó duyệt lại thủ công qua nút này với tài khoản HR)
        # tạo ra 2 EmployeeEvent EXPLANATION_APPROVAL cho CÙNG 1 đơn gốc với
        # approval_level KHÁC NHAU ('ADMIN' rồi 'HR') — không bị dedup bắt được (dedup
        # cũ theo cặp approved_for_event_id+approval_level), khiến hiệu ứng duyệt
        # (xoá phạt, +1 lượt hạn mức giải trình) bị tính 2 LẦN cho đúng 1 đơn, làm
        # "HẠN MỨC GIẢI TRÌNH" hiển thị số đã dùng cao hơn số đơn thực tế. bulk_approve/
        # smart_bulk_approve đã tự lọc status='PENDING' từ trước; approve() (duyệt
        # từng đơn) là chỗ duy nhất còn thiếu guard này.
        if (event.data or {}).get('status') in ('APPROVED', 'REJECTED'):
            return Response({
                'error': f"Đơn này đã ở trạng thái {(event.data or {}).get('status')}, "
                         f"không thể duyệt lại.",
            }, status=status.HTTP_400_BAD_REQUEST)

        approval_note = request.data.get('approval_note', request.data.get('note', ''))

        approver = self._get_current_employee(request)
        if not approver:
            return Response(
                {'error': 'Employee profile not found'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_admin = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = event.employee.manager == approver
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)
        can_as_hr = is_hr_user or has_perm

        is_creator_senior_mgr = is_senior_manager(event.employee)

        if not (is_direct_mgr or can_as_hr or is_admin):
            return Response(
                {'error': 'Bạn không có quyền phê duyệt giải trình này'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Khoá hạn duyệt (hiện chỉ áp dụng Công tác — BUSINESS_TRIP, loại
        # giải trình duy nhất trong ViewSet này có `advance_deadline` snapshot;
        # các loại khác no-op tự động) — Admin/HR luôn được bỏ qua.
        approve_deadline_error = _check_explanation_approve_deadline(
            event, bypass=(is_admin or can_as_hr),
        )
        if approve_deadline_error:
            return Response({'error': approve_deadline_error}, status=status.HTTP_400_BAD_REQUEST)

        # Check hạn mức giải trình/tháng — TRƯỚC KHI duyệt, áp dụng cho MỌI bước
        # (kể cả quản lý trực tiếp bước 1), y hệt cơ chế đã có cho đơn Nghỉ phép
        # tháng (MonthlyLeaveViewSet.approve()). Trước đây chỉ "Duyệt hàng loạt"
        # (bulk_approve) mới tự động từ chối đơn vượt hạn mức — nút "Duyệt" từng
        # đơn 1 hoàn toàn không check, khiến NV vẫn được duyệt đơn thứ 4/5... dù
        # badge "Hạn mức giải trình" trên lịch đã báo hết hạn mức.
        #
        # QUAN TRỌNG — INCOMPLETE_ATTENDANCE (Quên chấm công) KHÔNG nằm trong
        # danh sách chặn cứng này, dù nó vẫn TÍNH vào hạn mức (dùng hết 1 lượt
        # khi duyệt — xem effects["explanation_quota_used"] ở main_api.py).
        # Khác LATE/EARLY_LEAVE/LATE_EARLY (chỉ có tác dụng xoá phạt tiền —
        # nhị phân, hết hạn mức thì PHẢI chặn vì không có phương án "giảm nhẹ"),
        # "Quên chấm công" là NGOẠI LỆ — công ty đã quyết định luôn phải duyệt
        # (NV lỡ quên chấm công thì cũng đã đi làm, không thể mất trắng cả
        # ngày công) và để engine tính công (_evaluate_explanation_approval_rule
        # ở main_api.py, gated bởi is_over_quota) tự giảm còn 0.5 công thay vì
        # đủ 1.0 khi vượt hạn mức — y hệt smart_bulk_approve() đã làm (is_forget
        # luôn vào to_approve_batch, không bao giờ vào to_reject_batch). Chặn
        # cứng ở đây sẽ khiến NV mất TRẮNG cả công (0 thay vì 0.5) vì đơn không
        # bao giờ được duyệt để engine tính — TỆ HƠN hành vi trước khi có hạn mức.
        _QUOTA_SUBJECT_TYPES = ('LATE', 'EARLY_LEAVE', 'LATE_EARLY')
        _explanation_type = str((event.data or {}).get('explanation_type', '')).upper()
        if _explanation_type in _QUOTA_SUBJECT_TYPES:
            from .stats_utils import _get_quota_used
            _cfg = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
            _max_quota = _cfg.max_explanation_count_per_month if _cfg else 3
            _quota_used = _get_quota_used(event.employee, event.event_date)
            if _quota_used >= _max_quota:
                return Response({
                    'error': f'Nhân viên đã dùng {_quota_used}/{_max_quota} lượt giải trình tháng này. '
                             f'Đã hết hạn mức, không thể duyệt thêm — cần từ chối hoặc liên hệ HCNS.',
                    'quota_exceeded': True,
                    'quota_used': _quota_used,
                    'max_quota': _max_quota,
                }, status=status.HTTP_400_BAD_REQUEST)

        d = dict(event.data or {})


        now_str = timezone.now().isoformat()
        approval_level = None

        if is_admin:
            d.update({
                'direct_manager_approved': True,
                'direct_manager_approved_at': now_str,
                'direct_manager_approved_by_name': approver.full_name,
                'direct_manager_approved_by_id': approver.id,
                'hr_approved': True,
                'hr_approved_at': now_str,
                'hr_approved_by_name': approver.full_name,
                'hr_approved_by_id': approver.id,
                'status': 'APPROVED',
                'approved_by_name': approver.full_name,
                'approved_at': now_str,
            })
            approval_level = 'ADMIN'
        elif is_creator_senior_mgr and can_as_hr and not event.employee.manager:
            # Senior manager: HR chỉ có thể duyệt ngay nếu nhân viên không có quản lý trực tiếp
            d.update({
                'direct_manager_approved': True,
                'direct_manager_approved_at': now_str,
                'direct_manager_approved_by_name': approver.full_name,
                'direct_manager_approved_by_id': approver.id,
                'hr_approved': True,
                'hr_approved_at': now_str,
                'hr_approved_by_name': approver.full_name,
                'hr_approved_by_id': approver.id,
                'status': 'APPROVED',
                'approved_by_name': approver.full_name,
                'approved_at': now_str,
            })
            approval_level = 'HR'
        elif is_direct_mgr:
            d.update({
                'direct_manager_approved': True,
                'direct_manager_approved_at': now_str,
                'direct_manager_approved_by_name': approver.full_name,
                'direct_manager_approved_by_id': approver.id,
            })
            approval_level = 'DIRECT_MANAGER'

            # BỔ SUNG LOGIC: Nếu người làm đơn là nhân viên HR thì Quản lý trực tiếp duyệt xong là Final luôn
            # (Tránh việc đơn quay lại phòng HR để một nhân sự khác duyệt lần 2 không cần thiết)
            if _is_hr(event.employee):
                d.update({
                    'hr_approved': True,
                    'hr_approved_at': now_str,
                    'hr_approved_by_name': approver.full_name,
                    'hr_approved_by_id': approver.id,
                    'status': 'APPROVED',
                    'approved_by_name': approver.full_name,
                    'approved_at': now_str,
                })
                # Ghi nhận cấp độ duyệt cuối là HR để đồng bộ EmployeeEvent
                approval_level = 'HR'
        elif can_as_hr:
            if not d.get('direct_manager_approved') and not (is_creator_senior_mgr and not event.employee.manager):
                return Response(
                    {'error': 'HR chỉ có thể duyệt sau khi quản lý trực tiếp đã duyệt'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            d.update({
                'hr_approved': True,
                'hr_approved_at': now_str,
                'hr_approved_by_name': approver.full_name,
                'hr_approved_by_id': approver.id,
            })
            approval_level = 'HR'

        if d.get('direct_manager_approved') and d.get('hr_approved') and d.get('status') != 'APPROVED':
            d['status'] = 'APPROVED'
            d['approved_by_name'] = approver.full_name
            d['approved_at'] = now_str

        if approval_note:
            d['approval_note'] = approval_note

        event.data = d
        event.save(update_fields=['data', 'updated_at'])

        # Thêm EmployeeEvent EXPLANATION_APPROVAL để lưu lịch sử duyệt
        _create_approval_event(event, approver, approval_level, 'APPROVE', approval_note, now_str)

        return Response(serialize_explanation_event(event))

    @action(detail=False, methods=['post'])
    def bulk_approve(self, request):
        """
        Duyệt hàng loạt đơn giải trình.
        Body: { "ids": [1, 2, 3], "approval_note": "Duyệt nhanh" }
        """
        ids = request.data.get('ids', [])
        approval_note = request.data.get('approval_note', 'Đã duyệt hàng loạt')

        if not ids:
            return Response({'error': 'Danh sách ID không được để trống'}, status=status.HTTP_400_BAD_REQUEST)

        # --- Kiểm tra khóa chốt công (check tháng của đơn đầu tiên, HR/Admin bypass; LEAVE bypass) ---

        approver = self._get_current_employee(request)
        if not approver:
            return Response({'error': 'Employee profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)
        can_as_hr = is_hr_user or has_perm

        # Đảm bảo xử lý theo thứ tự thời gian (ngày xảy ra và thời gian nộp) để quota chính xác
        events = self._base_qs().filter(id__in=ids).order_by('event_date', 'created_at', 'id')
        results = []
        errors = []
        
        now_str = timezone.now().isoformat()
        
        for event in events:
            is_direct_mgr = event.employee.manager == approver
            is_creator_senior_mgr = is_senior_manager(event.employee)
            
            # Kiểm tra quyền duyệt
            if not (is_direct_mgr or can_as_hr or is_admin):
                errors.append({'id': event.id, 'error': 'Bạn không có quyền phê duyệt đơn này'})
                continue
                
            d = dict(event.data or {})

            # Chỉ duyệt đơn PENDING
            if d.get('status') != 'PENDING':
                errors.append({'id': event.id, 'error': f'Đơn đang ở trạng thái {d.get("status")}'})
                continue

            # Khoá hạn duyệt (Công tác) — trước đây "Duyệt hàng loạt" hoàn
            # toàn không kiểm tra, khác nút duyệt từng đơn.
            approve_deadline_error = _check_explanation_approve_deadline(event, bypass=(is_admin or can_as_hr))
            if approve_deadline_error:
                errors.append({'id': event.id, 'error': approve_deadline_error})
                continue


            approval_level = None
            
            if is_admin or can_as_hr:
                # Nếu là Admin hoặc HR, cho phép duyệt chốt (đã có QLTT duyệt hoặc duyệt thay)
                now_str = timezone.now().isoformat()
                
                # Chỉ cập nhật step 1 nếu nó chưa được duyệt
                if not d.get('direct_manager_approved'):
                    d.update({
                        'direct_manager_approved': True,
                        'direct_manager_approved_at': now_str,
                        'direct_manager_approved_by_name': approver.full_name,
                        'direct_manager_approved_by_id': approver.id,
                    })

                # Chốt luôn step 2 (HR)
                d.update({
                    'hr_approved': True,
                    'hr_approved_at': now_str,
                    'hr_approved_by_name': approver.full_name,
                    'hr_approved_by_id': approver.id,
                    'status': 'APPROVED',
                    'approved_by_name': approver.full_name,
                    'approved_at': now_str,
                })
                approval_level = 'ADMIN' if is_admin else 'HR'

            elif is_direct_mgr:
                d.update({
                    'direct_manager_approved': True,
                    'direct_manager_approved_at': now_str,
                    'direct_manager_approved_by_name': approver.full_name,
                    'direct_manager_approved_by_id': approver.id,
                })
                approval_level = 'DIRECT_MANAGER'
                # Nếu creator là HR thì QLTT duyệt xong là xong luôn
                if _is_hr(event.employee):
                    d.update({
                        'hr_approved': True, 'hr_approved_at': now_str,
                        'hr_approved_by_name': approver.full_name, 'hr_approved_by_id': approver.id,
                        'status': 'APPROVED', 'approved_by_name': approver.full_name, 'approved_at': now_str,
                    })
                    approval_level = 'HR'
                
            if d.get('direct_manager_approved') and d.get('hr_approved') and d.get('status') != 'APPROVED':
                d['status'] = 'APPROVED'
                d['approved_by_name'] = approver.full_name
                d['approved_at'] = now_str
                
            if approval_note:
                d['approval_note'] = approval_note
                
            event.data = d
            event.save(update_fields=['data', 'updated_at'])
            _create_approval_event(event, approver, approval_level, 'APPROVE', approval_note, now_str)
            results.append(event.id)
            
        return Response({
            'success_count': len(results),
            'error_count': len(errors),
            'results': results,
            'errors': errors
        })

    # ── Reject ────────────────────────────────────────────────────────────────

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        """Từ chối đơn giải trình và tạo EmployeeEvent EXPLANATION_APPROVAL."""
        event = get_object_or_404(self._base_qs(), pk=pk)

        # Cùng lý do với guard trong approve(): chặn xử lý lại 1 đơn đã ở trạng thái
        # cuối, tránh tạo thêm event lịch sử mâu thuẫn (vd: từ chối 1 đơn ĐÃ được
        # duyệt — công/phạt đã tính theo trạng thái APPROVED sẽ bị đổi ngược ngoài ý
        # muốn khi replay_month tính lại theo dữ liệu event mới nhất).
        if (event.data or {}).get('status') in ('APPROVED', 'REJECTED'):
            return Response({
                'error': f"Đơn này đã ở trạng thái {(event.data or {}).get('status')}, "
                         f"không thể từ chối lại.",
            }, status=status.HTTP_400_BAD_REQUEST)

        approval_note = request.data.get('approval_note', request.data.get('note', ''))

        approver = self._get_current_employee(request)
        if not approver:
            return Response(
                {'error': 'Employee profile not found'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_admin = request.user.is_staff or request.user.is_superuser
        is_direct_mgr = event.employee.manager == approver
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)

        if not (is_direct_mgr or is_hr_user or has_perm or is_admin):
            return Response(
                {'error': 'Bạn không có quyền từ chối giải trình này'},
                status=status.HTTP_403_FORBIDDEN,
            )

        d = dict(event.data or {})
        now_str = timezone.now().isoformat()
        d.update({
            'status': 'REJECTED',
            'approved_by_name': approver.full_name,
            'approved_at': now_str,
            'rejected_by_name': approver.full_name,
            'rejected_at': now_str,
        })

        if is_direct_mgr:
            rejection_level = 'DIRECT_MANAGER'
            d['direct_manager_rejected_by_name'] = approver.full_name
            d['direct_manager_rejected_at'] = now_str
        elif is_hr_user or has_perm or is_admin:
            rejection_level = 'HR' if (is_hr_user or has_perm) else 'ADMIN'
            d['hr_rejected_by_name'] = approver.full_name
            d['hr_rejected_at'] = now_str
        else:
            rejection_level = 'ADMIN'
            d['hr_rejected_by_name'] = approver.full_name # Admin acting as HR
        
        if approval_note:
            d['approval_note'] = approval_note

        event.data = d
        event.save(update_fields=['data', 'updated_at'])

        # Thêm EmployeeEvent EXPLANATION_APPROVAL để lưu lịch sử từ chối
        _create_approval_event(event, approver, rejection_level, 'REJECT', approval_note, now_str)

        return Response(serialize_explanation_event(event))

    # ── Submit for approval ───────────────────────────────────────────────────

    @action(detail=True, methods=['post'])
    def submit_for_approval(self, request, pk=None):
        """Nộp đơn nháp để duyệt."""
        event = get_object_or_404(self._base_qs(), pk=pk)
        d = dict(event.data or {})
        if d.get('status') != 'DRAFT':
            return Response(
                {'error': 'Explanation cannot be submitted for approval (may already be submitted, approved, or rejected)'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        d['status'] = 'PENDING'
        d['submitted_at'] = timezone.now().isoformat()
        event.data = d
        event.save(update_fields=['data', 'updated_at'])
        return Response(serialize_explanation_event(event))

    @action(detail=False, methods=['post'])
    def smart_bulk_approve(self, request):
        """
        Duyệt nhanh thông minh (Quota-aware Bulk Approve).
        BE tự động tính quota còn lại của nhân viên, duyệt tối đa có thể (ưu tiên đơn phạt cao),
        và từ chối các đơn dư thừa.
        """
        ids = request.data.get('ids', [])
        approval_note = request.data.get('approval_note', 'Đã duyệt nhanh')
        quota_exceeded_note = "Từ chối tự động: Vượt quá hạn mức giải trình tối đa của tháng này."

        if not ids:
            return Response({'error': 'Danh sách ID không được để trống'}, status=status.HTTP_400_BAD_REQUEST)

        # --- Kiểm tra khóa chốt công (HR/Admin bypass; LEAVE bypass) ---

        approver = self._get_current_employee(request)
        if not approver:
            return Response({'error': 'Employee profile not found'}, status=status.HTTP_400_BAD_REQUEST)
            
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)
        can_as_hr = is_hr_user or has_perm
        
        # 1. Lấy các đơn PENDING từ danh sách gửi lên
        qs = self._apply_permission_filter(self._base_qs(), request).filter(id__in=ids, data__status='PENDING')
        
        # 2. Lấy thông tin vi phạm để sắp xếp ưu tiên đơn phạt cao
        violation_info_map = _batch_get_violation_info(list(qs))
        
        # 3. Gom nhóm theo Employee + Tháng/Năm
        from collections import defaultdict
        groups = defaultdict(list)
        results = {'approved': [], 'rejected': [], 'errors': []}
        for event in qs:
            # Khoá hạn duyệt Công tác/Nghỉ phép tháng — giống approve()/bulk_approve().
            # Kiểm tra TRƯỚC khi gom nhóm để đơn quá hạn không chiếm hạn mức nghỉ phép
            # của các đơn khác trong cùng lượt. (Case NV80035: Công tác 21/9 hạn
            # 11:00 21/9, QLTT "Duyệt nhanh hàng loạt" lọt lúc 11:53 22/9.)
            approve_deadline_error = _check_explanation_approve_deadline(event, bypass=(is_admin or can_as_hr))
            if approve_deadline_error:
                results['errors'].append({'id': event.id, 'error': approve_deadline_error})
                continue
            penalty = violation_info_map.get(event.id, {}).get('penalty_amount', 0)
            groups[(event.employee_id, event.event_date.year, event.event_date.month)].append({
                'event': event,
                'penalty': penalty
            })

        now_str = timezone.now().isoformat()
        from .stats_utils import _get_quota_remaining, _get_leave_used
        
        to_approve_batch_all = [] # Accumulate all for bulk update

        for (emp_id, year, month), items in groups.items():
            if not items: continue
            first_item = items[0]['event']
            emp_obj = first_item.employee
            
            # Tính quota còn lại thực tế
            remaining = _get_quota_remaining(emp_obj, first_item.event_date)
            
            # Tách các nhóm đơn theo loại quota
            quota_subject_types = [
                ExplanationType.LATE, ExplanationType.EARLY_LEAVE, 
                ExplanationType.LATE_EARLY, ExplanationType.INCOMPLETE_ATTENDANCE
            ]
            
            quota_items = [i for i in items if (i['event'].data or {}).get('explanation_type') in quota_subject_types]
            leave_items = [i for i in items if (i['event'].data or {}).get('explanation_type') == ExplanationType.LEAVE]
            free_items = [i for i in items if i not in quota_items and i not in leave_items]

            # 1. Các đơn không tính riêng Quota (Công tác, OT...) -> Duyệt hết
            to_approve_batch = [*free_items]
            to_reject_batch = []

            # 2. Xử lý đơn Nghỉ phép tháng (LEAVE) - quota riêng từ CompanyConfig
            if leave_items:
                _cfg = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
                _max_leave = float(_cfg.max_leave_count_per_month) if _cfg else 1.0
                leave_used = _get_leave_used(emp_obj, first_item.event_date)
                temp_leave_remaining = max(0.0, _max_leave - leave_used)
                leave_exceeded_note = f"Từ chối tự động: Vượt quá hạn mức nghỉ phép tháng (tối đa {_max_leave} ngày/tháng)."
                for item in leave_items:
                    leave_amount = 0.5 if (item['event'].data or {}).get('expected_status') == 'HALF_DAY' else 1.0
                    if temp_leave_remaining >= leave_amount:
                        to_approve_batch.append(item)
                        temp_leave_remaining -= leave_amount
                    else:
                        item['reject_note'] = leave_exceeded_note
                        to_reject_batch.append(item)

            # 3. Các đơn tính Quota (Đi muộn, Về sớm, Quên chấm công) -> Sắp xếp và áp định mức
            if quota_items:
                # Sắp xếp: 1. Quên chấm công (ưu tiên vì là cứu cánh quan trọng nhất)
                #          2. Tiền phạt (cao nhất) -> Tránh mất nhiều tiền cho nhân viên
                #          3. Ngày gửi (cũ nhất) -> Đảm bảo tính công bằng "gửi trước duyệt trước"
                quota_items.sort(key=lambda x: (
                    0 if (x['event'].data or {}).get('explanation_type') == ExplanationType.INCOMPLETE_ATTENDANCE else 1,
                    -x['penalty'],
                    x['event'].created_at
                ))
                
                temp_remaining = max(0, remaining)
                
                for item in quota_items:
                    is_forget = (item['event'].data or {}).get('explanation_type') == ExplanationType.INCOMPLETE_ATTENDANCE
                    if is_forget:
                        # NGOẠI LỆ: Luôn duyệt đơn Quên chấm công để đảm bảo công cho nhân viên
                        # Chỉnh sửa: Có thể bị phạt nếu temp_remaining <= 0 (Logic Engine xử lý khi ghi nhận công)
                        to_approve_batch.append(item)
                        if temp_remaining > 0:
                            temp_remaining -= 1
                    else:
                        # Các loại khác (Đi muộn, Về sớm) -> Chỉ phê duyệt nếu còn hạn mức quota
                        if temp_remaining > 0:
                            to_approve_batch.append(item)
                            temp_remaining -= 1
                        else:
                            to_reject_batch.append(item)
            
            # Duyệt đơn trong batch của employee này
            for item in to_approve_batch:
                ev = item['event']
                d = dict(ev.data or {})
                level = None
                
                is_direct_mgr = ev.employee.manager == approver
                
                if is_admin or can_as_hr:
                    if not d.get('direct_manager_approved'):
                        d.update({
                            'direct_manager_approved': True, 
                            'direct_manager_approved_at': now_str, 
                            'direct_manager_approved_by_name': approver.full_name,
                        })
                    d.update({
                        'hr_approved': True, 'hr_approved_at': now_str, 'hr_approved_by_name': approver.full_name,
                        'status': 'APPROVED', 'approved_by_name': approver.full_name, 'approved_at': now_str,
                    })
                    level = 'ADMIN' if is_admin else 'HR'
                elif is_direct_mgr:
                    d.update({
                        'direct_manager_approved': True, 'direct_manager_approved_at': now_str, 'direct_manager_approved_by_name': approver.full_name,
                    })
                    level = 'DIRECT_MANAGER'
                    if _is_hr(ev.employee):
                        d.update({
                            'hr_approved': True, 'hr_approved_at': now_str, 'hr_approved_by_name': approver.full_name,
                            'status': 'APPROVED', 'approved_by_name': approver.full_name, 'approved_at': now_str,
                        })
                        level = 'HR'
                
                if d.get('direct_manager_approved') and d.get('hr_approved'): d['status'] = 'APPROVED'
                d['approval_note'] = approval_note
                ev.data = d
                to_approve_batch_all.append(ev)
                _create_approval_event(ev, approver, level, 'APPROVE', approval_note, now_str)
                results['approved'].append(ev.id)

            # Từ chối đơn vượt hạn mức của employee này
            for item in to_reject_batch:
                ev = item['event']
                reject_note = item.get('reject_note', quota_exceeded_note)
                d = dict(ev.data or {})
                d.update({
                    'status': 'REJECTED', 'approval_note': reject_note,
                    'hr_rejected': True, 'hr_rejected_by_name': approver.full_name, 'hr_rejected_at': now_str,
                    'rejected_by_name': approver.full_name, 'rejected_at': now_str, 'rejection_level': 'HR',
                })
                ev.data = d
                ev.save()
                _create_approval_event(ev, approver, 'HR', 'REJECT', reject_note, now_str)
                results['rejected'].append(ev.id)

        # Batch update all approved events
        if to_approve_batch_all:
            EmployeeEvent.objects.bulk_update(to_approve_batch_all, ['data'])

        # Recalculate attendance for all affected employees
        try:
            from .attendance_engine import HRMAttendanceEngine
            engine = HRMAttendanceEngine()
            affected_sets = set(groups.keys())
            for emp_id, year, month in affected_sets:
                try:
                    emp_obj = Employee.objects.get(id=emp_id)
                    engine.calculate_monthly_summary(employee=emp_obj, year=year, month=month, persist_events=True)
                except Exception as e:
                    logger.error(f"Error recalculating attendance for {emp_id}: {e}")
        except Exception:
            pass

        return Response({
            'success_count': len(results['approved']),
            'error_count': len(results['rejected']) + len(results['errors']),
            'approved': results['approved'],
            'rejected': results['rejected'],
            'errors': results['errors']
        })


    # ── Stats ─────────────────────────────────────────────────────────────────

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Thống kê giải trình chấm công và các loại đơn khác từ EmployeeEvent."""
        from datetime import datetime

        employee_id = request.query_params.get('employee_id')
        department_id = request.query_params.get('department_id')
        month = request.query_params.get('month')
        year = request.query_params.get('year')

        today = datetime.now()
        if not month: month = int(today.month)
        else: month = int(month)
        if not year: year = int(today.year)
        else: year = int(year)

        # --- Base Queryset for events in the given month/year ---
        base_event_qs = EmployeeEvent.objects.filter(
            event_date__year=year,
            event_date__month=month,
        )
        if employee_id:
            base_event_qs = base_event_qs.filter(employee_id=employee_id)
        if department_id:
            base_event_qs = base_event_qs.filter(employee__department_id=department_id)

        # VÁ LỖ HỔNG: trước đây action này không hề áp dụng
        # _apply_permission_filter (khác với list() ở trên cùng class) — bất
        # kỳ ai đã đăng nhập cũng xem được số đơn/hạn mức nghỉ phép/online/
        # giải trình của bất kỳ nhân viên/phòng ban nào, hoặc TOÀN CÔNG TY
        # nếu không truyền gì. Giới hạn lại đúng bằng helper đã dùng ở list().
        base_event_qs = self._apply_permission_filter(base_event_qs, request)

        # --- 1. Giải trình (EXPLANATION) ---
        quota_types = [
            ExplanationType.LATE,
            ExplanationType.EARLY_LEAVE,
            ExplanationType.LATE_EARLY,
            ExplanationType.INCOMPLETE_ATTENDANCE
        ]
        qs_explanation = base_event_qs.filter(
            event_type=EmployeeEvent.EventType.EXPLANATION,
            data__explanation_type__in=quota_types
        ).exclude(
            models.Q(data__status='DRAFT') | 
            models.Q(data__status='CANCELLED')
        )

        total_explanations = qs_explanation.count()
        pending_explanations = qs_explanation.filter(data__status='PENDING').count()
        approved_explanations = qs_explanation.filter(data__status='APPROVED').count()
        rejected_explanations = qs_explanation.filter(data__status='REJECTED').count()

        # --- 2. Nghỉ phép (LEAVE) ---
        qs_leave = base_event_qs.filter(
            event_type=EmployeeEvent.EventType.EXPLANATION,
            data__explanation_type=ExplanationType.LEAVE
        )
        approved_leave = 0.0
        for ev in qs_leave.filter(data__status='APPROVED'):
            if ev.data and ev.data.get('expected_status') == 'HALF_DAY':
                approved_leave += 0.5
            else:
                approved_leave += 1.0

        # --- 3. Đơn đăng ký (REGISTRATION - OT, EXTRA, NIGHT, LIVE) ---
        qs_reg = base_event_qs.filter(
            event_type__in=[
                EmployeeEvent.EventType.OVERTIME,
                EmployeeEvent.EventType.EXTRA_HOURS,
                EmployeeEvent.EventType.NIGHT_SHIFT,
                EmployeeEvent.EventType.LIVESTREAM
            ]
        )
        approved_registrations = qs_reg.filter(data__status='APPROVED').count()

        # --- Quotas & Config ---
        today_date = today.date()
        company_config = CompanyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today_date,
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today_date)
        ).order_by('-effective_from').first()
        
        max_explanations_per_month = company_config.max_explanation_count_per_month if company_config else 3
        max_online_work_per_month = float(company_config.max_online_work_count_per_month) if company_config else 3.0
        max_leave_per_month = float(company_config.max_leave_count_per_month) if company_config else 1.0

        # --- 4. Làm việc online (ONLINE_WORK) ---
        # Xây từ EmployeeEvent gốc (không phải base_event_qs) nên phải áp
        # dụng lại _apply_permission_filter ở đây — không thì lại lộ y hệt
        # lỗ hổng vừa vá ở trên cho riêng phần thống kê Online.
        qs_online = self._apply_permission_filter(
            EmployeeEvent.objects.filter(
                event_type=EmployeeEvent.EventType.ONLINE_WORK,
                event_date__year=year,
                event_date__month=month,
                data__status='APPROVED'
            ).select_related('employee__department'),
            request,
        )
        if employee_id:
            qs_online = qs_online.filter(employee_id=employee_id)
        if department_id:
            qs_online = qs_online.filter(employee__department_id=department_id)
            
        online_weekend_unlimited = False
        if employee_id:
            _emp_ow = Employee.objects.select_related('department').filter(id=employee_id).first()
            if _emp_ow:
                # Phòng ban + lịch phòng ban tra theo ngày (employee/schedule.py) — lấy
                # ở ngày cuối của tháng đang xem.
                import calendar as _cal_ow
                from datetime import date as _date_ow
                from employee.schedule import ScheduleResolver
                _last_day = _date_ow(year, month, _cal_ow.monthrange(year, month)[1])
                _schedule_ow = ScheduleResolver()
                online_weekend_unlimited = _schedule_ow.flag(
                    _schedule_ow.department_on(_emp_ow, _last_day), 'online_weekend_unlimited', _last_day,
                )

        approved_online_work = 0.0
        for ev in qs_online:
            # Nếu là "checkpage" thì không tính vào quota online work
            reason = (ev.explanation or "").lower() or (ev.data or {}).get('reason', "").lower()
            if 'checkpage' in reason:
                continue
                
            from .stats_utils import online_quota_amount
            approved_online_work += online_quota_amount(ev.employee, ev.event_date, ev.data)

        return Response({
            'filters': {
                'employee_id': employee_id,
                'department_id': department_id,
                'month': month,
                'year': year,
            },
            'statistics': {
                'total_explanations': total_explanations,
                'pending_explanations': pending_explanations,
                'approved_explanations': approved_explanations,
                'rejected_explanations': rejected_explanations,
                'remaining_explanations': max(0, max_explanations_per_month - approved_explanations),
                'max_explanations_per_month': max_explanations_per_month,
                'approved_leave': approved_leave,
                'remaining_leave': max(0, max_leave_per_month - approved_leave),
                'max_leave_per_month': max_leave_per_month,
                'approved_registrations': approved_registrations,
                'max_registrations_per_month': 0,
                'max_online_work_per_month': max_online_work_per_month,
                'approved_online_work': approved_online_work,
                'remaining_online_work': max(0, max_online_work_per_month - approved_online_work),
                # Phòng ban được làm online chiều T7 tuần 2/4 & Chủ nhật không giới
                # hạn (Department.online_weekend_unlimited) — FE dùng để KHÔNG khoá
                # thẻ "Làm việc online" ở những ngày đó dù đã hết lượt tháng.
                'online_weekend_unlimited': online_weekend_unlimited,
            },
        })

    # ── Employee remaining count ───────────────────────────────────────────────

    @action(detail=False, methods=['get'])
    def employee_remaining_count(self, request):
        """Số giải trình còn lại trong tháng cho một nhân viên.

        Tháng được xác định theo attendance_date (event_date) chứ không phải
        theo ngày tạo (created_at).  Truyền ?month=<m>&year=<y> để kiểm tra
        quota cho tháng cụ thể; mặc định là tháng hiện tại.
        """
        from datetime import datetime
        employee_id = request.query_params.get('employee_id')
        if not employee_id:
            return Response(
                {'error': 'employee_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            employee = Employee.objects.get(id=employee_id)
        except Employee.DoesNotExist:
            return Response(
                {'error': f'Employee with ID {employee_id} does not exist'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # VÁ LỖ HỔNG: trước đây action này không kiểm tra quyền — bất kỳ ai
        # đã đăng nhập cũng xem được hạn mức giải trình còn lại của bất kỳ
        # nhân viên nào. Chỉ cho chính mình / cấp dưới trực tiếp / admin / HR
        # (khớp phạm vi đã dùng ở list()/stats() cùng ViewSet).
        current_employee = self._get_current_employee(request)
        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr = _is_hr(current_employee) if current_employee else False
        if not is_admin and not is_hr:
            is_self = current_employee and str(current_employee.id) == str(employee_id)
            is_direct_report = current_employee and Employee.objects.filter(
                id=employee_id, manager=current_employee
            ).exists()
            if not (is_self or is_direct_report):
                return Response(
                    {'error': 'Permission denied'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        today = datetime.now()
        try:
            target_month = int(request.query_params.get('month', today.month))
            target_year = int(request.query_params.get('year', today.year))
        except (ValueError, TypeError):
            return Response(
                {'error': 'month and year must be valid integers'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not (1 <= target_month <= 12):
            return Response(
                {'error': 'month must be between 1 and 12'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not (2000 <= target_year <= 2100):
            return Response(
                {'error': 'year must be between 2000 and 2100'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Count explanations whose attendance_date (event_date) falls in the
        # requested month/year, regardless of when they were submitted.
        # Thay đổi: Chỉ đếm các đơn ĐÃ DUYỆT để tính quota còn lại
        # Các loại đơn bị tính vào Quota: Đi muộn, Về sớm, Đi muộn/Về sớm, Quên chấm công
        quota_types = [
            ExplanationType.LATE,
            ExplanationType.EARLY_LEAVE,
            ExplanationType.LATE_EARLY,
            ExplanationType.INCOMPLETE_ATTENDANCE
        ]
        count = self._base_qs().filter(
            employee=employee,
            event_date__year=target_year,
            event_date__month=target_month,
            data__status='APPROVED',
            data__explanation_type__in=quota_types
        ).count()

        today_date = today.date()
        company_config = CompanyConfig.objects.filter(
            is_active=True,
            effective_from__lte=today_date,
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=today_date)
        ).order_by('-effective_from').first()
        max_per_month = company_config.max_explanation_count_per_month if company_config else 3

        return Response({
            'employee': {
                'id': employee.id,
                'full_name': employee.full_name,
                'employee_id': employee.employee_id,
            },
            'month': target_month,
            'year': target_year,
            'explanation_count': count,
            'max_explanations_per_month': max_per_month,
            'remaining_count': max(0, max_per_month - count),
        })


# ─────────────────────────────────────────────────────────────────────────────
# MONTHLY LEAVE VIEWSET (Separated API for Nghỉ phép tháng)
# ─────────────────────────────────────────────────────────────────────────────

class MonthlyLeaveViewSet(AttendanceExplanationViewSet):
    """
    ViewSet riêng cho đơn Nghỉ phép tháng (LEAVE).
    Tách biệt khỏi AttendanceExplanationViewSet để dễ quản lý và UI sạch hơn.
    """

    def _base_qs(self):
        return (
            EmployeeEvent.objects
            .filter(
                event_type=EmployeeEvent.EventType.EXPLANATION,
                data__explanation_type=ExplanationType.LEAVE
            )
            .select_related(
                'employee',
                'employee__manager',
                'employee__department',
                'employee__department__manager',
                'employee__position',
            )
        )

    def create(self, request):
        # Đảm bảo explanation_type luôn là LEAVE
        data = request.data.copy()
        data['explanation_type'] = ExplanationType.LEAVE

        # --- Kiểm tra khóa chốt công ---
        # Nghỉ phép nhiều ngày (end_date != attendance_date): check khóa cho
        # TỪNG ngày trong khoảng — mượn đúng pattern đã có ở
        # RegistrationRequestViewSet.create() (UNAUTHORIZED_ABSENCE).
        attendance_date = data.get('attendance_date')
        end_date_raw = data.get('end_date')
        if attendance_date:
            try:
                d_start = date.fromisoformat(str(attendance_date))
                d_end = date.fromisoformat(str(end_date_raw)) if end_date_raw else d_start
                target_employee = None
                emp_id = data.get('employee_id')
                if emp_id:
                    target_employee = Employee.objects.filter(id=emp_id).first()
                cur = d_start
                cur_count = 0
                while cur <= d_end and cur_count <= 60:
                    lock_resp = self.assert_not_locked(
                        cur.year, cur.month, request, day=cur.day, allow_admin=True,
                        employee=target_employee,
                    )
                    if lock_resp:
                        return lock_resp
                    cur += timedelta(days=1)
                    cur_count += 1
            except (ValueError, TypeError):
                pass

        emp = self._get_current_employee(request)
        if emp:
            contract_type = str(getattr(emp, 'contract_type', '') or '').strip().upper()
            rank = str(getattr(emp, 'rank', '') or '').strip().upper()
            if contract_type == 'PROBATION':
                # Cho phép nếu ngày nghỉ đã sau ngày kết thúc thử việc — HR
                # có thể chưa kịp update contract_type sau khi NV pass thử
                # việc, nhưng nếu probation_end_date đã qua thì NV đã chính
                # thức tại ngày nghỉ, nên vẫn được tạo đơn.
                probation_end = getattr(emp, 'probation_end_date', None)
                leave_date = data.get('attendance_date')
                if isinstance(leave_date, str):
                    try:
                        leave_date = date.fromisoformat(leave_date)
                    except (ValueError, TypeError):
                        leave_date = None
                still_in_probation = not (
                    probation_end and leave_date and leave_date > probation_end
                )
                if still_in_probation:
                    return Response(
                        {'error': 'Nhân viên thử việc không được phép tạo đơn nghỉ phép.'},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            if rank == 'INTERN':
                return Response(
                    {'error': 'Nhân viên cấp bậc INTERN không được phép tạo đơn nghỉ phép.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        serializer = ExplanationEventCreateSerializer(data=data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        result = serializer.save(created_by=emp)

        # Nghỉ phép nhiều ngày trả về {"created": [...]} thay vì 1 EmployeeEvent
        # duy nhất — chỉ xảy ra khi frontend chủ động gửi end_date != attendance_date.
        if isinstance(result, dict) and 'created' in result:
            return Response(
                {'results': [serialize_explanation_event(e) for e in result['created']]},
                status=status.HTTP_201_CREATED,
            )

        return Response(
            serialize_explanation_event(result),
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """
        Duyệt thủ công đơn nghỉ phép — có check quota từ CompanyConfig.
        Trả lỗi 400 kèm quota_exceeded=True nếu hết hạn mức.
        """
        from .stats_utils import _get_leave_used
        event = get_object_or_404(self._base_qs(), pk=pk)
        approver = self._get_current_employee(request)
        if not approver:
            return Response({'error': 'Employee profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        d = dict(event.data or {})
        if d.get('status') != 'PENDING':
            return Response({'error': f'Đơn đang ở trạng thái {d.get("status")}'}, status=status.HTTP_400_BAD_REQUEST)

        is_admin = request.user.is_staff or request.user.is_superuser
        can_as_hr = _is_hr(approver) or _has_approve_permission(approver)
        is_direct_mgr = event.employee.manager == approver

        if not (is_direct_mgr or can_as_hr or is_admin):
            return Response({'error': 'Bạn không có quyền phê duyệt đơn này'}, status=status.HTTP_403_FORBIDDEN)

        # Nghỉ phép NHIỀU NGÀY (start_date != end_date trong data — xem
        # ExplanationEventCreateSerializer.create()): KHÔNG áp dụng quota
        # max_leave_count_per_month (thiết kế cho nghỉ 1 ngày/nửa ngày trong
        # tháng, khác bản chất với nghỉ nhiều ngày trừ vào phép năm — xem chú
        # thích ở validate()).
        is_multiday = bool(d.get('start_date') and d.get('end_date') and d['start_date'] != d['end_date'])

        # Check quota cho mọi người có quyền duyệt, kể cả Quản lý trực tiếp bước 1
        if not is_multiday and (is_direct_mgr or can_as_hr or is_admin):
            _cfg = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
            max_leave = float(_cfg.max_leave_count_per_month) if _cfg else 1.0
            leave_used = _get_leave_used(event.employee, event.event_date)
            leave_amount = 0.5 if d.get('expected_status') == 'HALF_DAY' else 1.0

            if leave_used + leave_amount > max_leave + 0.01:
                return Response({
                    'error': f'Nhân viên đã dùng {leave_used} ngày phép tháng. Hạn mức tối đa là {max_leave} ngày/tháng.',
                    'quota_exceeded': True,
                    'leave_used': leave_used,
                    'max_leave': max_leave,
                    'remaining': max(0.0, max_leave - leave_used),
                }, status=status.HTTP_400_BAD_REQUEST)

        # Khoá hạn duyệt theo quy định thời hạn tạo/duyệt đơn: được kiểm tra ở
        # super().approve() bên dưới (dùng chung _check_explanation_approve_deadline()
        # — đọc lại mốc `advance_deadline` đã snapshot lúc tạo đơn), không
        # cần lặp lại ở đây.

        # Delegate sang hàm cha để xử lý logic duyệt
        return super().approve(request, pk=pk)

    @action(detail=False, methods=['post'])
    def bulk_approve(self, request):
        """
        Duyệt hàng loạt đơn nghỉ phép tháng với quota check (tối đa 1 ngày/tháng).
        Đơn vượt hạn mức sẽ bị từ chối tự động.
        """
        ids = request.data.get('ids', [])
        approval_note = request.data.get('approval_note', 'Đã duyệt hàng loạt')

        if not ids:
            return Response({'error': 'Danh sách ID không được để trống'}, status=status.HTTP_400_BAD_REQUEST)

        # Không check khóa chốt công ở viewset này: đơn nghỉ phép tháng
        # vẫn được duyệt kể cả khi nửa tháng đã chốt.

        approver = self._get_current_employee(request)
        if not approver:
            return Response({'error': 'Employee profile not found'}, status=status.HTTP_400_BAD_REQUEST)

        is_admin = request.user.is_staff or request.user.is_superuser
        is_hr_user = _is_hr(approver)
        has_perm = _has_approve_permission(approver)
        can_as_hr = is_hr_user or has_perm

        events = self._base_qs().filter(id__in=ids).order_by('event_date', 'created_at', 'id')
        results = []
        errors = []
        now_str = timezone.now().isoformat()

        from .stats_utils import _get_leave_used
        _cfg = CompanyConfig.objects.filter(is_active=True).order_by('-effective_from').first()
        MAX_LEAVE_PER_MONTH = float(_cfg.max_leave_count_per_month) if _cfg else 1.0
        quota_exceeded_note = f"Từ chối tự động: Vượt quá hạn mức nghỉ phép tháng (tối đa {MAX_LEAVE_PER_MONTH} ngày/tháng)."
        leave_quota_cache = {}  # (employee_id, year, month) -> remaining quota

        for event in events:
            is_direct_mgr = event.employee.manager == approver
            is_creator_senior_mgr = is_senior_manager(event.employee)

            if not (is_direct_mgr or can_as_hr or is_admin):
                errors.append({'id': event.id, 'error': 'Bạn không có quyền phê duyệt đơn này'})
                continue

            d = dict(event.data or {})
            if d.get('status') != 'PENDING':
                errors.append({'id': event.id, 'error': f'Đơn đang ở trạng thái {d.get("status")}'})
                continue

            # Khoá hạn duyệt — trước đây "Duyệt hàng loạt" hoàn toàn không
            # kiểm tra, khác nút duyệt từng đơn (approve() có gọi).
            approve_deadline_error = _check_explanation_approve_deadline(event, bypass=(is_admin or can_as_hr))
            if approve_deadline_error:
                errors.append({'id': event.id, 'error': approve_deadline_error})
                continue

            # Kiểm tra quota nghỉ phép (tối đa 1 ngày/tháng)
            key = (event.employee_id, event.event_date.year, event.event_date.month)
            if key not in leave_quota_cache:
                used = _get_leave_used(event.employee, event.event_date)
                leave_quota_cache[key] = max(0.0, MAX_LEAVE_PER_MONTH - used)
            leave_amount = 0.5 if d.get('expected_status') == 'HALF_DAY' else 1.0
            if leave_quota_cache[key] < leave_amount:
                d.update({
                    'status': 'REJECTED',
                    'approval_note': quota_exceeded_note,
                    'hr_rejected': True,
                    'hr_rejected_by_name': approver.full_name,
                    'hr_rejected_at': now_str,
                    'rejected_by_name': approver.full_name,
                    'rejected_at': now_str,
                    'rejection_level': 'HR',
                })
                event.data = d
                event.save(update_fields=['data', 'updated_at'])
                _create_approval_event(event, approver, 'HR', 'REJECT', quota_exceeded_note, now_str)
                errors.append({'id': event.id, 'error': quota_exceeded_note})
                continue

            approval_level = None

            if is_admin or can_as_hr:
                if not d.get('direct_manager_approved'):
                    d.update({
                        'direct_manager_approved': True,
                        'direct_manager_approved_at': now_str,
                        'direct_manager_approved_by_name': approver.full_name,
                        'direct_manager_approved_by_id': approver.id,
                    })
                d.update({
                    'hr_approved': True,
                    'hr_approved_at': now_str,
                    'hr_approved_by_name': approver.full_name,
                    'hr_approved_by_id': approver.id,
                    'status': 'APPROVED',
                    'approved_by_name': approver.full_name,
                    'approved_at': now_str,
                })
                approval_level = 'ADMIN' if is_admin else 'HR'
            elif is_direct_mgr:
                d.update({
                    'direct_manager_approved': True,
                    'direct_manager_approved_at': now_str,
                    'direct_manager_approved_by_name': approver.full_name,
                    'direct_manager_approved_by_id': approver.id,
                })
                approval_level = 'DIRECT_MANAGER'
                if _is_hr(event.employee):
                    d.update({
                        'hr_approved': True, 'hr_approved_at': now_str,
                        'hr_approved_by_name': approver.full_name, 'hr_approved_by_id': approver.id,
                        'status': 'APPROVED', 'approved_by_name': approver.full_name, 'approved_at': now_str,
                    })
                    approval_level = 'HR'

            if d.get('direct_manager_approved') and d.get('hr_approved') and d.get('status') != 'APPROVED':
                d['status'] = 'APPROVED'
                d['approved_by_name'] = approver.full_name
                d['approved_at'] = now_str

            if approval_note:
                d['approval_note'] = approval_note

            event.data = d
            event.save(update_fields=['data', 'updated_at'])
            _create_approval_event(event, approver, approval_level, 'APPROVE', approval_note, now_str)
            results.append(event.id)

            # Giảm quota cache sau khi duyệt thành công
            if d.get('status') == 'APPROVED':
                leave_quota_cache[key] -= leave_amount

        return Response({
            'success_count': len(results),
            'error_count': len(errors),
            'results': results,
            'errors': errors,
        })

    @action(detail=False, methods=['get'])
    def remaining_quota(self, request):
        """Lấy hạn mức nghỉ phép tháng còn lại (tối đa 1 ngày/tháng)"""
        emp = self._get_current_employee(request)
        if not emp:
            return Response({'error': 'Employee profile not found'}, status=400)
            
        month = request.query_params.get('month', timezone.now().month)
        year = request.query_params.get('year', timezone.now().year)
        existing_leaves = EmployeeEvent.objects.filter(
            employee=emp,
            event_type=EmployeeEvent.EventType.EXPLANATION,
            data__explanation_type=ExplanationType.LEAVE,
            event_date__year=year,
            event_date__month=month,
            data__status='APPROVED'
        )
        
        total_used = sum(
            0.5 if (e.data or {}).get('expected_status') == 'HALF_DAY' else 1.0 
            for e in existing_leaves
        )
        
        return Response({
            'total_quota': 1.0,
            'used': total_used,
            'remaining': max(0, 1.0 - total_used)
        })



import csv
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django import forms
from django.contrib import admin, messages
from django.shortcuts import redirect
from django.shortcuts import render
from django.utils.html import format_html
from django.urls import path, reverse
from .models import (
    ApprovalWorkflow, LeaveRequest, OvertimeRequest,
    AttendanceExplanation, ApprovalRecord,
    Attendance, AttendanceImportLog,
    MonthlyWorkCredit, WorkCreditCalculationLog,
    OnboardingProcess, OnboardingTask,
    OnboardingChecklist, OnboardingDocument, OnboardingDocumentTemplate,
    DepartmentWorkFinalizationApproval, WorkFinalizationApprovalLog,
    WorkFinalization, WorkFinalizationEmployeeDecision, WorkFinalizationAccountingExport,
    ContractTemplate, EmployeeContract,
    Asset, AssetAssignmentHistory, AssetMaintenance,
    FinalizationLock, FinalizationLockLog, FinalizationLockEmployeeOverride,
    MeetingRoom, MeetingRoomSetting, MeetingRoomBooking, MeetingRoomBookingLog,
    AttendanceAppDownloadConfig,
    GenericRequest, RequestTemplate, SalaryAdvanceApprovalLock, SalaryAdvanceCreationLock,
)
from .event_models import EmployeeEvent, EmployeeEventAuditLog


class WorkFinalizationCSVUploadForm(forms.Form):
    file = forms.FileField(label='File CSV/TSV')


def _wf_get_cell(row, *keys):
    normalized_map = {str(k).strip().lower(): v for k, v in row.items()}
    for key in keys:
        value = normalized_map.get(key.lower())
        if value is not None:
            return value
    return None


def _wf_clean_text(raw_value):
    if raw_value is None:
        return ''
    return str(raw_value).replace('\ufeff', '').replace('\xa0', ' ').strip()


def _wf_normalize_employee_code(raw_code):
    normalized = _wf_clean_text(raw_code).upper().replace(' ', '')
    if not normalized:
        return ''

    if normalized.endswith(',00') or normalized.endswith('.00'):
        normalized = normalized[:-3]
    return normalized


def _wf_parse_decimal(raw_value, default=None):
    if raw_value is None:
        return default

    text = str(raw_value).strip().replace('\xa0', '').replace(' ', '')
    if not text or text in {'-', '--'}:
        return default

    if '.' in text and ',' in text:
        if text.rfind(',') > text.rfind('.'):
            text = text.replace('.', '').replace(',', '.')
        else:
            text = text.replace(',', '')
    elif ',' in text:
        parts = text.split(',')
        if len(parts) == 2 and len(parts[1]) <= 2:
            text = '.'.join(parts)
        else:
            text = ''.join(parts)
    elif '.' in text:
        parts = text.split('.')
        if len(parts) > 2 or (len(parts) == 2 and len(parts[1]) == 3 and parts[0].isdigit()):
            text = ''.join(parts)

    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        raise ValueError(f"Giá trị số không hợp lệ: {raw_value}")


def _wf_parse_int(raw_value, field_name):
    value = _wf_parse_decimal(raw_value, default=None)
    if value is None:
        raise ValueError(f"Thiếu {field_name}")

    try:
        return int(value)
    except (ValueError, TypeError):
        raise ValueError(f"{field_name} không hợp lệ: {raw_value}")


def _wf_parse_date(raw_value):
    if raw_value is None:
        return None

    text = _wf_clean_text(raw_value)
    if not text:
        return None

    date_formats = ('%d/%m/%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y')
    for fmt in date_formats:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    raise ValueError(f"Ngày không hợp lệ: {raw_value}")
# ======================
# ApprovalWorkflow Admin
# ======================
class ApprovalWorkflowAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'requires_direct_manager', 'requires_department_head',
                   'requires_hr', 'requires_director', 'is_active', 'created_at')
    list_filter = ('is_active', 'requires_direct_manager', 'requires_department_head',
                  'requires_hr', 'requires_director')
    search_fields = ('code', 'name', 'description')
    ordering = ('code',)
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'description', 'is_active')
        }),
        ('Cấu hình quy trình duyệt', {
            'fields': ('requires_direct_manager', 'requires_department_head',
                      'requires_hr', 'requires_director', 'approval_order'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('approval_order',)
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset


# ======================
# LeaveRequest Admin
# ======================
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ('request_code', 'employee_info', 'leave_type', 'start_date', 'end_date',
                   'total_days', 'status', 'current_approval_level', 'created_at')
    list_filter = ('status', 'leave_type', 'current_approval_level', 'start_date')
    search_fields = ('request_code', 'employee__full_name', 'employee__employee_id', 'reason')
    raw_id_fields = ('employee', 'workflow')
    ordering = ('-created_at',)
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('request_code', 'employee', 'workflow', 'status', 'current_approval_level')
        }),
        ('Thông tin nghỉ phép', {
            'fields': ('leave_type', 'reason', 'start_date', 'end_date', 'total_days',
                      'is_half_day', 'half_day_period')
        }),
        ('Thông tin bổ sung', {
            'fields': ('medical_certificate', 'doctor_name', 'hospital_name',
                      'expected_delivery_date', 'child_birth_date', 'attachment'),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('submitted_at', 'approved_at', 'rejected_at', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('request_code', 'total_days', 'submitted_at', 'approved_at',
                      'rejected_at', 'created_at', 'updated_at')
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({}) - {}',
                obj.employee.full_name,
                obj.employee.employee_id,
                obj.employee.department.name if obj.employee.department else 'Không có phòng ban'
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('employee', 'employee__department', 'workflow')


# ======================
# OvertimeRequest Admin
# ======================
class OvertimeRequestAdmin(admin.ModelAdmin):
    list_display = ('request_code', 'employee_info', 'overtime_type', 'start_date',
                   'start_time', 'end_time', 'total_hours', 'multiplier', 'status', 'created_at')
    list_filter = ('status', 'overtime_type', 'start_date')
    search_fields = ('request_code', 'employee__full_name', 'employee__employee_id',
                    'task_description', 'reason')
    raw_id_fields = ('employee', 'workflow')
    ordering = ('-created_at',)
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('request_code', 'employee', 'workflow', 'status', 'current_approval_level')
        }),
        ('Thông tin làm thêm', {
            'fields': ('overtime_type', 'reason', 'start_date', 'start_time', 'end_time',
                      'total_hours', 'multiplier')
        }),
        ('Thông tin công việc', {
            'fields': ('task_description', 'expected_output', 'attachment')
        }),
        ('Thông tin hệ thống', {
            'fields': ('submitted_at', 'approved_at', 'rejected_at', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('request_code', 'total_hours', 'submitted_at', 'approved_at',
                      'rejected_at', 'created_at', 'updated_at')
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({})',
                obj.employee.full_name,
                obj.employee.employee_id
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('employee', 'workflow')


# ======================
# AttendanceExplanation Admin - CẬP NHẬT
# ======================
class AttendanceExplanationAdmin(admin.ModelAdmin):
    list_display = ('request_code', 'employee_info', 'attendance_date',
                   'original_status', 'expected_status', 'status', 'approved_by_info', 'created_at')
    list_filter = ('status', 'original_status', 'expected_status', 'attendance_date')
    search_fields = ('request_code', 'employee__full_name', 'employee__employee_id',
                    'reason')
    raw_id_fields = ('employee', 'approved_by')
    ordering = ('-attendance_date', '-created_at')
    actions = ['print_explanation']  # <-- Action đã có
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('request_code', 'employee', 'attendance_date', 'status')
        }),
        ('Thông tin chấm công', {
            'fields': ('original_status', 'expected_status', 'reason', 'evidence')
        }),
        ('Thông tin thời gian', {
            'fields': ('actual_check_in', 'actual_check_out',
                      'expected_check_in', 'expected_check_out'),
            'classes': ('collapse',)
        }),
        ('Thông tin duyệt', {
            'fields': ('approved_by', 'approval_decision',
                      'submitted_at', 'approved_at')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('request_code', 'submitted_at', 'approved_at',
                      'created_at', 'updated_at')
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({})',
                obj.employee.full_name,
                obj.employee.employee_id
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def approved_by_info(self, obj):
        if obj.approved_by:
            return format_html(
                '{} ({})',
                obj.approved_by.full_name,
                obj.approved_by.employee_id
            )
        return "Chưa duyệt"
    approved_by_info.short_description = "Người duyệt"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('employee', 'approved_by')
    
    # ===========================================================================================
    # CẬP NHẬT hrm/admin.py - KIỂM TRA CÙNG NHÂN VIÊN
    # ===========================================================================================

    def print_explanation(self, request, queryset):
        """
        Custom admin action để in phiếu giải trình chấm công
        Cho phép in tối đa 3 phiếu CÙNG NHÂN VIÊN cùng lúc
        """
        # Kiểm tra số lượng đã chọn
        count = queryset.count()
        
        if count == 0:
            self.message_user(request, "Vui lòng chọn ít nhất một phiếu giải trình để in.", level='warning')
            return

        
        if count > 3:
            self.message_user(
                request, 
                f"Bạn đã chọn {count} phiếu. Vui lòng chỉ chọn tối đa 3 phiếu để in cùng lúc.", 
                level='error'
            )
            return
        
        # KIỂM TRA CÙNG NHÂN VIÊN - Lấy danh sách unique employee IDs (FK)
        unique_employees = queryset.values('employee').distinct()
        employee_count = unique_employees.count()
        
        if employee_count > 1:
            # Lấy tên nhân viên để hiển thị thông báo rõ ràng hơn
            employee_names = list(queryset.values_list('employee__full_name', flat=True).distinct())
            
            self.message_user(
                request,
                f"Chỉ có thể in các phiếu giải trình của CÙNG MỘT nhân viên. "
                f"Bạn đã chọn phiếu của {employee_count} nhân viên: {', '.join(employee_names)}.",
                level='error'
            )
            return
        
        # Lấy danh sách IDs của các bản ghi giải trình (không phải employee_id)
        explanation_ids = list(queryset.values_list('id', flat=True))
        ids_str = ",".join(map(str, explanation_ids))
        
        # Tạo URL với IDs của các bản ghi giải trình
        url = reverse('print-attendance-explanation-multiple') + f'?ids={ids_str}'
        
        # Redirect đến trang in
        return redirect(url)

    print_explanation.short_description = "🖨️ In phiếu giải trình (tối đa 3 lỗi/nhân viên)"

    


# ======================
# ApprovalRecord Admin
# ======================
class ApprovalRecordAdmin(admin.ModelAdmin):
    list_display = ('request_type', 'request_id', 'approver_info', 'approval_level',
                   'action', 'created_at')
    list_filter = ('request_type', 'approval_level', 'action', 'created_at')
    search_fields = ('request_type', 'request_id', 'approver__full_name',
                    'approver__employee_id', 'note')
    raw_id_fields = ('approver',)
    ordering = ('-created_at',)
    
    fieldsets = (
        ('Thông tin duyệt', {
            'fields': ('request_type', 'request_id', 'approver', 'approval_level', 'action')
        }),
        ('Thông tin chi tiết', {
            'fields': ('note', 'created_at')
        }),
    )
    
    readonly_fields = ('created_at',)
    
    def approver_info(self, obj):
        if obj.approver:
            return format_html(
                '{} ({})',
                obj.approver.full_name,
                obj.approver.employee_id
            )
        return "Không có"
    approver_info.short_description = "Người duyệt"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('approver')


# ======================
# Inline Admin Classes
# ======================
class LeaveRequestInline(admin.TabularInline):
    model = LeaveRequest
    fields = ('request_code', 'leave_type', 'start_date', 'end_date', 'status')
    extra = 0
    show_change_link = True
    can_delete = False
    
    def has_add_permission(self, request, obj=None):
        return False


class OvertimeRequestInline(admin.TabularInline):
    model = OvertimeRequest
    fields = ('request_code', 'overtime_type', 'start_date', 'total_hours', 'status')
    extra = 0
    show_change_link = True
    can_delete = False
    
    def has_add_permission(self, request, obj=None):
        return False


class AttendanceExplanationInline(admin.TabularInline):
    model = AttendanceExplanation
    fields = ('request_code', 'attendance_date', 'original_status', 'expected_status', 'status')
    extra = 0
    show_change_link = True
    can_delete = False
    
    def has_add_permission(self, request, obj=None):
        return False


# ======================
# COMPANY INFORMATION ADMIN
# ======================

from .models import (
    CompanyDocument, CompanyAnnouncement, 
    CompanyDocumentViewLog, CompanyAnnouncementViewLog
)


class CompanyDocumentAdmin(admin.ModelAdmin):
    """Admin interface for CompanyDocument"""
    list_display = ('document_code', 'title', 'document_type_display', 'status_display',
                   'access_level_display', 'effective_from', 'effective_to', 'is_current_display',
                   'department', 'created_at')
    list_filter = ('document_type', 'status', 'access_level', 'department', 'effective_from')
    search_fields = ('document_code', 'title', 'description', 'file_name', 'tags')
    raw_id_fields = ('department', 'created_by', 'published_by')
    ordering = ('-effective_from', 'document_code')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('document_code', 'title', 'document_type', 'description')
        }),
        ('File tài liệu', {
            'fields': ('file', 'file_name', 'file_size', 'file_type', 'version')
        }),
        ('Thông tin xuất bản', {
            'fields': ('effective_from', 'effective_to', 'status', 'access_level')
        }),
        ('Phân loại', {
            'fields': ('department', 'tags'),
            'classes': ('collapse',)
        }),
        ('Thông tin người tạo', {
            'fields': ('created_by', 'published_by', 'published_at'),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('document_code', 'file_name', 'file_size', 'file_type',
                      'created_at', 'updated_at', 'published_at')
    
    def document_type_display(self, obj):
        return obj.get_document_type_display()
    document_type_display.short_description = "Loại tài liệu"
    
    def status_display(self, obj):
        return obj.get_status_display()
    status_display.short_description = "Trạng thái"
    
    def access_level_display(self, obj):
        return obj.get_access_level_display()
    access_level_display.short_description = "Mức độ truy cập"
    
    def is_current_display(self, obj):
        return "✓" if obj.is_current else ""
    is_current_display.short_description = "Hiệu lực"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('department', 'created_by', 'published_by')


class CompanyAnnouncementAdmin(admin.ModelAdmin):
    """Admin interface for CompanyAnnouncement"""
    list_display = ('announcement_code', 'title', 'announcement_type_display', 'priority_display',
                   'is_active', 'effective_from', 'effective_to', 'is_current_display',
                   'apply_to_all', 'created_at')
    list_filter = ('announcement_type', 'priority', 'is_active', 'effective_from')
    search_fields = ('announcement_code', 'title', 'content', 'notes')
    filter_horizontal = ('departments', 'positions', 'employees')
    raw_id_fields = ('created_by', 'approved_by')
    ordering = ('-effective_from', '-priority')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('announcement_code', 'title', 'content', 'announcement_type', 'priority')
        }),
        ('Phạm vi áp dụng', {
            'fields': ('apply_to_all', 'departments', 'positions', 'employees')
        }),
        ('File đính kèm', {
            'fields': ('attachment',),
            'classes': ('collapse',)
        }),
        ('Thông tin xuất bản', {
            'fields': ('effective_from', 'effective_to', 'is_active')
        }),
        ('Thông tin người tạo', {
            'fields': ('created_by', 'approved_by', 'published_at'),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('announcement_code', 'created_at', 'updated_at', 'published_at')
    
    def announcement_type_display(self, obj):
        return obj.get_announcement_type_display()
    announcement_type_display.short_description = "Loại thông báo"
    
    def priority_display(self, obj):
        return obj.get_priority_display()
    priority_display.short_description = "Mức độ ưu tiên"
    
    def is_current_display(self, obj):
        return "✓" if obj.is_current else ""
    is_current_display.short_description = "Hiệu lực"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('created_by', 'approved_by')


class CompanyDocumentViewLogAdmin(admin.ModelAdmin):
    """Admin interface for CompanyDocumentViewLog"""
    list_display = ('document_title', 'employee_info', 'viewed_at', 'duration_seconds',
                   'page_count', 'ip_address')
    list_filter = ('viewed_at', 'document__document_type')
    search_fields = ('document__title', 'document__document_code', 'employee__full_name',
                    'employee__employee_id', 'ip_address')
    raw_id_fields = ('document', 'employee')
    ordering = ('-viewed_at',)
    
    fieldsets = (
        ('Thông tin xem', {
            'fields': ('document', 'employee', 'viewed_at', 'duration_seconds', 'page_count')
        }),
        ('Thông tin thiết bị', {
            'fields': ('user_agent', 'ip_address'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('viewed_at',)
    
    def document_title(self, obj):
        return obj.document.title
    document_title.short_description = "Tài liệu"
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({})',
                obj.employee.full_name,
                obj.employee.employee_id
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('document', 'employee')


class CompanyAnnouncementViewLogAdmin(admin.ModelAdmin):
    """Admin interface for CompanyAnnouncementViewLog"""
    list_display = ('announcement_title', 'employee_info', 'viewed_at', 'duration_seconds',
                   'acknowledged_display', 'acknowledged_at', 'ip_address')
    list_filter = ('viewed_at', 'acknowledged', 'announcement__announcement_type')
    search_fields = ('announcement__title', 'announcement__announcement_code',
                    'employee__full_name', 'employee__employee_id', 'ip_address')
    raw_id_fields = ('announcement', 'employee')
    ordering = ('-viewed_at',)
    
    fieldsets = (
        ('Thông tin xem', {
            'fields': ('announcement', 'employee', 'viewed_at', 'duration_seconds')
        }),
        ('Xác nhận đã đọc', {
            'fields': ('acknowledged', 'acknowledged_at')
        }),
        ('Thông tin thiết bị', {
            'fields': ('user_agent', 'ip_address'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('viewed_at', 'acknowledged_at')
    
    def announcement_title(self, obj):
        return obj.announcement.title
    announcement_title.short_description = "Thông báo"
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({})',
                obj.employee.full_name,
                obj.employee.employee_id
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def acknowledged_display(self, obj):
        return "✓" if obj.acknowledged else ""
    acknowledged_display.short_description = "Đã xác nhận"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('announcement', 'employee')


# ======================
# Inline Admin Classes for Company Information
# ======================

class CompanyDocumentViewLogInline(admin.TabularInline):
    """Inline for CompanyDocumentViewLog"""
    model = CompanyDocumentViewLog
    fields = ('employee', 'viewed_at', 'duration_seconds', 'page_count')
    extra = 0
    show_change_link = True
    can_delete = False
    
    def has_add_permission(self, request, obj=None):
        return False


class CompanyAnnouncementViewLogInline(admin.TabularInline):
    """Inline for CompanyAnnouncementViewLog"""
    model = CompanyAnnouncementViewLog
    fields = ('employee', 'viewed_at', 'duration_seconds', 'acknowledged', 'acknowledged_at')
    extra = 0
    show_change_link = True
    can_delete = False
    
    def has_add_permission(self, request, obj=None):
        return False


# ======================
# COMPANY CONFIGURATION ADMIN
# ======================

from .models import (
    CompanyConfig, ShiftConfig, HolidayConfig
)


class CompanyConfigAdmin(admin.ModelAdmin):
    """Admin interface for CompanyConfig"""
    list_display = ('code', 'name', 'is_active', 'effective_from', 'effective_to', 
                   'is_current_display', 'default_working_hours_per_day', 
                   'max_explanation_count_per_month', 'created_at')
    list_filter = ('is_active', 'effective_from', 'effective_to')
    search_fields = ('code', 'name', 'description')
    ordering = ('-effective_from', 'code')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'description', 'is_active')
        }),
        ('Cấu hình chung', {
            'fields': ('default_working_hours_per_day', 'default_working_days_per_week',
                      'overtime_multiplier_weekday', 'overtime_multiplier_weekend',
                      'overtime_multiplier_holiday')
        }),
        ('Cấu hình chấm công', {
            'fields': ('late_threshold_minutes', 'early_leave_threshold_minutes',
                      'half_day_threshold_hours')
        }),
        ('Cấu hình nghỉ phép', {
            'fields': ('annual_leave_days_per_year', 'sick_leave_days_per_year',
                      'maternity_leave_days', 'paternity_leave_days')
        }),
        ('Cấu hình giải trình và bổ sung công', {
            'fields': ('max_explanation_count_per_month', 'supplement_work_hours_per_month',
                      'max_leave_count_per_month', 'max_online_work_count_per_month')
        }),
        ('Thông tin hiệu lực', {
            'fields': ('effective_from', 'effective_to')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('created_at', 'updated_at')
    
    def is_current_display(self, obj):
        return "✓" if obj.is_current else ""
    is_current_display.short_description = "Hiệu lực"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('created_by')


class ShiftConfigAdmin(admin.ModelAdmin):
    """Admin interface for ShiftConfig"""
    list_display = ('code', 'name', 'shift_type_display', 'apply_scope_display', 'start_time', 'end_time',
                   'total_hours', 'working_hours', 'is_active', 'is_default', 'detection_only', 'counts_as_night_duty',
                   'effective_from', 'effective_to', 'is_current_display', 'created_at')
    list_filter = ('shift_type', 'apply_scope', 'is_active', 'is_default', 'detection_only', 'counts_as_night_duty', 'effective_from')
    search_fields = ('code', 'name', 'description')
    filter_horizontal = ('apply_to_departments', 'apply_to_positions', 'apply_to_employees')
    ordering = ('start_time', 'code')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'description', 'shift_type', 'apply_scope')
        }),
        ('Thời gian ca làm', {
            'fields': ('start_time', 'end_time', 'break_start_time', 'break_end_time',
                      'break_duration_minutes', 'total_hours', 'working_hours')
        }),
        ('Phạm vi áp dụng', {
            'fields': ('apply_to_departments', 'apply_to_positions', 'apply_to_employees')
        }),
        ('Thông tin hiệu lực', {
            'fields': ('is_active', 'is_default', 'detection_only', 'counts_as_night_duty', 'effective_from', 'effective_to'),
            'description': (
                'Bật "Chỉ dùng để tự nhận diện" cho các ca DÀI/HOẠ HOẰN (vd "Ca kinh '
                'doanh") mà bạn muốn gán cho nhiều vị trí/phòng ban để hệ thống tự nhận '
                'diện đúng ngày — nhưng KHÔNG BAO GIỜ để nó trở thành ca mặc định (an '
                'toàn để gán vào bất kỳ vị trí/phòng ban nào, kể cả nơi chưa có sẵn ca '
                'ngắn nào khác).'
            ),
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )

    readonly_fields = ('total_hours', 'working_hours', 'created_at', 'updated_at')
    
    def shift_type_display(self, obj):
        return obj.get_shift_type_display()
    shift_type_display.short_description = "Loại ca"

    def apply_scope_display(self, obj):
        return obj.get_apply_scope_display() if obj.apply_scope else ""
    apply_scope_display.short_description = "Phạm vi áp dụng"
    
    def is_current_display(self, obj):
        return "✓" if obj.is_current else ""
    is_current_display.short_description = "Hiệu lực"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('created_by')


class HolidayConfigAdmin(admin.ModelAdmin):
    """Admin interface for HolidayConfig"""
    list_display = ('name', 'holiday_date', 'holiday_type_display', 'is_recurring',
                   'is_working_day', 'allow_voluntary_work', 'is_active', 'is_today_display',
                   'created_at')
    list_filter = ('holiday_type', 'is_recurring', 'is_working_day', 'is_active', 'holiday_date')
    search_fields = ('name', 'description', 'notes')
    filter_horizontal = ('excluded_departments', 'excluded_positions', 'excluded_employees')
    ordering = ('holiday_date', 'name')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('name', 'description', 'holiday_date', 'is_recurring', 'holiday_type')
        }),
        ('Cấu hình làm việc', {
            'fields': ('is_working_day', 'allow_voluntary_work', 'overtime_multiplier')
        }),
        ('Phạm vi áp dụng', {
            'fields': ('apply_to_all', 'excluded_departments', 'excluded_positions', 'excluded_employees')
        }),
        ('Thông tin bổ sung', {
            'fields': ('notes', 'is_active')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('created_at', 'updated_at')
    
    def holiday_type_display(self, obj):
        return obj.get_holiday_type_display()
    holiday_type_display.short_description = "Loại ngày lễ"
    
    def is_today_display(self, obj):
        return "✓" if obj.is_today else ""
    is_today_display.short_description = "Hôm nay"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('created_by')


# ======================
# RULE MODELS ADMIN
# ======================

from .event_models import RuleDefinition, RuleExecutionLog, RuleRegistry
from .models import EmployeePermission


class EmployeePermissionAdmin(admin.ModelAdmin):
    """Admin interface for EmployeePermission"""
    list_display = ('employee_info', 'has_any_permission_display', 'permission_summary',
                   'can_approve_attendance', 'can_create_employee', 'can_manage_attendance',
                   'can_manage_assets', 'can_manage_disciplinary_penalties',
                   'can_view_salary_advance', 'can_manage_recruitment', 'created_at', 'updated_at')
    list_filter = ('can_approve_attendance', 'can_create_employee', 'can_manage_attendance',
                  'can_manage_assets', 'can_approve_leave', 'can_approve_overtime',
                  'can_view_all_employees', 'can_manage_departments',
                  'can_manage_disciplinary_penalties', 'can_view_salary_advance',
                  'can_manage_recruitment')
    search_fields = ('employee__full_name', 'employee__employee_id', 'employee__department__name',
                    'employee__position__title', 'notes')
    raw_id_fields = ('employee', 'created_by')
    ordering = ('employee__employee_id',)
    
    fieldsets = (
        ('Thông tin nhân viên', {
            'fields': ('employee', 'notes')
        }),
        ('Quyền phê duyệt', {
            'fields': ('can_approve_attendance', 'can_approve_leave', 'can_approve_overtime'),
            'classes': ('collapse',)
        }),
        ('Quyền quản lý nhân sự', {
            'fields': ('can_create_employee', 'can_edit_employee', 'can_view_all_employees'),
            'classes': ('collapse',)
        }),
        ('Quyền quản lý chấm công', {
            'fields': ('can_manage_attendance', 'can_import_attendance', 'can_adjust_attendance', 'can_edit_attendance'),
            'classes': ('collapse',)
        }),
        ('Quyền khen thưởng & kỷ luật', {
            'fields': ('can_manage_disciplinary_penalties',),
            'classes': ('collapse',)
        }),
        ('Quyền tạm ứng lương', {
            'fields': ('can_view_salary_advance',),
            'classes': ('collapse',)
        }),
        ('Quyền Tuyển dụng', {
            'fields': ('can_manage_recruitment',),
            'classes': ('collapse',)
        }),
        ('Quyền xem Dashboard', {
            'fields': ('can_view_dashboard_overview', 'can_view_dashboard_employee',
                      'can_view_dashboard_recruitment', 'can_view_dashboard_insurance',
                      'can_view_dashboard_asset'),
            'classes': ('collapse',)
        }),
        ('Quyền quản lý tài sản', {
            'fields': ('can_manage_assets', 'can_assign_assets', 'can_approve_asset_requests'),
            'classes': ('collapse',)
        }),
        ('Quyền quản lý phòng ban', {
            'fields': ('can_manage_departments', 'can_manage_positions'),
            'classes': ('collapse',)
        }),
        ('Quyền cấu hình hệ thống', {
            'fields': ('can_manage_company_config', 'can_manage_attendance_rules',
                      'can_manage_leave_policies'),
            'classes': ('collapse',)
        }),
        ('Quyền báo cáo', {
            'fields': ('can_view_reports', 'can_export_reports'),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('created_at', 'updated_at')
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({}) - {} - {}',
                obj.employee.full_name,
                obj.employee.employee_id,
                obj.employee.department.name if obj.employee.department else 'Không có phòng ban',
                obj.employee.position.title if obj.employee.position else 'Không có vị trí'
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def has_any_permission_display(self, obj):
        return "✓" if obj.has_any_permission else ""
    has_any_permission_display.short_description = "Có quyền"
    
    def permission_summary(self, obj):
        return obj.get_permission_summary()
    permission_summary.short_description = "Tóm tắt quyền hạn"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('employee', 'employee__department', 'employee__position', 'created_by')


# ======================
# RULE MODELS ADMIN CLASSES
# ======================

class RuleDefinitionAdmin(admin.ModelAdmin):
    """Admin interface for RuleDefinition"""
    list_display = (
        'rule_name', 'rule_type', 'scope_display', 'identifier',
        'priority', 'is_active', 'is_current_display',
        'effective_from', 'effective_to', 'created_at'
    )
    list_filter = ('rule_type', 'scope', 'is_active', 'effective_from')
    search_fields = ('rule_name', 'rule_type', 'description', 'identifier')
    raw_id_fields = ('created_by',)
    ordering = ('-priority', 'rule_type', 'rule_name')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('rule_name', 'rule_type', 'description')
        }),
        ('Điều kiện rule', {
            'fields': ('conditions',)
        }),
        ('Phạm vi áp dụng', {
            'fields': ('scope', 'identifier')
        }),
        ('Ưu tiên và hiệu lực', {
            'fields': ('priority', 'is_active', 'effective_from', 'effective_to')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('created_at', 'updated_at')
    
    def scope_display(self, obj):
        return obj.get_scope_display()
    scope_display.short_description = "Phạm vi"
    
    def is_current_display(self, obj):
        return "✓" if obj.is_current else ""
    is_current_display.short_description = "Hiệu lực"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('created_by')


class RuleExecutionLogAdmin(admin.ModelAdmin):
    """Admin interface for RuleExecutionLog"""
    list_display = (
        'rule_info', 'employee_info', 'event_info',
        'executed_at', 'executed_by_info', 'result_preview'
    )
    list_filter = ('executed_at', 'rule__rule_type')
    search_fields = (
        'rule__rule_name', 'employee__full_name', 'employee__employee_id',
        'event__event_type'
    )
    raw_id_fields = ('rule', 'employee', 'event', 'executed_by')
    ordering = ('-executed_at',)
    
    fieldsets = (
        ('Thông tin thực thi', {
            'fields': ('rule', 'employee', 'event', 'executed_by', 'executed_at')
        }),
        ('Kết quả thực thi', {
            'fields': ('execution_result', 'execution_context'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('executed_at',)
    
    def rule_info(self, obj):
        if obj.rule:
            return format_html(
                '{} ({})',
                obj.rule.rule_name,
                obj.rule.rule_type
            )
        return "Không có"
    rule_info.short_description = "Rule"
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({})',
                obj.employee.full_name,
                obj.employee.employee_id
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def event_info(self, obj):
        if obj.event:
            return format_html(
                '{} - {}',
                obj.event.event_type,
                obj.event.event_date
            )
        return "Không có"
    event_info.short_description = "Sự kiện"
    
    def executed_by_info(self, obj):
        if obj.executed_by:
            return format_html(
                '{} ({})',
                obj.executed_by.full_name,
                obj.executed_by.employee_id
            )
        return "Hệ thống"
    executed_by_info.short_description = "Người thực thi"
    
    def result_preview(self, obj):
        if obj.execution_result:
            result_str = str(obj.execution_result)
            return result_str[:50] + '...' if len(result_str) > 50 else result_str
        return "Không có"
    result_preview.short_description = "Kết quả"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('rule', 'employee', 'event', 'executed_by')


class RuleRegistryAdmin(admin.ModelAdmin):
    """Admin interface for RuleRegistry"""
    list_display = (
        'name', 'version', 'rules_count', 'created_by_info',
        'created_at', 'updated_at'
    )
    list_filter = ('created_at',)
    search_fields = ('name', 'description', 'version')
    raw_id_fields = ('created_by',)
    ordering = ('-created_at',)
    
    fieldsets = (
        ('Thông tin registry', {
            'fields': ('name', 'description', 'version')
        }),
        ('Dữ liệu rules', {
            'fields': ('rules_data',),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('created_at', 'updated_at')
    
    def rules_count(self, obj):
        if obj.rules_data and isinstance(obj.rules_data, list):
            return len(obj.rules_data)
        return 0
    rules_count.short_description = "Số rules"
    
    def created_by_info(self, obj):
        if obj.created_by:
            return format_html(
                '{} ({})',
                obj.created_by.full_name,
                obj.created_by.employee_id
            )
        return "Hệ thống"
    created_by_info.short_description = "Người tạo"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('created_by')


# ======================
# ATTENDANCE MODELS ADMIN
# ======================

class AttendanceAdmin(admin.ModelAdmin):
    """Admin interface for Attendance"""
    list_display = ('attendance_code', 'employee_info', 'attendance_date', 'check_in', 'check_out',
                   'status_display', 'shift_type_display', 'working_hours', 'overtime_hours',
                   'late_minutes', 'early_leave_minutes', 'created_at')
    list_filter = ('status', 'shift_type', 'attendance_date')
    search_fields = ('attendance_code', 'employee__full_name', 'employee__employee_id',
                    'notes', 'imported_from_file', 'import_batch')
    raw_id_fields = ('employee', 'created_by')
    ordering = ('-attendance_date', 'employee__full_name')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('attendance_code', 'employee', 'attendance_date', 'shift_type')
        }),
        ('Thời gian chấm công', {
            'fields': ('check_in', 'check_out', 'status')
        }),
        ('Tính toán', {
            'fields': ('working_hours', 'overtime_hours', 'late_minutes', 'early_leave_minutes')
        }),
        ('Thông tin import', {
            'fields': ('imported_from_file', 'import_batch'),
            'classes': ('collapse',)
        }),
        ('Ghi chú', {
            'fields': ('notes',),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('attendance_code', 'working_hours', 'overtime_hours', 'late_minutes',
                      'early_leave_minutes', 'created_at', 'updated_at')
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({}) - {}',
                obj.employee.full_name,
                obj.employee.employee_id,
                obj.employee.department.name if obj.employee.department else 'Không có phòng ban'
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def status_display(self, obj):
        return obj.get_status_display()
    status_display.short_description = "Trạng thái"
    
    def shift_type_display(self, obj):
        return obj.get_shift_type_display()
    shift_type_display.short_description = "Loại ca"
    
    def department(self, obj):
        return obj.employee.department if obj.employee else None
    department.short_description = "Phòng ban"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('employee', 'employee__department', 'created_by')


class AttendanceImportLogAdmin(admin.ModelAdmin):
    """Admin interface for AttendanceImportLog"""
    list_display = ('import_code', 'file_name', 'file_size_display', 'total_records',
                   'imported_records', 'failed_records', 'duplicate_records',
                   'imported_by_info', 'created_at', 'completed_at_display')
    list_filter = ('created_at',)
    search_fields = ('import_code', 'file_name', 'imported_by__full_name',
                    'imported_by__employee_id', 'error_log')
    raw_id_fields = ('imported_by',)
    ordering = ('-created_at',)
    
    fieldsets = (
        ('Thông tin import', {
            'fields': ('import_code', 'file_name', 'file_size')
        }),
        ('Kết quả import', {
            'fields': ('total_records', 'imported_records', 'failed_records',
                      'duplicate_records', 'import_result', 'error_log')
        }),
        ('Thông tin người import', {
            'fields': ('imported_by',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'completed_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('import_code', 'created_at', 'completed_at')
    
    def file_size_display(self, obj):
        if obj.file_size < 1024:
            return f"{obj.file_size} bytes"
        elif obj.file_size < 1024 * 1024:
            return f"{obj.file_size / 1024:.2f} KB"
        else:
            return f"{obj.file_size / (1024 * 1024):.2f} MB"
    file_size_display.short_description = "Kích thước file"
    
    def imported_by_info(self, obj):
        if obj.imported_by:
            return format_html(
                '{} ({})',
                obj.imported_by.full_name,
                obj.imported_by.employee_id
            )
        return "Hệ thống"
    imported_by_info.short_description = "Người import"
    
    def completed_at_display(self, obj):
        return obj.completed_at if obj.completed_at else "Đang xử lý"
    completed_at_display.short_description = "Hoàn thành lúc"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('imported_by')


# ======================
# MONTHLY WORK CREDIT ADMIN
# ======================

class MonthlyWorkCreditAdmin(admin.ModelAdmin):
    """Admin interface for MonthlyWorkCredit"""
    list_display = ('credit_code', 'employee_info', 'year', 'month', 'period_display',
                   'status_display', 'total_work_days', 'total_work_hours',
                   'total_overtime_hours', 'work_coefficient', 'overtime_coefficient',
                   'total_leave_days', 'approved_by_info', 'created_at')
    list_filter = ('status', 'year', 'month', 'approved_by')
    search_fields = ('credit_code', 'employee__full_name', 'employee__employee_id',
                    'notes', 'approval_note')
    raw_id_fields = ('employee', 'approved_by', 'created_by')
    ordering = ('-year', '-month', 'employee__full_name')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('credit_code', 'employee', 'year', 'month', 'status')
        }),
        ('Kết quả tính toán', {
            'fields': ('total_work_days', 'total_work_hours', 'total_overtime_hours',
                      'total_late_minutes', 'total_early_leave_minutes',
                      'work_coefficient', 'overtime_coefficient')
        }),
        ('Thông tin nghỉ phép', {
            'fields': ('total_leave_days', 'annual_leave_days', 'sick_leave_days',
                      'unpaid_leave_days'),
            'classes': ('collapse',)
        }),
        ('Chi tiết tính toán', {
            'fields': ('calculation_details', 'applied_rules', 'notes'),
            'classes': ('collapse',)
        }),
        ('Thông tin duyệt', {
            'fields': ('approved_by', 'approved_at', 'approval_note')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at', 'calculated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('credit_code', 'total_work_days', 'total_work_hours',
                      'total_overtime_hours', 'total_late_minutes', 'total_early_leave_minutes',
                      'work_coefficient', 'overtime_coefficient', 'total_leave_days',
                      'annual_leave_days', 'sick_leave_days', 'unpaid_leave_days',
                      'created_at', 'updated_at', 'calculated_at', 'approved_at')
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({}) - {}',
                obj.employee.full_name,
                obj.employee.employee_id,
                obj.employee.department.name if obj.employee.department else 'Không có phòng ban'
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def period_display(self, obj):
        return f"{obj.year}-{obj.month:02d}"
    period_display.short_description = "Kỳ"
    
    def status_display(self, obj):
        return obj.get_status_display()
    status_display.short_description = "Trạng thái"
    
    def approved_by_info(self, obj):
        if obj.approved_by:
            return format_html(
                '{} ({})',
                obj.approved_by.full_name,
                obj.approved_by.employee_id
            )
        return "Chưa duyệt"
    approved_by_info.short_description = "Người duyệt"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('employee', 'employee__department', 'approved_by', 'created_by')


class WorkCreditCalculationLogAdmin(admin.ModelAdmin):
    """Admin interface for WorkCreditCalculationLog"""
    list_display = ('work_credit_info', 'calculation_type', 'calculated_by_info',
                   'calculated_at', 'calculation_result_preview')
    list_filter = ('calculation_type', 'calculated_at')
    search_fields = ('work_credit__credit_code', 'work_credit__employee__full_name',
                    'work_credit__employee__employee_id', 'calculation_type',
                    'calculated_by__full_name', 'calculated_by__employee_id')
    raw_id_fields = ('work_credit', 'calculated_by')
    ordering = ('-calculated_at',)
    
    fieldsets = (
        ('Thông tin tính toán', {
            'fields': ('work_credit', 'calculation_type', 'calculated_by', 'calculated_at')
        }),
        ('Chi tiết tính toán', {
            'fields': ('calculation_details', 'calculation_result'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('calculated_at',)
    
    def work_credit_info(self, obj):
        if obj.work_credit:
            return format_html(
                '{} - {} ({}/{})',
                obj.work_credit.credit_code,
                obj.work_credit.employee.full_name,
                obj.work_credit.month,
                obj.work_credit.year
            )
        return "Không có"
    work_credit_info.short_description = "Bản ghi tính công"
    
    def calculated_by_info(self, obj):
        if obj.calculated_by:
            return format_html(
                '{} ({})',
                obj.calculated_by.full_name,
                obj.calculated_by.employee_id
            )
        return "Hệ thống"
    calculated_by_info.short_description = "Người tính toán"
    
    def calculation_result_preview(self, obj):
        if obj.calculation_result:
            result_str = str(obj.calculation_result)
            return result_str[:50] + '...' if len(result_str) > 50 else result_str
        return "Không có"
    calculation_result_preview.short_description = "Kết quả"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('work_credit', 'work_credit__employee', 'calculated_by')


# ======================
# ATTENDANCE RULE CONFIGURATION ADMIN
# ======================

from .models import (
    AttendanceRuleConfig, AttendanceRuleHistory, LeavePolicyConfig
)


class AttendanceRuleConfigAdmin(admin.ModelAdmin):
    """Admin interface for AttendanceRuleConfig"""
    list_display = ('code', 'name', 'rule_type_display', 'is_active', 'is_default',
                   'effective_from', 'effective_to', 'is_current_display', 'created_at')
    list_filter = ('rule_type', 'is_active', 'is_default', 'effective_from')
    search_fields = ('code', 'name', 'description')
    filter_horizontal = ('apply_to_departments', 'apply_to_positions', 'apply_to_employees')
    ordering = ('-effective_from', 'code')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'description', 'rule_type')
        }),
        ('Cấu hình quy tắc', {
            'fields': ('configuration',)
        }),
        ('Phạm vi áp dụng', {
            'fields': ('apply_to_all', 'apply_to_departments', 'apply_to_positions',
                      'apply_to_employees')
        }),
        ('Thông tin hiệu lực', {
            'fields': ('is_active', 'is_default', 'effective_from', 'effective_to')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('created_at', 'updated_at')
    
    def rule_type_display(self, obj):
        return obj.get_rule_type_display()
    rule_type_display.short_description = "Loại quy tắc"
    
    def is_current_display(self, obj):
        return "✓" if obj.is_current else ""
    is_current_display.short_description = "Hiệu lực"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related()


class AttendanceRuleHistoryAdmin(admin.ModelAdmin):
    """Admin interface for AttendanceRuleHistory"""
    list_display = ('attendance_info', 'rule_info', 'applied_by_info', 'applied_at',
                   'calculation_result_display', 'notes_preview')
    list_filter = ('applied_at', 'rule__rule_type')
    search_fields = ('attendance__attendance_code', 'rule__code', 'rule__name',
                    'applied_by__full_name', 'applied_by__employee_id', 'notes')
    raw_id_fields = ('attendance', 'rule', 'applied_by')
    ordering = ('-applied_at',)
    
    fieldsets = (
        ('Thông tin áp dụng', {
            'fields': ('attendance', 'rule', 'applied_by', 'applied_at')
        }),
        ('Kết quả tính toán', {
            'fields': ('calculation_result', 'notes')
        }),
    )
    
    readonly_fields = ('applied_at',)
    
    def attendance_info(self, obj):
        if obj.attendance:
            return format_html(
                '{} - {} ({})',
                obj.attendance.attendance_code,
                obj.attendance.employee.full_name,
                obj.attendance.attendance_date
            )
        return "Không có"
    attendance_info.short_description = "Chấm công"
    
    def rule_info(self, obj):
        if obj.rule:
            return format_html(
                '{} ({})',
                obj.rule.name,
                obj.rule.code
            )
        return "Không có"
    rule_info.short_description = "Quy tắc"
    
    def applied_by_info(self, obj):
        if obj.applied_by:
            return format_html(
                '{} ({})',
                obj.applied_by.full_name,
                obj.applied_by.employee_id
            )
        return "Hệ thống"
    applied_by_info.short_description = "Người áp dụng"
    
    def calculation_result_display(self, obj):
        if obj.calculation_result:
            return format_html(
                '<span title="{}">Xem kết quả</span>',
                str(obj.calculation_result)
            )
        return "Không có"
    calculation_result_display.short_description = "Kết quả"
    
    def notes_preview(self, obj):
        if obj.notes and len(obj.notes) > 50:
            return obj.notes[:50] + '...'
        return obj.notes or ''
    notes_preview.short_description = "Ghi chú"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('attendance', 'attendance__employee', 'rule', 'applied_by')


class LeavePolicyConfigAdmin(admin.ModelAdmin):
    """Admin interface for LeavePolicyConfig"""
    list_display = ('code', 'name', 'leave_type_display', 'is_active',
                   'effective_from', 'effective_to', 'is_current_display',
                   'requires_approval', 'requires_medical_certificate', 'created_at')
    list_filter = ('leave_type', 'is_active', 'requires_approval',
                  'requires_medical_certificate', 'effective_from')
    search_fields = ('code', 'name', 'description')
    filter_horizontal = ('apply_to_departments', 'apply_to_positions', 'apply_to_employees')
    ordering = ('-effective_from', 'code')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('code', 'name', 'description', 'leave_type')
        }),
        ('Cấu hình chính sách', {
            'fields': ('max_days_per_year', 'max_consecutive_days',
                      'advance_notice_rules', 'emergency_notice_hours',
                      'requires_approval', 'requires_medical_certificate')
        }),
        ('Phạm vi áp dụng', {
            'fields': ('apply_to_all', 'apply_to_departments', 'apply_to_positions',
                      'apply_to_employees')
        }),
        ('Thông tin hiệu lực', {
            'fields': ('is_active', 'effective_from', 'effective_to')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    readonly_fields = ('created_at', 'updated_at')
    
    def leave_type_display(self, obj):
        return obj.get_leave_type_display()
    leave_type_display.short_description = "Loại nghỉ phép"
    
    def is_current_display(self, obj):
        return "✓" if obj.is_current else ""
    is_current_display.short_description = "Hiệu lực"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related()


# ======================
# Inline Admin Classes for Attendance Rules
# ======================

class AttendanceRuleHistoryInline(admin.TabularInline):
    """Inline for AttendanceRuleHistory"""
    model = AttendanceRuleHistory
    fields = ('rule', 'applied_by', 'applied_at', 'calculation_result_preview')
    extra = 0
    show_change_link = True
    can_delete = False
    
    def has_add_permission(self, request, obj=None):
        return False
    
    def calculation_result_preview(self, obj):
        if obj.calculation_result:
            return str(obj.calculation_result)[:50] + '...' if len(str(obj.calculation_result)) > 50 else str(obj.calculation_result)
        return "Không có"
    calculation_result_preview.short_description = "Kết quả"

# ======================
# ONBOARDING PROCESS ADMIN
# ======================  
   
class OnboardingTaskInline(admin.TabularInline):
    """Inline để hiển thị tasks trong OnboardingProcess"""
    model = OnboardingTask
    extra = 0
    fields = ('name', 'task_type', 'order', 'status', 'deadline', 'assigned_to')
    readonly_fields = ('started_at', 'completed_at')


class OnboardingDocumentInline(admin.TabularInline):
    """Inline để hiển thị documents trong OnboardingProcess"""
    model = OnboardingDocument
    extra = 0
    fields = ('document_name', 'document_type', 'is_required', 'is_read', 'is_signed')
    readonly_fields = ('uploaded_at',)


@admin.register(OnboardingProcess)
class OnboardingProcessAdmin(admin.ModelAdmin):
    list_display = (
        'onboarding_code', 'candidate_name', 'position', 'department',
        'start_date', 'status', 'progress_percentage', 'created_at'
    )
    list_filter = ('status', 'department', 'position', 'start_date', 'contract_type')
    search_fields = ('onboarding_code', 'candidate_name', 'candidate_email', 'candidate_phone')
    readonly_fields = ('onboarding_code', 'progress_percentage', 'created_at', 'updated_at', 'completed_at')
    
    fieldsets = (
        ('Thông tin cơ bản', {
            'fields': ('onboarding_code', 'status', 'progress_percentage')
        }),
        ('Thông tin ứng viên', {
            'fields': (
                'candidate_name', 'candidate_email', 'candidate_phone',
                'citizen_id', 'date_of_birth', 'gender'
            )
        }),
        ('Địa chỉ', {
            'fields': ('permanent_address', 'current_address')
        }),
        ('Học vấn', {
            'fields': ('education_level', 'university', 'major', 'graduation_year'),
            'classes': ('collapse',)
        }),
        ('Thông tin công việc', {
            'fields': (
                'position', 'department', 'direct_manager', 
                'start_date', 'expected_end_date'
            )
        }),
        ('Hợp đồng', {
            'fields': (
                'contract_type', 'probation_period_months',
                'salary', 'salary_note'
            )
        }),
        ('Tài chính', {
            'fields': (
                'bank_name', 'bank_account', 'bank_branch', 'bank_account_holder',
                'tax_code', 'tax_dependents'
            ),
            'classes': ('collapse',)
        }),
        ('File đính kèm', {
            'fields': ('cv_file', 'id_card_front', 'id_card_back', 'diploma_file'),
            'classes': ('collapse',)
        }),
        ('Quản lý', {
            'fields': ('hr_responsible', 'employee', 'notes')
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at', 'completed_at', 'created_by'),
            'classes': ('collapse',)
        }),
    )
    
    inlines = [OnboardingTaskInline, OnboardingDocumentInline]
    
    actions = ['start_onboarding', 'complete_onboarding']
    
    def start_onboarding(self, request, queryset):
        """Action để bắt đầu quy trình onboarding"""
        count = 0
        for process in queryset:
            if process.start_process():
                count += 1
        
        self.message_user(request, f"Đã bắt đầu {count} quy trình onboarding")
    start_onboarding.short_description = "▶️ Bắt đầu quy trình onboarding"
    
    def complete_onboarding(self, request, queryset):
        """Action để hoàn thành quy trình onboarding"""
        count = 0
        errors = []
        
        for process in queryset:
            result = process.complete_process()
            if result['success']:
                count += 1
            else:
                errors.append(f"{process.onboarding_code}: {result['message']}")
        
        if count > 0:
            self.message_user(request, f"Đã hoàn thành {count} quy trình onboarding")
        
        if errors:
            self.message_user(request, "Lỗi: " + "; ".join(errors), level='warning')
    
    complete_onboarding.short_description = "✅ Hoàn thành quy trình onboarding"


@admin.register(OnboardingTask)
class OnboardingTaskAdmin(admin.ModelAdmin):
    list_display = (
        'onboarding_process', 'name', 'task_type', 'order',
        'status', 'deadline', 'assigned_to', 'is_overdue'
    )
    list_filter = ('status', 'task_type', 'deadline')
    search_fields = ('name', 'onboarding_process__candidate_name', 'onboarding_process__onboarding_code')
    readonly_fields = ('started_at', 'completed_at', 'created_at', 'updated_at')
    
    fieldsets = (
        ('Thông tin task', {
            'fields': ('onboarding_process', 'name', 'description', 'task_type')
        }),
        ('Thứ tự và deadline', {
            'fields': ('order', 'deadline')
        }),
        ('Trạng thái', {
            'fields': ('status', 'assigned_to')
        }),
        ('Kết quả', {
            'fields': ('completion_note', 'attachment'),
            'classes': ('collapse',)
        }),
        ('Thời gian', {
            'fields': ('started_at', 'completed_at', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    actions = ['mark_completed', 'mark_in_progress']
    
    def mark_completed(self, request, queryset):
        """Action để đánh dấu task hoàn thành"""
        count = 0
        for task in queryset:
            if task.complete_task():
                count += 1
        
        self.message_user(request, f"Đã hoàn thành {count} task")
    mark_completed.short_description = "✅ Đánh dấu hoàn thành"
    
    def mark_in_progress(self, request, queryset):
        """Action để bắt đầu task"""
        count = 0
        for task in queryset:
            if task.start_task():
                count += 1
        
        self.message_user(request, f"Đã bắt đầu {count} task")
    mark_in_progress.short_description = "▶️ Bắt đầu task"


@admin.register(OnboardingChecklist)
class OnboardingChecklistAdmin(admin.ModelAdmin):
    list_display = ('task', 'title', 'order', 'is_completed', 'is_required')
    list_filter = ('is_completed', 'is_required')
    search_fields = ('title', 'task__name')
    readonly_fields = ('completed_at', 'created_at', 'updated_at')


@admin.register(OnboardingDocument)
class OnboardingDocumentAdmin(admin.ModelAdmin):
    list_display = (
        'onboarding_process', 'document_name', 'document_type',
        'is_required', 'is_read', 'is_signed', 'uploaded_at'
    )
    list_filter = ('document_type', 'is_required', 'requires_signature', 'is_read', 'is_signed')
    search_fields = (
        'document_name', 
        'onboarding_process__candidate_name', 
        'onboarding_process__onboarding_code'
    )
    readonly_fields = ('uploaded_at', 'signed_at')
    
    fieldsets = (
        ('Thông tin tài liệu', {
            'fields': ('onboarding_process', 'document_name', 'document_type', 'description')
        }),
        ('File', {
            'fields': ('file',)
        }),
        ('Yêu cầu', {
            'fields': ('is_required', 'requires_signature')
        }),
        ('Trạng thái', {
            'fields': ('is_read', 'is_signed', 'signed_at', 'signature_file')
        }),
        ('Hệ thống', {
            'fields': ('uploaded_at', 'uploaded_by'),
            'classes': ('collapse',)
        }),
    )
    
    actions = ['mark_as_read']
    
    def mark_as_read(self, request, queryset):
        """Action để đánh dấu tài liệu đã đọc"""
        count = 0
        for doc in queryset:
            if doc.mark_as_read():
                count += 1
        
        self.message_user(request, f"Đã đánh dấu {count} tài liệu là đã đọc")
    mark_as_read.short_description = "👁️ Đánh dấu đã đọc"

@admin.register(OnboardingDocumentTemplate)
class OnboardingDocumentTemplateAdmin(admin.ModelAdmin):
    list_display = ['template_name', 'document_type', 'is_active', 'apply_to_all_new_onboarding']
    list_editable = ['is_active', 'apply_to_all_new_onboarding']
    
# ======================
# Register models
# ======================
admin.site.register(ApprovalWorkflow, ApprovalWorkflowAdmin)
admin.site.register(LeaveRequest, LeaveRequestAdmin)
admin.site.register(OvertimeRequest, OvertimeRequestAdmin)
admin.site.register(AttendanceExplanation, AttendanceExplanationAdmin)
admin.site.register(ApprovalRecord, ApprovalRecordAdmin)

# Register attendance models
admin.site.register(Attendance, AttendanceAdmin)
admin.site.register(AttendanceImportLog, AttendanceImportLogAdmin)

# Register company information models
admin.site.register(CompanyDocument, CompanyDocumentAdmin)
admin.site.register(CompanyAnnouncement, CompanyAnnouncementAdmin)
admin.site.register(CompanyDocumentViewLog, CompanyDocumentViewLogAdmin)
admin.site.register(CompanyAnnouncementViewLog, CompanyAnnouncementViewLogAdmin)

# Register company configuration models
admin.site.register(CompanyConfig, CompanyConfigAdmin)
admin.site.register(ShiftConfig, ShiftConfigAdmin)
admin.site.register(HolidayConfig, HolidayConfigAdmin)

# Register attendance rule configuration models
admin.site.register(AttendanceRuleConfig, AttendanceRuleConfigAdmin)
admin.site.register(AttendanceRuleHistory, AttendanceRuleHistoryAdmin)
admin.site.register(LeavePolicyConfig, LeavePolicyConfigAdmin)

# Register monthly work credit models
admin.site.register(MonthlyWorkCredit, MonthlyWorkCreditAdmin)
admin.site.register(WorkCreditCalculationLog, WorkCreditCalculationLogAdmin)



# Register employee permission model
admin.site.register(EmployeePermission, EmployeePermissionAdmin)


# ══════════════════════════════════════════════════════════════════
# ATTENDANCE ENGINE MODELS ADMIN  (hrm/attendance_models.py)
# ══════════════════════════════════════════════════════════════════

from .attendance_models import (
    AttendancePolicyVersion,
    PenaltyTierConfig,
    AttendancePolicyConfig,
    RegistrationRequest,
    OnlineWorkRequest,
    AttendanceEventLog,
    LivestreamSessionConfig,
    AttendanceRanking,
    BranchLocation,
)


@admin.register(BranchLocation)
class BranchLocationAdmin(admin.ModelAdmin):
    list_display = ['name', 'address', 'latitude', 'longitude', 'radius_meters', 'company_unit', 'is_active']
    list_filter = ['is_active']
    search_fields = ['name', 'address']
    list_editable = ['is_active', 'radius_meters']

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        from .location_utils import invalidate_branch_cache
        invalidate_branch_cache()

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        from .location_utils import invalidate_branch_cache
        invalidate_branch_cache()


# ──────────────────────────────────────────────────────────────────
# Inline: PenaltyTierConfig trong AttendancePolicyVersion
# ──────────────────────────────────────────────────────────────────

class PenaltyTierConfigInline(admin.TabularInline):
    model = PenaltyTierConfig
    extra = 1
    fields = (
        "order", "max_minutes",
        "fine_amount_regular", "fine_amount_manager",
        "deduct_work_credit", "description",
    )
    ordering = ("order",)


# ──────────────────────────────────────────────────────────────────
# Inline: AttendancePolicyConfig trong AttendancePolicyVersion
# ──────────────────────────────────────────────────────────────────

class AttendancePolicyConfigInline(admin.StackedInline):
    model = AttendancePolicyConfig
    extra = 0
    can_delete = False
    fields = (
        "max_explanation_quota",
        "penalty_multiplier_threshold", "penalty_multiplier_value",
        "parking_allowance_per_day",
        "live_prime_time_allowance", "live_prime_start_hour", "live_prime_end_hour",
        "max_live_prime_time_pct", "max_ot_live_pct",
        "incomplete_no_expl_deduction", "incomplete_approved_deduction",
    )
    verbose_name = "Cấu hình chính sách"
    verbose_name_plural = "Cấu hình chính sách"


# ──────────────────────────────────────────────────────────────────
# AttendancePolicyVersion Admin
# ──────────────────────────────────────────────────────────────────

@admin.register(AttendancePolicyVersion)
class AttendancePolicyVersionAdmin(admin.ModelAdmin):
    list_display = (
        "version_code", "name", "effective_from", "effective_to",
        "is_active", "tier_count", "created_at",
    )
    list_filter  = ("is_active", "effective_from")
    search_fields = ("version_code", "name", "description")
    ordering = ("-effective_from",)
    readonly_fields = ("created_at", "updated_at")
    inlines = [PenaltyTierConfigInline, AttendancePolicyConfigInline]

    fieldsets = (
        ("Thông tin phiên bản", {
            "fields": ("version_code", "name", "description", "is_active"),
        }),
        ("Thời gian hiệu lực", {
            "fields": ("effective_from", "effective_to"),
        }),
        ("Thông tin hệ thống", {
            "fields": ("created_by", "created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    actions = ["activate_version"]

    def tier_count(self, obj):
        return obj.penalty_tiers.count()
    tier_count.short_description = "Số mức phạt"

    def activate_version(self, request, queryset):
        if queryset.count() != 1:
            self.message_user(request, "Chỉ chọn đúng 1 version để activate.", level="warning")
            return
        v = queryset.first()
        v.is_active = True
        v.save()
        from hrm.attendance_engine import PolicyLoader
        PolicyLoader.clear_cache()
        self.message_user(request, f"Đã activate version '{v.version_code}'.")
    activate_version.short_description = "✔ Kích hoạt version này"

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("penalty_tiers")


# ──────────────────────────────────────────────────────────────────
# PenaltyTierConfig Admin  (standalone – cũng có trong inline trên)
# ──────────────────────────────────────────────────────────────────

@admin.register(PenaltyTierConfig)
class PenaltyTierConfigAdmin(admin.ModelAdmin):
    list_display  = (
        "version", "order", "max_minutes_label",
        "fine_amount_regular", "fine_amount_manager",
        "deduct_work_credit", "description",
    )
    list_filter   = ("version",)
    search_fields = ("version__version_code", "description")
    ordering      = ("version__effective_from", "order")

    def max_minutes_label(self, obj):
        return f"≤ {obj.max_minutes} phút" if obj.max_minutes else "> tier trước"
    max_minutes_label.short_description = "Khoảng thời gian"


# ──────────────────────────────────────────────────────────────────
# AttendancePolicyConfig Admin
# ──────────────────────────────────────────────────────────────────

@admin.register(AttendancePolicyConfig)
class AttendancePolicyConfigAdmin(admin.ModelAdmin):
    list_display = (
        "version", "max_explanation_quota",
        "penalty_multiplier_threshold", "penalty_multiplier_value",
        "parking_allowance_per_day",
        "live_prime_time_allowance", "updated_at",
    )
    list_filter   = ("version",)
    search_fields = ("version__version_code",)
    ordering      = ("-version__effective_from",)
    readonly_fields = ("created_at", "updated_at")

    fieldsets = (
        ("Phiên bản", {"fields": ("version",)}),
        ("Giải trình & Phạt", {
            "fields": (
                "max_explanation_quota",
                "penalty_multiplier_threshold", "penalty_multiplier_value",
            ),
        }),
        ("Phụ cấp", {
            "fields": (
                "parking_allowance_per_day",
                "live_prime_time_allowance",
                "live_prime_start_hour", "live_prime_end_hour",
                "max_live_prime_time_pct", "max_ot_live_pct",
            ),
        }),
        ("Quên chấm công", {
            "fields": (
                "incomplete_no_expl_deduction",
                "incomplete_approved_deduction",
            ),
        }),
        ("Hệ thống", {
            "fields": ("created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )


# ──────────────────────────────────────────────────────────────────
# RegistrationRequest Admin
# ──────────────────────────────────────────────────────────────────

@admin.register(RegistrationRequest)
class RegistrationRequestAdmin(admin.ModelAdmin):
    list_display  = (
        "request_code", "employee_name", "department_name",
        "request_type", "registration_date",
        "start_time", "end_time", "total_hours",
        "live_role", "is_prime_time", "status",
        "approved_by_name", "created_at",
    )
    list_filter   = (
        "request_type", "status", "is_prime_time",
        "registration_date", "department",
    )
    search_fields = (
        "request_code", "employee__full_name", "employee__employee_id",
        "department__name", "reason",
    )
    raw_id_fields = ("employee", "department", "approved_by", "created_by", "policy_version")
    ordering      = ("-registration_date", "-created_at")
    readonly_fields = (
        "request_code", "is_prime_time", "total_hours",
        "approved_at", "created_at", "updated_at",
    )

    fieldsets = (
        ("Thông tin đơn", {
            "fields": (
                "request_code", "employee", "department",
                "request_type", "registration_date",
                "start_time", "end_time", "total_hours",
            ),
        }),
        ("Live stream", {
            "fields": ("live_role", "is_prime_time"),
            "classes": ("collapse",),
        }),
        ("Nội dung", {
            "fields": ("reason", "notes"),
        }),
        ("Duyệt", {
            "fields": ("status", "approved_by", "approved_at", "approval_note"),
        }),
        ("Hệ thống", {
            "fields": ("policy_version", "created_by", "created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    actions = ["approve_selected", "reject_selected"]

    def employee_name(self, obj):
        return obj.employee.full_name if obj.employee else "—"
    employee_name.short_description = "Nhân viên"

    def department_name(self, obj):
        return obj.department.name if obj.department else "—"
    department_name.short_description = "Phòng ban"

    def approved_by_name(self, obj):
        return obj.approved_by.full_name if obj.approved_by else "—"
    approved_by_name.short_description = "Người duyệt"

    def approve_selected(self, request, queryset):
        from employee.models import Employee as Emp
        try:
            approver = Emp.objects.get(user=request.user)
        except Emp.DoesNotExist:
            self.message_user(request, "Không tìm thấy nhân viên tương ứng.", level="error")
            return
        count = 0
        for rr in queryset.filter(status="PENDING"):
            rr.approve(approver)
            count += 1
        self.message_user(request, f"Đã duyệt {count} đơn đăng ký.")
    approve_selected.short_description = "✔ Duyệt các đơn đã chọn"

    def reject_selected(self, request, queryset):
        from employee.models import Employee as Emp
        try:
            approver = Emp.objects.get(user=request.user)
        except Emp.DoesNotExist:
            self.message_user(request, "Không tìm thấy nhân viên tương ứng.", level="error")
            return
        count = 0
        for rr in queryset.filter(status="PENDING"):
            rr.reject(approver, "Từ chối từ Admin")
            count += 1
        self.message_user(request, f"Đã từ chối {count} đơn đăng ký.")
    reject_selected.short_description = "✘ Từ chối các đơn đã chọn"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "employee", "department", "approved_by", "policy_version"
        )


# ──────────────────────────────────────────────────────────────────
# OnlineWorkRequest Admin
# ──────────────────────────────────────────────────────────────────

@admin.register(OnlineWorkRequest)
class OnlineWorkRequestAdmin(admin.ModelAdmin):
    list_display  = (
        "request_code", "employee_name", "work_date",
        "status", "approved_by_name", "approved_at", "created_at",
    )
    list_filter   = ("status", "work_date")
    search_fields = (
        "request_code", "employee__full_name",
        "employee__employee_id", "reason",
    )
    raw_id_fields = ("employee", "approved_by", "policy_version")
    ordering      = ("-work_date", "-created_at")
    readonly_fields = ("request_code", "approved_at", "created_at", "updated_at")

    fieldsets = (
        ("Thông tin đơn", {
            "fields": ("request_code", "employee", "work_date", "reason", "evidence"),
        }),
        ("Duyệt", {
            "fields": ("status", "approved_by", "approved_at", "approval_note"),
        }),
        ("Hệ thống", {
            "fields": ("policy_version", "created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    actions = ["approve_selected", "reject_selected"]

    def employee_name(self, obj):
        return obj.employee.full_name if obj.employee else "—"
    employee_name.short_description = "Nhân viên"

    def approved_by_name(self, obj):
        return obj.approved_by.full_name if obj.approved_by else "—"
    approved_by_name.short_description = "Người duyệt"

    def approve_selected(self, request, queryset):
        from employee.models import Employee as Emp
        try:
            approver = Emp.objects.get(user=request.user)
        except Emp.DoesNotExist:
            self.message_user(request, "Không tìm thấy nhân viên tương ứng.", level="error")
            return
        count = 0
        for ow in queryset.filter(status="PENDING"):
            ow.approve(approver)
            count += 1
        self.message_user(request, f"Đã duyệt {count} đơn làm online.")
    approve_selected.short_description = "✔ Duyệt các đơn đã chọn"

    def reject_selected(self, request, queryset):
        from employee.models import Employee as Emp
        try:
            approver = Emp.objects.get(user=request.user)
        except Emp.DoesNotExist:
            self.message_user(request, "Không tìm thấy nhân viên tương ứng.", level="error")
            return
        count = 0
        for ow in queryset.filter(status="PENDING"):
            ow.reject(approver, "Từ chối từ Admin")
            count += 1
        self.message_user(request, f"Đã từ chối {count} đơn làm online.")
    reject_selected.short_description = "✘ Từ chối các đơn đã chọn"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "employee", "approved_by", "policy_version"
        )


# ──────────────────────────────────────────────────────────────────
# AttendanceEventLog Admin
# ──────────────────────────────────────────────────────────────────

@admin.register(AttendanceEventLog)
class AttendanceEventLogAdmin(admin.ModelAdmin):
    list_display  = (
        "event_id_short", "event_type", "employee_name",
        "event_date", "rule_version_code",
        "result_summary", "created_at",
    )
    list_filter   = ("event_type", "rule_version_code", "event_date")
    search_fields = (
        "employee__full_name", "employee__employee_id",
        "event_type", "rule_version_code",
    )
    raw_id_fields = ("employee", "policy_version")
    ordering      = ("-event_date", "-event_timestamp")
    readonly_fields = (
        "event_id", "event_type", "employee", "event_date",
        "event_timestamp", "context_snapshot", "rule_result",
        "policy_version", "rule_version_code",
        "attendance_id", "registration_id", "explanation_id",
        "created_at",
    )

    fieldsets = (
        ("Thông tin sự kiện", {
            "fields": (
                "event_id", "event_type", "employee",
                "event_date", "event_timestamp", "rule_version_code",
            ),
        }),
        ("Context & Kết quả", {
            "fields": ("context_snapshot", "rule_result"),
            "classes": ("collapse",),
        }),
        ("Tham chiếu", {
            "fields": (
                "policy_version",
                "attendance_id", "registration_id", "explanation_id",
            ),
            "classes": ("collapse",),
        }),
        ("Hệ thống", {
            "fields": ("created_at",),
            "classes": ("collapse",),
        }),
    )

    def has_add_permission(self, request):
        return False  # Event log chỉ đọc

    def has_change_permission(self, request, obj=None):
        return False

    def event_id_short(self, obj):
        return str(obj.event_id)[:8] + "…"
    event_id_short.short_description = "Event ID"

    def employee_name(self, obj):
        return obj.employee.full_name if obj.employee else "—"
    employee_name.short_description = "Nhân viên"

    def result_summary(self, obj):
        r = obj.rule_result or {}
        parts = []
        if r.get("work_credit"):
            parts.append(f"Công: {r['work_credit']}")
        if r.get("penalty_amount"):
            parts.append(f"Phạt: {r['penalty_amount']:,.0f}đ")
        if r.get("parking"):
            parts.append(f"Gửi xe: {r['parking']:,.0f}đ")
        if r.get("ot_hours"):
            parts.append(f"OT: {r['ot_hours']}h")
        return " | ".join(parts) if parts else "—"
    result_summary.short_description = "Tóm tắt kết quả"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("employee", "policy_version")


# ──────────────────────────────────────────────────────────────────
# LivestreamSessionConfig Admin
# ──────────────────────────────────────────────────────────────────

@admin.register(LivestreamSessionConfig)
class LivestreamSessionConfigAdmin(admin.ModelAdmin):
    list_display  = (
        "department_name", "year", "month",
        "total_planned_sessions", "max_prime_time_override",
        "ot_override_approved", "policy_version",
        "created_at",
    )
    list_filter   = ("year", "month", "ot_override_approved", "department")
    search_fields = ("department__name",)
    raw_id_fields = ("department", "ot_override_approved_by", "policy_version")
    ordering      = ("-year", "-month", "department__name")
    readonly_fields = ("ot_override_approved_at", "created_at", "updated_at")

    fieldsets = (
        ("Phòng ban & Kỳ", {
            "fields": ("department", "year", "month", "policy_version"),
        }),
        ("Quota phiên Live", {
            "fields": ("total_planned_sessions", "max_prime_time_override"),
        }),
        ("Override OT vượt 20%", {
            "fields": (
                "ot_override_approved",
                "ot_override_approved_by", "ot_override_approved_at",
                "ot_override_note",
            ),
            "classes": ("collapse",),
        }),
        ("Hệ thống", {
            "fields": ("created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    def department_name(self, obj):
        return obj.department.name if obj.department else "—"
    department_name.short_description = "Phòng ban"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "department", "ot_override_approved_by", "policy_version"
        )


# ──────────────────────────────────────────────────────────────────
# EmployeeEvent Admin
# ──────────────────────────────────────────────────────────────────

@admin.register(EmployeeEvent)
class EmployeeEventAdmin(admin.ModelAdmin):
    list_display = (
        "employee_info", "event_date", "event_type_display",
        "check_in", "checkin_branch_info",
        "check_out", "checkout_branch_info",
        "created_at", "created_by_info"
    )
    list_filter = ("event_type", "event_date", "created_at")
    search_fields = (
        "employee__full_name", "employee__employee_id",
        "notes", "explanation"
    )
    raw_id_fields = ("employee", "created_by")
    ordering = ("-event_date", "-created_at")
    readonly_fields = ("created_at", "updated_at")

    fieldsets = (
        ("Thông tin sự kiện", {
            "fields": ("employee", "event_date", "event_type")
        }),
        ("Thông tin chấm công", {
            "fields": (
                "check_in", "branch_location", "checkin_distance_m",
                "check_out", "checkout_branch_location", "checkout_distance_m",
                "overtime_hours",
            ),
            "classes": ("collapse",),
        }),
        ("Dữ liệu sự kiện", {
            "fields": ("data", "explanation", "notes"),
            "classes": ("collapse",),
        }),
        ("Thông tin hệ thống", {
            "fields": ("created_by", "created_at", "updated_at"),
            "classes": ("collapse",),
        }),
    )

    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({}) - {}',
                obj.employee.full_name,
                obj.employee.employee_id,
                obj.employee.department.name if obj.employee.department else 'Không có phòng ban'
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"

    def event_type_display(self, obj):
        return obj.get_event_type_display()
    event_type_display.short_description = "Loại sự kiện"

    def checkin_branch_info(self, obj):
        if obj.branch_location:
            dist = f" ({round(obj.checkin_distance_m)}m)" if obj.checkin_distance_m is not None else ""
            return f"{obj.branch_location.name}{dist}"
        return "-"
    checkin_branch_info.short_description = "Cơ sở check-in"

    def checkout_branch_info(self, obj):
        if obj.checkout_branch_location:
            dist = f" ({round(obj.checkout_distance_m)}m)" if obj.checkout_distance_m is not None else ""
            return f"{obj.checkout_branch_location.name}{dist}"
        return "-"
    checkout_branch_info.short_description = "Cơ sở checkout"

    def created_by_info(self, obj):
        if obj.created_by:
            return obj.created_by.full_name
        return "Hệ thống"
    created_by_info.short_description = "Người tạo"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "employee", "employee__department", "created_by",
            "branch_location", "checkout_branch_location"
        )


@admin.register(EmployeeEventAuditLog)
class EmployeeEventAuditLogAdmin(admin.ModelAdmin):
    list_display = (
        "created_at", "action", "employee_info", "event_date",
        "performed_by_info", "performed_by_role", "changed_fields",
    )
    list_filter = ("action", "performed_by_role", "created_at", "event__event_type")
    search_fields = (
        "employee__full_name", "employee__employee_id",
        "performed_by_user__username", "performed_by_employee__full_name",
    )
    raw_id_fields = ("event", "employee", "performed_by_user", "performed_by_employee")
    readonly_fields = (
        "event", "employee", "action", "old_values", "new_values",
        "changed_fields", "performed_by_user", "performed_by_employee",
        "performed_by_role", "request_payload", "created_at",
    )
    ordering = ("-created_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                "{} ({})",
                obj.employee.full_name,
                obj.employee.employee_id,
            )
        return "Không có"
    employee_info.short_description = "Nhân viên được sửa"

    def event_date(self, obj):
        return obj.event.event_date if obj.event else None
    event_date.short_description = "Ngày chấm công"

    def performed_by_info(self, obj):
        if obj.performed_by_employee:
            return format_html(
                "{} ({})",
                obj.performed_by_employee.full_name,
                obj.performed_by_employee.employee_id,
            )
        if obj.performed_by_user:
            return obj.performed_by_user.username
        return "Hệ thống"
    performed_by_info.short_description = "Người thực hiện"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related(
            "event", "employee", "performed_by_user", "performed_by_employee"
        )


@admin.register(ContractTemplate)
class ContractTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'contract_type', 'status', 'created_at']
    list_filter = ['contract_type', 'status']
    search_fields = ['name']

@admin.register(EmployeeContract)
class EmployeeContractAdmin(admin.ModelAdmin):
    list_display = ['employee', 'contract_type', 'status', 'start_date', 'end_date']
    list_filter = ['contract_type', 'status']
    search_fields = ['employee__full_name', 'employee__employee_id']

# ======================
# EMAIL QUEUE MODELS ADMIN
# ======================

from .models import EmailQueue, EmailBatch


class EmailQueueAdmin(admin.ModelAdmin):
    """Admin interface for EmailQueue"""
    list_display = (
        'id', 'employee_info', 'email_type', 'status', 
        'recipient_email', 'retry_count', 'created_at', 'processed_at'
    )
    list_filter = ('status', 'email_type', 'created_at')
    search_fields = (
        'recipient_email', 'recipient_name',
        'employee__full_name', 'employee__employee_id',
        'batch_id', 'error_message'
    )
    raw_id_fields = ('employee', 'created_by')
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'processed_at', 'error_message')
    
    fieldsets = (
        ('Thông tin email', {
            'fields': ('employee', 'email_type', 'status', 'recipient_email', 'recipient_name')
        }),
        ('Nội dung', {
            'fields': ('new_password',),
            'classes': ('collapse',)
        }),
        ('Retry mechanism', {
            'fields': ('retry_count', 'max_retries'),
            "classes": ("collapse",),
        }),
        ('Batch tracking', {
            'fields': ('batch_id', 'created_by'),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'processed_at', 'error_message'),
            'classes': ('collapse',)
        }),
    )
    
    def employee_info(self, obj):
        if obj.employee:
            return format_html(
                '{} ({})',
                obj.employee.full_name,
                obj.employee.employee_id
            )
        return "Không có"
    employee_info.short_description = "Nhân viên"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('employee', 'created_by')


class EmailBatchAdmin(admin.ModelAdmin):
    """Admin interface for EmailBatch"""
    list_display = (
        'batch_id', 'total_emails', 'sent_count', 'failed_count', 
        'pending_count', 'status', 'created_by_info', 'created_at', 'completed_at'
    )
    list_filter = ('status', 'created_at')
    search_fields = ('batch_id', 'created_by__full_name', 'created_by__employee_id')
    raw_id_fields = ('created_by',)
    ordering = ('-created_at',)
    readonly_fields = ('created_at', 'updated_at', 'completed_at')
    
    fieldsets = (
        ('Thông tin batch', {
            'fields': ('batch_id', 'status')
        }),
        ('Thống kê', {
            'fields': ('total_emails', 'sent_count', 'failed_count', 'pending_count')
        }),
        ('Thông tin người tạo', {
            'fields': ('created_by',),
            'classes': ('collapse',)
        }),
        ('Thông tin hệ thống', {
            'fields': ('created_at', 'updated_at', 'completed_at'),
            'classes': ('collapse',)
        }),
    )
    
    def created_by_info(self, obj):
        if obj.created_by:
            # Try to get employee info if available
            try:
                employee = obj.created_by.employee
                return format_html(
                    '{} ({})',
                    employee.full_name,
                    employee.employee_id
                )
            except:
                return obj.created_by.username
        return "Hệ thống"
    created_by_info.short_description = "Người tạo"
    
    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        return queryset.select_related('created_by')


# ======================
# Register Rule Models
# ======================
admin.site.register(RuleDefinition, RuleDefinitionAdmin)
admin.site.register(RuleExecutionLog, RuleExecutionLogAdmin)
admin.site.register(RuleRegistry, RuleRegistryAdmin)

# ======================
# Register Email Queue Models
# ======================
admin.site.register(EmailQueue, EmailQueueAdmin)
admin.site.register(EmailBatch, EmailBatchAdmin)

# ======================
# Department Work Finalization Approval Admin
# ======================

class WorkFinalizationApprovalLogInline(admin.TabularInline):
    model = WorkFinalizationApprovalLog
    fields = ('action', 'performed_by', 'performed_at', 'from_status', 'to_status', 'note')
    readonly_fields = ('performed_at',)
    extra = 0
    can_delete = True
    
    def has_add_permission(self, request, obj=None):
        return False

@admin.register(DepartmentWorkFinalizationApproval)
class DepartmentWorkFinalizationApprovalAdmin(admin.ModelAdmin):
    list_display = ('department_code', 'department_name', 'year', 'month', 'status', 'sent_by_info', 'approved_by_info', 'sent_at')
    list_filter = ('status', 'year', 'month', 'department')
    search_fields = ('department_code', 'department__name', 'sent_by__full_name', 'approved_by__full_name')
    readonly_fields = ('sent_at', 'approved_at')
    inlines = [WorkFinalizationApprovalLogInline]
    ordering = ('-year', '-month', 'department_code')
    
    def department_name(self, obj):
        return obj.department.name if obj.department else ""
    department_name.short_description = "Tên phòng ban"
    
    def sent_by_info(self, obj):
        if obj.sent_by:
            return f"{obj.sent_by.full_name} ({obj.sent_by.employee_id})"
        return "Hệ thống"
    sent_by_info.short_description = "Người gửi"
    
    def approved_by_info(self, obj):
        if obj.approved_by:
            return f"{obj.approved_by.full_name} ({obj.approved_by.employee_id})"
        return "---"
    approved_by_info.short_description = "Người duyệt"

@admin.register(WorkFinalizationApprovalLog)
class WorkFinalizationApprovalLogAdmin(admin.ModelAdmin):
    list_display = ('get_dept', 'get_period', 'action', 'performed_by_info', 'performed_at', 'status_change')
    list_filter = ('action', 'performed_at', 'approval__year', 'approval__month')
    search_fields = ('approval__department_code', 'performed_by__full_name', 'note')
    readonly_fields = ('performed_at',)
    ordering = ('-performed_at',)
    
    def get_dept(self, obj):
        return obj.approval.department_code
    get_dept.short_description = "Mã PB"
    
    def get_period(self, obj):
        return f"{obj.approval.month}/{obj.approval.year}"
    get_period.short_description = "Kỳ công"
    
    def performed_by_info(self, obj):
        if obj.performed_by:
            return obj.performed_by.full_name
        return "Hệ thống"
    performed_by_info.short_description = "Người thực hiện"
    
    def status_change(self, obj):
        if obj.from_status or obj.to_status:
            return f"{obj.from_status} → {obj.to_status}"
        return "---"
    status_change.short_description = "Thay đổi trạng thái"




# ======================
# WorkFinalization Admin
# ======================
@admin.register(WorkFinalization)
class WorkFinalizationAdmin(admin.ModelAdmin):
    change_list_template = 'admin/hrm/workfinalization/change_list.html'

    list_display = (
        'employee_code', 'ho_va_ten', 'phong_ban', 'vi_tri',
        'hinh_thuc_lam_viec', 'year', 'month',
        'cong_thu_viec', 'cong_chinh_thuc', 'tong_cong',
        'tang_ca', 'truc_toi', 'tong_phat', 'finalized_at',
    )

    list_filter = ('year', 'month', 'hinh_thuc_lam_viec', 'on_off', 'trang_thai_lam_viec')
    search_fields = ('employee_code', 'ho_va_ten', 'phong_ban', 'vi_tri', 'employee__employee_id')
    ordering = ('-year', '-month', 'employee_code')
    raw_id_fields = ('employee',)
    readonly_fields = ('finalized_at', 'created_at')

    fieldsets = (
        ('Thông tin kỳ công', {
            'fields': ('employee', 'year', 'month'),
        }),
        ('Thông tin nhân viên (snapshot)', {
            'fields': (
                'employee_code', 'ho_va_ten', 'phong_ban', 'vi_tri', 'bac_si',
                'hinh_thuc_lam_viec', 'on_off', 'trang_thai_lam_viec',
                'ngay_bat_dau_lam_viec', 'ngay_ket_thuc_thu_viec',
                'ngay_len_chinh_thuc', 'ngay_nghi_viec',
            ),
        }),
        ('Kết quả chấm công', {
            'fields': (
                'cong_thu_viec', 'cong_chinh_thuc', 'co_le',
                'cong_thuc_te', 'tong_cong', 'tong_phat',
                'tang_ca', 'lam_toi', 'truc_toi', 'lam_them_gio',
                'live', 'phu_cap_gui_xe', 'nghi_phep_thang',
            ),
        }),
        ('Dữ liệu hệ thống', {
            'fields': ('raw_state', 'finalized_at', 'created_at'),
            'classes': ('collapse',),
        }),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('employee')

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path(
                'upload-csv/',
                self.admin_site.admin_view(self.upload_csv_view),
                name='hrm_workfinalization_upload_csv',
            ),
        ]
        return custom_urls + urls

    def changelist_view(self, request, extra_context=None):
        extra_context = extra_context or {}
        extra_context['upload_csv_url'] = reverse('admin:hrm_workfinalization_upload_csv')
        return super().changelist_view(request, extra_context=extra_context)

    def upload_csv_view(self, request):
        form = WorkFinalizationCSVUploadForm(request.POST or None, request.FILES or None)
        updated_rows = []
        error_rows = []

        if request.method == 'POST' and form.is_valid():
            upload_file = form.cleaned_data['file']
            try:
                raw_bytes = upload_file.read()
                text = raw_bytes.decode('utf-8-sig', errors='ignore')
                sample = text[:2000]
                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters='\t,;')
                    delimiter = dialect.delimiter
                except csv.Error:
                    delimiter = '\t' if '\t' in sample else ','

                reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
                if not reader.fieldnames:
                    raise ValueError('Không đọc được header của file CSV.')

                for line_number, row in enumerate(reader, start=2):
                    try:
                        code_raw = _wf_get_cell(row, 'ma_nhan_vien', 'an_vien', 'ma_nv', 'employee_code')
                        employee_code = _wf_normalize_employee_code(code_raw)
                        if not employee_code:
                            raise ValueError('Thiếu mã nhân viên (ma_nhan_vien/an_vien).')

                        year = _wf_parse_int(_wf_get_cell(row, 'nam', 'year'), 'năm')
                        month = _wf_parse_int(_wf_get_cell(row, 'thang', 'month'), 'tháng')
                        if month < 1 or month > 12:
                            raise ValueError(f'Tháng không hợp lệ: {month}')

                        ho_va_ten = _wf_clean_text(_wf_get_cell(row, 'ho_va_ten'))
                        ngay_ket_thuc_thu_viec = _wf_parse_date(_wf_get_cell(row, 'ngay_ket_thuc_thu_viec'))
                        cong_thu_viec = _wf_parse_decimal(_wf_get_cell(row, 'cong_thu_viec'), default=Decimal('0'))
                        cong_chinh_thuc = _wf_parse_decimal(_wf_get_cell(row, 'cong_chinh_thuc'), default=Decimal('0'))

                        base_qs = WorkFinalization.objects.select_related('employee').filter(
                            year=year,
                            month=month,
                        )
                        record = base_qs.filter(
                            employee_code__iexact=employee_code,
                        ).first()
                        if not record:
                            record = base_qs.filter(employee__employee_id__iexact=employee_code).first()
                        if not record:
                            for candidate in base_qs:
                                candidate_code = _wf_normalize_employee_code(candidate.employee_code)
                                employee_id_code = _wf_normalize_employee_code(
                                    candidate.employee.employee_id if candidate.employee else ''
                                )
                                if employee_code in {candidate_code, employee_id_code}:
                                    record = candidate
                                    break

                        if not record:
                            raise ValueError('Không tìm thấy bản ghi chốt công theo employee_code + year + month.')

                        record.employee_code = employee_code
                        if ho_va_ten:
                            record.ho_va_ten = ho_va_ten
                        record.ngay_ket_thuc_thu_viec = ngay_ket_thuc_thu_viec
                        record.cong_thu_viec = cong_thu_viec
                        record.cong_chinh_thuc = cong_chinh_thuc
                        # Số trong file (xuất từ trang Chốt công) đã gồm công lễ ->
                        # gắn cờ để bảng lương không cộng công lễ thêm lần nữa.
                        record.raw_state = {**(record.raw_state or {}), 'cong_includes_holiday': True}
                        record.save(update_fields=[
                            'employee_code',
                            'ho_va_ten',
                            'ngay_ket_thuc_thu_viec',
                            'cong_thu_viec',
                            'cong_chinh_thuc',
                            'raw_state',
                            'finalized_at',
                        ])

                        updated_rows.append({
                            'line': line_number,
                            'employee_code': record.employee_code,
                            'ho_va_ten': record.ho_va_ten,
                            'year': record.year,
                            'month': record.month,
                        })
                    except Exception as exc:
                        error_rows.append({
                            'line': line_number,
                            'employee_code': _wf_normalize_employee_code(_wf_get_cell(row, 'ma_nhan_vien', 'an_vien', 'ma_nv', 'employee_code')),
                            'error': str(exc),
                        })

                self.message_user(
                    request,
                    f'Upload hoàn tất. Đã cập nhật: {len(updated_rows)} dòng, lỗi: {len(error_rows)} dòng.',
                    level=messages.SUCCESS if not error_rows else messages.WARNING,
                )
            except Exception as exc:
                self.message_user(request, f'Lỗi xử lý file: {exc}', level=messages.ERROR)

        context = {
            **self.admin_site.each_context(request),
            'opts': self.model._meta,
            'title': 'Upload CSV cập nhật chốt công',
            'form': form,
            'updated_rows': updated_rows,
            'error_rows': error_rows,
        }
        return render(request, 'admin/hrm/workfinalization/upload_csv.html', context)


@admin.register(WorkFinalizationEmployeeDecision)
class WorkFinalizationEmployeeDecisionAdmin(admin.ModelAdmin):
    list_display = ('approval', 'employee', 'decision', 'decided_by', 'decided_at')
    list_filter = ('decision', 'approval__year', 'approval__month', 'approval__department_code')
    search_fields = ('approval__department_code', 'employee__employee_id', 'employee__full_name')


@admin.register(WorkFinalizationAccountingExport)
class WorkFinalizationAccountingExportAdmin(admin.ModelAdmin):
    list_display = ('approval', 'employee_code', 'employee_name', 'decision', 'year', 'month', 'department_code', 'exported_at')
    list_filter = ('decision', 'year', 'month', 'department_code')
    search_fields = ('employee_code', 'employee_name', 'department_code', 'department_name')
    ordering = ('-year', '-month', 'department_code', 'employee_code')
    readonly_fields = ('exported_at',)
    raw_id_fields = ('approval', 'employee', 'decided_by', 'exported_by')

    fieldsets = (
        ('Thông tin xuất kế toán', {
            'fields': ('approval', 'employee', 'exported_by', 'exported_at'),
        }),
        ('Thông tin tổng hợp', {
            'fields': (
                'year', 'month', 'department_code', 'department_name',
                'employee_code', 'employee_name', 'decision', 'decision_label',
                'decision_note', 'decided_by', 'decided_at',
            ),
        }),
        ('Snapshot dữ liệu', {
            'fields': ('data_snapshot',),
            'classes': ('collapse',),
        }),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).select_related('approval', 'employee', 'decided_by', 'exported_by')


# ======================
# Finalization Lock Admin
# ======================

class FinalizationLockLogInline(admin.TabularInline):
    model = FinalizationLockLog
    extra = 0
    readonly_fields = ('action', 'performed_by', 'performed_by_role', 'note', 'created_at')
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(FinalizationLock)
class FinalizationLockAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'year', 'month', 'is_locked', 'lock_start_at', 'locked_by', 'locked_at', 'updated_at')
    list_filter = ('is_locked', 'year')
    search_fields = ('year', 'month', 'note')
    ordering = ('-year', '-month')
    inlines = [FinalizationLockLogInline]

    fieldsets = (
        ('Thời gian', {
            'fields': ('year', 'month'),
        }),
        ('Trạng thái', {
            'fields': ('is_locked', 'lock_start_at', 'note'),
        }),
        ('Người thao tác', {
            'fields': ('locked_by', 'locked_at', 'unlocked_by', 'unlocked_at'),
            'classes': ('collapse',),
        }),
    )

    readonly_fields = ('locked_at', 'unlocked_at')


@admin.register(FinalizationLockLog)
class FinalizationLockLogAdmin(admin.ModelAdmin):
    list_display = ('lock', 'action', 'performed_by', 'performed_by_role', 'created_at')
    list_filter = ('action', 'performed_by_role')
    search_fields = ('note', 'performed_by__username')
    ordering = ('-created_at',)
    readonly_fields = ('lock', 'action', 'performed_by', 'performed_by_role', 'note', 'created_at')

    def has_add_permission(self, request):
        return False


@admin.register(FinalizationLockEmployeeOverride)
class FinalizationLockEmployeeOverrideAdmin(admin.ModelAdmin):
    list_display = ('__str__', 'employee', 'year', 'month', 'period', 'is_unlocked', 'created_by', 'updated_at')
    list_filter = ('is_unlocked', 'period', 'year')
    search_fields = ('employee__employee_id', 'employee__full_name', 'note')
    ordering = ('-updated_at',)
    raw_id_fields = ('employee',)
    readonly_fields = ('created_at', 'updated_at')

    def has_change_permission(self, request, obj=None):
        return False


# ======================
# GenericRequest Admin (Đơn từ tổng hợp)
# ======================

@admin.register(GenericRequest)
class GenericRequestAdmin(admin.ModelAdmin):
    list_display = (
        'request_code', 'request_type', 'title', 'employee', 'status',
        'is_deleted_badge', 'submitted_at', 'approved_at', 'created_at',
    )
    list_filter = (
        'is_deleted', 'status', 'request_type',
        'manager_approved_at', 'admin_approved_at', 'rejected_at',
    )
    search_fields = (
        'request_code', 'title', 'reason',
        'employee__full_name', 'employee__employee_id',
    )
    ordering = ('-created_at',)
    date_hierarchy = 'created_at'
    raw_id_fields = (
        'employee', 'manager_approved_by', 'admin_approved_by', 'deleted_by',
    )
    readonly_fields = (
        'request_code', 'created_at', 'updated_at',
        'submitted_at', 'manager_approved_at', 'admin_approved_at',
        'approved_at', 'rejected_at', 'deleted_at',
    )

    fieldsets = (
        ('Thông tin đơn', {
            'fields': (
                'request_code', 'request_type', 'title', 'reason',
                'expected_date', 'extra_data', 'attachment',
            )
        }),
        ('Người tạo & trạng thái', {
            'fields': ('employee', 'status', 'workflow', 'current_approval_level'),
        }),
        ('Workflow phê duyệt', {
            'fields': (
                'submitted_at',
                'manager_approved_at', 'manager_approved_by',
                'admin_approved_at', 'admin_approved_by',
                'approved_at',
                'rejected_at', 'rejected_level', 'approval_note',
            ),
            'classes': ('collapse',),
        }),
        ('Soft delete (audit)', {
            'fields': ('is_deleted', 'deleted_at', 'deleted_by'),
            'classes': ('collapse',),
            'description': 'Đơn bị Admin xoá ở UI (soft delete). Có thể restore bằng cách bỏ tick is_deleted.',
        }),
        ('Hệ thống', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )

    def get_queryset(self, request):
        # Admin Django thấy TẤT CẢ (kể cả đã soft delete), khác với REST API
        return super().get_queryset(request).select_related(
            'employee', 'manager_approved_by', 'admin_approved_by', 'deleted_by'
        )

    def is_deleted_badge(self, obj):
        if obj.is_deleted:
            return format_html(
                '<span style="color:#fff;background:#dc2626;padding:2px 8px;border-radius:4px;font-size:11px;">Đã xoá</span>'
            )
        return format_html(
            '<span style="color:#16a34a;">●</span>'
        )
    is_deleted_badge.short_description = 'Trạng thái xoá'

    actions = ['restore_selected', 'soft_delete_selected']

    def restore_selected(self, request, queryset):
        """Khôi phục các đơn đã soft delete"""
        updated = queryset.filter(is_deleted=True).update(
            is_deleted=False, deleted_at=None, deleted_by=None
        )
        self.message_user(request, f'Đã khôi phục {updated} đơn.')
    restore_selected.short_description = 'Khôi phục đơn đã xoá'

    def soft_delete_selected(self, request, queryset):
        """Soft delete các đơn được chọn"""
        from django.utils import timezone
        updated = queryset.filter(is_deleted=False).update(
            is_deleted=True, deleted_at=timezone.now(), deleted_by=request.user
        )
        self.message_user(request, f'Đã xoá {updated} đơn (soft delete).')
    soft_delete_selected.short_description = 'Soft delete đơn được chọn'


# ======================
# RequestTemplate Admin (Template DOCX cho đơn từ)
# ======================

@admin.register(RequestTemplate)
class RequestTemplateAdmin(admin.ModelAdmin):
    list_display = (
        'name', 'request_type', 'company_unit', 'is_active',
        'created_by', 'created_at', 'updated_at',
    )
    list_filter = ('is_active', 'request_type', 'company_unit')
    search_fields = ('name', 'description')
    ordering = ('request_type', 'company_unit__name')
    raw_id_fields = ('company_unit', 'created_by')
    readonly_fields = ('created_at', 'updated_at', 'created_by')

    fieldsets = (
        ('Thông tin template', {
            'fields': ('name', 'request_type', 'company_unit', 'file', 'description', 'is_active'),
        }),
        ('Hệ thống', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )

    def save_model(self, request, obj, form, change):
        if not change and not obj.created_by:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


# ─────────────────────────────────────────────────────────────────────────────
# AttendanceRanking Admin (Bảng xếp hạng chấm công)
# ─────────────────────────────────────────────────────────────────────────────

@admin.register(AttendanceRanking)
class AttendanceRankingAdmin(admin.ModelAdmin):
    list_display = (
        "employee_info", "year", "month",
        "early_days", "total_early_minutes", "avg_early_minutes_display",
        "on_time_days", "total_working_days",
        "rank_early", "rank_on_time",
        "computed_at",
    )
    list_filter = ("year", "month")
    search_fields = ("employee__full_name", "employee__employee_code")
    ordering = ("-year", "-month", "rank_early")
    raw_id_fields = ("employee",)
    readonly_fields = (
        "early_days", "total_early_minutes", "on_time_days", "total_working_days",
        "rank_early", "rank_on_time", "computed_at", "created_at",
    )

    fieldsets = (
        ("Nhân viên & Kỳ", {
            "fields": ("employee", "year", "month"),
        }),
        ("Thống kê", {
            "fields": (
                "total_working_days",
                "early_days", "total_early_minutes",
                "on_time_days",
            ),
        }),
        ("Xếp hạng", {
            "fields": ("rank_early", "rank_on_time"),
        }),
        ("Hệ thống", {
            "fields": ("computed_at", "created_at"),
            "classes": ("collapse",),
        }),
    )

    def employee_info(self, obj):
        emp = obj.employee
        dept = emp.department.name if emp.department else "—"
        return format_html(
            "{} ({}) – {}",
            emp.full_name,
            emp.employee_code,
            dept,
        )
    employee_info.short_description = "Nhân viên"

    def avg_early_minutes_display(self, obj):
        return f"{obj.avg_early_minutes} p"
    avg_early_minutes_display.short_description = "Phút sớm TB"


@admin.register(MeetingRoom)
class MeetingRoomAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'location', 'capacity', 'is_active', 'created_by', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('name', 'code', 'location')
    ordering = ('name',)
    readonly_fields = ('created_at', 'updated_at')


@admin.register(AttendanceAppDownloadConfig)
class AttendanceAppDownloadConfigAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'ios_url', 'android_url', 'updated_at')
    list_filter = ('is_active',)
    search_fields = ('name', 'ios_url', 'android_url')
    readonly_fields = ('created_at', 'updated_at')

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        if obj.is_active:
            AttendanceAppDownloadConfig.objects.exclude(pk=obj.pk).update(is_active=False)


@admin.register(MeetingRoomSetting)
class MeetingRoomSettingAdmin(admin.ModelAdmin):
    list_display = ('min_booking_minutes', 'workday_start_hour', 'workday_end_hour', 'updated_by', 'updated_at')
    readonly_fields = ('updated_at',)


@admin.register(SalaryAdvanceApprovalLock)
class SalaryAdvanceApprovalLockAdmin(admin.ModelAdmin):
    list_display = ('is_locked', 'updated_by', 'updated_at')
    readonly_fields = ('updated_at',)


@admin.register(SalaryAdvanceCreationLock)
class SalaryAdvanceCreationLockAdmin(admin.ModelAdmin):
    list_display = ('is_locked', 'updated_by', 'updated_at')
    readonly_fields = ('updated_at',)


@admin.register(MeetingRoomBooking)
class MeetingRoomBookingAdmin(admin.ModelAdmin):
    list_display = (
        'room',
        'booking_source',
        'booked_by',
        'contact_name',
        'contact_phone',
        'start_time',
        'end_time',
        'created_at',
    )
    list_filter = ('booking_source', 'room')
    search_fields = ('room__name', 'contact_name', 'contact_phone', 'ai_agent_name', 'booked_by__full_name')
    raw_id_fields = ('room', 'booked_by', 'booked_by_user')
    ordering = ('-start_time',)


@admin.register(MeetingRoomBookingLog)
class MeetingRoomBookingLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'room', 'performed_by', 'performed_by_role', 'created_at')
    list_filter = ('action', 'performed_by_role', 'room')
    search_fields = ('room__name', 'contact_name', 'contact_phone', 'ai_agent_name', 'performed_by__username')
    raw_id_fields = ('booking', 'room', 'performed_by')


# ══════════════════════════════════════════════════════════════════
# SHIFT REGISTRATION MODELS ADMIN  (hrm/shift_registration_models.py)
# Cấu hình phạm vi (phòng ban/vị trí) + 2 ca cho tính năng "Đăng ký ca làm".
# ══════════════════════════════════════════════════════════════════

from .shift_registration_models import (
    ShiftRegistrationScopeConfig,
    ShiftRegistration,
    ShiftRegistrationDay,
)


@admin.register(ShiftRegistrationScopeConfig)
class ShiftRegistrationScopeConfigAdmin(admin.ModelAdmin):
    """Cấu hình phòng ban/vị trí/bác sĩ phụ trách nào được dùng tính năng
    Đăng ký ca làm, và 2 ca (mỗi ca = 1 cặp Ca sáng + Ca chiều) nào được
    chọn — sửa trực tiếp ở đây, không cần deploy code.

    CÓ THỂ TẠO NHIỀU BẢN GHI song song — mỗi nhóm phòng ban/vị trí/bác sĩ
    phụ trách có thể cần cặp Ca 1/Ca 2 giờ khác nhau (không còn là singleton
    như thiết kế ban đầu). Chỉ cần đảm bảo phạm vi (departments/positions/
    doctor_teams) giữa các bản ghi KHÔNG chồng lấn nhau — nếu 1 nhân viên vô
    tình khớp nhiều bản ghi cùng lúc, hệ thống sẽ dùng bản ghi có ID nhỏ
    nhất và ghi log cảnh báo (xem ShiftRegistrationScopeConfig.for_employee)."""
    list_display = (
        'id', '__str__', 'is_active',
        'shift_1_morning', 'shift_1_afternoon',
        'shift_2_morning', 'shift_2_afternoon',
        'default_ca_label', 'registrable_ca_label', 'registration_enabled',
        'updated_by', 'updated_at',
    )
    filter_horizontal = ('departments', 'positions')
    fieldsets = (
        ('Phạm vi áp dụng', {
            'fields': ('departments', 'positions', 'doctor_teams', 'is_active'),
            'description': (
                "Nhân viên phải thoả ĐỦ phòng ban VÀ vị trí (2 điều kiện này LUÔN "
                "bắt buộc) thì mới thuộc phạm vi áp dụng của CẤU HÌNH NÀY. Nếu "
                "phòng ban/vị trí này CÓ liên quan bác sĩ, điền thêm \"Bác sĩ phụ "
                "trách áp dụng\" để bắt buộc khớp thêm điều kiện đó; nếu KHÔNG "
                "liên quan bác sĩ (VD: IT, AI...), cứ ĐỂ TRỐNG ô đó — không cần "
                "khớp bác sĩ phụ trách. Có thể tạo nhiều cấu hình khác nhau cho "
                "các nhóm khác nhau — chỉ cần đảm bảo phạm vi giữa các cấu hình "
                "không chồng lấn."
            ),
        }),
        ('Ô Ca 1 — ca MẶC ĐỊNH (Ca sáng + Ca chiều)', {'fields': ('shift_1_morning', 'shift_1_afternoon')}),
        ('Ô Ca 2 — ca PHẢI ĐĂNG KÝ (Ca sáng + Ca chiều)', {'fields': ('shift_2_morning', 'shift_2_afternoon', 'registration_enabled')}),
        ('Tên gọi hiển thị', {
            'fields': ('default_ca_label', 'registrable_ca_label'),
            'description': (
                "Tên team này dùng để gọi 2 ca — chỉ đổi NHÃN trên giao diện, không đổi "
                "cơ chế. VD Sale BS Minh Trung: mặc định gọi là \"Ca 2\", đăng ký gọi là \"Ca 1\"."
            ),
        }),
        ('Thông tin hệ thống', {'fields': ('updated_by', 'updated_at'), 'classes': ('collapse',)}),
    )
    readonly_fields = ('updated_at',)

    def save_model(self, request, obj, form, change):
        from employee.models import Employee as Emp
        try:
            obj.updated_by = Emp.objects.filter(user=request.user).first()
        except Exception:
            pass
        super().save_model(request, obj, form, change)


class ShiftRegistrationDayInline(admin.TabularInline):
    model = ShiftRegistrationDay
    extra = 0
    fields = ('date', 'ca_choice', 'morning_shift', 'afternoon_shift')


@admin.register(ShiftRegistration)
class ShiftRegistrationAdmin(admin.ModelAdmin):
    list_display = ('employee', 'week_start_date', 'week_end_date', 'created_at', 'updated_at')
    list_filter = ('week_start_date',)
    search_fields = ('employee__employee_id', 'employee__full_name')
    raw_id_fields = ('employee',)
    inlines = [ShiftRegistrationDayInline]
    ordering = ('-created_at',)


# ══════════════════════════════════════════════════════════════════
# DEADLINE EXCEPTION GRANT ADMIN  (hrm/deadline_exception_models.py)
# "Mở khoá đặc biệt" — HCNS cấp phép ngoại lệ cho 1 NV/1 ngày/1 loại đơn
# được tạo/duyệt dù đã quá hạn khoá thông thường (quy định thời hạn tạo/duyệt đơn).
# ══════════════════════════════════════════════════════════════════

from .deadline_exception_models import DeadlineExceptionGrant


@admin.register(DeadlineExceptionGrant)
class DeadlineExceptionGrantAdmin(admin.ModelAdmin):
    """Tạo 1 bản ghi ở đây = mở khoá ngay cho đúng nhân viên/ngày/loại đơn đó
    được tạo/duyệt dù đã quá hạn — dùng cho trường hợp phát sinh đột xuất
    (vd ca mổ gấp) theo đúng quy định thời hạn tạo/duyệt đơn (mục phát sinh đột xuất). Nhân viên/
    TBP-TP vẫn tự tạo/duyệt bình thường, HCNS chỉ mở khoá trước."""
    list_display = ('employee', 'event_date', 'request_type', 'note', 'granted_by', 'created_at', 'revoked_at')
    list_filter = ('request_type', 'event_date', ('revoked_at', admin.EmptyFieldListFilter))
    search_fields = ('employee__employee_id', 'employee__full_name', 'note')
    raw_id_fields = ('employee', 'granted_by', 'revoked_by')
    ordering = ('-created_at',)

    def save_model(self, request, obj, form, change):
        if not obj.granted_by_id:
            from employee.models import Employee as Emp
            obj.granted_by = Emp.objects.filter(user=request.user).first()
        super().save_model(request, obj, form, change)


# ══════════════════════════════════════════════════════════════════
# FEEDBACK ADMIN  (hrm/feedback_models.py) — "Hòm thư góp ý"
# ══════════════════════════════════════════════════════════════════

from .feedback_models import Feedback, FeedbackAttachment


class FeedbackAttachmentInline(admin.TabularInline):
    model = FeedbackAttachment
    extra = 0


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    inlines = [FeedbackAttachmentInline]
    list_display = ('id', 'employee', 'is_anonymous', 'topic', 'status', 'created_at')
    list_filter = ('topic', 'status', 'is_anonymous')
    search_fields = ('employee__employee_id', 'employee__full_name', 'difficulties', 'support_needed',
                     'career_sharing', 'work_proposal', 'other_sharing')
    raw_id_fields = ('employee', 'handled_by')
    readonly_fields = ('received_at', 'resolved_at', 'resolved_seen_at')
    ordering = ('-created_at',)

    def save_model(self, request, obj, form, change):
        # Đổi trạng thái trong Django Admin cũng phải cập nhật mốc thông báo cho người gửi.
        if change and 'status' in form.changed_data:
            new_status = obj.status
            obj.status = form.initial.get('status')
            obj.change_status(new_status)
        super().save_model(request, obj, form, change)


# ══════════════════════════════════════════════════════════════════
# Phiếu thanh toán / đề xuất mua hàng / đề nghị tạm ứng
# ══════════════════════════════════════════════════════════════════
from .payment_document_models import PaymentDocument, PaymentDocumentAttachment  # noqa: E402


class PaymentDocumentAttachmentInline(admin.TabularInline):
    model = PaymentDocumentAttachment
    extra = 0
    fields = ('file_name', 'file', 'uploaded_by', 'uploaded_at')
    readonly_fields = ('uploaded_by', 'uploaded_at')


@admin.register(PaymentDocument)
class PaymentDocumentAdmin(admin.ModelAdmin):
    list_display = ('code', 'doc_type', 'doc_date', 'employee', 'title', 'amount', 'status', 'reviewed_at', 'is_deleted')
    list_filter = ('doc_type', 'status', 'is_deleted')
    search_fields = ('code', 'title', 'payee', 'requester_name', 'employee__full_name', 'employee__employee_id')
    raw_id_fields = ('employee', 'department', 'reviewed_by', 'created_by', 'updated_by', 'deleted_by')
    date_hierarchy = 'doc_date'
    inlines = [PaymentDocumentAttachmentInline]

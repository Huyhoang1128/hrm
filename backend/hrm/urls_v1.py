"""
hrm/urls_v1.py
══════════════
URL patterns cho HRM Attendance Engine v1.

Mount vào config/urls.py:
    path("api/v1/hrm/", include("hrm.urls_v1")),

Hoặc mount vào hrm/urls.py:
    path("v1/", include("hrm.urls_v1")),
"""

from django.urls import path
from .edit_attendance_views import EditAttendanceView
from .device_attendance_views import DeviceAttendancePushView
from .mobile_checkin_views import MobileCheckinView, AttendanceTodayView
from .employee_search_views import EmployeeSearchView
from .ranking_views import (
    ComputeRankingView,
    RankingListView,
    RankingEmployeeView,
)
from .attendance_views import (
    # Policy versions
    AttendancePolicyVersionListView,
    AttendancePolicyVersionDetailView,
    ActivatePolicyVersionView,

    # Penalty tiers
    PenaltyTierListView,
    PenaltyTierDetailView,

    # Policy config
    AttendancePolicyConfigView,

    # Registration requests (OT / LIVE / NIGHT_SHIFT / EXTRA_HOURS / BUSINESS_TRIP)
    RegistrationRequestListView,
    RegistrationRequestDetailView,
    ApproveRegistrationRequestView,
    RejectRegistrationRequestView,

    # Online work requests
    OnlineWorkRequestListView,
    OnlineWorkRequestDetailView,
    ApproveOnlineWorkRequestView,
    RejectOnlineWorkRequestView,

    # Monthly summary & finalize
    MonthlySummaryView,
    FinalizeWorkCreditView,
    FinalizeDepartmentView,

    # Utilities
    PenaltyPreviewView,
    LiveSessionCheckView,
    ActivePolicyView,

    # Event store
    AttendanceEventLogListView,
    EventReplayView,

    # Livestream config
    LivestreamSessionConfigListView,
    LivestreamSessionConfigDetailView,
    
    # Livestream allowance config
    LivestreamAllowanceConfigListView,
    LivestreamAllowanceConfigDetailView,

    # Shift assignment
    ShiftAssignmentView,
    ShiftConfigForDepartmentView,
    ShiftConfigForEmployeeView,

    # Calendar view (màn hình Quản lý chấm công)
    AttendanceCalendarView,
)

app_name = "hrm_v1"

urlpatterns = [

    # ─── Policy Versions ──────────────────────────────────────────────────────
    # GET   /attendance/policy-versions/          → list all versions
    # POST  /attendance/policy-versions/          → create new version
    path(
        "attendance/policy-versions/",
        AttendancePolicyVersionListView.as_view(),
        name="policy-version-list",
    ),
    # GET   /attendance/policy-versions/<pk>/     → version detail + tiers + config
    # PATCH /attendance/policy-versions/<pk>/     → update name/dates
    # DELETE/attendance/policy-versions/<pk>/     → delete (not active)
    path(
        "attendance/policy-versions/<int:pk>/",
        AttendancePolicyVersionDetailView.as_view(),
        name="policy-version-detail",
    ),
    # POST  /attendance/policy-versions/<pk>/activate/
    path(
        "attendance/policy-versions/<int:pk>/activate/",
        ActivatePolicyVersionView.as_view(),
        name="policy-version-activate",
    ),

    # ─── Penalty Tiers ────────────────────────────────────────────────────────
    # GET  /attendance/penalty-tiers/?version_id=<id>
    # POST /attendance/penalty-tiers/
    path(
        "attendance/penalty-tiers/",
        PenaltyTierListView.as_view(),
        name="penalty-tier-list",
    ),
    # PATCH  /attendance/penalty-tiers/<pk>/
    # DELETE /attendance/penalty-tiers/<pk>/
    path(
        "attendance/penalty-tiers/<int:pk>/",
        PenaltyTierDetailView.as_view(),
        name="penalty-tier-detail",
    ),

    # ─── Policy Config ────────────────────────────────────────────────────────
    # GET /attendance/policy-config/<version_id>/
    # PUT /attendance/policy-config/<version_id>/
    path(
        "attendance/policy-config/<int:version_id>/",
        AttendancePolicyConfigView.as_view(),
        name="policy-config",
    ),

    # ─── Active Policy (quick read) ───────────────────────────────────────────
    # GET /attendance/active-policy/?date=YYYY-MM-DD
    path(
        "attendance/active-policy/",
        ActivePolicyView.as_view(),
        name="active-policy",
    ),

    # ─── Registration Requests ────────────────────────────────────────────────
    # GET  /attendance/registration-requests/     → list (filter by employee/dept/type/status/year/month)
    # POST /attendance/registration-requests/     → create
    path(
        "attendance/registration-requests/",
        RegistrationRequestListView.as_view(),
        name="registration-request-list",
    ),
    # GET    /attendance/registration-requests/<pk>/
    # PATCH  /attendance/registration-requests/<pk>/
    # DELETE /attendance/registration-requests/<pk>/  (cancel)
    path(
        "attendance/registration-requests/<int:pk>/",
        RegistrationRequestDetailView.as_view(),
        name="registration-request-detail",
    ),
    # POST /attendance/registration-requests/<pk>/approve/
    path(
        "attendance/registration-requests/<int:pk>/approve/",
        ApproveRegistrationRequestView.as_view(),
        name="registration-request-approve",
    ),
    # POST /attendance/registration-requests/<pk>/reject/
    path(
        "attendance/registration-requests/<int:pk>/reject/",
        RejectRegistrationRequestView.as_view(),
        name="registration-request-reject",
    ),

    # ─── Online Work Requests ─────────────────────────────────────────────────
    # GET  /attendance/online-work-requests/
    # POST /attendance/online-work-requests/
    path(
        "attendance/online-work-requests/",
        OnlineWorkRequestListView.as_view(),
        name="online-work-request-list",
    ),
    # GET    /attendance/online-work-requests/<pk>/
    # DELETE /attendance/online-work-requests/<pk>/  (cancel)
    path(
        "attendance/online-work-requests/<int:pk>/",
        OnlineWorkRequestDetailView.as_view(),
        name="online-work-request-detail",
    ),
    # POST /attendance/online-work-requests/<pk>/approve/
    path(
        "attendance/online-work-requests/<int:pk>/approve/",
        ApproveOnlineWorkRequestView.as_view(),
        name="online-work-request-approve",
    ),
    # POST /attendance/online-work-requests/<pk>/reject/
    path(
        "attendance/online-work-requests/<int:pk>/reject/",
        RejectOnlineWorkRequestView.as_view(),
        name="online-work-request-reject",
    ),

    # ─── Monthly Summary (preview – không lưu) ────────────────────────────────
    # GET /attendance/monthly-summary/<employee_id>/<year>/<month>/
    path(
        "attendance/monthly-summary/<int:employee_id>/<int:year>/<int:month>/",
        MonthlySummaryView.as_view(),
        name="monthly-summary",
    ),

    # ─── Finalize (chốt công – lưu MonthlyWorkCredit) ────────────────────────
    # POST /attendance/finalize/<employee_id>/<year>/<month>/
    path(
        "attendance/finalize/<int:employee_id>/<int:year>/<int:month>/",
        FinalizeWorkCreditView.as_view(),
        name="finalize-work-credit",
    ),

    # ─── Department Batch Finalize ────────────────────────────────────────────
    # POST /attendance/finalize-department/<department_id>/<year>/<month>/
    path(
        "attendance/finalize-department/<int:department_id>/<int:year>/<int:month>/",
        FinalizeDepartmentView.as_view(),
        name="finalize-department",
    ),

    # ─── Penalty Preview ──────────────────────────────────────────────────────
    # POST /attendance/penalty-preview/
    # Body: {late_minutes, early_minutes, violation_count_month, is_manager, date}
    path(
        "attendance/penalty-preview/",
        PenaltyPreviewView.as_view(),
        name="penalty-preview",
    ),

    # ─── Live Session Eligibility Check ──────────────────────────────────────
    # POST /attendance/live-check/
    # Body: {start_time, session_hours, current_prime_sessions, total_team_live, date}
    path(
        "attendance/live-check/",
        LiveSessionCheckView.as_view(),
        name="live-session-check",
    ),

    # ─── Event Log ────────────────────────────────────────────────────────────
    # GET /attendance/event-log/?employee_id=&event_type=&year=&month=&page=
    path(
        "attendance/event-log/",
        AttendanceEventLogListView.as_view(),
        name="event-log",
    ),

    # ─── Event Replay ─────────────────────────────────────────────────────────
    # POST /attendance/event-replay/<employee_id>/
    # Body: {start_date, end_date}
    path(
        "attendance/event-replay/<int:employee_id>/",
        EventReplayView.as_view(),
        name="event-replay",
    ),

    # ─── Livestream Session Config ────────────────────────────────────────────
    # GET  /attendance/livestream-config/?department_id=&year=&month=
    # POST /attendance/livestream-config/
    path(
        "attendance/livestream-config/",
        LivestreamSessionConfigListView.as_view(),
        name="livestream-config-list",
    ),
    # PATCH /attendance/livestream-config/<pk>/
    path(
        "attendance/livestream-config/<int:pk>/",
        LivestreamSessionConfigDetailView.as_view(),
        name="livestream-config-detail",
    ),

    # ─── Livestream Allowance Config ──────────────────────────────────────────
    # GET  /attendance/livestream-allowance-config/
    # POST /attendance/livestream-allowance-config/
    path(
        "attendance/livestream-allowance-config/",
        LivestreamAllowanceConfigListView.as_view(),
        name="livestream-allowance-config-list",
    ),
    # GET    /attendance/livestream-allowance-config/<id>/
    # PUT    /attendance/livestream-allowance-config/<id>/
    # PATCH  /attendance/livestream-allowance-config/<id>/
    # DELETE /attendance/livestream-allowance-config/<id>/
    path(
        "attendance/livestream-allowance-config/<int:pk>/",
        LivestreamAllowanceConfigDetailView.as_view(),
        name="livestream-allowance-config-detail",
    ),

    # ─── Shift Assignment ─────────────────────────────────────────────────────
    # GET    /attendance/shift-assignment/?employee_id= or ?department_id=
    # POST   /attendance/shift-assignment/   → assign shift
    # DELETE /attendance/shift-assignment/   → remove shift
    path(
        "attendance/shift-assignment/",
        ShiftAssignmentView.as_view(),
        name="shift-assignment",
    ),

    # ─── Shift queries ────────────────────────────────────────────────────────
    # GET /attendance/shifts/department/<dept_id>/
    path(
        "attendance/shifts/department/<int:dept_id>/",
        ShiftConfigForDepartmentView.as_view(),
        name="shifts-for-department",
    ),
    # GET /attendance/shifts/employee/<emp_id>/
    path(
        "attendance/shifts/employee/<int:emp_id>/",
        ShiftConfigForEmployeeView.as_view(),
        name="shifts-for-employee",
    ),

    # ─── Edit Attendance (sửa check_in / check_out) ──────────────────────────
    # POST /attendance/edit-attendance/
    # Body: {employee_id, date, check_in?, check_out?}
    # Yêu cầu: superuser hoặc can_edit_attendance
    path(
        "attendance/edit-attendance/",
        EditAttendanceView.as_view(),
        name="edit-attendance",
    ),

    # ─── Calendar View (màn hình Quản lý chấm công) ───────────────────────────
    # GET /attendance/calendar-view/?year=2026&month=2[&employee_id=1]
    #
    # Response:
    #   summary  → Tổng ngày công, Ngày đủ công, Nửa ngày công,
    #              Đi muộn/sớm, Vắng mặt, Quên chấm công,
    #              Tăng ca (giờ), Làm thêm giờ, Trực tối (ca), Live (ca), Nghỉ phép
    #   calendar → mảng ngày trong tháng, mỗi ngày có:
    #              date, day, weekday, is_weekend, is_holiday, is_leave,
    #              day_status (FULL/HALF/ABSENT/LATE_EARLY/FORGOT_CC/LEAVE/HOLIDAY/EMPTY),
    #              status_badge, shifts[{shift_label, time, status_color}],
    #              registrations (OT/EXTRA_HOURS/NIGHT_SHIFT/LIVE đã duyệt)
    path(
        "attendance/calendar-view/",
        AttendanceCalendarView.as_view(),
        name="attendance-calendar-view",
    ),

    # ─── Attendance Ranking (Bảng xếp hạng đi sớm / đúng giờ) ───────────────
    # POST /attendance/ranking/compute/   → Tính & lưu xếp hạng (HR/superuser)
    path(
        "attendance/ranking/compute/",
        ComputeRankingView.as_view(),
        name="ranking-compute",
    ),
    # GET  /attendance/ranking/?year=&month=[&top=N][&type=early|on_time]
    path(
        "attendance/ranking/",
        RankingListView.as_view(),
        name="ranking-list",
    ),
    # GET  /attendance/ranking/<employee_id>/?year=&month=
    path(
        "attendance/ranking/<int:employee_id>/",
        RankingEmployeeView.as_view(),
        name="ranking-employee",
    ),

    # ─── Device Attendance Push (ZKTeco / IT support tool) ───────────────────
    # POST /attendance-device/push/
    # Auth: JWT token – chỉ nhân viên HR (is_hr hoặc can_manage_attendance)
    path(
        "attendance-device/push/",
        DeviceAttendancePushView.as_view(),
        name="device-attendance-push",
    ),

    # ─── Employee search (autocomplete cho sync tool mapping picker) ─────────
    # GET /employees-search/?q=...&limit=20
    path(
        "employees-search/",
        EmployeeSearchView.as_view(),
        name="employee-search",
    ),

    # ─── Mobile checkin/checkout (app chấm công → HRM) ─────────────────────
    # POST /attendance/mobile-checkin/   { employee_id, action, latitude, longitude }
    # GET  /attendance/mobile-today/?employee_id=NV001
    path(
        "attendance/mobile-checkin/",
        MobileCheckinView.as_view(),
        name="mobile-checkin",
    ),
    path(
        "attendance/mobile-today/",
        AttendanceTodayView.as_view(),
        name="mobile-today",
    ),
]

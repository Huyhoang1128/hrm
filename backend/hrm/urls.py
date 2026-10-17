from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views
from . import taodon_views
from . import workcaculate_view
from . import registration_views
from . import shift_registration_views
from . import deadline_exception_views
from . import feedback_views
from .attendance_views import AttendanceCalendarView
from .finalization_views import (
    FinalizeAttendanceView,
    FinalizeAllAttendanceView,
    FinalizeDepartmentAttendanceView,
    WorkFinalizationListView,
    WorkFinalizationDetailView,
    WorkFinalizationExportExcelView,
    WorkFinalizationDetailExportView,
    SalaryDepartmentView,
)
from .dept_approval_views import (
    SendDepartmentApprovalView,
    SendAllDepartmentsApprovalView,
    ApproveDepartmentFinalizationView,
    DepartmentFinalizationApprovalListView,
    DepartmentFinalizationApprovalDetailView,
    DecideEmployeeFinalizationView,
    DepartmentFinalizationApprovalPrintView,
    FinalizationAccountingExportGenerateView,
    FinalizationAccountingExportListView,
)
from .attendance_finalization_approval_views import (
    SendAttendanceFinalizationApprovalView,
    SendAllAttendanceFinalizationApprovalsView,
    ApproveAttendanceFinalizationView,
    AttendanceFinalizationApprovalListView,
    AttendanceFinalizationApprovalDetailView,
    DecideEmployeeAttendanceFinalizationView,
    AttendanceFinalizationApprovalPrintView,
    AttendanceFinalizationEmployeeEmailPreviewView,
    SendAttendanceFinalizationEmployeeEmailView,
    AttendanceFinalizationEmailStatusesView,
    SendAttendanceFinalizationDepartmentEmailsView,
)
from .upload_views import (
    AttendanceUploadView, 
    AttendanceImportLogViewSet,
    AttendanceUploadTemplateView,
    AttendanceUploadValidationView
)
from .views import (
    OnboardingProcessViewSet,
    OnboardingTaskViewSet,
    OnboardingChecklistViewSet,
    OnboardingDocumentViewSet,
    OnboardingDocumentTemplateViewSet,
    EmployeeOnboardingFormViewSet,
    send_account_emails, check_email_batch_status
)
from .views import ContractTemplateViewSet, EmployeeContractViewSet, GenericRequestViewSet, RequestTemplateViewSet
from .super_admin_views import SuperAdminOnboardingView, SuperAdminEmployeeView
from .duyet_don_views import DuyetDonAPIView
from .grant_timing_report_views import GrantTimingReportView
from .violation_report_views import (
    LeaveViolationReportView,
    PenaltyOverrideView,
    FinalizeMonthView,
)
from .views import ChangeAvatarView
from .dept_attendance_report_views import DeptAttendanceViolationReportView
from .finalization_lock_views import (
    FinalizationLockStatusView,
    FinalizationLockToggleView,
    FinalizationLockListView,
    FinalizationLockCheckView,
    FinalizationLockLogView,
    FinalizationLockEmployeeOverrideView,
    FinalizationLockEmployeeOverrideDetailView,
)
from employee.birthday_views import BirthdayWishListCreateView, BirthdayWishDetailView, BirthdayWishLikeView
from employee.import_views import EmployeeImportView, EmployeeSocialInsuranceImportView, DepartmentImportView, PositionImportView
from employee.dependent_views import EmployeeDependentViewSet
from .payment_document_views import PaymentDocumentViewSet
from .important_alerts_views import ImportantAlertsView
from .views import BulkSalaryConfigImportView
from .meeting_room_views import (
    MeetingRoomViewSet,
    MeetingRoomBookingViewSet,
    MeetingRoomSettingView,
)

router = DefaultRouter()
router.register(r'employees', views.EmployeeViewSet, basename='employee')
router.register(r'employee-dependents', EmployeeDependentViewSet, basename='employee-dependent')
router.register(r'payment-documents', PaymentDocumentViewSet, basename='payment-document')
router.register(r'company-units', views.CompanyUnitViewSet, basename='company-unit')
router.register(r'branch-locations', views.BranchLocationViewSet, basename='branch-location')
router.register(r'departments', views.DepartmentViewSet, basename='department')
router.register(r'sections', views.SectionViewSet, basename='section')
router.register(r'positions', views.PositionViewSet, basename='position')
router.register(r'assets', views.AssetViewSet, basename='asset')
router.register(r'asset-assignments', views.AssetAssignmentHistoryViewSet, basename='asset-assignment')
router.register(r'asset-maintenance', views.AssetMaintenanceViewSet, basename='asset-maintenance')
router.register(r'asset-inventory-checks', views.AssetInventoryCheckViewSet, basename='asset-inventory-check')
router.register(r'attendance-import-logs', AttendanceImportLogViewSet, basename='attendance-import-log')
router.register(r'company-configs', views.CompanyConfigViewSet, basename='company-config')
router.register(r'shift-configs', views.ShiftConfigViewSet, basename='shift-config')
router.register(r'holiday-configs', views.HolidayConfigViewSet, basename='holiday-config')
router.register(r'company-documents', views.CompanyDocumentViewSet, basename='company-document')
router.register(r'company-announcements', views.CompanyAnnouncementViewSet, basename='company-announcement')
router.register(r'attendance-rule-configs', views.AttendanceRuleConfigViewSet, basename='attendance-rule-config')
router.register(r'attendance-rule-history', views.AttendanceRuleHistoryViewSet, basename='attendance-rule-history')
router.register(r'leave-policy-configs', views.LeavePolicyConfigViewSet, basename='leave-policy-config')
router.register(r'attendance-explanations', taodon_views.AttendanceExplanationViewSet, basename='attendance-explanation')
router.register(r'monthly-leave-requests', taodon_views.MonthlyLeaveViewSet, basename='monthly-leave-request')
router.register(r'registration-requests', registration_views.RegistrationRequestViewSet, basename='registration-request')
router.register(r'online-work-requests', registration_views.OnlineWorkRequestViewSet, basename='online-work-request')
router.register(r'shift-registrations', shift_registration_views.ShiftRegistrationViewSet, basename='shift-registration')
router.register(r'deadline-exceptions', deadline_exception_views.DeadlineExceptionGrantViewSet, basename='deadline-exception')
router.register(r'feedbacks', feedback_views.FeedbackViewSet, basename='feedback')
router.register(r'employee-permissions', views.EmployeePermissionViewSet, basename='employee-permission')
router.register(r'onboardings', OnboardingProcessViewSet, basename='onboardings')
router.register(r'online-work-quota-overrides', views.OnlineWorkQuotaOverrideViewSet, basename='online-work-quota-override')
router.register(r'child-care-regimes', views.ChildCareRegimeViewSet, basename='child-care-regime')
router.register(r'onboarding-tasks', OnboardingTaskViewSet, basename='onboarding-task')
router.register(r'onboarding-checklist', OnboardingChecklistViewSet, basename='onboarding-checklist')
router.register(r'onboarding-documents', OnboardingDocumentViewSet, basename='onboarding-document')
router.register(r'onboarding-document-templates', OnboardingDocumentTemplateViewSet, basename='onboarding-document-template')
router.register(r'employee-onboarding-form', EmployeeOnboardingFormViewSet, basename='employee-onboarding-form')
router.register(r'contract-templates', ContractTemplateViewSet, basename='contract-template')
router.register(r'employee-contracts', EmployeeContractViewSet, basename='employee-contract')
router.register(r'generic-requests', GenericRequestViewSet, basename='generic-request')
router.register(r'request-templates', RequestTemplateViewSet, basename='request-template')
router.register(r'meeting-rooms', MeetingRoomViewSet, basename='meeting-room')
router.register(r'meeting-room-bookings', MeetingRoomBookingViewSet, basename='meeting-room-booking')

urlpatterns = [
    path('meeting-room-settings/', MeetingRoomSettingView.as_view(), name='meeting-room-settings'),

    # Attendance Upload API endpoints - must come before attendance router
    path('attendance/upload/', AttendanceUploadView.as_view(), name='attendance-upload'),
    path('attendance/upload/template/', AttendanceUploadTemplateView.as_view(), name='attendance-upload-template'),
    path('attendance/upload/validate/', AttendanceUploadValidationView.as_view(), name='attendance-upload-validate'),
    
    path('employees/send-account-emails/', send_account_emails, name='send-account-emails'),
    path('employees/import/', EmployeeImportView.as_view(), name='employee-import'),
    path('departments/import/', DepartmentImportView.as_view(), name='department-import'),
    path('important-alerts/', ImportantAlertsView.as_view(), name='important-alerts'),
    path('positions/import/', PositionImportView.as_view(), name='position-import'),
    path('employees/social-insurance/import/', EmployeeSocialInsuranceImportView.as_view(), name='employee-social-insurance-import'),
    path('employees/bulk-salary-config/', BulkSalaryConfigImportView.as_view(), name='employee-bulk-salary-config'),
    path('email-batch/<str:batch_id>/status/', check_email_batch_status, name='email-batch-status'),
    
    # ========== EMPLOYEE ONBOARDING FORM (PUBLIC - NO AUTH) ==========
    # Các endpoint này PHẢI đặt TRƯỚC router.urls để override default routes
    path('employee-onboarding-form/by-token/<str:token>/', 
         EmployeeOnboardingFormViewSet.as_view({'get': 'get_by_token'}), 
         name='employee-onboarding-get-by-token'),
    path('employee-onboarding-form/submit/<str:token>/', 
         EmployeeOnboardingFormViewSet.as_view({'post': 'submit_employee_info'}), 
         name='employee-onboarding-submit'),
    
    # ===== EMPLOYEE RESET PASSWORD API =====
    path('employees/<int:pk>/reset-password/', 
         views.EmployeeViewSet.as_view({'post': 'reset_password'}), 
         name='employee-reset-password'),
    
    # Include router URLs
    path('', include(router.urls)),
    
    # Attendance ViewSet must be registered after the upload endpoints
    path('attendance/', include([
        path('', views.AttendanceViewSet.as_view({'get': 'list', 'post': 'create'}), name='attendance-list'),
        path('<int:pk>/', views.AttendanceViewSet.as_view({
            'get': 'retrieve',
            'put': 'update',
            'patch': 'partial_update',
            'delete': 'destroy'
        }), name='attendance-detail'),
        path('stats/', views.AttendanceViewSet.as_view({'get': 'stats'}), name='attendance-stats'),
        # ← Sử dụng AttendanceCalendarView mới (có check_in/check_out đầy đủ)
        path('calendar-view/', AttendanceCalendarView.as_view(), name='attendance-calendar-view'),
        path('bulk-create/', views.AttendanceViewSet.as_view({'post': 'bulk_create'}), name='attendance-bulk-create'),
    ])),
    
    path('dashboard/', views.DashboardAPIView.as_view(), name='hrm-dashboard'),
    path('attendance-app-download/', views.AttendanceAppDownloadConfigAPIView.as_view(), name='attendance-app-download'),
    path('public/stats/', views.PublicStatsAPIView.as_view(), name='hrm-public-stats'),
    path('current-company-config/', views.CurrentCompanyConfigAPIView.as_view(), name='current-company-config'),
    path('employee-company-info/', views.EmployeeCompanyInfoAPIView.as_view(), name='employee-company-info'),
    path('attendance-rule-engine/', views.AttendanceRuleEngineAPIView.as_view(), name='attendance-rule-engine'),
    
    # Rule Engine API endpoints
    path('rule-engine/', views.RuleEngineAPIView.as_view(), name='rule-engine'),
    path('rule-engine/employees/<int:employee_id>/', views.EmployeeRuleEngineAPIView.as_view(), name='employee-rule-engine'),
    path('rule-engine/departments/<int:department_id>/', views.DepartmentRuleEngineAPIView.as_view(), name='department-rule-engine'),
    path('rule-engine/departments/<int:department_id>/compliance/', views.DepartmentComplianceAPIView.as_view(), name='department-compliance'),
    path('rule-engine/leave-validation/', views.LeaveValidationAPIView.as_view(), name='leave-validation'),
    path('rule-engine/attendance/<int:attendance_id>/apply-rules/', views.RuleApplicationAPIView.as_view(), name='apply-rules'),
    path('rule-engine/test/', views.RuleTestAPIView.as_view(), name='rule-test'),
    path('rule-engine/employees/<int:employee_id>/apply-department-rules/', views.ApplyDepartmentRulesToEmployeeAPIView.as_view(), name='apply-department-rules'),
    
    # Monthly Work Credits API endpoints
    path('monthly-work-credits/', workcaculate_view.MonthlyWorkCreditsAPIView.as_view(), name='monthly-work-credits'),
    # Print attendance explanation
    path('attendance-explanations/<int:explanation_id>/print/', views.print_attendance_explanation, name='print-attendance-explanation'),
    path('attendance-explanations/print-multiple/', views.print_multiple_attendance_explanations, name='print-multiple-attendance-explanations'),

    # Work Finalization (Chốt công) API endpoints
    path('work-finalization/', WorkFinalizationListView.as_view(), name='work-finalization-list'),
    path('salary/department/', SalaryDepartmentView.as_view(), name='salary-department-list'),
    path('work-finalization/finalize/', FinalizeAttendanceView.as_view(), name='work-finalization-finalize'),
    path('work-finalization/finalize-all/', FinalizeAllAttendanceView.as_view(), name='work-finalization-finalize-all'),
    path('work-finalization/finalize-department/', FinalizeDepartmentAttendanceView.as_view(), name='work-finalization-finalize-department'),
    path('work-finalization/export-excel/', WorkFinalizationExportExcelView.as_view(), name='work-finalization-export-excel'),
    path('work-finalization/export-detail/', WorkFinalizationDetailExportView.as_view(), name='work-finalization-export-detail'),

    # Department Work-Finalization Approval (Phê duyệt chốt công phòng ban)
    path('work-finalization/approvals/', DepartmentFinalizationApprovalListView.as_view(), name='dept-finalization-approval-list'),
    path('work-finalization/approvals/send/', SendDepartmentApprovalView.as_view(), name='dept-finalization-approval-send'),
    path('work-finalization/approvals/send-all/', SendAllDepartmentsApprovalView.as_view(), name='dept-finalization-approval-send-all'),
    path('work-finalization/approvals/<int:pk>/', DepartmentFinalizationApprovalDetailView.as_view(), name='dept-finalization-approval-detail'),
    path('work-finalization/approvals/<int:pk>/approve/', ApproveDepartmentFinalizationView.as_view(), name='dept-finalization-approval-approve'),
    path('work-finalization/approvals/<int:pk>/employees/<int:employee_id>/decision/', DecideEmployeeFinalizationView.as_view(), name='dept-finalization-approval-employee-decision'),
    path('work-finalization/approvals/<int:pk>/print/', DepartmentFinalizationApprovalPrintView.as_view(), name='dept-finalization-approval-print'),
    path('work-finalization/accounting-exports/', FinalizationAccountingExportListView.as_view(), name='work-finalization-accounting-export-list'),
    path('work-finalization/accounting-exports/generate/', FinalizationAccountingExportGenerateView.as_view(), name='work-finalization-accounting-export-generate'),

    # Attendance Finalization Approval (Phê duyệt chốt công nhân sự)
    path('attendance-finalization/approvals/', AttendanceFinalizationApprovalListView.as_view(), name='attendance-finalization-approval-list'),
    path('attendance-finalization/approvals/send/', SendAttendanceFinalizationApprovalView.as_view(), name='attendance-finalization-approval-send'),
    path('attendance-finalization/approvals/send-all/', SendAllAttendanceFinalizationApprovalsView.as_view(), name='attendance-finalization-approval-send-all'),
    path('attendance-finalization/approvals/<int:pk>/', AttendanceFinalizationApprovalDetailView.as_view(), name='attendance-finalization-approval-detail'),
    path('attendance-finalization/approvals/<int:pk>/approve/', ApproveAttendanceFinalizationView.as_view(), name='attendance-finalization-approval-approve'),
    path('attendance-finalization/approvals/<int:pk>/employees/<int:employee_id>/decision/', DecideEmployeeAttendanceFinalizationView.as_view(), name='attendance-finalization-approval-employee-decision'),
    path('attendance-finalization/approvals/<int:pk>/employees/<int:employee_id>/email-preview/', AttendanceFinalizationEmployeeEmailPreviewView.as_view(), name='attendance-finalization-approval-employee-email-preview'),
    path('attendance-finalization/approvals/<int:pk>/employees/<int:employee_id>/send-email/', SendAttendanceFinalizationEmployeeEmailView.as_view(), name='attendance-finalization-approval-employee-send-email'),
    path('attendance-finalization/approvals/email-statuses/', AttendanceFinalizationEmailStatusesView.as_view(), name='attendance-finalization-email-statuses'),
    path('attendance-finalization/approvals/send-department-emails/', SendAttendanceFinalizationDepartmentEmailsView.as_view(), name='attendance-finalization-send-department-emails'),
    path('attendance-finalization/approvals/<int:pk>/print/', AttendanceFinalizationApprovalPrintView.as_view(), name='attendance-finalization-approval-print'),

    path('work-finalization/<str:employee_code>/<int:year>/<int:month>/', WorkFinalizationDetailView.as_view(), name='work-finalization-detail'),
    path('change-password/', views.change_password, name='change-password'),
    path('forgot-password/', views.forgot_password, name='forgot-password'),
    path('change-avatar/', ChangeAvatarView.as_view(), name='change-avatar'),

    # Super-admin endpoints (superuser only)
    path('super-admin/onboarding/', SuperAdminOnboardingView.as_view(), name='super-admin-onboarding'),
    path('super-admin/employee/', SuperAdminEmployeeView.as_view(), name='super-admin-employee'),

    # Duyệt đơn: Danh sách tất cả các đơn theo phân quyền
    path('duyet-don/', DuyetDonAPIView.as_view(), name='duyet-don'),
    # Đối soát vi phạm đơn nghỉ phép tháng / nghỉ không phép (HCNS)
    path('violation-report/', LeaveViolationReportView.as_view(), name='violation-report'),
    path('violation-report/penalty-override/', PenaltyOverrideView.as_view(), name='violation-penalty-override'),
    path('violation-report/finalize/', FinalizeMonthView.as_view(), name='violation-finalize'),
    path('grant-timing-report/', GrantTimingReportView.as_view(), name='grant-timing-report'),

    # Báo cáo vi phạm chấm công theo phòng ban
    path('dept-attendance-violation-report/', DeptAttendanceViolationReportView.as_view(),
         name='dept-attendance-violation-report'),

    # Khóa chốt công (Finalization Lock)
    path('finalization-lock/status/', FinalizationLockStatusView.as_view(), name='finalization-lock-status'),
    path('finalization-lock/toggle/', FinalizationLockToggleView.as_view(), name='finalization-lock-toggle'),
    path('finalization-lock/list/', FinalizationLockListView.as_view(), name='finalization-lock-list'),
    path('finalization-lock/check/', FinalizationLockCheckView.as_view(), name='finalization-lock-check'),
    path('finalization-lock/<int:pk>/logs/', FinalizationLockLogView.as_view(), name='finalization-lock-logs'),
    path('finalization-lock/employee-overrides/', FinalizationLockEmployeeOverrideView.as_view(),
         name='finalization-lock-employee-overrides'),
    path('finalization-lock/employee-overrides/<int:pk>/', FinalizationLockEmployeeOverrideDetailView.as_view(),
         name='finalization-lock-employee-override-detail'),

    # Birthday Wishes API endpoints
    path('birthday-wishes/', BirthdayWishListCreateView.as_view(), name='birthday-wish-list'),
    path('birthday-wishes/<int:pk>/', BirthdayWishDetailView.as_view(), name='birthday-wish-detail'),
    path('birthday-wishes/<int:pk>/like/', BirthdayWishLikeView.as_view(), name='birthday-wish-like'),
]

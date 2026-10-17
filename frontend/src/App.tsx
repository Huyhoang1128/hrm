import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout/Layout';
import LandingLayout from './components/LandingLayout/Layout';

// Mỗi trang là 1 chunk riêng, tải khi vào route — bundle đầu nhẹ hơn nhiều.
const LandingPage = lazy(() => import('./pages/LandingPage'));
const EmployeeOnboardingForm = lazy(() =>
  import('./pages/EmployeeOnboardingForm').then((m) => ({ default: m.EmployeeOnboardingForm })),
);
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Login = lazy(() => import('./pages/Login'));
const Settings = lazy(() => import('./pages/Settings'));
const RoleList = lazy(() => import('./pages/RoleList'));
const RoleCreate = lazy(() => import('./pages/RoleCreate'));
const EmployeePermissionShow = lazy(() => import('./pages/EmployeePermissionShow'));
const TermsOfService = lazy(() => import('./pages/TermOfService'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const EmployeeList = lazy(() => import('./pages/EmployeeList'));
const EmployeeCreate = lazy(() => import('./pages/EmployeeCreate'));
const EmployeeShow = lazy(() => import('./pages/EmployeeShow'));
const EmployeeEdit = lazy(() => import('./pages/EmployeeEdit'));
const DepartmentList = lazy(() => import('./pages/DepartmentList'));
const DepartmentCreate = lazy(() => import('./pages/DepartmentCreate'));
const DepartmentEdit = lazy(() => import('./pages/DepartmentEdit'));
const DepartmentEmployees = lazy(() => import('./pages/DepartmentEmployees'));
const SectionList = lazy(() => import('./pages/SectionList'));
const SectionCreate = lazy(() => import('./pages/SectionCreate'));
const SectionEdit = lazy(() => import('./pages/SectionEdit'));
const PositionList = lazy(() => import('./pages/PositionList'));
const PositionCreate = lazy(() => import('./pages/PositionCreate'));
const PositionEdit = lazy(() => import('./pages/PositionEdit'));
const PositionEmployees = lazy(() => import('./pages/PositionEmployees'));
const CompanyUnitList = lazy(() => import('./pages/CompanyUnitList'));
const AttendanceManagement = lazy(() => import('./pages/AttendanceManagement'));
const AttendanceUpload = lazy(() => import('./pages/AttendanceUpload'));
const BranchLocationManagement = lazy(() => import('./pages/BranchLocationManagement'));
const NurseAccountManagement = lazy(() => import('./pages/NurseAccountManagement'));
const Approvals = lazy(() => import('./pages/Approvals'));
const LeaveViolationReport = lazy(() => import('./pages/LeaveViolationReport'));
const GrantTimingReport = lazy(() => import('./pages/GrantTimingReport'));
const MyRequests = lazy(() => import('./pages/MyRequests'));
const SalaryAdvance = lazy(() => import('./pages/SalaryAdvance'));
const RequestTemplates = lazy(() => import('./pages/RequestTemplates'));
const PaymentDocuments = lazy(() => import('./pages/PaymentDocuments'));
const ImportantAlerts = lazy(() => import('./pages/ImportantAlerts'));
const EmployeeChanges = lazy(() => import('./pages/EmployeeChanges'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const OnboardingDetail = lazy(() => import('./pages/OnboardingDetail'));
const Offboarding = lazy(() => import('./pages/Offboarding'));
const AssetList = lazy(() => import('./pages/asset/AssetList'));
const AssignedAssetList = lazy(() => import('./pages/asset/AssignedAssetList'));
const OrganizationChart = lazy(() => import('./pages/OrganizationChart'));
const Profile = lazy(() => import('./pages/Profile'));
const CompanyConfigList = lazy(() => import('./pages/CompanyConfigList'));
const CompanyConfigCreate = lazy(() => import('./pages/CompanyConfigCreate'));
const CompanyConfigEdit = lazy(() => import('./pages/CompanyConfigEdit'));
const TrainingDocuments = lazy(() => import('./pages/company/TrainingDocuments'));
const LaborRules = lazy(() => import('./pages/company/LaborRules'));
const InternalForms = lazy(() => import('./pages/company/InternalForms'));
const WorkProcedures = lazy(() => import('./pages/company/WorkProcedures'));
const Home = lazy(() => import('./pages/Home'));
const AttendanceRuleList = lazy(() => import('./pages/AttendanceRuleList'));
const AttendanceRuleCreate = lazy(() => import('./pages/AttendanceRuleCreate'));
const LeavePolicyList = lazy(() => import('./pages/LeavePolicyList'));
const LeavePolicyCreate = lazy(() => import('./pages/LeavePolicyCreate'));
const WorkFinalization = lazy(() => import('./pages/WorkFinalization'));
const WorkFinalizationData = lazy(() => import('./pages/WorkFinalizationData'));
const WorkFinalizationApprovals = lazy(() => import('./pages/WorkFinalizationApprovals'));
const AttendanceFinalizationApprovals = lazy(() => import('./pages/AttendanceFinalizationApprovals'));
const ContractTemplates = lazy(() => import('./pages/ContractTemplates'));
const BulkContracts = lazy(() => import('./pages/BulkContracts'));
const ContractRenewal = lazy(() => import('./pages/ContractRenewal'));
const DocumentTemplates = lazy(() => import('./pages/DocumentTemplates'));
const PasswordReset = lazy(() => import('./pages/PasswordReset'));
const ShiftConfiguration = lazy(() => import('./pages/ShiftConfiguration'));
const HolidayManagement = lazy(() => import('./pages/HolidayManagement'));
const WorkStandardRules = lazy(() => import('./pages/WorkStandardRules'));
const WorkRequestManagement = lazy(() => import('./pages/WorkRequestManagement'));
const FeedbackManagement = lazy(() => import('./pages/FeedbackManagement'));
const InternalChat = lazy(() => import('./pages/InternalChat'));
const SalaryPayroll = lazy(() => import('./pages/SalaryPayroll'));
const SalaryBonusPrediction = lazy(() => import('./pages/SalaryBonusPrediction'));
const SalaryComparisonReport = lazy(() => import('./pages/SalaryComparisonReport'));
const SalaryEmployeeConfig = lazy(() => import('./pages/SalaryEmployeeConfig'));
const SalaryData = lazy(() => import('./pages/SalaryData'));
const OvertimeRateConfigPage = lazy(() => import('./pages/OvertimeRateConfig'));
const LivestreamAllowanceConfig = lazy(() => import('./pages/LivestreamAllowanceConfig'));
const AttendanceRanking = lazy(() => import('./pages/AttendanceRanking'));
const DisciplinaryPenaltyManagement = lazy(() => import('./pages/DisciplinaryPenaltyManagement'));
const RecruitmentNeeds = lazy(() => import('./pages/recruitment/RecruitmentNeeds'));
const RecruitmentNeedDetail = lazy(() => import('./pages/recruitment/RecruitmentNeedDetail'));
const RecruitmentJobs = lazy(() => import('./pages/recruitment/RecruitmentJobs'));
const RecruitmentJobDetail = lazy(() => import('./pages/recruitment/RecruitmentJobDetail'));
const RecruitmentCandidates = lazy(() => import('./pages/recruitment/RecruitmentCandidates'));
const RecruitmentCandidateDetail = lazy(() => import('./pages/recruitment/RecruitmentCandidateDetail'));
const RecruitmentApplications = lazy(() => import('./pages/recruitment/RecruitmentApplications'));
const RecruitmentInterviews = lazy(() => import('./pages/recruitment/RecruitmentInterviews'));
const AnnouncementList = lazy(() => import('./pages/AnnouncementList'));
const KpiDashboard = lazy(() => import('./pages/kpiokr/KpiDashboard'));
const OkrDashboard = lazy(() => import('./pages/kpiokr/OkrDashboard'));
const TeamTasksBoard = lazy(() => import('./pages/kpiokr/TeamTasksBoard'));
const MeetingRoomBookingPage = lazy(() => import('./pages/MeetingRoomBooking'));
const MeetingRoomManagementPage = lazy(() => import('./pages/MeetingRoomManagement'));
const SocialInsuranceList = lazy(() => import('./pages/SocialInsuranceList'));

function App() {
  return (
    <Router>
      <AuthProvider>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
            </div>
          }
        >
          <Routes>
            <Route
              path="/"
              element={<LandingPage />}
            />
            <Route
              path="/terms-of-service"
              element={
                <LandingLayout>
                  <TermsOfService />
                </LandingLayout>
              }
            />
            <Route
              path="/privacy-policy"
              element={
                <LandingLayout>
                  <PrivacyPolicy />
                </LandingLayout>
              }
            />
            <Route path="/login" element={<Login />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Dashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/settings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Settings />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/meeting-rooms/bookings"
              element={
                <ProtectedRoute>
                  <Layout>
                    <MeetingRoomBookingPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/meeting-rooms/manage"
              element={
                <ProtectedRoute>
                  <Layout>
                    <MeetingRoomManagementPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/roles"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RoleList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/roles/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RoleCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/employee-permissions/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RoleCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/employee-permissions/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <EmployeePermissionShow />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* HRM Routes */}
            <Route
              path="/dashboard/employees"
              element={
                <ProtectedRoute>
                  <Layout>
                    <EmployeeList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/employees/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <EmployeeCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/employees/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <EmployeeShow />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/employees/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <EmployeeEdit />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/social-insurance"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SocialInsuranceList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Company Unit Management Routes */}
            <Route
              path="/dashboard/company-units"
              element={
                <ProtectedRoute>
                  <Layout>
                    <CompanyUnitList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Department Management Routes */}
            <Route
              path="/dashboard/departments"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DepartmentList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/departments/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DepartmentCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/departments/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DepartmentEdit />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/departments/:id/employees"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DepartmentEmployees />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Section Management Routes */}
            <Route
              path="/dashboard/sections"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SectionList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/sections/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SectionCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/sections/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SectionEdit />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/positions/:id/employees"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PositionEmployees />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Position Management Routes */}
            <Route
              path="/dashboard/positions"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PositionList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/positions/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PositionCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/positions/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PositionEdit />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/attendance"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AttendanceManagement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* "Đăng ký ca làm" / "Quản lý đăng ký ca làm" — đã bỏ hẳn theo yêu
                cầu (không dùng nữa). Trước đây chỉ ẩn menu + chặn URL cho
                STAFF; giờ bỏ luôn route nên không ai (kể cả Admin/HR gõ URL
                trực tiếp) truy cập được nữa. Component ShiftRegistration.tsx/
                ShiftRegistrationOverview.tsx vẫn còn trong repo (không xoá
                file) để dễ khôi phục nếu cần sau này, chỉ không còn wire vào
                route nào. */}
            <Route
              path="/dashboard/attendance/upload"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AttendanceUpload />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/attendance/branch-locations"
              element={
                <ProtectedRoute>
                  <Layout>
                    <BranchLocationManagement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/attendance/checkin-app"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'HR']}>
                  <Layout>
                    <NurseAccountManagement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* "Xem chấm công NV khác" — đã chuyển thành tab "Nhân viên" ngay
                trong trang Chấm công (/dashboard/attendance), không còn là
                trang riêng nữa nên bỏ route này. */}
            <Route
              path="/dashboard/attendance/ranking"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AttendanceRanking />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/rewards/disciplinary-penalties"
              element={
                <ProtectedRoute>
                  <Layout>
                    <DisciplinaryPenaltyManagement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/leave-violations"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LeaveViolationReport />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Giữ route cho link cũ — nội dung giờ là tab thứ 3 trong trang
                Đối soát vi phạm, mục sidebar riêng đã bỏ để khỏi trùng chỗ. */}
            <Route
              path="/dashboard/grant-timing"
              element={
                <ProtectedRoute>
                  <Layout>
                    <GrantTimingReport />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/approvals"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Approvals />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/kpi"
              element={
                <ProtectedRoute>
                  <Layout>
                    <KpiDashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/okr"
              element={
                <ProtectedRoute>
                  <Layout>
                    <OkrDashboard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/team-tasks"
              element={
                <ProtectedRoute>
                  <Layout>
                    <TeamTasksBoard />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/my-requests"
              element={
                <ProtectedRoute>
                  <Layout>
                    <MyRequests />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-advance"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SalaryAdvance />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/employee-changes"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'HR']}>
                  <Layout>
                    <EmployeeChanges />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/important-alerts"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'HR']}>
                  <Layout>
                    <ImportantAlerts />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/payment-documents"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'HR']}>
                  <Layout>
                    <PaymentDocuments />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/request-templates"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RequestTemplates />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* ============================================ */}
            {/* ONBOARDING ROUTES - THÊM MỚI */}
            {/* ============================================ */}
            <Route
              path="/dashboard/onboarding"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Onboarding />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* ⭐ ROUTE MỚI - Detail page */}
            <Route
              path="/dashboard/onboarding/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <OnboardingDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* ============================================ */}
            
            <Route
              path="/dashboard/offboarding"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'HR']}>
                  <Layout>
                    <Offboarding />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Asset Management Routes */}
            <Route
              path="/dashboard/assets"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AssetList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Deep-link mở thẳng 1 tài sản (quét mã QR dán trên tài sản) */}
            <Route
              path="/dashboard/assets/:assetId"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AssetList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* My Assets Route (End-User) */}
            <Route
              path="/dashboard/assigned-assets"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AssignedAssetList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Organization Chart Route */}
            <Route
              path="/dashboard/organization-chart"
              element={
                <ProtectedRoute>
                  <Layout>
                    <OrganizationChart />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Home Route */}
            <Route
              path="/home"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Home />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Profile Route */}
            <Route
              path="/dashboard/me"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Profile />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Company Configuration Routes */}
            <Route
              path="/dashboard/company-configs"
              element={
                <ProtectedRoute>
                  <Layout>
                    <CompanyConfigList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/company-configs/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <CompanyConfigCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/company-configs/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <CompanyConfigEdit />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Shift Configuration Route */}
            <Route
              path="/dashboard/shift-configuration"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ShiftConfiguration />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/holidays"
              element={
                <ProtectedRoute>
                  <Layout>
                    <HolidayManagement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/feedbacks"
              element={
                <ProtectedRoute>
                  <Layout>
                    <FeedbackManagement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* --- Quản lý công (mới) --- */}
            <Route
              path="/dashboard/work-management/requests"
              element={
                <ProtectedRoute>
                  <Layout>
                    <WorkRequestManagement />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/work-management/standard-rules"
              element={
                <ProtectedRoute>
                  <Layout>
                    <WorkStandardRules />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Attendance Rule Management Routes */}
            <Route
              path="/dashboard/attendance-rules"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AttendanceRuleList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/attendance-rules/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AttendanceRuleCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/attendance-rules/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AttendanceRuleList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Leave Policy Management Routes */}
            <Route
              path="/dashboard/leave-policies"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LeavePolicyList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/leave-policies/create"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LeavePolicyCreate />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/leave-policies/:id/edit"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LeavePolicyList />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Work Finalization Route */}
            <Route
              path="/dashboard/work-finalization/data"
              element={
                <ProtectedRoute allowedRoles={['ADMIN', 'HR']}>
                  <Layout>
                    <WorkFinalizationData />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/work-finalization"
              element={
                <ProtectedRoute>
                  <Layout>
                    <WorkFinalization />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Work Finalization Approvals Route */}
            <Route
              path="/dashboard/work-finalization/approvals"
              element={
                <ProtectedRoute>
                  <Layout>
                    <WorkFinalizationApprovals />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Attendance Finalization Approvals Route */}
            <Route
              path="/dashboard/work-finalization/attendance-finalization-approvals"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AttendanceFinalizationApprovals />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Company Information Routes */}
            <Route
              path="/company/training"
              element={
                <ProtectedRoute>
                  <Layout>
                    <TrainingDocuments />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/company/labor-rules"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LaborRules />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/company/internal-forms"
              element={
                <ProtectedRoute>
                  <Layout>
                    <InternalForms />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/company/work-procedures"
              element={
                <ProtectedRoute>
                  <Layout>
                    <WorkProcedures />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/contract-templates"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <ContractTemplates />
                    </Layout>
                  </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/bulk-contracts"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <BulkContracts />
                    </Layout>
                  </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/contract-renewals"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <ContractRenewal />
                    </Layout>
                  </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/document-templates"
                element={
                  <ProtectedRoute>
                    <Layout>
                      <DocumentTemplates />
                    </Layout>
                  </ProtectedRoute>
              }
            />
            <Route 
              path="/onboarding/employee-form/:token" 
              element={
                <EmployeeOnboardingForm />
              } 
            />
            {/* Password Reset Route */}
            <Route
              path="/dashboard/password-reset"
              element={
                <ProtectedRoute>
                  <Layout>
                    <PasswordReset />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Internal Chat Route */}
            <Route
              path="/dashboard/chat"
              element={
                <ProtectedRoute>
                  <Layout>
                    <InternalChat />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route path="/dashboard/ai" element={<Navigate to="/dashboard/chat" replace />} />
            {/* Salary Management Route */}
            <Route
              path="/dashboard/salary-management"
              element={
                <ProtectedRoute>
                  <Layout>
                    <Navigate to="/dashboard/salary-management/config" replace />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/config"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SalaryEmployeeConfig />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/work-finalization-approvals"
              element={
                <ProtectedRoute>
                  <Layout>
                    <WorkFinalizationApprovals />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/comparison"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <Layout>
                    <SalaryComparisonReport />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/bonus"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <Layout>
                    <SalaryBonusPrediction />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/payroll"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SalaryPayroll />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/penalty"
              element={
                <ProtectedRoute>
                  <Layout>
                    <SalaryData />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/overtime"
              element={
                <ProtectedRoute>
                  <Layout>
                    <OvertimeRateConfigPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/salary-management/livestream-allowance"
              element={
                <ProtectedRoute>
                  <Layout>
                    <LivestreamAllowanceConfig />
                  </Layout>
                </ProtectedRoute>
              }
            />
            {/* Recruitment Routes */}
            <Route
              path="/dashboard/recruitment/needs"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentNeeds />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/recruitment/needs/:needId"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentNeedDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/recruitment/jobs"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentJobs />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/recruitment/jobs/:jobId"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentJobDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/recruitment/candidates"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentCandidates />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/recruitment/candidates/:candidateId"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentCandidateDetail />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/recruitment/applications"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentApplications />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/recruitment/interviews"
              element={
                <ProtectedRoute>
                  <Layout>
                    <RecruitmentInterviews />
                  </Layout>
                </ProtectedRoute>
              }
            />

            {/* Announcements Route */}
            <Route
              path="/dashboard/announcements"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AnnouncementList />
                  </Layout>
                </ProtectedRoute>
              }
            />

          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
}

export default App;

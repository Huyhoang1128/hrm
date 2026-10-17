import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import RegulationGate from './RegulationGate';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: string[];
}

export default function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Giữ lại đường dẫn đang truy cập (VD quét mã QR tài sản mở
    // /dashboard/assets/123 khi chưa đăng nhập) — Login.tsx đọc lại param
    // này để quay đúng trang sau khi đăng nhập, thay vì luôn về trang chủ.
    const target = window.location.pathname + window.location.search;
    const loginUrl = target && target !== '/' ? `/login?redirect=${encodeURIComponent(target)}` : '/login';
    return <Navigate to={loginUrl} replace />;
  }

  // Always check staff access restrictions
  if (user) {
    const userRole = user.role ? user.role.toUpperCase() : '';
    const isSuperAdmin = user.is_super_admin || false;
    
    // Get user's department code from various possible locations in user object
    const userDepartmentCode = (
      user.employee_profile?.department_code ||
      user.hrm_user?.department_code ||
      (user as any)?.department_code ||
      null
    );
    
    // Super admin can access everything
    if (!isSuperAdmin && userRole === 'STAFF') {
      // Staff can only access specific routes
      // These routes correspond to: Home, Me, Attendance, Organization Chart, Approvals
      // PLUS attendance upload for HCNS department staff
      const currentPath = window.location.pathname;
      
      // Define allowed paths for staff
      const isManager = user?.is_manager || false
      const employeePermission = user?.employee_permission;

      const isAllowedForStaff =
        currentPath === '/home' ||
        currentPath === '/dashboard/me' ||
        currentPath === '/dashboard/attendance' ||
        currentPath === '/dashboard/meeting-rooms/bookings' ||
        currentPath === '/dashboard/organization-chart' ||
        currentPath === '/dashboard/approvals' ||
        currentPath === '/dashboard/my-requests' ||
        // Đối soát vi phạm đơn từ: mọi vai đều vào được từ 2026-10-12 — nhân
        // viên thấy lỗi của mình và lỗi của quản lý trên đơn của mình, quản lý
        // thấy thêm của team. Backend tự cắt phạm vi (viewer_scope) và chỉ
        // HCNS/Admin mới có nút áp/gỡ phạt, nên mở route ở đây là an toàn.
        // (Thiếu dòng này thì STAFF bị đá về /home dù menu đã hiện.)
        currentPath === '/dashboard/leave-violations' ||
        currentPath === '/dashboard/salary-advance' ||
        // Kế hoạch ca tuần: mọi người lập kế hoạch của mình; trang duyệt cho
        // quản lý (bước 1) và người có quyền duyệt chấm công (bước HCNS).
        // Backend tự cắt phạm vi danh sách + quyền duyệt.
        currentPath === '/dashboard/weekly-shift-plan' ||
        ((isManager || employeePermission?.can_approve_attendance) && currentPath === '/dashboard/weekly-shift-plan/approval') ||
        currentPath === '/dashboard/kpi' ||
        currentPath === '/dashboard/okr' ||
        currentPath === '/dashboard/team-tasks' ||
        (currentPath === '/dashboard/attendance/upload' && userDepartmentCode === 'HCNS') ||
        currentPath === '/dashboard/onboarding' ||
        currentPath.startsWith('/dashboard/onboarding/') ||
        (isManager && (currentPath === '/dashboard/onboarding' || currentPath.startsWith('/dashboard/onboarding/'))) ||
        (employeePermission?.can_manage_departments && (currentPath === '/dashboard/departments' || currentPath.startsWith('/dashboard/departments/'))) ||
        (employeePermission?.can_manage_positions && (currentPath === '/dashboard/positions' || currentPath.startsWith('/dashboard/positions/'))) ||
        currentPath === '/dashboard/assigned-assets' ||
        currentPath === '/dashboard/chat' ||
        currentPath === '/dashboard/announcements' ||
        currentPath === '/dashboard/recruitment/needs' ||
        currentPath.startsWith('/dashboard/recruitment/needs/') ||
        ((isManager || employeePermission?.can_manage_recruitment) &&
          (currentPath === '/dashboard/recruitment/interviews' || currentPath.startsWith('/dashboard/recruitment/interviews/'))) ||
        (employeePermission?.can_manage_disciplinary_penalties && currentPath === '/dashboard/rewards/disciplinary-penalties') ||
        // "Đăng ký ca làm"/"Quản lý đăng ký ca làm" tạm ẩn hẳn theo yêu cầu
        // (không dùng nữa) — cố ý bỏ khỏi whitelist để STAFF không vào được
        // qua URL trực tiếp dù menu đã ẩn. Route/code/data backend vẫn giữ
        // nguyên (Phòng AI/CNTT + tính năng Ca 2 vẫn hoạt động qua API).
        // Trưởng phòng (is_manager) được xem trang Quản lý nhân viên (danh
        // sách + xem chi tiết 1 NV) — chỉ thấy NV thuộc phòng ban mình quản lý
        // (lọc ở backend/EmployeeList, không phải ở đây). KHÔNG cho vào trang
        // tạo mới/sửa nhân viên qua route này.
        (isManager && (
          currentPath === '/dashboard/employees' ||
          /^\/dashboard\/employees\/\d+$/.test(currentPath)
        )) ||
        // Trưởng phòng (is_manager) được xem trang "Chốt công" (chỉ thấy dữ
        // liệu phòng ban mình quản lý — lọc ở backend/WorkFinalization).
        // KHÔNG mở "Phê duyệt chốt công" (/work-finalization/approvals,
        // /attendance-finalization-approvals) — vẫn chỉ dành ADMIN/HR.
        (isManager && currentPath === '/dashboard/work-finalization') ||
        (currentPath === '/dashboard' && !!(
          employeePermission?.can_view_dashboard_overview ||
          employeePermission?.can_view_dashboard_employee ||
          employeePermission?.can_view_dashboard_recruitment ||
          employeePermission?.can_view_dashboard_insurance ||
          employeePermission?.can_view_dashboard_asset
        ));

      if (!isAllowedForStaff) {
        return <Navigate to="/home" replace />;
      }
    }
    if (!isSuperAdmin && userRole === 'CUSTOMER') {
      const currentPath = window.location.pathname;
      
      const isManager = user?.is_manager || false
      const employeePermission = user?.employee_permission;

      const isAllowedForCustomer =
        currentPath === '/home' ||
        currentPath === '/dashboard/me' ||
        currentPath === '/dashboard/attendance' ||
        currentPath === '/dashboard/meeting-rooms/bookings' ||
        currentPath === '/dashboard/organization-chart' ||
        currentPath === '/dashboard/approvals' ||
        currentPath === '/dashboard/weekly-shift-plan' ||
        ((isManager || employeePermission?.can_approve_attendance) && currentPath === '/dashboard/weekly-shift-plan/approval') ||
        currentPath === '/dashboard/onboarding' ||
        currentPath.startsWith('/dashboard/onboarding/') ||
        currentPath === '/dashboard/assigned-assets' ||
        currentPath === '/dashboard/chat' ||
        currentPath === '/dashboard/announcements' ||
        currentPath === '/dashboard/recruitment/needs' ||
        currentPath.startsWith('/dashboard/recruitment/needs/') ||
        ((isManager || employeePermission?.can_manage_recruitment) &&
          (currentPath === '/dashboard/recruitment/interviews' || currentPath.startsWith('/dashboard/recruitment/interviews/')));
        // "Đăng ký ca làm"/"overview" tạm ẩn hẳn — xem ghi chú ở nhánh STAFF phía trên.

      if (!isAllowedForCustomer) {
        return <Navigate to="/home" replace />;
      }
}
  }

  // Check role-based access if allowedRoles is provided
  if (allowedRoles && user) {
    const userRole = user.role ? user.role.toUpperCase() : '';
    const isSuperAdmin = user.is_super_admin || false;
    
    // Super admin can access everything
    if (!isSuperAdmin && userRole !== 'STAFF') {
      // For non-staff users, check allowedRoles normally
      const hasAccess = allowedRoles.some(role => 
        role.toUpperCase() === userRole
      );
      
      if (!hasAccess) {
        // Redirect to home page if user doesn't have required role
        return <Navigate to="/home" replace />;
      }
    }
  }

  return (
    <>
      {user &&
        user.role?.toUpperCase() !== 'ADMIN' &&
        !user.is_super_admin &&
        !user.is_superuser && <RegulationGate userId={user.id} />}
      {children}
    </>
  );
}

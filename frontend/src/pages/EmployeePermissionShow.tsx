import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PencilSquareIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  UserIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline';
import { employeePermissionService, EmployeePermission } from '../services/employee-permission.service';

const EmployeePermissionShow: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [permission, setPermission] = useState<EmployeePermission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadPermission(parseInt(id));
    }
  }, [id]);

  const loadPermission = async (permissionId: number) => {
    try {
      setLoading(true);
      setError(null);
      const data = await employeePermissionService.getEmployeePermissionById(permissionId);
      setPermission(data);
    } catch (err) {
      console.error('Failed to load employee permission:', err);
      setError('Không tìm thấy phân quyền hoặc đã xảy ra lỗi khi tải dữ liệu');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!permission || !window.confirm('Bạn có chắc chắn muốn xóa phân quyền này?')) {
      return;
    }
    try {
      await employeePermissionService.deleteEmployeePermission(permission.id);
      navigate('/dashboard/roles');
    } catch (err) {
      console.error('Failed to delete employee permission:', err);
      setError('Lỗi khi xóa phân quyền');
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getPermissionChips = (summary?: string) => {
    if (!summary || summary === 'Không có quyền đặc biệt') return [];
    return summary.split(',').map((s) => s.trim()).filter(Boolean);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-64 gap-3">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        <p className="text-sm text-gray-500">Đang tải dữ liệu...</p>
      </div>
    );
  }

  if (error || !permission) {
    return (
      <div className="flex flex-col gap-6 flex-1 min-h-0">
        <button
          type="button"
          onClick={() => navigate('/dashboard/roles')}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Quay lại
        </button>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-800">Lỗi</p>
            <p className="text-sm text-red-700 mt-0.5">{error || 'Không tìm thấy phân quyền'}</p>
          </div>
        </div>
      </div>
    );
  }

  const permissionAny = permission as any;
  const employeeObj = typeof permission.employee === 'object' ? (permission.employee as any) : null;
  const employeeName = permissionAny.employee_name || employeeObj?.full_name || '-';
  const employeeCode = permissionAny.employee_code || employeeObj?.employee_id || '-';
  const departmentName = permissionAny.department_name || employeeObj?.department?.name;
  const positionTitle = permissionAny.position_title || employeeObj?.position?.title;
  const chips = getPermissionChips(permission.permission_summary);

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={() => navigate('/dashboard/roles')}
            className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Quay lại
          </button>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Chi tiết phân quyền</h1>
          <p className="text-sm text-gray-900 mt-0.5">Thông tin quyền hạn đã cấp cho nhân viên</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/dashboard/employee-permissions/${permission.id}/edit`)}
            className="btn-secondary flex items-center gap-1.5"
          >
            <PencilSquareIcon className="h-4 w-4" />
            Chỉnh sửa
          </button>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 py-2 px-4 rounded-xl text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
          >
            <TrashIcon className="h-4 w-4" />
            Xóa
          </button>
        </div>
      </div>

      {/* Employee info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 flex-shrink-0 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center text-xl font-bold">
            {employeeName !== '-' ? employeeName.charAt(0).toUpperCase() : <UserIcon className="h-6 w-6" />}
          </div>
          <div>
            <h2 className="text-base font-bold text-gray-900">{employeeName}</h2>
            <p className="text-sm text-gray-500">{employeeCode}</p>
            {(departmentName || positionTitle) && (
              <p className="text-xs text-gray-400 mt-0.5">
                {[departmentName, positionTitle].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="ml-auto">
            {permission.has_any_permission ? (
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-600">Có quyền</span>
            ) : (
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500">Không có</span>
            )}
          </div>
        </div>
      </div>

      {/* Permissions granted */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
            <ShieldCheckIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">Quyền đã cấp</h2>
            <p className="text-xs text-gray-400">{chips.length} quyền đang bật</p>
          </div>
        </div>

        {chips.length === 0 ? (
          <p className="text-sm text-gray-400">Nhân viên này chưa được cấp quyền đặc biệt nào.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <span
                key={chip}
                className="px-3 py-1 text-xs font-medium rounded-full bg-primary-50 text-primary-700"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Notes & system info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-9 w-9 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center">
            <CalendarIcon className="h-5 w-5" />
          </div>
          <h2 className="text-sm font-bold text-gray-900">Thông tin hệ thống</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ngày tạo</p>
            <p className="text-sm text-gray-800 mt-0.5">{formatDate(permission.created_at)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cập nhật lần cuối</p>
            <p className="text-sm text-gray-800 mt-0.5">{formatDate(permission.updated_at)}</p>
          </div>
          {permission.notes && (
            <div className="sm:col-span-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Ghi chú</p>
              <p className="text-sm text-gray-800 mt-0.5 whitespace-pre-wrap">{permission.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmployeePermissionShow;

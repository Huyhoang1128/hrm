import React, { useState, useEffect } from 'react';
import {
  ArrowLeftIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  UserIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { employeePermissionService, EmployeePermission } from '../services/employee-permission.service';
import { employeesAPI } from '../utils/api';
import { useNavigate, useParams } from 'react-router-dom';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const RoleCreate: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [existingPermissionId, setExistingPermissionId] = useState<number | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    employee_id: '',
    can_approve_attendance: false,
    can_create_employee: false,
    can_manage_attendance: false,
    can_manage_assets: false,
    can_approve_leave: false,
    can_approve_overtime: false,
    can_view_all_employees: false,
    can_manage_departments: false,
    can_manage_positions: false,
    can_manage_company_config: false,
    can_manage_attendance_rules: false,
    can_manage_leave_policies: false,
    can_view_reports: false,
    can_export_reports: false,
    can_manage_disciplinary_penalties: false,
    can_view_dashboard_overview: false,
    can_view_dashboard_employee: false,
    can_view_dashboard_recruitment: false,
    can_view_dashboard_insurance: false,
    can_view_dashboard_asset: false,
    notes: '',
  });

  // Validation state
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    loadEmployees();
  }, []);

  // Khi vào trang qua route /dashboard/employee-permissions/:id/edit,
  // tải sẵn đúng bản ghi phân quyền đó thay vì bắt admin tự chọn lại nhân viên.
  useEffect(() => {
    if (id) {
      loadPermissionById(parseInt(id));
    }
  }, [id]);

  const loadPermissionById = async (permissionId: number) => {
    try {
      const permission = await employeePermissionService.getEmployeePermissionById(permissionId);
      // `employee` trả về từ API là ID thô (number); một số nơi khác (không phải endpoint này)
      // có thể trả nested object nên vẫn kiểm tra phòng hờ.
      const employeeId = typeof permission.employee === 'object'
        ? (permission.employee as any)?.id
        : permission.employee;

      setFormData(prev => ({
        ...prev,
        employee_id: String(employeeId ?? ''),
        can_approve_attendance: permission.can_approve_attendance,
        can_create_employee: permission.can_create_employee,
        can_manage_attendance: permission.can_manage_attendance,
        can_manage_assets: permission.can_manage_assets,
        can_approve_leave: permission.can_approve_leave,
        can_approve_overtime: permission.can_approve_overtime,
        can_view_all_employees: permission.can_view_all_employees,
        can_manage_departments: permission.can_manage_departments,
        can_manage_positions: permission.can_manage_positions,
        can_manage_company_config: permission.can_manage_company_config,
        can_manage_attendance_rules: permission.can_manage_attendance_rules,
        can_manage_leave_policies: permission.can_manage_leave_policies,
        can_view_reports: permission.can_view_reports,
        can_export_reports: permission.can_export_reports,
        can_manage_disciplinary_penalties: permission.can_manage_disciplinary_penalties,
        can_view_dashboard_overview: permission.can_view_dashboard_overview || false,
        can_view_dashboard_employee: permission.can_view_dashboard_employee || false,
        can_view_dashboard_recruitment: permission.can_view_dashboard_recruitment || false,
        can_view_dashboard_insurance: permission.can_view_dashboard_insurance || false,
        can_view_dashboard_asset: permission.can_view_dashboard_asset || false,
        notes: permission.notes || '',
      }));
      setExistingPermissionId(permission.id);
    } catch (err) {
      console.error('Failed to load permission by id:', err);
      setError('Không tìm thấy phân quyền hoặc đã xảy ra lỗi khi tải dữ liệu');
    }
  };

  const loadEmployees = async () => {
    try {
      // Tải toàn bộ nhân viên (không giới hạn phòng ban) để admin có thể gán
      // phân quyền (bao gồm quyền xem tab Dashboard) cho bất kỳ nhân viên nào,
      // không chỉ nhân viên phòng Hành chính Nhân sự.
      const response = await employeesAPI.list({ page_size: 1000, is_active: true });
      setEmployees(response.results);

      if (response.results.length === 0) {
        setError('Không tìm thấy nhân viên nào');
      }
    } catch (err) {
      console.error('Failed to load employees:', err);
      setError('Lỗi khi tải danh sách nhân viên');
    }
  };

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};

    // Employee validation
    if (!formData.employee_id) {
      newErrors.employee_id = 'Vui lòng chọn nhân viên';
    }

    // At least one permission should be selected
    const hasAnyPermission =
      formData.can_approve_attendance ||
      formData.can_create_employee ||
      formData.can_manage_attendance ||
      formData.can_manage_assets ||
      formData.can_approve_leave ||
      formData.can_approve_overtime ||
      formData.can_view_all_employees ||
      formData.can_manage_departments ||
      formData.can_manage_positions ||
      formData.can_manage_company_config ||
      formData.can_manage_attendance_rules ||
      formData.can_manage_leave_policies ||
      formData.can_view_reports ||
      formData.can_export_reports ||
      formData.can_manage_disciplinary_penalties ||
      formData.can_view_dashboard_overview ||
      formData.can_view_dashboard_employee ||
      formData.can_view_dashboard_recruitment ||
      formData.can_view_dashboard_insurance ||
      formData.can_view_dashboard_asset;

    if (!hasAnyPermission) {
      newErrors.permissions = 'Vui lòng chọn ít nhất một quyền';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({
        ...prev,
        [name]: checked,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({
        ...prev,
        [name]: '',
      }));
    }
  };

  const handleEmployeeChange = (value: string) => {
    setFormData((prev) => ({ ...prev, employee_id: value }));
    setExistingPermissionId(null);

    if (errors.employee_id) {
      setErrors((prev) => ({ ...prev, employee_id: '' }));
    }

    if (value) {
      loadEmployeePermissions(parseInt(value));
    }
  };

  const handleSelectAllPermissions = () => {
    setFormData((prev) => ({
      ...prev,
      can_approve_attendance: true,
      can_create_employee: true,
      can_manage_attendance: true,
      can_manage_assets: true,
      can_approve_leave: true,
      can_approve_overtime: true,
      can_view_all_employees: true,
      can_manage_departments: true,
      can_manage_positions: true,
      can_manage_company_config: true,
      can_manage_attendance_rules: true,
      can_manage_leave_policies: true,
      can_view_reports: true,
      can_export_reports: true,
      can_manage_disciplinary_penalties: true,
      can_view_dashboard_overview: true,
      can_view_dashboard_employee: true,
      can_view_dashboard_recruitment: true,
      can_view_dashboard_insurance: true,
      can_view_dashboard_asset: true,
    }));
  };

  const handleClearAllPermissions = () => {
    setFormData((prev) => ({
      ...prev,
      can_approve_attendance: false,
      can_create_employee: false,
      can_manage_attendance: false,
      can_manage_assets: false,
      can_approve_leave: false,
      can_approve_overtime: false,
      can_view_all_employees: false,
      can_manage_departments: false,
      can_manage_positions: false,
      can_manage_company_config: false,
      can_manage_attendance_rules: false,
      can_manage_leave_policies: false,
      can_view_reports: false,
      can_export_reports: false,
      can_manage_disciplinary_penalties: false,
      can_view_dashboard_overview: false,
      can_view_dashboard_employee: false,
      can_view_dashboard_recruitment: false,
      can_view_dashboard_insurance: false,
      can_view_dashboard_asset: false,
    }));
  };

  const loadEmployeePermissions = async (employeeId: number) => {
    try {
      const permission = await employeePermissionService.getEmployeePermissionByEmployeeId(employeeId);

      // Update form with existing permissions
      setFormData(prev => ({
        ...prev,
        can_approve_attendance: permission.can_approve_attendance,
        can_create_employee: permission.can_create_employee,
        can_manage_attendance: permission.can_manage_attendance,
        can_manage_assets: permission.can_manage_assets,
        can_approve_leave: permission.can_approve_leave,
        can_approve_overtime: permission.can_approve_overtime,
        can_view_all_employees: permission.can_view_all_employees,
        can_manage_departments: permission.can_manage_departments,
        can_manage_positions: permission.can_manage_positions,
        can_manage_company_config: permission.can_manage_company_config,
        can_manage_attendance_rules: permission.can_manage_attendance_rules,
        can_manage_leave_policies: permission.can_manage_leave_policies,
        can_view_reports: permission.can_view_reports,
        can_export_reports: permission.can_export_reports,
        can_manage_disciplinary_penalties: permission.can_manage_disciplinary_penalties,
        can_view_dashboard_overview: permission.can_view_dashboard_overview || false,
        can_view_dashboard_employee: permission.can_view_dashboard_employee || false,
        can_view_dashboard_recruitment: permission.can_view_dashboard_recruitment || false,
        can_view_dashboard_insurance: permission.can_view_dashboard_insurance || false,
        can_view_dashboard_asset: permission.can_view_dashboard_asset || false,
        notes: permission.notes || '',
      }));
      setExistingPermissionId(permission.id);

      setSuccess(`Đã tải quyền hiện có của nhân viên`);
    } catch (error: any) {
      // If employee doesn't have permissions yet, clear the form (except employee_id)
      if (error.response?.status === 404) {
        setFormData(prev => ({
          ...prev,
          can_approve_attendance: false,
          can_create_employee: false,
          can_manage_attendance: false,
          can_manage_assets: false,
          can_approve_leave: false,
          can_approve_overtime: false,
          can_view_all_employees: false,
          can_manage_departments: false,
          can_manage_positions: false,
          can_manage_company_config: false,
          can_manage_attendance_rules: false,
          can_manage_leave_policies: false,
          can_view_reports: false,
          can_export_reports: false,
          can_manage_disciplinary_penalties: false,
          can_view_dashboard_overview: false,
          can_view_dashboard_employee: false,
          can_view_dashboard_recruitment: false,
          can_view_dashboard_insurance: false,
          can_view_dashboard_asset: false,
          notes: '',
        }));
        setExistingPermissionId(null);
        setSuccess('Nhân viên chưa có quyền nào. Bạn có thể tạo quyền mới.');
      } else {
        console.error('Failed to load employee permissions:', error);
        setError('Lỗi khi tải quyền của nhân viên');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuccess(null);

      // Find the selected employee
      const selectedEmployee = employees.find(emp => emp.id.toString() === formData.employee_id);
      if (!selectedEmployee) {
        throw new Error('Nhân viên không tồn tại');
      }

      const permissionData = {
        employee: selectedEmployee.id,
        employee_id: selectedEmployee.id,
        can_approve_attendance: formData.can_approve_attendance,
        can_create_employee: formData.can_create_employee,
        can_manage_attendance: formData.can_manage_attendance,
        can_manage_assets: formData.can_manage_assets,
        can_approve_leave: formData.can_approve_leave,
        can_approve_overtime: formData.can_approve_overtime,
        can_view_all_employees: formData.can_view_all_employees,
        can_manage_departments: formData.can_manage_departments,
        can_manage_positions: formData.can_manage_positions,
        can_manage_company_config: formData.can_manage_company_config,
        can_manage_attendance_rules: formData.can_manage_attendance_rules,
        can_manage_leave_policies: formData.can_manage_leave_policies,
        can_view_reports: formData.can_view_reports,
        can_export_reports: formData.can_export_reports,
        can_manage_disciplinary_penalties: formData.can_manage_disciplinary_penalties,
        can_view_dashboard_overview: formData.can_view_dashboard_overview,
        can_view_dashboard_employee: formData.can_view_dashboard_employee,
        can_view_dashboard_recruitment: formData.can_view_dashboard_recruitment,
        can_view_dashboard_insurance: formData.can_view_dashboard_insurance,
        can_view_dashboard_asset: formData.can_view_dashboard_asset,
        notes: formData.notes,
      };

      if (existingPermissionId) {
        await employeePermissionService.updateEmployeePermission(existingPermissionId, permissionData);
        setSuccess('Cập nhật phân quyền thành công!');
      } else {
        await employeePermissionService.createEmployeePermission(permissionData);
        setSuccess('Tạo phân quyền thành công!');
      }

      // Redirect after 2 seconds
      setTimeout(() => {
        navigate('/dashboard/roles');
      }, 2000);
    } catch (err: any) {
      console.error('Failed to save permission:', err);
      setError(err.response?.data?.message || err.message || 'Lỗi khi lưu phân quyền');
    } finally {
      setLoading(false);
    }
  };

  const permissionGroups = [
    {
      title: 'Quyền phê duyệt',
      permissions: [
        { id: 'can_approve_attendance', label: 'Phê duyệt công', description: 'Có quyền phê duyệt chấm công của nhân viên' },
        { id: 'can_approve_leave', label: 'Phê duyệt nghỉ phép', description: 'Có quyền phê duyệt đơn xin nghỉ phép' },
        { id: 'can_approve_overtime', label: 'Phê duyệt làm thêm giờ', description: 'Có quyền phê duyệt đơn xin làm thêm giờ' },
      ],
    },
    {
      title: 'Quyền quản lý nhân sự',
      permissions: [
        { id: 'can_create_employee', label: 'Tạo nhân viên', description: 'Có quyền tạo tài khoản nhân viên mới' },
        { id: 'can_view_all_employees', label: 'Xem tất cả nhân viên', description: 'Có quyền xem thông tin tất cả nhân viên' },
        { id: 'can_manage_departments', label: 'Quản lý phòng ban', description: 'Có quyền thêm/sửa/xóa phòng ban' },
        { id: 'can_manage_positions', label: 'Quản lý vị trí', description: 'Có quyền thêm/sửa/xóa vị trí công việc' },
      ],
    },
    {
      title: 'Quyền quản lý chấm công',
      permissions: [
        { id: 'can_manage_attendance', label: 'Quản lý chấm công', description: 'Có quyền quản lý và điều chỉnh chấm công' },
      ],
    },
    {
      title: 'Quyền quản lý tài sản',
      permissions: [
        { id: 'can_manage_assets', label: 'Quản lý tài sản', description: 'Có quyền quản lý tài sản công ty' },
      ],
    },
    {
      title: 'Quyền cấu hình hệ thống',
      permissions: [
        { id: 'can_manage_company_config', label: 'Quản lý cấu hình công ty', description: 'Có quyền cấu hình thông tin công ty' },
        { id: 'can_manage_attendance_rules', label: 'Quản lý quy tắc chấm công', description: 'Có quyền quản lý quy tắc tính công' },
        { id: 'can_manage_leave_policies', label: 'Quản lý chính sách nghỉ phép', description: 'Có quyền quản lý chính sách nghỉ phép' },
      ],
    },
    {
      title: 'Quyền báo cáo',
      permissions: [
        { id: 'can_view_reports', label: 'Xem báo cáo', description: 'Có quyền xem các báo cáo thống kê' },
        { id: 'can_export_reports', label: 'Xuất báo cáo', description: 'Có quyền xuất báo cáo ra file' },
      ],
    },
    {
      title: 'Khen thưởng & Kỷ luật',
      permissions: [
        { id: 'can_manage_disciplinary_penalties', label: 'Quản lý phạt biên bản', description: 'Có quyền ghi nhận và quản lý biên bản phạt nhân sự' },
      ],
    },
    {
      title: 'Quyền xem tab Dashboard',
      permissions: [
        { id: 'can_view_dashboard_overview', label: 'Xem tab Tổng quan', description: 'Hiển thị tab Tổng quan trên Dashboard' },
        { id: 'can_view_dashboard_employee', label: 'Xem tab Nhân viên', description: 'Hiển thị tab Nhân viên trên Dashboard' },
        { id: 'can_view_dashboard_recruitment', label: 'Xem tab Tuyển dụng', description: 'Hiển thị tab Tuyển dụng trên Dashboard' },
        { id: 'can_view_dashboard_insurance', label: 'Xem tab BHXH', description: 'Hiển thị tab BHXH trên Dashboard' },
        { id: 'can_view_dashboard_asset', label: 'Xem tab Tài sản', description: 'Hiển thị tab Tài sản trên Dashboard' },
      ],
    },
  ];

  const totalPermissionCount = permissionGroups.reduce((sum, group) => sum + group.permissions.length, 0);

  const getSelectedCount = () => {
    return Object.entries(formData).filter(([key, value]) =>
      key.startsWith('can_') && value === true
    ).length;
  };

  const selectedEmployee = employees.find(emp => emp.id.toString() === formData.employee_id);

  return (
    <div className="flex flex-col gap-6 flex-1 min-h-0">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => navigate('/dashboard/roles')}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Quay lại
        </button>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          {existingPermissionId ? 'Cập nhật phân quyền' : 'Thêm phân quyền mới'}
        </h1>
        <p className="text-sm text-gray-900 mt-0.5">
          Phân quyền cho nhân viên: phê duyệt công, tạo nhân viên, quản lý chấm công, quản lý tài sản, xem tab Dashboard, v.v.
        </p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-800">Lỗi</p>
            <p className="text-sm text-red-700 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 flex items-start gap-3">
          <CheckCircleIcon className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-emerald-800">Thành công</p>
            <p className="text-sm text-emerald-700 mt-0.5">{success}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Chọn nhân viên */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <UserIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Chọn nhân viên</h2>
              <p className="text-xs text-gray-400">Áp dụng cho mọi nhân viên, không giới hạn phòng ban</p>
            </div>
          </div>

          <SelectBox<string>
            label="Nhân viên *"
            value={formData.employee_id}
            searchable
            placeholder="-- Tìm và chọn nhân viên --"
            options={employees.map((employee) => ({
              value: String(employee.id),
              label: `${employee.employee_id} - ${employee.full_name}${employee.department ? ` (${employee.department.name})` : ''}`,
            }))}
            onChange={handleEmployeeChange}
          />
          {errors.employee_id && (
            <p className="mt-1.5 text-sm text-red-600">{errors.employee_id}</p>
          )}
          {selectedEmployee?.department && (
            <p className="mt-1.5 text-xs text-gray-400">
              Phòng ban: {selectedEmployee.department.name}
              {selectedEmployee.position && ` · Vị trí: ${selectedEmployee.position.title}`}
            </p>
          )}
        </div>

        {/* Quyền hạn */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center">
                <ShieldCheckIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Quyền hạn</h2>
                <p className="text-xs text-gray-400">Đã chọn {getSelectedCount()} trong tổng số {totalPermissionCount} quyền</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllPermissions}
                className="text-xs font-semibold text-primary-600 hover:text-primary-700"
              >
                Chọn tất cả
              </button>
              <span className="text-gray-300">|</span>
              <button
                type="button"
                onClick={handleClearAllPermissions}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Bỏ chọn tất cả
              </button>
            </div>
          </div>

          {errors.permissions && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-sm text-red-600">{errors.permissions}</p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {permissionGroups.map((group) => (
              <div
                key={group.title}
                className="bg-gray-50 border border-gray-100 rounded-xl p-4"
              >
                <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-3">
                  {group.title}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {group.permissions.map((permission) => (
                    <label
                      key={permission.id}
                      className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-white cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        name={permission.id}
                        checked={formData[permission.id as keyof typeof formData] as boolean}
                        onChange={handleInputChange}
                        className="h-4 w-4 mt-0.5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                      />
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          {permission.label}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {permission.description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ghi chú */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center">
              <DocumentTextIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Ghi chú</h2>
              <p className="text-xs text-gray-400">Tùy chọn</p>
            </div>
          </div>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleInputChange}
            rows={3}
            className="input-field resize-none"
            placeholder="Nhập ghi chú về phân quyền này..."
          />
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/dashboard/roles')}
            className="btn-secondary"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Đang xử lý...
              </span>
            ) : (
              existingPermissionId ? 'Cập nhật phân quyền' : 'Tạo phân quyền'
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

export default RoleCreate;

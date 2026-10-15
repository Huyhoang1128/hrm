import React, { useState, useEffect } from 'react';
import {
  employeesAPI,
  departmentsAPI,
  positionsAPI,
  EmployeeCreateData,
} from '../utils/api';
import { ruleEngineAPI } from '../utils/ruleEngineApi';
import { useNavigate } from 'react-router-dom';
import { SelectBox, SelectOption } from '@/components/LandingLayout/SelectBox';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

const genderOptions: SelectOption<'M' | 'F' | 'O'>[] = [
  { value: 'M', label: 'Nam' },
  { value: 'F', label: 'Nữ' },
  { value: 'O', label: 'Khác' },
];

const employmentOptions: SelectOption<'ACTIVE' | 'PROBATION' | 'INACTIVE'>[] = [
  { value: 'ACTIVE', label: 'Đang làm việc' },
  { value: 'PROBATION', label: 'Thử việc' },
  { value: 'INACTIVE', label: 'Đã nghỉ' },
];

const EmployeeCreate: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [applyDepartmentRules, setApplyDepartmentRules] =
    useState<boolean>(true);
  const [loadingRules, setLoadingRules] = useState<boolean>(false);
  const [departmentRulesInfo, setDepartmentRulesInfo] = useState<any>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState<EmployeeCreateData>({
    employee_id: '',
    full_name: '',
    gender: 'M',
    date_of_birth: '',
    phone_number: '',
    personal_email: '',
    bank_name: '',
    bank_account: '',
    employment_status: 'ACTIVE',
    start_date: '',
    end_date: '',
    username: '',
    password: '',
    email: '',
    first_name: '',
    last_name: '',
    position_id: undefined,
    department_id: undefined,
    manager_id: undefined,
    is_hr: false,
  });

  useEffect(() => {
    loadDepartments();
    loadPositions();
    loadEmployees();
  }, []);

  useEffect(() => {
    if (formData.department_id && applyDepartmentRules) {
      loadDepartmentRulesInfo(formData.department_id);
    } else {
      setDepartmentRulesInfo(null);
    }
  }, [formData.department_id, applyDepartmentRules]);

  const loadDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      setDepartments(response.results);
    } catch (err) {
      console.error('Failed to load departments:', err);
    }
  };

  const loadPositions = async () => {
    try {
      const response = await positionsAPI.list();
      setPositions(response.results);
    } catch (err) {
      console.error('Failed to load positions:', err);
    }
  };

  const loadEmployees = async () => {
    try {
      const response = await employeesAPI.list({ page_size: 1000 });
      setEmployees(response.results);
    } catch (err) {
      console.error('Failed to load employees:', err);
    }
  };

  const loadDepartmentRulesInfo = async (departmentId: number) => {
    try {
      setLoadingRules(true);
      const response =
        await ruleEngineAPI.getDepartmentRuleConfiguration(departmentId);
      setDepartmentRulesInfo(response);
    } catch (err) {
      console.error('Failed to load department rules:', err);
      setDepartmentRulesInfo(null);
    } finally {
      setLoadingRules(false);
    }
  };

  const applyRulesToNewEmployee = async (
    employeeId: number,
    departmentId: number
  ) => {
    try {
      const response = await ruleEngineAPI.applyDepartmentRulesToEmployee(
        employeeId,
        departmentId
      );
      return response;
    } catch (err: any) {
      console.error('Failed to apply department rules to employee:', err);
      throw err;
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.employee_id ||
      !formData.full_name ||
      !formData.username ||
      !formData.password
    ) {
      setError('Vui lòng điền đầy đủ thông tin bắt buộc');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const employeeData: EmployeeCreateData = {
        employee_id: formData.employee_id.trim(),
        full_name: formData.full_name.trim(),
        gender: formData.gender,
        username: formData.username.trim(),
        password: formData.password,
        employment_status: formData.employment_status,
        ...(formData.date_of_birth && {
          date_of_birth: formData.date_of_birth,
        }),
        ...(formData.phone_number && {
          phone_number: formData.phone_number.trim(),
        }),
        ...(formData.personal_email && {
          personal_email: formData.personal_email.trim(),
        }),
        ...(formData.email && { email: formData.email.trim() }),
        ...(formData.first_name && { first_name: formData.first_name.trim() }),
        ...(formData.last_name && { last_name: formData.last_name.trim() }),
        ...(formData.bank_name && { bank_name: formData.bank_name.trim() }),
        ...(formData.bank_account && {
          bank_account: formData.bank_account.trim(),
        }),
        ...(formData.start_date && { start_date: formData.start_date }),
        ...(formData.end_date && { end_date: formData.end_date }),
        ...(formData.position_id && {
          position_id: Number(formData.position_id),
        }),
        ...(formData.department_id && {
          department_id: Number(formData.department_id),
        }),
        ...(formData.manager_id && { manager_id: Number(formData.manager_id) }),
        is_hr: formData.is_hr,
      };

      const createdEmployee = await employeesAPI.create(employeeData);

      // Apply department rules to new employee if selected
      if (applyDepartmentRules && formData.department_id) {
        try {
          const rulesResult = await applyRulesToNewEmployee(
            createdEmployee.id,
            formData.department_id
          );
          setSuccess(
            `Tạo nhân viên thành công! Đã áp dụng ${rulesResult.applied_rules} quy tắc chấm công và ${rulesResult.applied_policies} chính sách nghỉ phép từ phòng ban.`
          );
        } catch (rulesErr: any) {
          console.error('Failed to apply department rules:', rulesErr);
          setSuccess(
            `Tạo nhân viên thành công! Lưu ý: Không thể áp dụng quy tắc chấm công tự động. Lỗi: ${rulesErr.message || 'Không xác định'}`
          );
        }
      } else {
        setSuccess('Tạo nhân viên thành công!');
      }

      setTimeout(() => {
        navigate('/dashboard/employees');
      }, 3000);
    } catch (err: any) {
      console.error('Failed to create employee:', err);
      setError(
        err.response?.data?.message || err.message || 'Lỗi khi tạo nhân viên'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/dashboard/employees')}
          className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 mb-4"
        >
          ← Quay lại
        </button>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900">
          Thêm nhân viên mới
        </h1>
        <p className="text-gray-600 mt-2 text-sm md:text-base">
          Tạo hồ sơ nhân viên mới
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-green-700">{success}</p>
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 md:p-6">
        <form onSubmit={handleSubmit} className="space-y-10">
          {/* ================= THÔNG TIN CÁ NHÂN ================= */}
          <div>
            <h3 className="text-base md:text-lg font-semibold mb-4">
              Thông tin cá nhân
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Mã nhân viên *
                </label>
                <input
                  name="employee_id"
                  value={formData.employee_id}
                  onChange={handleInputChange}
                  placeholder="NV001"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Họ tên *
                </label>
                <input
                  name="full_name"
                  value={formData.full_name}
                  placeholder="Nguyễn Văn A"
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>

              <SelectBox
                label="Giới tính"
                value={formData.gender}
                options={genderOptions}
                onChange={(val) => setFormData({ ...formData, gender: val })}
              />

              <div>
                <label className="block text-sm font-medium mb-1">
                  Ngày sinh
                </label>
                <input
                  type="date"
                  name="date_of_birth"
                  value={formData.date_of_birth}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Số điện thoại
                </label>
                <input
                  name="phone_number"
                  value={formData.phone_number}
                  placeholder="0123456789"
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Email cá nhân
                </label>
                <input
                  name="personal_email"
                  value={formData.personal_email}
                  placeholder="example@gmail.com"
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>
            </div>
          </div>

          {/* ================= TÀI KHOẢN ================= */}
          <div>
            <h3 className="text-base md:text-lg font-semibold mb-4">
              Thông tin tài khoản
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Tên đăng nhập *
                </label>
                <input
                  name="username"
                  value={formData.username}
                  placeholder="NV001"
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">
                  Mật khẩu *
                </label>

                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    placeholder="••••••••"
                    onChange={handleInputChange}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10
        focus:ring-2 focus:ring-blue-500 focus:outline-none
        "
                    required
                  />

                  {/* Icon chỉ hiện khi có text */}
                  {formData.password && (
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2
          text-gray-500 hover:text-gray-700"
                    >
                      {showPassword ? (
                        <EyeSlashIcon className="w-5 h-5" />
                      ) : (
                        <EyeIcon className="w-5 h-5" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  name="email"
                  value={formData.email}
                  placeholder="employee@company.com"
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <SelectBox
                label="Trạng thái làm việc"
                value={formData.employment_status}
                options={employmentOptions}
                onChange={(val) =>
                  setFormData({ ...formData, employment_status: val })
                }
              />
            </div>
          </div>

          {/* ================= THÔNG TIN CÔNG VIỆC ================= */}
          <div>
            <h3 className="text-base md:text-lg font-semibold mb-4">
              Thông tin công việc
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Ngày bắt đầu
                </label>
                <input
                  type="date"
                  name="start_date"
                  value={formData.start_date}
                  onChange={handleInputChange}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                />
              </div>

              <SelectBox
                label="Phòng ban"
                value={formData.department_id || ''}
                options={[
                  { value: '', label: 'Chọn phòng ban' },
                  ...departments.map((dept) => ({
                    value: dept.id,
                    label: dept.name,
                  })),
                ]}
                onChange={(val) =>
                  setFormData({ ...formData, department_id: val })
                }
              />

              <SelectBox
                label="Chức vụ"
                value={formData.position_id}
                options={[
                  { value: undefined, label: 'Chọn chức vụ' },
                  ...positions.map((p) => ({ value: p.id, label: p.title })),
                ]}
                onChange={(val) =>
                  setFormData({ ...formData, position_id: val })
                }
              />

              <SelectBox
                label="Quản lý trực tiếp"
                value={formData.manager_id}
                options={[
                  { value: undefined, label: 'Không có quản lý' },
                  ...employees
                    .filter(
                      (emp) =>
                        positions.find((p) => p.id === emp.position?.id)
                          ?.is_management === true
                    )
                    .map((emp) => ({
                      value: emp.id,
                      label: `${emp.full_name} (${emp.employee_id}) - ${emp.department?.name ?? 'Chưa có phòng ban'}`,
                    })),
                ]}
                onChange={(val) =>
                  setFormData({ ...formData, manager_id: val })
                }
              />

              {/* Apply rules */}
              <div className="col-span-1 md:col-span-2 border rounded-lg p-4 bg-gray-50">
                <p className="font-medium mb-2">
                  Áp dụng quy tắc chấm công của phòng ban
                </p>
                <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={applyDepartmentRules}
                      onChange={() => setApplyDepartmentRules(true)}
                    />
                    Có
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={!applyDepartmentRules}
                      onChange={() => setApplyDepartmentRules(false)}
                    />
                    Không
                  </label>
                </div>
              </div>

              {/* HR checkbox */}
              <div className="col-span-1 md:col-span-2 border rounded-lg p-4 bg-gray-50">
                <label className="flex gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={formData.is_hr}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        is_hr: e.target.checked,
                      }))
                    }
                  />
                  <div>
                    <p className="font-medium">Nhân viên HR</p>
                    <p className="text-xs text-gray-500">
                      Nhân viên HR có quyền duyệt đơn, truy cập vào các chức
                      năng quản lý nhân sự
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-6 border-t">
            <button
              type="button"
              onClick={() => navigate('/dashboard/employees')}
              className="w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-full sm:w-auto px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Đang tạo...' : 'Tạo nhân viên'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EmployeeCreate;

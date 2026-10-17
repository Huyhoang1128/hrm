import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeftIcon,
  UsersIcon,
  ExclamationCircleIcon,
  XMarkIcon,
  UserPlusIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import { positionsAPI, employeesAPI, Employee, Position } from '../utils/api';
import { SelectBox } from '../components/LandingLayout/SelectBox';

const PositionEmployees: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const positionId = id ? parseInt(id) : 0;

  const [position, setPosition] = useState<Position | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearchTerm, setAddSearchTerm] = useState('');
  const [addSearchResults, setAddSearchResults] = useState<Employee[]>([]);
  const [addSearchLoading, setAddSearchLoading] = useState(false);
  const [addSearchTimeout, setAddSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const addSearchRef = useRef<HTMLInputElement>(null);

  const fetchPosition = async () => {
    try {
      if (positionId) {
        const data = await positionsAPI.getById(positionId);
        setPosition(data);
      }
    } catch (err: any) {
      console.error('Error fetching position:', err);
    }
  };

  const fetchEmployees = async (search = '', status = 'all') => {
    try {
      setLoading(true);
      const params: any = { position: positionId, page_size: 1000 };
      if (search) params.search = search;
      if (status !== 'all') params.employment_status = status;
      const response = await employeesAPI.list(params);
      setEmployees(response.results || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách nhân viên');
      console.error('Error fetching employees:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (positionId) {
      fetchPosition();
      fetchEmployees();
    } else {
      setError('Không tìm thấy vị trí');
      setLoading(false);
    }
  }, [positionId]);

  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => fetchEmployees(searchTerm, statusFilter), 300);
    setSearchTimeout(timeout);
    return () => { if (searchTimeout) clearTimeout(searchTimeout); };
  }, [searchTerm, statusFilter]);

  const searchEmployeesForAdd = async (search: string) => {
    if (!search.trim()) { setAddSearchResults([]); return; }
    try {
      setAddSearchLoading(true);
      const response = await employeesAPI.list({ search });
      setAddSearchResults(response.results || []);
    } catch (err: any) {
      console.error('Error searching employees:', err);
    } finally {
      setAddSearchLoading(false);
    }
  };

  useEffect(() => {
    if (addSearchTimeout) clearTimeout(addSearchTimeout);
    const timeout = setTimeout(() => searchEmployeesForAdd(addSearchTerm), 300);
    setAddSearchTimeout(timeout);
    return () => clearTimeout(timeout);
  }, [addSearchTerm]);

  useEffect(() => {
    if (showAddModal && addSearchRef.current) addSearchRef.current.focus();
    if (!showAddModal) { setAddSearchTerm(''); setAddSearchResults([]); }
  }, [showAddModal]);

  const handleAssignEmployee = async (employee: Employee) => {
    try {
      setAssigningId(employee.id);
      await employeesAPI.partialUpdate(employee.id, { position_id: positionId });
      setShowAddModal(false);
      fetchEmployees();
    } catch (err: any) {
      alert('Gán nhân viên thất bại: ' + (err.message || 'Lỗi không xác định'));
    } finally {
      setAssigningId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; cls: string }> = {
      ACTIVE:    { label: 'Đang làm việc', cls: 'bg-emerald-100 text-emerald-700' },
      SUSPENDED: { label: 'Tạm dừng',      cls: 'bg-amber-100 text-amber-700' },
      INACTIVE:  { label: 'Đã nghỉ',       cls: 'bg-red-100 text-red-700' },
      PROBATION: { label: 'Thử việc',      cls: 'bg-amber-100 text-amber-700' },
    };
    const cfg = map[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
        {cfg.label}
      </span>
    );
  };

  const hasFilter = searchTerm !== '' || statusFilter !== 'all';
  const tableHeaders = ['Mã NV', 'Họ tên', 'Phòng ban', 'Trạng thái', 'Ngày bắt đầu', 'Thao tác'];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <button
          onClick={() => navigate('/dashboard/positions')}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Quay lại danh sách vị trí
        </button>
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              {position?.title || 'Đang tải...'}
            </h1>
            <p className="text-sm text-gray-900 mt-0.5">
              {position?.code && `Mã: ${position.code}`}
              {position?.department && position.department.length > 0 && ` • ${position.department.map((d) => d.name).join(', ')}`}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        {/* Filter */}
        <div className="mb-5 bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-gray-900">Tìm kiếm nhân viên</h3>
            {loading && (
              <div className="flex items-center text-xs text-gray-400 gap-1.5">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                Đang tìm kiếm...
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Tìm kiếm theo mã, tên, số điện thoại
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field"
                placeholder="Nhập mã NV, tên hoặc số điện thoại..."
              />
            </div>
            <div>
              <SelectBox<string>
                label="Trạng thái"
                value={statusFilter}
                options={[
                  { value: 'all', label: 'Tất cả trạng thái' },
                  { value: 'ACTIVE', label: 'Đang làm việc' },
                  { value: 'PROBATION', label: 'Thử việc' },
                  { value: 'INACTIVE', label: 'Đã nghỉ' },
                ]}
                onChange={setStatusFilter}
              />
            </div>
          </div>
          {hasFilter && (
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => { setSearchTerm(''); setStatusFilter('all'); }}
                className="btn-secondary"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          )}
        </div>

        {/* List header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Danh sách nhân viên</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tổng số: {employees.length} nhân viên</p>
          </div>
          <button
            className="btn-primary flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap"
            onClick={() => setShowAddModal(true)}
          >
            <UserPlusIcon className="w-4 h-4" />
            Thêm nhân viên
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
            <p className="mt-4 text-sm text-gray-500">Đang tải dữ liệu...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="h-12 w-12 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ExclamationCircleIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold text-gray-900">Đã xảy ra lỗi</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
            <button onClick={() => fetchEmployees()} className="btn-primary mt-4">
              Thử lại
            </button>
          </div>
        ) : (
          <div className="border border-gray-100 rounded-2xl overflow-x-auto">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {tableHeaders.map((h) => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {employees.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-12 w-12 bg-primary-100 text-primary-400 rounded-2xl flex items-center justify-center">
                            <UsersIcon className="h-6 w-6" />
                          </div>
                          <p className="text-sm font-bold text-gray-900">Chưa có nhân viên nào ở vị trí này</p>
                          <p className="text-xs text-gray-400">Thêm nhân viên bằng nút bên trên</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                        <td className="table-cell font-medium">{emp.employee_id}</td>
                        <td className="px-6 py-4 whitespace-nowrap sm:whitespace-normal">
                          <div className="text-sm font-medium text-gray-900">{emp.full_name}</div>
                          {emp.personal_email && (
                            <div className="text-xs text-gray-400">{emp.personal_email}</div>
                          )}
                        </td>
                        <td className="table-cell">{emp.department?.name || 'Chưa phân phòng ban'}</td>
                        <td className="table-cell">{getStatusBadge(emp.employment_status)}</td>
                        <td className="table-cell">
                          {emp.start_date ? new Date(emp.start_date).toLocaleDateString('vi-VN') : 'Chưa có'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <button
                            onClick={() => navigate(`/dashboard/employees/${emp.id}`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                          >
                            <EyeIcon className="w-3.5 h-3.5" />
                            Xem chi tiết
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal thêm nhân viên */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                  <UserPlusIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Thêm nhân viên vào vị trí</h2>
                  <p className="text-xs text-gray-400">{position?.title}</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-4 sm:px-6 py-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Tìm kiếm nhân viên theo mã hoặc tên
              </label>
              <div className="relative">
                <input
                  ref={addSearchRef}
                  type="text"
                  value={addSearchTerm}
                  onChange={(e) => setAddSearchTerm(e.target.value)}
                  className="input-field pr-8"
                  placeholder="Nhập mã NV hoặc họ tên..."
                />
                {addSearchLoading && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600" />
                  </div>
                )}
              </div>

              <div className="mt-3 max-h-72 overflow-y-auto border border-gray-100 rounded-xl">
                {addSearchTerm.trim() === '' ? (
                  <div className="px-4 py-8 text-center text-xs text-gray-400">
                    Nhập từ khóa để tìm kiếm nhân viên
                  </div>
                ) : addSearchResults.length === 0 && !addSearchLoading ? (
                  <div className="px-4 py-8 text-center text-xs text-gray-400">
                    Không tìm thấy nhân viên
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {addSearchResults.map((emp) => (
                      <li key={emp.id} className="flex flex-col gap-2 sm:gap-0 sm:flex-row sm:items-center sm:justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{emp.full_name}</div>
                          <div className="text-xs text-gray-400">
                            {emp.employee_id}
                            {emp.position?.title ? ` • ${emp.position.title}` : ''}
                            {emp.department?.name ? ` • ${emp.department.name}` : ''}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAssignEmployee(emp)}
                          disabled={assigningId === emp.id}
                          className="btn-primary self-start sm:self-auto sm:ml-4 whitespace-nowrap disabled:opacity-60"
                        >
                          {assigningId === emp.id ? 'Đang gán...' : 'Gán vào vị trí'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button onClick={() => setShowAddModal(false)} className="btn-secondary">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PositionEmployees;

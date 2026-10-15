import React, { useState, useEffect } from 'react';
import { companyUnitsAPI, CompanyUnit } from '../utils/api';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import FeedbackDialog, { FeedbackVariant } from '../components/FeedbackDialog';
import ConfirmDialog, { ConfirmVariant } from '../components/ConfirmDialog';

const CompanyUnitList: React.FC = () => {
  const [units, setUnits] = useState<CompanyUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters and search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  // Modal states for CRUD
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [editingUnit, setEditingUnit] = useState<CompanyUnit | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    prefix_code: '',
    description: '',
    is_active: true,
  });

  // Dialogs states
  const [feedback, setFeedback] = useState<{
    open: boolean;
    variant: FeedbackVariant;
    title: string;
    message: string;
  }>({
    open: false,
    variant: 'info',
    title: '',
    message: '',
  });

  const [confirm, setConfirm] = useState<{
    open: boolean;
    variant: ConfirmVariant;
    title: string;
    message: string;
    loading: boolean;
    onConfirm: () => void | Promise<void>;
  }>({
    open: false,
    variant: 'danger',
    title: '',
    message: '',
    loading: false,
    onConfirm: () => {},
  });

  const showFeedback = (variant: FeedbackVariant, title: string, message = '') => {
    setFeedback({ open: true, variant, title, message });
  };

  const fetchUnits = async (search = '', status = 'all') => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      if (status === 'active') params.active_only = true;
      if (status === 'inactive') params.active_only = false;

      const response = await companyUnitsAPI.list(params);
      setUnits(response.results || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách đơn vị làm việc');
      console.error('Error fetching company units:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnits();
  }, []);

  // Debounced Search Effect
  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => {
      fetchUnits(searchTerm, statusFilter);
    }, 300);
    setSearchTimeout(timeout);
    return () => {
      if (searchTimeout) clearTimeout(searchTimeout);
    };
  }, [searchTerm, statusFilter]);

  const handleReset = () => {
    setSearchTerm('');
    setStatusFilter('all');
  };

  // Open Modal for Adding
  const openAddModal = () => {
    setEditingUnit(null);
    setFormData({
      name: '',
      code: '',
      prefix_code: '',
      description: '',
      is_active: true,
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  // Open Modal for Editing
  const openEditModal = (unit: CompanyUnit) => {
    setEditingUnit(unit);
    setFormData({
      name: unit.name || '',
      code: unit.code || '',
      prefix_code: unit.prefix_code || '',
      description: unit.description || '',
      is_active: unit.is_active !== undefined ? unit.is_active : true,
    });
    setModalError(null);
    setIsModalOpen(true);
  };

  // Handle Submit Add / Edit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.code.trim() || !formData.prefix_code.trim()) {
      setModalError('Vui lòng nhập đầy đủ Tên, Mã định danh và Mã nhận diện.');
      return;
    }

    try {
      setModalLoading(true);
      setModalError(null);

      const payload = {
        name: formData.name.trim(),
        code: formData.code.trim().toUpperCase(),
        prefix_code: formData.prefix_code.trim().toUpperCase(),
        description: formData.description.trim(),
        is_active: formData.is_active,
      };

      if (editingUnit) {
        await companyUnitsAPI.update(editingUnit.id, payload);
        showFeedback('success', 'Lưu thành công', 'Đã cập nhật thông tin đơn vị làm việc.');
      } else {
        await companyUnitsAPI.create(payload);
        showFeedback('success', 'Lưu thành công', 'Đã thêm mới đơn vị làm việc thành công.');
      }

      setIsModalOpen(false);
      fetchUnits(searchTerm, statusFilter);
    } catch (err: any) {
      setModalError(err.message || 'Có lỗi xảy ra trong quá trình lưu thông tin.');
      console.error('Error saving company unit:', err);
    } finally {
      setModalLoading(false);
    }
  };

  // Inline toggle switch for Active Status (fully hydrated PUT)
  const toggleActiveStatus = async (unit: CompanyUnit) => {
    try {
      const nextStatus = !unit.is_active;
      await companyUnitsAPI.update(unit.id, {
        name: unit.name,
        code: unit.code,
        prefix_code: unit.prefix_code,
        description: unit.description,
        is_active: nextStatus,
      });

      setUnits(prevUnits =>
        prevUnits.map(u => (u.id === unit.id ? { ...u, is_active: nextStatus } : u))
      );

      showFeedback('success', 'Cập nhật trạng thái', `Đã chuyển trạng thái đơn vị sang ${nextStatus ? 'Hoạt động' : 'Ngừng hoạt động'}.`);
    } catch (err: any) {
      showFeedback('error', 'Thay đổi trạng thái thất bại', err.message || 'Đã có lỗi mạng xảy ra.');
    }
  };

  const handleDelete = (unit: CompanyUnit) => {
    setConfirm({
      open: true,
      variant: 'danger',
      title: 'Xác nhận xóa đơn vị',
      message: `Bạn có chắc chắn muốn xóa đơn vị làm việc "${unit.name}"? Thao tác này không thể hoàn tác.`,
      loading: false,
      onConfirm: async () => {
        try {
          setConfirm(prev => ({ ...prev, loading: true }));
          await companyUnitsAPI.delete(unit.id);
          setConfirm(prev => ({ ...prev, open: false, loading: false }));
          showFeedback('success', 'Xóa thành công', 'Đơn vị làm việc đã được loại bỏ khỏi hệ thống.');
          fetchUnits(searchTerm, statusFilter);
        } catch (err: any) {
          setConfirm(prev => ({ ...prev, open: false, loading: false }));
          showFeedback('error', 'Xóa thất bại', err.message || 'Lỗi không xác định trong quá trình xóa.');
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý Đơn vị làm việc</h1>
        <p className="text-sm text-gray-900 mt-1">
          Quản lý danh sách các công ty thành viên, chi nhánh, cấu hình mã định danh và mã nhận diện sinh nhân viên.
        </p>
      </div>

      {/* Main Card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">

        {/* Filter Bar */}
        <div className="mb-6 bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-sm font-bold text-gray-900">Tìm kiếm đơn vị</h3>
            {loading && (
              <div className="flex items-center text-xs text-gray-400">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600 mr-2"></div>
                Đang tìm kiếm...
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Từ khóa tìm kiếm
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input-field w-full"
                  placeholder="Nhập tên đơn vị, mã hoặc tiền tố..."
                />
              </div>

              <div>
                <SelectBox<'all' | 'active' | 'inactive'>
                  label="Trạng thái hoạt động"
                  value={statusFilter}
                  onChange={(val) => setStatusFilter(val)}
                  options={[
                    { value: 'all', label: 'Tất cả trạng thái' },
                    { value: 'active', label: 'Đang hoạt động' },
                    { value: 'inactive', label: 'Ngừng hoạt động' },
                  ]}
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="btn-secondary"
              >
                Đặt lại bộ lọc
              </button>
            </div>
          </div>
        </div>

        {/* Table Actions Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Danh sách Đơn vị</h2>
            <p className="text-xs text-gray-900 mt-0.5">Tổng số: {units.length} đơn vị</p>
          </div>
          <button
            className="btn-primary"
            onClick={openAddModal}
          >
            + Thêm đơn vị làm việc
          </button>
        </div>

        {/* Main Data View */}
        {loading && units.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-sm text-gray-500">Đang tải dữ liệu...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="text-red-500 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm font-bold text-gray-900">Đã xảy ra lỗi</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
            <button
              onClick={() => fetchUnits()}
              className="btn-primary mt-4"
            >
              Thử lại
            </button>
          </div>
        ) : units.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Mã định danh</th>
                  <th className="table-header">Mã nhận diện</th>
                  <th className="table-header">Tên Đơn vị</th>
                  <th className="table-header">Thao tác</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <div className="h-12 w-12 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <p className="text-sm font-bold text-gray-900">Chưa có đơn vị làm việc nào</p>
                      <p className="text-xs text-gray-400 mt-1">Nhấn "+ Thêm đơn vị làm việc" để bắt đầu</p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Mã định danh</th>
                  <th className="table-header">Mã nhận diện</th>
                  <th className="table-header">Tên Đơn vị</th>
                  <th className="table-header">Mô tả</th>
                  <th className="table-header">Trạng thái</th>
                  <th className="table-header">Thao tác</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {units.map((unit) => (
                  <tr key={unit.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-primary-50 text-primary-700 text-xs font-semibold border border-primary-100">
                        {unit.code}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold">
                        {unit.prefix_code || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="table-cell font-medium">{unit.name}</div>
                    </td>
                    <td className="px-6 py-4 max-w-xs truncate">
                      <div className="text-xs text-gray-400 truncate" title={unit.description}>
                        {unit.description || '—'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => toggleActiveStatus(unit)}
                        className={`${
                          unit.is_active ? 'bg-emerald-500' : 'bg-gray-200'
                        } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                        role="switch"
                        aria-checked={unit.is_active}
                      >
                        <span
                          aria-hidden="true"
                          className={`${
                            unit.is_active ? 'translate-x-5' : 'translate-x-0'
                          } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                        />
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEditModal(unit)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
                          title="Sửa"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Sửa
                        </button>
                        <button
                          onClick={() => handleDelete(unit)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors"
                          title="Xóa"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal for Adding & Editing */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div
              className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
              onClick={() => !modalLoading && setIsModalOpen(false)}
            ></div>

            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

            <div className="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleSubmit}>

                {/* Modal Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-gray-900">
                    {editingUnit ? 'Chỉnh sửa đơn vị làm việc' : 'Thêm đơn vị làm việc mới'}
                  </h3>
                  <button
                    type="button"
                    disabled={modalLoading}
                    className="text-gray-400 hover:text-gray-600 transition disabled:opacity-50"
                    onClick={() => setIsModalOpen(false)}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Modal Body */}
                <div className="px-6 pt-5 pb-4 sm:pb-6 space-y-4">
                  {modalError && (
                    <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-medium">
                      {modalError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tên Đơn vị <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="input-field w-full"
                        placeholder="Ví dụ: Công ty TNHH ABC"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Mã định danh <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={formData.code}
                          onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                          className="input-field w-full uppercase"
                          placeholder="Ví dụ: ABC"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Mã nhận diện <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          maxLength={5}
                          value={formData.prefix_code}
                          onChange={(e) => setFormData({ ...formData, prefix_code: e.target.value })}
                          className="input-field w-full uppercase"
                          placeholder="Ví dụ: AC"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Mô tả
                      </label>
                      <textarea
                        rows={3}
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        className="input-field w-full resize-none"
                        placeholder="Nhập mô tả ngắn..."
                      />
                    </div>

                    <div className="flex items-center pt-2">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, is_active: !formData.is_active })}
                        className={`${
                          formData.is_active ? 'bg-emerald-500' : 'bg-gray-200'
                        } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none`}
                        role="switch"
                      >
                        <span
                          className={`${
                            formData.is_active ? 'translate-x-5' : 'translate-x-0'
                          } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                        />
                      </button>
                      <span className="ml-3 text-sm font-medium text-gray-700">Cho phép hoạt động</span>
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex flex-row-reverse gap-3">
                  <button
                    type="submit"
                    disabled={modalLoading}
                    className="btn-primary disabled:opacity-60"
                  >
                    {modalLoading ? 'Đang lưu...' : 'Lưu cấu hình'}
                  </button>
                  <button
                    type="button"
                    disabled={modalLoading}
                    className="btn-secondary"
                    onClick={() => setIsModalOpen(false)}
                  >
                    Hủy
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Custom Dialogs for polished UI/UX feedback */}
      <FeedbackDialog
        open={feedback.open}
        variant={feedback.variant}
        title={feedback.title}
        message={feedback.message}
        onClose={() => setFeedback(prev => ({ ...prev, open: false }))}
      />

      <ConfirmDialog
        open={confirm.open}
        variant={confirm.variant}
        title={confirm.title}
        message={confirm.message}
        loading={confirm.loading}
        onConfirm={confirm.onConfirm}
        onClose={() => !confirm.loading && setConfirm(prev => ({ ...prev, open: false }))}
      />
    </div>
  );
};

export default CompanyUnitList;

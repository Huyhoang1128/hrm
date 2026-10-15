import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RectangleGroupIcon,
  PencilSquareIcon,
  TrashIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { sectionsAPI, departmentsAPI, Department } from '../utils/api';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import ConfirmDialog from '../components/ConfirmDialog';

const SectionList: React.FC = () => {
  const navigate = useNavigate();
  const [sections, setSections] = useState<Department[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('');
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSections = async (search = '', departmentId = '') => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      if (departmentId) params.parent_department = Number(departmentId);
      const response = await sectionsAPI.list(params);
      setSections(response.results || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách bộ phận');
      console.error('Error fetching sections:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await departmentsAPI.list();
      setDepartments(response.results || []);
    } catch (err) {
      console.error('Error fetching departments:', err);
    }
  };

  useEffect(() => {
    fetchSections();
    fetchDepartments();
  }, []);

  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => fetchSections(searchTerm, departmentFilter), 300);
    setSearchTimeout(timeout);
    return () => { if (searchTimeout) clearTimeout(searchTimeout); };
  }, [searchTerm, departmentFilter]);

  const handleDeleteConfirm = async () => {
    if (!sectionToDelete) return;
    try {
      setDeleting(true);
      await sectionsAPI.delete(sectionToDelete.id);
      setSectionToDelete(null);
      fetchSections(searchTerm, departmentFilter);
    } catch (err: any) {
      alert('Xóa thất bại: ' + (err.message || 'Lỗi không xác định'));
      setSectionToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const getParentName = (parentId?: number | null) => {
    if (!parentId) return '—';
    const parent = departments.find((d) => d.id === parentId);
    return parent ? parent.name : `ID: ${parentId}`;
  };

  const tableHeaders = ['Mã bộ phận', 'Tên bộ phận', 'Phòng ban', 'Mô tả', 'Thao tác'];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý bộ phận</h1>
          <p className="text-sm text-gray-900 mt-0.5">Quản lý các bộ phận trực thuộc phòng ban trong tổ chức.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        {/* Filter */}
        <div className="mb-5 bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-gray-900">Tìm kiếm bộ phận</h3>
            {loading && (
              <div className="flex items-center text-xs text-gray-400 gap-1.5">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                Đang tìm kiếm...
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Tìm kiếm theo tên, mã bộ phận
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field"
                placeholder="Nhập tên hoặc mã bộ phận..."
              />
            </div>
            <div>
              <SelectBox<string>
                label="Phòng ban"
                value={departmentFilter}
                placeholder="Tất cả phòng ban"
                searchable
                options={[
                  { value: '', label: 'Tất cả phòng ban' },
                  ...departments.map((dept) => ({
                    value: String(dept.id),
                    label: dept.name,
                  })),
                ]}
                onChange={(val) => setDepartmentFilter(val)}
              />
            </div>
          </div>
        </div>

        {/* List header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Danh sách bộ phận</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tổng số: {sections.length} bộ phận</p>
          </div>
          <button
            className="btn-primary"
            onClick={() => navigate('/dashboard/sections/create')}
          >
            + Thêm bộ phận
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-sm text-gray-500">Đang tải dữ liệu...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <div className="h-12 w-12 bg-red-100 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ExclamationCircleIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold text-gray-900">Đã xảy ra lỗi</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
            <button onClick={() => fetchSections()} className="btn-primary mt-4">
              Thử lại
            </button>
          </div>
        ) : (
          <div className="border border-gray-100 rounded-2xl overflow-hidden overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {tableHeaders.map((h) => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {sections.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-12 w-12 bg-primary-100 text-primary-400 rounded-2xl flex items-center justify-center">
                          <RectangleGroupIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-bold text-gray-900">Chưa có bộ phận nào</p>
                        <p className="text-xs text-gray-400">Bắt đầu bằng cách thêm bộ phận mới</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sections.map((section) => (
                    <tr key={section.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-medium">{section.code}</td>
                      <td className="table-cell font-medium">{section.name}</td>
                      <td className="table-cell">{getParentName(section.parent_department)}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-800 max-w-xs truncate">
                          {section.description || 'Không có mô tả'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => navigate(`/dashboard/sections/${section.id}/edit`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                          >
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                            Sửa
                          </button>
                          <button
                            onClick={() => setSectionToDelete(section)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <TrashIcon className="w-3.5 h-3.5" />
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={sectionToDelete !== null}
        variant="danger"
        title="Xóa bộ phận"
        message={sectionToDelete ? `Bạn có chắc chắn muốn xóa bộ phận "${sectionToDelete.name}" (${sectionToDelete.code})?` : ''}
        confirmLabel="Xóa"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setSectionToDelete(null)}
      />
    </div>
  );
};

export default SectionList;

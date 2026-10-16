import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BuildingOfficeIcon,
  EyeIcon,
  PencilSquareIcon,
  UsersIcon,
  TrashIcon,
  ExclamationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { departmentsAPI, Department } from '../utils/api';
import ConfirmDialog from '../components/ConfirmDialog';
import ImportFileDialog from '../components/ImportFileDialog';

// ── Dialog xem chi tiết phòng ban ──
const DepartmentDetailDialog: React.FC<{
  department: Department | null;
  getParentName: (id?: number | null) => string;
  onClose: () => void;
  onEdit: (dept: Department) => void;
}> = ({ department, getParentName, onClose, onEdit }) => {
  if (!department) return null;

  const InfoRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
    <div className="flex items-baseline justify-between py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 shrink-0 mr-3">{label}</span>
      <span className={`text-sm text-right ${value ? 'font-medium text-gray-800' : 'text-gray-300 italic'}`}>
        {value || 'Chưa có'}
      </span>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <BuildingOfficeIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900">{department.name}</h2>
              <p className="text-xs text-gray-400">{department.code}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <InfoRow label="Mã phòng ban" value={department.code} />
          <InfoRow label="Tên phòng ban" value={department.name} />
          <InfoRow label="Phòng ban cha" value={getParentName(department.parent_department)} />
          <InfoRow label="Quản lý" value={department.manager_name || null} />
          <InfoRow label="Mô tả" value={department.description || null} />
          <InfoRow
            label="Loại"
            value={department.is_section ? 'Bộ phận (Section)' : 'Phòng ban'}
          />
          <InfoRow
            label="Ngày tạo"
            value={department.created_at ? new Date(department.created_at).toLocaleDateString('vi-VN') : null}
          />
          <InfoRow
            label="Cập nhật lần cuối"
            value={department.updated_at ? new Date(department.updated_at).toLocaleDateString('vi-VN') : null}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary">
            Đóng
          </button>
          <button
            onClick={() => { onClose(); onEdit(department); }}
            className="btn-primary flex items-center gap-1.5"
          >
            <PencilSquareIcon className="w-4 h-4" />
            Chỉnh sửa
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main component ──
const DepartmentList: React.FC = () => {
  const navigate = useNavigate();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [departmentToDelete, setDepartmentToDelete] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewDepartment, setViewDepartment] = useState<Department | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);

  const fetchDepartments = async (search = '') => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      const response = await departmentsAPI.list(params);
      setDepartments(response.results || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách phòng ban');
      console.error('Error fetching departments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, []);

  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => fetchDepartments(searchTerm), 300);
    setSearchTimeout(timeout);
    return () => { if (searchTimeout) clearTimeout(searchTimeout); };
  }, [searchTerm]);

  const handleDeleteConfirm = async () => {
    if (!departmentToDelete) return;
    try {
      setDeleting(true);
      await departmentsAPI.delete(departmentToDelete.id);
      setDepartmentToDelete(null);
      fetchDepartments();
    } catch (err: any) {
      alert('Xóa thất bại: ' + (err.message || 'Lỗi không xác định'));
      setDepartmentToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const getParentDepartmentName = (parentId?: number | null) => {
    if (!parentId) return 'Không có';
    const parent = departments.find(dept => dept.id === parentId);
    return parent ? parent.name : `ID: ${parentId}`;
  };

  const handleDownloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template phòng ban');

    sheet.columns = [
      { header: 'Mã phòng ban', key: 'code', width: 16 },
      { header: 'Tên phòng ban', key: 'name', width: 28 },
      { header: 'Phòng ban cha (mã)', key: 'parent', width: 20 },
      { header: 'Trưởng phòng (mã NV)', key: 'manager', width: 20 },
      { header: 'Mô tả', key: 'description', width: 32 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    headerRow.height = 26;

    sheet.addRow({ code: 'PB01', name: 'Phòng Nhân sự', parent: '', manager: '', description: 'Quản lý nhân sự, tuyển dụng' });
    sheet.addRow({ code: 'PB02', name: 'Bộ phận Tuyển dụng', parent: 'PB01', manager: '', description: '' });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-import-phong-ban.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const tableHeaders = ['Mã phòng ban', 'Tên phòng ban', 'Phòng ban cha', 'Mô tả', 'Thao tác'];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý phòng ban</h1>
          <p className="text-sm text-gray-900 mt-0.5">Quản lý thông tin phòng ban, cấu trúc tổ chức và phân cấp.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        {/* Search */}
        <div className="mb-5 bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-gray-900">Tìm kiếm phòng ban</h3>
            {loading && (
              <div className="flex items-center text-xs text-gray-400 gap-1.5">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                Đang tìm kiếm...
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Tìm kiếm theo tên, mã phòng ban
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field"
              placeholder="Nhập tên hoặc mã phòng ban..."
            />
          </div>
        </div>

        {/* List header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Danh sách phòng ban</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tổng số: {departments.length} phòng ban</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="bg-amber-500 text-white px-4 py-2 rounded-xl hover:bg-amber-600 transition-colors flex items-center"
              onClick={() => setShowImportDialog(true)}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Nhập từ file
            </button>
            <button
              className="btn-primary"
              onClick={() => navigate('/dashboard/departments/create')}
            >
              + Thêm phòng ban
            </button>
          </div>
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
            <button onClick={() => fetchDepartments()} className="btn-primary mt-4">
              Thử lại
            </button>
          </div>
        ) : (
          <div className="border border-gray-100 rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[900px] divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {tableHeaders.map((h) => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {departments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-12 w-12 bg-primary-100 text-primary-400 rounded-2xl flex items-center justify-center">
                          <BuildingOfficeIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-bold text-gray-900">Chưa có phòng ban nào</p>
                        <p className="text-xs text-gray-400">Bắt đầu bằng cách thêm phòng ban mới</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  departments.map((department) => (
                    <tr key={department.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-medium">{department.code}</td>
                      <td className="table-cell font-medium">{department.name}</td>
                      <td className="table-cell">{getParentDepartmentName(department.parent_department)}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-800 max-w-xs truncate">
                          {department.description || 'Không có mô tả'}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setViewDepartment(department)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                          >
                            <EyeIcon className="w-3.5 h-3.5" />
                            Xem
                          </button>
                          <button
                            onClick={() => navigate(`/dashboard/departments/${department.id}/edit`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                          >
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                            Sửa
                          </button>
                          <button
                            onClick={() => navigate(`/dashboard/departments/${department.id}/employees`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-600 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                          >
                            <UsersIcon className="w-3.5 h-3.5" />
                            Nhân viên
                          </button>
                          <button
                            onClick={() => setDepartmentToDelete(department)}
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

      {/* Dialog xem chi tiết */}
      <DepartmentDetailDialog
        department={viewDepartment}
        getParentName={getParentDepartmentName}
        onClose={() => setViewDepartment(null)}
        onEdit={(dept) => navigate(`/dashboard/departments/${dept.id}/edit`)}
      />

      <ConfirmDialog
        open={departmentToDelete !== null}
        variant="danger"
        title="Xóa phòng ban"
        message={departmentToDelete ? `Bạn có chắc chắn muốn xóa phòng ban "${departmentToDelete.name}" (${departmentToDelete.code})?` : ''}
        confirmLabel="Xóa"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setDepartmentToDelete(null)}
      />

      <ImportFileDialog
        open={showImportDialog}
        title="Nhập danh sách phòng ban từ file"
        helperText="Mã phòng ban là bắt buộc và dùng để nhận diện — phòng ban đã tồn tại sẽ được cập nhật, chưa có sẽ được tạo mới."
        onDownloadTemplate={handleDownloadTemplate}
        onImport={(file) => departmentsAPI.importFile(file)}
        onImported={() => fetchDepartments(searchTerm)}
        onClose={() => setShowImportDialog(false)}
      />
    </div>
  );
};

export default DepartmentList;

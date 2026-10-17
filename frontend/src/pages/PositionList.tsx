import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BriefcaseIcon,
  EyeIcon,
  PencilSquareIcon,
  UsersIcon,
  TrashIcon,
  ExclamationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { positionsAPI, departmentsAPI, Position, Department } from '../utils/api';
import { SelectBox } from '../components/LandingLayout/SelectBox';
import ConfirmDialog from '../components/ConfirmDialog';
import ImportFileDialog from '../components/ImportFileDialog';

// ── Dialog xem chi tiết vị trí (không có trang chi tiết riêng — giống Phòng ban) ──
const PositionDetailDialog: React.FC<{
  position: Position | null;
  getDepartmentName: (depts?: Position['department']) => string;
  getParentName: (id?: number | null) => string | null;
  onClose: () => void;
  onEdit: (position: Position) => void;
}> = ({ position, getDepartmentName, getParentName, onClose, onEdit }) => {
  if (!position) return null;

  const InfoRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
    <div className="flex items-baseline justify-between py-2.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-400 shrink-0 mr-3">{label}</span>
      <span className={`text-sm text-right break-words ${value ? 'font-medium text-gray-800' : 'text-gray-300 italic'}`}>
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
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <BriefcaseIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900 break-words">{position.title}</h2>
              <p className="text-xs text-gray-400">{position.code}</p>
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
        <div className="px-4 sm:px-6 py-4">
          <InfoRow label="Mã vị trí" value={position.code} />
          <InfoRow label="Tên vị trí" value={position.title} />
          <InfoRow label="Phòng ban" value={position.department?.length ? getDepartmentName(position.department) : null} />
          <InfoRow label="Cấp bậc" value={`Cấp ${position.level}`} />
          <InfoRow label="Vị trí cha" value={getParentName(position.parent_position)} />
          <InfoRow label="Loại" value={position.is_management ? 'Quản lý' : 'Nhân viên'} />
          <InfoRow label="Mô tả" value={position.description || null} />
          <InfoRow
            label="Ngày tạo"
            value={position.created_at ? new Date(position.created_at).toLocaleDateString('vi-VN') : null}
          />
          <InfoRow
            label="Cập nhật lần cuối"
            value={position.updated_at ? new Date(position.updated_at).toLocaleDateString('vi-VN') : null}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="btn-secondary">
            Đóng
          </button>
          <button
            onClick={() => { onClose(); onEdit(position); }}
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

const PositionList: React.FC = () => {
  const navigate = useNavigate();
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [isManagementFilter, setIsManagementFilter] = useState<string>('all');
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);
  const [positionToDelete, setPositionToDelete] = useState<Position | null>(null);
  const [viewPosition, setViewPosition] = useState<Position | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchPositions = async (search = '', department = 'all', isManagement = 'all') => {
    try {
      setLoading(true);
      const params: any = {};
      if (search) params.search = search;
      if (department !== 'all') params.department = department;
      if (isManagement !== 'all') params.is_management = isManagement === 'true';
      const response = await positionsAPI.list(params);
      setPositions(response.results || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Không thể tải danh sách vị trí');
      console.error('Error fetching positions:', err);
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
    fetchPositions();
    fetchDepartments();
  }, []);

  useEffect(() => {
    if (searchTimeout) clearTimeout(searchTimeout);
    const timeout = setTimeout(() => fetchPositions(searchTerm, departmentFilter, isManagementFilter), 300);
    setSearchTimeout(timeout);
    return () => { if (searchTimeout) clearTimeout(searchTimeout); };
  }, [searchTerm, departmentFilter, isManagementFilter]);

  const handleDeleteConfirm = async () => {
    if (!positionToDelete) return;
    try {
      setDeleting(true);
      await positionsAPI.delete(positionToDelete.id);
      setPositionToDelete(null);
      fetchPositions(searchTerm, departmentFilter, isManagementFilter);
    } catch (err: any) {
      alert('Xóa thất bại: ' + (err.message || 'Lỗi không xác định'));
      setPositionToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const getDepartmentName = (depts?: Array<{ id: number; name: string; code: string }>) => {
    if (!depts || depts.length === 0) return 'Không có';
    return depts.map((d) => d.name).join(', ');
  };

  const getManagementBadge = (isManagement: boolean) =>
    isManagement ? (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
        Quản lý
      </span>
    ) : (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
        Nhân viên
      </span>
    );

  const handleDownloadTemplate = async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template vị trí');

    sheet.columns = [
      { header: 'Mã vị trí', key: 'code', width: 16 },
      { header: 'Chức danh', key: 'title', width: 28 },
      { header: 'Phòng ban (mã, cách nhau bởi dấu phẩy)', key: 'department', width: 32 },
      { header: 'Cấp bậc', key: 'level', width: 12 },
      { header: 'Vị trí quản lý (x = có)', key: 'is_management', width: 20 },
      { header: 'Vị trí cấp trên (mã)', key: 'parent', width: 18 },
      { header: 'Mô tả', key: 'description', width: 32 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    headerRow.height = 26;

    sheet.addRow({ code: 'VT01', title: 'Trưởng phòng Nhân sự', department: 'PB01', level: 3, is_management: 'x', parent: '', description: '' });
    sheet.addRow({ code: 'VT02', title: 'Chuyên viên Tuyển dụng', department: 'PB01, PB02', level: 1, is_management: '', parent: 'VT01', description: '' });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-import-vi-tri.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const tableHeaders = ['Mã vị trí', 'Chức danh', 'Phòng ban', 'Cấp bậc', 'Loại', 'Thao tác'];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý vị trí công việc</h1>
          <p className="text-sm text-gray-900 mt-0.5">Quản lý thông tin vị trí công việc, chức danh và cấp bậc trong tổ chức.</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 sm:p-5">
        {/* Filter */}
        <div className="mb-5 bg-gray-50 p-4 rounded-2xl border border-gray-100">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-bold text-gray-900">Tìm kiếm vị trí</h3>
            {loading && (
              <div className="flex items-center text-xs text-gray-400 gap-1.5">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                Đang tìm kiếm...
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Tìm kiếm theo tên, mã vị trí
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field"
                placeholder="Nhập tên hoặc mã vị trí..."
              />
            </div>
            <div>
              <SelectBox<string>
                label="Phòng ban"
                value={departmentFilter}
                options={[
                  { value: 'all', label: 'Tất cả phòng ban' },
                  ...departments.map((dept) => ({
                    value: String(dept.id),
                    label: dept.name,
                  })),
                ]}
                onChange={setDepartmentFilter}
                searchable
              />
            </div>
            <div>
              <SelectBox<string>
                label="Loại vị trí"
                value={isManagementFilter}
                options={[
                  { value: 'all', label: 'Tất cả loại' },
                  { value: 'true', label: 'Vị trí quản lý' },
                  { value: 'false', label: 'Vị trí nhân viên' },
                ]}
                onChange={setIsManagementFilter}
              />
            </div>
          </div>
        </div>

        {/* List header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Danh sách vị trí</h2>
            <p className="text-xs text-gray-400 mt-0.5">Tổng số: {positions.length} vị trí</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="bg-amber-500 text-white px-4 py-2 rounded-xl hover:bg-amber-600 transition-colors flex items-center whitespace-nowrap"
              onClick={() => setShowImportDialog(true)}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Nhập từ file
            </button>
            <button
              className="btn-primary whitespace-nowrap"
              onClick={() => navigate('/dashboard/positions/create')}
            >
              + Thêm vị trí
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
            <button onClick={() => fetchPositions()} className="btn-primary mt-4">
              Thử lại
            </button>
          </div>
        ) : (
          <div className="border border-gray-100 rounded-2xl overflow-x-auto">
            <table className="w-full min-w-[1200px] divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  {tableHeaders.map((h) => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {positions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-12 w-12 bg-primary-100 text-primary-400 rounded-2xl flex items-center justify-center">
                          <BriefcaseIcon className="h-6 w-6" />
                        </div>
                        <p className="text-sm font-bold text-gray-900">Chưa có vị trí nào</p>
                        <p className="text-xs text-gray-400">Bắt đầu bằng cách thêm vị trí mới</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  positions.map((position) => (
                    <tr key={position.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-medium">{position.code}</td>
                      <td className="px-6 py-4 whitespace-nowrap sm:whitespace-normal">
                        <div className="text-sm font-medium text-gray-900">{position.title}</div>
                        <div className="text-xs text-gray-400 max-w-xs truncate">
                          {position.description || 'Không có mô tả'}
                        </div>
                      </td>
                      <td className="table-cell">{getDepartmentName(position.department)}</td>
                      <td className="table-cell">Cấp {position.level}</td>
                      <td className="table-cell">{getManagementBadge(position.is_management)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setViewPosition(position)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                          >
                            <EyeIcon className="w-3.5 h-3.5" />
                            Xem
                          </button>
                          <button
                            onClick={() => navigate(`/dashboard/positions/${position.id}/edit`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-primary-600 bg-white border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                          >
                            <PencilSquareIcon className="w-3.5 h-3.5" />
                            Sửa
                          </button>
                          <button
                            onClick={() => navigate(`/dashboard/positions/${position.id}/employees`)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-600 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors"
                          >
                            <UsersIcon className="w-3.5 h-3.5" />
                            Nhân viên
                          </button>
                          <button
                            onClick={() => setPositionToDelete(position)}
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
      <PositionDetailDialog
        position={viewPosition}
        getDepartmentName={getDepartmentName}
        getParentName={(id) => {
          if (!id) return null;
          const parent = positions.find((p) => p.id === id);
          return parent ? `${parent.title} (${parent.code})` : `#${id}`;
        }}
        onClose={() => setViewPosition(null)}
        onEdit={(pos) => navigate(`/dashboard/positions/${pos.id}/edit`)}
      />

      <ConfirmDialog
        open={positionToDelete !== null}
        variant="danger"
        title="Xóa vị trí"
        message={positionToDelete ? `Bạn có chắc chắn muốn xóa vị trí "${positionToDelete.title}" (${positionToDelete.code})?` : ''}
        confirmLabel="Xóa"
        loading={deleting}
        onConfirm={handleDeleteConfirm}
        onClose={() => setPositionToDelete(null)}
      />

      <ImportFileDialog
        open={showImportDialog}
        title="Nhập danh sách vị trí từ file"
        helperText="Mã vị trí là bắt buộc và dùng để nhận diện — vị trí đã tồn tại sẽ được cập nhật, chưa có sẽ được tạo mới. Phòng ban ghi bằng mã, nhiều mã cách nhau bởi dấu phẩy."
        onDownloadTemplate={handleDownloadTemplate}
        onImport={(file) => positionsAPI.importFile(file)}
        onImported={() => fetchPositions(searchTerm, departmentFilter, isManagementFilter)}
        onClose={() => setShowImportDialog(false)}
      />
    </div>
  );
};

export default PositionList;

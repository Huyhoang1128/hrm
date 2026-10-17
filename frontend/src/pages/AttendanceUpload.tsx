import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { attendanceService } from '../services/attendance.service';
import { departmentsAPI, employeesAPI } from '../utils/api';
import AttendanceCalendar from '../components/AttendanceCalendar';
import {
  EyeIcon,
  UserIcon,
  BuildingOfficeIcon,
  XMarkIcon,
  ArrowLeftIcon,
  DocumentArrowDownIcon,
  CloudArrowUpIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  ChevronRightIcon,
  DocumentTextIcon,
  InformationCircleIcon,
  ShieldCheckIcon,
  CheckBadgeIcon,
  HomeIcon,
} from '@heroicons/react/24/outline';

const cx = (...classes: (string | false | undefined | null)[]) =>
  classes.filter(Boolean).join(' ');

/* ─── Alert banner ─── */
const Alert = ({
  type,
  text,
  onClose,
}: {
  type: 'success' | 'error' | 'info';
  text: string;
  onClose: () => void;
}) => {
  const cfg = {
    success: {
      bg: 'bg-emerald-50 border-emerald-200',
      icon: <CheckCircleIcon className="w-5 h-5 text-emerald-500 shrink-0" />,
      text: 'text-emerald-800',
    },
    error: {
      bg: 'bg-red-50 border-red-200',
      icon: <ExclamationTriangleIcon className="w-5 h-5 text-red-500 shrink-0" />,
      text: 'text-red-800',
    },
    info: {
      bg: 'bg-primary-50 border-primary-200',
      icon: <InformationCircleIcon className="w-5 h-5 text-primary-500 shrink-0" />,
      text: 'text-primary-800',
    },
  }[type] ?? {
    bg: 'bg-gray-50 border-gray-200',
    icon: <InformationCircleIcon className="w-5 h-5 text-gray-500 shrink-0" />,
    text: 'text-gray-800',
  };

  return (
    <div className={cx('flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm', cfg.bg, cfg.text)}>
      {cfg.icon}
      <span className="flex-1">{text}</span>
      <button
        onClick={onClose}
        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

/* ─── Status badge ─── */
const StatusBadge = ({ status }: { status: 'success' | 'error' | 'processing' }) => {
  const configs = {
    success:    { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Thành công' },
    error:      { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Thất bại' },
    processing: { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Đang xử lý' },
  };
  const config = configs[status];
  return (
    <span className={cx('px-2 py-0.5 text-xs font-semibold rounded-full', config.bg, config.text)}>
      {config.label}
    </span>
  );
};

/* ─── Stat card ─── */
const StatCard = ({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: 'emerald' | 'amber' | 'red' | 'primary';
}) => {
  const themes = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber:   'bg-amber-50 text-amber-700 border-amber-100',
    red:     'bg-red-50 text-red-700 border-red-100',
    primary: 'bg-primary-50 text-primary-700 border-primary-100',
  };
  return (
    <div className={cx('p-4 rounded-2xl border', themes[color])}>
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-extrabold text-gray-900 tracking-tight">{value}</p>
    </div>
  );
};

const AttendanceUpload: React.FC = () => {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error' | 'info', text: string } | null>(null);
  const [uploadHistory, setUploadHistory] = useState<Array<{
    id: number;
    filename: string;
    uploadedAt: string;
    status: 'success' | 'error' | 'processing';
    records: number;
    user: string;
  }>>([]);
  const [showDetailView, setShowDetailView] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'department' | 'employee'>('department');
  const [mainViewDepartment, setMainViewDepartment] = useState<string>('');
  const [mainViewEmployee, setMainViewEmployee] = useState<string>('');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [departments, setDepartments] = useState<Array<{
    id: string;
    name: string;
    code: string;
    employeeCount: number;
  }>>([]);
  const [employees, setEmployees] = useState<Array<{
    id: string;
    code: string;
    name: string;
    department: string;
    department_id?: string;
  }>>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDepartments();
    fetchEmployees();
  }, []);

  const fetchDepartments = async () => {
    try {
      setLoadingDepartments(true);
      setError(null);
      const response = await departmentsAPI.list({ page_size: 100 });
      const departmentsData = response.results.map((dept: any) => ({
        id: dept.id.toString(),
        name: dept.name,
        code: dept.code,
        employeeCount: 0,
      }));
      setDepartments(departmentsData);
    } catch (err: any) {
      console.error('Error fetching departments:', err);
      setError('Không thể tải danh sách phòng ban. Vui lòng thử lại sau.');
    } finally {
      setLoadingDepartments(false);
    }
  };

  const fetchEmployees = async () => {
    try {
      setLoadingEmployees(true);
      setError(null);
      const response = await employeesAPI.list({ page_size: 100 });
      const employeesData = response.results.map((emp: any) => ({
        id: emp.id.toString(),
        code: emp.employee_id,
        name: emp.full_name,
        department: emp.department?.name || 'Không xác định',
        department_id: emp.department?.id?.toString(),
      }));
      setEmployees(employeesData);

      const departmentCounts: { [key: string]: number } = {};
      employeesData.forEach((emp: any) => {
        if (emp.department_id) {
          departmentCounts[emp.department_id] = (departmentCounts[emp.department_id] || 0) + 1;
        }
      });
      setDepartments(prev => prev.map(dept => ({
        ...dept,
        employeeCount: departmentCounts[dept.id] || 0,
      })));
    } catch (err: any) {
      console.error('Error fetching employees:', err);
      setError('Không thể tải danh sách nhân viên. Vui lòng thử lại sau.');
    } finally {
      setLoadingEmployees(false);
    }
  };

  const fetchEmployeesByDepartment = async (departmentId: string) => {
    try {
      setLoadingEmployees(true);
      const response = await departmentsAPI.employees(parseInt(departmentId), { page_size: 100 });
      const employeesData = response.results.map((emp: any) => ({
        id: emp.id.toString(),
        code: emp.employee_id,
        name: emp.full_name,
        department: emp.department?.name || 'Không xác định',
        department_id: emp.department?.id?.toString(),
      }));
      setEmployees(employeesData);
    } catch (err: any) {
      console.error('Error fetching employees by department:', err);
      setError('Không thể tải danh sách nhân viên theo phòng ban.');
    } finally {
      setLoadingEmployees(false);
    }
  };

  const handleDateClick = (date: Date) => {
    setSelectedDate(date);
  };

  const handleViewDetail = () => {
    setShowDetailView(true);
    if (mainViewEmployee) {
      setSelectedEmployee(mainViewEmployee);
      setViewMode('employee');
      const emp = employees.find(e => e.id === mainViewEmployee);
      if (emp) {
        const dept = departments.find(d => d.name === emp.department);
        if (dept) setSelectedDepartment(dept.id);
      }
    } else if (mainViewDepartment) {
      setSelectedDepartment(mainViewDepartment);
      setViewMode('employee');
      setSelectedEmployee('');
    } else {
      setViewMode('department');
      setSelectedDepartment('');
      setSelectedEmployee('');
    }
  };

  const handleBack = () => {
    setShowDetailView(false);
    setSelectedDate(null);
    setSelectedDepartment('');
    setSelectedEmployee('');
    setViewMode('department');
  };

  const handleSelectDepartment = (deptId: string) => {
    setSelectedDepartment(deptId);
    setViewMode('employee');
    setSelectedEmployee('');
    fetchEmployeesByDepartment(deptId);
  };

  const handleSelectEmployee = (empId: string) => {
    setSelectedEmployee(empId);
  };

  const handleBackToDepartments = () => {
    setSelectedDepartment('');
    setSelectedEmployee('');
    setViewMode('department');
  };

  const handleBackToEmployees = () => {
    setSelectedEmployee('');
    setViewMode('employee');
  };

  const filteredEmployees = employees.filter(emp =>
    emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    emp.department.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const departmentEmployees = selectedDepartment
    ? filteredEmployees.filter(emp => emp.department_id === selectedDepartment)
    : filteredEmployees;

  const userRole = user?.role ? user.role.toUpperCase() : '';
  const userDepartmentCode = (
    user?.employee_profile?.department_code ||
    user?.hrm_user?.department_code ||
    (user as any)?.department_code ||
    null
  );
  const canUploadAttendance =
    userRole === 'ADMIN' ||
    userRole === 'HR' ||
    user?.is_super_admin ||
    userDepartmentCode === 'HCNS';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    setUploadMessage(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setUploadMessage({ type: 'error', text: 'Vui lòng chọn file để upload' });
      return;
    }

    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'application/csv', 'text/x-csv',
      'application/x-csv', 'text/comma-separated-values', 'text/x-comma-separated-values',
    ];
    if (!allowedTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(xlsx|xls|csv)$/i)) {
      setUploadMessage({ type: 'error', text: 'Chỉ chấp nhận file Excel (.xlsx, .xls) hoặc CSV (.csv)' });
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setUploadMessage({ type: 'error', text: 'File quá lớn. Dung lượng tối đa là 10MB.' });
      return;
    }

    setUploading(true);
    setUploadMessage(null);
    try {
      const result = await attendanceService.uploadAttendanceFile(selectedFile);
      const details = result.details ?? {};
      const totalRecords = details.total_records ?? 0;
      const importedRecords = details.imported_records ?? 0;
      const duplicateRecords = details.duplicate_records ?? 0;
      const failedRecords = details.failed_records ?? 0;
      const newUpload = {
        id: uploadHistory.length + 1,
        filename: selectedFile.name,
        uploadedAt: new Date().toLocaleString('vi-VN'),
        status: (importedRecords === 0 && duplicateRecords === 0 && failedRecords > 0 ? 'error' : 'success') as 'success' | 'error',
        records: totalRecords,
        user: user?.username || 'Unknown',
      };
      setUploadHistory([newUpload, ...uploadHistory]);

      // Toàn bộ file lỗi (0 dòng được ghi nhận) -> báo rõ là thất bại, kèm lý do
      // dòng lỗi đầu tiên, thay vì hiện "thành công" chung chung khiến HR tưởng
      // đã cập nhật xong (VD: file có header ở dòng đầu tiên, không đúng định
      // dạng mẫu 2 dòng tiêu đề -> mọi dòng fail "Employee code not found").
      if (importedRecords === 0 && duplicateRecords === 0 && failedRecords > 0) {
        const firstError = details.import_result?.failed?.[0]?.error;
        setUploadMessage({
          type: 'error',
          text: `Upload file "${selectedFile.name}" KHÔNG cập nhật được dòng nào — cả ${failedRecords}/${totalRecords} dòng đều lỗi` +
            (firstError ? ` (VD: ${firstError}). Kiểm tra lại định dạng file (đúng mẫu, đúng dòng tiêu đề) và mã nhân viên.` : '. Kiểm tra lại định dạng file.'),
        });
        setSelectedFile(null);
        const fileInputErr = document.getElementById('attendance-file') as HTMLInputElement;
        if (fileInputErr) fileInputErr.value = '';
        return;
      }

      let successText = `Upload file "${selectedFile.name}" thành công! Tổng ${totalRecords} dòng`;
      if (importedRecords > 0 && duplicateRecords > 0) {
        successText += ` (${importedRecords} mới, ${duplicateRecords} cập nhật)`;
      } else if (importedRecords > 0) {
        successText += ` (${importedRecords} mới)`;
      } else if (duplicateRecords > 0) {
        successText += ` (${duplicateRecords} cập nhật)`;
      }
      if (failedRecords > 0) {
        successText += ` — ${failedRecords} dòng lỗi, không được cập nhật`;
      }
      successText += '.';
      setUploadMessage({ type: failedRecords > 0 ? 'info' : 'success', text: successText });
      setSelectedFile(null);
      const fileInput = document.getElementById('attendance-file') as HTMLInputElement;
      if (fileInput) fileInput.value = '';
    } catch (error: any) {
      console.error('Upload error:', error);
      let errorMessage = 'Upload thất bại. Vui lòng thử lại.';
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.errors) {
        const errors = error.response.data.errors;
        if (typeof errors === 'object') errorMessage = Object.values(errors).flat().join(', ');
        else if (Array.isArray(errors)) errorMessage = errors.join(', ');
      } else if (error.message) {
        errorMessage = error.message;
      }
      setUploadMessage({ type: 'error', text: errorMessage });
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFile(files[0]);
      setUploadMessage(null);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await attendanceService.downloadAttendanceTemplate();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'attendance_upload_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setUploadMessage({ type: 'success', text: 'Đã tải mẫu file thành công!' });
    } catch (error) {
      console.error('Error downloading template:', error);
      setUploadMessage({ type: 'error', text: 'Tải mẫu file thất bại. Vui lòng thử lại.' });
    }
  };

  const handleValidateFile = async () => {
    if (!selectedFile) {
      setUploadMessage({ type: 'error', text: 'Vui lòng chọn file để validate' });
      return;
    }
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'application/csv', 'text/x-csv',
      'application/x-csv', 'text/comma-separated-values', 'text/x-comma-separated-values',
    ];
    if (!allowedTypes.includes(selectedFile.type) && !selectedFile.name.match(/\.(xlsx|xls|csv)$/i)) {
      setUploadMessage({ type: 'error', text: 'Chỉ chấp nhận file Excel (.xlsx, .xls) hoặc CSV (.csv)' });
      return;
    }
    if (selectedFile.size > 10 * 1024 * 1024) {
      setUploadMessage({ type: 'error', text: 'File quá lớn. Dung lượng tối đa là 10MB.' });
      return;
    }
    setUploading(true);
    setUploadMessage(null);
    try {
      const result = await attendanceService.validateAttendanceFile(selectedFile);
      setUploadMessage({
        type: 'success',
        text: `Validate thành công! File có ${result.validation_results?.total_rows || 0} dòng, trong đó ${result.validation_results?.valid_rows || 0} dòng hợp lệ.`,
      });
    } catch (error: any) {
      console.error('Validate error:', error);
      let errorMessage = 'Validate thất bại. Vui lòng thử lại.';
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.errors) {
        const errors = error.response.data.errors;
        if (typeof errors === 'object') errorMessage = Object.values(errors).flat().join(', ');
        else if (Array.isArray(errors)) errorMessage = errors.join(', ');
      } else if (error.message) {
        errorMessage = error.message;
      }
      setUploadMessage({ type: 'error', text: errorMessage });
    } finally {
      setUploading(false);
    }
  };

  const fileSchema = [
    ['STT', 'Số thứ tự'],
    ['Mã nhân viên', 'Bắt buộc'],
    ['Tên nhân viên', 'Tên nhân viên'],
    ['Phòng Ban', 'Phòng ban'],
    ['Ngày', 'Ngày chấm công (bắt buộc)'],
    ['Thứ', 'Thứ trong tuần'],
    ['Giờ vào', 'Giờ vào làm'],
    ['Giờ ra', 'Giờ ra về'],
    ['Trễ', 'Số phút đi trễ'],
    ['Sớm', 'Số phút về sớm'],
    ['Công', 'Số công'],
    ['Tổng giờ', 'Tổng giờ làm'],
    ['Tăng ca', 'Số giờ tăng ca'],
    ['Tổng toàn bộ', 'Tổng giờ toàn bộ'],
    ['Ca', 'Ca làm việc'],
  ];

  /* ═══ No permission ═══ */
  if (!canUploadAttendance) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
            <ShieldCheckIcon className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight mb-2">Quyền truy cập hạn chế</h2>
          <p className="text-sm text-gray-400 mb-6">
            Tính năng này chỉ dành cho quản trị viên và nhân sự cấp cao. Vui lòng liên hệ quản trị viên hệ thống để biết thêm chi tiết.
          </p>
          <button onClick={() => window.history.back()} className="btn-primary">
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Upload Chấm công</h1>
            <p className="text-sm text-gray-900 mt-0.5">Kênh nhập liệu hiệu suất cao cho hành chính nhân sự.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleDownloadTemplate}
            className="btn-secondary flex items-center gap-2"
            title="Tải mẫu file Excel"
          >
            <DocumentArrowDownIcon className="w-4 h-4" />
            Tải mẫu file
          </button>
          <button
            onClick={handleViewDetail}
            className="btn-primary flex items-center gap-2"
            title="Xem chi tiết lịch sử và cấu trúc"
          >
            <EyeIcon className="w-4 h-4" />
            Xem chi tiết
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── Left Column: Upload Main ── */}
        <div className="lg:col-span-8 space-y-6">
          {/* Upload Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="space-y-5">
              {/* Drop zone */}
              <div
                className={cx(
                  'min-h-[220px] sm:min-h-[280px] rounded-2xl border-2 border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center p-5 sm:p-8',
                  dragOver
                    ? 'border-primary-400 bg-primary-50'
                    : selectedFile
                      ? 'border-emerald-400 bg-emerald-50'
                      : 'border-gray-300 bg-gray-50 hover:border-primary-400 hover:bg-white'
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { handleDrop(e); setDragOver(false); }}
                onClick={() => !selectedFile && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  id="attendance-file"
                  type="file"
                  className="hidden"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  disabled={uploading}
                />

                {selectedFile ? (
                  <div className="flex flex-col items-center text-center w-full max-w-sm">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mb-4">
                      <DocumentTextIcon className="w-8 h-8 text-emerald-600" />
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 break-all mb-2">
                      {selectedFile.name}
                    </h3>
                    <div className="flex flex-col items-center gap-2 mb-6">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">
                        <CheckCircleIcon className="w-3.5 h-3.5" />
                        Sẵn sàng upload
                      </span>
                      <p className="text-sm text-gray-400">
                        Dung lượng: {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                      className="text-sm text-gray-400 hover:text-red-600 transition-colors flex items-center gap-1.5 px-3 py-1.5 hover:bg-red-50 rounded-xl"
                    >
                      <XMarkIcon className="w-4 h-4" />
                      Hủy và chọn lại
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center max-w-sm">
                    <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                      <CloudArrowUpIcon className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-lg font-medium text-gray-700 mb-1">Kéo thả file vào đây</p>
                    <p className="text-sm text-gray-400 mb-6">Excel hoặc CSV, tối đa 10MB</p>
                    <span className="btn-primary">Chọn file</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {selectedFile && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    onClick={handleValidateFile}
                    disabled={uploading}
                    className={cx(
                      'flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors',
                      uploading
                        ? 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed'
                        : 'bg-white text-amber-700 border-amber-300 hover:bg-amber-50'
                    )}
                  >
                    <CheckBadgeIcon className="w-4 h-4" />
                    Kiểm tra cấu trúc
                  </button>
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className={cx(
                      'flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
                      uploading
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'btn-primary'
                    )}
                  >
                    {uploading ? (
                      <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CloudArrowUpIcon className="w-4 h-4" />
                    )}
                    {uploading ? 'Đang upload...' : 'Bắt đầu upload'}
                  </button>
                </div>
              )}

              {/* Alert */}
              {uploadMessage && (
                <Alert
                  type={uploadMessage.type}
                  text={uploadMessage.text}
                  onClose={() => setUploadMessage(null)}
                />
              )}
            </div>
          </div>

          {/* Schema Card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
                <InformationCircleIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-gray-900">Cấu trúc dữ liệu yêu cầu</h2>
                <p className="text-xs text-gray-600">Định dạng file Excel / CSV hợp lệ</p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {fileSchema.map(([col, desc], i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-primary-200 hover:bg-white transition-colors">
                  <p className="text-xs font-medium text-primary-600 mb-1">[{col}]</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Column: Sidebar ── */}
        <div className="lg:col-span-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col min-h-[260px] sm:min-h-[400px] sticky top-6">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-900">Lịch sử upload</h2>
              <p className="text-xs text-gray-400 mt-0.5">Theo dõi hoạt động</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {uploadHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
                  <DocumentTextIcon className="w-10 h-10 text-gray-200 mb-3" />
                  <p className="text-xs text-gray-400">Chưa có dữ liệu</p>
                </div>
              ) : (
                uploadHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className={cx(
                        'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                        item.status === 'success' ? 'bg-emerald-100 text-emerald-600' :
                          item.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                      )}>
                        <DocumentTextIcon className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate mb-1">{item.filename}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={item.status} />
                          <span className="text-xs text-gray-400">{item.records} dòng</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{item.uploadedAt}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <div className="flex items-start gap-2 text-gray-500">
                <InformationCircleIcon className="w-4 h-4 text-primary-400 shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">Hệ thống lưu trữ 10 phiên upload gần nhất.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Detail View Modal ═══ */}
      {showDetailView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
          <div className="absolute inset-0 bg-gray-900/50" onClick={handleBack} />

          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-gray-100">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-sm text-gray-500">
                <button
                  onClick={handleBack}
                  className="whitespace-nowrap hover:text-primary-600 transition-colors flex items-center gap-1"
                >
                  <HomeIcon className="w-4 h-4" />
                  Trang chủ
                </button>
                {viewMode === 'employee' && (
                  <>
                    <ChevronRightIcon className="w-3.5 h-3.5 text-gray-300" />
                    <button
                      onClick={handleBackToDepartments}
                      className="whitespace-nowrap hover:text-primary-600 transition-colors"
                    >
                      Phòng ban
                    </button>
                  </>
                )}
                {selectedEmployee && (
                  <>
                    <ChevronRightIcon className="w-3.5 h-3.5 text-gray-300" />
                    <button
                      onClick={handleBackToEmployees}
                      className="whitespace-nowrap hover:text-primary-600 transition-colors"
                    >
                      Nhân viên
                    </button>
                  </>
                )}
              </div>
              <button
                onClick={handleBack}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-extrabold text-gray-900 tracking-tight">
                    {viewMode === 'department' && 'Danh mục Phòng ban'}
                    {viewMode === 'employee' && !selectedEmployee &&
                      departments.find(d => d.id === selectedDepartment)?.name}
                    {selectedEmployee &&
                      employees.find(e => e.id === selectedEmployee)?.name}
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">
                    {viewMode === 'department' && 'Quản lý nhân sự theo đơn vị'}
                    {viewMode === 'employee' && !selectedEmployee && 'Danh sách nhân sự trực thuộc'}
                    {selectedEmployee && 'Dữ liệu chấm công lịch sử chi tiết'}
                  </p>
                </div>

                {(viewMode === 'employee' || selectedEmployee) && (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <MagnifyingGlassIcon className="w-4 h-4 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      placeholder="Tìm kiếm..."
                      className="input-field pl-9"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {/* Department view */}
              {viewMode === 'department' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {departments.map((dept) => (
                    <button
                      key={dept.id}
                      onClick={() => handleSelectDepartment(dept.id)}
                      className="text-left p-4 rounded-2xl bg-white border border-gray-100 hover:border-primary-300 hover:shadow-sm transition-all group"
                    >
                      <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center mb-3 group-hover:bg-primary-200 transition-colors">
                        <BuildingOfficeIcon className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-semibold text-gray-900 mb-1">{dept.name}</p>
                      <p className="text-xs text-gray-400">{dept.employeeCount} nhân sự</p>
                    </button>
                  ))}
                </div>
              )}

              {/* Employee list view */}
              {viewMode === 'employee' && !selectedEmployee && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {departmentEmployees.length === 0 ? (
                    <div className="col-span-full py-16 text-center">
                      <UserIcon className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm text-gray-400">Không tìm thấy dữ liệu</p>
                    </div>
                  ) : (
                    departmentEmployees.map((emp) => (
                      <button
                        key={emp.id}
                        onClick={() => handleSelectEmployee(emp.id)}
                        className="text-left p-4 rounded-2xl bg-white border border-gray-100 hover:border-primary-300 hover:shadow-sm transition-all flex items-center gap-3"
                      >
                        <div className="h-9 w-9 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
                          <UserIcon className="w-5 h-5 text-gray-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-primary-600 mb-0.5">{emp.code}</p>
                          <p className="text-sm font-semibold text-gray-900 truncate">{emp.name}</p>
                        </div>
                        <ChevronRightIcon className="w-4 h-4 text-gray-400 shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Employee detail view */}
              {selectedEmployee && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard label="Ngày công" value={18} color="emerald" />
                    <StatCard label="Đi muộn" value={3} color="amber" />
                    <StatCard label="Vắng mặt" value={1} color="red" />
                    <StatCard label="Số ngày tính" value={22} color="primary" />
                  </div>

                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-1 sm:p-5">
                    <AttendanceCalendar
                      onDateClick={handleDateClick}
                      employeeId={selectedEmployee ? parseInt(selectedEmployee) : undefined}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            {selectedEmployee && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 sm:px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
                <button
                  onClick={handleBackToEmployees}
                  className="flex items-center gap-2 text-sm font-semibold text-gray-900"
                >
                  <ArrowLeftIcon className="w-4 h-4" />
                  Quay lại danh sách
                </button>
                <div className="flex items-center gap-3">
                  <button className="btn-secondary">In báo cáo</button>
                  <button className="btn-primary">Xuất file Excel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceUpload;

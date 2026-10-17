import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  XMarkIcon,
  CheckIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '../../contexts/AuthContext';
import { SelectBox } from '../../components/LandingLayout/SelectBox';
import ConfirmDialog from '../../components/ConfirmDialog';
import { positionsAPI, departmentsAPI } from '../../utils/api';
import {
  recruitmentService,
  RecruitmentNeedListItem,
  RecruitmentNeedCreateData,
  EmploymentType,
  InterviewerCandidate,
} from '../../services/recruitment.service';

const EMPLOYMENT_TYPE_OPTIONS: { value: EmploymentType; label: string }[] = [
  { value: 'FULL_TIME', label: 'Toàn thời gian' },
  { value: 'PART_TIME', label: 'Bán thời gian' },
  { value: 'CONTRACT', label: 'Hợp đồng' },
  { value: 'INTERN', label: 'Thực tập' },
  { value: 'COLLABORATOR', label: 'Cộng tác viên' },
];

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-emerald-100 text-emerald-800',
  IN_PROGRESS: 'bg-primary-100 text-primary-800',
  FILLED: 'bg-gray-100 text-gray-800',
  EXPIRED: 'bg-orange-100 text-orange-800',
  CANCELLED: 'bg-red-100 text-red-800',
};

const APPROVAL_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
};

interface FormState {
  position: string; // Position ID or empty string
  department: string; // Department ID or empty string
  headcount: string;
  employment_type: EmploymentType;
  expected_salary_min: string;
  expected_salary_max: string;
  reason: string;
  target_onboard_date: string;
  cv_approver: string; // User ID or empty string
}

const EMPTY_FORM: FormState = {
  position: '',
  department: '',
  headcount: '1',
  employment_type: 'FULL_TIME',
  expected_salary_min: '',
  expected_salary_max: '',
  reason: '',
  target_onboard_date: '',
  cv_approver: '',
};

interface DepartmentOption {
  id: number;
  name: string;
  code: string;
}

interface PositionOption {
  id: number;
  name: string;
  code: string;
}const RecruitmentNeeds: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isHR = user?.hrm_user?.is_hr || user?.is_staff;
  const isDeleteAllowed = Boolean(user?.hrm_user?.is_hr || user?.is_staff || (user as any)?.is_superuser);
  
  const [needs, setNeeds] = useState<RecruitmentNeedListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [cvApproverCandidates, setCvApproverCandidates] = useState<InterviewerCandidate[]>([]);
  const [cvApproverQuery, setCvApproverQuery] = useState('');

  // Approval workflow states
  const [approvalAction, setApprovalAction] = useState<{ id: number; action: 'approve' | 'reject' } | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [approvalLoading, setApprovalLoading] = useState(false);

  const fetchPositions = async () => {
    try {
      setPositionsLoading(true);
      const data = await positionsAPI.list({ page_size: 1000 });
      const mapped: PositionOption[] = (data.results || []).map(p => ({
        id: p.id,
        name: p.title,
        code: p.code,
      }));
      setPositions(mapped);
    } catch (err) {
      console.error('Error fetching positions:', err);
      setPositions([]);
    } finally {
      setPositionsLoading(false);
    }
  };

  const fetchDepartments = async () => {
    try {
      setDepartmentsLoading(true);
      const data = await departmentsAPI.list({ page_size: 1000 });
      const mapped: DepartmentOption[] = (data.results || []).map(d => ({
        id: d.id,
        name: d.name,
        code: d.code,
      }));
      setDepartments(mapped);
    } catch (err) {
      console.error('Error fetching departments:', err);
      setDepartments([]);
    } finally {
      setDepartmentsLoading(false);
    }
  };

  const fetchNeeds = async () => {
    try {
      setLoading(true);
      const data = await recruitmentService.listNeeds();
      setNeeds(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách nhu cầu tuyển dụng';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchCvApproverCandidates = async (query: string = '') => {
    try {
      const data = await recruitmentService.listInterviewerCandidates(query);
      setCvApproverCandidates(data || []);
    } catch (err) {
      console.error('Error fetching CV approver candidates:', err);
      setCvApproverCandidates([]);
    }
  };

  const cvApproverOptions = useMemo(() => {
    return [
      { value: '', label: 'Không chọn' },
      ...cvApproverCandidates.map((emp) => ({
        value: String(emp.user_id),
        label: emp.employee_id ? `${emp.full_name} (${emp.employee_id})` : emp.full_name,
      })),
    ];
  }, [cvApproverCandidates]);

  useEffect(() => {
    if (!showModal) return;
    const timer = setTimeout(() => {
      fetchCvApproverCandidates(cvApproverQuery);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvApproverQuery, showModal]);

  useEffect(() => {
    fetchNeeds();
    fetchPositions();
    fetchDepartments();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setCvApproverQuery('');
    setShowModal(true);
  };

  const openEdit = async (need: RecruitmentNeedListItem) => {
    try {
      const full = await recruitmentService.getNeed(need.id);
      setEditingId(full.id);
      setForm({
        position: full.position ? String(full.position) : '',
        department: full.department ? String(full.department) : '',
        headcount: String(full.headcount),
        employment_type: full.employment_type,
        expected_salary_min: full.expected_salary_min ?? '',
        expected_salary_max: full.expected_salary_max ?? '',
        reason: full.reason,
        target_onboard_date: full.target_onboard_date ?? '',
        cv_approver: full.cv_approver ? String(full.cv_approver) : '',
      });
      setFormError(null);
      setCvApproverQuery('');
      setShowModal(true);
    } catch {
      alert('Không thể tải thông tin nhu cầu tuyển dụng');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.position) {
      setFormError('Vui lòng chọn vị trí');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const selectedPosition = positions.find(p => String(p.id) === form.position);
      const data: RecruitmentNeedCreateData = {
        position_name: selectedPosition?.name || '',
        position: selectedPosition?.id || undefined,
        department: form.department ? parseInt(form.department) : undefined,
        headcount: parseInt(form.headcount) || 1,
        employment_type: form.employment_type,
        reason: form.reason.trim(),
        target_onboard_date: form.target_onboard_date || undefined,
        expected_salary_min: form.expected_salary_min ? parseFloat(form.expected_salary_min) : undefined,
        expected_salary_max: form.expected_salary_max ? parseFloat(form.expected_salary_max) : undefined,
        cv_approver: form.cv_approver ? parseInt(form.cv_approver) : null,
      };
      if (editingId) {
        await recruitmentService.updateNeed(editingId, data);
      } else {
        await recruitmentService.createNeed(data);
      }
      setShowModal(false);
      await fetchNeeds();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lưu thất bại';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await recruitmentService.deleteNeed(id);
      setDeleteConfirmId(null);
      await fetchNeeds();
    } catch {
      alert('Xóa thất bại');
    }
  };

  const handleApproval = async () => {
    if (!approvalAction) return;
    try {
      setApprovalLoading(true);
      if (approvalAction.action === 'approve') {
        await recruitmentService.approveNeed(approvalAction.id, approvalNote);
      } else if (approvalAction.action === 'reject') {
        await recruitmentService.rejectNeed(approvalAction.id, approvalNote);
      }
      setApprovalAction(null);
      setApprovalNote('');
      await fetchNeeds();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Thao tác thất bại';
      alert(msg);
    } finally {
      setApprovalLoading(false);
    }
  };

  const openNeedDetail = (needId: number) => {
    navigate(`/dashboard/recruitment/needs/${needId}`);
  };

  const openNeedCvUpload = (needId: number) => {
    navigate(`/dashboard/recruitment/candidates?openNeedCv=1&needId=${needId}&referralNeed=${needId}`);
  };

  const filteredNeeds = needs.filter(n => {
    const matchesStatus = statusFilter === 'all' ? true : n.status === statusFilter;
    const matchesSearch = searchTerm === '' ? true : (
      n.position_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (n.department_name && n.department_name.toLowerCase().includes(searchTerm.toLowerCase()))
    );
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Nhu cầu tuyển dụng</h1>
          <p className="text-gray-900 mt-1 text-sm">Quản lý yêu cầu tuyển dụng từ phòng ban</p>
        </div>
        <button
          onClick={openCreate}
          className="btn-primary flex items-center gap-2 whitespace-nowrap"
        >
          <PlusIcon className="h-4 w-4" />
          Thêm nhu cầu
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
        {/* Search input */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Tìm theo vị trí tuyển dụng, phòng ban..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        {/* Status filter buttons */}
        <div className="flex gap-2 flex-wrap">
          {[
            { value: 'all', label: 'Tất cả' },
            { value: 'IN_PROGRESS', label: 'Đang tuyển' },
            { value: 'FILLED', label: 'Đã tuyển đủ' },
            { value: 'EXPIRED', label: 'Đã hết hạn' },
            { value: 'CANCELLED', label: 'Đã hủy' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl border border-red-100 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filteredNeeds.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-400">
          <p className="text-sm">Chưa có nhu cầu tuyển dụng nào</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr className="bg-gray-50">
                  <th className="table-header">Vị trí</th>
                  <th className="table-header">Phòng ban</th>
                  <th className="table-header">Bộ phận phỏng vấn</th>
                  <th className="table-header">Người duyệt CV</th>
                  <th className="table-header">SL</th>
                  <th className="table-header">Loại</th>                  <th className="table-header">Duyệt</th>                  <th className="table-header">Trạng thái</th>
                  <th className="table-header">Ngày onboard</th>
                  <th className="table-header">Ghi chú</th>
                  <th className="table-header">Tạo lúc</th>
                  <th className="table-header" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredNeeds.map(need => (
                  <tr
                    key={need.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => openNeedDetail(need.id)}
                  >
                    <td className="table-cell">
                      <p className="text-sm font-semibold text-gray-900">{need.position_name}</p>
                      {need.position_display && need.position_display !== need.position_name && (
                        <p className="text-xs text-gray-400">{need.position_display}</p>
                      )}
                    </td>
                    <td className="table-cell text-sm text-gray-600">{need.department_name || '—'}</td>
                    <td className="table-cell text-sm text-gray-600">
                      {need.interviewer_employee_id || need.interviewer_name ? (
                        <span>
                          {need.interviewer_employee_id ? <span className="font-medium">{need.interviewer_employee_id}</span> : null}
                          {need.interviewer_employee_id && need.interviewer_name ? ' — ' : null}
                          {need.interviewer_name || ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="table-cell text-sm text-gray-600">
                      {need.cv_approver_employee_id || need.cv_approver_name ? (
                        <span>
                          {need.cv_approver_employee_id ? <span className="font-medium">{need.cv_approver_employee_id}</span> : null}
                          {need.cv_approver_employee_id && need.cv_approver_name ? ' — ' : null}
                          {need.cv_approver_name || ''}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="table-cell text-sm text-gray-600 text-center">{need.headcount}</td>
                    <td className="table-cell text-sm text-gray-600">{need.employment_type_display}</td>
                    <td className="table-cell">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${APPROVAL_STATUS_COLORS[(need as any).approval_status] ?? 'bg-gray-100 text-gray-800'}`}
                      >
                        {(need as any).approval_status_display || 'Chưa duyệt'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[need.status] ?? 'bg-gray-100 text-gray-800'}`}
                      >
                        {need.status_display}
                      </span>
                    </td>
                    <td className="table-cell text-sm text-gray-600">
                      {need.target_onboard_date
                        ? new Date(need.target_onboard_date).toLocaleDateString('vi-VN')
                        : '—'}
                    </td>
                    <td
                      className="table-cell text-sm text-gray-600 max-w-xs truncate"
                      title={need.reason || ''}
                    >
                      {need.reason || '—'}
                    </td>
                    <td className="table-cell text-sm text-gray-400">
                      {new Date(need.created_at).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center gap-1 justify-end flex-wrap">
                        {isHR && (need as any).approval_status === 'PENDING' && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setApprovalAction({ id: need.id, action: 'approve' });
                              }}
                              className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                              title="Duyệt"
                            >
                              <CheckCircleIcon className="h-4 w-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setApprovalAction({ id: need.id, action: 'reject' });
                              }}
                              className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              title="Từ chối"
                            >
                              <XMarkIcon className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openNeedCvUpload(need.id);
                          }}
                          className="h-8 px-2 flex items-center justify-center rounded-xl text-xs font-semibold bg-purple-50 text-purple-700 hover:bg-purple-100 transition-colors"
                          title="Upload CV vào nhu cầu"
                        >
                          CV
                        </button>
                        {(need as any).approval_status !== 'APPROVED' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(need);
                            }}
                            className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
                            title="Chỉnh sửa"
                            disabled={(need as any).approval_status === 'APPROVED'}
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                        )}
                        {isDeleteAllowed && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(need.id);
                            }}
                            className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title="Xóa"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">
                {editingId ? 'Cập nhật nhu cầu' : 'Thêm nhu cầu tuyển dụng'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-4 sm:px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vị trí tuyển dụng <span className="text-red-500">*</span>
                </label>
                {positionsLoading ? (
                  <div className="px-3 py-2.5 border border-gray-300 rounded-xl text-gray-500 text-sm">
                    Đang tải danh sách vị trí...
                  </div>
                ) : (
                  <SelectBox<string>
                    label=""
                    value={form.position}
                    options={positions.map(p => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
                    onChange={v => setForm(f => ({ ...f, position: v }))}
                    placeholder={positions.length === 0 ? 'Không có vị trí nào' : 'Chọn hoặc tìm vị trí...'}
                    searchable={true}
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phòng ban
                </label>
                {departmentsLoading ? (
                  <div className="px-3 py-2.5 border border-gray-300 rounded-xl text-gray-500 text-sm">
                    Đang tải danh sách phòng ban...
                  </div>
                ) : (
                  <SelectBox<string>
                    label=""
                    value={form.department}
                    options={[
                      { value: '', label: '— Không chọn —' },
                      ...departments.map(d => ({ value: String(d.id), label: `${d.name} (${d.code})` })),
                    ]}
                    onChange={v => setForm(f => ({ ...f, department: v }))}
                    placeholder={departments.length === 0 ? 'Không có phòng ban nào' : 'Chọn phòng ban...'}
                    searchable={true}
                  />
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Số lượng</label>
                  <input
                    type="number"
                    min="1"
                    value={form.headcount}
                    onChange={e => setForm(f => ({ ...f, headcount: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <div>
                  <SelectBox<EmploymentType>
                    label="Hình thức"
                    value={form.employment_type}
                    options={EMPLOYMENT_TYPE_OPTIONS}
                    onChange={v => setForm(f => ({ ...f, employment_type: v }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lương tối thiểu (đ)
                  </label>
                  <input
                    type="number"
                    value={form.expected_salary_min}
                    onChange={e => setForm(f => ({ ...f, expected_salary_min: e.target.value }))}
                    className="input-field"
                    placeholder="VD: 15000000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lương tối đa (đ)
                  </label>
                  <input
                    type="number"
                    value={form.expected_salary_max}
                    onChange={e => setForm(f => ({ ...f, expected_salary_max: e.target.value }))}
                    className="input-field"
                    placeholder="VD: 25000000"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ngày onboard dự kiến
                </label>
                <input
                  type="date"
                  value={form.target_onboard_date}
                  onChange={e => setForm(f => ({ ...f, target_onboard_date: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Người duyệt CV
                </label>
                <SelectBox<string>
                  label=""
                  value={form.cv_approver}
                  options={cvApproverOptions}
                  onQueryChange={setCvApproverQuery}
                  onChange={v => setForm(f => ({ ...f, cv_approver: v }))}
                  placeholder="Tìm theo tên hoặc mã nhân viên..."
                  searchable={true}
                  portal={true}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  className="input-field"
                  placeholder="Ghi chú (vd: lý do tuyển, ngày nhận, ưu tiên...)"
                />
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-100">
                  {formError}
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? (
                    <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CheckIcon className="h-4 w-4" />
                  )}
                  {editingId ? 'Cập nhật' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Approval modal */}
      {approvalAction && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-black/30" onClick={() => setApprovalAction(null)} />
            <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full p-6 z-50">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {approvalAction.action === 'approve' && 'Duyệt nhu cầu tuyển dụng?'}
                {approvalAction.action === 'reject' && 'Từ chối nhu cầu tuyển dụng'}
              </h3>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {approvalAction.action === 'reject' ? 'Lý do từ chối' : 'Ghi chú'}
                </label>
                <textarea
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  placeholder={approvalAction.action === 'reject' ? 'Vui lòng nhập lý do từ chối' : 'Ghi chú (tùy chọn)'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  rows={3}
                />
              </div>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setApprovalAction(null)}
                  disabled={approvalLoading}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50 transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={handleApproval}
                  disabled={approvalLoading || (approvalAction.action === 'reject' && !approvalNote.trim())}
                  className={`px-4 py-2 rounded-md text-white transition-colors disabled:opacity-50 ${
                    approvalAction.action === 'reject'
                      ? 'bg-red-600 hover:bg-red-700'
                      : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {approvalLoading ? 'Đang xử lý...' : (
                    approvalAction.action === 'approve' ? 'Duyệt' : 'Từ chối'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteConfirmId !== null}
        title="Xác nhận xóa"
        message="Bạn có chắc muốn xóa nhu cầu tuyển dụng này không?"
        onConfirm={() => deleteConfirmId !== null && handleDelete(deleteConfirmId)}
        onClose={() => setDeleteConfirmId(null)}
      />
    </div>
  );
};

export default RecruitmentNeeds;

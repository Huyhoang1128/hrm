import React, { useState, useEffect } from 'react';
import {
  PlusIcon,
  XMarkIcon,
  CheckIcon,
  ChevronRightIcon,
  DocumentArrowDownIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import {
  recruitmentService,
  ApplicationListItem,
  ApplicationCreateData,
  ApplicationStage,
  ApplicationStatus,
  StageHistory,
} from '../../services/recruitment.service';
import { SelectBox } from '../../components/LandingLayout/SelectBox';

const STAGE_COLORS: Record<ApplicationStage, string> = {
  APPLIED: 'bg-gray-100 text-gray-800',
  SCREENING: 'bg-primary-100 text-primary-800',
  INTERVIEW: 'bg-violet-100 text-violet-800',
  TEST: 'bg-amber-100 text-amber-800',
  OFFER: 'bg-amber-100 text-amber-700',
  HIRED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  WITHDRAWN: 'bg-gray-100 text-gray-500',
};

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  ACTIVE: 'bg-primary-100 text-primary-800',
  HIRED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  WITHDRAWN: 'bg-gray-100 text-gray-500',
};

const CV_STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-gray-100 text-gray-700',
  PROCESSING: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  ON_HOLD: 'bg-blue-100 text-blue-700',
};

const STAGE_OPTIONS: { value: ApplicationStage; label: string }[] = [
  { value: 'APPLIED', label: 'Đã ứng tuyển' },
  { value: 'SCREENING', label: 'Sàng lọc CV' },
  { value: 'INTERVIEW', label: 'Phỏng vấn' },
  { value: 'TEST', label: 'Kiểm tra/Test' },
  { value: 'OFFER', label: 'Offer' },
  { value: 'HIRED', label: 'Đã tuyển' },
  { value: 'REJECTED', label: 'Bị từ chối' },
  { value: 'WITHDRAWN', label: 'Ứng viên rút hồ sơ' },
];

const STAGE_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả giai đoạn' },
  ...STAGE_OPTIONS,
];

const STATUS_FILTER_OPTIONS = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'ACTIVE', label: 'Đang tiến hành' },
  { value: 'HIRED', label: 'Đã tuyển' },
  { value: 'REJECTED', label: 'Bị từ chối' },
  { value: 'WITHDRAWN', label: 'Ứng viên rút' },
];

interface CreateFormState {
  candidate: string;
  job: string;
  notes: string;
}

const RecruitmentApplications: React.FC = () => {
  const [applications, setApplications] = useState<ApplicationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>({ candidate: '', job: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Move stage modal
  const [moveStageApp, setMoveStageApp] = useState<ApplicationListItem | null>(null);
  const [moveStageValue, setMoveStageValue] = useState<ApplicationStage>('SCREENING');
  const [moveStageNote, setMoveStageNote] = useState('');
  const [movingStageSaving, setMovingStageSaving] = useState(false);
  const [moveStageError, setMoveStageError] = useState<string | null>(null);

  // History drawer
  const [historyApp, setHistoryApp] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<StageHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchApplications = async () => {
    try {
      setLoading(true);
      const params: {
        stage?: ApplicationStage;
        status?: ApplicationStatus;
      } = {};
      if (stageFilter !== 'all') params.stage = stageFilter as ApplicationStage;
      if (statusFilter !== 'all') params.status = statusFilter as ApplicationStatus;
      const data = await recruitmentService.listApplications(params);
      setApplications(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách đơn ứng tuyển';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApplications();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageFilter, statusFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.candidate || !createForm.job) {
      setFormError('Vui lòng nhập ID ứng viên và ID tin tuyển dụng');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const data: ApplicationCreateData = {
        candidate: parseInt(createForm.candidate),
        job: parseInt(createForm.job),
        notes: createForm.notes || undefined,
      };
      await recruitmentService.createApplication(data);
      setShowCreateModal(false);
      setCreateForm({ candidate: '', job: '', notes: '' });
      await fetchApplications();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Tạo thất bại';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleMoveStage = async () => {
    if (!moveStageApp) return;
    setMovingStageSaving(true);
    setMoveStageError(null);
    try {
      await recruitmentService.moveStage(moveStageApp.id, moveStageValue, moveStageNote);
      setMoveStageApp(null);
      await fetchApplications();
    } catch {
      setMoveStageError('Chuyển stage thất bại');
    } finally {
      setMovingStageSaving(false);
    }
  };

  const openHistory = async (id: number) => {
    setHistoryApp(id);
    setHistoryLoading(true);
    try {
      const app = await recruitmentService.getApplication(id);
      setHistoryData(app.stage_history);
    } catch {
      setHistoryData([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const filteredApplications = applications.filter(app => {
    const matchesSearch = searchTerm === '' ? true : (
      app.candidate_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.job_title.toLowerCase().includes(searchTerm.toLowerCase())
    );
    return matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Đơn ứng tuyển / Pipeline</h1>
          <p className="text-gray-500 mt-1 text-sm">Tracking quá trình tuyển dụng theo từng ứng viên</p>
        </div>
        <button
          onClick={() => {
            setShowCreateModal(true);
            setCreateForm({ candidate: '', job: '', notes: '' });
            setFormError(null);
          }}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          <PlusIcon className="h-4 w-4" />
          Tạo đơn mới
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
        {/* Search input */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Tìm theo tên ứng viên, hoặc vị trí..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
          />
        </div>

        {/* Filter buttons */}
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[200px]">
            <SelectBox
              label=""
              value={stageFilter}
              options={STAGE_FILTER_OPTIONS}
              onChange={(v) => setStageFilter(v)}
              placeholder="Tất cả giai đoạn"
            />
          </div>
          <div className="min-w-[200px]">
            <SelectBox
              label=""
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              onChange={(v) => setStatusFilter(v)}
              placeholder="Tất cả trạng thái"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl border border-red-100 text-sm">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-500">
          <p>Chưa có đơn ứng tuyển nào</p>
        </div>
      ) : filteredApplications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-500">
          <p>Không tìm thấy đơn ứng tuyển nào phù hợp</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Ứng viên</th>
                  <th className="table-header">Tin tuyển dụng</th>
                  <th className="table-header">Giai đoạn</th>
                  <th className="table-header">Trạng thái</th>
                  <th className="table-header">CV</th>
                  <th className="table-header">Nguồn</th>
                  <th className="table-header">Phụ trách</th>
                  <th className="table-header">Ứng tuyển</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {filteredApplications.map(app => (
                  <tr key={app.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-cell">
                      <p className="font-medium text-gray-900">{app.candidate_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{app.candidate_email}</p>
                    </td>
                    <td className="table-cell text-gray-700">{app.job_title}</td>
                    <td className="table-cell">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[app.current_stage]}`}
                      >
                        {app.current_stage_display}
                      </span>
                    </td>
                    <td className="table-cell">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[app.status]}`}
                      >
                        {app.status_display}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            CV_STATUS_COLORS[app.cv_process_status] || CV_STATUS_COLORS.NEW
                          }`}
                        >
                          {app.cv_process_status_display}
                        </span>
                        {app.candidate_cv_url && (
                          <a
                            href={app.candidate_cv_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-primary-600 transition-colors"
                            title="Tải CV"
                          >
                            <DocumentArrowDownIcon className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        <span className="text-sm text-gray-700">{app.candidate_source}</span>
                        {app.is_referral && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                            <SparklesIcon className="h-3 w-3" />
                            Giới thiệu
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-gray-700">{app.assignee_name || '—'}</td>
                    <td className="table-cell text-gray-500">
                      {new Date(app.applied_at).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => {
                            setMoveStageApp(app);
                            setMoveStageValue('SCREENING');
                            setMoveStageNote('');
                            setMoveStageError(null);
                          }}
                          className="h-9 w-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-primary-50 hover:text-primary-600 transition-colors"
                          title="Chuyển stage"
                        >
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openHistory(app.id)}
                          className="text-xs font-medium text-gray-400 hover:text-violet-600 hover:bg-violet-50 px-2 py-1 rounded-lg transition-colors"
                          title="Lịch sử"
                        >
                          Lịch sử
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

      {/* Create Application Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Tạo đơn ứng tuyển</h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="h-9 w-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ID ứng viên <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={createForm.candidate}
                  onChange={e => setCreateForm(f => ({ ...f, candidate: e.target.value }))}
                  className="input-field"
                  placeholder="ID ứng viên"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  ID tin tuyển dụng <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  value={createForm.job}
                  onChange={e => setCreateForm(f => ({ ...f, job: e.target.value }))}
                  className="input-field"
                  placeholder="ID tin tuyển dụng"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={createForm.notes}
                  onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                  className="input-field"
                />
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{formError}</p>
              )}
            </form>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="btn-secondary text-sm"
              >
                Hủy
              </button>
              <button
                type="submit"
                form=""
                disabled={saving}
                onClick={handleCreate}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {saving ? (
                  <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="h-4 w-4" />
                )}
                Tạo đơn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move Stage Modal */}
      {moveStageApp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Chuyển stage pipeline</h2>
                <p className="text-sm text-gray-500 mt-0.5">{moveStageApp.candidate_name}</p>
              </div>
              <button
                onClick={() => setMoveStageApp(null)}
                className="h-9 w-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <SelectBox
                label="Giai đoạn mới"
                value={moveStageValue}
                options={STAGE_OPTIONS}
                onChange={(v) => setMoveStageValue(v)}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={moveStageNote}
                  onChange={e => setMoveStageNote(e.target.value)}
                  className="input-field"
                  placeholder="VD: Đã xác nhận lịch phỏng vấn..."
                />
              </div>
              {moveStageError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl">{moveStageError}</p>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
              <button
                onClick={() => setMoveStageApp(null)}
                className="btn-secondary text-sm"
              >
                Hủy
              </button>
              <button
                onClick={handleMoveStage}
                disabled={movingStageSaving}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {movingStageSaving ? (
                  <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckIcon className="h-4 w-4" />
                )}
                Chuyển
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Drawer */}
      {historyApp !== null && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black bg-opacity-40" onClick={() => setHistoryApp(null)} />
          <div className="w-96 bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Lịch sử stage</h2>
              <button
                onClick={() => setHistoryApp(null)}
                className="h-9 w-9 flex items-center justify-center rounded-xl text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {historyLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : historyData.length === 0 ? (
                <p className="text-sm text-gray-500">Không có lịch sử</p>
              ) : (
                <div className="space-y-4">
                  {historyData.map(h => (
                    <div key={h.id} className="relative pl-4 border-l-2 border-gray-200">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[h.stage]}`}
                      >
                        {h.stage_display}
                      </span>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(h.entered_at).toLocaleString('vi-VN')}
                        {h.exited_at && ` → ${new Date(h.exited_at).toLocaleString('vi-VN')}`}
                      </p>
                      {h.changed_by_name && (
                        <p className="text-xs text-gray-400">bởi {h.changed_by_name}</p>
                      )}
                      {h.note && <p className="text-xs text-gray-600 mt-1 italic">{h.note}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecruitmentApplications;

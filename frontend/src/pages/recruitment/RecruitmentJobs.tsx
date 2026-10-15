import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  PencilIcon,
  XMarkIcon,
  CheckIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';
import {
  recruitmentService,
  JobListItem,
  JobCreateData,
  JobChannelCreateData,
  ChannelType,
} from '../../services/recruitment.service';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SelectBox } from '../../components/LandingLayout/SelectBox';
import { positionsAPI } from '../../utils/api';

const CHANNEL_TYPE_OPTIONS: { value: ChannelType; label: string }[] = [
  { value: 'WEBSITE', label: 'Website công ty' },
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'TOPCV', label: 'TopCV' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'ITVIEC', label: 'ITViec' },
  { value: 'VIETNAMWORKS', label: 'VietnamWorks' },
  { value: 'CAREERBUILDER', label: 'CareerBuilder' },
  { value: 'REFERRAL', label: 'Giới thiệu nội bộ' },
  { value: 'OTHER', label: 'Khác' },
];

interface JobFormState {
  description: string;
  requirements: string;
  benefits: string;
  position: string; // Position ID or empty string
  recruitment_need?: number; // Optional nhu cầu tuyển dụng
}

const EMPTY_JOB_FORM: JobFormState = {
  description: '',
  requirements: '',
  benefits: '',
  position: '',
  recruitment_need: undefined,
};

interface PositionOption {
  id: number;
  name: string;
  code: string;
}

interface ChannelFormState {
  channel_type: ChannelType;
  url: string;
  notes: string;
}

const EMPTY_CHANNEL_FORM: ChannelFormState = {
  channel_type: 'TOPCV',
  url: '',
  notes: '',
};

const RecruitmentJobs: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Job modal
  const [showJobModal, setShowJobModal] = useState(false);
  const [editingJobId, setEditingJobId] = useState<number | null>(null);
  const [jobForm, setJobForm] = useState<JobFormState>(EMPTY_JOB_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Channel modal
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [channelJobId, setChannelJobId] = useState<number | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelFormState>(EMPTY_CHANNEL_FORM);
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const [positions, setPositions] = useState<PositionOption[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  // Parse JD file
  const [parsing, setParsing] = useState(false);
  const [parsedFileName, setParsedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleParseFile = async (file: File) => {
    setParsing(true);
    try {
      const parsed = await recruitmentService.parseJobFile(file);
      setJobForm(f => ({
        ...f,
        description: parsed.description || f.description,
        requirements: parsed.requirements || f.requirements,
        benefits: parsed.benefits || f.benefits,
      }));
      setParsedFileName(file.name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không đọc được file JD';
      setFormError(msg);
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const fetchPositions = async () => {
    try {
      setPositionsLoading(true);
      const data = await positionsAPI.list({ page_size: 1000 });
      const mapped: PositionOption[] = (data.results || []).map((p: { id: number; title: string; code: string }) => ({
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

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const data = await recruitmentService.listJobs();
      setJobs(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách tin tuyển dụng';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    fetchPositions();
  }, []);

  const openCreateJob = () => {
    setEditingJobId(null);
    setJobForm(EMPTY_JOB_FORM);
    setFormError(null);
    setParsedFileName(null);
    setShowJobModal(true);
  };

  const openEditJob = async (id: number) => {
    try {
      const job = await recruitmentService.getJob(id);
      setEditingJobId(id);
      setJobForm({
        description: job.description,
        requirements: job.requirements,
        benefits: job.benefits,
        position: job.position ? String(job.position) : '',
        recruitment_need: job.recruitment_need ?? undefined,
      });
      setFormError(null);
      setParsedFileName(null);
      setShowJobModal(true);
    } catch {
      alert('Không thể tải thông tin tin tuyển dụng');
    }
  };

  const handleJobSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobForm.position) {
      setFormError('Vui lòng chọn vị trí tuyển dụng');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const selectedPosition = positions.find(p => String(p.id) === jobForm.position);
      const data: JobCreateData = {
        title: selectedPosition?.name ?? '',
        description: jobForm.description,
        requirements: jobForm.requirements,
        benefits: jobForm.benefits,
        position: parseInt(jobForm.position),
      };
      
      // Add recruitment_need if specified
      if (jobForm.recruitment_need) {
        data.recruitment_need = jobForm.recruitment_need;
      }
      
      if (editingJobId) {
        await recruitmentService.updateJob(editingJobId, data);
      } else {
        await recruitmentService.createJob(data);
      }
      setShowJobModal(false);
      await fetchJobs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lưu thất bại';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const openAddChannel = (jobId: number) => {
    setChannelJobId(jobId);
    setChannelForm(EMPTY_CHANNEL_FORM);
    setChannelError(null);
    setShowChannelModal(true);
  };

  const handleChannelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelJobId) return;
    setSavingChannel(true);
    setChannelError(null);
    try {
      const data: JobChannelCreateData = {
        job: channelJobId,
        channel_type: channelForm.channel_type,
        url: channelForm.url,
        notes: channelForm.notes,
        is_active: true,
      };
      await recruitmentService.createJobChannel(data);
      setShowChannelModal(false);
      await fetchJobs();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Thêm kênh thất bại';
      setChannelError(msg);
    } finally {
      setSavingChannel(false);
    }
  };

  const filteredJobs = jobs;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý JD</h1>
          <p className="text-gray-900 mt-1 text-sm">Quản lý nội dung Job Description</p>
        </div>
        <button
          onClick={openCreateJob}
          className="btn-primary flex items-center gap-2"
        >
          <PlusIcon className="h-4 w-4" />
          Tạo JD mới
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl border border-red-100 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : filteredJobs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-500">
          <p className="text-sm">Chưa có tin tuyển dụng nào</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header">Vị trí tuyển dụng</th>
                  <th className="table-header">Kênh</th>
                  <th className="table-header">Tạo lúc</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredJobs.map(job => (
                  <tr
                    key={job.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/dashboard/recruitment/jobs/${job.id}`)}
                  >
                    <td className="table-cell">
                      <p className="text-sm font-semibold text-gray-900">{job.position_name ?? job.title}</p>
                    </td>
                    <td className="table-cell text-sm text-gray-600">{job.channel_count} kênh</td>
                    <td className="table-cell text-sm text-gray-500">
                      {new Date(job.created_at).toLocaleDateString('vi-VN')}
                    </td>
                    <td className="table-cell text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditJob(job.id); }}
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Chỉnh sửa"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openAddChannel(job.id); }}
                          className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                          title="Thêm kênh"
                        >
                          <PlusIcon className="h-4 w-4" />
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

      {/* Job Create/Edit Modal */}
      {showJobModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-base font-bold text-gray-900">
                {editingJobId ? 'Cập nhật tin tuyển dụng' : 'Tạo tin tuyển dụng mới'}
              </h2>
              <button
                onClick={() => setShowJobModal(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleJobSubmit} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vị trí tuyển dụng
                </label>
                {positionsLoading ? (
                  <div className="px-3 py-2.5 border border-gray-300 rounded-xl text-gray-500 text-sm">
                    Đang tải danh sách vị trí...
                  </div>
                ) : (
                  <SelectBox<string>
                    label=""
                    value={jobForm.position}
                    options={positions.map(p => ({ value: String(p.id), label: `${p.name} (${p.code})` }))}
                    onChange={v => setJobForm(f => ({ ...f, position: v }))}
                    placeholder={positions.length === 0 ? 'Không có vị trí nào' : 'Chọn hoặc tìm vị trí...'}
                    searchable={true}
                  />
                )}
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-xs text-emerald-800">
                    <p className="font-semibold mb-0.5">Upload file JD (.docx)</p>
                    <p className="text-emerald-700">
                      Tải lên file Word JD, hệ thống tự tách Mô tả / Yêu cầu / Quyền lợi.
                    </p>
                  </div>
                  <label className="shrink-0 px-3 py-2 rounded-xl border border-emerald-300 bg-white hover:bg-emerald-100 text-sm font-medium text-emerald-700 transition-colors cursor-pointer flex items-center gap-2">
                    <ArrowUpTrayIcon className="h-4 w-4" />
                    {parsing ? 'Đang đọc...' : 'Chọn file'}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx"
                      className="hidden"
                      disabled={parsing}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) handleParseFile(f);
                      }}
                    />
                  </label>
                </div>
                {parsedFileName && (
                  <p className="text-xs text-emerald-700 flex items-center gap-1.5">
                    <CheckIcon className="h-3.5 w-3.5" />
                    Đã đọc: <span className="font-medium">{parsedFileName}</span> — kiểm tra & sửa lại các ô bên dưới nếu cần.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả công việc</label>
                <textarea
                  rows={4}
                  value={jobForm.description}
                  onChange={e => setJobForm(f => ({ ...f, description: e.target.value }))}
                  className="input-field resize-none"
                  placeholder="Mô tả chi tiết công việc..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Yêu cầu</label>
                <textarea
                  rows={3}
                  value={jobForm.requirements}
                  onChange={e => setJobForm(f => ({ ...f, requirements: e.target.value }))}
                  className="input-field resize-none"
                  placeholder="- 2+ năm kinh nghiệm&#10;- Kỹ năng A, B, C"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quyền lợi</label>
                <textarea
                  rows={3}
                  value={jobForm.benefits}
                  onChange={e => setJobForm(f => ({ ...f, benefits: e.target.value }))}
                  className="input-field resize-none"
                  placeholder="- Lương cạnh tranh&#10;- Thưởng KPI"
                />
              </div>
              {formError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>
              )}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 pb-1">
                <button
                  type="button"
                  onClick={() => setShowJobModal(false)}
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
                  {editingJobId ? 'Cập nhật' : 'Tạo mới'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Add Channel Modal */}
      {showChannelModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Thêm kênh đăng tuyển</h2>
              <button
                onClick={() => setShowChannelModal(false)}
                className="h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleChannelSubmit} className="px-6 py-5 space-y-4">
              <SelectBox
                label="Kênh"
                value={channelForm.channel_type}
                options={CHANNEL_TYPE_OPTIONS}
                onChange={(val: ChannelType) =>
                  setChannelForm(f => ({ ...f, channel_type: val }))
                }
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL bài đăng</label>
                <input
                  type="url"
                  value={channelForm.url}
                  onChange={e => setChannelForm(f => ({ ...f, url: e.target.value }))}
                  className="input-field"
                  placeholder="https://..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                <input
                  type="text"
                  value={channelForm.notes}
                  onChange={e => setChannelForm(f => ({ ...f, notes: e.target.value }))}
                  className="input-field"
                  placeholder="VD: Budget: 500k/tháng"
                />
              </div>
              {channelError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{channelError}</p>
              )}
              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100 pb-1">
                <button
                  type="button"
                  onClick={() => setShowChannelModal(false)}
                  className="btn-secondary"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingChannel}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {savingChannel ? (
                    <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CheckIcon className="h-4 w-4" />
                  )}
                  Thêm kênh
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default RecruitmentJobs;

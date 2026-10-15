import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  XMarkIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';
import {
  recruitmentService,
  InterviewListItem,
  InterviewCreateData,
  InterviewType,
  InterviewStatus,
  EvaluationCreateData,
  OfferCreateData,
  Offer,
  InterviewerCandidate,
} from '../../services/recruitment.service';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SelectBox } from '../../components/LandingLayout/SelectBox';

const INTERVIEW_TYPE_OPTIONS: { value: InterviewType; label: string }[] = [
  { value: 'PHONE', label: 'Điện thoại' },
  { value: 'VIDEO', label: 'Video call' },
  { value: 'IN_PERSON', label: 'Trực tiếp' },
  { value: 'TECHNICAL', label: 'Kỹ thuật' },
  { value: 'HR', label: 'HR' },
  { value: 'FINAL', label: 'Vòng cuối' },
];

const STATUS_COLORS: Record<InterviewStatus, string> = {
  SCHEDULED: 'bg-primary-100 text-primary-800',
  DONE: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-red-100 text-red-800',
  NO_SHOW: 'bg-amber-100 text-amber-800',
};

const EMAIL_STATUS_COLORS = {
  sent: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
};

const OFFER_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  ACCEPTED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

type TabKey = 'interviews' | 'offers';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'interviews', label: 'Lịch phỏng vấn' },
  { key: 'offers', label: 'Offer Letter' },
];

interface InterviewFormState {
  application: string;
  interview_type: InterviewType;
  scheduled_at: string;
  duration_minutes: string;
  location: string;
  notes: string;
}

const EMPTY_INTERVIEW_FORM: InterviewFormState = {
  application: '',
  interview_type: 'HR',
  scheduled_at: '',
  duration_minutes: '60',
  location: '',
  notes: '',
};


interface EvalFormState {
  technical_score: string;
  cultural_fit_score: string;
  communication_score: string;
  overall_score: string;
  strengths: string;
  weaknesses: string;
  recommendation: string;
  is_recommended: boolean;
}

const EMPTY_EVAL_FORM: EvalFormState = {
  technical_score: '4',
  cultural_fit_score: '4',
  communication_score: '4',
  overall_score: '4',
  strengths: '',
  weaknesses: '',
  recommendation: '',
  is_recommended: true,
};

interface OfferFormState {
  application: string;
  proposed_salary: string;
  allowances: string;
  position_title: string;
  probation_months: string;
  expected_onboard_date: string;
  notes: string;
}

const EMPTY_OFFER_FORM: OfferFormState = {
  application: '',
  proposed_salary: '',
  allowances: '',
  position_title: '',
  probation_months: '2',
  expected_onboard_date: '',
  notes: '',
};

const ScoreSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  label: string;
}> = ({ value, onChange, label }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="input-field"
    >
      {[1, 2, 3, 4, 5].map(n => (
        <option key={n} value={n}>
          {n} ★
        </option>
      ))}
    </select>
  </div>
);

const RecruitmentInterviews: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('interviews');

  // Interviews
  const [interviews, setInterviews] = useState<InterviewListItem[]>([]);
  const [loadingInterviews, setLoadingInterviews] = useState(true);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Confirm dialog
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmCallback, setConfirmCallback] = useState<(() => void) | null>(null);

  // Create / edit interview modal
  const [showInterviewModal, setShowInterviewModal] = useState(false);
  const [editingInterviewId, setEditingInterviewId] = useState<number | null>(null);
  const [interviewForm, setInterviewForm] = useState<InterviewFormState>(EMPTY_INTERVIEW_FORM);
  const [savingInterview, setSavingInterview] = useState(false);
  const [interviewFormError, setInterviewFormError] = useState<string | null>(null);

  // "Bộ phận phỏng vấn" (Interview.interviewers) — chỉ dùng khi edit, scope riêng cho từng lịch phỏng vấn
  const [needInterviewerId, setNeedInterviewerId] = useState<string>('');
  const [originalNeedInterviewerId, setOriginalNeedInterviewerId] = useState<string>('');
  const [needInterviewerQuery, setNeedInterviewerQuery] = useState('');
  const [needInterviewerCandidates, setNeedInterviewerCandidates] = useState<InterviewerCandidate[]>([]);

  // "Tên ứng viên" — chọn ứng viên khi tạo lịch phỏng vấn (map sang application của ứng viên đó)
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateOptions, setCandidateOptions] = useState<{ value: string; label: string }[]>([]);
  const [editingCandidateName, setEditingCandidateName] = useState('');

  // Evaluation modal
  const [evalInterviewId, setEvalInterviewId] = useState<number | null>(null);
  const [evalForm, setEvalForm] = useState<EvalFormState>(EMPTY_EVAL_FORM);
  const [savingEval, setSavingEval] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Offers
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingOffers, setLoadingOffers] = useState(true);
  const [offerError, setOfferError] = useState<string | null>(null);

  // Create offer modal
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [offerForm, setOfferForm] = useState<OfferFormState>(EMPTY_OFFER_FORM);
  const [savingOffer, setSavingOffer] = useState(false);
  const [offerFormError, setOfferFormError] = useState<string | null>(null);

  // Offer response modal
  const [acceptOfferId, setAcceptOfferId] = useState<number | null>(null);
  const [acceptOnboardDate, setAcceptOnboardDate] = useState('');
  const [rejectOfferId, setRejectOfferId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const needInterviewerOptions = useMemo(() => {
    return [
      { value: '', label: 'Không chọn' },
      ...needInterviewerCandidates.map((emp) => ({
        value: String(emp.user_id),
        label: emp.employee_id ? `${emp.full_name} (${emp.employee_id})` : emp.full_name,
      })),
    ];
  }, [needInterviewerCandidates]);

  const fetchNeedInterviewerUsers = async (query: string = '') => {
    try {
      const data = await recruitmentService.listInterviewerCandidates(query);
      setNeedInterviewerCandidates(data || []);
    } catch (err) {
      console.error('Error fetching interviewer candidates:', err);
      setNeedInterviewerCandidates([]);
    }
  };

  useEffect(() => {
    if (!showInterviewModal || editingInterviewId === null) return;
    const timer = setTimeout(() => {
      fetchNeedInterviewerUsers(needInterviewerQuery);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needInterviewerQuery, showInterviewModal, editingInterviewId]);

  const fetchCandidateOptions = async (query: string = '') => {
    try {
      const data = await recruitmentService.listCandidates(query.trim() ? { search: query.trim() } : undefined);
      setCandidateOptions(
        data
          .filter((c) => !!c.latest_application_id)
          .map((c) => ({
            value: String(c.latest_application_id),
            label: c.latest_job_title ? `${c.full_name} — ${c.latest_job_title}` : c.full_name,
          }))
      );
    } catch (err) {
      console.error('Error fetching candidates:', err);
      setCandidateOptions([]);
    }
  };

  useEffect(() => {
    const isCreatingInterview = showInterviewModal && editingInterviewId === null;
    if (!isCreatingInterview && !showOfferModal) return;
    const timer = setTimeout(() => {
      fetchCandidateOptions(candidateQuery);
    }, 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateQuery, showInterviewModal, editingInterviewId, showOfferModal]);

  const fetchInterviews = async () => {
    try {
      setLoadingInterviews(true);
      const params: { status?: InterviewStatus } = {};
      if (statusFilter !== 'all') params.status = statusFilter as InterviewStatus;
      const data = await recruitmentService.listInterviews(params);
      setInterviews(data);
      setInterviewError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách phỏng vấn';
      setInterviewError(msg);
    } finally {
      setLoadingInterviews(false);
    }
  };

  const fetchOffers = async () => {
    try {
      setLoadingOffers(true);
      const data = await recruitmentService.listOffers();
      setOffers(data);
      setOfferError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách offer';
      setOfferError(msg);
    } finally {
      setLoadingOffers(false);
    }
  };

  useEffect(() => {
    fetchInterviews();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if (activeTab === 'offers') {
      fetchOffers();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const openEditInterview = (iv: InterviewListItem) => {
    setEditingInterviewId(iv.id);
    setInterviewForm({
      application: String(iv.application),
      interview_type: iv.interview_type,
      scheduled_at: iv.scheduled_at ? iv.scheduled_at.slice(0, 16) : '',
      duration_minutes: String(iv.duration_minutes ?? 60),
      location: iv.location || '',
      notes: '',
    });
    const currentInterviewer = iv.interviewer_user_ids?.[0] ? String(iv.interviewer_user_ids[0]) : '';
    setNeedInterviewerId(currentInterviewer);
    setOriginalNeedInterviewerId(currentInterviewer);
    setNeedInterviewerQuery('');
    setNeedInterviewerCandidates([]);
    fetchNeedInterviewerUsers();
    setEditingCandidateName(iv.candidate_name || '');
    setInterviewFormError(null);
    setShowInterviewModal(true);
  };

  const handleCreateInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interviewForm.application) {
      setInterviewFormError('Vui lòng chọn ứng viên');
      return;
    }
    setSavingInterview(true);
    setInterviewFormError(null);
    try {
      const data: InterviewCreateData = {
        application: parseInt(interviewForm.application),
        interview_type: interviewForm.interview_type,
        scheduled_at: interviewForm.scheduled_at,
        duration_minutes: parseInt(interviewForm.duration_minutes) || 60,
        location: interviewForm.location || undefined,
        notes: interviewForm.notes || undefined,
      };
      if (editingInterviewId !== null) {
        await recruitmentService.updateInterview(editingInterviewId, data);
        if (needInterviewerId !== originalNeedInterviewerId) {
          await recruitmentService.setInterviewInterviewer(
            editingInterviewId,
            needInterviewerId ? parseInt(needInterviewerId) : null,
          );
        }
      } else {
        await recruitmentService.createInterview(data);
      }
      setShowInterviewModal(false);
      setEditingInterviewId(null);
      await fetchInterviews();
    } catch (err: unknown) {
      const msg = err instanceof Error
        ? err.message
        : (editingInterviewId !== null ? 'Cập nhật lịch thất bại' : 'Tạo lịch thất bại');
      setInterviewFormError(msg);
    } finally {
      setSavingInterview(false);
    }
  };

  const openConfirm = (title: string, message: string, cb: () => void) => {
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmCallback(() => cb);
    setConfirmOpen(true);
  };

  const handleMarkDone = (id: number) => {
    openConfirm(
      'Hoàn thành phỏng vấn',
      'Đánh dấu buổi phỏng vấn này là đã hoàn thành?',
      async () => {
        try {
          await recruitmentService.markInterviewDone(id);
          await fetchInterviews();
        } catch {
          // silent
        }
      }
    );
  };

  const handleCancelInterview = (id: number) => {
    openConfirm(
      'Hủy lịch phỏng vấn',
      'Bạn có chắc muốn hủy lịch phỏng vấn này không?',
      async () => {
        try {
          await recruitmentService.cancelInterview(id);
          await fetchInterviews();
        } catch {
          // silent
        }
      }
    );
  };

  const handleMarkNoShow = (id: number) => {
    openConfirm(
      'Ứng viên không đến',
      'Đánh dấu ứng viên không đến buổi phỏng vấn này?',
      async () => {
        try {
          await recruitmentService.markInterviewNoShow(id);
          await fetchInterviews();
        } catch {
          // silent
        }
      }
    );
  };

  const handleCreateEval = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!evalInterviewId) return;
    setSavingEval(true);
    setEvalError(null);
    try {
      const data: EvaluationCreateData = {
        interview: evalInterviewId,
        technical_score: parseInt(evalForm.technical_score),
        cultural_fit_score: parseInt(evalForm.cultural_fit_score),
        communication_score: parseInt(evalForm.communication_score),
        overall_score: parseInt(evalForm.overall_score),
        strengths: evalForm.strengths || undefined,
        weaknesses: evalForm.weaknesses || undefined,
        recommendation: evalForm.recommendation || undefined,
        is_recommended: evalForm.is_recommended,
      };
      await recruitmentService.createEvaluation(data);
      setEvalInterviewId(null);
      await fetchInterviews();
    } catch (err: unknown) {
      let msg = 'Lưu đánh giá thất bại';
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      if (e?.response?.data?.detail) msg = e.response.data.detail;
      else if (e?.message) msg = e.message;
      setEvalError(msg);
    } finally {
      setSavingEval(false);
    }
  };

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!offerForm.application || !offerForm.proposed_salary) {
      setOfferFormError('Vui lòng nhập ID đơn ứng tuyển và mức lương đề xuất');
      return;
    }
    setSavingOffer(true);
    setOfferFormError(null);
    try {
      const data: OfferCreateData = {
        application: parseInt(offerForm.application),
        proposed_salary: parseFloat(offerForm.proposed_salary),
        allowances: offerForm.allowances ? parseFloat(offerForm.allowances) : undefined,
        position_title: offerForm.position_title || undefined,
        probation_months: parseInt(offerForm.probation_months) || 2,
        expected_onboard_date: offerForm.expected_onboard_date || undefined,
        notes: offerForm.notes || undefined,
      };
      await recruitmentService.createOffer(data);
      setShowOfferModal(false);
      await fetchOffers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Tạo offer thất bại';
      setOfferFormError(msg);
    } finally {
      setSavingOffer(false);
    }
  };

  const handleAcceptOffer = async () => {
    if (!acceptOfferId) return;
    try {
      await recruitmentService.acceptOffer(acceptOfferId, {
        actual_onboard_date: acceptOnboardDate || undefined,
      });
      setAcceptOfferId(null);
      setAcceptOnboardDate('');
      await fetchOffers();
    } catch {
      // silent
    }
  };

  const handleRejectOffer = async () => {
    if (!rejectOfferId) return;
    try {
      await recruitmentService.rejectOffer(rejectOfferId, rejectNote || undefined);
      setRejectOfferId(null);
      setRejectNote('');
      await fetchOffers();
    } catch {
      // silent
    }
  };

  const handleOnboardFromInterview = (iv: InterviewListItem) => {
    const params = new URLSearchParams();
    params.set('openCreate', '1');
    if (iv.candidate_name) params.set('name', iv.candidate_name);
    if (iv.candidate_gender) params.set('gender', iv.candidate_gender);
    if (iv.candidate_email) params.set('email', iv.candidate_email);
    if (iv.interviewer_employee_id) params.set('manager', String(iv.interviewer_employee_id));
    navigate(`/dashboard/onboarding?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Phỏng vấn & Offer</h1>
          <p className="text-gray-500 mt-1 text-sm">Quản lý lịch phỏng vấn, đánh giá và offer letter</p>
        </div>
        {activeTab === 'interviews' ? (
          <button
            onClick={() => {
              setEditingInterviewId(null);
              setInterviewForm(EMPTY_INTERVIEW_FORM);
              setInterviewFormError(null);
              setCandidateQuery('');
              setCandidateOptions([]);
              fetchCandidateOptions();
              setShowInterviewModal(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            Lên lịch phỏng vấn
          </button>
        ) : (
          <button
            onClick={() => {
              setOfferForm(EMPTY_OFFER_FORM);
              setOfferFormError(null);
              setCandidateQuery('');
              setCandidateOptions([]);
              fetchCandidateOptions();
              setShowOfferModal(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <PlusIcon className="h-4 w-4" />
            Tạo offer
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Interviews Tab */}
      {activeTab === 'interviews' && (
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'all', label: 'Tất cả' },
                { value: 'SCHEDULED', label: 'Đã lên lịch' },
                { value: 'DONE', label: 'Đã phỏng vấn' },
                { value: 'CANCELLED', label: 'Đã hủy' },
                { value: 'NO_SHOW', label: 'Không đến' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                    statusFilter === opt.value
                      ? 'bg-primary-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {interviewError && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl mb-4 text-sm">
              {interviewError}
            </div>
          )}
          {loadingInterviews ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : interviews.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>Chưa có lịch phỏng vấn nào</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">Tuyển dụng phụ trách</th>
                    <th className="table-header">Ứng viên</th>
                    <th className="table-header">Vị trí ứng tuyển</th>
                    <th className="table-header">BP phỏng vấn</th>
                    <th className="table-header">Nguồn</th>
                    <th className="table-header">CV</th>
                    <th className="table-header">Ghi chú</th>
                    <th className="table-header">Loại</th>
                    <th className="table-header">Thời gian</th>
                    <th className="table-header">Địa điểm</th>
                    <th className="table-header">Trạng thái</th>
                    <th className="table-header">Mail</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {interviews.map(iv => (
                    <tr
                      key={iv.id}
                      onClick={() => openEditInterview(iv)}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="table-cell">
                        {iv.recruiter_employee_id || iv.recruiter_full_name ? (
                          <span className="text-sm text-gray-900">
                            {iv.recruiter_employee_id && <span className="font-semibold">{iv.recruiter_employee_id}</span>}
                            {iv.recruiter_employee_id && iv.recruiter_full_name ? ' — ' : ''}
                            {iv.recruiter_full_name || ''}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <p className="text-sm font-medium text-gray-900">{iv.candidate_name}</p>
                        {iv.candidate_email && <p className="text-xs text-gray-400">{iv.candidate_email}</p>}
                        {iv.candidate_phone && <p className="text-xs text-gray-400">{iv.candidate_phone}</p>}
                      </td>
                      <td className="table-cell text-sm text-gray-900">
                        {iv.job_title || '—'}
                      </td>
                      <td className="table-cell">
                        {(() => {
                          const empCode = iv.interviewer_employee_code || iv.need_interviewer_employee_id;
                          const fullName = iv.interviewer_full_name || iv.need_interviewer_full_name;
                          return empCode || fullName ? (
                            <span className="text-sm text-gray-900">
                              {empCode && <span className="font-semibold">{empCode}</span>}
                              {empCode && fullName ? ' — ' : ''}
                              {fullName || ''}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          );
                        })()}
                      </td>
                      <td className="table-cell text-sm text-gray-700">
                        {iv.candidate_source_display || '—'}
                      </td>
                      <td className="table-cell text-center">
                        {iv.candidate_cv_file_url || iv.candidate_cv_url ? (
                          <a
                            href={iv.candidate_cv_file_url || iv.candidate_cv_url || ''}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200 text-xs font-semibold transition-colors"
                            title="Xem CV"
                          >
                            Xem CV
                          </a>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="table-cell text-sm text-gray-700 max-w-xs">
                        <span className="line-clamp-2" title={iv.candidate_notes || ''}>
                          {iv.candidate_notes || '—'}
                        </span>
                      </td>
                      <td className="table-cell text-sm text-gray-700">
                        {iv.interview_type_display}
                      </td>
                      <td className="table-cell text-sm text-gray-700">
                        {new Date(iv.scheduled_at).toLocaleString('vi-VN')}
                        <p className="text-xs text-gray-400">{iv.duration_minutes} phút</p>
                      </td>
                      <td className="table-cell text-sm text-gray-700 max-w-xs truncate">
                        {iv.location || '—'}
                      </td>
                      <td className="table-cell">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[iv.status]}`}
                        >
                          {iv.status_display}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${iv.interview_email_sent ? EMAIL_STATUS_COLORS.sent : EMAIL_STATUS_COLORS.pending}`}
                        >
                          {iv.interview_email_sent ? 'Đã gửi' : 'Chưa gửi'}
                        </span>
                        {iv.interview_email_sent_at && (
                          <p className="text-xs text-gray-400 mt-1">
                            {new Date(iv.interview_email_sent_at).toLocaleString('vi-VN')}
                          </p>
                        )}
                      </td>
                      <td className="table-cell text-right">
                        <div
                          className="flex items-center gap-2 justify-end"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {iv.status === 'SCHEDULED' && (
                            <>
                              <button
                                onClick={() => handleMarkDone(iv.id)}
                                className="text-gray-400 hover:text-emerald-600 text-xs font-medium transition-colors"
                                title="Đánh dấu hoàn thành"
                              >
                                Hoàn thành
                              </button>
                              <button
                                onClick={() => handleMarkNoShow(iv.id)}
                                className="text-gray-400 hover:text-amber-600 text-xs font-medium transition-colors"
                                title="Đánh dấu không đến"
                              >
                                Không đến
                              </button>
                              <button
                                onClick={() => handleCancelInterview(iv.id)}
                                className="text-gray-400 hover:text-red-600 text-xs font-medium transition-colors"
                                title="Hủy lịch"
                              >
                                Hủy
                              </button>
                            </>
                          )}
                          {iv.status === 'DONE' && (
                            <>
                              {(iv.evaluation_count ?? 0) > 0 ? (
                                <button
                                  type="button"
                                  disabled
                                  title="Phỏng vấn này đã được đánh giá"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium cursor-not-allowed"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                  Đã đánh giá
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEvalInterviewId(iv.id);
                                    setEvalForm(EMPTY_EVAL_FORM);
                                    setEvalError(null);
                                  }}
                                  title="Đánh giá phỏng vấn"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-700 hover:bg-violet-100 hover:border-violet-300 text-xs font-medium transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118L2.05 10.1c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.518-4.673z" />
                                  </svg>
                                  Đánh giá
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOnboardFromInterview(iv)}
                                title="Tạo quy trình onboarding cho ứng viên"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 hover:border-blue-300 text-xs font-medium transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                                Onboard
                              </button>
                            </>
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
        </div>
      )}

      {/* Offers Tab */}
      {activeTab === 'offers' && (
        <div className="space-y-4">
          {offerError && (
            <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl mb-4 text-sm">
              {offerError}
            </div>
          )}
          {loadingOffers ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : offers.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>Chưa có offer nào</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header">
                      Ứng viên
                    </th>
                    <th className="table-header">
                      Vị trí
                    </th>
                    <th className="table-header">Lương đề xuất</th>
                    <th className="table-header">Onboard dự kiến</th>
                    <th className="table-header">Trạng thái</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {offers.map(offer => (
                    <tr key={offer.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell">
                        <p className="text-sm font-medium text-gray-900">{offer.candidate_name}</p>
                        <p className="text-xs text-gray-400">{offer.job_title}</p>
                      </td>
                      <td className="table-cell text-sm text-gray-700">
                        {offer.position_title || '—'}
                        <p className="text-xs text-gray-400">
                          Thử việc {offer.probation_months} tháng
                        </p>
                      </td>
                      <td className="table-cell text-sm text-gray-700">
                        {parseInt(offer.proposed_salary).toLocaleString('vi-VN')}đ
                        {offer.allowances && parseInt(offer.allowances) > 0 && (
                          <p className="text-xs text-gray-400">
                            + {parseInt(offer.allowances).toLocaleString('vi-VN')}đ phụ cấp
                          </p>
                        )}
                      </td>
                      <td className="table-cell text-sm text-gray-700">
                        {offer.expected_onboard_date
                          ? new Date(offer.expected_onboard_date).toLocaleDateString('vi-VN')
                          : '—'}
                      </td>
                      <td className="table-cell">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${OFFER_STATUS_COLORS[offer.status] ?? 'bg-gray-100 text-gray-800'}`}
                        >
                          {offer.status_display}
                        </span>
                      </td>
                      <td className="table-cell text-right">
                        {offer.status === 'PENDING' && (
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => {
                                setAcceptOfferId(offer.id);
                                setAcceptOnboardDate('');
                              }}
                              className="text-gray-400 hover:text-emerald-600 text-xs font-medium transition-colors"
                            >
                              Chấp nhận
                            </button>
                            <button
                              onClick={() => {
                                setRejectOfferId(offer.id);
                                setRejectNote('');
                              }}
                              className="text-gray-400 hover:text-red-600 text-xs font-medium transition-colors"
                            >
                              Từ chối
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Interview Modal */}
      {showInterviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingInterviewId !== null ? 'Chỉnh sửa lịch phỏng vấn' : 'Lên lịch phỏng vấn'}
              </h2>
              <button
                onClick={() => {
                  setShowInterviewModal(false);
                  setEditingInterviewId(null);
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateInterview} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tên ứng viên <span className="text-red-500">*</span>
                </label>
                {editingInterviewId !== null ? (
                  <input
                    type="text"
                    value={editingCandidateName}
                    disabled
                    className="input-field disabled:bg-gray-100 disabled:text-gray-500"
                  />
                ) : (
                  <SelectBox<string>
                    label=""
                    value={interviewForm.application}
                    options={candidateOptions}
                    onQueryChange={setCandidateQuery}
                    onChange={v => setInterviewForm(f => ({ ...f, application: v }))}
                    placeholder="Tìm theo tên ứng viên..."
                    searchable={true}
                    portal={true}
                  />
                )}
              </div>
              {editingInterviewId !== null && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bộ phận phỏng vấn
                  </label>
                  <SelectBox<string>
                    label=""
                    value={needInterviewerId}
                    options={needInterviewerOptions}
                    onQueryChange={setNeedInterviewerQuery}
                    onChange={setNeedInterviewerId}
                    placeholder="Tìm theo tên hoặc mã nhân viên..."
                    searchable={true}
                    portal={true}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Loại</label>
                  <select
                    value={interviewForm.interview_type}
                    onChange={e =>
                      setInterviewForm(f => ({
                        ...f,
                        interview_type: e.target.value as InterviewType,
                      }))
                    }
                    className="input-field"
                  >
                    {INTERVIEW_TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Thời lượng (phút)
                  </label>
                  <input
                    type="number"
                    value={interviewForm.duration_minutes}
                    onChange={e =>
                      setInterviewForm(f => ({ ...f, duration_minutes: e.target.value }))
                    }
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Thời gian phỏng vấn
                </label>
                <input
                  type="datetime-local"
                  value={interviewForm.scheduled_at}
                  onChange={e =>
                    setInterviewForm(f => ({ ...f, scheduled_at: e.target.value }))
                  }
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Địa điểm</label>
                <input
                  type="text"
                  value={interviewForm.location}
                  onChange={e =>
                    setInterviewForm(f => ({ ...f, location: e.target.value }))
                  }
                  className="input-field"
                  placeholder="VD: Phòng họp A3 hoặc link meet..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={interviewForm.notes}
                  onChange={e =>
                    setInterviewForm(f => ({ ...f, notes: e.target.value }))
                  }
                  className="input-field"
                />
              </div>
              {interviewFormError && (
                <p className="text-sm text-red-600">{interviewFormError}</p>
              )}
              <div className="flex justify-end gap-3 pt-2 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowInterviewModal(false);
                    setEditingInterviewId(null);
                  }}
                  className="btn-secondary"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingInterview}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {savingInterview ? (
                    <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CheckIcon className="h-4 w-4" />
                  )}
                  {editingInterviewId !== null ? 'Lưu thay đổi' : 'Lên lịch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Evaluation Modal */}
      {evalInterviewId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Đánh giá phỏng vấn</h2>
              <button
                onClick={() => setEvalInterviewId(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateEval} className="px-6 py-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <ScoreSelect
                  label="Kỹ năng kỹ thuật"
                  value={evalForm.technical_score}
                  onChange={v => setEvalForm(f => ({ ...f, technical_score: v }))}
                />
                <ScoreSelect
                  label="Phù hợp văn hóa"
                  value={evalForm.cultural_fit_score}
                  onChange={v => setEvalForm(f => ({ ...f, cultural_fit_score: v }))}
                />
                <ScoreSelect
                  label="Giao tiếp"
                  value={evalForm.communication_score}
                  onChange={v => setEvalForm(f => ({ ...f, communication_score: v }))}
                />
                <ScoreSelect
                  label="Tổng thể"
                  value={evalForm.overall_score}
                  onChange={v => setEvalForm(f => ({ ...f, overall_score: v }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Điểm mạnh</label>
                <textarea
                  rows={2}
                  value={evalForm.strengths}
                  onChange={e => setEvalForm(f => ({ ...f, strengths: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Điểm yếu</label>
                <textarea
                  rows={2}
                  value={evalForm.weaknesses}
                  onChange={e => setEvalForm(f => ({ ...f, weaknesses: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Đề xuất</label>
                <textarea
                  rows={2}
                  value={evalForm.recommendation}
                  onChange={e => setEvalForm(f => ({ ...f, recommendation: e.target.value }))}
                  className="input-field"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_recommended"
                  checked={evalForm.is_recommended}
                  onChange={e => setEvalForm(f => ({ ...f, is_recommended: e.target.checked }))}
                  className="h-4 w-4 text-primary-600 border-gray-300 rounded"
                />
                <label htmlFor="is_recommended" className="text-sm font-medium text-gray-700">
                  Đề nghị tuyển dụng
                </label>
              </div>
              {evalError && <p className="text-sm text-red-600">{evalError}</p>}
              <div className="flex justify-end gap-3 pt-2 pb-2">
                <button
                  type="button"
                  onClick={() => setEvalInterviewId(null)}
                  className="btn-secondary"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingEval}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {savingEval ? (
                    <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CheckIcon className="h-4 w-4" />
                  )}
                  Lưu đánh giá
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Offer Modal */}
      {showOfferModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-lg font-semibold text-gray-900">Tạo Offer Letter</h2>
              <button
                onClick={() => setShowOfferModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateOffer} className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tên ứng viên <span className="text-red-500">*</span>
                </label>
                <SelectBox<string>
                  label=""
                  value={offerForm.application}
                  options={candidateOptions}
                  onQueryChange={setCandidateQuery}
                  onChange={v => setOfferForm(f => ({ ...f, application: v }))}
                  placeholder="Tìm theo tên ứng viên..."
                  searchable={true}
                  portal={true}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lương đề xuất (đ) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={offerForm.proposed_salary}
                    onChange={e => setOfferForm(f => ({ ...f, proposed_salary: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phụ cấp (đ)
                  </label>
                  <input
                    type="number"
                    value={offerForm.allowances}
                    onChange={e => setOfferForm(f => ({ ...f, allowances: e.target.value }))}
                    className="input-field"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tên vị trí</label>
                  <input
                    type="text"
                    value={offerForm.position_title}
                    onChange={e => setOfferForm(f => ({ ...f, position_title: e.target.value }))}
                    className="input-field"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Thử việc (tháng)
                  </label>
                  <input
                    type="number"
                    value={offerForm.probation_months}
                    onChange={e => setOfferForm(f => ({ ...f, probation_months: e.target.value }))}
                    className="input-field"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ngày onboard dự kiến
                </label>
                <input
                  type="date"
                  value={offerForm.expected_onboard_date}
                  onChange={e =>
                    setOfferForm(f => ({ ...f, expected_onboard_date: e.target.value }))
                  }
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                <textarea
                  rows={2}
                  value={offerForm.notes}
                  onChange={e => setOfferForm(f => ({ ...f, notes: e.target.value }))}
                  className="input-field"
                />
              </div>
              {offerFormError && <p className="text-sm text-red-600">{offerFormError}</p>}
              <div className="flex justify-end gap-3 pt-2 pb-2">
                <button
                  type="button"
                  onClick={() => setShowOfferModal(false)}
                  className="btn-secondary"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={savingOffer}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {savingOffer ? (
                    <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CheckIcon className="h-4 w-4" />
                  )}
                  Tạo offer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Accept Offer Modal */}
      {acceptOfferId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Chấp nhận Offer</h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-gray-600">Ngày onboard thực tế:</p>
              <input
                type="date"
                value={acceptOnboardDate}
                onChange={e => setAcceptOnboardDate(e.target.value)}
                className="input-field"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
              <button
                onClick={() => setAcceptOfferId(null)}
                className="btn-secondary"
              >
                Hủy
              </button>
              <button
                onClick={handleAcceptOffer}
                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors"
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Offer Modal */}
      {rejectOfferId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">Từ chối Offer</h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-gray-600">Lý do từ chối:</p>
              <textarea
                rows={3}
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                className="input-field"
                placeholder="VD: Ứng viên nhận offer từ công ty khác"
              />
            </div>
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
              <button
                onClick={() => setRejectOfferId(null)}
                className="btn-secondary"
              >
                Hủy
              </button>
              <button
                onClick={handleRejectOffer}
                className="btn-danger"
              >
                Từ chối
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        onConfirm={() => {
          setConfirmOpen(false);
          if (confirmCallback) confirmCallback();
        }}
        onClose={() => setConfirmOpen(false)}
      />
    </div>
  );
};

export default RecruitmentInterviews;

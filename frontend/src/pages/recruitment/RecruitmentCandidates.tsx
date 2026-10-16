import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  PlusIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  CheckIcon,
  UserGroupIcon,
  PencilSquareIcon,
  TrashIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import {
  recruitmentService,
  CandidateListItem,
  CandidateCreateData,
  CandidateSource,
  CandidateStatus,
  CandidateCvPreviewResponse,
  RecruitmentNeedListItem,
  ApplicationListItem,
  ApplicationScheduleOptions,
  InterviewType,
} from '../../services/recruitment.service';
import { SelectBox } from '../../components/LandingLayout/SelectBox';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useAuth } from '../../contexts/AuthContext';
import PdfFrame from '../../components/Common/PdfFrame';

const SOURCE_OPTIONS: { value: CandidateSource; label: string }[] = [
  { value: 'HR_PERSONAL', label: 'HR cá nhân' },
  { value: 'ADS_FACEBOOK', label: 'Ads facebook' },
  { value: 'COLLABORATOR', label: 'CTV tuyển dụng' },
  { value: 'REFERRAL', label: 'Giới thiệu nội bộ' },
];

const STATUS_OPTIONS: { value: CandidateStatus; label: string }[] = [
  { value: 'PENDING_CV_REVIEW', label: 'Đang chờ duyệt CV' },
  { value: 'INTERVIEW_SCHEDULED', label: 'Hẹn phỏng vấn' },
  { value: 'INTERVIEWING', label: 'Đang phỏng vấn' },
  { value: 'INTERVIEW_PASSED', label: 'Đạt phỏng vấn' },
  { value: 'INTERVIEW_FAILED', label: 'Không đạt phỏng vấn' },
  { value: 'CONSIDERING', label: 'Cân nhắc ứng viên' },
  { value: 'CV_SAVED', label: 'Lưu CV (lần tới cần thì gọi)' },
];

const STATUS_BADGE_CLASS: Record<CandidateStatus, string> = {
  PENDING_CV_REVIEW: 'bg-amber-100 text-amber-700',
  CV_APPROVED: 'bg-emerald-50 text-emerald-700',
  INTERVIEW_SCHEDULED: 'bg-sky-100 text-sky-700',
  INTERVIEWING: 'bg-indigo-100 text-indigo-700',
  INTERVIEW_PASSED: 'bg-emerald-100 text-emerald-700',
  INTERVIEW_FAILED: 'bg-red-100 text-red-700',
  CONSIDERING: 'bg-violet-100 text-violet-700',
  CV_SAVED: 'bg-gray-100 text-gray-700',
};

interface ScheduleInterviewFormState {
  interview_type: InterviewType;
  date: string;
  time: string;
  duration_minutes: string;
  room_id: string;
  notes: string;
}

const INTERVIEW_TYPE_OPTIONS: { value: InterviewType; label: string }[] = [
  { value: 'PHONE', label: 'Điện thoại' },
  { value: 'VIDEO', label: 'Video call' },
  { value: 'IN_PERSON', label: 'Trực tiếp' },
  { value: 'TECHNICAL', label: 'Kỹ thuật' },
  { value: 'HR', label: 'HR' },
  { value: 'FINAL', label: 'Vòng cuối' },
];

interface CandidateFormState {
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  date_of_birth: string;
  address: string;
  cv_url: string;
  skills: string;
  experience_years: string;
  experience_summary: string;
  overall_evaluation: string;
  education: string;
  current_company: string;
  current_position: string;
  expected_salary: string;
  source: CandidateSource;
  status: CandidateStatus;
  tags: string;
  notes: string;
  referral_need: string;
  referral_note: string;
  cv_file: File | string | null;
}

const EMPTY_FORM: CandidateFormState = {
  full_name: '',
  email: '',
  phone: '',
  gender: '',
  date_of_birth: '',
  address: '',
  cv_url: '',
  skills: '',
  experience_years: '',
  experience_summary: '',
  overall_evaluation: '',
  education: '',
  current_company: '',
  current_position: '',
  expected_salary: '',
  source: 'HR_PERSONAL',
  status: 'PENDING_CV_REVIEW',
  tags: '',
  notes: '',
  referral_need: '',
  referral_note: '',
  cv_file: null,
};

const pickPreviewValue = (current: string, next?: string | null) => {
  if (!next) return current;
  return current.trim() ? current : next;
};

const normalizePreviewText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizePreviewText(item))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, val]) => {
        const normalized = normalizePreviewText(val);
        return normalized ? `${key}: ${normalized}` : '';
      })
      .filter(Boolean);

    return entries.join(' | ');
  }

  return '';
};

const mergePreviewToForm = (form: CandidateFormState, preview: CandidateCvPreviewResponse): CandidateFormState => {
  const candidate = preview.candidate || {};
  return {
    ...form,
    full_name: pickPreviewValue(form.full_name, normalizePreviewText(candidate.full_name)),
    email: pickPreviewValue(form.email, normalizePreviewText(candidate.email)),
    phone: pickPreviewValue(form.phone, normalizePreviewText(candidate.phone)),
    gender: pickPreviewValue(form.gender, normalizePreviewText(candidate.gender)),
    date_of_birth: pickPreviewValue(form.date_of_birth, normalizePreviewText(candidate.date_of_birth)),
    address: pickPreviewValue(form.address, normalizePreviewText(candidate.address)),
    skills: pickPreviewValue(form.skills, normalizePreviewText(candidate.skills)),
    experience_years: pickPreviewValue(form.experience_years, candidate.experience_years != null ? String(candidate.experience_years) : ''),
    experience_summary: pickPreviewValue(form.experience_summary, normalizePreviewText(candidate.experience_summary)),
    overall_evaluation: pickPreviewValue(form.overall_evaluation, normalizePreviewText(candidate.overall_evaluation)),
    education: pickPreviewValue(form.education, normalizePreviewText(candidate.education)),
    current_company: pickPreviewValue(form.current_company, normalizePreviewText(candidate.current_company)),
    current_position: pickPreviewValue(form.current_position, normalizePreviewText(candidate.current_position)),
    expected_salary: pickPreviewValue(form.expected_salary, candidate.expected_salary != null ? String(candidate.expected_salary) : ''),
    source: 'HR_PERSONAL',
    tags: pickPreviewValue(form.tags, normalizePreviewText(candidate.tags)),
    notes: pickPreviewValue(form.notes, normalizePreviewText(candidate.notes)),
    cv_file: preview.cv_file,
    cv_url: '',
  };
};

const RecruitmentCandidates: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [candidates, setCandidates] = useState<CandidateListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [blacklistFilter, setBlacklistFilter] = useState<string>('all');

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [showCvUploadModal, setShowCvUploadModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CandidateFormState>(EMPTY_FORM);
  const [needs, setNeeds] = useState<RecruitmentNeedListItem[]>([]);
  const [cvPreview, setCvPreview] = useState<CandidateCvPreviewResponse | null>(null);
  const [currentCvUrl, setCurrentCvUrl] = useState<string | null>(null);
  const [cvProcessing, setCvProcessing] = useState(false);
  const [cvDragActive, setCvDragActive] = useState(false);
  const [cvUploadDragActive, setCvUploadDragActive] = useState(false);
  const [cvPreviewError, setCvPreviewError] = useState<string | null>(null);

  const [deleteConfirm, setDeleteConfirm] = useState<CandidateListItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Schedule interview modal (duplicated from RecruitmentNeedDetail)
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<ApplicationListItem | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleInterviewFormState>({
    interview_type: 'HR',
    date: '',
    time: '',
    duration_minutes: '60',
    room_id: '',
    notes: '',
  });
  const [scheduleOptions, setScheduleOptions] = useState<ApplicationScheduleOptions | null>(null);
  const [loadingScheduleOptions, setLoadingScheduleOptions] = useState(false);
  const [schedulingInterview, setSchedulingInterview] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [previewingScheduleEmail, setPreviewingScheduleEmail] = useState(false);
  const [showEmailPreviewModal, setShowEmailPreviewModal] = useState(false);
  const [scheduleEmailPreview, setScheduleEmailPreview] = useState<{ subject: string; body_html: string; body_text?: string } | null>(null);

  const referralNeedFromQuery = searchParams.get('referralNeed') || '';
  const shouldOpenReferral = searchParams.get('openReferral') === '1';
  const needCvContextId = (() => {
    if (searchParams.get('openNeedCv') !== '1') return null;
    const raw = searchParams.get('needId');
    if (!raw) return null;
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  })();

  const clearReferralParams = useCallback(() => {
    if (
      !searchParams.get('openReferral')
      && !searchParams.get('referralNeed')
      && !searchParams.get('openNeedCv')
      && !searchParams.get('needId')
    ) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('openReferral');
    nextParams.delete('referralNeed');
    nextParams.delete('openNeedCv');
    nextParams.delete('needId');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeModal = () => {
    setShowModal(false);
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
    setCvPreview(null);
    setCurrentCvUrl(null);
    setCvProcessing(false);
    setCvDragActive(false);
    setCvPreviewError(null);

    clearReferralParams();
  };

  const closeCvUploadModal = () => {
    setShowCvUploadModal(false);
    setCvUploadDragActive(false);
    setCvPreviewError(null);
    setCvProcessing(false);
    clearReferralParams();
  };

  const fetchCandidates = useCallback(async () => {
    try {
      setLoading(true);
      const params: { search?: string; source?: CandidateSource; status?: CandidateStatus; blacklisted?: boolean } = {};
      if (searchTerm) params.search = searchTerm;
      if (sourceFilter !== 'all') params.source = sourceFilter as CandidateSource;
      if (statusFilter !== 'all') params.status = statusFilter as CandidateStatus;
      if (blacklistFilter === 'blacklisted') params.blacklisted = true;
      if (blacklistFilter === 'active') params.blacklisted = false;
      const data = await recruitmentService.listCandidates(params);
      setCandidates(data);
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách ứng viên';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, sourceFilter, statusFilter, blacklistFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchCandidates, 300);
    return () => clearTimeout(timer);
  }, [fetchCandidates]);

  useEffect(() => {
    const fetchNeeds = async () => {
      try {
        const data = await recruitmentService.listNeeds();
        setNeeds(data);
      } catch {
        setNeeds([]);
      }
    };

    fetchNeeds();
  }, []);

  useEffect(() => {
    if (!shouldOpenReferral || showModal) return;

    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      source: 'REFERRAL',
      referral_need: referralNeedFromQuery,
    });
    setFormError(null);
    setShowModal(true);
  }, [referralNeedFromQuery, shouldOpenReferral, showModal]);

  useEffect(() => {
    if (!needCvContextId || showCvUploadModal || showModal) return;

    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      source: 'REFERRAL',
      referral_need: String(needCvContextId),
    });
    setFormError(null);
    setCvPreview(null);
    setCurrentCvUrl(null);
    setCvPreviewError(null);
    setShowCvUploadModal(true);
  }, [needCvContextId, showCvUploadModal, showModal]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setCvPreview(null);
    setCurrentCvUrl(null);
    setCvPreviewError(null);
    setShowModal(true);
  };

  const openCvUploadModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setCvPreview(null);
    setCurrentCvUrl(null);
    setCvPreviewError(null);
    setCvUploadDragActive(false);
    setShowCvUploadModal(true);
  };

  const openEdit = async (id: number) => {
    try {
      const c = await recruitmentService.getCandidate(id);
      setEditingId(id);
      setForm({
        full_name: c.full_name,
        email: c.email,
        phone: c.phone,
        gender: c.gender,
        date_of_birth: c.date_of_birth ?? '',
        address: c.address,
        cv_url: c.cv_url,
        skills: c.skills,
        experience_years: c.experience_years != null ? String(c.experience_years) : '',
        experience_summary: c.experience_summary,
        overall_evaluation: c.overall_evaluation ?? '',
        education: c.education,
        current_company: c.current_company,
        current_position: c.current_position,
        expected_salary: c.expected_salary ?? '',
        source: c.source,
        status: c.status,
        tags: c.tags,
        notes: c.notes,
        referral_need: c.referral_need != null ? String(c.referral_need) : '',
        referral_note: c.referral_note ?? '',
        cv_file: c.cv_file ?? null,
      });
      setCurrentCvUrl(c.cv_file_url ?? null);
      setCvPreview(null);
      setFormError(null);
      setShowModal(true);
    } catch {
      alert('Không thể tải thông tin ứng viên');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) {
      setFormError('Vui lòng nhập họ tên');
      return;
    }
    if (!form.email.trim()) {
      setFormError('Vui lòng nhập email');
      return;
    }
    if (form.source === 'REFERRAL' && !form.referral_need) {
      setFormError('Vui lòng chọn nhu cầu tuyển dụng được giới thiệu');
      return;
    }
    if (!editingId && !form.cv_file && !form.cv_url.trim()) {
      setFormError('Vui lòng tải CV lên hoặc nhập link CV');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const baseData: CandidateCreateData = {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone || undefined,
        gender: form.gender || undefined,
        date_of_birth: form.date_of_birth || undefined,
        address: form.address || undefined,
        cv_url: form.cv_url || undefined,
        skills: form.skills || undefined,
        experience_years: form.experience_years ? parseInt(form.experience_years) : undefined,
        experience_summary: form.experience_summary || undefined,
        overall_evaluation: form.overall_evaluation || undefined,
        education: form.education || undefined,
        current_company: form.current_company || undefined,
        current_position: form.current_position || undefined,
        expected_salary: form.expected_salary ? parseFloat(form.expected_salary) : undefined,
        source: form.source,
        status: form.status,
        tags: form.tags || undefined,
        notes: form.notes || undefined,
        referral_need: form.source === 'REFERRAL' && form.referral_need
          ? parseInt(form.referral_need, 10)
          : undefined,
        referral_note: form.source === 'REFERRAL' ? (form.referral_note || undefined) : undefined,
        referred_by_employee_id: form.source === 'REFERRAL'
          ? ((user as any)?.employee_profile?.id ?? (user as any)?.hrm_user?.id)
          : undefined,
      };

      const data: CandidateCreateData | FormData = form.cv_file
        ? (() => {
            const formData = new FormData();
            Object.entries(baseData).forEach(([key, value]) => {
              if (value !== undefined && value !== null && value !== '') {
                formData.append(key, String(value));
              }
            });
            if (form.cv_file instanceof File) {
              formData.append('cv_file', form.cv_file);
            } else {
              formData.append('cv_file', String(form.cv_file));
            }
            return formData;
          })()
        : baseData;

      let createdCandidateId: number | null = null;
      if (editingId) {
        await recruitmentService.updateCandidate(editingId, data);
      } else {
        const createdCandidate = await recruitmentService.createCandidate(data);
        createdCandidateId = createdCandidate.id;

        // Ưu tiên nhu cầu từ URL context (workflow "Upload CV" từ Need detail),
        // sau đó tới nhu cầu user chọn trong form. Cho phép mọi source gắn
        // candidate vào nhu cầu — nếu không gắn sẽ không xuất hiện ở Need detail
        // để duyệt CV.
        const targetNeedId = needCvContextId
          ? Number(needCvContextId)
          : (form.referral_need ? parseInt(form.referral_need, 10) : null);

        if (targetNeedId) {
          const jobs = await recruitmentService.listJobs({ recruitment_need: targetNeedId });
          const targetJob = jobs.find((job) => job.status === 'PUBLISHED') || jobs[0];

          if (targetJob) {
            await recruitmentService.createApplication({
              candidate: createdCandidate.id,
              job: targetJob.id,
              source: form.source,
            });
          } else {
            alert('Ứng viên đã được tạo, nhưng nhu cầu này chưa có JD để gắn hồ sơ. Vui lòng tạo JD cho nhu cầu trước.');
          }
        }
      }
      closeModal();
      await fetchCandidates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lưu thất bại';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCandidate = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      await recruitmentService.deleteCandidate(deleteConfirm.id);
      setDeleteConfirm(null);
      await fetchCandidates();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể xoá ứng viên';
      alert(msg);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Schedule Interview (duplicated from RecruitmentNeedDetail) ──────────
  const openScheduleInterviewModal = async (c: CandidateListItem) => {
    if (!c.latest_application_id) {
      alert('Ứng viên chưa có đơn ứng tuyển gắn với nhu cầu tuyển dụng.');
      return;
    }
    if (!c.latest_application_cv_approved) {
      alert('Cần duyệt CV trước khi đặt lịch phỏng vấn.');
      return;
    }

    let app: ApplicationListItem;
    try {
      const apps = await recruitmentService.listApplications({ candidate: c.id });
      const found = apps.find((a) => a.id === c.latest_application_id) || apps[0];
      if (!found) {
        alert('Không tìm thấy đơn ứng tuyển của ứng viên này.');
        return;
      }
      app = found;
    } catch {
      alert('Không tải được thông tin đơn ứng tuyển.');
      return;
    }

    const now = new Date();
    const roundedMinutes = now.getMinutes() < 30 ? 30 : 60;
    if (roundedMinutes === 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0, 0, 0);
    } else {
      now.setMinutes(30, 0, 0);
    }

    const defaultDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const defaultTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    setSelectedApplication(app);
    setScheduleForm({
      interview_type: 'HR',
      date: defaultDate,
      time: defaultTime,
      duration_minutes: '60',
      room_id: '',
      notes: '',
    });
    setScheduleError(null);
    setScheduleOptions(null);
    setShowScheduleModal(true);
  };

  const fetchScheduleOptions = async () => {
    if (!selectedApplication || !scheduleForm.date) return;

    try {
      setLoadingScheduleOptions(true);
      const scheduledAt = scheduleForm.time ? `${scheduleForm.date}T${scheduleForm.time}:00` : undefined;
      const options = await recruitmentService.getApplicationScheduleOptions(selectedApplication.id, {
        date: scheduleForm.date,
        scheduled_at: scheduledAt,
        duration_minutes: parseInt(scheduleForm.duration_minutes) || 60,
      });
      setScheduleOptions(options);

      if (options.available_rooms.length > 0 && !scheduleForm.room_id) {
        setScheduleForm((prev) => ({ ...prev, room_id: String(options.available_rooms[0].id) }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể tải gợi ý lịch phỏng vấn';
      setScheduleError(msg);
      setScheduleOptions(null);
    } finally {
      setLoadingScheduleOptions(false);
    }
  };

  useEffect(() => {
    if (!showScheduleModal || !selectedApplication || !scheduleForm.date) return;
    const timer = setTimeout(() => {
      fetchScheduleOptions();
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScheduleModal, selectedApplication?.id, scheduleForm.date, scheduleForm.time, scheduleForm.duration_minutes]);

  const handlePickSuggestedSlot = (startTime: string, recommendedRoomId: number | null) => {
    const dt = new Date(startTime);
    const date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const time = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    setScheduleForm((prev) => ({
      ...prev,
      date,
      time,
      room_id: recommendedRoomId ? String(recommendedRoomId) : prev.room_id,
    }));
  };

  const handleScheduleInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedApplication) return;
    if (!scheduleForm.date || !scheduleForm.time) {
      setScheduleError('Vui lòng chọn ngày và giờ phỏng vấn.');
      return;
    }
    try {
      setSchedulingInterview(true);
      setScheduleError(null);
      await recruitmentService.scheduleInterviewFromApplication(selectedApplication.id, {
        interview_type: scheduleForm.interview_type,
        scheduled_at: `${scheduleForm.date}T${scheduleForm.time}:00`,
        duration_minutes: parseInt(scheduleForm.duration_minutes) || 60,
        room_id: scheduleForm.room_id ? parseInt(scheduleForm.room_id) : undefined,
        notes: scheduleForm.notes || undefined,
      });
      setShowScheduleModal(false);
      setSelectedApplication(null);
      await fetchCandidates();
      alert('Đã đặt lịch phỏng vấn và book phòng họp thành công.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể đặt lịch phỏng vấn';
      setScheduleError(msg);
    } finally {
      setSchedulingInterview(false);
    }
  };

  const handlePreviewScheduleEmail = async () => {
    if (!selectedApplication) return;
    if (!scheduleForm.date || !scheduleForm.time) {
      setScheduleError('Vui lòng chọn ngày và giờ phỏng vấn trước khi xem trước email.');
      return;
    }
    try {
      setPreviewingScheduleEmail(true);
      setScheduleError(null);
      const preview = await recruitmentService.previewScheduleInterviewEmail(selectedApplication.id, {
        scheduled_at: `${scheduleForm.date}T${scheduleForm.time}:00`,
        duration_minutes: parseInt(scheduleForm.duration_minutes) || 60,
        room_id: scheduleForm.room_id ? parseInt(scheduleForm.room_id) : undefined,
      });
      setScheduleEmailPreview(preview);
      setShowEmailPreviewModal(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể xem trước email';
      setScheduleError(msg);
    } finally {
      setPreviewingScheduleEmail(false);
    }
  };

  const handlePreviewCv = useCallback(async (file: File) => {
    setCvProcessing(true);
    setCvPreviewError(null);
    setCurrentCvUrl(null);
    setCvPreview(null);

    try {
      const payload = new FormData();
      payload.append('cv_file', file);

      const preview = await recruitmentService.previewCandidateCv(payload);
      setCvPreview(preview);
      setCurrentCvUrl(preview.cv_file_url);
      setForm((current) => {
        const merged = mergePreviewToForm(current, preview);
        if (needCvContextId) {
          return {
            ...merged,
            source: 'REFERRAL',
            referral_need: String(needCvContextId),
          };
        }
        return merged;
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể xử lý CV';
      setCvPreviewError(msg);
      setForm((current) => ({ ...current, cv_file: file }));
    } finally {
      setCvProcessing(false);
    }
  }, [needCvContextId]);

  const handleCvFileChange = useCallback(async (file: File | null) => {
    if (!file) return;
    await handlePreviewCv(file);
  }, [handlePreviewCv]);

  const handleCvDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCvDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    await handleCvFileChange(file);
  }, [handleCvFileChange]);

  const handleCvQuickUpload = useCallback(async (file: File | null) => {
    if (!file) return;

    setCvProcessing(true);
    setCvPreviewError(null);

    try {
      const payload = new FormData();
      payload.append('cv_file', file);

      const preview = await recruitmentService.previewCandidateCv(payload);
      setCvPreview(preview);
      setCurrentCvUrl(preview.cv_file_url);
      setEditingId(null);
      setForm(() => {
        const merged = mergePreviewToForm(EMPTY_FORM, preview);
        if (needCvContextId) {
          return {
            ...merged,
            source: 'REFERRAL',
            referral_need: String(needCvContextId),
          };
        }
        return merged;
      });
      setShowCvUploadModal(false);
      setShowModal(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể xử lý CV';
      setCvPreviewError(msg);
    } finally {
      setCvProcessing(false);
    }
  }, [needCvContextId]);

  const handleCvQuickDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCvUploadDragActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    await handleCvQuickUpload(file);
  }, [handleCvQuickUpload]);

  const cvPreviewSource = cvPreview?.cv_file_url ?? currentCvUrl ?? null;
  const cvEmbedUrl = cvPreviewSource
    ? `${cvPreviewSource}${cvPreviewSource.includes('#') ? '&' : '#'}toolbar=0&navpanes=0&view=FitH`
    : null;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Ứng viên</h1>
            <p className="text-sm text-gray-900">Quản lý hồ sơ ứng viên</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openCvUploadModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-purple-200 bg-purple-50 text-sm font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
          >
            CV ứng viên
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center gap-2">
            <PlusIcon className="h-4 w-4" />
            Thêm ứng viên
          </button>
        </div>
      </div>

      {/* Quick CV Upload Modal */}
      {showCvUploadModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-bold text-gray-900">Upload CV ứng viên</h2>
              <button
                onClick={closeCvUploadModal}
                className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="px-6 py-6">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setCvUploadDragActive(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setCvUploadDragActive(false);
                }}
                onDrop={handleCvQuickDrop}
                className={`rounded-2xl border-2 border-dashed p-8 text-center space-y-4 transition-colors ${
                  cvUploadDragActive ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <p className="text-base font-semibold text-gray-900">Kéo thả CV vào đây</p>
                <p className="text-sm text-gray-500">hoặc chọn file để upload (PDF, DOC, DOCX)</p>

                <label className="inline-flex items-center justify-center rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 cursor-pointer transition-colors">
                  Upload CV
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    onChange={e => handleCvQuickUpload(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                </label>

                {cvProcessing && (
                  <div className="flex items-center justify-center gap-2 text-sm text-purple-700">
                    <span className="inline-block h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                    Đang upload và bóc tách CV...
                  </div>
                )}

                {cvPreviewError && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 text-left">
                    {cvPreviewError}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Filter bar */}
      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="input-field pl-9 pr-4 py-2 text-sm"
              placeholder="Tìm theo tên, email, SĐT..."
            />
          </div>
          <div className="w-48">
            <SelectBox<string>
              label=""
              value={sourceFilter}
              options={[
                { value: 'all', label: 'Tất cả nguồn' },
                ...SOURCE_OPTIONS.map(o => ({ value: o.value as string, label: o.label })),
              ]}
              onChange={setSourceFilter}
            />
          </div>
          <div className="w-56">
            <SelectBox<string>
              label=""
              value={statusFilter}
              options={[
                { value: 'all', label: 'Tất cả trạng thái' },
                ...STATUS_OPTIONS.map(o => ({ value: o.value as string, label: o.label })),
              ]}
              onChange={setStatusFilter}
            />
          </div>
          <div className="w-44">
            <SelectBox<string>
              label=""
              value={blacklistFilter}
              options={[
                { value: 'all', label: 'Tất cả' },
                { value: 'active', label: 'Đang hoạt động' },
                { value: 'blacklisted', label: 'Blacklist' },
              ]}
              onChange={setBlacklistFilter}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-2xl border border-red-100 text-sm">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <div className="h-12 w-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <UserGroupIcon className="h-6 w-6 text-gray-400" />
          </div>
          <p className="text-sm text-gray-500">Chưa có ứng viên nào</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="table-header px-4 py-3">Tuyển dụng phụ trách</th>
                  <th className="table-header px-4 py-3">Ứng viên</th>
                  <th className="table-header px-4 py-3">Vị trí ứng tuyển</th>
                  <th className="table-header px-4 py-3">BP phỏng vấn</th>
                  <th className="table-header px-4 py-3">Nguồn</th>
                  <th className="table-header px-4 py-3">CV</th>
                  <th className="table-header px-4 py-3">Đánh giá tổng quan</th>
                  <th className="table-header px-4 py-3">Ghi chú</th>
                  <th className="table-header px-4 py-3">Trạng thái</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {candidates.map(c => (
                  <tr
                    key={c.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/dashboard/recruitment/candidates/${c.id}`)}
                  >
                    <td className="table-cell px-4 py-3">
                      {c.recruiter_employee_id || c.recruiter_full_name ? (
                        <span className="text-sm text-gray-900">
                          {c.recruiter_employee_id && <span className="font-semibold">{c.recruiter_employee_id}</span>}
                          {c.recruiter_employee_id && c.recruiter_full_name ? ' — ' : ''}
                          {c.recruiter_full_name || ''}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="table-cell px-4 py-3">
                      <p className="text-sm font-semibold text-gray-900">{c.full_name}</p>
                      <p className="text-xs text-gray-400">{c.email}</p>
                      {c.phone && <p className="text-xs text-gray-400">{c.phone}</p>}
                    </td>
                    <td className="table-cell px-4 py-3">
                      <p className="text-sm text-gray-900">{c.latest_job_title || c.current_position || '—'}</p>
                      {c.current_company && (
                        <p className="text-xs text-gray-400">Hiện tại: {c.current_company}</p>
                      )}
                    </td>
                    <td className="table-cell px-4 py-3">
                      {c.need_interviewer_employee_id || c.need_interviewer_full_name ? (
                        <span className="text-sm text-gray-900">
                          {c.need_interviewer_employee_id && <span className="font-semibold">{c.need_interviewer_employee_id}</span>}
                          {c.need_interviewer_employee_id && c.need_interviewer_full_name ? ' — ' : ''}
                          {c.need_interviewer_full_name || ''}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="table-cell px-4 py-3">{c.source_display}</td>
                    <td className="table-cell px-4 py-3 text-center">
                      {c.cv_file_url || c.cv_url ? (
                        <a
                          href={c.cv_file_url || c.cv_url}
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
                    <td
                      className="table-cell px-4 py-3 max-w-sm"
                      title={c.overall_evaluation || ''}
                    >
                      <span className="line-clamp-3 text-sm text-gray-700">
                        {c.overall_evaluation || <span className="text-gray-400">—</span>}
                      </span>
                    </td>
                    <td
                      className="table-cell px-4 py-3 max-w-xs truncate"
                      title={c.notes || ''}
                    >
                      <span className="text-sm text-gray-700">{c.notes || <span className="text-gray-400">—</span>}</span>
                    </td>
                    <td className="table-cell px-4 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE_CLASS[c.status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {c.status_display}
                        </span>
                        {c.is_blacklisted && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                            Blacklist
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); openScheduleInterviewModal(c); }}
                          disabled={!c.latest_application_cv_approved}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
                          title={
                            !c.latest_application_id
                              ? 'Chưa có đơn ứng tuyển'
                              : !c.latest_application_cv_approved
                                ? 'Cần duyệt CV trước khi đặt lịch'
                                : 'Đặt lịch phỏng vấn'
                          }
                        >
                          Đặt lịch
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(c.id); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg transition-colors"
                          title="Chỉnh sửa"
                        >
                          <PencilSquareIcon className="h-3.5 w-3.5" />
                          Sửa
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-white hover:bg-red-50 border border-red-200 rounded-lg transition-colors"
                          title="Xoá ứng viên"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          Xoá
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

      {/* Create / Edit Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full mx-4 max-h-[92vh] overflow-y-auto max-w-7xl">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h2 className="text-base font-bold text-gray-900">
                {editingId ? 'Cập nhật ứng viên' : 'Thêm ứng viên mới'}
              </h2>
              <button
                onClick={closeModal}
                className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_1fr] gap-5 items-start">
                <div className="space-y-4">
                  {!cvPreviewSource && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">CV ứng viên</label>
                      <div
                        onDragOver={(event) => {
                          event.preventDefault();
                          setCvDragActive(true);
                        }}
                        onDragLeave={(event) => {
                          event.preventDefault();
                          setCvDragActive(false);
                        }}
                        onDrop={handleCvDrop}
                        className={`rounded-2xl border-2 border-dashed p-4 space-y-4 transition-colors ${
                          cvDragActive ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-gray-900">Kéo thả CV vào đây hoặc chọn file</p>
                          <p className="text-xs text-gray-500">
                            CV sẽ được upload lên S3 trong thư mục recruitment/cv, hệ thống tự bóc tách và điền dữ liệu sang form bên phải.
                          </p>
                        </div>

                        <input
                          type="file"
                          accept=".pdf,.doc,.docx"
                          onChange={e => handleCvFileChange(e.target.files?.[0] ?? null)}
                          className="block w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-purple-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-purple-700"
                        />

                        {cvProcessing && (
                          <div className="flex items-center gap-2 text-sm text-purple-700">
                            <span className="inline-block h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                            Đang upload và bóc tách CV...
                          </div>
                        )}

                        {cvPreviewError && (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {cvPreviewError}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {cvPreviewSource && cvEmbedUrl ? (
                    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden h-[66vh]">
                      <PdfFrame
                        src={cvEmbedUrl}
                        title="CV Preview"
                        className="w-full h-full border-0"
                      />
                    </div>
                  ) : null}

                  {form.cv_file && typeof form.cv_file === 'string' && !cvProcessing && (
                    <p className="text-xs text-emerald-700">CV đã được upload lên S3 và thông tin đã điền tự động vào form.</p>
                  )}

                  {cvPreview?.warnings.length ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 space-y-1">
                      {cvPreview.warnings.map((warning, index) => (
                        <p key={index}>• {warning}</p>
                      ))}
                    </div>
                  ) : null}

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Hoặc nhập link CV</label>
                    <input
                      type="url"
                      value={form.cv_url}
                      onChange={e => setForm(f => ({ ...f, cv_url: e.target.value }))}
                      className="input-field w-full"
                      placeholder="https://..."
                    />
                    {(form.cv_url || editingId) && (
                      <p className="text-xs text-gray-500 mt-2">
                        {form.cv_url ? (
                          <a
                            href={form.cv_url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-purple-700 hover:text-purple-900"
                          >
                            Xem link CV hiện tại
                          </a>
                        ) : (
                          'Bạn có thể chọn file CV mới để ghi đè hồ sơ hiện tại.'
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Họ tên <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={form.full_name}
                        onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={form.email}
                        onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                        className="input-field w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Điện thoại</label>
                      <input
                        type="tel"
                        value={form.phone}
                        onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <SelectBox<string>
                        label="Giới tính"
                        value={form.gender}
                        options={[
                          { value: '', label: '—' },
                          { value: 'M', label: 'Nam' },
                          { value: 'F', label: 'Nữ' },
                          { value: 'O', label: 'Khác' },
                        ]}
                        onChange={v => setForm(f => ({ ...f, gender: v }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Ngày sinh</label>
                      <input
                        type="date"
                        value={form.date_of_birth}
                        onChange={e => setForm(f => ({ ...f, date_of_birth: e.target.value }))}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Kinh nghiệm (năm)</label>
                      <input
                        type="number"
                        min="0"
                        value={form.experience_years}
                        onChange={e => setForm(f => ({ ...f, experience_years: e.target.value }))}
                        className="input-field w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Công ty hiện tại</label>
                      <input
                        type="text"
                        value={form.current_company}
                        onChange={e => setForm(f => ({ ...f, current_company: e.target.value }))}
                        className="input-field w-full"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Vị trí hiện tại</label>
                      <input
                        type="text"
                        value={form.current_position}
                        onChange={e => setForm(f => ({ ...f, current_position: e.target.value }))}
                        className="input-field w-full"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <SelectBox<CandidateSource>
                        label="Nguồn"
                        value={form.source}
                        options={SOURCE_OPTIONS}
                        onChange={v => setForm(f => ({ ...f, source: v }))}
                      />
                    </div>
                    <div>
                      <SelectBox<CandidateStatus>
                        label="Trạng thái"
                        value={form.status}
                        options={STATUS_OPTIONS}
                        onChange={v => setForm(f => ({ ...f, status: v }))}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Lương mong muốn (đ)</label>
                      <input
                        type="number"
                        value={form.expected_salary}
                        onChange={e => setForm(f => ({ ...f, expected_salary: e.target.value }))}
                        className="input-field w-full"
                        placeholder="VD: 20000000"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <SelectBox<string>
                        label={form.source === 'REFERRAL'
                          ? 'Nhu cầu tuyển dụng *'
                          : 'Gắn vào nhu cầu tuyển dụng (tùy chọn)'}
                        value={form.referral_need}
                        options={[
                          { value: '', label: 'Chọn nhu cầu tuyển dụng' },
                          ...needs.map((need) => ({
                            value: String(need.id),
                            label: `${need.position_name} • ${need.department_name || 'Chưa có phòng ban'}`,
                          })),
                        ]}
                        onChange={(value) => setForm((f) => ({ ...f, referral_need: value }))}
                        searchable={true}
                      />
                    </div>
                    {form.source === 'REFERRAL' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú giới thiệu</label>
                        <input
                          type="text"
                          value={form.referral_note}
                          onChange={e => setForm(f => ({ ...f, referral_note: e.target.value }))}
                          className="input-field w-full"
                          placeholder="Ví dụ: Bạn cũ làm backend 5 năm"
                        />
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Kỹ năng</label>
                    <input
                      type="text"
                      value={form.skills}
                      onChange={e => setForm(f => ({ ...f, skills: e.target.value }))}
                      className="input-field w-full"
                      placeholder="Python, Django, PostgreSQL..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Học vấn</label>
                    <input
                      type="text"
                      value={form.education}
                      onChange={e => setForm(f => ({ ...f, education: e.target.value }))}
                      className="input-field w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Đánh giá tổng quan ứng viên</label>
                    <textarea
                      rows={4}
                      value={form.overall_evaluation}
                      onChange={e => setForm(f => ({ ...f, overall_evaluation: e.target.value }))}
                      className="input-field w-full"
                      placeholder="AI sẽ tự điền khi upload CV"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                    <textarea
                      rows={2}
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      className="input-field w-full"
                    />
                  </div>
                </div>
              </div>
              {formError && (
                <p className="text-sm text-red-600">{formError}</p>
              )}
            </form>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="btn-secondary"
              >
                Hủy
              </button>
              <button
                type="submit"
                form=""
                disabled={saving}
                onClick={handleSubmit}
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
          </div>
        </div>,
        document.body
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        variant="danger"
        title="Xoá ứng viên"
        message={deleteConfirm ? `Bạn có chắc muốn xoá ứng viên "${deleteConfirm.full_name}" không?\nThao tác này sẽ xoá hồ sơ ứng viên và các dữ liệu liên quan.` : undefined}
        confirmLabel="Xoá"
        loading={deleting}
        onConfirm={handleDeleteCandidate}
        onClose={() => {
          if (!deleting) setDeleteConfirm(null);
        }}
      />

      {/* Schedule Interview Modal */}
      {showScheduleModal && selectedApplication && createPortal(
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-black/30" onClick={() => setShowScheduleModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-2xl w-full z-50">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">Đặt lịch phỏng vấn</h3>
                <button
                  onClick={() => setShowScheduleModal(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleScheduleInterview} className="px-6 py-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-xs text-gray-500">Ứng viên</p>
                    <p className="text-sm font-semibold text-gray-900">{selectedApplication.candidate_name}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2 border border-gray-100">
                    <p className="text-xs text-gray-500">Người phỏng vấn</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {scheduleOptions?.interviewer_name || selectedApplication.need_interviewer_full_name || 'Chưa gán'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ngày phỏng vấn</label>
                    <input
                      type="date"
                      value={scheduleForm.date}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, date: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Giờ phỏng vấn</label>
                    <input
                      type="time"
                      value={scheduleForm.time}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, time: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Loại phỏng vấn</label>
                    <select
                      value={scheduleForm.interview_type}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, interview_type: e.target.value as InterviewType }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    >
                      {INTERVIEW_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Thời lượng (phút)</label>
                    <input
                      type="number"
                      min={15}
                      value={scheduleForm.duration_minutes}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, duration_minutes: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phòng họp trống</label>
                    <select
                      value={scheduleForm.room_id}
                      onChange={(e) => setScheduleForm((prev) => ({ ...prev, room_id: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    >
                      <option value="">Tự động chọn phòng</option>
                      {(scheduleOptions?.available_rooms || []).map((room) => (
                        <option key={room.id} value={String(room.id)}>
                          {room.name} ({room.code}) - {room.capacity} chỗ
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Gợi ý khung giờ trống</label>
                  {loadingScheduleOptions ? (
                    <div className="text-sm text-gray-500">Đang tải gợi ý...</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(scheduleOptions?.suggested_slots || []).slice(0, 8).map((slot) => (
                        <button
                          key={slot.start_time}
                          type="button"
                          onClick={() => handlePickSuggestedSlot(slot.start_time, slot.recommended_room_id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 transition-colors"
                        >
                          {slot.label} • {slot.recommended_room_name || `${slot.available_room_count} phòng trống`}
                        </button>
                      ))}
                      {(scheduleOptions?.suggested_slots || []).length === 0 && (
                        <span className="text-xs text-gray-500">Chưa có gợi ý cho ngày đã chọn.</span>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ghi chú</label>
                  <textarea
                    rows={2}
                    value={scheduleForm.notes}
                    onChange={(e) => setScheduleForm((prev) => ({ ...prev, notes: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    placeholder="Ghi chú lịch phỏng vấn..."
                  />
                </div>

                {scheduleError && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-100">
                    {scheduleError}
                  </p>
                )}

                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={handlePreviewScheduleEmail}
                    disabled={previewingScheduleEmail}
                    className="px-4 py-2 rounded-lg border border-primary-200 bg-primary-50 hover:bg-primary-100 disabled:bg-gray-100 disabled:text-gray-400 text-primary-700 text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {previewingScheduleEmail ? (
                      <span className="inline-block h-4 w-4 border-2 border-primary-700 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <EyeIcon className="h-4 w-4" />
                    )}
                    {previewingScheduleEmail ? 'Đang tạo preview...' : 'Xem trước email'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowScheduleModal(false)}
                    className="px-4 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm font-medium transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={schedulingInterview}
                    className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {schedulingInterview ? (
                      <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CheckIcon className="h-4 w-4" />
                    )}
                    {schedulingInterview ? 'Đang đặt lịch...' : 'Đặt lịch & Book phòng'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Schedule Email Preview Modal */}
      {showEmailPreviewModal && scheduleEmailPreview && createPortal(
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-black/40" onClick={() => setShowEmailPreviewModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-4xl w-full z-50 max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Xem trước email phỏng vấn</h3>
                  <p className="text-sm text-gray-500 mt-1">{scheduleEmailPreview.subject}</p>
                </div>
                <button
                  onClick={() => setShowEmailPreviewModal(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-auto bg-gray-50 p-6">
                <div
                  className="bg-white border border-gray-200 rounded-xl p-6 prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: scheduleEmailPreview.body_html }}
                />
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white">
                <button
                  type="button"
                  onClick={() => setShowEmailPreviewModal(false)}
                  className="px-4 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm font-medium transition-colors"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};

export default RecruitmentCandidates;

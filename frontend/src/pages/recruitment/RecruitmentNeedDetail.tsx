import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PlusIcon,
  PencilIcon,
  XMarkIcon,
  CheckIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import {
  recruitmentService,
  RecruitmentNeed,
  Job,
  ApplicationListItem,
  InterviewListItem,
  JobListItem,
  RecruitmentNeedCreateData,
  InterviewType,
  ApplicationScheduleOptions,
  InterviewerCandidate,
} from '../../services/recruitment.service';
import { SelectBox } from '../../components/LandingLayout/SelectBox';
import { departmentsAPI } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';

interface Department {
  id: number;
  name: string;
}

interface EditFormState {
  department: string;
  headcount: string;
  expected_salary_min: string;
  expected_salary_max: string;
  reason: string;
  interviewer: string;
  cv_approver: string;
}

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

const RecruitmentNeedDetail: React.FC = () => {
  const { needId } = useParams<{ needId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needDetail, setNeedDetail] = useState<RecruitmentNeed | null>(null);
  const [needJobs, setNeedJobs] = useState<Job[]>([]);
  const [needApplications, setNeedApplications] = useState<ApplicationListItem[]>([]);
  const [latestInterviewsByApplication, setLatestInterviewsByApplication] = useState<Record<number, InterviewListItem>>({});
  
  // Select JD modal
  const [showSelectJdModal, setShowSelectJdModal] = useState(false);
  const [availableJobs, setAvailableJobs] = useState<JobListItem[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [linkingJobId, setLinkingJobId] = useState<number | null>(null);
  
  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState<EditFormState>({
    department: '',
    headcount: '1',
    expected_salary_min: '',
    expected_salary_max: '',
    reason: '',
    interviewer: '',
    cv_approver: '',
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [interviewerCandidates, setInterviewerCandidates] = useState<InterviewerCandidate[]>([]);
  const [interviewerQuery, setInterviewerQuery] = useState('');
  const [cvApproverCandidates, setCvApproverCandidates] = useState<InterviewerCandidate[]>([]);
  const [cvApproverQuery, setCvApproverQuery] = useState('');

  const interviewerOptions = useMemo(() => {
    return [
      { value: '', label: 'Không chọn' },
      ...interviewerCandidates.map((emp) => ({
        value: String(emp.user_id),
        label: emp.employee_id ? `${emp.full_name} (${emp.employee_id})` : emp.full_name,
      })),
    ];
  }, [interviewerCandidates]);

  const cvApproverOptions = useMemo(() => {
    return [
      { value: '', label: 'Không chọn' },
      ...cvApproverCandidates.map((emp) => ({
        value: String(emp.user_id),
        label: emp.employee_id ? `${emp.full_name} (${emp.employee_id})` : emp.full_name,
      })),
    ];
  }, [cvApproverCandidates]);

  // CV modal
  const [showCvModal, setShowCvModal] = useState(false);
  const [selectedCvUrl, setSelectedCvUrl] = useState<string | null>(null);
  const [selectedCandidateName, setSelectedCandidateName] = useState<string | null>(null);
  const [approvingCvId, setApprovingCvId] = useState<number | null>(null);
  const [rejectingCvId, setRejectingCvId] = useState<number | null>(null);

  // Schedule interview modal
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

  const buildLatestInterviewMap = (interviews: InterviewListItem[]): Record<number, InterviewListItem> => {
    return interviews.reduce<Record<number, InterviewListItem>>((acc, interview) => {
      const existing = acc[interview.application];
      if (!existing || new Date(interview.scheduled_at) > new Date(existing.scheduled_at)) {
        acc[interview.application] = interview;
      }
      return acc;
    }, {});
  };

  const fetchDepartments = async () => {
    try {
      setLoadingDepartments(true);
      const data = await departmentsAPI.list({ page_size: 1000 });
      const mapped: Department[] = (data.results || []).map((d: any) => ({
        id: d.id,
        name: d.name,
      }));
      setDepartments(mapped);
    } catch (err) {
      console.error('Error fetching departments:', err);
      setDepartments([]);
    } finally {
      setLoadingDepartments(false);
    }
  };

  const fetchUsers = async (query: string = '') => {
    try {
      const data = await recruitmentService.listInterviewerCandidates(query);
      setInterviewerCandidates(data || []);
    } catch (err) {
      console.error('Error fetching interviewer candidates:', err);
      setInterviewerCandidates([]);
    }
  };

  const fetchCvApprovers = async (query: string = '') => {
    try {
      const data = await recruitmentService.listInterviewerCandidates(query);
      setCvApproverCandidates(data || []);
    } catch (err) {
      console.error('Error fetching CV approver candidates:', err);
      setCvApproverCandidates([]);
    }
  };

  useEffect(() => {
    fetchDepartments();
    fetchUsers();
    fetchCvApprovers();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers(interviewerQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [interviewerQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchCvApprovers(cvApproverQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [cvApproverQuery]);

  useEffect(() => {
    if (!needId) {
      setError('Không tìm thấy ID nhu cầu tuyển dụng');
      setLoading(false);
      return;
    }

    const fetchDetail = async () => {
      try {
        setLoading(true);
        setError(null);

        const id = parseInt(needId);
        const needData = await recruitmentService.getNeed(id);
        setNeedDetail(needData);

        const jobs = await recruitmentService.listJobs({ recruitment_need: id });
        const fullJobs = await Promise.all(
          jobs.map((job) => recruitmentService.getJob(job.id))
        );
        setNeedJobs(fullJobs);

        const applicationsByJob = await Promise.all(
          fullJobs.map((job) => recruitmentService.listApplications({ job: job.id }))
        );
        const flattenedApplications = applicationsByJob.flat();
        setNeedApplications(flattenedApplications);

        if (flattenedApplications.length > 0) {
          const appIdSet = new Set(flattenedApplications.map((app) => app.id));
          const allInterviews = await recruitmentService.listInterviews();
          const relatedInterviews = allInterviews.filter((interview) => appIdSet.has(interview.application));
          setLatestInterviewsByApplication(buildLatestInterviewMap(relatedInterviews));
        } else {
          setLatestInterviewsByApplication({});
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Không thể tải chi tiết nhu cầu tuyển dụng';
        setError(msg);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [needId]);

  const handleBack = () => {
    navigate('/dashboard/recruitment/needs');
  };

  const openNeedCvUpload = () => {
    if (needId) {
      const id = parseInt(needId);
      navigate(`/dashboard/recruitment/candidates?openNeedCv=1&needId=${id}&referralNeed=${id}`);
    }
  };

  const openEditModal = () => {
    if (needDetail) {
      setEditForm({
        department: needDetail.department ? String(needDetail.department) : '',
        headcount: String(needDetail.headcount),
        expected_salary_min: needDetail.expected_salary_min ? String(needDetail.expected_salary_min) : '',
        expected_salary_max: needDetail.expected_salary_max ? String(needDetail.expected_salary_max) : '',
        reason: needDetail.reason,
        interviewer: needDetail.interviewer ? String(needDetail.interviewer) : '',
        cv_approver: needDetail.cv_approver ? String(needDetail.cv_approver) : '',
      });
      setEditError(null);
      setShowEditModal(true);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!needId) return;
    try {
      setSavingEdit(true);
      setEditError(null);
      const id = parseInt(needId);
      const data: Partial<RecruitmentNeedCreateData> = {
        headcount: parseInt(editForm.headcount) || 1,
        expected_salary_min: editForm.expected_salary_min ? parseFloat(editForm.expected_salary_min) : undefined,
        expected_salary_max: editForm.expected_salary_max ? parseFloat(editForm.expected_salary_max) : undefined,
        reason: editForm.reason.trim(),
      };
      if (editForm.department) {
        data.department = parseInt(editForm.department);
      }
      data.interviewer = editForm.interviewer ? parseInt(editForm.interviewer) : null;
      data.cv_approver = editForm.cv_approver ? parseInt(editForm.cv_approver) : null;

      await recruitmentService.updateNeed(id, data);
      
      // Refresh detail
      const updatedNeed = await recruitmentService.getNeed(id);
      setNeedDetail(updatedNeed);
      setShowEditModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cập nhật thất bại';
      setEditError(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const openCvModal = (cvUrl: string | null, candidateName: string) => {
    if (cvUrl) {
      setSelectedCvUrl(cvUrl);
      setSelectedCandidateName(candidateName);
      setShowCvModal(true);
    }
  };

  const openSelectJdModal = async () => {
    try {
      setLoadingJobs(true);
      const allJobs = await recruitmentService.listJobs();
      // Filter out jobs that are already linked to this need
      const needJobIds = new Set(needJobs.map(j => j.id));
      const available = allJobs.filter(job => !needJobIds.has(job.id));
      setAvailableJobs(available);
      setShowSelectJdModal(true);
    } catch (err) {
      alert('Không thể tải danh sách JD');
    } finally {
      setLoadingJobs(false);
    }
  };

  const handleLinkJobToNeed = async (jobId: number) => {
    if (!needId) return;
    try {
      setLinkingJobId(jobId);
      const id = parseInt(needId);
      // Get the job and update it with recruitment_need
      const job = await recruitmentService.getJob(jobId);
      await recruitmentService.updateJob(jobId, {
        recruitment_need: id,
        title: job.title,
        description: job.description,
        requirements: job.requirements,
        benefits: job.benefits,
      });
      // Refresh the detail
      const updatedNeedData = await recruitmentService.getNeed(id);
      setNeedDetail(updatedNeedData);
      const jobs = await recruitmentService.listJobs({ recruitment_need: id });
      const fullJobs = await Promise.all(
        jobs.map((j) => recruitmentService.getJob(j.id))
      );
      setNeedJobs(fullJobs);
      setShowSelectJdModal(false);
    } catch (err) {
      alert('Không thể liên kết JD');
    } finally {
      setLinkingJobId(null);
    }
  };

  const currentUserId = useMemo(() => {
    const rawId = (user as any)?.id;
    const parsed = typeof rawId === 'string' ? parseInt(rawId, 10) : rawId;
    return Number.isFinite(parsed) ? Number(parsed) : null;
  }, [user]);

  const isHrOrAdmin = !!(
    (user as any)?.is_staff ||
    (user as any)?.is_superuser ||
    (user as any)?.hrm_user?.is_hr
  );

  const canApproveCv = !!(
    isHrOrAdmin ||
    (needDetail?.interviewer && currentUserId && Number(needDetail.interviewer) === currentUserId) ||
    (needDetail?.cv_approver && currentUserId && Number(needDetail.cv_approver) === currentUserId)
  );

  const refreshNeedApplications = async () => {
    const applicationsByJob = await Promise.all(
      needJobs.map((job) => recruitmentService.listApplications({ job: job.id }))
    );
    const flattenedApplications = applicationsByJob.flat();
    setNeedApplications(flattenedApplications);

    if (flattenedApplications.length > 0) {
      const appIdSet = new Set(flattenedApplications.map((app) => app.id));
      const allInterviews = await recruitmentService.listInterviews();
      const relatedInterviews = allInterviews.filter((interview) => appIdSet.has(interview.application));
      setLatestInterviewsByApplication(buildLatestInterviewMap(relatedInterviews));
    } else {
      setLatestInterviewsByApplication({});
    }
  };

  const handleApproveCv = async (applicationId: number) => {
    try {
      setApprovingCvId(applicationId);
      await recruitmentService.approveCv(applicationId);
      await refreshNeedApplications();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể duyệt CV';
      alert(msg);
    } finally {
      setApprovingCvId(null);
    }
  };

  const handleRejectCv = async (applicationId: number, candidateName: string) => {
    const note = window.prompt(
      `Đánh dấu CV của "${candidateName}" là KHÔNG ĐẠT?\n\nNhập ghi chú (tuỳ chọn) rồi bấm OK:`,
      ''
    );
    if (note === null) return;
    try {
      setRejectingCvId(applicationId);
      await recruitmentService.rejectCv(applicationId, { note: note.trim() || undefined });
      await refreshNeedApplications();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Không thể từ chối CV';
      alert(msg);
    } finally {
      setRejectingCvId(null);
    }
  };

  const openScheduleInterviewModal = (application: ApplicationListItem) => {
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

    setSelectedApplication(application);
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
      await refreshNeedApplications();
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="h-10 w-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="h-8 bg-gray-200 rounded-lg w-1/3 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-100 p-6">
            <div className="space-y-4">
              <div className="h-6 bg-gray-200 rounded-lg animate-pulse" />
              <div className="h-10 bg-gray-200 rounded-lg animate-pulse" />
              <div className="h-10 bg-gray-200 rounded-lg animate-pulse" />
            </div>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <div className="h-40 bg-gray-200 rounded-2xl animate-pulse" />
            <div className="h-40 bg-gray-200 rounded-2xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="h-10 w-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (!needDetail) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="h-10 w-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
          <p className="text-gray-600">Không tìm thấy nhu cầu tuyển dụng</p>
        </div>
      </div>
    );
  }

  const APPROVAL_STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    APPROVED: 'bg-emerald-100 text-emerald-800',
    REJECTED: 'bg-red-100 text-red-800',
  };

  const STATUS_COLORS: Record<string, string> = {
    OPEN: 'bg-emerald-100 text-emerald-800',
    IN_PROGRESS: 'bg-primary-100 text-primary-800',
    FILLED: 'bg-gray-100 text-gray-800',
    CANCELLED: 'bg-red-100 text-red-800',
  };

  const formatCurrency = (value: string | number | null | undefined) => {
    if (!value) return '—';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) return '—';
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(num);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            className="h-10 w-10 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Quay lại"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              {needDetail.position_name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">Chi tiết nhu cầu tuyển dụng</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openEditModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-primary-200 bg-primary-50 text-sm font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
          >
            <PencilIcon className="h-4 w-4" />
            Sửa
          </button>
          <button
            onClick={openNeedCvUpload}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-purple-200 bg-purple-50 text-sm font-semibold text-purple-700 hover:bg-purple-100 transition-colors"
          >
            Upload CV vào nhu cầu
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Information */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Phòng ban</p>
              <p className="text-sm font-medium text-gray-900">
                {needDetail.department_name || '—'}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Bộ phận phỏng vấn</p>
              <p className="text-sm font-medium text-gray-900">
                {needDetail.interviewer_employee_id || needDetail.interviewer_name ? (
                  <>
                    {needDetail.interviewer_employee_id ? (
                      <span className="font-semibold">{needDetail.interviewer_employee_id}</span>
                    ) : null}
                    {needDetail.interviewer_employee_id && needDetail.interviewer_name ? ' — ' : null}
                    {needDetail.interviewer_name || ''}
                  </>
                ) : (
                  '—'
                )}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Người duyệt CV</p>
              <p className="text-sm font-medium text-gray-900">
                {needDetail.cv_approver_employee_id || needDetail.cv_approver_name ? (
                  <>
                    {needDetail.cv_approver_employee_id ? (
                      <span className="font-semibold">{needDetail.cv_approver_employee_id}</span>
                    ) : null}
                    {needDetail.cv_approver_employee_id && needDetail.cv_approver_name ? ' — ' : null}
                    {needDetail.cv_approver_name || ''}
                  </>
                ) : (
                  '—'
                )}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Số lượng cần tuyển</p>
              <p className="text-2xl font-bold text-primary-600">{needDetail.headcount}</p>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Hình thức làm việc</p>
              <p className="text-sm font-medium text-gray-900">
                {needDetail.employment_type_display}
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Lương dự kiến</p>
              <div className="space-y-1">
                <p className="text-sm text-gray-700">
                  Từ: <span className="font-semibold">{formatCurrency(needDetail.expected_salary_min)}</span>
                </p>
                <p className="text-sm text-gray-700">
                  Đến: <span className="font-semibold">{formatCurrency(needDetail.expected_salary_max)}</span>
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Trạng thái duyệt</p>
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  APPROVAL_STATUS_COLORS[(needDetail as any).approval_status] ??
                  'bg-gray-100 text-gray-800'
                }`}
              >
                {(needDetail as any).approval_status_display || 'Chưa duyệt'}
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Trạng thái</p>
              <span
                className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                  STATUS_COLORS[needDetail.status] ?? 'bg-gray-100 text-gray-800'
                }`}
              >
                {needDetail.status_display}
              </span>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Ngày onboard dự kiến</p>
              <p className="text-sm text-gray-900">
                {needDetail.target_onboard_date
                  ? new Date(needDetail.target_onboard_date).toLocaleDateString('vi-VN')
                  : '—'}
              </p>
            </div>

            {needDetail.reason && (
              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Lý do tuyển dụng</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{needDetail.reason}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right column - JD and Candidates */}
        <div className="lg:col-span-2 space-y-6">
          {/* JD Section */}
          <section className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4">
              Mô tả công việc (JD)
            </h2>
            {needJobs.length === 0 ? (
              <div className="bg-gray-50 rounded-lg p-6 text-center space-y-3">
                <p className="text-sm text-gray-500">Chưa có JD cho nhu cầu tuyển dụng này.</p>
                <button
                  onClick={openSelectJdModal}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold transition-colors"
                >
                  <PlusIcon className="h-4 w-4" />
                  Thêm JD
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {needJobs.map((job) => (
                  <div
                    key={job.id}
                    className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900 mb-2">{job.title}</p>
                      <p className="text-xs text-gray-500">ID: {job.id}</p>
                    </div>

                    {job.description && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-2">Mô tả công việc</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {job.description}
                        </p>
                      </div>
                    )}

                    {job.requirements && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-2">Yêu cầu kỹ năng</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {job.requirements}
                        </p>
                      </div>
                    )}

                    {job.benefits && (
                      <div>
                        <p className="text-xs font-semibold text-gray-600 mb-2">Quyền lợi</p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {job.benefits}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Candidates Section */}
          <section className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4">
              Ứng viên ứng tuyển ({needApplications.length})
            </h2>
            {needApplications.length === 0 ? (
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-500">Chưa có ứng viên ứng tuyển cho nhu cầu này.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Ứng viên
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Email
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Vị trí
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Nguồn
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Ngày ứng tuyển
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        CV
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Mail lịch PV
                      </th>
                      {canApproveCv && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                          Duyệt CV
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {needApplications.map((application) => (
                      <tr key={application.id} className="hover:bg-gray-50 transition-colors">
                        {(() => {
                          const latestInterview = latestInterviewsByApplication[application.id];
                          return (
                            <>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-900">
                            {application.candidate_name}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-600">{application.candidate_email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-600">{application.job_title}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-600">
                            {application.candidate_source || '—'}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-600">
                            {new Date(application.applied_at).toLocaleDateString('vi-VN')}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          {application.candidate_cv_url ? (
                            <button
                              onClick={() => openCvModal(application.candidate_cv_url, application.candidate_name)}
                              className="text-primary-600 hover:text-primary-700 font-medium text-sm underline"
                            >
                              Xem CV
                            </button>
                          ) : (
                            <span className="text-sm text-gray-400">Không có CV</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {latestInterview ? (
                            <>
                              <span
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${latestInterview.interview_email_sent ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                              >
                                {latestInterview.interview_email_sent ? 'Đã gửi' : 'Chưa gửi'}
                              </span>
                              {latestInterview.interview_email_sent_at && (
                                <p className="text-xs text-gray-400 mt-1">
                                  {new Date(latestInterview.interview_email_sent_at).toLocaleString('vi-VN')}
                                </p>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-gray-400">—</span>
                          )}
                        </td>
                        {canApproveCv && (
                          <td className="px-4 py-3">
                            {application.cv_process_status === 'ACCEPTED' ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
                                Đã duyệt
                              </span>
                            ) : application.cv_process_status === 'REJECTED' ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                                Không đạt
                              </span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleApproveCv(application.id)}
                                  disabled={approvingCvId === application.id || rejectingCvId === application.id}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-400 text-white text-xs font-semibold transition-colors"
                                >
                                  {approvingCvId === application.id && (
                                    <span className="inline-block h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  )}
                                  {approvingCvId === application.id ? 'Đang duyệt...' : 'Duyệt CV'}
                                </button>
                                <button
                                  onClick={() => handleRejectCv(application.id, application.candidate_name)}
                                  disabled={approvingCvId === application.id || rejectingCvId === application.id}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white text-xs font-semibold transition-colors"
                                >
                                  {rejectingCvId === application.id && (
                                    <span className="inline-block h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                  )}
                                  {rejectingCvId === application.id ? 'Đang xử lý...' : 'Không đạt'}
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                            </>
                          );
                        })()}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Schedule Interview Modal */}
      {showScheduleModal && selectedApplication && (
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
                    <p className="text-sm font-semibold text-gray-900">{scheduleOptions?.interviewer_name || needDetail.interviewer_name || 'Chưa gán'}</p>
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
        </div>
      )}

      {/* Schedule Email Preview Modal */}
      {showEmailPreviewModal && scheduleEmailPreview && (
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
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-black/30" onClick={() => setShowEditModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full z-50">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">Sửa nhu cầu tuyển dụng</h3>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              
              <form onSubmit={handleEditSubmit} className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Phòng ban
                  </label>
                  {loadingDepartments ? (
                    <div className="px-3 py-2.5 border border-gray-300 rounded-xl text-gray-500 text-sm">
                      Đang tải...
                    </div>
                  ) : (
                    <SelectBox<string>
                      label=""
                      value={editForm.department}
                      options={departments.map(d => ({ value: String(d.id), label: d.name }))}
                      onChange={v => setEditForm(f => ({ ...f, department: v }))}
                      placeholder="Chọn phòng ban"
                      searchable={true}
                      portal={true}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Người phỏng vấn
                  </label>
                  <SelectBox<string>
                    label=""
                    value={editForm.interviewer}
                    options={interviewerOptions}
                    onQueryChange={setInterviewerQuery}
                    onChange={v => setEditForm(f => ({ ...f, interviewer: v }))}
                    placeholder="Tìm theo tên hoặc mã (không bắt buộc)"
                    searchable={true}
                    portal={true}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Người duyệt CV
                  </label>
                  <SelectBox<string>
                    label=""
                    value={editForm.cv_approver}
                    options={cvApproverOptions}
                    onQueryChange={setCvApproverQuery}
                    onChange={v => setEditForm(f => ({ ...f, cv_approver: v }))}
                    placeholder="Tìm theo tên hoặc mã (không bắt buộc)"
                    searchable={true}
                    portal={true}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Số lượng cần tuyển
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editForm.headcount}
                    onChange={e => setEditForm(f => ({ ...f, headcount: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lương tối thiểu (đ)
                    </label>
                    <input
                      type="number"
                      value={editForm.expected_salary_min}
                      onChange={e => setEditForm(f => ({ ...f, expected_salary_min: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                      placeholder="VD: 15000000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Lương tối đa (đ)
                    </label>
                    <input
                      type="number"
                      value={editForm.expected_salary_max}
                      onChange={e => setEditForm(f => ({ ...f, expected_salary_max: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                      placeholder="VD: 25000000"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Lý do tuyển dụng
                  </label>
                  <textarea
                    rows={2}
                    value={editForm.reason}
                    onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                    placeholder="Mô tả lý do tuyển dụng..."
                  />
                </div>

                {editError && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-xl border border-red-100">
                    {editError}
                  </p>
                )}

                <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="px-4 py-2 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 text-sm font-medium transition-colors"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white text-sm font-medium transition-colors flex items-center gap-2"
                  >
                    {savingEdit ? (
                      <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <CheckIcon className="h-4 w-4" />
                    )}
                    {savingEdit ? 'Đang lưu...' : 'Lưu'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Select JD Modal */}
      {showSelectJdModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 py-8">
            <div className="fixed inset-0 bg-black/30" onClick={() => setShowSelectJdModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-2xl w-full z-50 max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
                <h3 className="text-lg font-bold text-gray-900">Chọn JD để thêm</h3>
                <button
                  onClick={() => setShowSelectJdModal(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="p-6">
                {loadingJobs ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
                    ))}
                  </div>
                ) : availableJobs.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-600 text-sm">
                      Không có JD nào khả dụng. Hãy tạo JD mới tại trang Quản lý JD.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableJobs.map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between p-4 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 truncate">{job.title}</p>
                          <p className="text-xs text-gray-500 truncate">ID: {job.id}</p>
                        </div>
                        <button
                          onClick={() => handleLinkJobToNeed(job.id)}
                          disabled={linkingJobId === job.id}
                          className="ml-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white text-sm font-medium transition-colors flex items-center gap-2 flex-shrink-0"
                        >
                          {linkingJobId === job.id ? (
                            <span className="inline-block h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <CheckIcon className="h-4 w-4" />
                          )}
                          {linkingJobId === job.id ? 'Đang lưu...' : 'Chọn'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CV Modal */}
      {showCvModal && selectedCvUrl && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-3 py-4 md:px-6 md:py-6">
            <div className="fixed inset-0 bg-black/30" onClick={() => setShowCvModal(false)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-[96vw] max-w-7xl z-50 h-[94vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <h3 className="text-lg font-bold text-gray-900">
                  CV - {selectedCandidateName}
                </h3>
                <button
                  onClick={() => setShowCvModal(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>

              <div className="flex-1 overflow-auto bg-gray-100">
                <iframe
                  src={selectedCvUrl}
                  className="w-full h-full"
                  title={`CV - ${selectedCandidateName}`}
                />
              </div>

              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-gray-50">
                <a
                  href={selectedCvUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium transition-colors"
                >
                  Tải xuống
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecruitmentNeedDetail;

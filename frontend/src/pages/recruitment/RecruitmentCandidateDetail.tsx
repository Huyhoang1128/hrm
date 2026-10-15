import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  XCircleIcon,
  DocumentArrowDownIcon,
} from '@heroicons/react/24/outline';
import {
  recruitmentService,
  Candidate,
  ApplicationListItem,
  InterviewListItem,
  Offer,
} from '../../services/recruitment.service';

const RecruitmentCandidateDetail: React.FC = () => {
  const { candidateId } = useParams<{ candidateId: string }>();
  const navigate = useNavigate();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [applications, setApplications] = useState<ApplicationListItem[]>([]);
  const [interviews, setInterviews] = useState<InterviewListItem[]>([]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!candidateId) return;
      setLoading(true);
      setError(null);
      try {
        const c = await recruitmentService.getCandidate(Number(candidateId));
        if (cancelled) return;
        setCandidate(c);

        let apps: ApplicationListItem[] = [];
        try {
          apps = await recruitmentService.listApplications({ candidate: c.id });
        } catch { /* ignore */ }
        if (cancelled) return;
        setApplications(apps);

        const latest = apps[0];
        if (latest) {
          try {
            const ints = await recruitmentService.listInterviews({ application: latest.id });
            if (!cancelled) setInterviews(ints);
          } catch { /* ignore */ }

          try {
            const allOffers = await recruitmentService.listOffers();
            const matched = allOffers.find(o => o.application === latest.id) || null;
            if (!cancelled) setOffer(matched);
          } catch { /* ignore */ }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Không tải được ứng viên';
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [candidateId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/dashboard/recruitment/candidates')}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Quay lại
        </button>
        <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error || 'Không tìm thấy ứng viên'}
        </div>
      </div>
    );
  }

  const latestApp = applications[0];
  const latestInterview = interviews.length > 0 ? interviews[0] : null;
  const recruiterLabel = candidate.recruiter_employee_id || candidate.recruiter_full_name
    ? `${candidate.recruiter_employee_id ?? ''}${candidate.recruiter_employee_id && candidate.recruiter_full_name ? ' — ' : ''}${candidate.recruiter_full_name ?? ''}`
    : '—';

  const birthYear = candidate.date_of_birth
    ? new Date(candidate.date_of_birth).getFullYear()
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/dashboard/recruitment/candidates')}
            className="mt-1 h-8 w-8 flex items-center justify-center rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            title="Quay lại"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              {candidate.full_name}
            </h1>
            <p className="text-sm text-gray-500 mt-1">Chi tiết ứng viên</p>
          </div>
        </div>
        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
          {candidate.status_display}
        </span>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Hồ sơ ứng viên</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4 p-5">
          <Field label="Tuyển dụng phụ trách" value={recruiterLabel} bold />
          <Field label="Họ và tên" value={candidate.full_name} bold />
          <Field label="Năm sinh" value={birthYear ? String(birthYear) : '—'} />
          <Field label="SĐT" value={candidate.phone || '—'} />
          <Field label="Email" value={candidate.email} />
          <Field label="Vị trí ứng tuyển" value={candidate.latest_job_title || candidate.current_position || '—'} />
          <Field
            label="Giờ phỏng vấn"
            value={latestInterview?.scheduled_at
              ? new Date(latestInterview.scheduled_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
              : '—'}
          />
          <Field
            label="Lịch phỏng vấn"
            value={latestInterview?.scheduled_at
              ? new Date(latestInterview.scheduled_at).toLocaleDateString('vi-VN')
              : '—'}
          />
          <Field
            label="BP phỏng vấn"
            value={(() => {
              if (latestInterview?.interviewer_names?.length) {
                return latestInterview.interviewer_names.join(', ');
              }
              if (latestApp?.need_interviewer_employee_id || latestApp?.need_interviewer_full_name) {
                const parts: string[] = [];
                if (latestApp.need_interviewer_employee_id) parts.push(latestApp.need_interviewer_employee_id);
                if (latestApp.need_interviewer_full_name) parts.push(latestApp.need_interviewer_full_name);
                return parts.join(' — ');
              }
              return '—';
            })()}
          />
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Xác nhận lịch</p>
            <p className="text-sm font-medium">
              {latestInterview ? (
                latestInterview.interviewer_confirmed ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircleIcon className="h-4 w-4" /> Đã xác nhận
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-700">
                    <XCircleIcon className="h-4 w-4" /> Chưa xác nhận
                  </span>
                )
              ) : (
                <span className="text-gray-400">—</span>
              )}
            </p>
          </div>
          <Field label="Kết quả" value={latestApp?.status_display || '—'} />
          <Field
            label="Ngày dự kiến nhận việc"
            value={offer?.expected_onboard_date
              ? new Date(offer.expected_onboard_date).toLocaleDateString('vi-VN')
              : '—'}
          />
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">CV</p>
            {candidate.cv_file_url || candidate.cv_url ? (
              <a
                href={candidate.cv_file_url || candidate.cv_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:underline"
              >
                <DocumentArrowDownIcon className="h-4 w-4" />
                Xem CV
              </a>
            ) : (
              <span className="text-sm text-gray-400">—</span>
            )}
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Đánh giá tổng quan</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {candidate.overall_evaluation || <span className="text-gray-400">— Chưa có đánh giá tổng quan —</span>}
            </p>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Note</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {candidate.notes || <span className="text-gray-400">— Chưa có ghi chú —</span>}
            </p>
          </div>
        </div>
      </div>

      {applications.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
              Lịch sử ứng tuyển ({applications.length})
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {applications.map(app => (
              <li
                key={app.id}
                className="px-5 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => navigate(`/dashboard/recruitment/jobs/${app.job}`)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {app.job_title || `JD #${app.job}`}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Stage: {app.current_stage_display} · Trạng thái: {app.status_display} ·{' '}
                      {new Date(app.applied_at).toLocaleDateString('vi-VN')}
                    </p>
                  </div>
                  <span className="text-xs text-primary-600 hover:underline">Xem JD →</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

interface FieldProps {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
}

const Field: React.FC<FieldProps> = ({ label, value, bold }) => (
  <div>
    <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{label}</p>
    <p className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{value}</p>
  </div>
);

export default RecruitmentCandidateDetail;

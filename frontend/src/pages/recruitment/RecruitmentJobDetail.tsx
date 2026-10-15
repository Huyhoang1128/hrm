import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeftIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import {
  recruitmentService,
  Job,
  ApplicationListItem,
  RecruitmentNeed,
} from '../../services/recruitment.service';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  PUBLISHED: 'bg-emerald-100 text-emerald-700',
  CLOSED: 'bg-red-100 text-red-700',
};

const RecruitmentJobDetail: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [linkedNeed, setLinkedNeed] = useState<RecruitmentNeed | null>(null);
  const [applications, setApplications] = useState<ApplicationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!jobId) return;
      setLoading(true);
      setError(null);
      try {
        const j = await recruitmentService.getJob(Number(jobId));
        if (cancelled) return;
        setJob(j);

        if (j.recruitment_need) {
          try {
            const n = await recruitmentService.getNeed(j.recruitment_need);
            if (!cancelled) setLinkedNeed(n);
          } catch { /* ignore */ }
        }

        try {
          const apps = await recruitmentService.listApplications({ job: j.id });
          if (!cancelled) setApplications(apps);
        } catch { /* ignore */ }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Không tải được JD';
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/dashboard/recruitment/jobs')}
          className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Quay lại
        </button>
        <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-xl text-sm">
          {error || 'Không tìm thấy JD'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/dashboard/recruitment/jobs')}
            className="mt-1 h-8 w-8 flex items-center justify-center rounded-xl text-gray-500 hover:text-gray-900 hover:bg-gray-100"
            title="Quay lại"
          >
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
              {job.title || job.position_name || 'JD'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">Chi tiết tin tuyển dụng</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
            {job.status_display}
          </span>
          <button
            onClick={() => navigate(`/dashboard/recruitment/jobs?edit=${job.id}`)}
            className="px-3 py-2 text-sm font-medium rounded-xl bg-gray-50 border border-gray-200 hover:bg-gray-100 text-gray-700 flex items-center gap-2"
          >
            <PencilIcon className="h-4 w-4" />
            Sửa
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 h-fit">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Vị trí</p>
            <p className="text-sm font-medium text-gray-900">{job.position_name || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Số kênh đăng</p>
            <p className="text-sm font-medium text-gray-900">{job.channel_count}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Ngày tạo</p>
            <p className="text-sm font-medium text-gray-900">
              {new Date(job.created_at).toLocaleDateString('vi-VN')}
            </p>
          </div>
          {job.published_at && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Ngày đăng</p>
              <p className="text-sm font-medium text-gray-900">
                {new Date(job.published_at).toLocaleDateString('vi-VN')}
              </p>
            </div>
          )}
          {job.closed_at && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Ngày đóng</p>
              <p className="text-sm font-medium text-gray-900">
                {new Date(job.closed_at).toLocaleDateString('vi-VN')}
              </p>
            </div>
          )}
          {job.created_by_name && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Người tạo</p>
              <p className="text-sm font-medium text-gray-900">{job.created_by_name}</p>
            </div>
          )}
          {linkedNeed && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Nhu cầu tuyển dụng</p>
              <button
                onClick={() => navigate(`/dashboard/recruitment/needs/${linkedNeed.id}`)}
                className="text-sm font-medium text-primary-600 hover:underline text-left"
              >
                {linkedNeed.position_name} ({linkedNeed.headcount} người)
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-bold text-gray-900 mb-2">Mô tả công việc (JD)</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {job.description || <span className="text-gray-400">— Chưa có mô tả —</span>}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-bold text-gray-900 mb-2">Yêu cầu kỹ năng</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {job.requirements || <span className="text-gray-400">— Chưa có yêu cầu —</span>}
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-bold text-gray-900 mb-2">Quyền lợi</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {job.benefits || <span className="text-gray-400">— Chưa có quyền lợi —</span>}
            </p>
          </div>

          {job.channels && job.channels.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <h2 className="text-base font-bold text-gray-900 mb-3">Kênh đăng ({job.channels.length})</h2>
              <ul className="space-y-2">
                {job.channels.map(ch => (
                  <li key={ch.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{ch.channel_type_display}</p>
                      {ch.url && (
                        <a
                          href={ch.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary-600 hover:underline truncate block"
                        >
                          {ch.url}
                        </a>
                      )}
                      {ch.notes && <p className="text-xs text-gray-500 mt-1">{ch.notes}</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ch.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                      {ch.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <h2 className="text-base font-bold text-gray-900 mb-3">
              Đơn ứng tuyển ({applications.length})
            </h2>
            {applications.length === 0 ? (
              <p className="text-sm text-gray-400">Chưa có ứng viên nào nộp đơn cho JD này.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {applications.map(app => (
                  <li key={app.id} className="py-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {app.candidate_name || `Ứng viên #${app.candidate}`}
                      </p>
                      <p className="text-xs text-gray-500">
                        Stage: {app.current_stage_display} · {new Date(app.applied_at).toLocaleDateString('vi-VN')}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                      {app.status_display}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecruitmentJobDetail;

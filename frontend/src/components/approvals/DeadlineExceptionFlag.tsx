import { LockOpenIcon } from '@heroicons/react/24/outline';
import type { AppliedDeadlineException } from '../../services/deadlineException.service';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

const describe = (g: AppliedDeadlineException) =>
  `${g.request_type_display} · mở bởi ${g.granted_by_name || 'không rõ'} lúc ${fmt(g.created_at)}` +
  ` · ${g.granted_before_created ? 'trước khi tạo đơn' : 'sau khi tạo đơn (gỡ hạn duyệt/huỷ/sửa)'}` +
  (g.note ? ` · Lý do: ${g.note}` : ' · Không ghi lý do') +
  (g.revoked_at ? ` · Đã thu hồi lúc ${fmt(g.revoked_at)}` : '');

/** Cờ nhỏ cạnh tên loại đơn trong danh sách. */
export function DeadlineExceptionBadge({ grants }: { grants?: AppliedDeadlineException[] }) {
  if (!grants?.length) return null;
  return (
    <span
      className="inline-flex items-center gap-1 shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
      title={grants.map(describe).join('\n')}
    >
      <LockOpenIcon className="h-3 w-3" />
      Mở khoá đặc biệt
    </span>
  );
}

/** Khối chi tiết trong modal "Thông tin đơn". */
export function DeadlineExceptionDetail({ grants }: { grants?: AppliedDeadlineException[] }) {
  if (!grants?.length) return null;
  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-amber-800">
        <LockOpenIcon className="h-4 w-4" />
        Đơn được HCNS/Admin mở khoá đặc biệt (Quản lý công)
      </div>
      <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
        {grants.map((g) => (
          <li key={g.id}>
            <span className="font-semibold">{g.request_type_display}</span>
            {' — mở bởi '}<span className="font-semibold">{g.granted_by_name || 'không rõ'}</span>
            {' lúc '}{fmt(g.created_at)}
            {' · '}{g.granted_before_created ? 'trước khi tạo đơn (gỡ hạn tạo)' : 'sau khi tạo đơn (gỡ hạn duyệt/huỷ/sửa)'}
            <div className="text-xs text-amber-700">
              {g.note ? `Lý do: ${g.note}` : 'Không ghi lý do'}
              {g.revoked_at ? ` · Đã thu hồi lúc ${fmt(g.revoked_at)}` : ''}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

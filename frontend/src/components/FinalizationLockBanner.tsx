import React, { useState, useEffect } from 'react';
import { LockClosedIcon, ClockIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { workFinalizationService } from '../services/workFinalization.service';
import type { LockCheckResponse } from '../services/workFinalization.service';

interface Props {
  year: number;
  month: number;
  /** Roles được bypass lock → ẩn banner. Mặc định không ai bypass. */
  bypassRoles?: string[];
}

function formatDateTime(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${mon}/${d.getFullYear()}`;
}

function formatTimeDiff(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  const m = totalMinutes % 60;
  const s = totalSeconds % 60;

  if (totalDays > 0) return `${totalDays} ngày ${h} giờ ${m} phút ${s} giây`;
  if (totalHours > 0) return `${h} giờ ${m} phút ${s} giây`;
  if (totalMinutes > 0) return `${m} phút ${s} giây`;
  return `${s} giây`;
}

function formatCountdown(target: Date): { text: string; urgent: boolean } {
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { text: formatTimeDiff(Math.abs(diffMs)), urgent: true };
  }

  return { text: `Còn ${formatTimeDiff(diffMs)}`, urgent: diffMs < 60 * 60 * 1000 };
}

const FinalizationLockBanner: React.FC<Props> = ({ year, month, bypassRoles = [] }) => {
  const { user } = useAuth();
  const userRole = user?.role ? user.role.toUpperCase() : 'USER';
  const canBypass = bypassRoles.some(r => r.toUpperCase() === userRole);

  const [lockInfo, setLockInfo] = useState<LockCheckResponse | null>(null);
  const [countdown, setCountdown] = useState<{ text: string; urgent: boolean } | null>(null);

  useEffect(() => {
    if (!year || !month) return;
    workFinalizationService
      .checkLock(year, month)
      .then(setLockInfo)
      .catch(() => setLockInfo(null));
  }, [year, month]);

  // Countdown timer — cập nhật mỗi phút
  useEffect(() => {
    // Chưa khóa → đếm ngược đến lock_start_at
    // Đã khóa → đếm thời gian đã khóa từ locked_at
    const refTime = lockInfo?.is_locked
      ? lockInfo?.locked_at
      : lockInfo?.lock_start_at;
    if (!refTime) {
      setCountdown(null);
      return;
    }
    const target = new Date(refTime);
    const update = () => setCountdown(formatCountdown(target));
    update();
    const interval = setInterval(update, 1_000);
    return () => clearInterval(interval);
  }, [lockInfo]);

  if (!lockInfo) return null;

  // HR/Admin bypass → ẩn banner
  if (canBypass) return null;

  // Đã khóa → banner đỏ + countdown từ lúc khóa
  if (lockInfo.is_locked) {
    const lockedSince = lockInfo.locked_at ? new Date(lockInfo.locked_at) : null;
    const firstLocked = lockInfo.first_half_locked;
    const secondLocked = lockInfo.second_half_locked;
    let summary: string;
    if (firstLocked !== undefined && secondLocked !== undefined) {
      if (firstLocked && secondLocked) summary = `Tháng ${month}/${year} đã khóa cả 2 nửa.`;
      else if (firstLocked) summary = `Tháng ${month}/${year}: nửa đầu (1-15) đã khóa.`;
      else summary = `Tháng ${month}/${year}: nửa sau (16-cuối) đã khóa.`;
    } else {
      summary = `Tháng ${month}/${year} đã khóa chốt công.`;
    }

    return (
      <div className="flex items-center justify-between p-3 text-sm bg-red-50 rounded-lg border border-red-200 text-red-800">
        <div className="flex items-center gap-2">
          <LockClosedIcon className="w-5 h-5 flex-shrink-0" />
          <span>
            <strong>{summary}</strong>{' '}
            Tạo đơn cho ngày thuộc nửa đã khóa sẽ bị chặn. Phê duyệt vẫn diễn ra bình thường.
            {lockedSince && (
              <span className="text-red-600">
                {' '}(Từ {formatDateTime(lockedSince)})
              </span>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Chưa khóa + có deadline + countdown
  if (lockInfo.lock_start_at && countdown) {
    const deadline = new Date(lockInfo.lock_start_at);

    // flex-wrap: trên điện thoại ô đếm ngược (khá dài) tự xuống hàng thay vì
    // ép dòng hạn chót thành cột hẹp.
    return (
      <div className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm rounded-lg border ${
        countdown.urgent
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}>
        <div className="flex items-center gap-2">
          <ClockIcon className={`w-5 h-5 flex-shrink-0 ${countdown.urgent ? 'text-red-500' : 'text-amber-500'}`} />
          <span>
            Hạn chót tạo đơn tháng {month}/{year}:{' '}
            <strong>{formatDateTime(deadline)}</strong>
          </span>
        </div>
        <span className={`flex-shrink-0 ml-auto font-semibold px-2.5 py-1 rounded-full text-xs ${
          countdown.urgent
            ? 'bg-red-100 text-red-700 animate-pulse'
            : 'bg-amber-100 text-amber-700'
        }`}>
          {countdown.text}
        </span>
      </div>
    );
  }

  return null;
};

export default FinalizationLockBanner;

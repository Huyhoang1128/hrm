/**
 * Quy định hệ thống — NGUỒN DUY NHẤT là backend: GET /api-hrm/system-rules/ (backend/hrm/system_rules).
 *
 * Web KHÔNG tự ghi cứng con số / khung giờ / danh sách lựa chọn mà backend đã có (hạn mức, ngưỡng,
 * giới hạn file, độ dài tối đa, tỷ lệ...). Đọc ở đây để hiển thị và kiểm tra đúng như backend; đổi
 * cấu hình ở backend là web theo, không cần sửa FE.
 *
 * - Gọi 1 lần rồi dùng lại (cache theo phiên đăng nhập: đổi token -> tải lại, vì chưa đăng nhập
 *   backend chỉ trả các section public).
 * - Đang tải / lỗi mạng: useSystemRules() trả null — chỗ dùng tự xử lý (ẩn câu chữ, không chặn
 *   bằng số đoán), KHÔNG thay bằng số ghi cứng.
 */
import { useEffect, useState } from 'react';
import { managementApi } from '../utils/api';
import type { AttendanceRules } from '../types/systemRules/attendance';
import type { PayrollRules } from '../types/systemRules/payroll';
import type { HrRules } from '../types/systemRules/hr';
import type { MiscRules } from '../types/systemRules/misc';

/** Mỗi mảng khai báo các section của mình (tên section là key cấp 1 của response). */
export type SystemRules = AttendanceRules & PayrollRules & HrRules & MiscRules;

const URL = '/api-hrm/system-rules/';

let cached: { token: string | null; promise: Promise<SystemRules> } | null = null;

const currentToken = (): string | null => {
  try {
    return localStorage.getItem('accessToken');
  } catch {
    return null;
  }
};

/** Lấy quy định (dùng lại kết quả đã tải trong cùng phiên đăng nhập). force=true: tải lại. */
export function getSystemRules(force = false): Promise<SystemRules> {
  const token = currentToken();
  if (!force && cached && cached.token === token) return cached.promise;
  const promise = managementApi
    .get<SystemRules>(URL)
    .then((res) => res.data)
    .catch((err) => {
      // Lỗi thì lần sau thử lại, không giữ promise hỏng.
      if (cached?.promise === promise) cached = null;
      throw err;
    });
  cached = { token, promise };
  return promise;
}

/** Hook: null khi đang tải hoặc lỗi. */
export function useSystemRules(): SystemRules | null {
  const [rules, setRules] = useState<SystemRules | null>(null);
  useEffect(() => {
    let alive = true;
    getSystemRules()
      .then((data) => {
        if (alive) setRules(data);
      })
      .catch(() => {
        if (alive) setRules(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return rules;
}

/** "10 MB" / "500 KB" từ số byte backend trả — để câu chữ giới hạn file khớp đúng số backend kiểm tra. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  const kb = bytes / 1024;
  return `${Number.isInteger(kb) ? kb : kb.toFixed(1)} KB`;
}

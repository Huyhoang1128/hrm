/**
 * Convert YYYY-MM-DD (API format) → DD/MM/YYYY (display format)
 */
export function toDisplayDate(s: string | null | undefined): string {
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

/**
 * Convert DD/MM/YYYY (display format) → YYYY-MM-DD (API format)
 * Trả về chuỗi rỗng nếu không parse được.
 */
export function toApiDate(s: string | null | undefined): string {
  if (!s) return '';
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // Nếu đã là YYYY-MM-DD thì giữ nguyên
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

/**
 * Format để hiển thị (dùng trong JSX text, không phải input)
 */
export function formatDate(s: string | null | undefined): string {
  if (!s) return 'Chưa có dữ liệu';
  return toDisplayDate(s) || s;
}

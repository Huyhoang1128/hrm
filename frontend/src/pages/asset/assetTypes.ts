// "Phân loại" tài sản là text tự do: gõ gì lưu nấy, không còn quy giá trị lạ về
// "Khác". Các mã dưới đây là loại CHUẨN có hành vi riêng (SIM, cấu hình máy...)
// — cùng danh sách với backend hrm.models.ASSET_TYPE.
import type { SelectOption } from '../../components/LandingLayout/SelectBox';

export const ASSET_TYPE_LABELS: Record<string, string> = {
  LAPTOP: 'Laptop',
  DESKTOP: 'Máy tính để bàn',
  MONITOR: 'Màn hình',
  SIM: 'Sim',
  PHONE: 'Điện thoại',
  TABLET: 'Máy tính bảng',
  PRINTER: 'Máy in',
  SCANNER: 'Máy scan',
  NETWORK: 'Thiết bị mạng',
  SERVER: 'Máy chủ',
  FURNITURE: 'Nội thất',
  VEHICLE: 'Phương tiện',
  OTHER: 'Khác',
};

export const STANDARD_ASSET_TYPES = Object.keys(ASSET_TYPE_LABELS);

export const ASSET_TYPE_MAX_LENGTH = 100;

const ALIASES: Record<string, string> = { 'máy tính xách tay': 'LAPTOP' };

/**
 * Chuẩn hoá "Phân loại" giống backend normalize_asset_type(): giá trị trùng y hệt
 * (không phân biệt hoa thường) mã hoặc nhãn của loại chuẩn → mã chuẩn; còn lại giữ
 * nguyên chữ đã gõ (đã gom khoảng trắng).
 */
export const normalizeAssetType = (raw?: string | null): string => {
  const text = (raw || '').split(/\s+/).filter(Boolean).join(' ');
  if (!text) return '';
  const key = text.toLocaleLowerCase('vi');
  for (const [code, label] of Object.entries(ASSET_TYPE_LABELS)) {
    if (key === code.toLocaleLowerCase('vi') || key === label.toLocaleLowerCase('vi')) return code;
  }
  return ALIASES[key] || text;
};

/** Nhãn hiển thị cho 1 giá trị Phân loại (mã chuẩn → nhãn, loại tự do giữ nguyên). */
export const assetTypeLabel = (value?: string | null): string =>
  (value && ASSET_TYPE_LABELS[value]) || value || '';

/**
 * Loại có Số lượng + bàn giao cho nhiều người: Màn hình, Khác, và mọi Phân loại
 * gõ tự do. Khớp backend Asset.is_multi_holder_type().
 */
export const isMultiHolderType = (assetType?: string | null): boolean =>
  !!assetType && (assetType === 'MONITOR' || assetType === 'OTHER' || !STANDARD_ASSET_TYPES.includes(assetType));

/** Lựa chọn lọc theo Phân loại, lấy từ chính dữ liệu đang có (gồm cả loại tự do). */
export const assetTypeOptionsFrom = (
  items: Array<{ asset_type?: string | null; asset_type_display?: string | null }>,
): SelectOption<string>[] => {
  const labels = new Map<string, string>();
  items.forEach((it) => {
    if (it.asset_type && !labels.has(it.asset_type)) {
      labels.set(it.asset_type, it.asset_type_display || it.asset_type);
    }
  });
  return Array.from(labels, ([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
};

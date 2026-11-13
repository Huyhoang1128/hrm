// "Phân loại" tài sản là text tự do: gõ gì lưu nấy, không còn quy giá trị lạ về
// "Khác". Loại CHUẨN (có hành vi riêng: SIM, cấu hình máy...), độ dài tối đa, tên gọi
// khác, loại nhiều người giữ và tình trạng không được bàn giao đều lấy từ backend
// (GET /api-hrm/system-rules/ section "assets", nguồn hrm/models.py) — không chép ở web.
import type { SelectOption } from '../../components/LandingLayout/SelectBox';
import { useSystemRules } from '../../services/systemRules.service';
import type { AssetRules } from '../../types/systemRules/misc';

/** Quy định Phân loại / bàn giao tài sản từ backend; null khi đang tải hoặc lỗi. */
export const useAssetRules = (): AssetRules | null => useSystemRules()?.assets ?? null;

/**
 * Chuẩn hoá "Phân loại" giống backend normalize_asset_type(): giá trị trùng y hệt
 * (không phân biệt hoa thường) mã hoặc nhãn của loại chuẩn → mã chuẩn; còn lại giữ
 * nguyên chữ đã gõ (đã gom khoảng trắng). Chưa có quy định thì chỉ gom khoảng trắng.
 */
export const normalizeAssetType = (raw: string | null | undefined, rules: AssetRules | null): string => {
  const text = (raw || '').split(/\s+/).filter(Boolean).join(' ');
  if (!text || !rules) return text;
  const key = text.toLocaleLowerCase('vi');
  for (const { value, label } of rules.standard_types) {
    if (key === value.toLocaleLowerCase('vi') || key === label.toLocaleLowerCase('vi')) return value;
  }
  return rules.type_aliases[key] || text;
};

/** Nhãn hiển thị cho 1 giá trị Phân loại (mã chuẩn → nhãn, loại tự do giữ nguyên). */
export const assetTypeLabel = (value: string | null | undefined, rules: AssetRules | null): string =>
  (value && rules?.standard_types.find((t) => t.value === value)?.label) || value || '';

/**
 * Loại có Số lượng + bàn giao cho nhiều người: các loại backend khai báo (Màn hình, Khác) và
 * mọi Phân loại gõ tự do. Khớp backend Asset.is_multi_holder_type().
 */
export const isMultiHolderType = (assetType: string | null | undefined, rules: AssetRules | null): boolean =>
  !!assetType && !!rules
  && (rules.multi_holder_types.includes(assetType) || !rules.standard_types.some((t) => t.value === assetType));

/** Tình trạng được phép bàn giao (backend chặn các tình trạng trong unassignable_conditions). */
export const isAssignableCondition = (condition: string | null | undefined, rules: AssetRules | null): boolean =>
  !condition || !rules || !rules.unassignable_conditions.includes(condition);

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

import React, { useState, useEffect } from 'react';
import {
  XMarkIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  EyeIcon,
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import { managementApi } from '../utils/api';
import PdfFrame from '../components/Common/PdfFrame';

// ============================================
// TYPES
// ============================================

interface PlaceholderItem {
  key: string;       // e.g. "{{ho_ten}}"
  value: string;     // giá trị đã fill từ backend
  auto_filled: boolean; // true = có dữ liệu, false = HR cần nhập
}

interface Props {
  contractId: number;
  onClose: () => void;
  onSuccess: (fileUrl: string) => void;
}

// Label hiển thị cho các placeholder đã biết
const KNOWN_LABELS: Record<string, string> = {
  '{{ho_ten}}': 'Họ và tên',
  '{{ma_nhan_vien}}': 'Mã nhân viên',
  '{{ngay_sinh}}': 'Ngày sinh',
  '{{so_dien_thoai}}': 'Số điện thoại',
  '{{email}}': 'Email',
  '{{tinh_trang_hon_nhan}}': 'Tình trạng hôn nhân',
  '{{trinh_do_hoc_van}}': 'Trình độ học vấn',
  '{{noi_sinh}}': 'Nơi sinh',
  '{{dan_toc}}': 'Dân tộc',
  '{{quoc_tich}}': 'Quốc tịch',
  '{{so_cccd}}': 'Số CCCD',
  '{{ngay_cap_cccd}}': 'Ngày cấp CCCD',
  '{{noi_cap_cccd}}': 'Nơi cấp CCCD',
  '{{ma_so_thue}}': 'Mã số thuế',
  '{{ma_bhxh}}': 'Mã số BHXH',
  '{{dia_chi}}': 'Địa chỉ thường trú',
  '{{dia_chi_hien_tai}}': 'Địa chỉ hiện tại',
  '{{so_tai_khoan}}': 'Số tài khoản',
  '{{ten_ngan_hang}}': 'Tên ngân hàng',
  '{{chu_tai_khoan}}': 'Người thụ hưởng / chủ tài khoản',
  '{{phong_ban}}': 'Phòng ban',
  '{{vi_tri}}': 'Vị trí',
  '{{chuc_vu}}': 'Chức vụ / Cấp bậc',
  '{{rank}}': 'Rank',
  '{{quan_ly_truc_tiep}}': 'Quản lý trực tiếp',
  '{{hinh_thuc_lam_viec}}': 'Hình thức làm việc',
  '{{dia_diem_lam_viec}}': 'Địa điểm làm việc',
  '{{ngay_bat_dau}}': 'Ngày bắt đầu',
  '{{ngay_chinh_thuc}}': 'Ngày lên chính thức',
  '{{loai_hop_dong}}': 'Loại hợp đồng',
  '{{loai_hop_dong_nv}}': 'Loại HĐ nhân viên',
  '{{loai_hinh_dich_vu}}': 'Loại hình dịch vụ (HĐ dịch vụ)',
  '{{ngay_ky}}': 'Ngày ký',
  '{{thoi_han_hop_dong}}': 'Ngày hết hạn HĐ',
  '{{luong_co_ban}}': 'Lương cơ bản',
  '{{ngay_ket_thuc_thu_viec}}': 'Ngày kết thúc thử việc',
  '{{phan_tram_luong_thu_viec}}': '% Lương thử việc',
  '{{ty_le_luong_thang_dau}}': '% Lương thử việc - tháng đầu tiên',
  '{{ty_le_luong_thang_hai}}': '% Lương thử việc - tháng thứ hai',
  '{{nguoi_lien_he_khan_cap}}': 'Người liên hệ khẩn cấp',
  '{{sdt_nguoi_lien_he}}': 'SĐT người liên hệ',
  '{{quan_he_nguoi_lien_he}}': 'Quan hệ người liên hệ',
  '{{so_hd}}': 'Số hợp đồng',
  '{{ngay_bat_dau_thuc_tap}}': 'Ngày bắt đầu thực tập',
  '{{ngay_ket_thuc_thuc_tap}}': 'Ngày kết thúc thực tập',
  '{{vi_tri_thuc_tap}}': 'Vị trí thực tập',
  '{{tro_cap_thuc_tap}}': 'Trợ cấp thực tập (đồng/tháng)',
  '{{ngay_hieu_luc}}': 'Ngày có hiệu lực',
  '{{tro_cap_thuc_tap_bang_chu}}': 'Trợ cấp thực tập (bằng chữ)',
  '{{dich_vu}}': 'Dịch vụ',
  '{{thhddv}}' : 'Thời hạn hợp đồng dịch vụ',
  '{{ngay_bat_dau_hd_dv}}': 'Ngày bắt đầu hợp đồng dịch vụ',
  '{{ngay_ket_thuc_hd_dv}}': 'Ngày kết thúc hợp đồng dịch vụ',
};

const getLabel = (key: string) => KNOWN_LABELS[key] || key.replace(/^\{\{|\}\}$/g, '').replace(/_/g, ' ');

// {{luong_co_ban_bang_chu}} luôn được backend tính lại từ {{luong_co_ban}} lúc tạo
// PDF (xem generate_pdf_with_override) — không cho HR sửa tay riêng field này nữa
// vì sửa xong cũng bị ghi đè, dễ gây hiểu lầm. Ẩn khỏi danh sách field chỉnh sửa,
// thay bằng dòng preview tính trực tiếp trên FE (xem amountToVietnameseWords).
const DERIVED_KEYS = new Set(['{{luong_co_ban_bang_chu}}', '{{so_thang_thu_viec_bang_chu}}']);

const VN_DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

const readThreeDigitsVn = (n: number, full: boolean): string => {
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  const parts: string[] = [];
  if (h > 0 || full) parts.push(`${VN_DIGITS[h]} trăm`);
  if (t > 1) {
    parts.push(`${VN_DIGITS[t]} mươi`);
    if (o === 1) parts.push('mốt');
    else if (o === 5) parts.push('lăm');
    else if (o > 0) parts.push(VN_DIGITS[o]);
  } else if (t === 1) {
    parts.push('mười');
    if (o === 5) parts.push('lăm');
    else if (o > 0) parts.push(VN_DIGITS[o]);
  } else if (t === 0 && o > 0) {
    if (h > 0 || full) parts.push('lẻ');
    parts.push(VN_DIGITS[o]);
  }
  return parts.join(' ');
};

// Đọc số tiền VNĐ thành chữ — port từ _amount_to_vietnamese_words() bên backend,
// chỉ dùng để preview tức thời trên UI (giá trị dùng để in PDF luôn tính lại ở
// server, xem generate_pdf_with_override).
const amountToVietnameseWords = (raw: string): string => {
  const digits = (raw || '').replace(/[^\d]/g, '');
  const num = digits ? parseInt(digits, 10) : 0;
  if (!num || num <= 0) return '';

  const groups: number[] = [];
  let n = num;
  while (n > 0) {
    groups.unshift(n % 1000);
    n = Math.floor(n / 1000);
  }

  const units = ['', 'nghìn', 'triệu', 'tỷ'];
  const total = groups.length;
  const out: string[] = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    out.push(readThreeDigitsVn(g, out.length > 0));
    const unit = units[total - 1 - i] ?? '';
    if (unit) out.push(unit);
  });

  const result = out.join(' ').trim();
  if (!result) return '';
  return `${result.charAt(0).toUpperCase()}${result.slice(1)} đồng`;
};

// ============================================
// MAIN COMPONENT
// ============================================

const ContractPlaceholderModal: React.FC<Props> = ({ contractId, onClose, onSuccess }) => {
  const [items, setItems] = useState<PlaceholderItem[]>([]);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loadingTemplate, setLoadingTemplate] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAutoFilled, setShowAutoFilled] = useState(false);

  // Bước 1: load placeholder từ backend (đã kèm giá trị fill sẵn)
  useEffect(() => {
    const load = async () => {
      setLoadingTemplate(true);
      try {
        const { data } = await managementApi.get(
          `/api-hrm/employee-contracts/${contractId}/get_placeholders/`
        );
        setItems(data.placeholders || []);
      } catch (err: any) {
        setError(err.response?.data?.message || 'Không thể tải danh sách trường hợp đồng');
      } finally {
        setLoadingTemplate(false);
      }
    };
    load();
  }, [contractId]);

  const handleChange = (key: string, val: string) => {
    setOverrides(prev => ({ ...prev, [key]: val }));
  };

  const getValue = (item: PlaceholderItem) =>
    overrides[item.key] !== undefined ? overrides[item.key] : item.value;

  // Trường HR cần nhập: auto_filled=false VÀ chưa có override. Loại DERIVED_KEYS
  // (vd. luong_co_ban_bang_chu) — các field này backend luôn tự tính lại từ field
  // gốc lúc tạo PDF nên không cho sửa tay, tránh HR tưởng sửa được mà bị bỏ qua.
  const manualItems = items.filter(i => !i.auto_filled && !DERIVED_KEYS.has(i.key));
  const emptyCount = manualItems.filter(i => !getValue(i)).length;
  const autoItems = items.filter(i => i.auto_filled && !DERIVED_KEYS.has(i.key));
  const changedCount = Object.keys(overrides).length;

  // Bước 2: generate PDF với overrides
  const handlePreview = async () => {
    setPreviewLoading(true);
    setError(null);
    try {
      // Gửi toàn bộ values (auto + override) để backend dùng
      const allValues: Record<string, string> = {};
      items.forEach(i => { allValues[i.key] = getValue(i); });
      // overrides sẽ ghi đè lên

      const { data } = await managementApi.post(
        `/api-hrm/employee-contracts/${contractId}/generate_pdf_with_override/`,
        { overrides: allValues }
      );
      if (!data.success) throw new Error(data.message || 'Không thể tạo PDF');
      setPreviewUrl(data.file_url);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Lỗi tạo PDF xem trước');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!previewUrl) return;
    try {
      await managementApi.post(
        `/api-hrm/employee-contracts/${contractId}/confirm_contract/`,
        { file_url: previewUrl }
      );
      onSuccess(previewUrl);
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Lỗi xác nhận hợp đồng');
    }
  };

  // ── Loading ──
  if (loadingTemplate) return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-3 shadow-xl">
        <ArrowPathIcon className="w-8 h-8 text-primary-600 animate-spin" />
        <p className="text-gray-600 text-sm">Đang tải dữ liệu hợp đồng...</p>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-7xl h-[95vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 bg-primary-100 text-primary-600 rounded-xl flex items-center justify-center">
              <DocumentTextIcon className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-900">Xuất PDF hợp đồng</h4>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs text-emerald-600">
                  ✓ {autoItems.length} trường tự động điền
                </span>
                {emptyCount > 0 && (
                  <span className="text-xs text-red-500 font-medium">
                    · {emptyCount} trường cần bổ sung
                  </span>
                )}
                {changedCount > 0 && (
                  <span className="text-xs text-amber-600 font-medium">
                    · {changedCount} trường đã sửa
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0">

          {/* ── CỘT TRÁI ── */}
          <div className="w-full lg:w-[380px] flex-shrink-0 flex flex-col border-r border-gray-100">
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

              {/* Trường HR cần nhập */}
              {manualItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">
                    Cần bổ sung ({manualItems.length} trường)
                  </p>
                  <div className="space-y-3">
                    {manualItems.map(item => {
                      const val = getValue(item);
                      const isEmpty = !val;
                      const isChanged = overrides[item.key] !== undefined;
                      return (
                        <div key={item.key}>
                          <label className="flex items-center justify-between text-xs font-medium mb-1">
                            <span className={isEmpty ? 'text-red-600' : 'text-gray-700'}>
                              {isEmpty && <span className="mr-1">*</span>}
                              {getLabel(item.key)}
                            </span>
                            {isChanged && <span className="text-amber-500 text-xs font-normal">đã sửa</span>}
                          </label>
                          <input
                            type="text"
                            value={val}
                            onChange={e => handleChange(item.key, e.target.value)}
                            placeholder={`Nhập ${getLabel(item.key)}...`}
                            className={`input-field ${
                              isEmpty
                                ? 'border-red-300 bg-red-50 placeholder-red-300 focus:ring-red-500'
                                : ''
                            }`}
                          />
                          {item.key === '{{luong_co_ban}}' && (
                            <p className="mt-1 text-xs text-gray-400 italic">
                              Bằng chữ: {amountToVietnameseWords(val) || '—'}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {manualItems.length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <div className="h-9 w-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center mb-3">
                    <CheckIcon className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-medium text-emerald-700">Tất cả trường đã được điền tự động!</p>
                  <p className="text-xs text-gray-500 mt-1">Bạn có thể xuất PDF ngay hoặc xem lại bên dưới.</p>
                </div>
              )}

              {/* Trường tự động điền — thu gọn, cho phép HR sửa nếu muốn */}
              {autoItems.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowAutoFilled(v => !v)}
                    className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 hover:text-gray-700 transition-colors"
                  >
                    <PencilIcon className="w-3.5 h-3.5" />
                    {showAutoFilled ? 'Ẩn' : 'Xem & sửa'} trường tự động ({autoItems.length})
                  </button>
                  {showAutoFilled && (
                    <div className="space-y-3 border border-gray-100 rounded-xl p-3 bg-gray-50">
                      {autoItems.map(item => {
                        const val = getValue(item);
                        const isChanged = overrides[item.key] !== undefined;
                        return (
                          <div key={item.key}>
                            <label className="flex items-center justify-between text-xs font-medium text-gray-600 mb-1">
                              {getLabel(item.key)}
                              {isChanged && <span className="text-amber-500 font-normal">đã sửa</span>}
                            </label>
                            <input
                              type="text"
                              value={val}
                              onChange={e => handleChange(item.key, e.target.value)}
                              className={`input-field ${
                                isChanged ? 'border-amber-400 bg-amber-50 focus:ring-amber-500' : ''
                              }`}
                            />
                            {item.key === '{{luong_co_ban}}' && (
                              <p className="mt-1 text-xs text-gray-400 italic">
                                Bằng chữ: {amountToVietnameseWords(val) || '—'}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Nút xuất PDF */}
            <div className="border-t border-gray-100 px-4 py-4 flex-shrink-0 space-y-2 bg-gray-50 rounded-b-none">
              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
              )}
              {emptyCount > 0 && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  ⚠️ Còn {emptyCount} trường chưa điền — PDF sẽ để trống những chỗ đó.
                </p>
              )}
              <button
                onClick={handlePreview}
                disabled={previewLoading || emptyCount > 0}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {previewLoading
                  ? <><ArrowPathIcon className="w-4 h-4 animate-spin" />Đang tạo...</>
                  : <><EyeIcon className="w-4 h-4" />{previewUrl ? 'Cập nhật xem trước' : 'Tạo xem trước'}</>
                }
              </button>
            </div>
          </div>

          {/* ── CỘT PHẢI: PDF Preview ── */}
          <div className="flex-1 flex flex-col min-w-0">
            {previewUrl && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-2 border-b border-gray-100 bg-gray-50 flex-shrink-0">
                <p className="text-xs text-gray-500">
                  {previewLoading ? 'Đang cập nhật...' : 'Xem trước PDF'}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <a
                    href={previewUrl} target="_blank" rel="noopener noreferrer"
                    className="btn-secondary flex items-center gap-1 px-3 py-1 text-xs"
                  >
                    <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
                    Mở tab mới
                  </a>
                  <button
                    onClick={handleConfirm}
                    className="btn-primary flex items-center gap-1 px-3 py-1 text-xs"
                  >
                    <CheckIcon className="w-3.5 h-3.5" />
                    Xác nhận dùng bản này
                  </button>
                </div>
              </div>
            )}

            {previewUrl ? (
              <div className="relative flex-1 min-h-0">
                {previewLoading && (
                  <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3">
                      <ArrowPathIcon className="w-8 h-8 text-primary-600 animate-spin" />
                      <p className="text-sm text-gray-600">Đang cập nhật PDF...</p>
                    </div>
                  </div>
                )}
                <PdfFrame src={previewUrl} className="w-full h-full border-0" title="Xem trước hợp đồng" />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center bg-gray-50 text-center px-8">
                <div className="h-20 w-20 rounded-full bg-primary-50 flex items-center justify-center mb-4">
                  <DocumentTextIcon className="w-10 h-10 text-primary-400" />
                </div>
                <h3 className="text-base font-medium text-gray-700 mb-2">Chưa có bản xem trước</h3>
                <p className="text-sm text-gray-500 max-w-xs">
                  {emptyCount > 0
                    ? `Điền ${emptyCount} trường còn thiếu bên trái, sau đó bấm "Tạo xem trước".`
                    : 'Bấm "Tạo xem trước" để xem PDF hợp đồng tại đây.'
                  }
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContractPlaceholderModal;

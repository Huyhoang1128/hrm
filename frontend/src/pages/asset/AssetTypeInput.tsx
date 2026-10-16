import React, { useEffect, useState } from 'react';
import { assetsAPI } from '../../utils/api';
import { ASSET_TYPE_MAX_LENGTH } from './assetTypes';

interface AssetTypeInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Ô "Phân loại" — text tự do (gõ gì lưu nấy, không quy về
 * "Khác"). Gợi ý các loại đã dùng (nhiều tài sản nhất lên đầu) để HCNS gõ thống
 * nhất, tránh "CCDCVP" / "CCDC VP" thành 2 loại khác nhau.
 */
export default function AssetTypeInput({ value, onChange }: AssetTypeInputProps) {
  const [suggestions, setSuggestions] = useState<Array<{ label: string; count: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    assetsAPI.typeOptions()
      .then((opts) => { if (!cancelled) setSuggestions(opts); })
      .catch(() => { /* gợi ý là phụ — lỗi thì vẫn gõ tay được */ });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <input
        type="text"
        name="asset_type"
        id="asset_type"
        list="asset-type-suggestions"
        value={value}
        onChange={onChange}
        className="input-field mt-1"
        placeholder="Gõ tự do, VD: CCDC văn phòng, Laptop, Sim..."
        maxLength={ASSET_TYPE_MAX_LENGTH}
        autoComplete="off"
      />
      <datalist id="asset-type-suggestions">
        {suggestions.map((s) => (
          <option key={s.label} value={s.label}>
            {s.count > 0 ? `${s.count} tài sản` : ''}
          </option>
        ))}
      </datalist>
    </>
  );
}

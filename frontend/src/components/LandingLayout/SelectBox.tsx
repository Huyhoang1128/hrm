import React, { useState, memo, useMemo, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Listbox, Combobox } from "@headlessui/react";
import { ChevronUpDownIcon, CheckIcon } from "@heroicons/react/20/solid";

export interface SelectOption<T> {
  value: T;
  label: string;
}

interface SelectBoxProps<T> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  onQueryChange?: (query: string) => void;
  placeholder?: string;
  searchable?: boolean;
  size?: 'default' | 'lg';
  portal?: boolean;
  // Số kết quả tối đa hiển thị cùng lúc (kể cả khi ô tìm kiếm còn trống) —
  // mặc định 100 để UI mượt với danh sách lớn. Với dropdown chọn TRONG SỐ
  // TOÀN BỘ nhân viên công ty (vd: người nhận bàn giao tài sản — không giới
  // hạn phòng ban), 100 có thể cắt mất nhiều người ở cuối danh sách khi
  // chưa gõ tìm kiếm gì — truyền maxResults cao hơn cho các trường hợp đó.
  maxResults?: number;
  /** Khoá ô chọn: không bấm được, hiện mờ. Dùng khi lựa chọn hiện tại khiến ô
   *  này mất ý nghĩa (vd chọn "Tất cả tháng" thì ô Năm vô tác dụng) — khoá lại
   *  thay vì ẩn đi, để không làm xô lệch các nút bên cạnh. */
  disabled?: boolean;
}

// Danh sách thả xuống: trên điện thoại rộng bằng đúng ô chọn và cho nhãn dài
// xuống dòng (trước đây w-max khiến danh sách tràn khỏi mép phải màn hình, nhãn
// dài như tên ca kèm giờ bị cắt). Từ sm trở lên giữ như cũ: rộng theo nhãn dài nhất.
const OPTIONS_PANEL_CLS =
  "absolute z-50 mt-1 max-h-60 w-full sm:w-max sm:min-w-full sm:max-w-[min(32rem,90vw)] overflow-auto";
const OPTION_TEXT_CLS = "block break-words sm:truncate";

function SelectBoxInner<T>({
  label,
  value,
  options,
  onChange,
  onQueryChange,
  placeholder,
  searchable = false,
  size = 'default',
  portal = false,
  maxResults = 100,
  disabled = false,
}: SelectBoxProps<T>) {
  const [query, setQuery] = useState("");
  const anchorRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const updateMenuPosition = useCallback(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: r.bottom + 4,
      left: r.left,
      minWidth: r.width,
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (!portal) return;
    const el = anchorRef.current;
    if (!el) return;
    const obs = new ResizeObserver(updateMenuPosition);
    obs.observe(el);
    window.addEventListener('scroll', updateMenuPosition, true);
    window.addEventListener('resize', updateMenuPosition);
    return () => {
      obs.disconnect();
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [portal, updateMenuPosition]);

  const selected = options.find((o) => o.value === value) || null;

  const filteredOptions = useMemo(() => {
    const filtered = query === ""
      ? options
      : options.filter((option) =>
          option.label.toLowerCase().includes(query.toLowerCase())
        );

    // Limit results to keep UI snappy with large lists
    return filtered.slice(0, maxResults);
  }, [options, query, maxResults]);

  const isLg = size === 'lg';
  const labelCls = isLg ? "block text-base font-semibold mb-1.5 text-gray-800" : "block text-sm font-medium mb-1 text-gray-700";
  const inputCls = isLg ? "w-full border-none py-[13px] pl-4 pr-10 text-base leading-normal text-gray-900 focus:ring-0" : "w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 focus:ring-0";
  const wrapperCls = isLg
    ? "relative w-full cursor-default overflow-hidden rounded-xl bg-white text-left shadow-sm border-2 border-gray-200 hover:border-gray-300 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 transition-all"
    : "relative w-full cursor-default overflow-hidden rounded-lg bg-white text-left shadow-sm sm:text-sm border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500";
  const buttonCls = isLg
    ? "relative w-full cursor-pointer rounded-xl border-2 border-gray-200 hover:border-gray-300 bg-white py-[13px] pl-4 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-base shadow-sm transition-all"
    : "relative w-full cursor-pointer rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm shadow-sm";

  const disabledCls = disabled
    ? " opacity-50 cursor-not-allowed bg-gray-50 pointer-events-none"
    : "";

  const panelSkinCls = "rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm";
  // portal: vị trí / độ rộng tối thiểu do menuStyle tính theo ô chọn
  const optionsCls = `max-h-60 min-w-full w-max max-w-[min(32rem,90vw)] overflow-auto ${panelSkinCls}`;
  const inlineOptionsCls = `${OPTIONS_PANEL_CLS} ${panelSkinCls}`;

  // COMBOBOX MODE (Searchable)
  if (searchable) {
    const optionsContent = (
      <Combobox.Options className={portal ? optionsCls : inlineOptionsCls} style={portal ? menuStyle : undefined}>
        {filteredOptions.length === 0 && query !== "" ? (
          <div className="relative cursor-default select-none py-2 px-4 text-gray-700">
            Không tìm thấy kết quả.
          </div>
        ) : (
          filteredOptions.map((option) => (
            <Combobox.Option
              key={String(option.value)}
              className={({ active }) =>
                `relative cursor-default select-none py-2 pl-10 pr-4 ${active ? "bg-blue-600 text-white" : "text-gray-900"}`
              }
              value={option}
            >
              {({ selected, active }) => (
                <>
                  <span className={`${OPTION_TEXT_CLS} ${selected ? "font-medium" : "font-normal"}`}>{option.label}</span>
                  {selected && (
                    <span className={`absolute inset-y-0 left-0 flex items-center pl-3 ${active ? "text-white" : "text-blue-600"}`}>
                      <CheckIcon className="h-5 w-5" aria-hidden="true" />
                    </span>
                  )}
                </>
              )}
            </Combobox.Option>
          ))
        )}
      </Combobox.Options>
    );

    return (
      <div className="w-full">
        {label && <label className={labelCls}>{label}</label>}
        <Combobox
          value={selected}
          onChange={(v: SelectOption<T> | null) => { if (v) onChange(v.value); }}
          immediate
          disabled={disabled}
        >
          <div className="relative" ref={anchorRef}>
            <div className={wrapperCls + disabledCls}>
              <Combobox.Input
                className={inputCls}
                disabled={disabled}
                displayValue={(option: SelectOption<T> | null) => option?.label || ""}
                onChange={(event) => {
                  const nextQuery = event.target.value;
                  setQuery(nextQuery);
                  onQueryChange?.(nextQuery);
                }}
                onFocus={updateMenuPosition}
                placeholder={placeholder || "Tìm kiếm..."}
              />
              <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2" onClick={updateMenuPosition}>
                <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
              </Combobox.Button>
            </div>
            {portal ? createPortal(optionsContent, document.body) : optionsContent}
          </div>
        </Combobox>
      </div>
    );
  }

  // LISTBOX MODE (Standard)
  const fallbackSelected = selected || (placeholder ? { value, label: placeholder } : options[0]);

  const listboxOptions = (
    <Listbox.Options className={portal ? optionsCls : inlineOptionsCls} style={portal ? menuStyle : undefined}>
      {options.map((option) => (
        <Listbox.Option
          key={String(option.value)}
          value={option}
          className={({ active }) =>
            `relative cursor-pointer select-none py-2 pl-10 pr-4 ${active ? "bg-blue-100 text-blue-900" : "text-gray-900"}`
          }
        >
          {({ selected }) => (
            <>
              <span className={`${OPTION_TEXT_CLS} ${selected ? "font-medium" : "font-normal"}`}>{option.label}</span>
              {selected && (
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                  <CheckIcon className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
            </>
          )}
        </Listbox.Option>
      ))}
    </Listbox.Options>
  );

  return (
    <div className="w-full">
      {label && <label className={labelCls}>{label}</label>}
      <Listbox value={fallbackSelected} onChange={(v: any) => onChange(v.value)}>
        <div className="relative" ref={anchorRef}>
          <Listbox.Button className={buttonCls + disabledCls} disabled={disabled} onClick={updateMenuPosition}>
            <span className="block truncate">{fallbackSelected?.label || placeholder || "Chọn"}</span>
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer">
              <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </span>
          </Listbox.Button>
          {portal ? createPortal(listboxOptions, document.body) : listboxOptions}
        </div>
      </Listbox>
    </div>
  );
}

// Ensure the component is correctly typed when memoized
export const SelectBox = memo(SelectBoxInner) as typeof SelectBoxInner;


// ======== MultiSelectBox — chọn nhiều giá trị ========

interface MultiSelectBoxProps<T extends string> {
  label: string;
  value: T[];
  options: SelectOption<T>[];
  onChange: (value: T[]) => void;
  allLabel?: string;
}

function MultiSelectBoxInner<T extends string>({
  label,
  value,
  options,
  onChange,
  allLabel = 'Tất cả',
}: MultiSelectBoxProps<T>) {
  const allSelected = value.length === 0;
  const selectedLabels = options
    .filter((o) => value.includes(o.value))
    .map((o) => o.label);

  const displayText = allSelected
    ? allLabel
    : selectedLabels.length <= 2
      ? selectedLabels.join(', ')
      : `${selectedLabels.length} loại đã chọn`;

  const toggle = (v: T) => {
    if (value.includes(v)) {
      onChange(value.filter((x) => x !== v));
    } else {
      onChange([...value, v]);
    }
  };

  return (
    <div className="w-full">
      {label && <label className="block text-sm font-medium mb-1 text-gray-700">{label}</label>}
      <Listbox value={value} onChange={() => {}} multiple>
        <div className="relative">
          <Listbox.Button className="relative w-full cursor-pointer rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-10 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 sm:text-sm shadow-sm">
            <span className="block truncate">{displayText}</span>
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 cursor-pointer">
              <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
            </span>
          </Listbox.Button>
          <Listbox.Options className={`${OPTIONS_PANEL_CLS} rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm`}>
            {/* "Tất cả" option */}
            <div
              onClick={() => onChange([])}
              className={`relative cursor-pointer select-none py-2 pl-10 pr-4 hover:bg-blue-50 ${allSelected ? 'bg-blue-50 text-blue-900 font-medium' : 'text-gray-900'}`}
            >
              <span className="block truncate">{allLabel}</span>
              {allSelected && (
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                  <CheckIcon className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
            </div>
            {options.map((option) => {
              const isSelected = value.includes(option.value);
              return (
                <div
                  key={String(option.value)}
                  onClick={() => toggle(option.value)}
                  className={`relative cursor-pointer select-none py-2 pl-10 pr-4 hover:bg-blue-50 ${isSelected ? 'bg-blue-50 text-blue-900' : 'text-gray-900'}`}
                >
                  <span className={`${OPTION_TEXT_CLS} ${isSelected ? 'font-medium' : 'font-normal'}`}>
                    {option.label}
                  </span>
                  {isSelected && (
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-blue-600">
                      <CheckIcon className="h-5 w-5" aria-hidden="true" />
                    </span>
                  )}
                </div>
              );
            })}
          </Listbox.Options>
        </div>
      </Listbox>
    </div>
  );
}

export const MultiSelectBox = memo(MultiSelectBoxInner) as typeof MultiSelectBoxInner;

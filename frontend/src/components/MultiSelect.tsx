import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  CheckIcon,
} from '@heroicons/react/24/outline';

export interface MultiSelectOption {
  value: string;
  label: string;
  [key: string]: any;
}

export interface MultiSelectProps {
  options: MultiSelectOption[];
  value: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  loading?: boolean;
  onSearch?: (searchTerm: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  className?: string;
  disabled?: boolean;
  maxDisplayItems?: number;
  searchMode?: 'local' | 'api'; // New prop to control search mode
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Chọn...',
  searchPlaceholder = 'Tìm kiếm...',
  loading = false,
  onSearch,
  onLoadMore,
  hasMore = false,
  className = '',
  disabled = false,
  maxDisplayItems = 3,
  searchMode = 'local',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredOptions, setFilteredOptions] =
    useState<MultiSelectOption[]>(options);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Update filtered options when options or search term changes
  useEffect(() => {
    if (searchMode === 'local') {
      if (searchTerm.trim() === '') {
        setFilteredOptions(options);
      } else {
        const filtered = options.filter((option) =>
          option.label.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setFilteredOptions(filtered);
      }
    } else {
      // In API mode, always show all options (filtering is handled by API)
      setFilteredOptions(options);
    }
  }, [options, searchTerm, searchMode]);

  // Handle search with debounce
  useEffect(() => {
    if (onSearch && searchMode === 'api') {
      const timeoutId = setTimeout(() => {
        onSearch(searchTerm);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [searchTerm, onSearch, searchMode]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
      if (!isOpen) {
        setSearchTerm('');
      }
    }
  };

  const handleSelect = (option: MultiSelectOption) => {
    const newValue = value.includes(option.value)
      ? value.filter((v) => v !== option.value)
      : [...value, option.value];
    onChange(newValue);
  };

  const handleRemove = (valueToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newValue = value.filter((v) => v !== valueToRemove);
    onChange(newValue);
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const handleScroll = useCallback(() => {
    if (!listRef.current || !onLoadMore || !hasMore || loading) return;

    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 10) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, loading]);

  const getSelectedOptions = () => {
    return options.filter((option) => value.includes(option.value));
  };

  const getDisplayText = () => {
    const selectedOptions = getSelectedOptions();
    if (selectedOptions.length === 0) {
      return placeholder;
    }
    if (selectedOptions.length <= maxDisplayItems) {
      return selectedOptions.map((opt) => opt.label).join(', ');
    }
    return `${selectedOptions
      .slice(0, maxDisplayItems)
      .map((opt) => opt.label)
      .join(', ')} và ${selectedOptions.length - maxDisplayItems} khác`;
  };

  const selectedOptions = getSelectedOptions();

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected Items Display */}
      <div
        onClick={handleToggle}
        className={`
          relative w-full cursor-pointer rounded-md border border-gray-300 bg-white px-3 py-2 text-left shadow-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500
          ${disabled ? 'bg-gray-50 cursor-not-allowed' : 'hover:border-gray-400'}
        `}
      >
        <div className="flex flex-wrap gap-1">
          {selectedOptions.slice(0, maxDisplayItems).map((option) => (
            <span
              key={option.value}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800"
            >
              {option.label}
              <button
                type="button"
                onClick={(e) => handleRemove(option.value, e)}
                className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-blue-400 hover:bg-blue-200 hover:text-blue-500"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
          {selectedOptions.length > maxDisplayItems && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
              +{selectedOptions.length - maxDisplayItems} khác
            </span>
          )}
        </div>

        {selectedOptions.length === 0 && (
          <span className="text-gray-500">{placeholder}</span>
        )}

        {/* Clear All Button */}
        {selectedOptions.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        )}

        {/* Dropdown Arrow */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <ChevronDownIcon
            className={`h-5 w-5 text-gray-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-200">
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <MagnifyingGlassIcon className="h-4 w-4 text-gray-400" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={searchPlaceholder}
                className="block w-full rounded-md border-gray-300 pl-9 pr-3 py-2 text-sm placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Options List */}
          <div
            ref={listRef}
            onScroll={handleScroll}
            className="max-h-60 overflow-y-auto"
          >
            {loading && filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-gray-500 text-center">
                Đang tải...
              </div>
            ) : filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-gray-500 text-center">
                Không tìm thấy kết quả
              </div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => handleSelect(option)}
                    className={`
                      w-full px-3 py-2 text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center justify-between
                      ${isSelected ? 'bg-blue-50 text-blue-900' : 'text-gray-900'}
                    `}
                  >
                    <span>{option.label}</span>
                    {isSelected && (
                      <CheckIcon className="h-4 w-4 text-blue-600" />
                    )}
                  </button>
                );
              })
            )}

            {/* Load More Button */}
            {hasMore && (
              <div className="p-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loading}
                  className="w-full px-3 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Đang tải...' : 'Tải thêm'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelect;

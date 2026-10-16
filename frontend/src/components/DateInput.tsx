import React, { useRef } from 'react';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import { toApiDate } from '../utils/dateUtils';

interface DateInputProps {
  name: string;
  value: string; // DD/MM/YYYY
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  placeholder?: string;
}

const DateInput: React.FC<DateInputProps> = ({
  name,
  value,
  onChange,
  className = '',
  placeholder = 'DD/MM/YYYY',
}) => {
  const pickerRef = useRef<HTMLInputElement>(null);

  const pickerValue = toApiDate(value); // YYYY-MM-DD for native input

  const handlePickerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value; // YYYY-MM-DD
    if (!raw) return;
    const [y, m, d] = raw.split('-');
    const display = `${d}/${m}/${y}`;
    const synthetic = { target: { name, value: display } } as React.ChangeEvent<HTMLInputElement>;
    onChange(synthetic);
  };

  const openPicker = () => {
    try {
      pickerRef.current?.showPicker();
    } catch {
      pickerRef.current?.click();
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`${className} pr-10`}
      />
      <button
        type="button"
        onClick={openPicker}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 transition-colors"
        tabIndex={-1}
      >
        <CalendarDaysIcon className="h-4 w-4" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={pickerValue}
        onChange={handlePickerChange}
        className="absolute opacity-0 pointer-events-none w-0 h-0"
        tabIndex={-1}
      />
    </div>
  );
};

export default DateInput;

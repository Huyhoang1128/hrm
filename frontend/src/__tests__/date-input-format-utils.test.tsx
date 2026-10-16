import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import DateInput from '../components/DateInput';
import { formatNumber, formatVND, formatVNDShort } from '../utils/formatUtils';

afterEach(cleanup);

describe('formatUtils', () => {
  it('formats thousands with dots and keeps decimals', () => {
    expect(formatNumber(1000000)).toBe('1.000.000');
    expect(formatNumber(1234.5)).toBe('1.234,5');
    expect(formatNumber(-25000)).toBe('-25.000');
  });

  it('formats VND in full and short form', () => {
    expect(formatVND(1500000)).toBe('1.500.000 VNĐ');
    expect(formatVND(undefined as unknown as number)).toBe('0 VNĐ');
    expect(formatVNDShort(2_500_000_000)).toBe('2.50 tỷ');
    expect(formatVNDShort(1_500_000)).toBe('1.5 triệu');
    expect(formatVNDShort(900_000)).toBe('900.000 VNĐ');
  });
});

describe('DateInput', () => {
  it('passes typed text through and converts the picked date to DD/MM/YYYY', () => {
    const onChange = vi.fn();
    const { container } = render(<DateInput name="start_date" value="01/02/2026" onChange={onChange} />);
    const [text, picker] = Array.from(container.querySelectorAll('input'));
    expect(picker.getAttribute('type')).toBe('date');
    expect((picker as HTMLInputElement).value).toBe('2026-02-01');

    fireEvent.change(text, { target: { value: '15/03/2026' } });
    expect(onChange).toHaveBeenCalledTimes(1);

    fireEvent.change(picker, { target: { value: '2026-10-16' } });
    const event = onChange.mock.calls[1][0];
    expect(event.target).toEqual({ name: 'start_date', value: '16/10/2026' });
  });
});

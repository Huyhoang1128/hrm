import { describe, expect, it } from 'vitest';
import { buildContractWarnings } from '../utils/contractWarnings';

const TODAY = new Date(2026, 9, 15); // 15/10/2026

const base = {
  contract_type: 'ONE_YEAR',
  employment_status: 'ACTIVE',
  start_date: '01/03/2026',
  probation_end_date: '31/04/2026',
  official_start_date: '01/05/2026',
  contract_start_date: '01/05/2026',
  contract_end_date: '30/04/2027',
  end_date: '',
};

const texts = (f: any) => buildContractWarnings(f, TODAY).map((w) => `${w.level}:${w.text}`);

describe('buildContractWarnings', () => {
  it('hồ sơ hợp lệ thì không có cảnh báo', () => {
    expect(buildContractWarnings({ ...base, probation_end_date: '30/04/2026' }, TODAY)).toEqual([]);
  });

  it('HĐ thử việc đã quá hạn thử việc là lỗi', () => {
    const w = texts({ ...base, contract_type: 'PROBATION', probation_end_date: '30/04/2026' });
    expect(w.some((t) => t.startsWith('error:Loại hợp đồng vẫn là thử việc'))).toBe(true);
  });

  it('có ngày nghỉ mà trạng thái chưa đổi', () => {
    const w = texts({ ...base, probation_end_date: '30/04/2026', end_date: '01/10/2026' });
    expect(w.some((t) => t.includes('chưa phải "Đã nghỉ"'))).toBe(true);
  });

  it('đã nghỉ thì không cảnh báo HĐ hết hạn', () => {
    const w = texts({
      ...base, probation_end_date: '30/04/2026', employment_status: 'INACTIVE',
      end_date: '01/09/2026', contract_end_date: '31/08/2026',
    });
    expect(w).toEqual([]);
  });

  it('ngày bắt đầu HĐ trước ngày vào làm', () => {
    const w = texts({ ...base, probation_end_date: '30/04/2026', contract_start_date: '01/02/2026' });
    expect(w.some((t) => t.startsWith('error:Ngày bắt đầu hợp đồng'))).toBe(true);
  });
});

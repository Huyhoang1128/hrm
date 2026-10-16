import { describe, expect, it } from 'vitest';
import { isProbationContract } from '../constants/contractTypes';
import { buildContractWarnings } from '../utils/contractWarnings';

const TODAY = new Date(2026, 9, 15); // 15/10/2026

const base = {
  contract_type: 'SIX_MONTH',
  employment_status: 'ACTIVE',
  start_date: '01/03/2026',
  probation_end_date: '30/04/2026',
  official_start_date: '01/05/2026',
  contract_start_date: '01/05/2026',
  contract_end_date: '31/10/2026',
  end_date: '',
};

describe('loại hợp đồng mới', () => {
  it('nhận diện các mã thử việc', () => {
    expect(['PROBATION', 'PROBATION_1M', 'PROBATION_2M'].every(isProbationContract)).toBe(true);
    expect(isProbationContract('SIX_MONTH')).toBe(false);
    expect(isProbationContract(null)).toBe(false);
  });

  it('HĐ 6 tháng là hợp đồng chính thức', () => {
    expect(buildContractWarnings(base, TODAY).filter((w) => w.level === 'error')).toEqual([]);
  });

  it('thử việc 2 tháng đã quá hạn thử việc vẫn bị cảnh báo', () => {
    const w = buildContractWarnings({ ...base, contract_type: 'PROBATION_2M' }, TODAY);
    expect(w.some((x) => x.level === 'error' && x.text.startsWith('Loại hợp đồng vẫn là thử việc'))).toBe(true);
  });
});

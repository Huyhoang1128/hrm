/**
 * Test cases cho feat/bulk-contracts (HRM frontend)
 *
 * Chạy:
 *   npm run test:run -- src/__tests__/bulk-contracts.test.ts
 *
 * Nhóm:
 *   A. fmtDate            — format ngày YYYY-MM-DD → DD/MM/YYYY
 *   B. getDaysUntilExpiry — số ngày còn lại
 *   C. effectiveStatus    — SIGNED + hết hạn → EXPIRED
 *   D. getContractDisplayStatus — badge label + color
 *   E. hasActiveContract  — logic xác định hợp đồng hiệu lực
 *   F. applyBulkToSelected — bulk fill template/ngày vào selected rows
 *   G. noActiveContractDialog — hiện dialog khi có hợp đồng nhưng không còn hiệu lực
 *   H. filterStatuses     — lọc employee theo trạng thái hợp đồng
 *   I. multiPreviewItems  — chỉ map contracts có generated_file
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers copy từ BulkContracts.tsx / Profile.tsx
// ---------------------------------------------------------------------------

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

const getDaysUntilExpiry = (endDate: string | null | undefined): number | null => {
  if (!endDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(endDate);
  expiry.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

const effectiveStatus = (status: string, endDate: string | null | undefined): string => {
  if (status === 'SIGNED' && endDate) {
    const days = getDaysUntilExpiry(endDate);
    if (days !== null && days < 0) return 'EXPIRED';
  }
  return status;
};

interface MyContract {
  id: number;
  status: string;
  status_display: string;
  contract_type: string;
  end_date: string | null;
  start_date: string | null;
  template_name: string | null;
  company_unit_name: string | null;
  generated_file: string | null;
  created_at: string;
}

const getContractDisplayStatus = (contract: MyContract): { label: string; className: string } => {
  if (contract.status === 'SIGNED') {
    const days = getDaysUntilExpiry(contract.end_date);
    if (days !== null && days < 0)  return { label: 'Đã hết hạn', className: 'bg-red-100 text-red-700' };
    if (days !== null && days <= 5) return { label: `Sắp hết hạn (${days} ngày)`, className: 'bg-orange-100 text-orange-700' };
    return { label: 'Đang hiệu lực', className: 'bg-green-100 text-green-700' };
  }
  const map: Record<string, { label: string; className: string }> = {
    DRAFT:        { label: 'Nháp',     className: 'bg-gray-100 text-gray-600' },
    PENDING_SIGN: { label: 'Chờ ký',   className: 'bg-blue-100 text-blue-700' },
    EXPIRED:      { label: 'Đã hết hạn', className: 'bg-red-100 text-red-700' },
    CANCELLED:    { label: 'Đã huỷ',   className: 'bg-gray-100 text-gray-500' },
  };
  return map[contract.status] || { label: contract.status, className: 'bg-gray-100 text-gray-600' };
};

const LABOR_CONTRACT_TYPES = ['PROBATION', 'INTERN', 'COLLABORATOR', 'ONE_YEAR', 'TWO_YEAR', 'INDEFINITE', 'SERVICE'];

const hasActiveContract = (contracts: MyContract[] | null): boolean => {
  if (contracts === null) return false;
  return contracts.some((c) => {
    if (c.status !== 'SIGNED') return false;
    if (!LABOR_CONTRACT_TYPES.includes(c.contract_type)) return false;
    if (!c.end_date) return true;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(c.end_date); end.setHours(0, 0, 0, 0);
    return end.getTime() >= today.getTime();
  });
};

// RowState mirror
interface RowState {
  employeeId: number;
  selected: boolean;
  template: number | null;
  start_date: string;
  end_date: string;
  override: boolean;
}

const applyBulkToSelected = (
  rows: RowState[],
  bulk: { template: number | null; startDate: string; endDate: string; override: boolean }
): RowState[] =>
  rows.map((r) => {
    if (!r.selected) return r;
    return {
      ...r,
      ...(bulk.template   ? { template: bulk.template }     : {}),
      ...(bulk.startDate  ? { start_date: bulk.startDate }  : {}),
      ...(bulk.endDate    ? { end_date: bulk.endDate }       : {}),
      override: bulk.override,
    };
  });

// ---------------------------------------------------------------------------
// A. fmtDate
// ---------------------------------------------------------------------------

describe('fmtDate', () => {
  it('YYYY-MM-DD → DD/MM/YYYY', () => expect(fmtDate('2026-05-01')).toBe('01/05/2026'));
  it('null → empty string', () => expect(fmtDate(null)).toBe(''));
  it('undefined → empty string', () => expect(fmtDate(undefined)).toBe(''));
  it('ngày 1 chữ số được giữ nguyên', () => expect(fmtDate('2026-01-05')).toBe('05/01/2026'));
});

// ---------------------------------------------------------------------------
// B. getDaysUntilExpiry
// ---------------------------------------------------------------------------

describe('getDaysUntilExpiry', () => {
  it('null → null', () => expect(getDaysUntilExpiry(null)).toBeNull());
  it('undefined → null', () => expect(getDaysUntilExpiry(undefined)).toBeNull());

  it('ngày trong tương lai xa → dương', () => {
    const future = new Date(); future.setDate(future.getDate() + 30);
    const d = future.toISOString().split('T')[0];
    expect(getDaysUntilExpiry(d)!).toBeGreaterThan(0);
  });

  it('ngày hôm nay → 0', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(getDaysUntilExpiry(today)).toBe(0);
  });

  it('ngày quá khứ → âm', () => {
    const past = new Date(); past.setDate(past.getDate() - 3);
    const d = past.toISOString().split('T')[0];
    expect(getDaysUntilExpiry(d)!).toBeLessThan(0);
  });

  it('5 ngày tới → 5', () => {
    const d5 = new Date(); d5.setDate(d5.getDate() + 5);
    const d = d5.toISOString().split('T')[0];
    expect(getDaysUntilExpiry(d)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// C. effectiveStatus
// ---------------------------------------------------------------------------

describe('effectiveStatus', () => {
  it('SIGNED + end_date quá khứ → EXPIRED', () => {
    const past = new Date(); past.setDate(past.getDate() - 1);
    expect(effectiveStatus('SIGNED', past.toISOString().split('T')[0])).toBe('EXPIRED');
  });

  it('SIGNED + end_date tương lai → SIGNED', () => {
    const future = new Date(); future.setDate(future.getDate() + 10);
    expect(effectiveStatus('SIGNED', future.toISOString().split('T')[0])).toBe('SIGNED');
  });

  it('SIGNED + no end_date → SIGNED (vô thời hạn)', () => {
    expect(effectiveStatus('SIGNED', null)).toBe('SIGNED');
  });

  it('DRAFT không bị ảnh hưởng', () => {
    const past = new Date(); past.setDate(past.getDate() - 5);
    expect(effectiveStatus('DRAFT', past.toISOString().split('T')[0])).toBe('DRAFT');
  });

  it('CANCELLED không bị ảnh hưởng', () => {
    expect(effectiveStatus('CANCELLED', '2020-01-01')).toBe('CANCELLED');
  });

  it('PENDING_SIGN không bị ảnh hưởng', () => {
    expect(effectiveStatus('PENDING_SIGN', '2020-01-01')).toBe('PENDING_SIGN');
  });
});

// ---------------------------------------------------------------------------
// D. getContractDisplayStatus
// ---------------------------------------------------------------------------

const baseContract = (overrides: Partial<MyContract> = {}): MyContract => ({
  id: 1, status: 'SIGNED', status_display: 'Đã ký', contract_type: 'ONE_YEAR',
  end_date: null, start_date: null, template_name: null, company_unit_name: null,
  generated_file: null, created_at: '2026-01-01',
  ...overrides,
});

const futureDate = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};
const pastDate = (days: number) => {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
};

describe('getContractDisplayStatus', () => {
  it('SIGNED + end_date quá khứ → Đã hết hạn (đỏ)', () => {
    const r = getContractDisplayStatus(baseContract({ end_date: pastDate(1) }));
    expect(r.label).toBe('Đã hết hạn');
    expect(r.className).toContain('red');
  });

  it('SIGNED + 3 ngày nữa → Sắp hết hạn (cam)', () => {
    const r = getContractDisplayStatus(baseContract({ end_date: futureDate(3) }));
    expect(r.label).toContain('Sắp hết hạn');
    expect(r.label).toContain('3');
    expect(r.className).toContain('orange');
  });

  it('SIGNED + 5 ngày nữa → vẫn là Sắp hết hạn', () => {
    const r = getContractDisplayStatus(baseContract({ end_date: futureDate(5) }));
    expect(r.label).toContain('Sắp hết hạn');
  });

  it('SIGNED + 6 ngày nữa → Đang hiệu lực (xanh)', () => {
    const r = getContractDisplayStatus(baseContract({ end_date: futureDate(6) }));
    expect(r.label).toBe('Đang hiệu lực');
    expect(r.className).toContain('green');
  });

  it('SIGNED không có end_date → Đang hiệu lực', () => {
    const r = getContractDisplayStatus(baseContract({ end_date: null }));
    expect(r.label).toBe('Đang hiệu lực');
  });

  it('DRAFT → Nháp (xám)', () => {
    const r = getContractDisplayStatus(baseContract({ status: 'DRAFT' }));
    expect(r.label).toBe('Nháp');
  });

  it('PENDING_SIGN → Chờ ký (xanh dương)', () => {
    const r = getContractDisplayStatus(baseContract({ status: 'PENDING_SIGN' }));
    expect(r.label).toBe('Chờ ký');
    expect(r.className).toContain('blue');
  });

  it('CANCELLED → Đã huỷ (xám)', () => {
    const r = getContractDisplayStatus(baseContract({ status: 'CANCELLED' }));
    expect(r.label).toBe('Đã huỷ');
  });
});

// ---------------------------------------------------------------------------
// E. hasActiveContract
// ---------------------------------------------------------------------------

describe('hasActiveContract', () => {
  it('null (chưa fetch) → false', () => expect(hasActiveContract(null)).toBe(false));
  it('mảng rỗng → false', () => expect(hasActiveContract([])).toBe(false));

  it('SIGNED + labor type + end_date tương lai → true', () => {
    expect(hasActiveContract([baseContract({ end_date: futureDate(30), contract_type: 'ONE_YEAR' })])).toBe(true);
  });

  it('SIGNED + không có end_date + labor type → true (vô thời hạn)', () => {
    expect(hasActiveContract([baseContract({ end_date: null, contract_type: 'INDEFINITE' })])).toBe(true);
  });

  it('SIGNED + end_date quá khứ → false (đã hết hạn)', () => {
    expect(hasActiveContract([baseContract({ end_date: pastDate(1), contract_type: 'ONE_YEAR' })])).toBe(false);
  });

  it('DRAFT + labor type → false', () => {
    expect(hasActiveContract([baseContract({ status: 'DRAFT', contract_type: 'ONE_YEAR', end_date: futureDate(30) })])).toBe(false);
  });

  it('SIGNED + non-labor contract_type → false', () => {
    expect(hasActiveContract([baseContract({ status: 'SIGNED', contract_type: 'UNKNOWN_TYPE', end_date: futureDate(30) })])).toBe(false);
  });

  it('chỉ 1 hết hạn + 1 còn hạn → true (vẫn có active)', () => {
    expect(hasActiveContract([
      baseContract({ end_date: pastDate(5), contract_type: 'ONE_YEAR' }),
      baseContract({ id: 2, end_date: futureDate(10), contract_type: 'TWO_YEAR' }),
    ])).toBe(true);
  });

  it('tất cả đã hết hạn → false', () => {
    expect(hasActiveContract([
      baseContract({ end_date: pastDate(10), contract_type: 'ONE_YEAR' }),
      baseContract({ id: 2, end_date: pastDate(5), contract_type: 'TWO_YEAR' }),
    ])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. applyBulkToSelected
// ---------------------------------------------------------------------------

describe('applyBulkToSelected', () => {
  const rows: RowState[] = [
    { employeeId: 1, selected: true,  template: null, start_date: '', end_date: '', override: false },
    { employeeId: 2, selected: false, template: null, start_date: '', end_date: '', override: false },
    { employeeId: 3, selected: true,  template: 5,    start_date: '2026-01-01', end_date: '2026-12-31', override: false },
  ];

  it('chỉ áp dụng cho selected rows', () => {
    const result = applyBulkToSelected(rows, { template: 10, startDate: '2026-05-01', endDate: '2027-04-30', override: false });
    expect(result[0].template).toBe(10);   // selected → updated
    expect(result[1].template).toBeNull(); // not selected → unchanged
    expect(result[2].template).toBe(10);   // selected → updated
  });

  it('điền template + ngày vào selected', () => {
    const result = applyBulkToSelected(rows, { template: 7, startDate: '2026-06-01', endDate: '2027-05-31', override: true });
    expect(result[0].template).toBe(7);
    expect(result[0].start_date).toBe('2026-06-01');
    expect(result[0].end_date).toBe('2027-05-31');
    expect(result[0].override).toBe(true);
  });

  it('không có template trong bulk → giữ template cũ của row', () => {
    const result = applyBulkToSelected(rows, { template: null, startDate: '2026-06-01', endDate: '', override: false });
    expect(result[2].template).toBe(5); // giữ nguyên template cũ
  });

  it('override flag luôn được set dù false', () => {
    const result = applyBulkToSelected(rows, { template: null, startDate: '', endDate: '', override: false });
    expect(result[0].override).toBe(false);
    expect(result[2].override).toBe(false);
  });

  it('unselected row không thay đổi gì cả', () => {
    const result = applyBulkToSelected(rows, { template: 99, startDate: '2026-01-01', endDate: '2027-01-01', override: true });
    expect(result[1]).toEqual(rows[1]);
  });
});

// ---------------------------------------------------------------------------
// G. noActiveContractDialog — hiện khi có contracts nhưng không có active
// ---------------------------------------------------------------------------

describe('noActiveContractDialog logic', () => {
  const noDialog = (contracts: MyContract[] | null) => {
    // Logic: myContracts !== null && myContracts.length > 0 && !hasActiveContract
    if (contracts === null) return false;
    if (contracts.length === 0) return false;
    return !hasActiveContract(contracts);
  };

  it('null (chưa fetch) → không hiện dialog', () => expect(noDialog(null)).toBe(false));
  it('mảng rỗng → không hiện dialog', () => expect(noDialog([])).toBe(false));

  it('có contracts + còn active → không hiện dialog', () => {
    expect(noDialog([baseContract({ end_date: futureDate(10), contract_type: 'ONE_YEAR' })])).toBe(false);
  });

  it('có contracts + TẤT CẢ đã hết hạn → hiện dialog', () => {
    expect(noDialog([baseContract({ end_date: pastDate(1), contract_type: 'ONE_YEAR' })])).toBe(true);
  });

  it('có contracts + DRAFT → hiện dialog (DRAFT không phải active)', () => {
    expect(noDialog([baseContract({ status: 'DRAFT', contract_type: 'ONE_YEAR', end_date: futureDate(30) })])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H. filterStatuses — filter employee theo trạng thái hợp đồng hiệu lực
// ---------------------------------------------------------------------------

type FilterStatus = 'NO_CONTRACT' | 'DRAFT' | 'PENDING_SIGN' | 'SIGNED' | 'EXPIRED';

type ContractRow = {
  id: number;
  status: string;
  end_date: string | null;
};

const matchesFilterStatuses = (contracts: ContractRow[], filterStatuses: FilterStatus[]): boolean => {
  if (filterStatuses.length === 0) return true;
  return filterStatuses.some((f) => {
    if (f === 'NO_CONTRACT') return contracts.length === 0;
    return contracts.some((c) => effectiveStatus(c.status, c.end_date) === f);
  });
};

describe('filterStatuses (BulkContracts employee filter)', () => {
  const signed   = (end: string | null): ContractRow => ({ id: 1, status: 'SIGNED',       end_date: end });
  const draft    = (): ContractRow                   => ({ id: 2, status: 'DRAFT',        end_date: null });
  const pending  = (): ContractRow                   => ({ id: 3, status: 'PENDING_SIGN', end_date: null });

  it('không có filter → mọi employee đều match', () => {
    expect(matchesFilterStatuses([], [])).toBe(true);
    expect(matchesFilterStatuses([draft()], [])).toBe(true);
  });

  it('filter NO_CONTRACT → match khi không có contracts', () => {
    expect(matchesFilterStatuses([], ['NO_CONTRACT'])).toBe(true);
    expect(matchesFilterStatuses([draft()], ['NO_CONTRACT'])).toBe(false);
  });

  it('filter SIGNED → match khi có SIGNED còn hạn', () => {
    expect(matchesFilterStatuses([signed(futureDate(30))], ['SIGNED'])).toBe(true);
    expect(matchesFilterStatuses([signed(pastDate(1))],  ['SIGNED'])).toBe(false); // đã EXPIRED
  });

  it('filter EXPIRED → match khi SIGNED đã qua end_date', () => {
    expect(matchesFilterStatuses([signed(pastDate(1))], ['EXPIRED'])).toBe(true);
    expect(matchesFilterStatuses([signed(futureDate(5))], ['EXPIRED'])).toBe(false);
  });

  it('filter DRAFT', () => {
    expect(matchesFilterStatuses([draft()], ['DRAFT'])).toBe(true);
    expect(matchesFilterStatuses([pending()], ['DRAFT'])).toBe(false);
  });

  it('filter PENDING_SIGN', () => {
    expect(matchesFilterStatuses([pending()], ['PENDING_SIGN'])).toBe(true);
  });

  it('nhiều filter → OR logic', () => {
    expect(matchesFilterStatuses([draft()], ['DRAFT', 'SIGNED'])).toBe(true);
    expect(matchesFilterStatuses([pending()], ['DRAFT', 'SIGNED'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// I. multiPreviewItems — chỉ map contracts có generated_file
// ---------------------------------------------------------------------------

describe('multiPreviewItems filter', () => {
  type ContractPreviewItem = { id: number; employee_name: string; template_name: string };
  type CreatedContract = { id: number; employee_name: string; template_name: string | null; generated_file: string | null };

  const buildPreviewItems = (contracts: CreatedContract[]): ContractPreviewItem[] =>
    contracts
      .filter((c) => c.generated_file)
      .map((c) => ({ id: c.id, employee_name: c.employee_name, template_name: c.template_name || '' }));

  it('chỉ include contracts có generated_file', () => {
    const contracts: CreatedContract[] = [
      { id: 1, employee_name: 'A', template_name: 'T1', generated_file: 'file1.pdf' },
      { id: 2, employee_name: 'B', template_name: null,  generated_file: null },
      { id: 3, employee_name: 'C', template_name: 'T3', generated_file: 'file3.pdf' },
    ];
    const items = buildPreviewItems(contracts);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual([1, 3]);
  });

  it('template_name null → empty string', () => {
    const contracts: CreatedContract[] = [
      { id: 1, employee_name: 'A', template_name: null, generated_file: 'f.pdf' },
    ];
    expect(buildPreviewItems(contracts)[0].template_name).toBe('');
  });

  it('không có contracts nào có file → mảng rỗng', () => {
    expect(buildPreviewItems([{ id: 1, employee_name: 'A', template_name: 'T', generated_file: null }])).toHaveLength(0);
  });
});

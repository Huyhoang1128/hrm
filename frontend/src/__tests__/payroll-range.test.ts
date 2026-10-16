import { describe, expect, it } from 'vitest';
import {
  groupByLegalEntityAndMonth,
  listMonthsBetween,
  monthSheetName,
  NO_LEGAL_ENTITY_LABEL,
  parseYearMonth,
  sumRows,
} from '../utils/payrollRange';

describe('payrollRange', () => {
  it('parses and lists months across a year boundary', () => {
    expect(parseYearMonth('2026-07')).toEqual({ year: 2026, month: 7 });
    expect(parseYearMonth('2026-13')).toBeNull();
    expect(listMonthsBetween('2025-11', '2026-02').map(monthSheetName)).toEqual(['T11.2025', 'T12.2025', 'T01.2026', 'T02.2026']);
    expect(listMonthsBetween('2026-09', '2026-09')).toHaveLength(1);
    expect(listMonthsBetween('2026-09', '2026-08')).toEqual([]);
    expect(listMonthsBetween('', '2026-08')).toEqual([]);
  });

  it('sums numeric columns', () => {
    expect(sumRows([{ a: 1, b: '2' }, { a: 3 }], ['a', 'b'])).toEqual({ a: 4, b: 2 });
  });

  it('groups rows by legal entity then month', () => {
    const jul = { year: 2026, month: 7 };
    const aug = { year: 2026, month: 8 };
    const groups = groupByLegalEntityAndMonth([
      { period: jul, rows: [{ legalEntity: 'Pháp nhân B', row: 1 }, { legalEntity: 'Pháp nhân A', row: 2 }] },
      { period: aug, rows: [{ legalEntity: 'Pháp nhân A', row: 3 }, { legalEntity: ' ', row: 4 }, { legalEntity: 'Pháp nhân A', row: 5 }] },
    ]);
    expect(groups.map((g) => g.legalEntity)).toEqual([NO_LEGAL_ENTITY_LABEL, 'Pháp nhân A', 'Pháp nhân B']);
    const a = groups.find((g) => g.legalEntity === 'Pháp nhân A')!;
    expect(a.periods).toEqual([{ period: jul, rows: [2] }, { period: aug, rows: [3, 5] }]);
  });
});

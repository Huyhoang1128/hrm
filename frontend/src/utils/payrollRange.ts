/** Tiện ích cho xuất bảng lương tổng hợp nhiều tháng (không phụ thuộc giao diện). */

export const MAX_RANGE_EXPORT_MONTHS = 12;
export const NO_LEGAL_ENTITY_LABEL = '(Chưa có pháp nhân)';

export interface YearMonth {
  year: number;
  month: number;
}

/** "2026-07" → { year: 2026, month: 7 }; sai định dạng → null. */
export const parseYearMonth = (value: string): YearMonth | null => {
  const m = /^(\d{4})-(\d{2})$/.exec((value || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
};

/** Các tháng từ `from` tới `to` (gồm cả hai đầu); rỗng nếu sai định dạng hoặc from > to. */
export const listMonthsBetween = (from: string, to: string): YearMonth[] => {
  const start = parseYearMonth(from);
  const end = parseYearMonth(to);
  if (!start || !end) return [];
  const result: YearMonth[] = [];
  let { year, month } = start;
  while (year < end.year || (year === end.year && month <= end.month)) {
    result.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return result;
};

/** Tên sheet của 1 tháng, vd "T07.2026". */
export const monthSheetName = ({ year, month }: YearMonth) => `T${String(month).padStart(2, '0')}.${year}`;

/** Cộng các cột số của nhiều dòng. */
export const sumRows = (rows: Array<Record<string, unknown>>, keys: readonly string[]): Record<string, number> =>
  Object.fromEntries(keys.map((key) => [key, rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0)]));

export interface MonthRows<Row> {
  period: YearMonth;
  rows: Array<{ legalEntity: string; row: Row }>;
}

/**
 * Gom các dòng lương theo pháp nhân rồi theo tháng: pháp nhân xếp theo tên, tháng theo
 * thứ tự thời gian. Cùng một người có thể ở pháp nhân khác nhau giữa các tháng nên
 * không cộng gộp theo người.
 */
export const groupByLegalEntityAndMonth = <Row>(months: Array<MonthRows<Row>>) => {
  const byEntity = new Map<string, Array<{ period: YearMonth; rows: Row[] }>>();
  months.forEach(({ period, rows }) => {
    const byEntityThisMonth = new Map<string, Row[]>();
    rows.forEach(({ legalEntity, row }) => {
      const key = (legalEntity || '').trim() || NO_LEGAL_ENTITY_LABEL;
      byEntityThisMonth.set(key, [...(byEntityThisMonth.get(key) ?? []), row]);
    });
    byEntityThisMonth.forEach((entityRows, entity) => {
      byEntity.set(entity, [...(byEntity.get(entity) ?? []), { period, rows: entityRows }]);
    });
  });
  return [...byEntity.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'vi'))
    .map(([legalEntity, periods]) => ({ legalEntity, periods }));
};

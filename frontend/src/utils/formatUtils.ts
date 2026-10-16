/** Thêm dấu chấm phân cách hàng nghìn, không dùng locale, không làm tròn. Ví dụ: 1000000 → "1.000.000" */
export const formatNumber = (n: number): string => {
  const [intPart, decPart] = n.toString().split('.');
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decPart ? `${formatted},${decPart}` : formatted;
};

/** Hiển thị tiền VNĐ đầy đủ với dấu chấm phân cách, không làm tròn. Ví dụ: 1000000000 → "1.000.000.000 VNĐ" */
export const formatVND = (n: number): string =>
  `${formatNumber(Number(n || 0))} VNĐ`;

/** Hiển thị tiền VNĐ rút gọn theo đơn vị tỷ/triệu. Dùng ở chỗ không gian hẹp. */
export const formatVNDShort = (n: number): string => {
  const value = Number(n || 0);
  if (Math.abs(value) >= 1_000_000_000)
    return `${(value / 1_000_000_000).toFixed(2)} tỷ`;
  if (Math.abs(value) >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1)} triệu`;
  return formatVND(value);
};

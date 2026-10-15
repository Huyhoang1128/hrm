/**
 * Buổi của đơn trong ngày — src/utils/requestPeriod.ts
 *
 * Chạy:
 *   npm run test:run -- src/__tests__/request-period.test.ts
 *
 * Gửi đơn mới chỉ được ghi đè / bị chặn bởi đơn ĐỤNG BUỔI. Trước đây gửi Nghỉ
 * phép tháng huỷ sạch mọi đơn chờ duyệt trong ngày: NV02949 10/10/2026 tạo
 * KP-202610-A1B2C3D4 (nghỉ không phép sáng) rồi NPM-202610-E5F6A7B8 (nghỉ phép
 * chiều) — đơn sáng bị huỷ 0,4 giây trước khi đơn chiều được tạo.
 */
import { describe, it, expect } from 'vitest';
import { requestPeriod, shiftToPeriod, periodsOverlap } from '../utils/requestPeriod';

// Dạng dữ liệu thật của 2 đơn NV02949 ngày 10/10/2026.
const kpMorning = {
  event_type: 'unauthorized_absence',
  status: 'PENDING',
  data: {
    request_code: 'KP-202610-A1B2C3D4', registration_type: 'UNAUTHORIZED_ABSENCE',
    expected_status: 'HALF_DAY', half_day_period: 'MORNING', reason: 'Nghỉ không phép (sáng): đi học',
  },
};
const leaveAfternoon = {
  event_type: 'explanation',
  status: 'PENDING',
  data: {
    request_code: 'NPM-202610-E5F6A7B8', explanation_type: 'LEAVE',
    expected_status: 'HALF_DAY', half_day_period: 'AFTERNOON', reason: 'Nghỉ ca chiều',
  },
};

describe('requestPeriod', () => {
  it('đọc half_day_period khi có', () => {
    expect(requestPeriod(kpMorning)).toBe('MORNING');
    expect(requestPeriod(leaveAfternoon)).toBe('AFTERNOON');
  });

  it('nghỉ phép / nghỉ không phép không phải nửa ngày là cả ngày', () => {
    expect(requestPeriod({ event_type: 'unauthorized_absence', data: { expected_status: 'ABSENT', half_day_period: '' } })).toBe('FULL_DAY');
    expect(requestPeriod({ event_type: 'explanation', data: { explanation_type: 'LEAVE', expected_status: 'ABSENT' } })).toBe('FULL_DAY');
  });

  it('đơn nghỉ phép nửa ngày cũ (chưa có half_day_period) đoán theo lý do', () => {
    expect(requestPeriod({ event_type: 'explanation', data: { explanation_type: 'LEAVE', expected_status: 'HALF_DAY', reason: 'Nghỉ ca sáng' } })).toBe('MORNING');
    expect(requestPeriod({ event_type: 'explanation', data: { explanation_type: 'LEAVE', expected_status: 'HALF_DAY', reason: 'việc riêng' } })).toBeNull();
  });

  it('nghỉ không phép nửa ngày cũ không rõ buổi -> null', () => {
    expect(requestPeriod({ event_type: 'unauthorized_absence', data: { expected_status: 'HALF_DAY', reason: 'Nghỉ không phép (chiều)' } })).toBeNull();
  });

  it('làm online cũ đoán theo nhãn ca ở đầu lý do', () => {
    expect(requestPeriod({ event_type: 'online_work', data: { reason: 'Làm online chiều: sáng đi khám' } })).toBe('AFTERNOON');
    expect(requestPeriod({ event_type: 'online_work', data: { reason: 'Làm online cả ngày: họp' } })).toBe('FULL_DAY');
    expect(requestPeriod({ event_type: 'online_work', data: { reason: 'checkpage' } })).toBeNull();
  });

  it('đơn tăng ca / giải trình đi muộn không xác định buổi', () => {
    expect(requestPeriod({ event_type: 'overtime', data: { reason: 'Tăng ca sáng' } })).toBeNull();
    expect(requestPeriod({ event_type: 'explanation', data: { explanation_type: 'LATE', reason: 'kẹt xe sáng' } })).toBeNull();
  });
});

describe('periodsOverlap', () => {
  it('NV02949: gửi nghỉ phép chiều không đụng đơn nghỉ không phép sáng', () => {
    expect(periodsOverlap(shiftToPeriod('afternoon'), requestPeriod(kpMorning))).toBe(false);
  });

  it('cùng buổi hoặc có bên cả ngày thì đụng', () => {
    expect(periodsOverlap('MORNING', 'MORNING')).toBe(true);
    expect(periodsOverlap(shiftToPeriod('full_day'), requestPeriod(kpMorning))).toBe(true);
    expect(periodsOverlap('AFTERNOON', 'FULL_DAY')).toBe(true);
  });

  it('không rõ buổi của 1 bên thì coi như đụng (giữ cách cũ)', () => {
    expect(periodsOverlap(null, 'MORNING')).toBe(true);
    expect(periodsOverlap('AFTERNOON', null)).toBe(true);
  });
});

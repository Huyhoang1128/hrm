import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import PositionList from '../pages/PositionList';

const POSITIONS = [
  {
    id: 7, code: 'VT-QL', title: 'Trưởng nhóm', description: 'Quản lý nhóm', level: 2, parent_position: 3,
    is_management: true, department: [{ id: 1, name: 'Phòng A', code: 'PA' }],
    created_at: '2026-01-02T00:00:00Z', updated_at: '2026-02-03T00:00:00Z',
  },
  {
    id: 3, code: 'VT-GD', title: 'Giám đốc', level: 1, is_management: true, department: [],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  },
];

vi.mock('../utils/api', () => ({
  positionsAPI: { list: vi.fn(async () => ({ results: POSITIONS })), importFile: vi.fn() },
  departmentsAPI: { list: vi.fn(async () => ({ results: [] })) },
}));

const CurrentPath = () => <div data-testid="path">{useLocation().pathname}</div>;

afterEach(cleanup);

describe('PositionList — nút Xem', () => {
  it('mở dialog chi tiết thay vì chuyển sang route /dashboard/positions/:id (không tồn tại)', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard/positions']}>
        <Routes>
          <Route path="*" element={<><PositionList /><CurrentPath /></>} />
        </Routes>
      </MemoryRouter>,
    );
    const viewButtons = await screen.findAllByRole('button', { name: /Xem/ });
    fireEvent.click(viewButtons[0]);

    expect(screen.getByTestId('path').textContent).toBe('/dashboard/positions');
    const dialog = within(screen.getByRole('heading', { name: 'Trưởng nhóm' }).closest('div.fixed') as HTMLElement);
    expect(dialog.getByText('Cấp 2')).toBeTruthy();
    expect(dialog.getByText('Giám đốc (VT-GD)')).toBeTruthy();   // vị trí cha tra từ danh sách
    expect(dialog.getByText('Phòng A')).toBeTruthy();

    fireEvent.click(dialog.getByRole('button', { name: /Chỉnh sửa/ }));
    expect(screen.getByTestId('path').textContent).toBe('/dashboard/positions/7/edit');
  });
});

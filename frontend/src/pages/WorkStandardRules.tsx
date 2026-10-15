import React, { useState } from 'react';
import { CalendarDaysIcon, AdjustmentsHorizontalIcon, ClockIcon } from '@heroicons/react/24/outline';
import HolidayManagement from './HolidayManagement';
import ShiftConfiguration from './ShiftConfiguration';

type TabKey = 'holidays' | 'shift_configuration' | 'department_rules';

const WorkStandardRules: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('holidays');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Quản lý công chuẩn</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cấu hình ngày lễ, ca làm và các quy tắc công chuẩn áp dụng theo cá nhân/vị trí/phòng ban.
        </p>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab('holidays')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'holidays'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <CalendarDaysIcon className="h-4 w-4" /> Ngày lễ
          </span>
        </button>
        <button
          onClick={() => setTab('shift_configuration')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'shift_configuration'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <ClockIcon className="h-4 w-4" /> Cấu hình ca làm
          </span>
        </button>
        <button
          onClick={() => setTab('department_rules')}
          className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
            tab === 'department_rules'
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <AdjustmentsHorizontalIcon className="h-4 w-4" /> Giới hạn công chuẩn theo phòng ban
          </span>
        </button>
      </div>

      {tab === 'holidays' && <HolidayManagement />}

      {tab === 'shift_configuration' && <ShiftConfiguration />}

      {tab === 'department_rules' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
          <AdjustmentsHorizontalIcon className="mx-auto h-10 w-10 text-amber-500 mb-3" />
          <p className="text-sm font-semibold text-gray-700">Đang xây dựng</p>
          <p className="text-xs text-gray-400 mt-1 max-w-xl mx-auto">
            Chức năng đặt riêng công chuẩn cho 1 phòng ban/team (vd: công chuẩn Thứ 7 tuần 2/4 của khối
            văn phòng giới hạn 0.5 công, Chủ nhật khối backoffice giới hạn 0 công, hoặc đặt lại 1 công cho
            riêng 1 team cụ thể) cần thêm thời gian tìm hiểu kỹ engine tính công hiện có trước khi triển khai
            an toàn — sẽ theo đúng mô hình gán theo Cá nhân/Vị trí/Phòng ban như tab "Cấu hình ca làm" bên
            cạnh, có trong bản cập nhật tiếp theo.
          </p>
        </div>
      )}
    </div>
  );
};

export default WorkStandardRules;

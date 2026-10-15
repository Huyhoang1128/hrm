import React, { useState, useEffect } from 'react';
import {
  CalendarDaysIcon,
  PlusIcon,
  TrashIcon,
  PencilIcon,
  ExclamationCircleIcon,
  Bars3Icon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { holidayService, HolidayConfig } from '../services/holiday.service';
import FinalizationLockBanner from '../components/FinalizationLockBanner';

const HolidayManagement: React.FC = () => {
  const [holidays, setHolidays] = useState<HolidayConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [showForm, setShowForm] = useState(false);
  const [selectedHoliday, setSelectedHoliday] = useState<HolidayConfig | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    holiday_date: string;
    holiday_type: 'PUBLIC_HOLIDAY' | 'COMPANY_HOLIDAY' | 'SPECIAL_EVENT' | 'OTHER';
    is_recurring: boolean;
    is_working_day: boolean;
    allow_voluntary_work: boolean;
    overtime_multiplier: number;
    apply_to_all: boolean;
    notes: string;
  }>({
    name: '',
    description: '',
    holiday_date: '',
    holiday_type: 'PUBLIC_HOLIDAY',
    is_recurring: false,
    is_working_day: false,
    allow_voluntary_work: true,
    overtime_multiplier: 3.0,
    apply_to_all: true,
    notes: '',
  });
  const [calendarDays, setCalendarDays] = useState<number[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // ──────────────────────────────────────────────────────────────
  // Load holidays
  // ──────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchHolidays();
  }, [year, month]);

  const fetchHolidays = async () => {
    try {
      setLoading(true);
      const data = await holidayService.getHolidaysByMonth(year, month);
      setHolidays(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      console.error('Lỗi tải danh sách ngày lễ:', err);
      setError('Không thể tải danh sách ngày lễ');
      setHolidays([]);
    } finally {
      setLoading(false);
    }
  };

  // ──────────────────────────────────────────────────────────────
  // Calendar calculation
  // ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const daysArray =[];

    // Pad days from previous month
    const startingDayOfWeek = firstDay.getDay();
    for (let i = startingDayOfWeek; i > 0; i--) {
      daysArray.push(-(new Date(year, month - 1, -i + 1).getDate()));
    }

    // Days of current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
      daysArray.push(i);
    }

    // Pad days from next month
    const remainingDays = 42 - daysArray.length;
    for (let i = 1; i <= remainingDays; i++) {
      daysArray.push(-(i + 1000));
    }

    setCalendarDays(daysArray);
  }, [year, month]);

  // ──────────────────────────────────────────────────────────────
  // Form handlers
  // ──────────────────────────────────────────────────────────────

  const resetForm = () => {
    setSelectedHoliday(null);
    setFormData({
      name: '',
      description: '',
      holiday_date: '',
      holiday_type: 'PUBLIC_HOLIDAY',
      is_recurring: false,
      is_working_day: false,
      allow_voluntary_work: true,
      overtime_multiplier: 3.0,
      apply_to_all: true,
      notes: '',
    });
    setSelectedDate(null);
  };

  const openForm = (holiday?: HolidayConfig) => {
    if (holiday) {
      setSelectedHoliday(holiday);
      setFormData({
        name: holiday.name,
        description: holiday.description || '',
        holiday_date: holiday.holiday_date,
        holiday_type: holiday.holiday_type as 'PUBLIC_HOLIDAY' | 'COMPANY_HOLIDAY' | 'SPECIAL_EVENT' | 'OTHER',
        is_recurring: holiday.is_recurring,
        is_working_day: holiday.is_working_day,
        allow_voluntary_work: holiday.allow_voluntary_work,
        overtime_multiplier: holiday.overtime_multiplier,
        apply_to_all: holiday.apply_to_all,
        notes: holiday.notes || '',
      });
      setSelectedDate(holiday.holiday_date);
    } else {
      resetForm();
    }
    setShowForm(true);
  };

  const handleDateClick = (day: number) => {
    if (day > 0) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      setSelectedDate(date);
      setFormData({ ...formData, holiday_date: date });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.holiday_date) {
      setError('Vui lòng chọn ngày lễ');
      return;
    }
    if (!formData.name.trim()) {
      setError('Vui lòng nhập tên ngày lễ');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      if (selectedHoliday) {
        await holidayService.update(selectedHoliday.id, formData);
        setSuccess('Cập nhật ngày lễ thành công');
      } else {
        await holidayService.create(formData);
        setSuccess('Thêm ngày lễ thành công');
      }

      setShowForm(false);
      resetForm();
      await fetchHolidays();
    } catch (err: any) {
      console.error('Lỗi khi lưu ngày lễ:', err);
      setError(err.response?.data?.detail || 'Có lỗi xảy ra');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (holiday: HolidayConfig) => {
    if (!window.confirm(`Xác nhận xóa ngày lễ "${holiday.name}"?`)) return;

    try {
      setSubmitting(true);
      await holidayService.delete(holiday.id);
      setSuccess('Xóa ngày lễ thành công');
      await fetchHolidays();
    } catch (err: any) {
      console.error('Lỗi xóa ngày lễ:', err);
      setError('Không thể xóa ngày lễ');
    } finally {
      setSubmitting(false);
    }
  };

  // ──────────────────────────────────────────────────────────────
  // Format helpers
  // ──────────────────────────────────────────────────────────────

  const getHolidayTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      PUBLIC_HOLIDAY: 'Ngày lễ quốc gia',
      COMPANY_HOLIDAY: 'Ngày lễ công ty',
      SPECIAL_EVENT: 'Sự kiện đặc biệt',
      OTHER: 'Khác',
    };
    return labels[type] || type;
  };

  const getHolidayTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      PUBLIC_HOLIDAY: 'bg-red-50 text-red-700 border-red-100',
      COMPANY_HOLIDAY: 'bg-blue-50 text-blue-700 border-blue-100',
      SPECIAL_EVENT: 'bg-purple-50 text-purple-700 border-purple-100',
      OTHER: 'bg-gray-50 text-gray-700 border-gray-100',
    };
    return colors[type] || 'bg-gray-50 text-gray-700 border-gray-100';
  };

  const isHolidayOnDay = (day: number): HolidayConfig | null => {
    if (day <= 0 || !Array.isArray(holidays)) return null;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return (holidays.find((h) => h?.holiday_date === dateStr) as HolidayConfig) || null;
  };

  const monthNames = [
    'Tháng 1',
    'Tháng 2',
    'Tháng 3',
    'Tháng 4',
    'Tháng 5',
    'Tháng 6',
    'Tháng 7',
    'Tháng 8',
    'Tháng 9',
    'Tháng 10',
    'Tháng 11',
    'Tháng 12',
  ];

  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  // ──────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <FinalizationLockBanner year={year} month={month} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <CalendarDaysIcon className="w-8 h-8 text-primary-600" />
              Quản lý ngày nghỉ lễ
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Cấu hình ngày nghỉ lễ cho toàn bộ công ty
            </p>
          </div>
          <button
            onClick={() => openForm()}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
          >
            <PlusIcon className="w-5 h-5" />
            Thêm ngày lễ
          </button>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-lg flex items-start gap-3">
            <ExclamationCircleIcon className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-900">Lỗi</h3>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}
        {success && (
          <div className="mb-4 p-4 bg-emerald-50 border border-emerald-100 rounded-lg">
            <p className="text-emerald-700 font-medium">{success}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Calendar */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-100">
              {/* Calendar header */}
              <div className="p-6 border-b border-gray-100">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
                  <h2 className="text-xl font-bold text-gray-800">
                    {monthNames[month - 1]} {year}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const prev = new Date(year, month - 2);
                        setYear(prev.getFullYear());
                        setMonth(prev.getMonth() + 1);
                      }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      ←
                    </button>
                    <button
                      onClick={() => {
                        const today = new Date();
                        setYear(today.getFullYear());
                        setMonth(today.getMonth() + 1);
                      }}
                      className="px-3 py-1 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      Hôm nay
                    </button>
                    <button
                      onClick={() => {
                        const next = new Date(year, month);
                        setYear(next.getFullYear());
                        setMonth(next.getMonth() + 1);
                      }}
                      className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      →
                    </button>
                  </div>
                </div>

                {/* Calendar grid */}
                <div className="space-y-4">
                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-1">
                    {dayNames.map((day) => (
                      <div
                        key={day}
                        className="h-10 flex items-center justify-center font-bold text-gray-600 text-sm"
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Calendar days */}
                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.map((day, idx) => {
                      const holiday = day > 0 ? isHolidayOnDay(day) : null;
                      const isToday =
                        day > 0 &&
                        new Date().getFullYear() === year &&
                        new Date().getMonth() + 1 === month &&
                        new Date().getDate() === day;
                      const isSelected = selectedDate === `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

                      return (
                        <button
                          key={idx}
                          onClick={() => day > 0 && handleDateClick(day)}
                          className={`h-20 rounded-lg border-2 flex flex-col items-center justify-center text-sm font-medium transition-all ${
                            day <= 0
                              ? 'bg-gray-50 border-transparent text-gray-300'
                              : holiday
                              ? 'bg-red-50 border-red-300 text-red-600 hover:bg-red-100'
                              : isSelected
                              ? 'bg-primary-50 border-primary-300 text-primary-700'
                              : isToday
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                              : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {day > 0 && (
                            <>
                              <span>{day}</span>
                              {holiday && <span className="text-xs">🎉</span>}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-50 border border-red-300 rounded"></div>
                  <span className="text-gray-600">Có ngày lễ</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-primary-50 border border-primary-300 rounded"></div>
                  <span className="text-gray-600">Chọn</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-emerald-50 border border-emerald-300 rounded"></div>
                  <span className="text-gray-600">Hôm nay</span>
                </div>
              </div>
            </div>
          </div>

          {/* Holidays list for this month */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 sticky top-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">
                Ngày lễ
              </h3>

              {loading ? (
                <div className="text-center py-6 text-gray-500">
                  <div className="inline-block animate-spin">⚙️</div>
                  <p>Đang tải...</p>
                </div>
              ) : holidays.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <CalendarDaysIcon className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                  <p>Không có ngày lễ</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {holidays.map((holiday) => (
                    <div
                      key={holiday.id}
                      className="p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-800 text-sm break-words">
                            {holiday.name}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(holiday.holiday_date).toLocaleDateString('vi-VN')}
                          </p>
                          <span
                            className={`inline-block mt-2 px-2 py-0.5 rounded-full text-xs font-semibold border ${getHolidayTypeColor(
                              holiday.holiday_type
                            )}`}
                          >
                            {getHolidayTypeLabel(holiday.holiday_type)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => openForm(holiday)}
                            className="p-1.5 hover:bg-blue-50 text-blue-600 rounded transition-colors"
                            title="Sửa"
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(holiday)}
                            disabled={submitting}
                            className="p-1.5 hover:bg-red-50 text-red-600 rounded transition-colors disabled:opacity-50"
                            title="Xóa"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            {/* Modal header */}
            <div className="sticky top-0 px-6 py-4 border-b border-gray-100 bg-white flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">
                {selectedHoliday ? 'Sửa ngày lễ' : 'Thêm ngày lễ'}
              </h2>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <XMarkIcon className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* Ngày lễ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ngày lễ *
                </label>
                <input
                  type="date"
                  value={formData.holiday_date}
                  onChange={(e) =>
                    setFormData({ ...formData, holiday_date: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Tên ngày lễ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tên ngày lễ *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="VD: Tết Nguyên Đán"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Loại ngày lễ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Loại ngày lễ
                </label>
                <select
                  value={formData.holiday_type}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      holiday_type: e.target.value as any,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  <option value="PUBLIC_HOLIDAY">Ngày lễ quốc gia</option>
                  <option value="COMPANY_HOLIDAY">Ngày lễ công ty</option>
                  <option value="SPECIAL_EVENT">Sự kiện đặc biệt</option>
                  <option value="OTHER">Khác</option>
                </select>
              </div>

              {/* Mô tả */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Mô tả
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Nhập mô tả ngày lễ này"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Options */}
              <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_recurring}
                    onChange={(e) =>
                      setFormData({ ...formData, is_recurring: e.target.checked })
                    }
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Lặp lại hàng năm</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_working_day}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        is_working_day: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Là ngày làm việc</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.allow_voluntary_work}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        allow_voluntary_work: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Cho phép làm việc tự nguyện</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.apply_to_all}
                    onChange={(e) =>
                      setFormData({ ...formData, apply_to_all: e.target.checked })
                    }
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">Áp dụng cho tất cả</span>
                </label>
              </div>

              {/* Hệ số làm thêm */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Hệ số làm thêm
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.overtime_multiplier}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      overtime_multiplier: parseFloat(e.target.value) || 1,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Ghi chú */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ghi chú
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) =>
                    setFormData({ ...formData, notes: e.target.value })
                  }
                  placeholder="Nhập ghi chú"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {submitting
                    ? 'Đang xử lý...'
                    : selectedHoliday
                    ? 'Cập nhật'
                    : 'Thêm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default HolidayManagement;

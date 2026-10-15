import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDaysIcon, ClockIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import { MeetingRoom, MeetingRoomBooking, meetingRoomService } from '../services/meetingRoom.service';

const pad = (value: number) => String(value).padStart(2, '0');
const WEEK_DAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTH_NAMES = [
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
const TIMELINE_HOUR_HEIGHT = 74;

const toDateInput = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const toDateTimeLocal = (date: Date) => {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return `${copy.getFullYear()}-${pad(copy.getMonth() + 1)}-${pad(copy.getDate())}T${pad(copy.getHours())}:${pad(copy.getMinutes())}`;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const getDateKeyFromIso = (iso: string) => {
  const date = new Date(iso);
  return toDateInput(date);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const MeetingRoomBookingPage: React.FC = () => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const today = useMemo(() => new Date(), []);
  const [selectedDate, setSelectedDate] = useState<string>(toDateInput(today));
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date(today.getFullYear(), today.getMonth(), 1));
  const [monthlyBookings, setMonthlyBookings] = useState<MeetingRoomBooking[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showBookingModal, setShowBookingModal] = useState<boolean>(false);
  const [selectedRoomView, setSelectedRoomView] = useState<string>('ALL');
  const [hoverMinutesOffset, setHoverMinutesOffset] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [minBookingMinutes, setMinBookingMinutes] = useState<number>(30);
  const [startHour, setStartHour] = useState<number>(8);
  const [endHour, setEndHour] = useState<number>(22);

  const [form, setForm] = useState({
    room: '',
    title: '',
    note: '',
    start_time: '',
    end_time: '',
  });

  const activeRoom = useMemo(
    () => rooms.find((room) => String(room.id) === String(form.room)),
    [rooms, form.room]
  );

  const monthStart = useMemo(() => new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1), [calendarMonth]);
  const monthEnd = useMemo(() => new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0), [calendarMonth]);

  const filteredMonthlyBookings = useMemo(() => {
    if (selectedRoomView === 'ALL') return monthlyBookings;
    return monthlyBookings.filter((booking) => String(booking.room) === String(selectedRoomView));
  }, [monthlyBookings, selectedRoomView]);

  const sortedBookings = useMemo(() => {
    return filteredMonthlyBookings
      .filter((booking) => getDateKeyFromIso(booking.start_time) === selectedDate)
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  }, [filteredMonthlyBookings, selectedDate]);

  const bookingsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    filteredMonthlyBookings.forEach((booking) => {
      const key = getDateKeyFromIso(booking.start_time);
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [filteredMonthlyBookings]);

  const calendarCells = useMemo(() => {
    const firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7;

    const cells: Array<{ date: Date; inCurrentMonth: boolean; key: string }> = [];

    for (let i = startOffset; i > 0; i -= 1) {
      const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1 - i);
      cells.push({ date, inCurrentMonth: false, key: toDateInput(date) });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
      cells.push({ date, inCurrentMonth: true, key: toDateInput(date) });
    }

    while (cells.length < 42) {
      const nextDay = cells.length - (startOffset + daysInMonth) + 1;
      const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, nextDay);
      cells.push({ date, inCurrentMonth: false, key: toDateInput(date) });
    }

    return cells;
  }, [calendarMonth]);

  const hourlySlots = useMemo(() => {
    const slots: string[] = [];
    for (let hour = startHour; hour <= endHour; hour += 1) {
      slots.push(`${pad(hour)}:00`);
    }
    return slots;
  }, [startHour, endHour]);

  const positionedBookings = useMemo(() => {
    const baseMinutes = startHour * 60;
    const enriched = sortedBookings.map((booking) => {
      const start = new Date(booking.start_time);
      const end = new Date(booking.end_time);
      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const endMinutes = end.getHours() * 60 + end.getMinutes();
      return {
        ...booking,
        startMinutes,
        endMinutes,
      };
    });

    const clusters: Array<{ bookings: typeof enriched; end: number }> = [];
    enriched.forEach((booking) => {
      const latest = clusters[clusters.length - 1];
      if (!latest || booking.startMinutes >= latest.end) {
        clusters.push({ bookings: [booking], end: booking.endMinutes });
      } else {
        latest.bookings.push(booking);
        latest.end = Math.max(latest.end, booking.endMinutes);
      }
    });

    const output: Array<
      (typeof enriched)[number] & { top: number; height: number; lane: number; laneCount: number }
    > = [];

    clusters.forEach((cluster) => {
      const laneEnds: number[] = [];
      const assigned: Array<(typeof enriched)[number] & { lane: number }> = [];

      cluster.bookings.forEach((booking) => {
        let lane = laneEnds.findIndex((end) => end <= booking.startMinutes);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(booking.endMinutes);
        } else {
          laneEnds[lane] = booking.endMinutes;
        }
        assigned.push({ ...booking, lane });
      });

      const laneCount = Math.max(1, laneEnds.length);
      assigned.forEach((booking) => {
        const top = ((booking.startMinutes - baseMinutes) / 60) * TIMELINE_HOUR_HEIGHT + 4;
        const duration = Math.max(booking.endMinutes - booking.startMinutes, minBookingMinutes);
        const height = Math.max((duration / 60) * TIMELINE_HOUR_HEIGHT - 8, 32);

        output.push({
          ...booking,
          top,
          height,
          lane: booking.lane,
          laneCount,
        });
      });
    });

    return output;
  }, [sortedBookings, startHour, minBookingMinutes]);

  const selectedDateLabel = useMemo(() => {
    const date = new Date(`${selectedDate}T00:00:00`);
    const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][date.getDay()];
    return `${weekday} ${date.getDate()}/${date.getMonth() + 1}`;
  }, [selectedDate]);

  const currentUserId = Number((user as any)?.id || 0);
  const isAdmin = !!((user as any)?.is_superuser || (user as any)?.is_supperuser || user?.role?.toUpperCase() === 'ADMIN');
  const isHR = !!((user as any)?.employee_profile?.is_hr || (user as any)?.hrm_user?.is_hr || user?.role?.toUpperCase() === 'HR');

  const canDelete = (booking: MeetingRoomBooking) => {
    if (isAdmin || isHR) return true;
    if (booking.booked_by_user_id && booking.booked_by_user_id === currentUserId) return true;
    return false;
  };

  const targetRoomIdForBooking = useMemo(() => {
    if (selectedRoomView !== 'ALL') return Number(selectedRoomView);
    if (form.room) return Number(form.room);
    return null;
  }, [selectedRoomView, form.room]);

  const hasConflictInRoom = (roomId: number | null, start: Date, end: Date) => {
    if (!roomId) return false;
    return monthlyBookings.some((booking) => {
      if (Number(booking.room) !== Number(roomId)) return false;
      const bookingStart = new Date(booking.start_time);
      const bookingEnd = new Date(booking.end_time);
      return bookingStart < end && bookingEnd > start;
    });
  };

  const openBookingModalWithTime = (start: Date, end: Date) => {
    const roomId = targetRoomIdForBooking;
    if (!roomId) {
      setError('Vui lòng chọn phòng họp trước khi đặt lịch');
      return;
    }

    if (hasConflictInRoom(roomId, start, end)) {
      setError('Khung giờ này đã có người đặt. Vui lòng chọn giờ khác.');
      return;
    }

    setError('');
    setForm((prev) => ({
      ...prev,
      room: String(roomId),
      start_time: toDateTimeLocal(start),
      end_time: toDateTimeLocal(end),
    }));
    setShowBookingModal(true);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [roomsData, settingData, bookingsData] = await Promise.all([
        meetingRoomService.getRooms(false),
        meetingRoomService.getSetting(),
        meetingRoomService.getBookings({
          start_date: toDateInput(monthStart),
          end_date: toDateInput(monthEnd),
        }),
      ]);
      setRooms(roomsData);
      setMinBookingMinutes(settingData.min_booking_minutes);
      setStartHour(settingData.workday_start_hour);
      setEndHour(settingData.workday_end_hour);
      setMonthlyBookings(bookingsData);

      if (!form.room && roomsData.length > 0) {
        setForm((prev) => ({ ...prev, room: String(roomsData[0].id) }));
      }

    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không thể tải dữ liệu phòng họp');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [calendarMonth]);

  useEffect(() => {
    const defaultStart = new Date(`${selectedDate}T${pad(startHour)}:00:00`);
    const defaultEnd = new Date(defaultStart.getTime() + minBookingMinutes * 60000);
    setForm((prev) => ({
      ...prev,
      start_time: toDateTimeLocal(defaultStart),
      end_time: toDateTimeLocal(defaultEnd),
    }));
  }, [selectedDate, startHour, minBookingMinutes]);

  useEffect(() => {
    if (selectedRoomView !== 'ALL') {
      setForm((prev) => ({ ...prev, room: selectedRoomView }));
    }
  }, [selectedRoomView]);

  const handleDateChange = (value: string) => {
    setSelectedDate(value);
    const picked = new Date(value);
    setCalendarMonth(new Date(picked.getFullYear(), picked.getMonth(), 1));
    setMessage('');
  };

  const goPrevMonth = () => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const goNextMonth = () => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleChooseCalendarDate = (date: Date) => {
    setSelectedDate(toDateInput(date));
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setMessage('');
  };

  const handleQuickPickSlot = (slot: string) => {
    const [hour] = slot.split(':').map(Number);
    const start = new Date(`${selectedDate}T${pad(hour)}:00:00`);
    const end = new Date(start.getTime() + minBookingMinutes * 60000);
    openBookingModalWithTime(start, end);
  };

  const handleTimelineClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = clamp(event.clientY - rect.top, 0, rect.height);
    const hoursFromStart = offsetY / TIMELINE_HOUR_HEIGHT;
    const rawMinutes = Math.floor(hoursFromStart * 60);
    const snappedMinutes = Math.floor(rawMinutes / 15) * 15;

    const baseMinutes = startHour * 60;
    const maxStartMinutes = Math.max(baseMinutes, endHour * 60 - minBookingMinutes);
    const selectedMinutes = clamp(baseMinutes + snappedMinutes, baseMinutes, maxStartMinutes);

    const startHourPart = Math.floor(selectedMinutes / 60);
    const startMinutePart = selectedMinutes % 60;
    const start = new Date(`${selectedDate}T${pad(startHourPart)}:${pad(startMinutePart)}:00`);
    const end = new Date(start.getTime() + minBookingMinutes * 60000);
    openBookingModalWithTime(start, end);
  };

  const handleTimelineMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const offsetY = clamp(event.clientY - rect.top, 0, rect.height);
    const hoursFromStart = offsetY / TIMELINE_HOUR_HEIGHT;
    const rawMinutes = Math.floor(hoursFromStart * 60);
    const snappedMinutes = Math.floor(rawMinutes / 15) * 15;
    setHoverMinutesOffset(snappedMinutes);
  };

  const handleTimelineMouseLeave = () => {
    setHoverMinutesOffset(null);
  };

  const hoverIndicator = useMemo(() => {
    if (hoverMinutesOffset === null) return null;
    const baseMinutes = startHour * 60;
    const maxStartMinutes = Math.max(baseMinutes, endHour * 60 - minBookingMinutes);
    const selectedMinutes = clamp(baseMinutes + hoverMinutesOffset, baseMinutes, maxStartMinutes);
    const hour = Math.floor(selectedMinutes / 60);
    const minute = selectedMinutes % 60;
    const top = ((selectedMinutes - baseMinutes) / 60) * TIMELINE_HOUR_HEIGHT;
    const start = new Date(`${selectedDate}T${pad(hour)}:${pad(minute)}:00`);
    const end = new Date(start.getTime() + minBookingMinutes * 60000);
    const occupied = hasConflictInRoom(targetRoomIdForBooking, start, end);
    return {
      label: `${pad(hour)}:${pad(minute)}`,
      top,
      height: Math.max((minBookingMinutes / 60) * TIMELINE_HOUR_HEIGHT, 24),
      occupied,
    };
  }, [
    hoverMinutesOffset,
    startHour,
    endHour,
    minBookingMinutes,
    selectedDate,
    targetRoomIdForBooking,
    monthlyBookings,
  ]);

  const validateDuration = () => {
    if (!form.start_time || !form.end_time) return false;
    const start = new Date(form.start_time);
    const end = new Date(form.end_time);
    const minutes = (end.getTime() - start.getTime()) / 60000;
    return minutes >= minBookingMinutes;
  };

  const handleCreateBooking = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!form.room || !form.start_time || !form.end_time) {
      setError('Vui lòng chọn phòng và thời gian đầy đủ');
      return;
    }

    if (!validateDuration()) {
      setError(`Mỗi lần đặt tối thiểu ${minBookingMinutes} phút`);
      return;
    }

    try {
      setSubmitting(true);
      await meetingRoomService.createBooking({
        room: Number(form.room),
        title: form.title,
        note: form.note,
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
      });
      setMessage('Đặt phòng thành công');
      setForm((prev) => ({ ...prev, title: '', note: '' }));
      setShowBookingModal(false);
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Đặt phòng thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBooking = async (booking: MeetingRoomBooking) => {
    if (!canDelete(booking)) {
      setError('Bạn không có quyền xóa lịch này');
      return;
    }
    if (!window.confirm('Bạn có chắc muốn xóa lịch đặt phòng này?')) return;

    try {
      await meetingRoomService.deleteBooking(booking.id);
      setMessage('Đã xóa lịch đặt phòng');
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không thể xóa lịch');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <CalendarDaysIcon className="h-7 w-7 text-primary-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Đặt lịch phòng họp</h1>
          <p className="text-sm text-gray-500">Mọi nhân viên đều có thể đặt phòng họp theo ngày và khung giờ.</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Today</p>
              <h2 className="text-2xl font-bold text-gray-900">{selectedDateLabel}</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedRoomView}
                onChange={(e) => setSelectedRoomView(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700"
                title="Chọn phòng để xem lịch đã đăng ký"
              >
                <option value="ALL">Tất cả phòng họp</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ({room.code})
                  </option>
                ))}
              </select>
              <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
                {sortedBookings.length} lịch họp
              </span>
            </div>
          </div>

          <div className="grid grid-cols-[72px_1fr] gap-3">
            <div className="space-y-0">
              {hourlySlots.map((slot) => (
                <div key={slot} className="h-[74px] pt-1 text-sm text-gray-500">
                  {slot}
                </div>
              ))}
            </div>

            <div
              className="relative rounded-xl border border-gray-100 bg-gray-50"
              style={{ height: `${hourlySlots.length * TIMELINE_HOUR_HEIGHT}px` }}
              onClick={handleTimelineClick}
              onMouseMove={handleTimelineMouseMove}
              onMouseLeave={handleTimelineMouseLeave}
            >
              {hourlySlots.map((slot, index) => (
                <div
                  key={slot}
                  className="pointer-events-none absolute left-0 right-0 border-t border-gray-200"
                  style={{ top: `${index * TIMELINE_HOUR_HEIGHT}px`, height: `${TIMELINE_HOUR_HEIGHT}px` }}
                />
              ))}

              <div className="pointer-events-none absolute inset-0 px-2">
                {hoverIndicator && (
                  <div
                    className={`absolute left-1 right-1 rounded-lg border ${
                      hoverIndicator.occupied
                        ? 'border-red-300 bg-red-100/70'
                        : 'border-primary-300 bg-primary-100/60'
                    }`}
                    style={{ top: `${hoverIndicator.top + 4}px`, height: `${hoverIndicator.height - 8}px` }}
                  >
                    <span
                      className={`absolute -top-5 left-0 rounded-md px-2 py-0.5 text-[11px] font-medium text-white shadow ${
                        hoverIndicator.occupied ? 'bg-red-600' : 'bg-primary-600'
                      }`}
                    >
                      {hoverIndicator.occupied
                        ? `Khung ${hoverIndicator.label} đã có lịch`
                        : `Bấm để đặt lịch lúc ${hoverIndicator.label}`}
                    </span>
                  </div>
                )}

                {positionedBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="pointer-events-auto absolute rounded-xl border border-primary-200 bg-primary-200/80 px-3 py-2 text-primary-900 shadow-sm"
                    style={{
                      top: `${booking.top}px`,
                      left: `calc(${(booking.lane / booking.laneCount) * 100}% + 2px)`,
                      width: `calc(${100 / booking.laneCount}% - 4px)`,
                      height: `${booking.height}px`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{booking.title || booking.room_name}</p>
                        <p className="text-xs opacity-80">{formatTime(booking.start_time)} - {formatTime(booking.end_time)}</p>
                      </div>
                      {canDelete(booking) && (
                        <button
                          onClick={() => handleDeleteBooking(booking)}
                          className="rounded p-0.5 text-red-700 hover:bg-red-100"
                          title="Xóa lịch"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs">{booking.contact_name || booking.booked_by_name || 'N/A'} {booking.contact_phone ? `• ${booking.contact_phone}` : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="xl:col-span-4 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="mb-4 flex rounded-full bg-gray-100 p-1 text-xs font-semibold text-gray-600">
            <button type="button" className="flex-1 rounded-full bg-primary-200 py-1.5 text-primary-800">Month</button>
            <button type="button" className="flex-1 rounded-full py-1.5">Year</button>
          </div>

          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xl font-bold text-gray-900">{MONTH_NAMES[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}</h3>
            <div className="flex items-center gap-1">
              <button type="button" onClick={goPrevMonth} className="rounded-full bg-primary-100 p-1.5 text-primary-700 hover:bg-primary-200">
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              <button type="button" onClick={goNextMonth} className="rounded-full bg-primary-100 p-1.5 text-primary-700 hover:bg-primary-200">
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEK_DAYS.map((day) => (
              <div key={day} className="py-1 text-center text-[11px] font-semibold text-gray-500">{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 mb-4">
            {calendarCells.map((cell) => {
              const isSelected = cell.key === selectedDate;
              const isToday = cell.key === toDateInput(today);
              const bookingCount = bookingsByDate[cell.key] || 0;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => handleChooseCalendarDate(cell.date)}
                  className={`h-8 rounded-full text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-primary-500 text-white'
                      : isToday
                      ? 'bg-primary-100 text-primary-700'
                      : cell.inCurrentMonth
                      ? 'text-gray-700 hover:bg-gray-100'
                      : 'text-gray-300 hover:bg-gray-100'
                  }`}
                  title={bookingCount > 0 ? `${bookingCount} lịch` : undefined}
                >
                  {cell.date.getDate()}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setShowBookingModal(true)}
            className="mb-3 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Đặt lịch phòng họp
          </button>

          <div className="mt-3 text-xs text-gray-500">
            Bấm vào các dòng giờ ở timeline bên trái để chọn nhanh khung giờ.
          </div>
        </div>
      </div>

      {showBookingModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4"
          onClick={() => setShowBookingModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Đặt lịch phòng họp</h3>
                <p className="text-sm text-gray-500">Ngày {selectedDate} • Tối thiểu {minBookingMinutes} phút</p>
              </div>
              <button
                type="button"
                onClick={() => setShowBookingModal(false)}
                className="rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              >
                Đóng
              </button>
            </div>

            <form onSubmit={handleCreateBooking} className="space-y-3">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <select
                value={form.room}
                onChange={(e) => setForm((prev) => ({ ...prev, room: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Chọn phòng</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} ({room.code})
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="datetime-local"
                  value={form.start_time}
                  onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <input
                  type="datetime-local"
                  value={form.end_time}
                  onChange={(e) => setForm((prev) => ({ ...prev, end_time: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="Tiêu đề cuộc họp"
              />
              <textarea
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                rows={3}
                placeholder="Ghi chú"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
              >
                {submitting ? 'Đang đặt...' : 'Lưu lịch họp'}
              </button>
              {activeRoom && (
                <p className="text-xs text-gray-500">
                  Phòng: {activeRoom.name}
                  {activeRoom.location ? ` • ${activeRoom.location}` : ''}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MeetingRoomBookingPage;

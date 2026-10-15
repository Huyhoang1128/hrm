import React, { useEffect, useMemo, useState } from 'react';
import { BuildingOfficeIcon, PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../contexts/AuthContext';
import {
  MeetingRoom,
  MeetingRoomBookingLog,
  MeetingRoomSetting,
  meetingRoomService,
} from '../services/meetingRoom.service';

const MeetingRoomManagementPage: React.FC = () => {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [setting, setSetting] = useState<MeetingRoomSetting | null>(null);
  const [logs, setLogs] = useState<MeetingRoomBookingLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [message, setMessage] = useState<string>('');

  const [roomForm, setRoomForm] = useState({
    id: 0,
    name: '',
    code: '',
    location: '',
    capacity: 0,
    description: '',
  });

  const [settingForm, setSettingForm] = useState({
    min_booking_minutes: 30,
    workday_start_hour: 8,
    workday_end_hour: 22,
  });

  const isAdmin = !!((user as any)?.is_superuser || (user as any)?.is_supperuser || user?.role?.toUpperCase() === 'ADMIN');
  const isHR = !!((user as any)?.employee_profile?.is_hr || (user as any)?.hrm_user?.is_hr || user?.role?.toUpperCase() === 'HR');

  const canManage = useMemo(() => isAdmin || isHR, [isAdmin, isHR]);

  const resetRoomForm = () => {
    setRoomForm({ id: 0, name: '', code: '', location: '', capacity: 0, description: '' });
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [roomsData, settingData, logsData] = await Promise.all([
        meetingRoomService.getRooms(true),
        meetingRoomService.getSetting(),
        meetingRoomService.getBookingHistory(),
      ]);
      setRooms(roomsData);
      setSetting(settingData);
      setSettingForm({
        min_booking_minutes: settingData.min_booking_minutes,
        workday_start_hour: settingData.workday_start_hour,
        workday_end_hour: settingData.workday_end_hour,
      });
      setLogs(logsData);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không thể tải dữ liệu quản lý phòng họp');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canManage) {
      loadData();
    }
  }, [canManage]);

  const handleSaveRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;

    try {
      if (roomForm.id) {
        await meetingRoomService.updateRoom(roomForm.id, {
          name: roomForm.name,
          code: roomForm.code,
          location: roomForm.location,
          capacity: Number(roomForm.capacity),
          description: roomForm.description,
        });
        setMessage('Đã cập nhật phòng họp');
      } else {
        await meetingRoomService.createRoom({
          name: roomForm.name,
          code: roomForm.code,
          location: roomForm.location,
          capacity: Number(roomForm.capacity),
          description: roomForm.description,
          is_active: true,
        });
        setMessage('Đã thêm phòng họp mới');
      }
      resetRoomForm();
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không thể lưu phòng họp');
    }
  };

  const handleEditRoom = (room: MeetingRoom) => {
    setRoomForm({
      id: room.id,
      name: room.name,
      code: room.code,
      location: room.location || '',
      capacity: room.capacity || 0,
      description: room.description || '',
    });
  };

  const handleDeleteRoom = async (room: MeetingRoom) => {
    if (!canManage) return;
    if (!window.confirm(`Xóa phòng họp ${room.name}?`)) return;

    try {
      await meetingRoomService.deleteRoom(room.id);
      setMessage('Đã xóa phòng họp');
      if (roomForm.id === room.id) resetRoomForm();
      await loadData();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không thể xóa phòng họp');
    }
  };

  const handleSaveSetting = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;

    try {
      const updated = await meetingRoomService.updateSetting(settingForm);
      setSetting(updated);
      setMessage('Đã cập nhật cấu hình đặt phòng họp');
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Không thể cập nhật cấu hình');
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-700">
        Bạn không có quyền truy cập chức năng này. Chỉ Admin hoặc HR mới được quản lý phòng họp.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BuildingOfficeIcon className="h-7 w-7 text-primary-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Quản lý phòng họp</h1>
          <p className="text-sm text-gray-500">Thiết lập thời lượng đặt tối thiểu, thêm phòng và theo dõi lịch sử thao tác.</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-1 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Cấu hình đặt phòng</h2>
          <form onSubmit={handleSaveSetting} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tối thiểu mỗi lần đặt (phút)</label>
              <input
                type="number"
                min={5}
                value={settingForm.min_booking_minutes}
                onChange={(e) => setSettingForm((prev) => ({ ...prev, min_booking_minutes: Number(e.target.value) }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Giờ bắt đầu</label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={settingForm.workday_start_hour}
                  onChange={(e) => setSettingForm((prev) => ({ ...prev, workday_start_hour: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Giờ kết thúc</label>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={settingForm.workday_end_hour}
                  onChange={(e) => setSettingForm((prev) => ({ ...prev, workday_end_hour: Number(e.target.value) }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <button type="submit" className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
              Lưu cấu hình
            </button>
          </form>

          {setting && (
            <div className="mt-3 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
              Hiện tại: tối thiểu {setting.min_booking_minutes} phút, khung giờ {setting.workday_start_hour}:00 - {setting.workday_end_hour}:00
            </div>
          )}
        </div>

        <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Phòng họp</h2>

          <form onSubmit={handleSaveRoom} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <input
              type="text"
              required
              placeholder="Tên phòng"
              value={roomForm.name}
              onChange={(e) => setRoomForm((prev) => ({ ...prev, name: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              placeholder="Mã phòng"
              value={roomForm.code}
              onChange={(e) => setRoomForm((prev) => ({ ...prev, code: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="Vị trí"
              value={roomForm.location}
              onChange={(e) => setRoomForm((prev) => ({ ...prev, location: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              placeholder="Sức chứa"
              value={roomForm.capacity}
              onChange={(e) => setRoomForm((prev) => ({ ...prev, capacity: Number(e.target.value) }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              placeholder="Mô tả"
              value={roomForm.description}
              onChange={(e) => setRoomForm((prev) => ({ ...prev, description: e.target.value }))}
              className="md:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              rows={2}
            />

            <div className="md:col-span-2 flex items-center gap-2">
              <button type="submit" className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
                <PlusIcon className="h-4 w-4" />
                {roomForm.id ? 'Cập nhật phòng' : 'Thêm phòng'}
              </button>
              {roomForm.id > 0 && (
                <button type="button" onClick={resetRoomForm} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  Huỷ sửa
                </button>
              )}
            </div>
          </form>

          {loading ? (
            <p className="text-sm text-gray-500">Đang tải danh sách phòng...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2">Tên phòng</th>
                    <th className="py-2">Mã</th>
                    <th className="py-2">Vị trí</th>
                    <th className="py-2">Sức chứa</th>
                    <th className="py-2">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {rooms.map((room) => (
                    <tr key={room.id} className="border-b last:border-b-0">
                      <td className="py-2 font-medium text-gray-900">{room.name}</td>
                      <td className="py-2 text-gray-700">{room.code}</td>
                      <td className="py-2 text-gray-700">{room.location || '-'}</td>
                      <td className="py-2 text-gray-700">{room.capacity || '-'}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEditRoom(room)}
                            className="rounded-md p-1 text-primary-600 hover:bg-primary-50"
                            title="Sửa"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteRoom(room)}
                            className="rounded-md p-1 text-red-600 hover:bg-red-50"
                            title="Xóa"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h2 className="font-semibold text-gray-900 mb-3">Lịch sử thao tác (HR/Admin theo dõi)</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">Chưa có lịch sử.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Thời gian</th>
                  <th className="py-2">Phòng</th>
                  <th className="py-2">Hành động</th>
                  <th className="py-2">Người thực hiện</th>
                  <th className="py-2">Vai trò</th>
                  <th className="py-2">Liên hệ</th>
                </tr>
              </thead>
              <tbody>
                {logs.slice(0, 200).map((log) => (
                  <tr key={log.id} className="border-b last:border-b-0">
                    <td className="py-2 text-gray-700">{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                    <td className="py-2 text-gray-700">{log.room_name || '-'}</td>
                    <td className="py-2 text-gray-900 font-medium">{log.action}</td>
                    <td className="py-2 text-gray-700">{log.performed_by_username || '-'}</td>
                    <td className="py-2 text-gray-700">{log.performed_by_role || '-'}</td>
                    <td className="py-2 text-gray-700">{log.contact_name || '-'} {log.contact_phone ? `(${log.contact_phone})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default MeetingRoomManagementPage;

import { managementApi } from '../utils/api';

export interface MeetingRoom {
  id: number;
  name: string;
  code: string;
  location: string;
  capacity: number;
  description: string;
  is_active: boolean;
}

export interface MeetingRoomSetting {
  id: number;
  min_booking_minutes: number;
  workday_start_hour: number;
  workday_end_hour: number;
}

export interface MeetingRoomBooking {
  id: number;
  room: number;
  room_name: string;
  title: string;
  note: string;
  booked_by_name: string;
  booked_by_employee_id: number | null;
  booked_by_user_id: number | null;
  booking_source: 'USER' | 'AI';
  ai_agent_name: string;
  contact_name: string;
  contact_phone: string;
  start_time: string;
  end_time: string;
  duration_minutes: number;
}

export interface MeetingRoomBookingLog {
  id: number;
  room: number | null;
  room_name: string;
  action: 'CREATED' | 'UPDATED' | 'DELETED';
  booking_source: string;
  old_start_time: string | null;
  old_end_time: string | null;
  new_start_time: string | null;
  new_end_time: string | null;
  contact_name: string;
  contact_phone: string;
  ai_agent_name: string;
  performed_by_username: string | null;
  performed_by_role: string;
  note: string;
  created_at: string;
}

class MeetingRoomService {
  async getRooms(includeInactive = false): Promise<MeetingRoom[]> {
    const response = await managementApi.get('/api-hrm/meeting-rooms/', {
      params: includeInactive ? { include_inactive: true } : undefined,
    });
    return response.data.results || response.data;
  }

  async createRoom(payload: Partial<MeetingRoom>): Promise<MeetingRoom> {
    const response = await managementApi.post('/api-hrm/meeting-rooms/', payload);
    return response.data;
  }

  async updateRoom(id: number, payload: Partial<MeetingRoom>): Promise<MeetingRoom> {
    const response = await managementApi.patch(`/api-hrm/meeting-rooms/${id}/`, payload);
    return response.data;
  }

  async deleteRoom(id: number): Promise<void> {
    await managementApi.delete(`/api-hrm/meeting-rooms/${id}/`);
  }

  async getSetting(): Promise<MeetingRoomSetting> {
    const response = await managementApi.get('/api-hrm/meeting-room-settings/');
    return response.data;
  }

  async updateSetting(payload: Partial<MeetingRoomSetting>): Promise<MeetingRoomSetting> {
    const response = await managementApi.patch('/api-hrm/meeting-room-settings/', payload);
    return response.data;
  }

  async getBookings(params: {
    date?: string;
    start_date?: string;
    end_date?: string;
    room_id?: number;
  }): Promise<MeetingRoomBooking[]> {
    const response = await managementApi.get('/api-hrm/meeting-room-bookings/', { params });
    return response.data.results || response.data;
  }

  async createBooking(payload: {
    room: number;
    title?: string;
    note?: string;
    start_time: string;
    end_time: string;
    booking_source?: 'USER' | 'AI';
    ai_agent_name?: string;
    contact_name?: string;
    contact_phone?: string;
  }): Promise<MeetingRoomBooking> {
    const response = await managementApi.post('/api-hrm/meeting-room-bookings/', payload);
    return response.data;
  }

  async updateBooking(
    id: number,
    payload: Partial<{
      room: number;
      title: string;
      note: string;
      start_time: string;
      end_time: string;
      contact_name: string;
      contact_phone: string;
    }>
  ): Promise<MeetingRoomBooking> {
    const response = await managementApi.patch(`/api-hrm/meeting-room-bookings/${id}/`, payload);
    return response.data;
  }

  async deleteBooking(id: number): Promise<void> {
    await managementApi.delete(`/api-hrm/meeting-room-bookings/${id}/`);
  }

  async getBookingHistory(params?: { room_id?: number; date?: string }): Promise<MeetingRoomBookingLog[]> {
    const response = await managementApi.get('/api-hrm/meeting-room-bookings/history/', { params });
    return response.data;
  }
}

export const meetingRoomService = new MeetingRoomService();

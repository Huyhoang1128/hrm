import axios from 'axios';

// App chấm công (check-in) bên ngoài — để trống nếu không dùng.
export const NURSE_APP_API_URL: string = import.meta.env.VITE_CHECKIN_APP_API_URL || '';
const NURSE_APP_API_KEY: string = import.meta.env.VITE_CHECKIN_APP_API_KEY || '';

export const nurseAppApi = axios.create({
  baseURL: NURSE_APP_API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': NURSE_APP_API_KEY,
  },
});

export interface NurseAccountInfo {
  found: boolean;
  id?: number;
  username?: string;
  email?: string;
  full_name?: string;
  phone_number?: string;
  specialization?: string;
  license_number?: string;
  is_available?: boolean;
  is_active?: boolean;
  nurse_status?: 'active' | 'inactive' | 'on_leave' | 'vacation';
  hrm_employee_id?: string;
  assigned_doctor_id?: number | null;
  assigned_doctor_name?: string | null;
}

export interface DoctorInfo {
  id: number;
  user: {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
    email: string;
  };
  specialization: string;
  specialization_display: string;
  is_available: boolean;
  status: string;
  branch?: string;
  area?: string;
}

export interface NurseAccountListItem {
  id: number;
  user: {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
    email: string;
  };
  is_active: boolean;
  specialization?: string;
  license_number?: string;
  phone_number?: string;
  status?: 'active' | 'inactive' | 'on_leave' | 'vacation';
  is_available?: boolean;
  years_of_experience?: number;
  assigned_doctor?: {
    id: number;
    user: { id: number; username: string; first_name: string; last_name: string; email: string };
    specialization?: string;
    license_number?: string;
  } | null;
  hrm_employee_id?: string | null;
}

export const nurseAccountAPI = {
  list: () => nurseAppApi.get<NurseAccountListItem[]>('/api/users/nurses/'),

  getByHrmEmployeeId: (hrm_employee_id: string) =>
    nurseAppApi.get<NurseAccountInfo>(`/api/users/nurses/by-hrm-employee-id/${hrm_employee_id}/`),

  create: (data: {
    username: string;
    hrm_employee_id: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    phone_number?: string;
    assigned_doctor_id?: number | null;
  }) => nurseAppApi.post<{ success: boolean; generated_password: string; data: any }>('/api/users/nurses/create/', data),

  update: (id: number, data: {
    username?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone_number?: string;
    assigned_doctor_id?: number | null;
    hrm_employee_id?: string;
  }) => nurseAppApi.patch(`/api/users/nurses/${id}/`, data),

  activate: (id: number) =>
    nurseAppApi.post<{ message: string; is_active: boolean }>(`/api/users/nurses/${id}/activate/`),

  deactivate: (id: number) =>
    nurseAppApi.post<{ message: string; is_active: boolean }>(`/api/users/nurses/${id}/deactivate/`),

  resetPassword: (id: number) =>
    nurseAppApi.post<{ success: boolean; message: string; data: { new_password: string } }>(
      `/api/users/nurses/${id}/reset-password/`
    ),
};

export const doctorAppAPI = {
  listAvailable: () =>
    nurseAppApi.get<DoctorInfo[]>('/api/users/doctors/for-hrm/'),
};

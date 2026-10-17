import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { managementApi, API_BASE_URL } from './client';

// Public (no-auth) axios instance
const publicApi = axios.create({ baseURL: API_BASE_URL, timeout: 10000 });

// Dashboard API
export const publicStatsAPI = {
  getStats: async (): Promise<{ active: number; department_count: number; monthly_leave: number }> => {
    const res = await publicApi.get('/api-hrm/public/stats/');
    return res.data;
  },
};

export interface AttendanceAppDownloadConfig {
  name: string;
  ios_url: string;
  android_url: string;
}

export const attendanceAppDownloadAPI = {
  getConfig: async (): Promise<AttendanceAppDownloadConfig> => {
    const response: AxiosResponse<AttendanceAppDownloadConfig> =
      await managementApi.get('/api-hrm/attendance-app-download/');
    return response.data;
  },
};

export const dashboardAPI = {
  getCTOStats: async (): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get('/dashboard/cto/');
    return response.data.data;
  },

  getHRMStats: async (params?: {
    start_date?: string;
    end_date?: string;
    department_id?: number | '';
    all_time?: boolean;
  }): Promise<any> => {
    const response: AxiosResponse<any> =
      await managementApi.get('/api-hrm/dashboard/', { params });
    return response.data;
  },

  clearCache: async (): Promise<void> => {
    await managementApi.post('/dashboard/cache/clear');
  },
};

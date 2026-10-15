import axios from 'axios';
import type { AxiosResponse } from 'axios';
import { managementApi, API_BASE_URL } from './client';
import type { FacebookPage, FacebookConnection } from './types';

// Public (no-auth) axios instance
const publicApi = axios.create({ baseURL: API_BASE_URL, timeout: 10000 });

// Health check
export const healthAPI = {
  check: async (): Promise<{
    status: string;
    timestamp: string;
    service: string;
    version: string;
  }> => {
    const response = await managementApi.get('/health');
    return response.data;
  },
};

// Facebook API
export const facebookAPI = {
  // Get current Facebook connection status
  getConnection: async (): Promise<FacebookConnection | null> => {
    try {
      const response: AxiosResponse<{
        success: boolean;
        data: FacebookConnection;
      }> = await managementApi.get('/facebook/connection/');
      return response.data.data;
    } catch (error: any) {
      // Return null for 404 (no connection) and 401 (unauthorized - treat as no connection)
      if (error.response?.status === 404 || error.response?.status === 401) {
        return null;
      }
      throw error;
    }
  },

  // Get Facebook pages with pagination
  getPages: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<{
    pages: FacebookPage[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    try {
      const response: AxiosResponse<{
        success: boolean;
        data: {
          pages: FacebookPage[];
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      }> = await managementApi.get('/facebook/pages/', { params });
      return response.data.data;
    } catch (error: any) {
      // Return empty result for 404 (no pages) and 401 (unauthorized - treat as no pages)
      if (error.response?.status === 404 || error.response?.status === 401) {
        return {
          pages: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
        };
      }
      throw error;
    }
  },

  // Get Facebook authorization URL
  getAuthUrl: async (): Promise<{ authUrl: string }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: { authUrl: string };
    }> = await managementApi.get('/facebook/auth-url/');
    return response.data.data;
  },

  // Handle Facebook OAuth callback
  handleCallback: async (code: string): Promise<FacebookConnection> => {
    const response: AxiosResponse<{
      success: boolean;
      data: FacebookConnection;
    }> = await managementApi.post('/facebook/callback/', { code });
    return response.data.data;
  },

  // Disconnect Facebook
  disconnect: async (): Promise<void> => {
    await managementApi.delete('/facebook/connection/');
  },

  // Refresh Facebook pages
  refreshPages: async (): Promise<FacebookPage[]> => {
    const response: AxiosResponse<{ success: boolean; data: FacebookPage[] }> =
      await managementApi.post('/facebook/refresh-pages/');
    return response.data.data;
  },

  // Get page insights
  getPageInsights: async (pageId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get(`/facebook/pages/${pageId}/insights`);
    return response.data.data;
  },

  // Connect bot to page
  connectBot: async (pageId: string, botId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.post(`/facebook/pages/${pageId}/connect-bot`, {
        botId,
      });
    return response.data.data;
  },

  // Disconnect bot from page
  disconnectBot: async (pageId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.delete(`/facebook/pages/${pageId}/connect-bot`);
    return response.data.data;
  },
};

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

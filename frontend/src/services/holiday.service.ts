import { managementApi } from '../utils/api';

export interface HolidayConfig {
  id: number;
  name: string;
  description?: string;
  holiday_date: string;
  is_recurring: boolean;
  holiday_type: 'PUBLIC_HOLIDAY' | 'COMPANY_HOLIDAY' | 'SPECIAL_EVENT' | 'OTHER';
  is_working_day: boolean;
  allow_voluntary_work: boolean;
  overtime_multiplier: number;
  apply_to_all: boolean;
  excluded_departments?: any[];
  excluded_positions?: any[];
  excluded_employees?: any[];
  notes?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: any;
}

export interface HolidayListResponse {
  count: number;
  next?: string;
  previous?: string;
  results: HolidayConfig[];
}

class HolidayService {
  private baseUrl = '/api-hrm/holiday-configs';

  /**
   * Lấy danh sách ngày lễ
   */
  async list(params?: {
    page?: number;
    page_size?: number;
    search?: string;
    holiday_type?: string;
    year?: number;
    month?: number;
    is_active?: boolean;
  }): Promise<HolidayListResponse> {
    const response = await managementApi.get(this.baseUrl, { params });
    return response.data;
  }

  /**
   * Tạo ngày lễ mới
   */
  async create(data: Partial<HolidayConfig>): Promise<HolidayConfig> {
    const response = await managementApi.post(this.baseUrl + '/', data);
    return response.data;
  }

  /**
   * Lấy chi tiết ngày lễ
   */
  async get(id: number): Promise<HolidayConfig> {
    const response = await managementApi.get(`${this.baseUrl}/${id}/`);
    return response.data;
  }

  /**
   * Cập nhật ngày lễ
   */
  async update(id: number, data: Partial<HolidayConfig>): Promise<HolidayConfig> {
    const response = await managementApi.put(`${this.baseUrl}/${id}/`, data);
    return response.data;
  }

  /**
   * Xóa ngày lễ
   */
  async delete(id: number): Promise<void> {
    await managementApi.delete(`${this.baseUrl}/${id}/`);
  }

  /**
   * Lấy danh sách ngày lễ trong năm
   */
  async getHolidaysByYear(year: number): Promise<HolidayConfig[]> {
    try {
      const response = await this.list({ year, page_size: 500 });
      return response?.results || [];
    } catch (err) {
      console.error('Error fetching holidays by year:', err);
      return [];
    }
  }

  /**
   * Lấy danh sách ngày lễ trong tháng
   */
  async getHolidaysByMonth(year: number, month: number): Promise<HolidayConfig[]> {
    try {
      const response = await this.list({ year, month, page_size: 100 });
      return response?.results || [];
    } catch (err) {
      console.error('Error fetching holidays by month:', err);
      return [];
    }
  }

  /**
   * Kiểm tra xem ngày có phải ngày lễ không
   */
  async isHoliday(date: string): Promise<boolean> {
    try {
      const response = await managementApi.get(`${this.baseUrl}/check_holiday/`, {
        params: { date },
      });
      return response.data?.is_holiday || false;
    } catch {
      return false;
    }
  }

  /**
   * Lấy danh sách ngày lễ sắp tới
   */
  async getUpcomingHolidays(days: number = 30): Promise<HolidayConfig[]> {
    const response = await managementApi.get(`${this.baseUrl}/upcoming/`, {
      params: { days, page_size: 100 },
    });
    return response.data?.results || [];
  }
}

export const holidayService = new HolidayService();

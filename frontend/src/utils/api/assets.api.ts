import type { AxiosResponse } from 'axios';
import { managementApi } from './client';
import type {
  Asset,
  AssetAssignmentHistory,
  AssetMaintenance,
  AssetInventoryCheck,
  AssetStats,
} from './types';

// Assets API
export const assetsAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    search?: string;
    asset_type?: string;
    status?: string;
    condition?: string;
    department?: number;
    assigned_to?: number;
    pending_handover?: boolean;
    ordering?: string;
    show_deleted?: boolean;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: Asset[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: Asset[];
    }> = await managementApi.get('/api-hrm/assets/', { params });
    return response.data;
  },

  // Các "Phân loại" đang dùng (kèm số tài sản, nhiều nhất trước) + loại chuẩn
  // chưa dùng — gợi ý khi gõ ô Phân loại để HCNS gõ thống nhất.
  typeOptions: async (): Promise<Array<{ value: string; label: string; count: number }>> => {
    const response = await managementApi.get('/api-hrm/assets/type_options/');
    return response.data;
  },

  getById: async (id: number): Promise<Asset> => {
    const response: AxiosResponse<Asset> = await managementApi.get(`/api-hrm/assets/${id}/`);
    return response.data;
  },

  create: async (data: Partial<Asset>): Promise<Asset> => {
    const response: AxiosResponse<Asset> = await managementApi.post('/api-hrm/assets/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<Asset>): Promise<Asset> => {
    const response: AxiosResponse<Asset> = await managementApi.put(`/api-hrm/assets/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/assets/${id}/`);
  },

  restore: async (id: number): Promise<Asset> => {
    const response: AxiosResponse<Asset> = await managementApi.post(`/api-hrm/assets/${id}/restore/`);
    return response.data;
  },

  partialUpdate: async (id: number, data: Partial<Asset>): Promise<Asset> => {
    const response: AxiosResponse<Asset> = await managementApi.patch(`/api-hrm/assets/${id}/`, data);
    return response.data;
  },

  stats: async (): Promise<AssetStats> => {
    const response: AxiosResponse<AssetStats> = await managementApi.get('/api-hrm/assets/stats/');
    return response.data;
  },

  assign: async (id: number, data: {
    employee_id: number;
    assigned_date?: string;
    notes?: string;
    force?: boolean;
    override_pending?: boolean;
    quantity?: number;
  }): Promise<AssetAssignmentHistory> => {
    const response: AxiosResponse<AssetAssignmentHistory> = await managementApi.post(`/api-hrm/assets/${id}/assign/`, data);
    return response.data;
  },

  confirmHandover: async (id: number): Promise<AssetAssignmentHistory> => {
    const response: AxiosResponse<AssetAssignmentHistory> = await managementApi.post(`/api-hrm/assets/${id}/confirm_handover/`);
    return response.data;
  },

  rejectHandover: async (id: number, rejection_reason?: string): Promise<AssetAssignmentHistory> => {
    const response: AxiosResponse<AssetAssignmentHistory> = await managementApi.post(
      `/api-hrm/assets/${id}/reject_handover/`,
      { rejection_reason: rejection_reason || '' },
    );
    return response.data;
  },

  pendingHandovers: async (): Promise<AssetAssignmentHistory[]> => {
    const response: AxiosResponse<AssetAssignmentHistory[]> = await managementApi.get('/api-hrm/assets/pending_handovers/');
    return response.data;
  },

  recentReturns: async (days = 7): Promise<AssetAssignmentHistory[]> => {
    const response: AxiosResponse<AssetAssignmentHistory[]> = await managementApi.get(
      `/api-hrm/assets/recent_returns/?days=${days}`,
    );
    return response.data;
  },

  acknowledgeReturns: async (ids: number[]): Promise<void> => {
    await managementApi.post('/api-hrm/assets/acknowledge_returns/', { ids });
  },

  exportExcel: async (params?: {
    search?: string;
    asset_type?: string;
    status?: string;
    condition?: string;
  }): Promise<Blob> => {
    const response = await managementApi.get('/api-hrm/assets/export_excel/', {
      params,
      responseType: 'blob',
    });
    return response.data;
  },

  // File mẫu để nhập Excel hàng loạt (header + dropdown + 2 dòng ví dụ),
  // không phụ thuộc dữ liệu thật — dùng cho nút "Tải file mẫu".
  exportTemplate: async (): Promise<Blob> => {
    const response = await managementApi.get('/api-hrm/assets/export_template/', {
      responseType: 'blob',
    });
    return response.data;
  },

  bulkImportExcel: async (file: File): Promise<{
    sheet: string;
    data_rows: number;
    created: number;
    updated: number;
    failed_count: number;
    failed: Array<{ row: number; messages: string[] }>;
    details: Array<{
      row: number;
      action: 'created' | 'updated';
      asset_code: string;
      name: string;
      asset_type: string;
      handover_to: string | null;
      warnings: string[];
    }>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await managementApi.post(
      '/api-hrm/assets/bulk_import_excel/',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return response.data;
  },

  returnAsset: async (id: number, data: {
    return_date?: string;
    condition?: string;
    notes?: string;
    history_id?: number;
    return_quantity?: number;
  }): Promise<Asset> => {
    const response: AxiosResponse<Asset> = await managementApi.post(`/api-hrm/assets/${id}/return_asset/`, data);
    return response.data;
  },

  assignedAssets: async (): Promise<Asset[]> => {
    const response: AxiosResponse<Asset[]> = await managementApi.get('/api-hrm/assets/assigned_assets/');
    return response.data;
  },

  assignmentHistory: async (id: number, params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetAssignmentHistory[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetAssignmentHistory[];
    }> = await managementApi.get(`/api-hrm/assets/${id}/assignment_history/`, { params });
    return response.data;
  },

  maintenanceHistory: async (id: number, params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetMaintenance[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetMaintenance[];
    }> = await managementApi.get(`/api-hrm/assets/${id}/maintenance_history/`, { params });
    return response.data;
  },

  inventoryHistory: async (id: number, params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetInventoryCheck[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetInventoryCheck[];
    }> = await managementApi.get(`/api-hrm/assets/${id}/inventory_history/`, { params });
    return response.data;
  },

  // Upload ảnh tài sản (hiện tại / mới mua) — endpoint riêng, luôn upload thẳng lên
  // Cloudfly S3, giống ChangeAvatarView (Employee.avatar), thay vì gộp vào payload
  // JSON của create/update.
  uploadImage: async (id: number, imageType: 'current' | 'purchase', file: File): Promise<{
    success: boolean;
    current_image_url: string | null;
    purchase_image_url: string | null;
  }> => {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('image_type', imageType);
    const response = await managementApi.post(`/api-hrm/assets/${id}/upload_image/`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  clearImage: async (id: number, imageType: 'current' | 'purchase'): Promise<void> => {
    await managementApi.post(`/api-hrm/assets/${id}/clear_image/`, { image_type: imageType });
  },

  // Ảnh QR (PNG) generate on-the-fly, encode URL mở thẳng trang chi tiết tài
  // sản trong HRM. Endpoint yêu cầu đăng nhập (Bearer token) nên phải fetch
  // qua managementApi (blob) rồi tạo object URL — không dùng <img src> thẳng
  // vào URL API được vì trình duyệt không tự đính kèm Authorization header.
  getQrCode: async (id: number): Promise<Blob> => {
    const response = await managementApi.get(`/api-hrm/assets/${id}/qr_code/`, {
      responseType: 'blob',
    });
    return response.data;
  },
};

// Asset Assignment History API
export const assetAssignmentsAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    asset?: number;
    assigned_to?: number;
    returned_date?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetAssignmentHistory[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetAssignmentHistory[];
    }> = await managementApi.get('/api-hrm/asset-assignments/', { params });
    return response.data;
  },

  currentAssignments: async (params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetAssignmentHistory[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetAssignmentHistory[];
    }> = await managementApi.get('/api-hrm/asset-assignments/current_assignments/', { params });
    return response.data;
  },

  employeeAssignments: async (employeeId: number, params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetAssignmentHistory[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetAssignmentHistory[];
    }> = await managementApi.get(`/api-hrm/asset-assignments/employee_assignments/?employee_id=${employeeId}`, { params });
    return response.data;
  },
};

// Asset Maintenance API
export const assetMaintenanceAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    asset?: number;
    maintenance_type?: string;
    performed_by_employee?: number;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetMaintenance[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetMaintenance[];
    }> = await managementApi.get('/api-hrm/asset-maintenance/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<AssetMaintenance> => {
    const response: AxiosResponse<AssetMaintenance> = await managementApi.get(`/api-hrm/asset-maintenance/${id}/`);
    return response.data;
  },

  create: async (data: Partial<AssetMaintenance>): Promise<AssetMaintenance> => {
    const response: AxiosResponse<AssetMaintenance> = await managementApi.post('/api-hrm/asset-maintenance/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<AssetMaintenance>): Promise<AssetMaintenance> => {
    const response: AxiosResponse<AssetMaintenance> = await managementApi.put(`/api-hrm/asset-maintenance/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/asset-maintenance/${id}/`);
  },

  upcomingMaintenance: async (params?: {
    page?: number;
    page_size?: number;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetMaintenance[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetMaintenance[];
    }> = await managementApi.get('/api-hrm/asset-maintenance/upcoming_maintenance/', { params });
    return response.data;
  },

  assetMaintenanceSummary: async (): Promise<any> => {
    const response: AxiosResponse<any> = await managementApi.get('/api-hrm/asset-maintenance/asset_maintenance_summary/');
    return response.data;
  },
};

// Asset Inventory Check API (Lịch sử kiểm kê)
export const assetInventoryChecksAPI = {
  list: async (params?: {
    page?: number;
    page_size?: number;
    asset?: number;
    result?: string;
    checked_by?: number;
    search?: string;
  }): Promise<{
    count: number;
    next: string | null;
    previous: string | null;
    results: AssetInventoryCheck[];
  }> => {
    const response: AxiosResponse<{
      count: number;
      next: string | null;
      previous: string | null;
      results: AssetInventoryCheck[];
    }> = await managementApi.get('/api-hrm/asset-inventory-checks/', { params });
    return response.data;
  },

  getById: async (id: number): Promise<AssetInventoryCheck> => {
    const response: AxiosResponse<AssetInventoryCheck> = await managementApi.get(`/api-hrm/asset-inventory-checks/${id}/`);
    return response.data;
  },

  create: async (data: Partial<AssetInventoryCheck> & { asset_id: number }): Promise<AssetInventoryCheck> => {
    const response: AxiosResponse<AssetInventoryCheck> = await managementApi.post('/api-hrm/asset-inventory-checks/', data);
    return response.data;
  },

  update: async (id: number, data: Partial<AssetInventoryCheck>): Promise<AssetInventoryCheck> => {
    const response: AxiosResponse<AssetInventoryCheck> = await managementApi.put(`/api-hrm/asset-inventory-checks/${id}/`, data);
    return response.data;
  },

  delete: async (id: number): Promise<void> => {
    await managementApi.delete(`/api-hrm/asset-inventory-checks/${id}/`);
  },
};

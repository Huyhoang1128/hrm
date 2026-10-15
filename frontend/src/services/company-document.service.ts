import { managementApi } from '../utils/api';

export interface CompanyDocument {
  id: number;
  document_code: string;
  title: string;
  document_type: string;
  document_type_display: string;
  description: string;
  file: string;
  file_name: string;
  file_size: number;
  file_type: string;
  version: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  status_display: string;
  access_level: string;
  access_level_display: string;
  department: number | null;
  department_name: string | null;
  tags: string[];
  created_by: number | null;
  created_by_name: string | null;
  published_by: number | null;
  published_by_name: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  is_current: boolean;
  download_url: string;
}

export interface CompanyDocumentStats {
  total: number;
  published: number;
  draft: number;
  archived: number;
  current: number;
  document_type_stats: Array<{
    document_type: string;
    document_type_display: string;
    count: number;
  }>;
  access_level_stats: Array<{
    access_level: string;
    access_level_display: string;
    count: number;
  }>;
  total_views: number;
}

export interface CompanyDocumentListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: CompanyDocument[];
}

export const companyDocumentAPI = {
  // Get all company documents
  list: async (params?: {
    page?: number;
    page_size?: number;
    document_type?: string;
    access_level?: string;
    department?: number;
    status?: string;
    is_current?: boolean;
    search?: string;
    ordering?: string;
  }): Promise<CompanyDocumentListResponse> => {
    const response = await managementApi.get('/api-hrm/company-documents/', { params });
    return response.data;
  },

  // Get current active documents
  getCurrent: async (params?: {
    page?: number;
    page_size?: number;
    document_type?: string;
    department?: number;
    search?: string;
  }): Promise<CompanyDocumentListResponse> => {
    const response = await managementApi.get('/api-hrm/company-documents/', {
      params: {
        ...params,
        is_current: true,
        status: 'PUBLISHED',
      }
    });
    return response.data;
  },

  // Get documents accessible to current employee
  getEmployeeDocuments: async (params?: {
    page?: number;
    page_size?: number;
    document_type?: string;
    search?: string;
  }): Promise<CompanyDocumentListResponse> => {
    const response = await managementApi.get('/api-hrm/company-documents/employee_documents/', { params });
    return response.data;
  },

  // Get document by ID
  getById: async (id: number): Promise<CompanyDocument> => {
    const response = await managementApi.get(`/api-hrm/company-documents/${id}/`);
    return response.data;
  },

  // Record document view
  recordView: async (documentId: number): Promise<void> => {
    await managementApi.post(`/api-hrm/company-documents/${documentId}/record-view/`);
  },

  // Get document statistics
  getStats: async (): Promise<CompanyDocumentStats> => {
    const response = await managementApi.get('/api-hrm/company-documents/stats/');
    return response.data;
  },

  // Get documents by type
  getByType: async (documentType: string, params?: {
    page?: number;
    page_size?: number;
    search?: string;
  }): Promise<CompanyDocumentListResponse> => {
    const response = await managementApi.get('/api-hrm/company-documents/', {
      params: {
        ...params,
        document_type: documentType,
        is_current: true,
        status: 'PUBLISHED',
      }
    });
    return response.data;
  },

  // Download document
  download: async (documentId: number): Promise<Blob> => {
    const response = await managementApi.get(`/api-hrm/company-documents/${documentId}/download/`, {
      responseType: 'blob',
    });
    return response.data;
  },

  // Helper function to format file size
  formatFileSize: (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  // Helper function to get document type display name
  getDocumentTypeDisplay: (documentType: string): string => {
    const typeMap: Record<string, string> = {
      'TRAINING': 'Tài liệu đào tạo hội nhập',
      'ANNOUNCEMENT': 'Thông báo, quyết định ban hành',
      'REGULATION': 'Nội quy lao động',
      'FORM': 'Mẫu giấy tờ nội bộ',
      'PROCEDURE': 'Quy trình làm việc các bộ phận',
      'OTHER': 'Khác',
    };
    return typeMap[documentType] || documentType;
  },

  // Helper function to get access level display name
  getAccessLevelDisplay: (accessLevel: string): string => {
    const levelMap: Record<string, string> = {
      'PUBLIC': 'Công khai',
      'INTERNAL': 'Nội bộ',
      'RESTRICTED': 'Hạn chế',
      'CONFIDENTIAL': 'Bảo mật',
    };
    return levelMap[accessLevel] || accessLevel;
  },

  // Helper function to get status display name
  getStatusDisplay: (status: string): string => {
    const statusMap: Record<string, string> = {
      'DRAFT': 'Nháp',
      'PUBLISHED': 'Đã công bố',
      'ARCHIVED': 'Đã lưu trữ',
      'EXPIRED': 'Hết hiệu lực',
    };
    return statusMap[status] || status;
  },
};

export default companyDocumentAPI;

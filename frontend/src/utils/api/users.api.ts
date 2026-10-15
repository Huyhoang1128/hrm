import type { AxiosResponse } from 'axios';
import { managementApi } from './client';
import type { User, Permission, Role, UserRole, ApiKey } from './types';

// Users API
export const usersAPI = {
  list: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    isActive?: boolean;
  }): Promise<{
    users: User[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        users: User[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/users', { params });
    return response.data.data;
  },

  getById: async (id: string): Promise<User> => {
    const response: AxiosResponse<{ success: boolean; data: User }> =
      await managementApi.get(`/users/${id}`);
    return response.data.data;
  },

  getByIdWithRoles: async (id: string): Promise<User> => {
    const response: AxiosResponse<{ success: boolean; data: User }> =
      await managementApi.get(`/users/${id}/with-roles`);
    return response.data.data;
  },

  create: async (data: Partial<User>): Promise<User> => {
    const response: AxiosResponse<{ success: boolean; data: User }> =
      await managementApi.post('/users', data);
    return response.data.data;
  },

  update: async (id: string, data: Partial<User>): Promise<User> => {
    const response: AxiosResponse<{ success: boolean; data: User }> =
      await managementApi.put(`/users/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/users/${id}`);
  },

  getStatistics: async (): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get('/users/statistics');
    return response.data.data;
  },

  // Bulk operations
  bulkDelete: async (userIds: string[]): Promise<void> => {
    await managementApi.post('/users/bulk-delete', { userIds });
  },

  bulkUpdate: async (userIds: string[], data: Partial<User>): Promise<void> => {
    await managementApi.post('/users/bulk-update', { userIds, data });
  },

  // Role management
  assignRole: async (userId: string, roleId: string): Promise<void> => {
    await managementApi.post(`/users/${userId}/roles`, { roleId });
  },

  removeRole: async (userId: string, roleId: string): Promise<void> => {
    await managementApi.delete(`/users/${userId}/roles/${roleId}`);
  },

  // Activity tracking
  getActivities: async (
    userId: string,
    params?: { period?: string }
  ): Promise<{
    activities: any[];
    total: number;
  }> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get(`/users/${userId}/activities`, { params });
    return response.data.data;
  },

  getActivityStats: async (userId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get(`/users/${userId}/activity-stats`);
    return response.data.data;
  },
};

// Permissions API
export const permissionsAPI = {
  list: async (): Promise<Permission[]> => {
    const response: AxiosResponse<{ success: boolean; data: Permission[] }> =
      await managementApi.get('/permissions/permissions');
    return response.data.data;
  },

  getById: async (id: string): Promise<Permission> => {
    const response: AxiosResponse<{ success: boolean; data: Permission }> =
      await managementApi.get(`/permissions/permissions/${id}`);
    return response.data.data;
  },

  create: async (data: Partial<Permission>): Promise<Permission> => {
    const response: AxiosResponse<{ success: boolean; data: Permission }> =
      await managementApi.post('/permissions/permissions', data);
    return response.data.data;
  },
};

// Roles API
export const rolesAPI = {
  list: async (): Promise<Role[]> => {
    const response: AxiosResponse<{ success: boolean; data: Role[] }> =
      await managementApi.get('/permissions/roles');
    return response.data.data;
  },

  getById: async (id: string): Promise<Role> => {
    const response: AxiosResponse<{ success: boolean; data: Role }> =
      await managementApi.get(`/permissions/roles/${id}`);
    return response.data.data;
  },

  create: async (data: Partial<Role>): Promise<Role> => {
    const response: AxiosResponse<{ success: boolean; data: Role }> =
      await managementApi.post('/permissions/roles', data);
    return response.data.data;
  },

  update: async (id: string, data: Partial<Role>): Promise<Role> => {
    const response: AxiosResponse<{ success: boolean; data: Role }> =
      await managementApi.put(`/permissions/roles/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/permissions/roles/${id}`);
  },

  getStatistics: async (): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.get('/permissions/statistics');
    return response.data.data;
  },

  // Role assignment
  assignToUser: async (userId: string, roleId: string): Promise<any> => {
    const response: AxiosResponse<{ success: boolean; data: any }> =
      await managementApi.post('/permissions/assign-role', { userId, roleId });
    return response.data.data;
  },

  removeFromUser: async (userId: string, roleId: string): Promise<void> => {
    await managementApi.delete(`/permissions/users/${userId}/roles/${roleId}`);
  },

  getUserRoles: async (userId: string): Promise<UserRole[]> => {
    const response: AxiosResponse<{ success: boolean; data: UserRole[] }> =
      await managementApi.get(`/permissions/users/${userId}/roles`);
    return response.data.data;
  },

  getUserPermissions: async (userId: string): Promise<Permission[]> => {
    const response: AxiosResponse<{ success: boolean; data: Permission[] }> =
      await managementApi.get(`/permissions/users/${userId}/permissions`);
    return response.data.data;
  },
};

// API Keys API
export const apiKeysAPI = {
  list: async (params?: {
    page?: number;
    limit?: number;
    chatbot_id?: string;
    status?: string;
  }): Promise<{
    api_keys: ApiKey[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        api_keys: ApiKey[];
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    }> = await managementApi.get('/api-keys/', { params });
    return response.data.data;
  },

  create: async (data: {
    name: string;
    chatbot?: string;
    expires_at?: string;
  }): Promise<ApiKey> => {
    const response: AxiosResponse<{ success: boolean; data: ApiKey }> =
      await managementApi.post('/api-keys/', data);
    return response.data.data;
  },

  getById: async (id: string): Promise<ApiKey> => {
    const response: AxiosResponse<{ success: boolean; data: ApiKey }> =
      await managementApi.get(`/api-keys/${id}`);
    return response.data.data;
  },

  update: async (
    id: string,
    data: { name?: string; status?: string; expires_at?: string }
  ): Promise<ApiKey> => {
    const response: AxiosResponse<{ success: boolean; data: ApiKey }> =
      await managementApi.put(`/api-keys/${id}`, data);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await managementApi.delete(`/api-keys/${id}`);
  },

  regenerate: async (id: string): Promise<ApiKey> => {
    const response: AxiosResponse<{ success: boolean; data: ApiKey }> =
      await managementApi.post(`/api-keys/${id}/regenerate`);
    return response.data.data;
  },

  toggleStatus: async (id: string): Promise<ApiKey> => {
    const response: AxiosResponse<{ success: boolean; data: ApiKey }> =
      await managementApi.post(`/api-keys/${id}/toggle_status`);
    return response.data.data;
  },

  revoke: async (id: string): Promise<ApiKey> => {
    const response: AxiosResponse<{ success: boolean; data: ApiKey }> =
      await managementApi.post(`/api-keys/${id}/revoke`);
    return response.data.data;
  },

  validate: async (key: string): Promise<{
    is_valid: boolean;
    api_key: {
      id: string;
      name: string;
      user_id: string;
      chatbot_id?: string;
      status: string;
      expires_at?: string;
      last_used_at?: string;
    };
  }> => {
    const response: AxiosResponse<{
      success: boolean;
      data: {
        is_valid: boolean;
        api_key: {
          id: string;
          name: string;
          user_id: string;
          chatbot_id?: string;
          status: string;
          expires_at?: string;
          last_used_at?: string;
        };
      };
    }> = await managementApi.get('/api-keys/validate/', { params: { key } });
    return response.data.data;
  },
};

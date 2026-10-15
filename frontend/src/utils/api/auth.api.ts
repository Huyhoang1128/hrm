import type { AxiosResponse } from 'axios';
import { managementApi } from './client';
import type { User, LoginCredentials, RegisterData, AuthResponse } from './types';

let profilePromise: Promise<{ user: User }> | null = null;

const isAdminUser = (userData: any, hrmUser?: any) =>
  !!(
    userData?.is_supperuser ||
    userData?.is_superuser ||
    userData?.is_super_admin ||
    hrmUser?.is_super_admin
  );

// Authentication API
export const authAPI = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response: AxiosResponse<{ access: string; refresh: string; user: any; hrm_user?: any; employee_profile?: any }> =
      await managementApi.post('/api-hrm/users/token/', credentials);
    
    // Debug: Log the full response from backend
    console.log('authAPI.login - Full response:', response.data);
    console.log('authAPI.login - Backend user:', response.data.user);
    console.log('authAPI.login - Employee profile (from user):', response.data.user?.employee_profile);
    console.log('authAPI.login - HRM user (from user):', response.data.user?.hrm_user);
    console.log('authAPI.login - HRM user (top level):', response.data.hrm_user);
    console.log('authAPI.login - Employee profile (top level):', response.data.employee_profile);
    
    // Convert the response to match the expected AuthResponse format
    // Preserve all user data from backend including employee_profile and hrm_user
    const backendUser = response.data.user;
    
    // Get hrm_user and employee_profile from top level if available, otherwise from user object
    const hrmUser = response.data.hrm_user || backendUser.hrm_user;
    const employeeProfile = response.data.employee_profile || backendUser.employee_profile;
    
    const isSupperUser = isAdminUser(backendUser, hrmUser);
    const normalizedRole = isSupperUser
      ? 'ADMIN'
      : backendUser.is_staff
        ? 'HR'
        : (backendUser.role || 'user');

    const user: User = {
      id: backendUser.id.toString(),
      username: backendUser.username,
      email: backendUser.email || '',
      firstName: backendUser.first_name || '',
      lastName: backendUser.last_name || '',
      phone: backendUser.phone_number || '',
      isActive: backendUser.is_active !== undefined ? backendUser.is_active : true,
      lastLoginAt: backendUser.last_login || null,
      loginCount: 0,
      emailVerified: false,
      phoneVerified: false,
      // Backend trả date_joined (snake_case) nên spread `...backendUser` bên
      // dưới KHÔNG ghi đè được key camelCase này — trước 2026-09-25 nó luôn giữ
      // nguyên new Date(), khiến "Ngày tham gia" ở trang Cài đặt luôn hiện
      // NGÀY HÔM NAY và đổi sau mỗi lần đăng nhập. Để null nếu thiếu, UI hiện "N/A".
      createdAt: backendUser.date_joined || backendUser.created_at || null,
      updatedAt: new Date().toISOString(),
      // Spread TRƯỚC
      ...backendUser,
      // Set SAU để không bị backendUser ghi đè
      role: normalizedRole,
      is_super_admin: isSupperUser,
      is_superuser: isSupperUser,
      is_supperuser: isSupperUser,
      employee_profile: employeeProfile,
      hrm_user: hrmUser,
    };
    
    console.log('authAPI.login - Processed user:', user);
    console.log('authAPI.login - Processed employee_profile:', user.employee_profile);
    console.log('authAPI.login - Processed hrm_user:', user.hrm_user);
    
    // Store login response in localStorage for getProfile to use
    try {
      localStorage.setItem('login_response', JSON.stringify({
        employee_profile: employeeProfile,
        hrm_user: hrmUser,
        ...backendUser
      }));
    } catch (e) {
      console.error('Error storing login response in localStorage:', e);
    }
    
    return {
      user,
      tokens: {
        accessToken: response.data.access,
        refreshToken: response.data.refresh,
      },
    };
  },

  register: async (data: RegisterData): Promise<AuthResponse> => {
    const response: AxiosResponse<{ success: boolean; data: AuthResponse }> =
      await managementApi.post('/auth/register', data);
    return response.data.data;
  },

  getProfile: async (): Promise<{ user: User }> => {
    if (profilePromise) {
      return profilePromise;
    }

    profilePromise = (async () => {
      try {
        const response: AxiosResponse<any> =
          await managementApi.get('/api/users/profile/');
        
        // Debug: Log the full response from backend
        console.log('authAPI.getProfile - Full response:', response.data);
        console.log('authAPI.getProfile - Employee profile:', response.data.employee_profile);
        console.log('authAPI.getProfile - HRM user:', response.data.hrm_user);
        
        // The API returns user fields directly at the top level, not wrapped in a 'user' object
        const userData = response.data;
        
        // If employee_profile or hrm_user are not in the response, try to get them from nested structure
        // or use the data from login response stored in localStorage
        let employeeProfile = userData.employee_profile;
        let hrmUser = userData.hrm_user;
        
        // If not found in direct response, check nested structures
        if (!employeeProfile && userData.user && userData.user.employee_profile) {
          employeeProfile = userData.user.employee_profile;
        }
        if (!hrmUser && userData.user && userData.user.hrm_user) {
          hrmUser = userData.user.hrm_user;
        }
        
        // If still not found, try to get from localStorage (from login response)
        if (!employeeProfile || !hrmUser) {
          try {
            const loginData = localStorage.getItem('login_response');
            if (loginData) {
              const parsedLoginData = JSON.parse(loginData);
              if (!employeeProfile && parsedLoginData.employee_profile) {
                employeeProfile = parsedLoginData.employee_profile;
              }
              if (!hrmUser && parsedLoginData.hrm_user) {
                hrmUser = parsedLoginData.hrm_user;
              }
            }
          } catch (e) {
            console.error('Error parsing login data from localStorage:', e);
          }
        }
        
        const isSupperUser = isAdminUser(userData, hrmUser);
        const normalizedRole = isSupperUser
          ? 'ADMIN'
          : userData.is_staff
            ? 'HR'
            : (userData.role || 'user');

        const user: User = {
          id: userData.user_id?.toString() || userData.id?.toString() || '',
          username: userData.username || '',
          email: userData.email || '',
          firstName: userData.first_name || '',
          lastName: userData.last_name || '',
          phone: userData.phone_number || userData.username || '',
          isActive: userData.is_active !== undefined ? userData.is_active : true,
          lastLoginAt: userData.last_login || null,
          loginCount: 0,
          emailVerified: false,
          phoneVerified: false,
          // Xem chú thích ở login(): backend trả snake_case nên spread không
          // ghi đè được key camelCase, giá trị new Date() cũ sẽ dính lại vĩnh viễn.
          createdAt: userData.date_joined || userData.created_at || null,
          updatedAt: new Date().toISOString(),
          // Spread TRƯỚC
          ...userData,
          // Set SAU để không bị userData ghi đè
          role: normalizedRole,
          is_super_admin: isSupperUser,
          is_superuser: isSupperUser,
          is_supperuser: isSupperUser,
          employee_profile: employeeProfile,
          hrm_user: hrmUser,
        };
        
        console.log('authAPI.getProfile - Processed user:', user);
        console.log('authAPI.getProfile - Processed employee_profile:', user.employee_profile);
        console.log('authAPI.getProfile - Processed hrm_user:', user.hrm_user);
        
        // Clear promise after resolving so next requests trigger new fetch
        profilePromise = null;
        return { user };
      } catch (error) {
        profilePromise = null;
        throw error;
      }
    })();
    return profilePromise;
  },

  logout: async (): Promise<void> => {
    // JWT doesn't have a server-side logout endpoint typically
    // Just clear tokens client-side in AuthContext
    // We'll return a resolved promise
    return Promise.resolve();
  },

  changePassword: async (data: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void> => {
    await managementApi.post('/api/users/change-password/', data);
  },
};

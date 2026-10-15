import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import type { AxiosError } from 'axios';
import { User, authAPI } from '../utils/api';
import { useNavigate } from 'react-router-dom';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // Số lần thử lại khi lỗi mạng/server (không phải 401/403). `attempt` đổi
  // giá trị mỗi lần thất bại để effect bên dưới lên lịch lần thử kế tiếp.
  // Trước đây effect phụ thuộc [loading] — loading không bao giờ đổi khi lỗi
  // mạng nên chỉ thử lại đúng 1 lần rồi kẹt spinner vĩnh viễn (case thực tế
  // 2026-10-01: Safari còn token cũ, /api/users/profile/ lỗi mạng → trang
  // chủ quay mãi). Hết số lần thử thì thôi chờ, cho trang hiển thị như chưa
  // đăng nhập (GIỮ token, để người dùng vào lại / đăng nhập lại được).
  const MAX_AUTH_ATTEMPTS = 3;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const userData = await authAPI.getProfile();
      setUser(userData?.user);
      setLoading(false);
    } catch (error) {
      console.error('Auth check failed:', error);

      const status = (error as AxiosError)?.response?.status;
      const isAuthError = status === 401 || status === 403;

      if (isAuthError) {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        setUser(null);
        setLoading(false);
        return;
      }

      // Server/network issue: do not force logout, retry a few times
      setAttempt((n) => n + 1);
    }
  };

  useEffect(() => {
    if (attempt === 0 || !loading) {
      return;
    }

    if (attempt >= MAX_AUTH_ATTEMPTS) {
      console.warn('Auth check gave up after', attempt, 'failed attempts');
      setLoading(false);
      return;
    }

    const retryTimer = window.setTimeout(() => {
      checkAuth();
    }, 3000);

    return () => window.clearTimeout(retryTimer);
  }, [attempt, loading]);

  const login = async (username: string, password: string) => {
    try {
      const response = await authAPI.login({ username, password });

      // Store tokens
      localStorage.setItem('accessToken', response.tokens.accessToken);
      localStorage.setItem('refreshToken', response.tokens.refreshToken);

      try {
        const profile = await authAPI.getProfile();
        setUser(profile.user);
      } catch (profileError) {
        console.warn('Could not refresh profile after login:', profileError);
        setUser(response.user);
      }
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const register = async (data: any) => {
    try {
      const response = await authAPI.register(data);
      setUser(response.user);

      // Store tokens
      localStorage.setItem('accessToken', response.tokens.accessToken);
      localStorage.setItem('refreshToken', response.tokens.refreshToken);
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');

    // Redirect to login page
    navigate('/login');
  };

  const updateUser = (updates: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  };

  const value: AuthContextType = {
    user,
    loading,
    login,
    register,
    logout,
    updateUser,
    isAuthenticated: !!user,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

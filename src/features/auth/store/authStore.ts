import { create } from 'zustand';
import { logger } from '@/shared/utils/logger';
import { persist } from 'zustand/middleware';
import { apiClient } from '@/shared/utils/apiClient';
import { authApi } from '../api/authApi';
import {
  AuthState,
  AuthUser,
  LoginFormValues,
  RegisterPayload,
  ForgotPasswordFormValues
} from '../types/auth.types';

interface AuthStore extends AuthState {
  initialized: boolean;
  login: (payload: LoginFormValues) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  requestReset: (payload: ForgotPasswordFormValues) => Promise<boolean>;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  refreshSession: () => Promise<void>;
  setAuth: (token: string, user: AuthUser) => void;
}

const initialState: AuthState & { initialized: boolean } = {
  user: null,
  token: null,
  loading: false,
  error: null,
  initialized: false
};

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      async login(payload) {
        set({ loading: true, error: null });
        try {
          const response = await authApi.login(payload);
          apiClient.setAccessToken(response.data.accessToken);
          set({ user: response.data.user, token: response.data.accessToken, loading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Login failed';
          set({ error: message, loading: false });
          throw error;
        }
      },
      async register(payload) {
        set({ loading: true, error: null });
        try {
          const response = await authApi.register(payload);
          apiClient.setAccessToken(response.data.accessToken);
          set({ user: response.data.user, token: response.data.accessToken, loading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Registration failed';
          set({ error: message, loading: false });
          throw error;
        }
      },
      async requestReset(payload) {
        set({ loading: true, error: null });
        try {
          await authApi.forgotPassword(payload);
          set({ loading: false });
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Reset failed';
          set({ error: message, loading: false });
          return false;
        }
      },
      async initialize() {
        if (get().initialized) return;
        const token = get().token;
        
        if (token) {
          apiClient.setAccessToken(token);
          try {
            const response = await authApi.me();
            const nextToken = response.data.accessToken ?? token;
            apiClient.setAccessToken(nextToken);
            set({ user: response.data.user, token: nextToken, initialized: true });
            return;
          } catch {
            // Token expired - will try refresh silently
          }
        }
        
        // Try to refresh session using cookie
        try {
          const response = await authApi.refresh();
          apiClient.setAccessToken(response.data.accessToken);
          set({ user: response.data.user, token: response.data.accessToken, initialized: true });
        } catch {
          // Refresh also failed - clear everything and redirect to login
          apiClient.setAccessToken(null);
          set({ token: null, user: null, initialized: true });
        }
      },
      async refreshSession() {
        try {
          const response = await authApi.refresh();
          apiClient.setAccessToken(response.data.accessToken);
          set({ user: response.data.user, token: response.data.accessToken });
        } catch (error) {
          apiClient.setAccessToken(null);
          set({ user: null, token: null });
          throw error;
        }
      },
      async logout() {
        try {
          await authApi.logout();
        } catch (error) {
          logger.warn('Logout failed', error);
        } finally {
          apiClient.setAccessToken(null);
          set({ user: null, token: null, error: null });
        }
      },
      setAuth(token, user) {
        apiClient.setAccessToken(token);
        set({ user, token, loading: false, error: null, initialized: true });
      }
    }),
    {
      name: 'god-crm-auth',
      partialize: (state) => ({ token: state.token, user: state.user }),
      onRehydrateStorage: () => (state) => {
        if (state?.token) {
          apiClient.setAccessToken(state.token);
        }
      }
    }
  )
);

import { apiClient, getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';
import {
  ForgotPasswordFormValues,
  AuthResponse,
  ForgotPasswordResponse,
  LoginFormValues,
  RegisterPayload
} from '../types/auth.types';
import { isDesktopApp } from '@/shared/types/electron.types';

export interface UserProfile {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
  role: string;
  totp_enabled: boolean;
  created_at: string;
}

export interface TwoFASetupResponse {
  secret: string;
  qrCode: string;
}

export const authApi = {
  login: (payload: LoginFormValues) =>
    apiClient.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true
    }),
  register: (payload: RegisterPayload) =>
    apiClient.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true
    }),
  forgotPassword: (payload: ForgotPasswordFormValues) =>
    apiClient.request<ForgotPasswordResponse>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true
    }),
  me: () => apiClient.request<AuthResponse>('/auth/me'),
  refresh: () =>
    apiClient.request<AuthResponse>('/auth/refresh', {
      method: 'POST',
      skipAuth: true
    }),
  logout: () =>
    apiClient.request<{ success: boolean; data: { status: string } }>('/auth/logout', {
      method: 'POST',
      skipAuth: true
    }),
  
  // Profile endpoints
  getProfile: () => 
    apiClient.request<{ success: boolean; data: UserProfile }>('/auth/profile'),
  
  updateProfile: (data: { name?: string; avatar?: string }) =>
    apiClient.request<{ success: boolean; data: UserProfile }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),
  
  changeEmail: (data: { newEmail: string; password: string }) =>
    apiClient.request<{ success: boolean; data: { email: string; message: string } }>('/auth/email', {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),
  
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    apiClient.request<{ success: boolean; data: { message: string } }>('/auth/password', {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),
  
  // 2FA endpoints
  setup2FA: () =>
    apiClient.request<{ success: boolean; data: TwoFASetupResponse }>('/auth/2fa/setup', {
      method: 'POST'
    }),
  
  verify2FA: (code: string) =>
    apiClient.request<{ success: boolean; data: { enabled: boolean; message: string } }>('/auth/2fa/verify', {
      method: 'POST',
      body: JSON.stringify({ code })
    }),
  
  disable2FA: (data: { password: string; code?: string }) =>
    apiClient.request<{ success: boolean; data: { enabled: boolean; message: string } }>('/auth/2fa', {
      method: 'DELETE',
      body: JSON.stringify(data)
    }),

  // ADR-099: Avatar upload via File API (FormData, not base64)
  uploadAvatar: async (file: File): Promise<{ success: boolean; data: { avatar: string } }> => {
    const formData = new FormData();
    formData.append('avatar', file);

    // Build URL: need to manually construct because apiClient sets Content-Type: application/json
    const baseUrl = isDesktopApp() ? getBaseUrlSync() : '/api/v3';

    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${baseUrl}/auth/avatar`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error?.message || `Upload failed (${response.status})`);
    }

    return response.json();
  },

  deleteAvatar: () =>
    apiClient.request<{ success: boolean; data: { avatar: null } }>('/auth/avatar', {
      method: 'DELETE'
    })
};

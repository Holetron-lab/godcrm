import { apiClient } from '@/shared/utils/apiClient';
import type { PublicConfig } from '@/features/registration/registration.types';

/**
 * ADR-188 F5 — unauthenticated public config.
 * Backend: GET /api/v3/public/config (routes/v3/public.js) returns ONLY
 * non-sensitive fields. Used by the login page to decide whether to show the
 * "Sign up" link, without requiring auth.
 */
export type { PublicConfig };

export const publicConfigApi = {
  get: () =>
    apiClient.request<{ success: boolean; data: PublicConfig }>('/public/config', {
      skipAuth: true,
    }),
};

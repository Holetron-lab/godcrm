// ADR-188 Block F1 — owner-only runtime registration policy transport.
//   GET  /api/v3/admin/registration — owner reads current runtime policy
//   PUT  /api/v3/admin/registration — owner writes policy (pg_notify-evicted cluster-wide)
// The unauthenticated public slice (F5) lives in `features/auth/api/publicConfigApi.ts`.
import { apiClient } from '@/shared/utils/apiClient';
import type { RegistrationConfig } from '../registration.types';

export const registrationApi = {
  /** F1 read — owner only. */
  getConfig: () => apiClient.request<{ data: RegistrationConfig }>('/admin/registration'),

  /** F1 write — owner only. Backend evicts the 60s policy cache cluster-wide via pg_notify. */
  updateConfig: (config: RegistrationConfig) =>
    apiClient.request<{ data: RegistrationConfig }>('/admin/registration', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
};

/**
 * ADR-0040 — Owner Secrets Vault API client.
 *
 * Backend contract: backend/routes/v3/secrets.js (P1, ticket 140012).
 * Response envelope: { success, data, timestamp } (backend/utils/response.js).
 *
 * Routes:
 *   GET    /api/v3/secrets              -> list (scrubbed, no plaintext)
 *   POST   /api/v3/secrets              -> create
 *   PUT    /api/v3/secrets/:key         -> update plaintext and/or description
 *   POST   /api/v3/secrets/:key/reveal  -> reveal plaintext (audit-logged, 30/hr)
 *   DELETE /api/v3/secrets/:key         -> delete
 */
import { apiClient } from '@/shared/utils/apiClient';

export interface SecretSummary {
  key: string;
  description: string;
  last_revealed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSecretBody {
  key: string;
  plaintext: string;
  description: string;
}

export interface UpdateSecretBody {
  plaintext?: string;
  description?: string;
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
}

export const secretsApi = {
  async list(): Promise<SecretSummary[]> {
    const r = await apiClient.get<SuccessEnvelope<{ secrets: SecretSummary[] }>>(
      '/secrets'
    );
    return r.data.secrets;
  },

  async create(body: CreateSecretBody): Promise<SecretSummary> {
    const r = await apiClient.post<SuccessEnvelope<{ secret: SecretSummary }>>(
      '/secrets',
      body
    );
    return r.data.secret;
  },

  async update(key: string, body: UpdateSecretBody): Promise<SecretSummary> {
    const r = await apiClient.put<SuccessEnvelope<{ secret: SecretSummary }>>(
      `/secrets/${encodeURIComponent(key)}`,
      body
    );
    return r.data.secret;
  },

  async reveal(key: string): Promise<{ plaintext: string }> {
    const r = await apiClient.post<SuccessEnvelope<{ plaintext: string }>>(
      `/secrets/${encodeURIComponent(key)}/reveal`
    );
    return r.data;
  },

  async remove(key: string): Promise<void> {
    await apiClient.delete<SuccessEnvelope<unknown>>(
      `/secrets/${encodeURIComponent(key)}`
    );
  },
};

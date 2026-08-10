/**
 * ADR-0028 Phase 1 — Space Connectors API client.
 *
 * Backend contract: backend/routes/v3/connectors.js
 * All responses are wrapped in `{ success, data, timestamp }` (backend/utils/response.js).
 */
import { apiClient } from '@/shared/utils/apiClient';

export type ConnectorAuthKind = 'oauth2' | 'api_key';

export type ConnectorStatus =
  | 'pending'
  | 'active'
  | 'expired'
  | 'revoked'
  | 'error';

export interface CatalogueField {
  key: string;
  label: string;
  type: string; // text | password | url | scopes | ...
  required: boolean;
}

export interface CatalogueScopeChoice {
  label: string;
  value: string;
}

export interface CatalogueType {
  slug: string;
  display_name: string;
  icon: string;
  auth_kind: ConnectorAuthKind;
  authorize_url: string | null;
  token_url: string | null;
  scopes_default: string[];
  scopes_choices: CatalogueScopeChoice[];
  client_env: { id: string; secret: string } | null;
  fields: CatalogueField[];
  refresh_supported: boolean;
}

export interface SpaceConnector {
  id: number;
  space_id: number;
  type_slug: string;
  kind: ConnectorAuthKind;
  display_name: string;
  status: ConnectorStatus;
  scopes_requested: string[];
  scopes_granted: string[];
  account_label: string | null;
  custom_definition: Record<string, unknown> | null;
  expires_at: string | null;
  last_refresh_at: string | null;
  last_error: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  has_payload: boolean;

  // ── ADR-159 identity block (Google-shaped UserInfo claims) ──────────
  // Promoted to plain columns server-side and returned verbatim, so the
  // account switcher binds with NO per-provider mapping. Optional because
  // pre-ADR-159 rows are backfilled lazily (see ADR-159 §Migration).
  /** OIDC `sub` — stable unique key, survives email rename. */
  account_sub?: string | null;
  /** claim `email` — switcher label. */
  email?: string | null;
  /** claim `name` — account owner display name. */
  account_name?: string | null;
  /** claim `picture` — switcher avatar. */
  avatar_url?: string | null;
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  timestamp: string;
}

export interface StartOAuthBody {
  type_slug: string;
  display_name: string;
  scopes?: string[];
  custom_definition?: {
    client_id: string;
    authorize_url: string;
    token_url: string;
    scopes?: string;
  };
  fields?: { client_secret?: string };
  /**
   * Branded providers only: paste-in-UI override for client_id/client_secret.
   * If both present, takes precedence over server env vars (n8n-style).
   * Persisted into row payload so refresh works without re-paste.
   */
  client_overrides?: { client_id: string; client_secret: string };
}

export interface CreateApiKeyBody {
  type_slug: string;
  display_name: string;
  fields: Record<string, string>;
  scopes?: string[];
  custom_definition?: Record<string, unknown>;
}

export const connectorsApi = {
  async catalogue(): Promise<CatalogueType[]> {
    const r = await apiClient.get<SuccessEnvelope<{ types: CatalogueType[] }>>(
      '/connectors/catalogue'
    );
    return r.data.types;
  },

  async list(spaceId: number): Promise<SpaceConnector[]> {
    const r = await apiClient.get<SuccessEnvelope<{ connectors: SpaceConnector[] }>>(
      `/spaces/${spaceId}/connectors`
    );
    return r.data.connectors;
  },

  /**
   * ADR-159 — accounts in this space compatible with a module type (e.g. 'mail'),
   * carrying the identity block. Feeds the account switcher.
   * Contract: GET /spaces/:spaceId/connectors?compatible_with=<slug>
   */
  async listCompatible(
    spaceId: number,
    compatibleWith: string
  ): Promise<SpaceConnector[]> {
    const r = await apiClient.get<SuccessEnvelope<{ connectors: SpaceConnector[] }>>(
      `/spaces/${spaceId}/connectors?compatible_with=${encodeURIComponent(compatibleWith)}`
    );
    return r.data.connectors;
  },

  async startOAuth(
    spaceId: number,
    body: StartOAuthBody
  ): Promise<{ authorize_url: string; state: string }> {
    const r = await apiClient.post<
      SuccessEnvelope<{ authorize_url: string; state: string }>
    >(`/spaces/${spaceId}/connectors/start`, body);
    return r.data;
  },

  async createApiKey(
    spaceId: number,
    body: CreateApiKeyBody
  ): Promise<SpaceConnector> {
    const r = await apiClient.post<SuccessEnvelope<{ connector: SpaceConnector }>>(
      `/spaces/${spaceId}/connectors`,
      body
    );
    return r.data.connector;
  },

  async refresh(spaceId: number, id: number): Promise<SpaceConnector> {
    const r = await apiClient.post<SuccessEnvelope<{ connector: SpaceConnector }>>(
      `/spaces/${spaceId}/connectors/${id}/refresh`
    );
    return r.data.connector;
  },

  async revoke(spaceId: number, id: number): Promise<{ id: number; status: 'revoked' }> {
    const r = await apiClient.delete<SuccessEnvelope<{ id: number; status: 'revoked' }>>(
      `/spaces/${spaceId}/connectors/${id}`
    );
    return r.data;
  },
};

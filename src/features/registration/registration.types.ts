// ADR-188 Block F — single source of truth for the community-registration
// frontend contract: runtime signup policy, referral surface and auto-join
// space mapping. Shapes mirror the backend contract frozen in ADR-188
// (F1 `_app_settings.registration`, F4 `/auth/me.referral_code`, F5 public config).
//
// Consolidated here so the transports (`registrationApi`, `publicConfigApi`) and
// the Settings components import ONE definition — no per-file re-declaration drift.

/** How the front door behaves. Enforced server-side on POST /auth/register (F2, fail-closed). */
export type SignupMode = 'open' | 'invite' | 'closed';

/** Global `users.role` assigned to front-door sign-ups (NOT a space access level). */
export type DefaultRole = 'user' | 'viewer';

/** Space membership level granted by auto-join — reuses `user_access_permissions.access_level`. */
export type SpaceAccessLevel = 'viewer' | 'editor' | 'admin';

/** One space a fresh sign-up is auto-joined into, at a given access level (F3). */
export interface AutoJoinEntry {
  space_id: number;
  access_level: SpaceAccessLevel;
}

/** Effective runtime registration policy (owner-editable, `_app_settings.registration`). */
export interface RegistrationConfig {
  signup_mode: SignupMode;
  default_role: DefaultRole;
  auto_join: AutoJoinEntry[];
  /** How many users signed up via a referral so far — read-only, backend-computed (optional). */
  invited_count?: number;
}

/** Unauthenticated public config (F5) — nothing sensitive, only what the login page needs. */
export interface PublicConfig {
  signup_mode: SignupMode;
  referral_enabled: boolean;
}

/**
 * Fail-closed client default (ADR-188 Risk §fail-open vs fail-closed): never render an
 * "open" toggle before the real policy loads, and never default auto-join above `viewer`.
 */
export const DEFAULT_REGISTRATION_CONFIG: RegistrationConfig = {
  signup_mode: 'closed',
  default_role: 'viewer',
  auto_join: [],
};

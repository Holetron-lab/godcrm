/**
 * ADR-0040 P3 — Tier-1 secrets registry (source of truth).
 *
 * The architect-locked list of secrets that migrate from `process.env.*` into
 * the encrypted `_secrets` vault during the D14 cutover (2026-05-18).
 *
 * Layout: { vaultKey, envFallback, category, description }
 *   - vaultKey      — canonical lowercase identifier used at every consumer.
 *   - envFallback   — string OR array (first-match-wins) for transitional
 *                     `process.env.*` reads. Array form is for historical
 *                     aliases (e.g. GEMINI_API_KEY ‖ GOOGLE_AI_API_KEY).
 *   - category      — UX grouping in the Secrets settings tab + seed log.
 *   - description   — short prose for the `description` column.
 *
 * Out-of-scope for ADR-0040 (separate future ADR for key rotation):
 *   JWT_SECRET, SESSION_SECRET, MASTER_ENCRYPTION_KEY, BDD_*, DB passwords.
 */

export const TIER_1_SECRETS = Object.freeze([
  // ── AI providers ───────────────────────────────────────────────────────
  {
    vaultKey: 'openai_api_key',
    envFallback: 'OPENAI_API_KEY',
    category: 'ai',
    description: 'OpenAI API key (chat/agent execution, voice transcription, embeddings)',
  },
  {
    vaultKey: 'anthropic_api_key',
    envFallback: 'ANTHROPIC_API_KEY',
    category: 'ai',
    description: 'Anthropic API key (Claude models in frame/noa + labs/ai-execution)',
  },
  {
    vaultKey: 'gemini_api_key',
    envFallback: ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY'],
    category: 'ai',
    description: 'Google Gemini API key (image-tools fallback + labs Google provider)',
  },
  {
    vaultKey: 'replicate_api_key',
    envFallback: 'REPLICATE_API_KEY',
    category: 'ai',
    description: 'Replicate API key (image generation)',
  },
  {
    vaultKey: 'firecrawl_api_key',
    envFallback: 'FIRECRAWL_API_KEY',
    category: 'ai',
    description: 'Firecrawl API key (web-scrape agent tool)',
  },
  {
    vaultKey: 'twitterapi_io_key',
    envFallback: 'TWITTERAPI_IO_KEY',
    category: 'ai',
    description: 'TwitterAPI.io key (Tweet Radar ingest — ADR-152 step [1])',
  },

  // ── Messaging ──────────────────────────────────────────────────────────
  {
    vaultKey: 'telegram_bot_token',
    envFallback: 'TELEGRAM_BOT_TOKEN',
    category: 'messaging',
    description: 'Telegram Bot token (@godcrm + admin alerts + topic routing)',
  },
  {
    vaultKey: 'nikitron_bot_token',
    envFallback: 'NIKITRON_BOT_TOKEN',
    category: 'messaging',
    description: 'NikitronBot Telegram token (owner-side controller)',
  },
  {
    vaultKey: 'livekit_api_key',
    envFallback: 'LIVEKIT_API_KEY',
    category: 'messaging',
    description: 'LiveKit API key (voice/video calls in chat)',
  },
  {
    vaultKey: 'livekit_api_secret',
    envFallback: 'LIVEKIT_API_SECRET',
    category: 'messaging',
    description: 'LiveKit API secret (paired with livekit_api_key)',
  },
  {
    vaultKey: 'wa_webhook_secret',
    envFallback: 'WA_WEBHOOK_SECRET',
    category: 'messaging',
    description: 'WorkAdventure webhook signing secret (ADR-063)',
  },

  // ── Social-listening (Austin recon — public posts only) ────────────────
  {
    vaultKey: 'bluesky_handle',
    envFallback: 'BLUESKY_HANDLE',
    category: 'social',
    description: 'Bluesky handle (AT Protocol amplifier-graph social-listening)',
  },
  {
    vaultKey: 'bluesky_app_password',
    envFallback: 'BLUESKY_APP_PASSWORD',
    category: 'social',
    description: 'Bluesky app-password (revocable; createSession → searchPosts)',
  },
  {
    vaultKey: 'reddit_api_key',
    envFallback: 'REDDIT_API_KEY',
    category: 'social',
    description: 'Reddit search API key (redditapis.com Bearer-token; reddit_search social-listening)',
  },

  // ── Email ──────────────────────────────────────────────────────────────
  {
    vaultKey: 'smtp_user',
    envFallback: 'SMTP_USER',
    category: 'email',
    description: 'SMTP login (password reset emails)',
  },
  {
    vaultKey: 'smtp_pass',
    envFallback: 'SMTP_PASS',
    category: 'email',
    description: 'SMTP password (paired with smtp_user)',
  },

  // ── Auth / verification ────────────────────────────────────────────────
  {
    vaultKey: 'hcaptcha_secret',
    envFallback: 'HCAPTCHA_SECRET',
    category: 'auth',
    description: 'hCaptcha server secret (signup verification)',
  },

  // ── OAuth ──────────────────────────────────────────────────────────────
  {
    vaultKey: 'google_oauth_client_secret',
    envFallback: 'GOOGLE_CLIENT_SECRET',
    category: 'oauth',
    description: 'Google OAuth client_secret (manifest-only — runtime uses per-space encrypted config)',
  },
  {
    vaultKey: 'telegram_oauth_client_id',
    envFallback: 'TELEGRAM_OAUTH_CLIENT_ID',
    category: 'oauth',
    description: 'Telegram OAuth client_id (ADR-0078 / ADR-183 Block D — public identifier, vault-managed for owner Settings→Secrets flip)',
  },
  {
    vaultKey: 'telegram_oauth_client_secret',
    envFallback: 'TELEGRAM_OAUTH_CLIENT_SECRET',
    category: 'oauth',
    description: 'Telegram OAuth client_secret (ADR-0078 / ADR-183 Block D — SECRET; enables passwordless email→telegram link. Flip enabled only after Blocks A–C land)',
  },

  // ── Other ──────────────────────────────────────────────────────────────
  {
    vaultKey: 'opencode_server_password',
    envFallback: 'OPENCODE_SERVER_PASSWORD',
    category: 'other',
    description: 'OpenCode server password (OpenCodeClient remote agent invocation)',
  },
]);

/** Lookup helper for tests/scripts. */
export function findByVaultKey(vaultKey) {
  return TIER_1_SECRETS.find((s) => s.vaultKey === vaultKey) || null;
}

/** Lookup helper — accepts any of the env names (handles array fallback). */
export function findByEnvName(envName) {
  return TIER_1_SECRETS.find((s) => {
    const names = Array.isArray(s.envFallback) ? s.envFallback : [s.envFallback];
    return names.includes(envName);
  }) || null;
}

export default TIER_1_SECRETS;

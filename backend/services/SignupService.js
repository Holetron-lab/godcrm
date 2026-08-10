// SignupService — ADR-0070 launch wiring
// Mirrors successful registrations into Signups table (100045) and sends welcome email.
// Failures here MUST NOT break /auth/register — log and move on.

import { dbRun } from '../database/connection.js';
import { generateBaseId } from '../utils/baseId.js';
import { sendEmailWithFallback } from '../utils/email.js';
import { authLogger } from '../utils/logger.js';

const SIGNUPS_TABLE_ID = 100045;

const KNOWN_PROMO_COHORTS = {
  IIZNANKA2026: 'iiznanka',
  MASTERMIND: 'mastermind',
  EARLY2026: 'early',
  FRIENDS: 'friends'
};

function resolveCohort(promoCode) {
  if (!promoCode) return 'organic';
  return KNOWN_PROMO_COHORTS[promoCode] || 'unknown-promo';
}

/**
 * Insert a row into Signups table 100045.
 * Direct DB write — hot path, no MCP roundtrip.
 */
export async function mirrorSignupToRegistry({
  user,
  promoCode,
  signupSource,
  signupReferrer,
  userAgent
}) {
  try {
    const data = {
      name: user.name,
      email: user.email,
      promo_code: promoCode || null,
      signup_source: signupSource || 'godcrm.ai/register',
      cohort: resolveCohort(promoCode),
      status: 'new',
      user_id: user.id,
      referrer_url: signupReferrer || null,
      user_agent: userAgent || null,
      notes: null,
      created_at: new Date().toISOString()
    };

    const base_id = generateBaseId();
    await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW())`,
      [SIGNUPS_TABLE_ID, base_id, JSON.stringify(data), user.id]
    );

    authLogger.info({ userId: user.id, promoCode, cohort: data.cohort }, 'Signup mirrored to table 100045');
  } catch (error) {
    authLogger.error({ err: error, userId: user.id }, 'Failed to mirror signup to table 100045');
  }
}

function buildWelcomeHtml({ name, promoCode }) {
  const cohort = resolveCohort(promoCode);
  const promoLine = promoCode && cohort !== 'unknown-promo'
    ? `<p style="margin:16px 0 0 0;color:#555;">promo <code style="font-family:monospace;padding:2px 6px;background:#111;color:#0f0;">${promoCode}</code> accepted. you're in cohort <strong>${cohort}</strong>.</p>`
    : '';

  return `<!doctype html>
<html><body style="font-family:-apple-system,system-ui,sans-serif;background:#000;color:#fff;padding:32px;max-width:560px;margin:0 auto;">
  <h1 style="font-family:monospace;text-transform:lowercase;letter-spacing:-1px;margin:0 0 24px 0;">the door is open.</h1>
  <p style="margin:0;color:#ccc;">${name ? name + ', welcome' : 'welcome'} to godcrm.</p>
  <p style="margin:16px 0 0 0;color:#ccc;">alpha. free. no card required.</p>
  ${promoLine}
  <p style="margin:32px 0 0 0;">
    <a href="https://app.godcrm.ai/" style="display:inline-block;padding:12px 24px;background:#fff;color:#000;text-decoration:none;font-family:monospace;text-transform:uppercase;letter-spacing:2px;">[ enter ]</a>
  </p>
  <p style="margin:32px 0 0 0;color:#666;font-size:12px;">— gera<br/>godcrm.ai</p>
</body></html>`;
}

/**
 * Send a welcome email. Fire-and-forget — failures logged, not thrown.
 */
export async function sendWelcomeEmail({ user, promoCode }) {
  if (!user?.email) return;
  try {
    const subject = promoCode
      ? `godcrm — the door is open (promo ${promoCode})`
      : 'godcrm — the door is open';
    const html = buildWelcomeHtml({ name: user.name, promoCode });
    const result = await sendEmailWithFallback(user.email, subject, html);
    if (result?.success) {
      authLogger.info({ userId: user.id, messageId: result.messageId }, 'Welcome email sent');
    } else {
      authLogger.warn({ userId: user.id, error: result?.error }, 'Welcome email not sent');
    }
  } catch (error) {
    authLogger.error({ err: error, userId: user.id }, 'Welcome email failed');
  }
}

/**
 * Wire signup-side-effects after registerUser() succeeds.
 * Both side-effects are best-effort — never block the register response.
 */
export async function recordSignup({ user, promoCode, signupSource, signupReferrer, userAgent }) {
  await Promise.allSettled([
    mirrorSignupToRegistry({ user, promoCode, signupSource, signupReferrer, userAgent }),
    sendWelcomeEmail({ user, promoCode })
  ]);
}

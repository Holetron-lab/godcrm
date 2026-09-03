// Authentication Service - v0.002.006
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { dbRun, dbGet } from '../database/connection.js';
import { autoCreateDefaultProjects } from './ProjectService.js';
import { applyStarterPack } from './starter-pack/StarterPackService.js';
import { getEffectiveRegistrationPolicy } from './registrationPolicy.js';
import { slugify } from './ImportService.js';
import { authLogger } from '../utils/logger.js';

const SALT_ROUNDS = 10;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';

// Lazy initialization - get master key when needed
function getMasterKey() {
  const key = process.env.MASTER_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('MASTER_ENCRYPTION_KEY must be set in environment');
  }
  return key;
}

/**
 * Generate a unique personal encryption key for a user
 * @returns {string} 256-bit encryption key (base64)
 */
export function generatePersonalKey() {
  // Generate 32 bytes (256 bits) random key
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Encrypt personal key with master key
 * @param {string} personalKey - Personal encryption key
 * @returns {string} Encrypted key (format: iv:ciphertext)
 */
export function encryptPersonalKey(personalKey) {
  // Use AES-256-CBC
  const iv = crypto.randomBytes(16);
  const masterKey = getMasterKey();
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(masterKey.padEnd(32).slice(0, 32)), // Ensure 32 bytes
    iv
  );

  let encrypted = cipher.update(personalKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Return format: iv:ciphertext
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt personal key with master key
 * @param {string} encryptedKey - Encrypted key (format: iv:ciphertext)
 * @returns {string} Decrypted personal key
 */
export function decryptPersonalKey(encryptedKey) {
  const [ivHex, ciphertext] = encryptedKey.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const masterKey = getMasterKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(masterKey.padEnd(32).slice(0, 32)),
    iv
  );

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ADR-183 Block C — referral graph helpers.
// referral_code is a short human-shareable token (deep-link /start <code>). We draw
// from a 30-char unambiguous alphabet (no O/0, I/1, L, U) so codes survive being read
// aloud or copied by hand. The DB partial-UNIQUE index (migration 085) is the source
// of truth for uniqueness; this loop just avoids handing the caller a doomed INSERT.
const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const REFERRAL_CODE_LEN = 8;

function mintReferralCode() {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LEN);
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    code += REFERRAL_ALPHABET[bytes[i] % REFERRAL_ALPHABET.length];
  }
  return code;
}

// ADR-183-A D1 — referral code shape `<name-slug>-<suffix>` (e.g. `geratron-hfg57ff`).
// The prefix caps at 20 chars so the full code (20 + 1 + 8) stays under resolveInviter's
// 32-char guard.
const REFERRAL_PREFIX_MAX = 20;

// ADR-183-A D1 — derive the frozen name-prefix. Reuse ImportService.slugify (it already
// carries the Cyrillic→Latin map, so `Пётр` → `pyotr` for our RU/KZ base — no new
// transliteration invented). Strip stray hyphens, cap to 20, fall back to `user` when the
// name has no transliterable chars.
// ADR-198 D4 reuses this as the mail local-part slugifier too (one slugifier, two callers).
export function referralPrefix(name) {
  const base = slugify(typeof name === 'string' ? name : '')
    .replace(/^-+|-+$/g, '')
    .slice(0, REFERRAL_PREFIX_MAX)
    .replace(/-+$/g, '');
  return base || 'user';
}

// ADR-183-A D1/D2 — mint a unique `<prefix>-<suffix>` code. The prefix is caller-supplied
// and frozen; only the 8-char [a-z2-9] suffix is (re)rolled on clash. The full string is
// clash-checked against users.referral_code (the DB partial-UNIQUE index is the source of
// truth; this loop just avoids a doomed INSERT). Shared by signup (D2) and regeneration
// (D3) so both mint identically and never drift.
async function mintUniqueReferralCodeForPrefix(prefix, maxTries = 6) {
  for (let i = 0; i < maxTries; i++) {
    const candidate = `${prefix}-${mintReferralCode().toLowerCase()}`;
    const clash = await dbGet('SELECT 1 AS x FROM users WHERE referral_code = ?', [candidate]);
    if (!clash) return candidate;
  }
  // Astronomically unlikely at any realistic user count; fail loud rather than
  // insert a NULL and silently break a user's invite link.
  throw new Error('Could not mint a unique referral_code after several attempts');
}

// ADR-183-A D2 — mint at signup: the frozen prefix is derived from the new user's name.
async function mintUniqueReferralCode(name, maxTries = 6) {
  return mintUniqueReferralCodeForPrefix(referralPrefix(name), maxTries);
}

/**
 * ADR-183-A D3 — self-service regeneration. Reroll ONLY the suffix, keep the frozen
 * prefix: split the CURRENT code on its LAST `-` (a multi-word prefix like
 * `petr-ivanov-<suffix>` stays intact). A pre-amendment code with no `-` derives its
 * prefix from the user's current name. Leaves the user's INCOMING edge (`referred_by` —
 * who invited them) untouched; only the OUTGOING code they hand out changes.
 * @param {number} userId
 * @returns {Promise<string>} the new referral_code
 */
export async function regenerateReferralCode(userId) {
  const user = await dbGet('SELECT id, name, referral_code FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('User not found');

  const current = typeof user.referral_code === 'string' ? user.referral_code : '';
  const lastDash = current.lastIndexOf('-');
  const prefix = lastDash > 0 ? current.slice(0, lastDash) : referralPrefix(user.name);

  const newCode = await mintUniqueReferralCodeForPrefix(prefix);
  await dbRun('UPDATE users SET referral_code = ? WHERE id = ?', [newCode, userId]);
  return newCode;
}

/**
 * Resolve an inbound inviter code to the inviter's user id (or null).
 * ADR-183-A D4: codes are normalized (trim + LOWER) to match the new lowercase canonical
 * form — links are shared by humans, so matching is case-insensitive. Unknown or blank
 * codes resolve to null — referral is best-effort attribution, never a gate.
 */
async function resolveInviter(inviteCode) {
  if (typeof inviteCode !== 'string') return null;
  const normalized = inviteCode.trim().toLowerCase();
  if (!normalized || normalized.length > 32) return null;
  const inviter = await dbGet('SELECT id FROM users WHERE referral_code = ?', [normalized]);
  return inviter ? inviter.id : null;
}

/**
 * Register a new user
 * @param {object} userData - { email, password, name, communitySignup?, inviteCode? }
 * @returns {object} Created user
 */
export async function registerUser(userData) {
  const { email, password, name, communitySignup = false, inviteCode = null } = userData;

  // Check if user exists
  const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  // ADR-183 Block C: resolve the inbound inviter code → referred_by. This is the
  // *inviter's* referral_code carried by the deep-link /start <code>. It is written
  // ONCE here at INSERT and never updated (write-once by construction — there is no
  // update path), satisfying the immutability criterion without a DB trigger.
  const referredBy = await resolveInviter(inviteCode);

  // Check if this is the first user (owner) — cheap COUNT, also the bootstrap escape
  // hatch for the signup_mode gate below.
  const userCount = await dbGet('SELECT COUNT(*) as count FROM users', []);
  // Postgres COUNT(*) comes back as a string ("0"), so coerce before comparing —
  // otherwise the first user on a fresh install never gets the owner role.
  const isFirstUser = Number(userCount.count) === 0;

  // Resolve the box registration policy (Block F) before any expensive work.
  // ADR-188 F1: the effective policy layers the owner's runtime `_app_settings.registration`
  // blob (Settings toggle) over the env preset, so a saved `default_role`/`signup_mode` takes
  // effect without a redeploy. Async, but registerUser is already async — no hot-path change.
  const policy = await getEffectiveRegistrationPolicy();

  // ADR-183 Block F4 (enforce) — signup_mode gate at the anonymous front door.
  // `open` (standard/community presets): anyone may self-register — unchanged.
  // `invite`: only a sign-up carrying a VALID inviter code (referredBy resolved) passes.
  // `closed`: nobody self-registers. The first user (owner bootstrap) ALWAYS passes,
  // else a box shipping a non-open default (incl. SAFE_FALLBACK='invite') could never
  // provision its owner. Reject BEFORE bcrypt so a closed door can't be a hash-DoS.
  if (!isFirstUser && policy.signup_mode !== 'open') {
    const invited = policy.signup_mode === 'invite' && referredBy != null;
    if (!invited) {
      const err = new Error(
        policy.signup_mode === 'invite'
          ? 'Registration is invite-only'
          : 'Registration is currently closed'
      );
      err.code = 'REGISTRATION_NOT_ALLOWED';
      throw err;
    }
  }

  // Hash password
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  // Generate and encrypt personal key
  const personalKey = generatePersonalKey();
  const encryption_key_encrypted = encryptPersonalKey(personalKey);
  // ADR-183 Block A + F3: the first user is always `owner`. A `community: true`
  // sign-up is always `viewer` (read-only, cannot create spaces — gate in
  // spaces/crud.js). Otherwise the role comes from the box's registration policy
  // (Block F) rather than a literal: on a standard box the instance default is
  // `user` (byte-identical to pre-F behaviour); on a community box
  // (REGISTRATION_DEFAULT=community) the front-door default is `viewer`, so even a
  // sign-up that omits `community=true` lands as `viewer` — the box policy is
  // authoritative, not client-elective (closes the Block C trust boundary).
  const role = isFirstUser ? 'owner' : (communitySignup ? 'viewer' : policy.default_role);

  // ADR-183 Block C: mint this newcomer's own referral_code (the code THEY hand out).
  // ADR-183-A D2: the code is `<name-slug>-<suffix>`; the name-prefix is frozen at mint.
  const referralCode = await mintUniqueReferralCode(name);

  // Insert user
  const result = await dbRun(`
    INSERT INTO users (email, password_hash, name, encryption_key_encrypted, role, referral_code, referred_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [email, password_hash, name, encryption_key_encrypted, role, referralCode, referredBy]);

  // Return user data (without sensitive info)
  const userId = result.lastInsertRowid;
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  
  // Auto-create default projects
  await autoCreateDefaultProjects(user.id, user.name);

  // ADR-0079: provision Personal Space Starter Pack (6 tables + Welcome widget + Tor first-message).
  // Best-effort — registration must not fail because of cosmetics.
  await applyStarterPack(user.id, user.name);

  // ADR-198 D6: give the newcomer their own mailbox (mail_boxes row + Maildir + a
  // connector in their personal space). Same best-effort contract as the starter pack,
  // and AC-7 states it outright: a disabled kill-switch, a missing substrate or a dead
  // dovecot must not fail a registration. Imported lazily — provisionMailbox reaches
  // back into this module for referralPrefix.
  try {
    const { provisionMailbox } = await import('./mail/provisionMailbox.js');
    await provisionMailbox({ userId: user.id, reason: 'registration' });
  } catch (err) {
    authLogger.warn({ err, userId: user.id }, '[ADR-198] mailbox provisioning failed (non-fatal)');
  }

  return user;
}

/**
 * Login user
 * @param {string} email - User email
 * @param {string} password - Password
 * @param {string} ipAddress - IP address (optional)
 * @param {string} userAgent - User agent (optional)
 * @returns {object} { success, user?, token?, error? }
 */
export async function loginUser(email, password, ipAddress = null, userAgent = null) {
  // Find user
  const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
  
  if (!user) {
    // Log failed login attempt
    await dbRun(`
      INSERT INTO audit_log (user_id, action, entity_type, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [null, 'login_failed', 'user', JSON.stringify({ email, reason: 'user_not_found' }), ipAddress, userAgent]);
    
    return { success: false, error: 'Invalid email or password' };
  }

  // Verify password
  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  
  if (!passwordMatch) {
    // Log failed login attempt
    await dbRun(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [user.id, 'login_failed', 'user', user.id.toString(), JSON.stringify({ email, reason: 'wrong_password' }), ipAddress, userAgent]);
    
    return { success: false, error: 'Invalid email or password' };
  }

  // Log successful login
  await dbRun(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [user.id, 'login_success', 'user', user.id.toString(), JSON.stringify({ email }), ipAddress, userAgent]);

  // Check if user has Personal Space - if not, create default projects/spaces
  const personalSpace = await dbGet('SELECT id FROM spaces WHERE owner_id = ? AND type = ?', [user.id, 'personal']);
  if (!personalSpace) {
    authLogger.info({ userId: user.id }, 'First login - creating default spaces and projects');
    await autoCreateDefaultProjects(user.id, user.name);
  }

  // Generate JWT token
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30m' }
  );

  // Remove sensitive data
  delete user.password_hash;
  delete user.encryption_key_encrypted;

  return {
    success: true,
    user,
    token
  };
}

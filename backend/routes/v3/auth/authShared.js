/**
 * Shared utilities, constants, and middleware for auth routes.
 * All sub-modules import from here to avoid duplication.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import CryptoJS from 'crypto-js';
import { dbGet, dbRun, dbAll } from '../../../database/connection.js';
import { authLogger } from '../../../utils/logger.js';
import { success as _success, error as _error } from '../../../utils/response.js';

// ---------------------------------------------------------------------------
// Response adapters
// ---------------------------------------------------------------------------
export const respondSuccess = (res, data, status = 200) => _success(res, data, status);
export const respondError = (res, status, code, message, details) => _error(res, code, message, status, details);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));

authLogger.debug('Auth module loaded');

export const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';
export const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'godcrm_refresh';
export const ACCESS_TOKEN_TTL = process.env.JWT_EXPIRES_IN || '7d';
export const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || JWT_SECRET;

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------
export const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || process.env.PORT === '5001', // DEV server uses HTTPS
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  // ADR-176: opt-in cross-subdomain SSO. Set COOKIE_DOMAIN=.godcrm.ai on the
  // edit/dev boxes so a session issued on any *.godcrm.ai subdomain (app/dev)
  // is sent to the embed iframe on edit.godcrm.ai. Unset (Ring 0) => host-only,
  // byte-identical to before => no auth-surface broadening on prod.
  domain: process.env.COOKIE_DOMAIN || undefined,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  path: '/'
});

// ADR-0016: Authenticated /uploads requires that <img src> requests carry
// auth automatically. Bearer-from-localStorage doesn't work for <img>, so
// we set a parallel httpOnly access_token cookie that the auth middleware
// already accepts (see backend/middleware/auth.js — req.cookies.access_token).
export const ACCESS_COOKIE_NAME = 'access_token';
export const getAccessCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || process.env.PORT === '5001',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  // ADR-176: opt-in cross-subdomain SSO — see getRefreshCookieOptions above.
  domain: process.env.COOKIE_DOMAIN || undefined,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days — matches default ACCESS_TOKEN_TTL ('7d')
  path: '/'
});

export const createAccessToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

export const createRefreshToken = (user) =>
  jwt.sign(
    { id: user.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );

// ---------------------------------------------------------------------------
// Middleware: Require authentication
// ---------------------------------------------------------------------------
export const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return respondError(res, 401, 'AUTH_REQUIRED', 'Authorization token is missing');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return respondError(res, 401, 'INVALID_TOKEN', 'Access token is invalid or expired');
  }
};

// ---------------------------------------------------------------------------
// Google OAuth config helpers
// ---------------------------------------------------------------------------
const GOOGLE_OAUTH_CONFIG_FILE = path.join(__dirname, '../../../google-oauth-config.json');

export function encrypt(text) {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

export function decrypt(ciphertext) {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return ciphertext;
  }
}

export function loadGoogleOAuthConfig() {
  try {
    if (fs.existsSync(GOOGLE_OAUTH_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(GOOGLE_OAUTH_CONFIG_FILE, 'utf8'));
      if (config.clientSecret && config.clientSecret.startsWith('U2F')) {
        config.clientSecret = decrypt(config.clientSecret);
      }
      return config;
    }
  } catch (error) {
    authLogger.error({ err: error }, 'Error loading Google OAuth config:', error);
  }
  return {
    clientId: '',
    clientSecret: '',
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://crm.hltrn.cc/auth/google/callback',
    enabled: false
  };
}

export function saveGoogleOAuthConfig(config) {
  try {
    const configToSave = { ...config };
    if (configToSave.clientSecret) {
      configToSave.clientSecret = encrypt(configToSave.clientSecret);
    }
    fs.writeFileSync(GOOGLE_OAUTH_CONFIG_FILE, JSON.stringify(configToSave, null, 2));
    return true;
  } catch (error) {
    authLogger.error({ err: error }, 'Error saving Google OAuth config:', error);
    return false;
  }
}

// Dynamic redirect_uri based on request Host header
// Allows same backend to work for both crm.hltrn.cc and devcrm.hltrn.cc
export function getDynamicRedirectUri(req, googleOAuthConfig) {
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('host');
  if (host) {
    return `${proto}://${host}/auth/google/callback`;
  }
  // Fallback to config if no host header
  return googleOAuthConfig.redirectUri;
}

// Mutable Google OAuth config singleton
export let googleOAuthConfig = loadGoogleOAuthConfig();

export function setGoogleOAuthConfig(config) {
  googleOAuthConfig = config;
}

authLogger.info(' Google OAuth enabled:', googleOAuthConfig.enabled);

// Re-export database helpers and logger for sub-modules
export { dbGet, dbRun, dbAll, authLogger, jwt };

// ---------------------------------------------------------------------------
// Telegram OAuth config helpers (ADR-0078) — mirror of Google
// ---------------------------------------------------------------------------
const TELEGRAM_OAUTH_CONFIG_FILE = path.join(__dirname, '../../../telegram-oauth-config.json');

export function loadTelegramOAuthConfig() {
  try {
    if (fs.existsSync(TELEGRAM_OAUTH_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(TELEGRAM_OAUTH_CONFIG_FILE, 'utf8'));
      if (config.clientSecret && config.clientSecret.startsWith('U2F')) {
        config.clientSecret = decrypt(config.clientSecret);
      }
      return config;
    }
  } catch (error) {
    authLogger.error({ err: error }, 'Error loading Telegram OAuth config');
  }
  return {
    clientId: process.env.TELEGRAM_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.TELEGRAM_OAUTH_CLIENT_SECRET || '',
    redirectUri: process.env.TELEGRAM_OAUTH_REDIRECT_URI || 'https://crm.hltrn.cc/auth/telegram/callback',
    enabled: !!(process.env.TELEGRAM_OAUTH_CLIENT_ID && process.env.TELEGRAM_OAUTH_CLIENT_SECRET)
  };
}

export function saveTelegramOAuthConfig(config) {
  try {
    const configToSave = { ...config };
    if (configToSave.clientSecret) {
      configToSave.clientSecret = encrypt(configToSave.clientSecret);
    }
    fs.writeFileSync(TELEGRAM_OAUTH_CONFIG_FILE, JSON.stringify(configToSave, null, 2));
    return true;
  } catch (error) {
    authLogger.error({ err: error }, 'Error saving Telegram OAuth config');
    return false;
  }
}

export let telegramOAuthConfig = loadTelegramOAuthConfig();
export function setTelegramOAuthConfig(config) { telegramOAuthConfig = config; }

authLogger.info(' Telegram OAuth enabled:', telegramOAuthConfig.enabled);

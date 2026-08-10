/**
 * Google Calendar — Helpers & Config
 *
 * File I/O, encryption, token storage utilities
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import CryptoJS from 'crypto-js';
import { apiLogger } from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Calendar uses its own OAuth client (separate from login OAuth)
const CALENDAR_CONFIG_PATH = path.resolve(__dirname, '../../google-calendar-config.json');
const FALLBACK_CONFIG_PATH = path.resolve(__dirname, '../../google-oauth-config.json');
const CONFIG_PATH = fs.existsSync(CALENDAR_CONFIG_PATH) ? CALENDAR_CONFIG_PATH : FALLBACK_CONFIG_PATH;
const TOKENS_PATH = path.resolve(__dirname, '../../google-calendar-tokens.json');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';

export function generateBaseId() {
  return `gcal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function encrypt(text) {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_KEY).toString();
}

export function decrypt(ciphertext) {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

export function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);

    let clientSecret = config.clientSecret;
    // If secret looks encrypted (starts with "U2F"), decrypt it
    if (clientSecret && clientSecret.startsWith('U2F')) {
      clientSecret = decrypt(clientSecret);
    }

    return {
      clientId: config.clientId,
      clientSecret,
      redirectUri: config.redirectUri,
      enabled: config.enabled,
    };
  } catch (err) {
    apiLogger.error('Failed to load Google OAuth config', err);
    return null;
  }
}

export function loadTokens() {
  try {
    if (!fs.existsSync(TOKENS_PATH)) {
      return {};
    }
    const raw = fs.readFileSync(TOKENS_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    apiLogger.error('Failed to load Google Calendar tokens', err);
    return {};
  }
}

export function saveTokens(tokens) {
  try {
    fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
  } catch (err) {
    apiLogger.error('Failed to save Google Calendar tokens', err);
  }
}

export function getUserTokens(userId) {
  const tokens = loadTokens();
  const key = `user_${userId}`;
  return tokens[key] || null;
}

export function setUserTokens(userId, data) {
  const tokens = loadTokens();
  const key = `user_${userId}`;
  tokens[key] = data;
  saveTokens(tokens);
}

export function removeUserTokens(userId) {
  const tokens = loadTokens();
  const key = `user_${userId}`;
  delete tokens[key];
  saveTokens(tokens);
}

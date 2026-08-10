// backend/routes/v3/telegram/userRegistry.js
// Multi-user registry: file-backed user management for Telegram bot
// Roles: "admin" (can /adduser, /removeuser), "partner" (full bot access), "viewer" (read-only)
// Root admin (from env) is ALWAYS authorized regardless of file contents.

import fs from 'fs';
import path from 'path';
import { apiLogger } from './shared.js';

const USERS_FILE = path.resolve(process.cwd(), 'data', 'telegram-users.json');
const ROOT_ADMIN_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || '423753027');

/** @type {Map<string, {name: string, role: string, crm_user_id: number|null, added_at: string, added_by?: string}>} */
const userRegistry = new Map();

function loadUserRegistry() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      for (const [id, info] of Object.entries(data)) {
        userRegistry.set(String(id), info);
      }
      apiLogger.info({ count: userRegistry.size }, '[Telegram] User registry loaded');
    }
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] Failed to load user registry');
  }

  // Ensure root admin is always registered
  if (!userRegistry.has(ROOT_ADMIN_ID)) {
    userRegistry.set(ROOT_ADMIN_ID, {
      name: 'GERATRON',
      role: 'admin',
      crm_user_id: 1,
      added_at: new Date().toISOString(),
    });
    saveUserRegistry();
  }
}

function saveUserRegistry() {
  try {
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(userRegistry);
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] Failed to save user registry');
  }
}

function isRegisteredUser(userId) {
  return userRegistry.has(String(userId));
}

function isAdmin(userId) {
  const id = String(userId);
  if (id === ROOT_ADMIN_ID) return true;
  const user = userRegistry.get(id);
  return user?.role === 'admin';
}

function getUserInfo(userId) {
  return userRegistry.get(String(userId)) || null;
}

function getUserDisplayName(userId) {
  const info = userRegistry.get(String(userId));
  return info?.name || 'Unknown';
}

// Load users on module init
loadUserRegistry();

export {
  USERS_FILE,
  ROOT_ADMIN_ID,
  userRegistry,
  loadUserRegistry,
  saveUserRegistry,
  isRegisteredUser,
  isAdmin,
  getUserInfo,
  getUserDisplayName,
};

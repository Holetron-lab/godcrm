// backend/routes/v3/telegramNikitron/userRegistry.js
// File-backed user registry: telegram_user_id → { name, role, crm_user_id, added_at, added_by }
// Shared registry file with main Telegram bot for consistency.

import fs from 'fs';
import path from 'path';
import { apiLogger } from '../../../utils/logger.js';

const NIKITRON_USERS_FILE = path.resolve(process.cwd(), 'data', 'nikitron-users.json');

/** @type {Map<string, {name: string, role: string, crm_user_id: number|null, added_at: string, added_by?: string}>} */
export const nikitronUserRegistry = new Map();

export function loadNikitronUserRegistry() {
  // First, load dedicated nikitron users file
  try {
    if (fs.existsSync(NIKITRON_USERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(NIKITRON_USERS_FILE, 'utf8'));
      for (const [id, info] of Object.entries(data)) {
        nikitronUserRegistry.set(String(id), info);
      }
      apiLogger.info({ count: nikitronUserRegistry.size }, '[NikitronBot] User registry loaded');
    }
  } catch (err) {
    apiLogger.error({ err }, '[NikitronBot] Failed to load user registry');
  }

  // Also try to load from shared telegram-users.json (main bot registry)
  try {
    const sharedFile = path.resolve(process.cwd(), 'data', 'telegram-users.json');
    if (fs.existsSync(sharedFile)) {
      const sharedData = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
      for (const [id, info] of Object.entries(sharedData)) {
        if (!nikitronUserRegistry.has(String(id))) {
          nikitronUserRegistry.set(String(id), info);
        }
      }
    }
  } catch (_) { /* ignore shared file errors */ }

  // Ensure both known users are always registered
  if (!nikitronUserRegistry.has('423753027')) {
    nikitronUserRegistry.set('423753027', {
      name: 'GERATRON',
      role: 'admin',
      crm_user_id: 1,
      added_at: new Date().toISOString(),
    });
  }
  if (!nikitronUserRegistry.has('331468767')) {
    nikitronUserRegistry.set('331468767', {
      name: 'Nikich',
      role: 'admin',
      crm_user_id: 7, // NIKITRON user in CRM (nikitron2392@gmail.com)
      added_at: new Date().toISOString(),
    });
  }

  saveNikitronUserRegistry();
}

export function saveNikitronUserRegistry() {
  try {
    const dir = path.dirname(NIKITRON_USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = Object.fromEntries(nikitronUserRegistry);
    fs.writeFileSync(NIKITRON_USERS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    apiLogger.error({ err }, '[NikitronBot] Failed to save user registry');
  }
}

export function getNikitronUserInfo(userId) {
  return nikitronUserRegistry.get(String(userId)) || null;
}

export function getNikitronUserDisplayName(userId) {
  const info = nikitronUserRegistry.get(String(userId));
  return info?.name || 'Unknown';
}

// Load users on module init
loadNikitronUserRegistry();

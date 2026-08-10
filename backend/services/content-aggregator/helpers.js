// backend/services/content-aggregator/helpers.js
// Shared utility functions for Content Aggregation Service

import { apiLogger } from '../../utils/logger.js';
import { CRM_API_BASE, AI_KEYWORDS } from './config.js';

export const log = apiLogger.child({ module: 'content-aggregator' });

/**
 * Check if text contains any AI-related keywords
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function matchesAIKeywords(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Truncate text to a max length with ellipsis
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(text, maxLen = 500) {
  if (!text) return '';
  const clean = text.replace(/<[^>]*>/g, '').trim(); // strip HTML
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + '...';
}

/**
 * Fetch JSON with timeout and error handling
 * @param {string} url
 * @param {object} options - fetch options
 * @param {number} timeoutMs - timeout in ms (default 15s)
 * @returns {Promise<any>}
 */
export async function fetchJSON(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get auth token for CRM API by logging in
 * Uses environment variables for credentials
 * @returns {Promise<string|null>} JWT token or null
 */
export async function getCRMAuthToken() {
  const email = process.env.CRM_ADMIN_EMAIL || 'gera@hltrn.cc';
  const password = process.env.CRM_ADMIN_PASSWORD;

  if (!password) {
    log.warn('CRM_ADMIN_PASSWORD not set - will try without auth');
    return null;
  }

  try {
    const resp = await fetchJSON(`${CRM_API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    return resp?.data?.token || resp?.token || null;
  } catch (err) {
    log.error({ err: err.message }, 'Failed to get CRM auth token');
    return null;
  }
}

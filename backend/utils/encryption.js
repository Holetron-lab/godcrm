// backend/utils/encryption.js
// ADR-064 Phase 1, Task 5: AES-256-GCM Encryption for Data Source Credentials
// Created: 2026-01-31

import crypto from 'crypto';
import { logger } from './logger.js';

const encryptionLogger = logger.child({ module: 'encryption' });

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
const KEY_LENGTH = 32; // 256 bits for AES-256

// Fallback key for development only - logged as warning
const DEV_FALLBACK_KEY = 'DEV_ONLY_FALLBACK_KEY_NOT_SECURE';

/**
 * Get the master encryption key from environment.
 * In production: throws if MASTER_ENCRYPTION_KEY is not set.
 * In development/test: warns and uses a fallback key.
 * @returns {Buffer} 32-byte key buffer
 */
function getMasterKey() {
  const rawKey = process.env.MASTER_ENCRYPTION_KEY;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!rawKey) {
    if (isProduction) {
      throw new Error(
        'MASTER_ENCRYPTION_KEY must be set in environment for production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }

    // Dev/test: warn and use fallback
    encryptionLogger.warn(
      'MASTER_ENCRYPTION_KEY is not set. Using insecure fallback key. ' +
      'Set MASTER_ENCRYPTION_KEY in your .env file for proper security.'
    );

    return Buffer.from(DEV_FALLBACK_KEY.padEnd(KEY_LENGTH, '0').slice(0, KEY_LENGTH), 'utf8');
  }

  // Normalize key to exactly 32 bytes
  // If hex-encoded (64 chars), decode as hex; otherwise pad/slice UTF-8
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  return Buffer.from(rawKey.padEnd(KEY_LENGTH, '0').slice(0, KEY_LENGTH), 'utf8');
}

/**
 * Encrypt a credential string using AES-256-GCM.
 * Uses a unique random IV for each encryption.
 *
 * @param {string} plaintext - The credential to encrypt (e.g., database password)
 * @returns {string} Encrypted string in format: iv:authTag:ciphertext (all hex-encoded)
 */
export function encryptCredential(plaintext) {
  // Allow empty string (some DBs use root without password)
  if (plaintext === null || plaintext === undefined) {
    throw new Error('Cannot encrypt null or undefined value');
  }

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a credential string encrypted with encryptCredential.
 *
 * @param {string} encryptedString - Encrypted string in format: iv:authTag:ciphertext
 * @returns {string} Decrypted plaintext credential
 * @throws {Error} If the format is invalid, key is wrong, or data was tampered with
 */
export function decryptCredential(encryptedString) {
  if (!encryptedString || typeof encryptedString !== 'string') {
    throw new Error('Invalid encrypted string: must be a non-empty string');
  }

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  // Validate hex format
  if (!/^[0-9a-fA-F]+$/.test(ivHex) || !/^[0-9a-fA-F]+$/.test(authTagHex)) {
    throw new Error('Invalid encrypted format: IV and authTag must be hex-encoded');
  }

  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a string appears to be encrypted by this module.
 * Validates the iv:authTag:ciphertext format.
 *
 * @param {string} value - String to check
 * @returns {boolean} True if the string matches the encrypted format
 */
export function isEncrypted(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const parts = value.split(':');
  if (parts.length !== 3) {
    return false;
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  // IV should be IV_LENGTH bytes = IV_LENGTH*2 hex chars
  if (ivHex.length !== IV_LENGTH * 2) {
    return false;
  }

  // Auth tag should be AUTH_TAG_LENGTH bytes = AUTH_TAG_LENGTH*2 hex chars
  if (authTagHex.length !== AUTH_TAG_LENGTH * 2) {
    return false;
  }

  // All parts should be hex
  return /^[0-9a-fA-F]+$/.test(ivHex) &&
    /^[0-9a-fA-F]+$/.test(authTagHex) &&
    /^[0-9a-fA-F]*$/.test(ciphertext); // ciphertext can be empty for empty string
}

/**
 * Remove sensitive credential fields from a data source object
 * before returning it in API responses.
 *
 * @param {Object} dataSource - Data source object from database
 * @returns {Object} Sanitized data source safe for API response
 */
export function sanitizeCredentialsForResponse(dataSource) {
  if (!dataSource) return dataSource;

  // Create a shallow copy to avoid mutating the original
  const sanitized = { ...dataSource };

  // Track if a password was set
  const hasPassword = Boolean(
    sanitized.db_password_encrypted ||
    sanitized.db_password_key
  );

  // Remove sensitive fields
  delete sanitized.db_password_encrypted;
  delete sanitized.db_password_key;
  delete sanitized.ssh_private_key;
  delete sanitized.ssh_key_name;

  // Add indicator for UI
  sanitized.has_password = hasPassword;

  return sanitized;
}

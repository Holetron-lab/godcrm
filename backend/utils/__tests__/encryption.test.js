// RED Phase: Tests for Data Source Credential Encryption (ADR-064, Task 5)
// TDD: Write tests FIRST, then implement

// Set test env BEFORE imports
process.env.TEST_MODE = 'true';
process.env.NODE_ENV = 'test';

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// We will test the encryption module at backend/utils/encryption.js
// Tests written BEFORE implementation (TDD Red Phase)

describe('Data Source Credential Encryption (ADR-064)', () => {
  // Store original env
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('encryptCredential', () => {
    beforeEach(() => {
      // Set a valid 32-byte hex key for AES-256
      process.env.MASTER_ENCRYPTION_KEY = 'a]3Fj9$kL2mN7pQ4rS6tU8vW0xY1zA5b';
    });

    test('should encrypt password before storing in DB', async () => {
      const { encryptCredential } = await import('../encryption.js');

      const plainPassword = 'my_super_secret_db_password';
      const encrypted = encryptCredential(plainPassword);

      // Encrypted result should not equal the plain password
      expect(encrypted).not.toBe(plainPassword);
      // Encrypted result should be a non-empty string
      expect(typeof encrypted).toBe('string');
      expect(encrypted.length).toBeGreaterThan(0);
      // Should contain the iv:authTag:ciphertext format
      expect(encrypted.split(':')).toHaveLength(3);
    });

    test('should decrypt password when establishing connection', async () => {
      const { encryptCredential, decryptCredential } = await import('../encryption.js');

      const plainPassword = 'my_super_secret_db_password';
      const encrypted = encryptCredential(plainPassword);
      const decrypted = decryptCredential(encrypted);

      expect(decrypted).toBe(plainPassword);
    });

    test('should use AES-256-GCM with unique IV per credential', async () => {
      const { encryptCredential } = await import('../encryption.js');

      const plainPassword = 'same_password_encrypted_twice';

      // Encrypt the same password twice
      const encrypted1 = encryptCredential(plainPassword);
      const encrypted2 = encryptCredential(plainPassword);

      // Different ciphertext each time (unique IV)
      expect(encrypted1).not.toBe(encrypted2);

      // Extract IVs - they should be different
      const iv1 = encrypted1.split(':')[0];
      const iv2 = encrypted2.split(':')[0];
      expect(iv1).not.toBe(iv2);
    });

    test('should correctly round-trip various password types', async () => {
      const { encryptCredential, decryptCredential } = await import('../encryption.js');

      const passwords = [
        'simple',
        'P@$$w0rd!#%^&*()',
        'пароль-кириллица',
        '密码中文',
        'a'.repeat(1000), // long password
        '', // empty password (some DBs allow root with no password)
      ];

      for (const pwd of passwords) {
        const encrypted = encryptCredential(pwd);
        const decrypted = decryptCredential(encrypted);
        expect(decrypted).toBe(pwd);
      }
    });

    test('should reject tampered ciphertext', async () => {
      const { encryptCredential, decryptCredential } = await import('../encryption.js');

      const encrypted = encryptCredential('test_password');
      // Tamper with the ciphertext portion
      const parts = encrypted.split(':');
      parts[2] = parts[2].slice(0, -2) + 'ff'; // change last byte
      const tampered = parts.join(':');

      expect(() => decryptCredential(tampered)).toThrow();
    });

    test('should reject invalid encrypted format', async () => {
      const { decryptCredential } = await import('../encryption.js');

      expect(() => decryptCredential('not-a-valid-format')).toThrow();
      expect(() => decryptCredential('')).toThrow();
      expect(() => decryptCredential(null)).toThrow();
      expect(() => decryptCredential(undefined)).toThrow();
    });
  });

  describe('missing MASTER_ENCRYPTION_KEY handling', () => {
    test('should handle missing MASTER_ENCRYPTION_KEY gracefully in dev', async () => {
      // Remove key and set dev env
      delete process.env.MASTER_ENCRYPTION_KEY;
      process.env.NODE_ENV = 'development';

      // Re-import to get fresh module
      // Use dynamic import with cache busting
      const modulePath = '../encryption.js';
      const mod = await import(modulePath + '?dev_test=' + Date.now());

      // In dev, should warn but not throw, using fallback
      const result = mod.encryptCredential('test_password');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');

      // Should still be able to decrypt
      const decrypted = mod.decryptCredential(result);
      expect(decrypted).toBe('test_password');
    });

    test('should throw error for missing MASTER_ENCRYPTION_KEY in production', async () => {
      delete process.env.MASTER_ENCRYPTION_KEY;
      process.env.NODE_ENV = 'production';

      const mod = await import('../encryption.js?prod_test=' + Date.now());

      expect(() => mod.encryptCredential('test_password')).toThrow(/MASTER_ENCRYPTION_KEY/);
    });
  });

  describe('sanitizeCredentialsForResponse', () => {
    beforeEach(() => {
      process.env.MASTER_ENCRYPTION_KEY = 'a]3Fj9$kL2mN7pQ4rS6tU8vW0xY1zA5b';
    });

    test('should never return decrypted password in API response', async () => {
      const { sanitizeCredentialsForResponse, encryptCredential } = await import('../encryption.js');

      const encryptedPassword = encryptCredential('secret_db_password');

      const dataSource = {
        id: 'ds_abc123',
        name: 'My Database',
        db_host: 'localhost',
        db_port: 3306,
        db_username: 'root',
        db_password_encrypted: encryptedPassword,
        db_password_key: 'some_key',
        ssh_private_key: 'some_ssh_key',
        type: 'local_mysql'
      };

      const sanitized = sanitizeCredentialsForResponse(dataSource);

      // Encrypted password field should be removed or masked
      expect(sanitized.db_password_encrypted).toBeUndefined();
      // Password key reference should be removed
      expect(sanitized.db_password_key).toBeUndefined();
      // SSH private key should be removed
      expect(sanitized.ssh_private_key).toBeUndefined();
      // Non-sensitive fields should remain
      expect(sanitized.id).toBe('ds_abc123');
      expect(sanitized.name).toBe('My Database');
      expect(sanitized.db_host).toBe('localhost');
      expect(sanitized.db_username).toBe('root');
      // Has password indicator
      expect(sanitized.has_password).toBe(true);
    });

    test('should indicate when no password is set', async () => {
      const { sanitizeCredentialsForResponse } = await import('../encryption.js');

      const dataSource = {
        id: 'ds_abc123',
        name: 'My Database',
        db_password_encrypted: null,
      };

      const sanitized = sanitizeCredentialsForResponse(dataSource);
      expect(sanitized.has_password).toBe(false);
    });
  });

  describe('isEncrypted', () => {
    beforeEach(() => {
      process.env.MASTER_ENCRYPTION_KEY = 'a]3Fj9$kL2mN7pQ4rS6tU8vW0xY1zA5b';
    });

    test('should detect encrypted vs plain text', async () => {
      const { encryptCredential, isEncrypted } = await import('../encryption.js');

      const encrypted = encryptCredential('password123');

      expect(isEncrypted(encrypted)).toBe(true);
      expect(isEncrypted('plain_text_password')).toBe(false);
      expect(isEncrypted('')).toBe(false);
      expect(isEncrypted(null)).toBe(false);
    });
  });
});

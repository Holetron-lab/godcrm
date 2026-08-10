// Authentication & Encryption Service Tests

// Set env BEFORE importing service
process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test_master_key_32_characters_long!';

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { 
  registerUser, 
  loginUser, 
  generatePersonalKey,
  encryptPersonalKey,
  decryptPersonalKey
} from '../services/AuthService.js';

describe.skip('Authentication Service', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  // Test 2.1: Register user with encryption key
  test('should register user with encrypted personal key', async () => {
    const userData = {
      email: 'test@example.com',
      password: 'SecurePass123!',
      name: 'Test User'
    };

    const user = await registerUser(userData);

    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    expect(user.password_hash).toBeDefined();
    expect(user.password_hash).not.toBe('SecurePass123!'); // Should be hashed
    expect(user.encryption_key_encrypted).toBeDefined();
    expect(user.encryption_key_encrypted.length).toBeGreaterThan(0);
  });

  // Test 2.2: Login user with correct password
  test('should login user with correct credentials', async () => {
    const userData = {
      email: 'login@test.com',
      password: 'MyPassword123',
      name: 'Login User'
    };

    await registerUser(userData);

    const result = await loginUser('login@test.com', 'MyPassword123');

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe('login@test.com');
    expect(result.token).toBeDefined(); // JWT token
  });

  // Test 2.3: Reject login with wrong password
  test('should reject login with wrong password', async () => {
    const userData = {
      email: 'secure@test.com',
      password: 'CorrectPassword',
      name: 'Secure User'
    };

    await registerUser(userData);

    const result = await loginUser('secure@test.com', 'WrongPassword');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  // Test 2.4: Generate unique personal encryption keys
  test('should generate unique personal keys for each user', async () => {
    const key1 = generatePersonalKey();
    const key2 = generatePersonalKey();

    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
    expect(key1).not.toBe(key2);
    expect(key1.length).toBeGreaterThan(32); // Strong key
  });
});

describe.skip('Encryption Service', () => {
  // Test 2.5: Encrypt and decrypt personal key
  test('should encrypt and decrypt personal key correctly', () => {
    const personalKey = generatePersonalKey();
    
    const encrypted = encryptPersonalKey(personalKey);
    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(personalKey);

    const decrypted = decryptPersonalKey(encrypted);
    expect(decrypted).toBe(personalKey);
  });

  // Test 2.6: Different encryption each time (IV)
  test('should produce different ciphertext each time', () => {
    const personalKey = generatePersonalKey();
    
    const encrypted1 = encryptPersonalKey(personalKey);
    const encrypted2 = encryptPersonalKey(personalKey);

    // Different ciphertext (due to random IV)
    expect(encrypted1).not.toBe(encrypted2);

    // But decrypt to same value
    expect(decryptPersonalKey(encrypted1)).toBe(personalKey);
    expect(decryptPersonalKey(encrypted2)).toBe(personalKey);
  });
});

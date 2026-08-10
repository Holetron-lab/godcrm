// Authentication Service - v0.002.006
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { dbRun, dbGet } from '../database/connection.js';
import { autoCreateDefaultProjects } from './ProjectService.js';
import { applyStarterPack } from './starter-pack/StarterPackService.js';
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

/**
 * Register a new user
 * @param {object} userData - { email, password, name }
 * @returns {object} Created user
 */
export async function registerUser(userData) {
  const { email, password, name } = userData;

  // Check if user exists
  const existingUser = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  // Hash password
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  // Generate and encrypt personal key
  const personalKey = generatePersonalKey();
  const encryption_key_encrypted = encryptPersonalKey(personalKey);

  // Check if this is the first user (owner)
  const userCount = await dbGet('SELECT COUNT(*) as count FROM users', []);
  // Postgres COUNT(*) comes back as a string ("0"), so coerce before comparing —
  // otherwise the first user on a fresh install never gets the owner role.
  const isFirstUser = Number(userCount.count) === 0;
  const role = isFirstUser ? 'owner' : 'user';

  // Insert user
  const result = await dbRun(`
    INSERT INTO users (email, password_hash, name, encryption_key_encrypted, role)
    VALUES (?, ?, ?, ?, ?)
  `, [email, password_hash, name, encryption_key_encrypted, role]);

  // Return user data (without sensitive info)
  const userId = result.lastInsertRowid;
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  
  // Auto-create default projects
  await autoCreateDefaultProjects(user.id, user.name);

  // ADR-0079: provision Personal Space Starter Pack (6 tables + Welcome widget + Tor first-message).
  // Best-effort — registration must not fail because of cosmetics.
  await applyStarterPack(user.id, user.name);

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

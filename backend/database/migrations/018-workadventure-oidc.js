/**
 * Migration 018: WorkAdventure OIDC Integration
 * ADR-063: WorkAdventure Integration
 * 
 * Creates tables for:
 * - OIDC clients (for WorkAdventure and other OAuth clients)
 * - OIDC authorization codes (temporary codes for OAuth flow)
 * - OIDC access tokens (for userinfo endpoint)
 * - WA presence tracking (user location in virtual office)
 */

import { dbRun, dbGet } from '../connection.js';
import { logger } from '../../utils/logger.js';

export async function runMigration() {
  logger.info('📦 Running Migration 018: WorkAdventure OIDC Integration...');

  // 1. OIDC Clients table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS oidc_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      allowed_scopes TEXT DEFAULT '["openid", "profile", "email"]',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  logger.info('  ✅ Created table: oidc_clients');

  // 2. OIDC Authorization Codes table (temporary, short-lived)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS oidc_auth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      redirect_uri TEXT NOT NULL,
      scope TEXT NOT NULL,
      state TEXT,
      nonce TEXT,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  logger.info('  ✅ Created table: oidc_auth_codes');

  // 3. OIDC Access Tokens table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS oidc_access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT UNIQUE NOT NULL,
      client_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      scope TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  logger.info('  ✅ Created table: oidc_access_tokens');

  // 4. WorkAdventure Presence table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS wa_presence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      status TEXT DEFAULT 'online',
      position_x INTEGER,
      position_y INTEGER,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      left_at DATETIME,
      last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  logger.info('  ✅ Created table: wa_presence');

  // 5. WorkAdventure Room Access Rules table
  await dbRun(`
    CREATE TABLE IF NOT EXISTS wa_room_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_pattern TEXT NOT NULL,
      required_role TEXT,
      required_tags TEXT,
      is_public INTEGER DEFAULT 1,
      map_url TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  logger.info('  ✅ Created table: wa_room_access');

  // Create indexes for performance
  await dbRun('CREATE INDEX IF NOT EXISTS idx_oidc_auth_codes_code ON oidc_auth_codes(code)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_oidc_auth_codes_expires ON oidc_auth_codes(expires_at)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_oidc_access_tokens_hash ON oidc_access_tokens(token_hash)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_oidc_access_tokens_expires ON oidc_access_tokens(expires_at)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_wa_presence_user ON wa_presence(user_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_wa_presence_room ON wa_presence(room_id)');
  await dbRun('CREATE INDEX IF NOT EXISTS idx_wa_presence_status ON wa_presence(status)');
  logger.info('  ✅ Created indexes');

  // Seed default room access rules
  const existingRules = await dbGet('SELECT COUNT(*) as count FROM wa_room_access');
  if (!existingRules || existingRules.count === 0) {
    // Public lobby - everyone can access
    await dbRun(`
      INSERT INTO wa_room_access (room_pattern, is_public, description, map_url)
      VALUES (?, ?, ?, ?)
    `, ['@/crm/public/*', 1, 'Public areas accessible to all users', '/maps/public/lobby.json']);

    // Office areas - all authenticated users
    await dbRun(`
      INSERT INTO wa_room_access (room_pattern, is_public, required_role, description, map_url)
      VALUES (?, ?, ?, ?, ?)
    `, ['@/crm/office/*', 0, 'user', 'Office areas for authenticated users', '/maps/office/main.json']);

    // Admin areas - admin role required
    await dbRun(`
      INSERT INTO wa_room_access (room_pattern, is_public, required_role, description, map_url)
      VALUES (?, ?, ?, ?, ?)
    `, ['@/crm/admin/*', 0, 'admin', 'Admin-only areas', '/maps/admin/control-room.json']);

    logger.info('  ✅ Seeded default room access rules');
  }

  logger.info('✅ Migration 018 completed successfully!');
}

export default { runMigration };

// backend/routes/v3/telegramNikitron/crmHelpers.js
// CRM helpers: user resolution, agent resolution, session management, conversation creation

import { apiLogger } from '../../../utils/logger.js';
import { dbRun, dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import ChainHandoffService from '../../../services/ChainHandoffService.js';
import {
  NIKITRON_ROOT_ADMIN_ID,
  activeSessions, crmUserIdCache,
} from './config.js';
import { nikitronUserRegistry, saveNikitronUserRegistry } from './userRegistry.js';

// ===== CRM USER RESOLUTION =====

/**
 * Resolve the CRM user ID for a specific Telegram user.
 * Uses the crm_user_id from user registry, or creates/finds CRM user by name.
 * Per-user caching — each Telegram user gets their own CRM ID.
 */
export async function getCrmUserIdForTelegramUser(telegramUserId, userName) {
  const id = String(telegramUserId);

  // Check cache first (per-user cache, NOT singleton!)
  if (crmUserIdCache.has(id)) return crmUserIdCache.get(id);

  // Check user registry for explicit mapping
  const userInfo = nikitronUserRegistry.get(id);
  if (userInfo?.crm_user_id) {
    crmUserIdCache.set(id, userInfo.crm_user_id);
    return userInfo.crm_user_id;
  }

  // Try to find or create CRM user for this Telegram user
  try {
    const displayName = userName || userInfo?.name || 'Unknown';

    // First, check if a CRM user exists with this telegram_id in settings
    const existingUser = await dbGet(
      isPostgres()
        ? `SELECT id FROM users WHERE settings::text LIKE $1 LIMIT 1`
        : `SELECT id FROM users WHERE settings LIKE ? LIMIT 1`,
      [`%${id}%`]
    );

    if (existingUser) {
      crmUserIdCache.set(id, existingUser.id);
      // Update registry with found CRM user
      if (userInfo) {
        userInfo.crm_user_id = existingUser.id;
        saveNikitronUserRegistry();
      }
      apiLogger.info({ telegramUserId: id, crmUserId: existingUser.id }, '[NikitronBot] Resolved CRM user from DB');
      return existingUser.id;
    }

    // Fallback: first human user in DB
    const fallbackUser = await dbGet(
      `SELECT id FROM users WHERE user_type = 'human' ORDER BY id ASC LIMIT 1`
    );
    const crmId = fallbackUser?.id || 1;
    crmUserIdCache.set(id, crmId);
    apiLogger.info({ telegramUserId: id, crmUserId: crmId, fallback: true }, '[NikitronBot] Using fallback CRM user');
    return crmId;
  } catch (err) {
    apiLogger.error({ err, telegramUserId: id }, '[NikitronBot] Failed to resolve CRM user ID');
    return 1;
  }
}

// Legacy wrapper for backward compatibility (logs warning)
export async function getCrmUserId() {
  apiLogger.warn('[NikitronBot] getCrmUserId() called without telegramUserId — using fallback');
  return getCrmUserIdForTelegramUser(NIKITRON_ROOT_ADMIN_ID);
}

// ===== AGENT RESOLUTION =====

export async function resolveAgent(agentSlug) {
  if (!agentSlug) return null;
  const normalized = agentSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  try {
    const agentUser = await dbGet(
      isPostgres()
        ? `SELECT u.id as user_id, u.name, u.managed_by_agent_row_id as row_id
           FROM users u WHERE u.user_type = 'agent'
           AND LOWER(REPLACE(u.name, ' ', '-')) LIKE $1
           ORDER BY u.id ASC LIMIT 1`
        : `SELECT u.id as user_id, u.name, u.managed_by_agent_row_id as row_id
           FROM users u WHERE u.user_type = 'agent'
           AND LOWER(REPLACE(u.name, ' ', '-')) LIKE ?
           ORDER BY u.id ASC LIMIT 1`,
      [`%${normalized}%`]
    );
    if (agentUser) return { userId: agentUser.user_id, rowId: agentUser.row_id, name: agentUser.name };

    const crmId = ChainHandoffService.resolveAgentId(normalized);
    if (crmId) {
      const user = await dbGet(
        isPostgres()
          ? `SELECT id, name, managed_by_agent_row_id FROM users WHERE id = $1`
          : `SELECT id, name, managed_by_agent_row_id FROM users WHERE id = ?`,
        [crmId]
      );
      if (user) return { userId: user.id, rowId: user.managed_by_agent_row_id, name: user.name || normalized };
    }
    return null;
  } catch (err) {
    apiLogger.error({ err, agentSlug }, '[NikitronBot] Failed to resolve agent');
    return null;
  }
}

// ===== SESSION MANAGEMENT =====

export async function restoreSessionFromDb(chatId) {
  try {
    let conv = await dbGet(
      isPostgres()
        ? `SELECT c.id, c.title, c.created_at,
             (SELECT cp.user_id FROM conversation_participants cp
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent' LIMIT 1) as agent_user_id
           FROM conversations c
           WHERE c.settings::text LIKE '%"nikitron_chat_id":"' || $1 || '"%'
           ORDER BY c.updated_at DESC LIMIT 1`
        : `SELECT c.id, c.title, c.created_at,
             (SELECT cp.user_id FROM conversation_participants cp
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent' LIMIT 1) as agent_user_id
           FROM conversations c
           WHERE c.settings LIKE '%"nikitron_chat_id":"' || ? || '"%'
           ORDER BY c.updated_at DESC LIMIT 1`,
      [chatId]
    );

    // NOTE: Removed dangerous fallback that would match ANY NikitronBot conversation.
    // This caused cross-user chat leaks — one user could end up in another's chat.
    // If no session found for this specific chatId, return null (user must /newchat).

    if (!conv) return null;

    let agentName = 'Agent';
    let agentRowId = null;
    if (conv.agent_user_id) {
      const agentUser = await dbGet(
        isPostgres()
          ? `SELECT name, managed_by_agent_row_id FROM users WHERE id = $1`
          : `SELECT name, managed_by_agent_row_id FROM users WHERE id = ?`,
        [conv.agent_user_id]
      );
      if (agentUser) {
        agentName = agentUser.name || 'Agent';
        agentRowId = agentUser.managed_by_agent_row_id;
      }
    }

    const lastMsg = await dbGet(
      isPostgres()
        ? `SELECT id FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1`
        : `SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`,
      [conv.id]
    );

    const session = {
      conversationId: conv.id,
      agentUserId: conv.agent_user_id,
      agentName,
      agentRowId,
      lastPolledMessageId: lastMsg?.id || 0,
      createdAt: conv.created_at,
    };

    activeSessions.set(chatId, session);

    try {
      if (isPostgres()) {
        await dbRun(`
          UPDATE conversations
          SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2
            AND (settings IS NULL OR NOT settings::text LIKE '%nikitron_chat_id%')
        `, [JSON.stringify({ nikitron_chat_id: chatId }), conv.id]);
      }
    } catch (_) { /* non-critical */ }

    apiLogger.info({ chatId, conversationId: conv.id, agentName }, '[NikitronBot] Session restored from DB');
    return session;
  } catch (err) {
    apiLogger.error({ err, chatId }, '[NikitronBot] Failed to restore session');
    return null;
  }
}

export async function loadConversationSession(chatId, conversationId) {
  try {
    const conv = await dbGet(
      isPostgres()
        ? `SELECT c.id, c.title, c.created_at FROM conversations c WHERE c.id = $1`
        : `SELECT c.id, c.title, c.created_at FROM conversations c WHERE c.id = ?`,
      [conversationId]
    );
    if (!conv) return null;

    const agentParticipant = await dbGet(
      isPostgres()
        ? `SELECT cp.user_id, u.name, u.managed_by_agent_row_id
           FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = $1 AND cp.user_type = 'agent' LIMIT 1`
        : `SELECT cp.user_id, u.name, u.managed_by_agent_row_id
           FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ? AND cp.user_type = 'agent' LIMIT 1`,
      [conversationId]
    );

    const lastMsg = await dbGet(
      isPostgres()
        ? `SELECT id FROM messages WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1`
        : `SELECT id FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1`,
      [conversationId]
    );

    const session = {
      conversationId: conv.id,
      agentUserId: agentParticipant?.user_id || null,
      agentName: agentParticipant?.name || 'Unknown',
      agentRowId: agentParticipant?.managed_by_agent_row_id || null,
      lastPolledMessageId: lastMsg?.id || 0,
      createdAt: conv.created_at,
    };

    activeSessions.set(chatId, session);
    return session;
  } catch (err) {
    apiLogger.error({ err, chatId, conversationId }, '[NikitronBot] Failed to load conversation');
    return null;
  }
}

export async function listRecentChats(limit = 10) {
  try {
    return await dbAll(
      isPostgres()
        ? `SELECT c.id, c.title, c.last_message_preview, c.updated_at,
             (SELECT u.name FROM conversation_participants cp
              JOIN users u ON u.id = cp.user_id
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent' LIMIT 1) as agent_name,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
           FROM conversations c
           WHERE c.title LIKE 'NikitronBot:%'
           ORDER BY c.updated_at DESC LIMIT $1`
        : `SELECT c.id, c.title, c.last_message_preview, c.updated_at,
             (SELECT u.name FROM conversation_participants cp
              JOIN users u ON u.id = cp.user_id
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent' LIMIT 1) as agent_name,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
           FROM conversations c
           WHERE c.title LIKE 'NikitronBot:%'
           ORDER BY c.updated_at DESC LIMIT ?`,
      [limit]
    ) || [];
  } catch (err) {
    apiLogger.error({ err }, '[NikitronBot] Failed to list chats');
    return [];
  }
}

// ===== CONVERSATION CREATION =====

export async function createCrmConversation(title, adminUserId, agent, chatId) {
  const settings = chatId
    ? JSON.stringify({ nikitron_chat_id: chatId })
    : '{}';

  let result;
  if (isPostgres()) {
    result = await dbRun(`
      INSERT INTO conversations (title, type, created_by, settings, sub_agents, created_at, updated_at)
      VALUES ($1, 'chat', $2, $3::jsonb, '[]'::jsonb, NOW(), NOW())
      RETURNING id
    `, [title, adminUserId, settings]);
  } else {
    result = await dbRun(`
      INSERT INTO conversations (title, type, created_by, settings, sub_agents, created_at, updated_at)
      VALUES (?, 'chat', ?, ?, '[]', datetime('now'), datetime('now'))
    `, [title, adminUserId, settings]);
  }

  const conversationId = result?.rows?.[0]?.id || result?.lastInsertRowid;

  // Add admin as participant
  if (isPostgres()) {
    await dbRun(`
      INSERT INTO conversation_participants (conversation_id, user_id, role, user_type, joined_at)
      VALUES ($1, $2, 'admin', 'human', NOW())
      ON CONFLICT (conversation_id, user_id) DO NOTHING
    `, [conversationId, adminUserId]);
  } else {
    await dbRun(`
      INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role, user_type, joined_at)
      VALUES (?, ?, 'admin', 'human', datetime('now'))
    `, [conversationId, adminUserId]);
  }

  // Add agent as participant
  if (agent?.userId) {
    if (isPostgres()) {
      await dbRun(`
        INSERT INTO conversation_participants (conversation_id, user_id, role, user_type, agent_response_mode, joined_at)
        VALUES ($1, $2, 'member', 'agent', 'always', NOW())
        ON CONFLICT (conversation_id, user_id) DO NOTHING
      `, [conversationId, agent.userId]);
    } else {
      await dbRun(`
        INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id, role, user_type, agent_response_mode, joined_at)
        VALUES (?, ?, 'member', 'agent', 'always', datetime('now'))
      `, [conversationId, agent.userId]);
    }
  }

  return conversationId;
}

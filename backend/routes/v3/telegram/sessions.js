// backend/routes/v3/telegram/sessions.js
// Session state management: in-memory cache backed by DB metadata.
// Maps Telegram chatId -> { conversationId, agentUserId, agentName, agentRowId, lastPolledMessageId, createdAt }

import { apiLogger, dbRun, dbGet, dbAll, isPostgres, ChainHandoffService } from './shared.js';
import { userRegistry } from './userRegistry.js';

// ===== SESSION STATE =====
const activeSessions = new Map();

// Default space_id for telegram conversations (Development space)
const TELEGRAM_SPACE_ID = null; // Will be auto-resolved

// Cache: telegram_user_id -> CRM user ID (resolved once)
const crmUserIdCache = new Map();

/**
 * Resolve the CRM user ID for a specific Telegram user.
 * Uses the crm_user_id from user registry, or falls back to first human user.
 */
async function getCrmUserIdForTelegramUser(telegramUserId) {
  const id = String(telegramUserId);

  // Check cache first
  if (crmUserIdCache.has(id)) return crmUserIdCache.get(id);

  // Check user registry for explicit mapping
  const userInfo = userRegistry.get(id);
  if (userInfo?.crm_user_id) {
    crmUserIdCache.set(id, userInfo.crm_user_id);
    return userInfo.crm_user_id;
  }

  // Fallback: first human user in DB
  try {
    const user = await dbGet(
      isPostgres()
        ? `SELECT id FROM users WHERE user_type = 'human' ORDER BY id ASC LIMIT 1`
        : `SELECT id FROM users WHERE user_type = 'human' ORDER BY id ASC LIMIT 1`
    );
    const crmId = user?.id || 1;
    crmUserIdCache.set(id, crmId);
    return crmId;
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] Failed to resolve CRM user ID');
    return 1; // fallback
  }
}

/**
 * Resolve an agent's user ID and row_id from their slug name.
 * Returns { userId, rowId, name } or null
 */
async function resolveAgent(agentSlug) {
  if (!agentSlug) return null;

  const normalized = agentSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  try {
    // First try: find agent user in users table
    const agentUser = await dbGet(
      isPostgres()
        ? `SELECT u.id as user_id, u.name, u.managed_by_agent_row_id as row_id
           FROM users u
           WHERE u.user_type = 'agent'
           AND LOWER(REPLACE(u.name, ' ', '-')) LIKE $1
           ORDER BY u.id ASC LIMIT 1`
        : `SELECT u.id as user_id, u.name, u.managed_by_agent_row_id as row_id
           FROM users u
           WHERE u.user_type = 'agent'
           AND LOWER(REPLACE(u.name, ' ', '-')) LIKE ?
           ORDER BY u.id ASC LIMIT 1`,
      [`%${normalized}%`]
    );

    if (agentUser) {
      return {
        userId: agentUser.user_id,
        rowId: agentUser.row_id,
        name: agentUser.name,
      };
    }

    // Fallback: use ChainHandoffService mapping
    const crmUserId = ChainHandoffService.resolveAgentId(normalized);
    if (crmUserId) {
      const user = await dbGet(
        isPostgres()
          ? `SELECT id, name, managed_by_agent_row_id FROM users WHERE id = $1`
          : `SELECT id, name, managed_by_agent_row_id FROM users WHERE id = ?`,
        [crmUserId]
      );
      if (user) {
        return {
          userId: user.id,
          rowId: user.managed_by_agent_row_id,
          name: user.name || normalized,
        };
      }
    }

    return null;
  } catch (err) {
    apiLogger.error({ err, agentSlug }, '[Telegram] Failed to resolve agent');
    return null;
  }
}

/**
 * Try to restore active session from DB for a Telegram chatId.
 * Looks for the most recent Telegram conversation that is still active.
 * This allows sessions to survive server restarts.
 * @param {string} chatId - Telegram chat ID
 * @returns {Promise<Object|null>} Session object or null
 */
async function restoreSessionFromDb(chatId) {
  try {
    // Strategy: First try to find a conversation tagged with this chatId in metadata,
    // then fall back to the most recent Telegram conversation.
    // The chatId is stored in conversations.settings as {"telegram_chat_id": "..."}
    let conv = await dbGet(
      isPostgres()
        ? `SELECT c.id, c.title, c.created_at,
             (SELECT cp.user_id FROM conversation_participants cp
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent' LIMIT 1) as agent_user_id
           FROM conversations c
           WHERE c.settings::text LIKE '%"telegram_chat_id":"' || $1 || '"%'
           ORDER BY c.updated_at DESC
           LIMIT 1`
        : `SELECT c.id, c.title, c.created_at,
             (SELECT cp.user_id FROM conversation_participants cp
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent' LIMIT 1) as agent_user_id
           FROM conversations c
           WHERE c.settings LIKE '%"telegram_chat_id":"' || ? || '"%'
           ORDER BY c.updated_at DESC
           LIMIT 1`,
      [chatId]
    );

    // NOTE: Removed dangerous fallback that would match ANY Telegram conversation.
    // This caused cross-user chat leaks — one user could end up in another's chat.
    // If no session found for this specific chatId, return null (user must /newchat).

    if (!conv) return null;

    // Get agent info
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

    // Get latest message ID for polling
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

    // Cache it in memory
    activeSessions.set(chatId, session);

    // If restored via fallback (no chatId in settings), tag the conversation for future lookups
    try {
      if (isPostgres()) {
        await dbRun(`
          UPDATE conversations
          SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
          WHERE id = $2
            AND (settings IS NULL OR NOT settings::text LIKE '%telegram_chat_id%')
        `, [JSON.stringify({ telegram_chat_id: chatId }), conv.id]);
      } else {
        await dbRun(`
          UPDATE conversations
          SET settings = json_set(COALESCE(settings, '{}'), '$.telegram_chat_id', ?), updated_at = datetime('now')
          WHERE id = ? AND settings NOT LIKE '%telegram_chat_id%'
        `, [chatId, conv.id]);
      }
    } catch (_) { /* non-critical — just helps future restores */ }

    apiLogger.info({ chatId, conversationId: conv.id, agentName }, '[Telegram] Session restored from DB');
    return session;
  } catch (err) {
    apiLogger.error({ err, chatId }, '[Telegram] Failed to restore session from DB');
    return null;
  }
}

/**
 * Load a specific conversation by ID and create a session for it.
 * Used by /chat_ID command.
 * @param {string} chatId - Telegram chat ID
 * @param {number} conversationId - CRM conversation ID
 * @returns {Promise<Object|null>} Session object or null
 */
async function loadConversationSession(chatId, conversationId) {
  try {
    const conv = await dbGet(
      isPostgres()
        ? `SELECT c.id, c.title, c.created_at FROM conversations c WHERE c.id = $1`
        : `SELECT c.id, c.title, c.created_at FROM conversations c WHERE c.id = ?`,
      [conversationId]
    );

    if (!conv) return null;

    // Get agent participant
    const agentParticipant = await dbGet(
      isPostgres()
        ? `SELECT cp.user_id, u.name, u.managed_by_agent_row_id
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = $1 AND cp.user_type = 'agent'
           LIMIT 1`
        : `SELECT cp.user_id, u.name, u.managed_by_agent_row_id
           FROM conversation_participants cp
           JOIN users u ON u.id = cp.user_id
           WHERE cp.conversation_id = ? AND cp.user_type = 'agent'
           LIMIT 1`,
      [conversationId]
    );

    // Get latest message ID
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

    apiLogger.info({ chatId, conversationId, agentName: session.agentName }, '[Telegram] Switched to conversation');
    return session;
  } catch (err) {
    apiLogger.error({ err, chatId, conversationId }, '[Telegram] Failed to load conversation');
    return null;
  }
}

/**
 * List recent Telegram conversations.
 * @param {number} limit - Max results
 * @returns {Promise<Array>} List of conversations
 */
async function listRecentTelegramChats(limit = 10) {
  try {
    const chats = await dbAll(
      isPostgres()
        ? `SELECT c.id, c.title, c.last_message_preview, c.updated_at,
             (SELECT u.name FROM conversation_participants cp
              JOIN users u ON u.id = cp.user_id
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent'
              LIMIT 1) as agent_name,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
           FROM conversations c
           WHERE c.title LIKE 'Telegram:%'
           ORDER BY c.updated_at DESC
           LIMIT $1`
        : `SELECT c.id, c.title, c.last_message_preview, c.updated_at,
             (SELECT u.name FROM conversation_participants cp
              JOIN users u ON u.id = cp.user_id
              WHERE cp.conversation_id = c.id AND cp.user_type = 'agent'
              LIMIT 1) as agent_name,
             (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
           FROM conversations c
           WHERE c.title LIKE 'Telegram:%'
           ORDER BY c.updated_at DESC
           LIMIT ?`,
      [limit]
    );
    return chats || [];
  } catch (err) {
    apiLogger.error({ err }, '[Telegram] Failed to list recent chats');
    return [];
  }
}

/**
 * Create a CRM conversation for Telegram chat.
 * @param {string} title - Conversation title
 * @param {number} adminUserId - Admin CRM user ID
 * @param {Object|null} agent - Agent info { userId, rowId, name }
 * @param {string|null} telegramChatId - Telegram chat ID to link this conversation
 * @returns {Promise<number>} Conversation ID
 */
async function createCrmConversation(title, adminUserId, agent, telegramChatId = null) {
  // ADR-098: Use conversation_participants only (not sub_agents JSONB) to avoid
  // duplicate agent triggers in getAutoRespondAgents() which reads from both sources.
  const subAgentsJson = '[]';

  // Store telegram_chat_id in settings for session restoration across restarts
  const settings = telegramChatId
    ? JSON.stringify({ telegram_chat_id: telegramChatId })
    : '{}';

  let result;
  if (isPostgres()) {
    result = await dbRun(`
      INSERT INTO conversations (title, type, created_by, settings, sub_agents, created_at, updated_at)
      VALUES ($1, 'chat', $2, $3::jsonb, $4::jsonb, NOW(), NOW())
      RETURNING id
    `, [title, adminUserId, settings, subAgentsJson]);
  } else {
    result = await dbRun(`
      INSERT INTO conversations (title, type, created_by, settings, sub_agents, created_at, updated_at)
      VALUES (?, 'chat', ?, ?, ?, datetime('now'), datetime('now'))
    `, [title, adminUserId, settings, subAgentsJson]);
  }

  const conversationId = result?.rows?.[0]?.id || result?.lastInsertRowid;

  // Add admin as participant (owner)
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

  // Add agent as participant if specified
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

export {
  activeSessions,
  TELEGRAM_SPACE_ID,
  crmUserIdCache,
  getCrmUserIdForTelegramUser,
  resolveAgent,
  restoreSessionFromDb,
  loadConversationSession,
  listRecentTelegramChats,
  createCrmConversation,
};

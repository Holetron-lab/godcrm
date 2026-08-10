/**
 * Conversation CRUD routes: create, list, get, update, delete.
 * Bind/settings/sub-agents routes are in conversationExtrasController.js.
 */

import {
  dbRun, dbGet, dbAll, safeJsonParse, apiLogger,
  success, created, error, badRequest, notFound,
  requireAuth,
} from './chatShared.js';
import {
  resolveAgentUser, validateSubAgentRowIds, enrichSubAgents,
  autoJoinAgentToConversation, resolveAgentInfoForMessages,
} from './chatAgentHelpers.js';
// ADR-0068 WP-B — bound_table_id sentinel + comment-thread child resolver.
// Single source of truth lives in backend/services/chat/rowAttachment.js.
import { BOUND_TABLE_ID_CONVERSATIONS, getCommentThreadChildId } from '../../../services/chat/rowAttachment.js';

// ADR-0003 §C-8: scope → BDD logical-table name (resolved at request time)
const BDD_SPACE_ID = 11;
const SCOPE_TO_TABLE_NAME = {
  bdd_criterion: 'bdd_criteria',
  bdd_spec: 'bdd_specs',
  bdd_test: 'bdd_tests',
};
const _scopeTableIdCache = new Map();
async function resolveScopeBoundTableId(scope) {
  const tableName = SCOPE_TO_TABLE_NAME[scope];
  if (!tableName) return null;
  if (_scopeTableIdCache.has(tableName)) return _scopeTableIdCache.get(tableName);
  const row = await dbGet(
    `SELECT ut.id FROM universal_tables ut JOIN projects p ON ut.project_id = p.id
     WHERE p.space_id = $1 AND ut.name = $2 ORDER BY ut.id ASC LIMIT 1`,
    [BDD_SPACE_ID, tableName]
  );
  if (row?.id) {
    _scopeTableIdCache.set(tableName, row.id);
    return row.id;
  }
  return null;
}

// Resolve a `participant_ids` entry to a real `users.id`.
// The chat UI sometimes hands us an AI Agents table row_id (e.g. from the
// slash/mention agent list, which keys on `agent.id` = the table_rows id)
// instead of the agent's user-account id. Inserting that raw value blew up the
// whole create-conversation request with an FK violation on
// `conversation_participants_user_id_fkey` (agents became un-messageable).
// Here we (1) accept ids that already exist in `users`, (2) map an AI Agents
// row_id to its managed agent-user, (3) return null for anything unresolvable
// so the caller can skip it instead of 500-ing.
async function resolveParticipantUserId(participantId) {
  if (participantId == null) return null;
  const existing = await dbGet(`SELECT id FROM users WHERE id = $1`, [participantId]);
  if (existing?.id) return existing.id;
  const agentUser = await dbGet(
    `SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`,
    [participantId]
  );
  return agentUser?.id || null;
}

// Shared creation logic — used by POST /conversations and POST /conversations/find-or-create.
// Returns { conversation } on success, or { badRequest: <message> } on validation failure.
async function _createConversationCore({ userId, body }) {
  const { title, type = 'chat', participant_ids = [], space_id, lab_id, settings, bound_table_id, bound_row_id, sub_agents } = body;

  const VALID_CONVERSATION_TYPES = ['chat', 'task', 'row'];
  if (type && !VALID_CONVERSATION_TYPES.includes(type)) {
    return { badRequest: `Invalid conversation type: ${type}. Valid types: ${VALID_CONVERSATION_TYPES.join(', ')}` };
  }
  const settingsJson = settings ? JSON.stringify(settings) : '{}';

  let subAgentsJson = '[]';
  if (Array.isArray(sub_agents) && sub_agents.length > 0) {
    const validIds = await validateSubAgentRowIds(sub_agents);
    if (validIds.length === 0) return { badRequest: 'None of the provided sub_agents row_ids are valid AI Agents' };
    if (validIds.length !== sub_agents.length) {
      apiLogger.warn({ provided: sub_agents, valid: validIds }, 'Some sub_agents row_ids were invalid and filtered out');
    }
    const normalizedSubAgents = sub_agents
      .map(item => {
        const rowId = typeof item === 'object' ? item.row_id : item;
        if (!validIds.includes(rowId)) return null;
        if (typeof item === 'object') return { row_id: item.row_id, response_mode: item.response_mode || 'always' };
        return { row_id: item, response_mode: 'always' };
      })
      .filter(Boolean);
    subAgentsJson = JSON.stringify(normalizedSubAgents);
  }

  const result = await dbRun(`
    INSERT INTO conversations (title, type, space_id, lab_id, created_by, settings, bound_table_id, bound_row_id, sub_agents, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW(), NOW())
  `, [title || null, type, space_id || null, lab_id || null, userId, settingsJson, bound_table_id || null, bound_row_id || null, subAgentsJson]);

  const conversationId = result.lastInsertRowid;

  await dbRun(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'admin', NOW())`, [conversationId, userId]);

  for (const participantId of participant_ids) {
    if (participantId === userId) continue;
    const resolvedId = await resolveParticipantUserId(participantId);
    if (!resolvedId) {
      apiLogger.warn({ participantId, conversationId }, 'Skipping participant_id — not a users.id and not an AI Agents row_id');
      continue;
    }
    // ON CONFLICT guards against the resolved id colliding with the creator or a
    // duplicate participant_id (unique constraint conversation_participants_conversation_id_user_id_key).
    await dbRun(
      `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at) VALUES ($1, $2, 'member', NOW())
       ON CONFLICT (conversation_id, user_id) DO NOTHING`,
      [conversationId, resolvedId]
    );
  }

  // ADR-091 / Ticket #41157 (AC10): Dual-write sub_agents as real participants
  const parsedSubAgents = JSON.parse(subAgentsJson);
  if (Array.isArray(parsedSubAgents) && parsedSubAgents.length > 0) {
    for (const sa of parsedSubAgents) {
      const rowId = typeof sa === 'object' ? sa.row_id : sa;
      const responseMode = typeof sa === 'object' ? sa.response_mode : 'always';
      try {
        const agentUser = await dbGet(
          `SELECT id FROM users WHERE managed_by_agent_row_id = $1 AND user_type = 'agent'`,
          [rowId]
        );
        if (agentUser) {
          await autoJoinAgentToConversation(conversationId, agentUser.id, { response_mode: responseMode, source: 'creation' });
        } else {
          const agentRow = await dbGet(`SELECT tr.data FROM table_rows tr WHERE tr.id = $1`, [rowId]);
          if (agentRow) {
            const agentData = safeJsonParse(agentRow.data, {});
            if (agentData.name) {
              const slug = agentData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
              const resolved = await resolveAgentUser(slug, space_id || null);
              if (resolved && resolved.id) {
                await autoJoinAgentToConversation(conversationId, resolved.id, { response_mode: responseMode, source: 'creation' });
              }
            }
          }
        }
      } catch (agentErr) {
        apiLogger.warn({ agentErr, conversationId, rowId }, 'ADR-091/AC10: Could not add sub_agent as participant during creation (non-fatal)');
      }
    }
    apiLogger.info({ conversationId, subAgentCount: parsedSubAgents.length }, 'ADR-091/AC10: Sub-agents dual-written to conversation_participants');
  }

  const conversation = await dbGet(`SELECT * FROM conversations WHERE id = $1`, [conversationId]);
  const rawSubAgents = safeJsonParse(conversation.sub_agents, []);
  const enrichedSubAgents = await enrichSubAgents(rawSubAgents);

  apiLogger.info(`Created conversation ${conversationId} by user ${userId}`);
  return { conversation: { ...conversation, sub_agents: enrichedSubAgents } };
}

export default function registerConversationCrudRoutes(router) {

  // POST /conversations - Create conversation
  router.post('/conversations', requireAuth, async (req, res) => {
    try {
      const result = await _createConversationCore({ userId: req.user.userId, body: req.body });
      if (result.badRequest) return badRequest(res, result.badRequest);
      return created(res, result.conversation);
    } catch (err) {
      apiLogger.error('Error creating conversation:', err);
      return error(res, 'CREATE_CONVERSATION_ERROR', err.message, 500);
    }
  });

  // POST /conversations/find-or-create — ADR-0003 §C-8 idempotent scoped threads.
  // Body: { scope, criterion_id?|spec_id?|test_id?, source_doc_id?, title?, settings?, sub_agents?, ... }
  // Resolves bound_table_id from scope, searches for an existing conversation bound to
  // (bound_table_id, bound_row_id) where the caller is a participant, returns it if
  // found (with `found:true`), otherwise creates a new one (with `found:false`).
  // Also accepts explicit bound_table_id/bound_row_id when scope is omitted.
  router.post('/conversations/find-or-create', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const body = { ...(req.body || {}) };
      const { scope, criterion_id, spec_id, test_id, source_doc_id } = body;

      let { bound_table_id, bound_row_id } = body;

      // Resolve bound_table_id + bound_row_id from scope if scope is BDD-aware.
      if (scope && SCOPE_TO_TABLE_NAME[scope]) {
        const resolvedTableId = await resolveScopeBoundTableId(scope);
        if (!resolvedTableId) {
          return badRequest(res, `BDD table for scope "${scope}" is not bootstrapped (run scripts/bootstrap-bdd-tables.js)`);
        }
        bound_table_id = resolvedTableId;
        if (scope === 'bdd_criterion') bound_row_id = criterion_id ?? bound_row_id;
        else if (scope === 'bdd_spec')  bound_row_id = spec_id ?? bound_row_id;
        else if (scope === 'bdd_test')  bound_row_id = test_id ?? bound_row_id;
      } else if (scope) {
        return badRequest(res, `Unknown scope "${scope}". Supported: ${Object.keys(SCOPE_TO_TABLE_NAME).join(', ')}`);
      }

      if (!bound_table_id || !bound_row_id) {
        return badRequest(res, 'find-or-create requires either { scope, <id> } or explicit { bound_table_id, bound_row_id }');
      }

      // Idempotent lookup: existing conversation bound to this row where the caller participates.
      const existing = await dbGet(`
        SELECT c.* FROM conversations c
        JOIN conversation_participants cp ON cp.conversation_id = c.id
        WHERE c.bound_table_id = $1 AND c.bound_row_id = $2 AND cp.user_id = $3
        ORDER BY c.id ASC LIMIT 1
      `, [bound_table_id, bound_row_id, userId]);

      if (existing) {
        const enrichedSubAgents = await enrichSubAgents(safeJsonParse(existing.sub_agents, []));
        return success(res, { ...existing, sub_agents: enrichedSubAgents, found: true });
      }

      // Merge resolved binding + scope settings into body for creation.
      const mergedSettings = { ...(body.settings || {}) };
      if (scope) mergedSettings.scope = scope;
      if (source_doc_id !== undefined) mergedSettings.source_doc_id = source_doc_id;
      if (scope === 'bdd_criterion' && criterion_id !== undefined) mergedSettings.criterion_id = criterion_id;
      if (scope === 'bdd_spec' && spec_id !== undefined) mergedSettings.spec_id = spec_id;
      if (scope === 'bdd_test' && test_id !== undefined) mergedSettings.test_id = test_id;

      const createBody = {
        ...body,
        bound_table_id,
        bound_row_id,
        settings: mergedSettings,
        title: body.title || (scope ? `${scope.replace('bdd_', 'BDD ')} #${bound_row_id}` : `Row #${bound_row_id}`),
      };

      const result = await _createConversationCore({ userId, body: createBody });
      if (result.badRequest) return badRequest(res, result.badRequest);
      return created(res, { ...result.conversation, found: false });
    } catch (err) {
      apiLogger.error({ err }, 'Error in find-or-create conversation');
      return error(res, 'FIND_OR_CREATE_CONVERSATION_ERROR', err.message, 500);
    }
  });

  // POST /conversations/ensure-row-chat — ADR-0031 §B / P4.
  // Body: { table_id, row_id, title? }
  // Returns the row-bound conversation, creating it lazily with title +
  // space_id + caller as participant. Unlike find-or-create, this lookup
  // ignores the participant filter — a row has ONE shared chat (model
  // matches ticket attached chats), and any caller with row access joins it.
  // Used by the criterion "💬 Discuss" button (P4) and the §X row-link chip.
  router.post('/conversations/ensure-row-chat', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const tableIdRaw = req.body?.table_id ?? req.body?.tableId;
      const rowIdRaw = req.body?.row_id ?? req.body?.rowId;
      const titleHint = req.body?.title || null;
      const tableId = Number(tableIdRaw);
      const rowId = Number(rowIdRaw);
      if (!Number.isFinite(tableId) || !Number.isFinite(rowId)) {
        return badRequest(res, 'ensure-row-chat requires { table_id, row_id }');
      }
      const { ensureRowChat } = await import('../../../services/tableMutationService.js');
      const conv = await ensureRowChat({ tableId, rowId, actorId: userId, titleHint });
      if (!conv || !conv.id) {
        return error(res, 'ENSURE_ROW_CHAT_FAILED', 'Could not create or find row-bound chat', 500);
      }
      const full = await dbGet(`SELECT * FROM conversations WHERE id = $1`, [conv.id]);
      const enrichedSubAgents = await enrichSubAgents(safeJsonParse(full?.sub_agents, []));
      return success(res, { ...full, sub_agents: enrichedSubAgents });
    } catch (err) {
      apiLogger.error({ err }, 'Error in ensure-row-chat');
      return error(res, 'ENSURE_ROW_CHAT_ERROR', err.message, 500);
    }
  });

  // POST /conversations/:id/comment-thread — ADR-0068 WP-B1.
  // Idempotent: returns the existing comment-thread child if one is already
  // bound to this parent (purpose='comments'), otherwise creates one and
  // returns it. UNIQUE index on (parent_conversation_id, purpose) ensures
  // we never race a duplicate even under concurrent clicks.
  //
  // The child is a regular conversation that:
  //   - sets parent_conversation_id to the parent id (fast lookups),
  //   - sets purpose='comments' (so cascade-archive can flip it later),
  //   - sets bound_table_id = CONVERSATIONS_SENTINEL (0) and
  //     bound_row_id = parent.id, so the "attached to" chip universal
  //     resolver (rowAttachment.js) renders the parent conversation as
  //     the child's bound row — no new chip type needed,
  //   - inherits space_id from the parent,
  //   - auto-adds the caller as a member participant.
  router.post('/conversations/:id/comment-thread', requireAuth, async (req, res) => {
    try {
      const parentId = Number(req.params.id);
      const userId = req.user.userId;
      if (!Number.isFinite(parentId) || parentId <= 0) {
        return badRequest(res, 'Invalid conversation id');
      }

      const parent = await dbGet(
        `SELECT id, title, space_id FROM conversations WHERE id = $1`,
        [parentId]
      );
      if (!parent) return notFound(res, 'Parent conversation not found');

      // Idempotent lookup — UNIQUE index keeps this honest under concurrency.
      const existing = await dbGet(
        `SELECT * FROM conversations WHERE parent_conversation_id = $1 AND purpose = 'comments'`,
        [parentId]
      );
      if (existing) {
        // Make sure the caller is a participant of the child (idempotent join).
        await dbRun(
          `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
           VALUES ($1, $2, 'member', NOW())
           ON CONFLICT (conversation_id, user_id) DO NOTHING`,
          [existing.id, userId]
        );
        return success(res, {
          ...existing,
          child_id: existing.id,
          parent_conversation_id: parentId,
          found: true,
        });
      }

      const title = `💬 Comments — ${parent.title || `#${parent.id}`}`;
      const insertResult = await dbRun(
        `INSERT INTO conversations
           (title, type, space_id, created_by, settings,
            bound_table_id, bound_row_id, parent_conversation_id, purpose,
            created_at, updated_at)
         VALUES ($1, 'chat', $2, $3, '{}'::jsonb,
                 $4, $5, $6, 'comments',
                 NOW(), NOW())
         RETURNING id`,
        [title, parent.space_id || null, userId, BOUND_TABLE_ID_CONVERSATIONS, parentId, parentId]
      );
      // dbRun returns lastInsertRowid OR the inserted row depending on adapter
      // shape; conversationCrudController already relies on lastInsertRowid for
      // the regular create path.
      const childId = insertResult.lastInsertRowid || insertResult.rows?.[0]?.id;

      await dbRun(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at)
         VALUES ($1, $2, 'admin', NOW())
         ON CONFLICT (conversation_id, user_id) DO NOTHING`,
        [childId, userId]
      );

      const child = await dbGet(`SELECT * FROM conversations WHERE id = $1`, [childId]);
      apiLogger.info(
        { parentId, childId, userId },
        'ADR-0068 WP-B1: created comment-thread child conversation'
      );
      return created(res, {
        ...child,
        child_id: childId,
        parent_conversation_id: parentId,
        found: false,
      });
    } catch (err) {
      // Race condition on the UNIQUE index → another caller won, return that one.
      if (err && err.code === '23505') {
        try {
          const existing = await dbGet(
            `SELECT * FROM conversations WHERE parent_conversation_id = $1 AND purpose = 'comments'`,
            [Number(req.params.id)]
          );
          if (existing) {
            return success(res, {
              ...existing,
              child_id: existing.id,
              parent_conversation_id: Number(req.params.id),
              found: true,
            });
          }
        } catch (_) { /* fall through to error response */ }
      }
      apiLogger.error({ err }, 'Error creating comment-thread child');
      return error(res, 'COMMENT_THREAD_ERROR', err.message, 500);
    }
  });

  // GET /conversations - List conversations (paginated, default 50)
  router.get('/conversations', requireAuth, async (req, res) => {
    try {
      const userId = req.user.userId;
      const { type, space_id, lab_id, labId, limit = 50, offset = 0, search, agent_id, agentId, date_from, date_to, dateFrom, dateTo, userId: userIdFilter, sort_by, sort_dir, unread_only, participant_id, participant_mode, bound_table_id, bound_row_id } = req.query;

      const effectiveLabId = lab_id || labId;
      const effectiveAgentId = agent_id || agentId;
      const effectiveDateFrom = date_from || dateFrom;
      const effectiveDateTo = date_to || dateTo;
      const effectiveSortBy = sort_by || 'id_desc'; // created | last_message | id_desc
      const effectiveSortDir = (sort_dir === 'asc' || sort_dir === 'desc') ? sort_dir.toUpperCase() : 'DESC';

      // Build ORDER BY clause
      let orderByClause;
      if (effectiveSortBy === 'last_message') orderByClause = `c.updated_at ${effectiveSortDir}`;
      else if (effectiveSortBy === 'created') orderByClause = `c.id ${effectiveSortDir}`;
      else orderByClause = `c.id DESC`; // id_desc default

      const conditions = ['cp.user_id = $1'];
      const sqlParams = [userId];
      let paramIndex = 2;

      if (space_id) { conditions.push(`c.space_id = $${paramIndex}`); sqlParams.push(parseInt(space_id)); paramIndex++; }

      if (type === 'all') { /* no filter */ }
      else if (type === 'ai') { conditions.push(`c.type IN ('chat', 'ai_chat')`); }
      else if (type === 'people') { conditions.push(`c.type IN ('direct', 'group')`); }
      else if (type) { conditions.push(`c.type = $${paramIndex}`); sqlParams.push(type); paramIndex++; }

      if (userIdFilter) { conditions.push(`EXISTS (SELECT 1 FROM conversation_participants cp2 WHERE cp2.conversation_id = c.id AND cp2.user_id = $${paramIndex})`); sqlParams.push(parseInt(userIdFilter)); paramIndex++; }
      if (effectiveLabId) { conditions.push(`c.lab_id = $${paramIndex}`); sqlParams.push(effectiveLabId); paramIndex++; }
      if (effectiveAgentId) { conditions.push(`c.agent_id = $${paramIndex}`); sqlParams.push(parseInt(effectiveAgentId)); paramIndex++; }
      if (search) { conditions.push(`LOWER(c.title) LIKE $${paramIndex}`); sqlParams.push(`%${search.toLowerCase()}%`); paramIndex++; }
      if (bound_table_id) { conditions.push(`c.bound_table_id = $${paramIndex}`); sqlParams.push(parseInt(bound_table_id)); paramIndex++; }
      if (bound_row_id)   { conditions.push(`c.bound_row_id = $${paramIndex}`);   sqlParams.push(parseInt(bound_row_id));   paramIndex++; }
      if (effectiveDateFrom) { conditions.push(`c.updated_at >= $${paramIndex}`); sqlParams.push(effectiveDateFrom); paramIndex++; }
      if (effectiveDateTo) { conditions.push(`c.updated_at <= $${paramIndex}`); sqlParams.push(effectiveDateTo); paramIndex++; }
      if (participant_id) {
        const pIds = String(participant_id).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
        const mode = participant_mode === 'all' ? 'all' : 'any';
        if (pIds.length === 1) {
          conditions.push(`EXISTS (SELECT 1 FROM conversation_participants cp3 WHERE cp3.conversation_id = c.id AND cp3.user_id = $${paramIndex})`);
          sqlParams.push(pIds[0]); paramIndex++;
        } else if (pIds.length > 1 && mode === 'all') {
          // ALL mode: conversation must contain every selected participant
          const pgPlaceholders = pIds.map((_, i) => `$${paramIndex + i}`).join(',');
          conditions.push(`(SELECT COUNT(DISTINCT cp3.user_id) FROM conversation_participants cp3 WHERE cp3.conversation_id = c.id AND cp3.user_id IN (${pgPlaceholders})) = ${pIds.length}`);
          sqlParams.push(...pIds); paramIndex += pIds.length;
        } else if (pIds.length > 1) {
          // ANY mode (default): conversation contains at least one of the selected participants
          const pgPlaceholders = pIds.map((_, i) => `$${paramIndex + i}`).join(',');
          conditions.push(`EXISTS (SELECT 1 FROM conversation_participants cp3 WHERE cp3.conversation_id = c.id AND cp3.user_id IN (${pgPlaceholders}))`);
          sqlParams.push(...pIds); paramIndex += pIds.length;
        }
      }
      if (unread_only === 'true') {
        conditions.push(`EXISTS (SELECT 1 FROM messages m_unr WHERE m_unr.conversation_id = c.id AND m_unr.sender_id != $1 AND (m_unr.content_type IS NULL OR m_unr.content_type NOT IN ('tool_call','tool_result','thinking','plan','agent_status')) AND m_unr.created_at > COALESCE((SELECT cp_unr.last_read_at FROM conversation_participants cp_unr WHERE cp_unr.conversation_id = c.id AND cp_unr.user_id = $1), '1970-01-01'))`);
      }


      sqlParams.push(parseInt(limit), parseInt(offset));

      const agentNameSubquery = `(SELECT r.data->>'name' FROM table_rows r WHERE r.id = c.agent_id) as agent_name`;
      const agentIconSubquery = `(SELECT r.data->>'icon' FROM table_rows r WHERE r.id = c.agent_id) as agent_icon`;
      const boundRowTitleSubquery = `(SELECT COALESCE(r.data->>'name', r.data->>'title', r.data->>'what', r.data->>'subject', r.data->>'label', '#' || r.id) FROM table_rows r WHERE r.table_id = c.bound_table_id AND r.id = c.bound_row_id LIMIT 1) as bound_row_title`;
      const boundTableNameSubquery = `(SELECT COALESCE(ut.display_name, ut.name) FROM universal_tables ut WHERE ut.id = c.bound_table_id LIMIT 1) as bound_table_name`;
      const boundTableIconSubquery = `(SELECT ut.icon FROM universal_tables ut WHERE ut.id = c.bound_table_id LIMIT 1) as bound_table_icon`;
      // ADR-0068 WP-B — every conversation gets a resolved comment-thread
      // child id (or NULL). One LATERAL subquery, idx_conversations_parent_purpose
      // makes it index-only on (parent_conversation_id, purpose).
      const commentThreadChildSubquery = `(SELECT child.id FROM conversations child WHERE child.parent_conversation_id = c.id AND child.purpose = 'comments' LIMIT 1) as comment_thread_child_id`;

      const sql = `SELECT c.*, ${agentNameSubquery}, ${agentIconSubquery}, ${boundRowTitleSubquery}, ${boundTableNameSubquery}, ${boundTableIconSubquery}, ${commentThreadChildSubquery}
        FROM conversations c JOIN conversation_participants cp ON c.id = cp.conversation_id
        WHERE ${conditions.join(' AND ')} ORDER BY ${orderByClause} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      const params = sqlParams;

      const conversations = await dbAll(sql, params);

      // Count total matching conversations for pagination
      let totalCount = conversations.length + parseInt(offset);
      // Only run count query if we got a full page (meaning there could be more)
      if (conversations.length >= parseInt(limit)) {
        // Reuse same conditions but without LIMIT/OFFSET
        const countSqlParams = sqlParams.slice(0, -2); // remove limit and offset
        const countSql = `SELECT COUNT(*) as total FROM conversations c JOIN conversation_participants cp ON c.id = cp.conversation_id WHERE ${conditions.join(' AND ')}`;
        const countParams = countSqlParams;
        const countResult = await dbGet(countSql, countParams);
        totalCount = parseInt(countResult?.total || 0);
      }

      const parsedLimit = parseInt(limit);
      const parsedOffset = parseInt(offset);
      const hasMore = (parsedOffset + conversations.length) < totalCount;

      // Batch load participants and unread counts (eliminates N+1 queries)
      const convIds = conversations.map(c => c.id);
      let allParticipants = [];
      let allUnreads = [];

      if (convIds.length > 0) {
        const idList = convIds.join(',');
        allParticipants = await dbAll(
          `SELECT cp.conversation_id, cp.user_id, cp.role, cp.user_type, cp.joined_at, cp.last_read_at, u.name, u.email, COALESCE(u.avatar, '') as avatar_url
           FROM conversation_participants cp JOIN users u ON cp.user_id = u.id
           WHERE cp.conversation_id IN (${idList}) ORDER BY cp.joined_at ASC`
        );
        allUnreads = await dbAll(
          `SELECT m.conversation_id, COUNT(*) as unread_count
           FROM messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = $1
           WHERE m.conversation_id IN (${idList}) AND m.sender_id != $1
             AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
             AND (m.content_type IS NULL OR m.content_type NOT IN ('tool_call', 'tool_result', 'thinking', 'plan', 'agent_status'))
           GROUP BY m.conversation_id`,
          [userId]
        );
      }

      // Batch load per-participant message counts
      let allMsgCounts = [];
      if (convIds.length > 0) {
        {
          const idList = convIds.join(',');
          allMsgCounts = await dbAll(
            `SELECT m.conversation_id, m.sender_id, u.name as sender_name, COUNT(*) as msg_count
             FROM messages m JOIN users u ON m.sender_id = u.id
             WHERE m.conversation_id IN (${idList})
               AND (m.content_type IS NULL OR m.content_type NOT IN ('thinking','tool_call','tool_result','agent_status','plan'))
             GROUP BY m.conversation_id, m.sender_id, u.name
             ORDER BY msg_count DESC`
          );
        }
      }

      // Index by conversation_id for O(1) lookup
      const participantsByConv = {};
      for (const p of allParticipants) {
        const cid = p.conversation_id;
        if (!participantsByConv[cid]) participantsByConv[cid] = [];
        participantsByConv[cid].push(p);
      }
      const unreadByConv = {};
      for (const u of allUnreads) {
        unreadByConv[u.conversation_id] = parseInt(u.unread_count || 0);
      }
      const msgCountsByConv = {};
      for (const mc of allMsgCounts) {
        const cid = mc.conversation_id;
        if (!msgCountsByConv[cid]) msgCountsByConv[cid] = [];
        msgCountsByConv[cid].push({ sender_id: mc.sender_id, name: mc.sender_name, count: parseInt(mc.msg_count) });
      }

      // Collect unique sub_agent row_ids for batch enrichment
      const allSubAgentSets = conversations.map(c => safeJsonParse(c.sub_agents, []));
      const uniqueRowIds = new Set();
      for (const arr of allSubAgentSets) {
        for (const sa of arr) {
          const rowId = typeof sa === 'object' ? sa.row_id : sa;
          if (rowId) uniqueRowIds.add(rowId);
        }
      }
      // Batch enrich sub-agents once
      let enrichedMap = {};
      if (uniqueRowIds.size > 0) {
        try {
          const allEnriched = await enrichSubAgents([...uniqueRowIds].map(id => ({ row_id: id })));
          for (const e of allEnriched) {
            if (e.row_id) enrichedMap[e.row_id] = e;
          }
        } catch (_) {}
      }

      const conversationsWithParticipants = conversations.map((conv, idx) => {
        const participants = participantsByConv[conv.id] || [];
        const unread_count = unreadByConv[conv.id] || 0;
        const rawSubAgents = allSubAgentSets[idx];
        const enrichedSubAgents = rawSubAgents.map(sa => {
          const rowId = typeof sa === 'object' ? sa.row_id : sa;
          return enrichedMap[rowId] || sa;
        });
        const participant_msg_counts = msgCountsByConv[conv.id] || [];
        return { ...conv, participants, unread_count, participant_msg_counts, sub_agents: enrichedSubAgents };
      });

      return success(res, {
        conversations: conversationsWithParticipants,
        total_count: totalCount,
        has_more: hasMore,
        limit: parsedLimit,
        offset: parsedOffset,
      });
    } catch (err) {
      apiLogger.error({ err }, 'Error listing conversations');
      return error(res, 'LIST_CONVERSATIONS_ERROR', err.message, 500);
    }
  });

  // GET /conversations/:id - Get conversation with messages
  router.get('/conversations/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId;

      const participant = await dbGet(
        `SELECT * FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
        [id, userId]
      );
      if (!participant) return notFound(res, 'Conversation not found');

      const conversation = await dbGet(`SELECT * FROM conversations WHERE id = $1`, [id]);
      if (!conversation) return notFound(res, 'Conversation not found');

      const limit = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 2000);
      const before = req.query.before ? parseInt(req.query.before) : null;

      // Content type filtering — exclude heavy tool/thinking messages (same as messageController)
      const VALID_CONTENT_TYPES = ['text', 'thinking', 'tool_call', 'tool_result', 'tool_approval', 'plan', 'markdown', 'code', 'image', 'agent_status', 'system', 'call'];
      let contentTypeFilter = '';
      const contentTypesParam = req.query.content_types;
      if (contentTypesParam) {
        const types = contentTypesParam.split(',').map(t => t.trim()).filter(t => VALID_CONTENT_TYPES.includes(t));
        if (types.length > 0) {
          const includeNull = types.includes('text');
          contentTypeFilter = ` AND (content_type IN (${types.map(t => `'${t}'`).join(',')})${includeNull ? ' OR content_type IS NULL' : ''})`;
        }
      }
      const deletedFilter = ` AND (is_deleted IS NULL OR is_deleted = 0)`;

      let msgQuery, msgParams;
      if (before) {
        msgQuery = `SELECT * FROM messages WHERE conversation_id = $1 AND id < $2${deletedFilter}${contentTypeFilter} ORDER BY id DESC LIMIT $3`;
        msgParams = [id, before, limit + 1];
      } else {
        msgQuery = `SELECT * FROM messages WHERE conversation_id = $1${deletedFilter}${contentTypeFilter} ORDER BY id DESC LIMIT $2`;
        msgParams = [id, limit + 1];
      }

      const rawMessages = await dbAll(msgQuery, msgParams);
      const hasMore = rawMessages.length > limit;
      const messages = hasMore ? rawMessages.slice(0, limit) : rawMessages;
      messages.reverse();

      const parsedMessages = messages.map(m => ({
        ...m, mentions: safeJsonParse(m.mentions) || [], attachments: safeJsonParse(m.attachments) || [],
        contentType: m.content_type || 'text', senderType: m.sender_type || 'human',
        toolResults: m.tool_results ? safeJsonParse(m.tool_results) : null, parentId: m.parent_id || null, timestamp: m.created_at
      }));

      const resolvedMessages = await resolveAgentInfoForMessages(parsedMessages);
      const nextCursor = hasMore && resolvedMessages.length > 0 ? resolvedMessages[0].id : null;

      const rawSubAgents = safeJsonParse(conversation.sub_agents, []);
      const enrichedSubAgents = rawSubAgents.length > 0 ? await enrichSubAgents(rawSubAgents) : [];

      const participantsSql = `SELECT cp.user_id, cp.role, cp.user_type, cp.joined_at, cp.last_read_at, u.name, u.email, COALESCE(u.avatar, '') as avatar_url FROM conversation_participants cp JOIN users u ON cp.user_id = u.id WHERE cp.conversation_id = $1 ORDER BY cp.joined_at ASC`;
      const participants = await dbAll(participantsSql, [id]);

      // ADR-0068 WP-B — resolved child id (or null) for the comment-thread chip.
      const comment_thread_child_id = await getCommentThreadChildId(id);

      return success(res, { ...conversation, comment_thread_child_id, messages: resolvedMessages, hasMore, nextCursor, sub_agents: enrichedSubAgents, participants });
    } catch (err) {
      apiLogger.error('Error getting conversation:', err);
      return error(res, 'GET_CONVERSATION_ERROR', err.message, 500);
    }
  });

  // PATCH /conversations/:id - Update conversation
  router.patch('/conversations/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.userId || req.user.id;
      const { title, bound_table_id, bound_row_id } = req.body;

      if (title === undefined && bound_table_id === undefined && bound_row_id === undefined && Object.keys(req.body).length === 0) return badRequest(res, 'No fields to update');

      const conv = await dbGet('SELECT id, created_by FROM conversations WHERE id = $1', [id]);
      if (!conv) return error(res, 'NOT_FOUND', 'Conversation not found', 404);

      const updates = [];
      const values = [];

      if (title !== undefined) { updates.push(`title = $${values.length + 1}`); values.push(title); }
      if (bound_table_id !== undefined) { updates.push(`bound_table_id = $${values.length + 1}`); values.push(bound_table_id); }
      if (bound_row_id !== undefined) { updates.push(`bound_row_id = $${values.length + 1}`); values.push(bound_row_id); }

      if (updates.length === 0) return badRequest(res, 'No valid fields to update');

      updates.push(`updated_at = NOW()`); values.push(id);
      await dbRun(`UPDATE conversations SET ${updates.join(', ')} WHERE id = $${values.length}`, values);

      return res.json({ success: true, data: { id: Number(id), title, bound_table_id, bound_row_id } });
    } catch (err) {
      apiLogger.error({ err }, 'Error updating conversation');
      return error(res, 'UPDATE_CONVERSATION_ERROR', err.message, 500);
    }
  });

  // DELETE /conversations/:id - Delete conversation
  router.delete('/conversations/:id', requireAuth, async (req, res) => {
    try {
      const { id } = req.params;

      // ADR-0068 WP-B Cascade — comment-thread children survive the parent
      // delete: archive them in place (purpose → 'comments_archived', null
      // parent_conversation_id) so their messages are preserved as a
      // standalone read-only history. The UNIQUE index on
      // (parent_conversation_id, purpose) only covers WHERE parent IS NOT
      // NULL — multiple archived rows can coexist after this update.
      await dbRun(
        `UPDATE conversations
            SET purpose = 'comments_archived',
                parent_conversation_id = NULL,
                updated_at = NOW()
          WHERE parent_conversation_id = $1 AND purpose = 'comments'`,
        [id]
      );

      await dbRun(`DELETE FROM messages WHERE conversation_id = $1`, [id]);
      await dbRun(`DELETE FROM conversation_participants WHERE conversation_id = $1`, [id]);
      await dbRun(`DELETE FROM conversations WHERE id = $1`, [id]);
      return success(res, { deleted: true });
    } catch (err) {
      apiLogger.error({ err }, 'Error deleting conversation');
      return error(res, 'DELETE_CONVERSATION_ERROR', err.message, 500);
    }
  });
}

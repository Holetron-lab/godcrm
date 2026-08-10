/**
 * ADR-093/110: Conversation history loading, bound row context, and skill fetching.
 *
 * Extracted from agent-execution-shared.js
 */

import { dbGet, dbAll, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import {
  safeParse,
  getHistoryLimit,
  resolveContextLevels,
  buildContentTypes,
  formatMessageByLevel,
} from './helpers.js';

// ─── loadConversationHistory() ────────────────────────────────

/**
 * ADR-093 Task 3 + ADR-110 Phase 1: Load conversation history from DB.
 * Backend owns history — no more frontend-passed history arrays.
 * Configurable per agent via context_settings.max_history (default 50).
 *
 * ADR-110: Hierarchical Smart Context
 *   Level 1 (default): text/markdown/code only
 *   Level 2: + thinking messages (truncated to thinking_preview_chars)
 *   Level 3: + tool_call/tool_result with summary previews
 *   Level 4: + full tool results (no truncation)
 *
 * Controlled via agentConfig.context_settings.context_levels:
 *   { thinking, thinking_preview_chars, tool_summaries, tool_preview_chars, full_tool_results }
 *
 * Backward compatible: if no context_levels, behavior is Level 1 only.
 *
 * @param {number} conversationId - Conversation to load history for
 * @param {Object} agentConfig - Agent configuration (for max_history + context_levels)
 * @param {number|null} agentUserId - Agent's user ID (to determine assistant role)
 * @returns {Promise<Array<{role: string, content: string}>>} Formatted message history
 */
export async function loadConversationHistory(conversationId, agentConfig = {}, agentUserId = null) {
  const maxHistory = getHistoryLimit(agentConfig);
  const contextLevels = resolveContextLevels(agentConfig);
  const contentTypes = buildContentTypes(contextLevels);

  // Build parameterized IN clause for content_type filtering
  const inClausePlaceholders = isPostgres()
    ? contentTypes.map((_, i) => `$${i + 3}`).join(', ')
    : contentTypes.map(() => '?').join(', ');

  const params = isPostgres()
    ? [conversationId, maxHistory, ...contentTypes]
    : [conversationId, ...contentTypes, maxHistory];

  // Bug fix: Also select attachments + tool_results columns
  // ADR-0031 P5: select metadata for `moved` stub-pointer breadcrumbs
  const messages = await dbAll(
    isPostgres()
      ? `SELECT m.id, m.content, m.role, m.sender_id, m.sender_type, m.content_type,
                m.attachments, m.tool_results, m.metadata, u.name as sender_name
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE m.conversation_id = $1
           AND m.content_type IN (${inClausePlaceholders})
           AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
         ORDER BY m.created_at DESC
         LIMIT $2`
      : `SELECT m.id, m.content, m.role, m.sender_id, m.sender_type, m.content_type,
                m.attachments, m.tool_results, m.metadata, u.name as sender_name
         FROM messages m
         LEFT JOIN users u ON m.sender_id = u.id
         WHERE m.conversation_id = ?
           AND m.content_type IN (${contentTypes.map(() => '?').join(', ')})
           AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
         ORDER BY m.created_at DESC
         LIMIT ?`,
    params
  );

  return messages.reverse().map(m => {
    const role = (agentUserId && m.sender_id === agentUserId) || m.role === 'assistant'
      ? 'assistant'
      : 'user';

    // ADR-110: Format non-text messages based on context level
    // ADR-113: Plan messages are formatted as compact checklists
    // ADR-0031 P5: 'moved' stub-pointers get a breadcrumb so the agent skips
    // the original content but knows the discussion continues elsewhere.
    const isStepMessage = ['thinking', 'tool_call', 'tool_result'].includes(m.content_type);
    const isPlanMessage = m.content_type === 'plan';
    const isMovedStub = m.content_type === 'moved';
    let content;

    if (isPlanMessage || isStepMessage || isMovedStub) {
      content = formatMessageByLevel(m, contextLevels);
    } else {
      content = role === 'user' && m.sender_name
        ? `[${m.sender_name}]: ${m.content}`
        : m.content;

      // Append attachment descriptions to message content for AI visibility.
      // Files and row_reference attachments are rendered as separate blocks so
      // history-replays don't print rows as "(row_reference): no URL".
      const attachments = safeParse(m.attachments, []);
      if (Array.isArray(attachments) && attachments.length > 0) {
        const fileAtts = attachments.filter(a => a.type !== 'row_reference');
        const rowAtts = attachments.filter(a => a.type === 'row_reference' && a.rowReference);
        const sections = [];
        if (fileAtts.length > 0) {
          const fileLines = fileAtts.map(a => {
            const url = a.url || 'no URL';
            return `- ${a.name || 'file'} (${a.type || 'unknown'}): ${url}`;
          }).join('\n');
          sections.push(`[Attached files]\n${fileLines}`);
        }
        if (rowAtts.length > 0) {
          const rowLines = rowAtts.map(a => {
            const ref = a.rowReference;
            const icon = ref.table_icon ? `${ref.table_icon} ` : '';
            const title = ref.row_title || `#${ref.row_id}`;
            return `- ${icon}${ref.table_name}: ${title} (table_id=${ref.table_id}, row_id=${ref.row_id})`;
          }).join('\n');
          sections.push(`[Attached rows]\n${rowLines}`);
        }
        if (sections.length > 0) {
          content += `\n\n${sections.join('\n\n')}`;
        }
      }
    }

    return { role, content };
  });
}

// ─── loadNewMessagesSince() — T-148527 WP-A ───────────────────

/**
 * T-148527 (WP-A): Load user-role messages that arrived after a cursor
 * timestamp. Used by the agent tool loop to detect chat-window edits that
 * happened *while* the agent was busy thinking — so the next turn can
 * see them and respond.
 *
 * Returns ONLY:
 *   - role='user' messages (excludes the agent's own streamed steps);
 *   - text/markdown/code content_types (excludes thinking/tool_call/tool_result/agent_status/plan/moved);
 *   - messages NOT authored by `agentUserId` (extra belt-and-braces in case
 *     a future migration relaxes the role filter).
 *
 * Failure is non-blocking — DB errors return `[]` and emit a warn line so
 * the loop never crashes on a bad cursor or transient DB issue.
 *
 * @param {number|string} conversationId
 * @param {string|null|undefined} since - ISO timestamp; rows with created_at > since are returned. Falsy → []
 * @param {number|null} agentUserId - the agent's user_id; messages from this user are excluded
 * @returns {Promise<Array<{id:number, sender_id:number|null, sender_name:string|null, content:string, created_at:string}>>}
 */
export async function loadNewMessagesSince(conversationId, since, agentUserId = null) {
  if (!conversationId || !since) return [];
  try {
    const rows = await dbAll(
      isPostgres()
        ? `SELECT m.id, m.sender_id, m.content, m.created_at,
                  u.name AS sender_name
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = $1
              AND m.created_at > $2
              AND m.role = 'user'
              AND (m.content_type IS NULL OR m.content_type IN ('text', 'markdown', 'code'))
              AND (m.is_deleted = 0 OR m.is_deleted IS NULL OR m.is_deleted = false)
              AND ($3::int IS NULL OR m.sender_id IS NULL OR m.sender_id <> $3::int)
            ORDER BY m.id ASC`
        : `SELECT m.id, m.sender_id, m.content, m.created_at,
                  u.name AS sender_name
             FROM messages m
             LEFT JOIN users u ON m.sender_id = u.id
            WHERE m.conversation_id = ?
              AND m.created_at > ?
              AND m.role = 'user'
              AND (m.content_type IS NULL OR m.content_type IN ('text', 'markdown', 'code'))
              AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
              AND (? IS NULL OR m.sender_id IS NULL OR m.sender_id <> ?)
            ORDER BY m.id ASC`,
      isPostgres()
        ? [conversationId, since, agentUserId]
        : [conversationId, since, agentUserId, agentUserId]
    );
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    apiLogger.warn(
      { err: err.message, conversationId, since, agentUserId },
      'T-148527: loadNewMessagesSince failed (non-blocking)'
    );
    return [];
  }
}

// ─── fetchBoundRowContext() ───────────────────────────────────

/**
 * ADR-072/093: Fetch bound row context from conversation.
 * Used by buildAgentSystemPrompt() in account mode.
 *
 * @param {number} conversationId - Conversation ID
 * @returns {Promise<Object|null>} Bound row context or null
 */
export async function fetchBoundRowContext(conversationId) {
  const conversation = await dbGet(
    isPostgres()
      ? `SELECT bound_table_id, bound_row_id FROM conversations WHERE id = $1`
      : `SELECT bound_table_id, bound_row_id FROM conversations WHERE id = ?`,
    [conversationId]
  );

  if (!conversation?.bound_table_id || !conversation?.bound_row_id) {
    return null;
  }

  const boundRow = await dbGet(
    isPostgres()
      ? `SELECT tr.id, tr.data, ut.name as table_name
         FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id
         WHERE tr.table_id = $1 AND tr.id = $2`
      : `SELECT tr.id, tr.data, ut.name as table_name
         FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id
         WHERE tr.table_id = ? AND tr.id = ?`,
    [conversation.bound_table_id, conversation.bound_row_id]
  );

  if (!boundRow) return null;

  return {
    table_id: conversation.bound_table_id,
    row_id: conversation.bound_row_id,
    table_name: boundRow.table_name,
    data: safeParse(boundRow.data, {}),
  };
}

// ─── fetchAgentSkills() ──────────────────────────────────────

/** AI Tools table where ADR-0056 workflow-skill rows live. */
const AI_TOOLS_TABLE_ID = 1790;

/** Total char budget for injected skills (≈ 7.5k tokens). */
const SKILL_INJECTION_CHAR_BUDGET = 30000;

/**
 * S05 + ADR-0056: Runtime skill injection — fetch skills associated with an agent.
 *
 * Queries three sources, in this priority order:
 *   1. AI Tools (table 1790) — slugs listed in agent.tools[] whose row has
 *      category='workflow-skill'. SKILL.md body lives in `parameters_schema`.
 *      Order is preserved from tools[].
 *   2. skills_registry rows where agent_ids contains agentId (agent-level).
 *   3. skills_registry rows installed for spaceId via skill_installations.
 *
 * Token budget: total skill_content is capped at SKILL_INJECTION_CHAR_BUDGET
 * (30k chars). If exceeded, the longest skill body is repeatedly truncated
 * (with a `[… truncated to fit context budget]` marker) until the budget fits.
 * A warning is logged.
 *
 * Gracefully returns [] when:
 *   - agentId is null/undefined
 *   - All three sources are empty (skills_registry missing AND no bound skills)
 *   - Any DB error occurs
 *
 * Results are deduplicated by skill name (1790 wins over 1591 on collision).
 *
 * @param {number|null} agentId - Row ID of the agent in the agents table
 * @param {number|null} spaceId - Space ID for space-level skill installations
 * @param {string[]|string|null} agentTools - The agent's tools[] field (mixed
 *   MCP tool names and workflow-skill slugs). Slugs that don't resolve in
 *   table 1790 with category='workflow-skill' are silently ignored as MCP names.
 * @returns {Promise<Array<{name: string, display_name: string, skill_content: string}>>}
 */
export async function fetchAgentSkills(agentId, spaceId = null, agentTools = null) {
  if (agentId == null) return [];

  try {
    // 1. Find skills_registry table (optional — pre-existing S05 source)
    const skillsTable = await dbGet(
      isPostgres()
        ? `SELECT id FROM universal_tables WHERE name = $1 LIMIT 1`
        : `SELECT id FROM universal_tables WHERE name = ? LIMIT 1`,
      ['skills_registry']
    );

    const skillsTableId = skillsTable?.id ?? null;

    // 2. Check for skill_installations table (for space-level skills)
    const installsTable = skillsTableId
      ? await dbGet(
          isPostgres()
            ? `SELECT id FROM universal_tables WHERE name = $1 LIMIT 1`
            : `SELECT id FROM universal_tables WHERE name = ? LIMIT 1`,
          ['skill_installations']
        )
      : null;

    // 3. Query agent-level skills (skills where agent_ids contains this agent).
    //    Skipped entirely when skills_registry is missing — bound-skills (1790)
    //    still resolve below.
    let agentSkillRows = [];
    if (skillsTableId) {
    if (isPostgres()) {
      agentSkillRows = await dbAll(
        `SELECT tr.data FROM table_rows tr
         WHERE tr.table_id = $1
           AND (tr.is_deleted = 0 OR tr.is_deleted IS NULL OR tr.is_deleted = false)
           AND tr.data::jsonb->>'status' = 'published'
           AND tr.data::jsonb->'agent_ids' @> jsonb_build_array($2::integer)`,
        [skillsTableId, agentId]
      );
    } else {
      agentSkillRows = await dbAll(
        `SELECT tr.data FROM table_rows tr
         WHERE tr.table_id = ?
           AND (tr.is_deleted = 0 OR tr.is_deleted IS NULL)
           AND json_extract(tr.data, '$.status') = 'published'
           AND EXISTS (
             SELECT 1 FROM json_each(json_extract(tr.data, '$.agent_ids'))
             WHERE json_each.value = ?
           )`,
        [skillsTableId, agentId]
      );
    }
    }

    const agentSkills = agentSkillRows
      .map(row => safeParse(row.data, null))
      .filter(d => d && d.skill_content?.trim());

    // 4. Query space-level skills via skill_installations (if table exists and spaceId provided)
    let spaceSkills = [];
    if (installsTable && spaceId != null) {
      const installsTableId = installsTable.id;
      let spaceSkillRows;
      if (isPostgres()) {
        spaceSkillRows = await dbAll(
          `SELECT sr.data FROM table_rows sr
           WHERE sr.table_id = $1
             AND (sr.is_deleted = 0 OR sr.is_deleted IS NULL OR sr.is_deleted = false)
             AND sr.data::jsonb->>'status' = 'published'
             AND sr.id IN (
               SELECT CAST(si.data::jsonb->>'skill_id' AS INTEGER)
               FROM table_rows si
               WHERE si.table_id = $2
                 AND (si.is_deleted = 0 OR si.is_deleted IS NULL OR si.is_deleted = false)
                 AND CAST(si.data::jsonb->>'space_id' AS INTEGER) = $3
                 AND (si.data::jsonb->>'is_active' = 'true' OR si.data::jsonb->>'is_active' = '1')
             )`,
          [skillsTableId, installsTableId, spaceId]
        );
      } else {
        spaceSkillRows = await dbAll(
          `SELECT sr.data FROM table_rows sr
           WHERE sr.table_id = ?
             AND (sr.is_deleted = 0 OR sr.is_deleted IS NULL)
             AND json_extract(sr.data, '$.status') = 'published'
             AND sr.id IN (
               SELECT CAST(json_extract(si.data, '$.skill_id') AS INTEGER)
               FROM table_rows si
               WHERE si.table_id = ?
                 AND (si.is_deleted = 0 OR si.is_deleted IS NULL)
                 AND CAST(json_extract(si.data, '$.space_id') AS INTEGER) = ?
                 AND (json_extract(si.data, '$.is_active') = 1 OR json_extract(si.data, '$.is_active') IS NULL)
             )`,
          [skillsTableId, installsTableId, spaceId]
        );
      }

      spaceSkills = spaceSkillRows
        .map(row => safeParse(row.data, null))
        .filter(d => d && d.skill_content?.trim());
    }

    // 5. ADR-0056: Resolve workflow-skill slugs from agent.tools[] against table 1790.
    //    Slugs that match a row with category='workflow-skill' become bound skills.
    //    Slugs that don't match are assumed to be MCP tool names and are ignored here.
    const boundSkills = await fetchBoundSkillsFromTools(agentTools, agentId);

    // 6. Merge: bound skills (1790, in tools[] order) first, then 1591 sources.
    //    Dedupe by name — 1790 wins on collision.
    const seen = new Set();
    const merged = [];
    for (const skill of [...boundSkills, ...agentSkills, ...spaceSkills]) {
      const key = skill.name || skill.display_name;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      merged.push({
        name: skill.name || '',
        display_name: skill.display_name || skill.name || '',
        skill_content: skill.skill_content,
      });
    }

    // 7. Token budget enforcement (longest-first truncation).
    const budgeted = enforceSkillCharBudget(merged, SKILL_INJECTION_CHAR_BUDGET, { agentId });

    apiLogger.debug(
      {
        agentId, spaceId,
        boundCount: boundSkills.length,
        registryAgentCount: agentSkills.length,
        spaceCount: spaceSkills.length,
        totalCount: budgeted.length,
        totalChars: budgeted.reduce((n, s) => n + (s.skill_content?.length || 0), 0),
      },
      'S05/ADR-0056: fetchAgentSkills resolved'
    );
    return budgeted;

  } catch (err) {
    apiLogger.warn({ error: err.message, agentId, spaceId }, 'S05: fetchAgentSkills failed gracefully');
    return [];
  }
}

/**
 * Resolve workflow-skill slugs from agent.tools[] against table 1790.
 * Unknown slugs are silently dropped (they're treated as MCP tool names by
 * AgentLoopService.resolveAllowedTools). Order is preserved.
 *
 * @param {string[]|string|null} agentTools - The agent's tools[] field
 * @param {number|null} agentId - For logging
 * @returns {Promise<Array<{name:string, display_name:string, skill_content:string}>>}
 */
async function fetchBoundSkillsFromTools(agentTools, agentId) {
  if (!agentTools) return [];

  // Normalize tools[] to an array of strings.
  let toolList;
  if (Array.isArray(agentTools)) {
    toolList = agentTools;
  } else if (typeof agentTools === 'string') {
    try {
      const parsed = JSON.parse(agentTools);
      toolList = Array.isArray(parsed) ? parsed : [];
    } catch {
      toolList = agentTools.split(',').map(s => s.trim()).filter(Boolean);
    }
  } else {
    return [];
  }

  const slugs = toolList.filter(s => typeof s === 'string' && s.length > 0);
  if (slugs.length === 0) return [];

  let rows;
  try {
    if (isPostgres()) {
      const placeholders = slugs.map((_, i) => `$${i + 2}`).join(', ');
      rows = await dbAll(
        `SELECT data FROM table_rows
         WHERE table_id = $1
           AND data::jsonb->>'name' IN (${placeholders})
           AND data::jsonb->>'category' = 'workflow-skill'`,
        [AI_TOOLS_TABLE_ID, ...slugs]
      );
    } else {
      const placeholders = slugs.map(() => '?').join(', ');
      rows = await dbAll(
        `SELECT data FROM table_rows
         WHERE table_id = ?
           AND json_extract(data, '$.name') IN (${placeholders})
           AND json_extract(data, '$.category') = 'workflow-skill'`,
        [AI_TOOLS_TABLE_ID, ...slugs]
      );
    }
  } catch (err) {
    apiLogger.warn(
      { agentId, error: err.message },
      'ADR-0056: fetchBoundSkillsFromTools failed (non-fatal, returning empty)'
    );
    return [];
  }

  // Build a slug → skill map so we can return results in tools[] order.
  const bySlug = new Map();
  for (const row of rows) {
    const d = safeParse(row.data, null);
    if (!d || !d.name) continue;
    const body = typeof d.parameters_schema === 'string' ? d.parameters_schema : '';
    if (!body.trim()) continue;
    bySlug.set(d.name, {
      name: d.name,
      display_name: d.display_name || d.name,
      skill_content: body,
    });
  }

  const ordered = [];
  const unknown = [];
  for (const slug of slugs) {
    if (bySlug.has(slug)) {
      ordered.push(bySlug.get(slug));
    } else {
      unknown.push(slug);
    }
  }

  // Unknown slugs are not necessarily errors — many entries in tools[] are
  // MCP tool names (e.g. 'web_search', 'memory_recall'). We only debug-log
  // the partition so an operator can spot truly broken bindings.
  if (ordered.length > 0 || unknown.length > 0) {
    apiLogger.debug(
      { agentId, resolvedSkills: ordered.map(s => s.name), unresolvedTools: unknown },
      'ADR-0056: bound-skill slug resolution against table 1790'
    );
  }

  return ordered;
}

/**
 * Enforce a total character budget across a set of skill bodies. When the
 * combined `skill_content` length exceeds the budget, the longest body is
 * repeatedly truncated (with a marker appended) until total fits.
 *
 * Mutates a shallow-cloned array — does not modify input objects.
 *
 * @param {Array<{name:string, display_name:string, skill_content:string}>} skills
 * @param {number} budget - Max total chars
 * @param {{ agentId?: number|null }} [meta]
 * @returns {Array<{name:string, display_name:string, skill_content:string}>}
 */
function enforceSkillCharBudget(skills, budget, meta = {}) {
  if (!Array.isArray(skills) || skills.length === 0) return skills;

  const total = () => clone.reduce((n, s) => n + (s.skill_content?.length || 0), 0);

  let clone = skills.map(s => ({ ...s }));
  const originalTotal = total();
  if (originalTotal <= budget) return clone;

  const TRUNC_MARKER = '\n\n[… truncated to fit context budget]';
  const truncations = [];

  // Repeatedly trim the longest skill until we're under budget. Each pass
  // halves the longest body (down to a 200-char floor) — enough rounds will
  // always converge for reasonable inputs.
  let guard = 0;
  while (total() > budget && guard < 50) {
    guard += 1;
    // Find the longest skill body.
    let longestIdx = 0;
    for (let i = 1; i < clone.length; i++) {
      if ((clone[i].skill_content?.length || 0) > (clone[longestIdx].skill_content?.length || 0)) {
        longestIdx = i;
      }
    }
    const longest = clone[longestIdx];
    const currentLen = longest.skill_content?.length || 0;
    if (currentLen <= 200) {
      // Can't shrink any further without dropping the skill entirely; bail out.
      break;
    }
    const targetLen = Math.max(200, Math.floor(currentLen / 2));
    const trimmedBody = longest.skill_content.substring(0, targetLen) + TRUNC_MARKER;
    clone[longestIdx] = { ...longest, skill_content: trimmedBody };
    truncations.push({ name: longest.name, from: currentLen, to: trimmedBody.length });
  }

  apiLogger.warn(
    {
      agentId: meta.agentId,
      budget,
      originalChars: originalTotal,
      finalChars: total(),
      skillCount: clone.length,
      truncations,
    },
    'ADR-0056: skill injection exceeded char budget — longest-first truncation applied'
  );

  return clone;
}

/**
 * Migration 027: Unify conversation types (ADR-078)
 *
 * Merges ai_chat, direct, group types into unified 'chat' type.
 * Keeps 'task' and 'row' types unchanged (they add bound context).
 *
 * Behavior is now determined by participant count, not type field:
 * - Solo mode (1 human): AI auto-responds
 * - Group mode (2+ humans): AI responds only via /command
 */

export async function up(knex) {
  // Merge ai_chat, direct, group → chat
  await knex('conversations')
    .whereIn('type', ['ai_chat', 'direct', 'group'])
    .update({ type: 'chat' });

  // Log migration results
  const counts = await knex('conversations')
    .select('type')
    .count('* as count')
    .groupBy('type');

  console.log('[Migration 027] Conversation type counts after migration:', counts);
}

export async function down(knex) {
  // Reversible: restore original types based on heuristics
  // ai_chat: has agent_id set
  // direct: 2 participants exactly, no agent
  // group: 3+ participants, no agent

  // Step 1: Restore ai_chat — conversations with agent_id
  await knex('conversations')
    .where('type', 'chat')
    .whereNotNull('agent_id')
    .update({ type: 'ai_chat' });

  // Step 2: Restore direct/group based on participant count
  // Get conversations that are still 'chat' (no agent)
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  if (isPostgres) {
    // Direct: exactly 2 participants
    await knex.raw(`
      UPDATE conversations SET type = 'direct'
      WHERE type = 'chat' AND id IN (
        SELECT conversation_id FROM conversation_participants
        GROUP BY conversation_id HAVING COUNT(*) = 2
      )
    `);

    // Group: 3+ participants
    await knex.raw(`
      UPDATE conversations SET type = 'group'
      WHERE type = 'chat' AND id IN (
        SELECT conversation_id FROM conversation_participants
        GROUP BY conversation_id HAVING COUNT(*) >= 3
      )
    `);
  } else {
    // SQLite version
    await knex.raw(`
      UPDATE conversations SET type = 'direct'
      WHERE type = 'chat' AND id IN (
        SELECT conversation_id FROM conversation_participants
        GROUP BY conversation_id HAVING COUNT(*) = 2
      )
    `);

    await knex.raw(`
      UPDATE conversations SET type = 'group'
      WHERE type = 'chat' AND id IN (
        SELECT conversation_id FROM conversation_participants
        GROUP BY conversation_id HAVING COUNT(*) >= 3
      )
    `);
  }

  // Remaining 'chat' types (no participants/agent) → default to ai_chat
  await knex('conversations')
    .where('type', 'chat')
    .update({ type: 'ai_chat' });

  const counts = await knex('conversations')
    .select('type')
    .count('* as count')
    .groupBy('type');

  console.log('[Migration 027 DOWN] Conversation type counts after rollback:', counts);
}

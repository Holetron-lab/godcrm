// Neo16 W1 — the module's installable blueprint (doc 239900 §Module Integration).
//
// DATA, interpreted by the core ModuleInstaller (ADR-200): tables are provisioned in
// the installation's CRM project, the game widget lands on the space's default
// dashboard bound to those tables by `{ $table }` refs, so the same blueprint installs
// into any space without carrying ids. Blueprint key is `neo16`; the widget keeps the
// compatibility preset key `16neo` so existing widget rows/URLs keep rendering.
//
// W2 declares all seven logical tables of doc 239900 §Data Ownership (0.1.0 → 0.2.0,
// add-only: `turns` gains the learning columns, five tables are new). review_cards and
// npc_memories are schema-only until W3; content is seeded from content/quests.js.

import { CONTENT_SEED_ROWS } from './content/quests.js';

export const NEO16_BLUEPRINT = Object.freeze({
  key: 'neo16',
  version: '0.2.0',
  title: 'Neo16 — AI Town',
  icon: '🎮',
  description: 'Isometric English-practice town: NPC conversations, quests and progress stored in CRM tables.',
  tables: [
    {
      key: 'worlds',
      name: 'neo16_worlds',
      display_name: 'Neo16 — Worlds',
      icon: '🌍',
      table_type: 'neo16_worlds',
      columns: [
        { column_name: 'world_key', display_name: 'World key', type: 'text' },
        { column_name: 'owner_user_id', display_name: 'Owner user', type: 'number' },
        { column_name: 'status', display_name: 'Status', type: 'select' },
        { column_name: 'state_version', display_name: 'State version', type: 'number' },
        { column_name: 'current_time', display_name: 'Simulated time (ms)', type: 'number' },
        { column_name: 'last_step_ts', display_name: 'Previous step (ms)', type: 'number' },
        { column_name: 'processed_input_number', display_name: 'Processed input #', type: 'number' },
        { column_name: 'next_input_number', display_name: 'Next input #', type: 'number' },
        { column_name: 'snapshot', display_name: 'World snapshot', type: 'json' },
      ],
    },
    {
      key: 'turns',
      name: 'neo16_turns',
      display_name: 'Neo16 — Turns',
      icon: '🎯',
      table_type: 'neo16_turns',
      columns: [
        { column_name: 'world_id', display_name: 'World row', type: 'number' },
        { column_name: 'request_id', display_name: 'Request id', type: 'text' },
        { column_name: 'request_hash', display_name: 'Request hash', type: 'text' },
        { column_name: 'input_number', display_name: 'Input #', type: 'number' },
        { column_name: 'input_name', display_name: 'Command', type: 'text' },
        { column_name: 'input_args', display_name: 'Arguments', type: 'json' },
        { column_name: 'received_ts', display_name: 'Received (ms)', type: 'number' },
        { column_name: 'processing_status', display_name: 'Status', type: 'select' },
        { column_name: 'applied_version', display_name: 'Applied at version', type: 'number' },
        { column_name: 'result', display_name: 'Result', type: 'json' },
        // W2 learning turns (input_name = 'say'): the session they belong to, the NPC
        // addressed, the learner's text, the NPC reply and the validated evaluation.
        { column_name: 'session_id', display_name: 'Session row', type: 'number' },
        { column_name: 'npc_key', display_name: 'NPC', type: 'text' },
        { column_name: 'input_text', display_name: 'Learner said', type: 'long_text' },
        { column_name: 'response', display_name: 'NPC reply', type: 'json' },
        { column_name: 'evaluation', display_name: 'Evaluation', type: 'json' },
        { column_name: 'attempt', display_name: 'Attempt #', type: 'number' },
        { column_name: 'lease_until', display_name: 'Lease until (ms)', type: 'number' },
        { column_name: 'lease_token', display_name: 'Lease token', type: 'text' },
      ],
    },
    {
      key: 'content',
      name: 'neo16_content',
      display_name: 'Neo16 — Content',
      icon: '📜',
      table_type: 'neo16_content',
      columns: [
        { column_name: 'kind', display_name: 'Kind', type: 'select' },
        { column_name: 'content_key', display_name: 'Key', type: 'text' },
        { column_name: 'content_version', display_name: 'Version', type: 'number' },
        { column_name: 'title', display_name: 'Title', type: 'text' },
        { column_name: 'language', display_name: 'Language', type: 'text' },
        { column_name: 'level_hint', display_name: 'Level hint', type: 'text' },
        { column_name: 'status', display_name: 'Status', type: 'select' },
        { column_name: 'payload', display_name: 'Payload', type: 'json' },
      ],
    },
    {
      key: 'sessions',
      name: 'neo16_sessions',
      display_name: 'Neo16 — Sessions',
      icon: '🎬',
      table_type: 'neo16_sessions',
      columns: [
        { column_name: 'user_id', display_name: 'Learner', type: 'number' },
        { column_name: 'world_id', display_name: 'World row', type: 'number' },
        { column_name: 'quest_key', display_name: 'Quest', type: 'text' },
        { column_name: 'content_version', display_name: 'Content version', type: 'number' },
        { column_name: 'status', display_name: 'Status', type: 'select' },
        { column_name: 'started_at', display_name: 'Started', type: 'datetime' },
        { column_name: 'ended_at', display_name: 'Ended', type: 'datetime' },
        { column_name: 'state_version', display_name: 'State version', type: 'number' },
        { column_name: 'goals_done', display_name: 'Goals done', type: 'json' },
        { column_name: 'next_input_number', display_name: 'Next turn #', type: 'number' },
        { column_name: 'hints_used', display_name: 'Hints used', type: 'number' },
        { column_name: 'active_practice_seconds', display_name: 'Practice (s)', type: 'number' },
      ],
    },
    {
      key: 'progress',
      name: 'neo16_progress',
      display_name: 'Neo16 — Progress',
      icon: '🏁',
      table_type: 'neo16_progress',
      columns: [
        { column_name: 'user_id', display_name: 'Learner', type: 'number' },
        { column_name: 'target_kind', display_name: 'Target kind', type: 'select' },
        { column_name: 'target_key', display_name: 'Target', type: 'text' },
        { column_name: 'content_version', display_name: 'Content version', type: 'number' },
        { column_name: 'status', display_name: 'Status', type: 'select' },
        { column_name: 'attempts', display_name: 'Attempts', type: 'number' },
        { column_name: 'completed_at', display_name: 'Completed', type: 'datetime' },
        { column_name: 'xp', display_name: 'XP', type: 'number' },
        { column_name: 'evidence_turn_id', display_name: 'Evidence turn', type: 'number' },
      ],
    },
    {
      key: 'review_cards',
      name: 'neo16_review_cards',
      display_name: 'Neo16 — Review cards',
      icon: '🃏',
      table_type: 'neo16_review_cards',
      columns: [
        { column_name: 'user_id', display_name: 'Learner', type: 'number' },
        { column_name: 'language', display_name: 'Language', type: 'text' },
        { column_name: 'item_key', display_name: 'Item', type: 'text' },
        { column_name: 'prompt', display_name: 'Prompt', type: 'long_text' },
        { column_name: 'answer', display_name: 'Answer', type: 'long_text' },
        { column_name: 'source_turn_id', display_name: 'Source turn', type: 'number' },
        { column_name: 'fsrs_state', display_name: 'FSRS state', type: 'json' },
        { column_name: 'due_at', display_name: 'Due', type: 'datetime' },
        { column_name: 'scheduler_version', display_name: 'Scheduler version', type: 'text' },
      ],
    },
    {
      key: 'npc_memories',
      name: 'neo16_npc_memories',
      display_name: 'Neo16 — NPC memories',
      icon: '🧠',
      table_type: 'neo16_npc_memories',
      columns: [
        { column_name: 'user_id', display_name: 'Learner', type: 'number' },
        { column_name: 'world_id', display_name: 'World row', type: 'number' },
        { column_name: 'npc_key', display_name: 'NPC', type: 'text' },
        { column_name: 'summary', display_name: 'Summary', type: 'long_text' },
        { column_name: 'source_session_id', display_name: 'Source session', type: 'number' },
        { column_name: 'updated_at', display_name: 'Updated', type: 'datetime' },
      ],
    },
  ],
  seed: [{ table: 'content', key: ['kind', 'content_key', 'content_version'], rows: CONTENT_SEED_ROWS }],
  widgets: [
    {
      key: 'game',
      preset_name: '16neo',
      title: 'Neo16',
      icon: '🎮',
      config: {
        worlds_table_id: { $table: 'worlds' },
        turns_table_id: { $table: 'turns' },
        content_table_id: { $table: 'content' },
        sessions_table_id: { $table: 'sessions' },
        progress_table_id: { $table: 'progress' },
        review_cards_table_id: { $table: 'review_cards' },
        npc_memories_table_id: { $table: 'npc_memories' },
      },
      position: { x: 0, y: 0, w: 12, h: 8 },
    },
  ],
});

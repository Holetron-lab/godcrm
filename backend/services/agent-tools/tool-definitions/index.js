/**
 * Tool Definitions — AGENT_TOOLS array
 *
 * OpenAI function-calling schema for every tool available to AI agents.
 * This module assembles the canonical AGENT_TOOLS list from category submodules,
 * preserving the original ordering used before the 2026-04 split.
 */

import { CODE_TOOLS } from '../../CodeToolsService.js';
import { DATA_TOOLS } from './data.js';
import { DASHBOARD_TOOLS } from './dashboard.js';
import { WEB_TOOLS } from './web.js';
import { BLUESKY_TOOLS } from './bluesky.js';
import { REDDIT_TOOLS } from './reddit.js';
import { FILE_TOOLS } from './file.js';
import { CSV_TOOLS } from './csv.js';
import { UI_TOOLS } from './ui.js';
import { TICKET_TOOLS } from './ticket.js';
import { IMAGE_TOOLS } from './image.js';
import { MEMORY_TOOLS } from './memory.js';
import { CHAT_TOOLS } from './chat.js';
import { PROJECT_TOOLS } from './project.js';
import { CALENDAR_TOOLS } from './calendar.js';
import { PRINTER_TOOLS } from './printer.js';
import { CONNECTOR_TOOL_DEFS } from '../connector-tools.js';
import { PASSPORT_TOOLS } from './passport.js';
import { OPS_TOOLS } from './ops.js';

// Build a lookup so we can reference any tool by its function name.
const byName = Object.fromEntries(
  [
    ...DATA_TOOLS,
    ...DASHBOARD_TOOLS,
    ...WEB_TOOLS,
    ...BLUESKY_TOOLS,
    ...REDDIT_TOOLS,
    ...FILE_TOOLS,
    ...CSV_TOOLS,
    ...UI_TOOLS,
    ...TICKET_TOOLS,
    ...IMAGE_TOOLS,
    ...MEMORY_TOOLS,
    ...CHAT_TOOLS,
    ...PROJECT_TOOLS,
    ...CALENDAR_TOOLS,
    ...PRINTER_TOOLS,
    ...CONNECTOR_TOOL_DEFS,
    ...PASSPORT_TOOLS,
    ...OPS_TOOLS
  ].map((t) => [t.function.name, t])
);

const t = (name) => {
  const tool = byName[name];
  if (!tool) throw new Error(`[tool-definitions] missing tool: ${name}`);
  return tool;
};

/**
 * Tool definitions for OpenAI function calling.
 * Ordering matches the pre-split layout so prompt caching stays stable.
 */
export const AGENT_TOOLS = [
  // === CONSULTING TOOLS ===
  t('get_workspace_info'),
  t('query_table_data'),
  t('get_table_schema'),

  // === TABLE MANAGEMENT TOOLS ===
  t('create_table'),
  t('get_table_row'),
  t('add_table_row'),
  t('list_tables'),

  // === DASHBOARD TOOLS ===
  t('create_dashboard'),
  t('get_dashboard_widgets'),

  // === WIDGET TOOLS ===
  t('create_widget'),

  // === ANALYSIS TOOLS ===
  t('analyze_table_data'),

  // === WEB RESEARCH TOOLS ===
  t('web_search'),
  t('deep_scrape'),

  // === SOCIAL-LISTENING (Austin recon — public posts only) ===
  t('bluesky_search'),
  t('reddit_search'),

  // === CONVERSATION INTROSPECTION TOOLS ===
  t('view_conversation_steps'),
  t('view_step_detail'),

  // === FILE SYSTEM TOOLS ===
  t('read_file'),
  t('write_file'),
  t('list_directory'),
  t('search_files'),
  t('edit_file'),

  // === TICKET / ORCHESTRATION TOOLS (ADR-098) ===
  t('dispatch_task'),
  t('update_ticket_status'),
  t('send_ticket_message'),
  t('get_chain_status'),
  t('get_my_tasks'),

  // === INFLIGHT PAUSE REGISTRY (ADR-0063-A §P3) ===
  t('query_inflight_paused'),

  // === CHAIN SUPERVISOR (ADR-101) ===
  t('supervisor_decide'),

  // === CODE EXECUTION TOOLS (ADR-032) ===
  ...CODE_TOOLS,

  // === PLANNING TOOL (ADR-113) ===
  t('manage_plan'),

  // === SUMMARY TOOL ===
  t('save_conversation_summary'),

  // === IMAGE GENERATION TOOLS ===
  t('replicate_image_generate'),
  t('replicate_3d_generate'),
  t('replicate_video_generate'),
  t('replicate_check_prediction'),
  t('gemini_image_generate'),

  // === MEMORY TOOLS (Hindsight) ===
  t('memory_retain'),
  t('memory_recall'),
  t('memory_rooms'), // ADR-193: the floor plan, read before you write
  t('memory_reflect'),
  t('memory_compress'),
  t('memory_bridge'),

  // === ADR-144: MCP Server — P0 Data Completeness ===
  t('update_table_row'),
  t('upsert_section'), // ADR-182 Tier 2
  t('delete_table_row'),
  t('batch_update_rows'),
  t('batch_delete_rows'),
  t('manage_columns'),
  t('upload_file'),
  t('delete_table'),

  // === P1 — Communication & Widget Management ===
  t('send_chat_message'),
  t('send_widget_message'),
  t('list_conversations'),
  t('get_conversation_messages'),
  t('create_conversation'),
  t('move_chat_messages'),
  t('spawn_ticket_from_chat'),
  t('update_widget'),
  t('delete_widget'),

  // === P2 — Documents & Projects ===
  t('list_documents'),
  t('get_document_content'),
  t('create_document'),
  t('delete_document'),
  t('list_projects'),
  t('create_project'),
  t('update_project'),
  t('delete_project'),

  // === ADR-0045 P1 — space/project move primitives ===
  t('create_space'),
  t('move_project_to_space'),
  t('move_table_to_project'),
  t('delete_project_cascade'),

  // === Marketplace staging — copy primitives (relation-aware) ===
  t('copy_table'),
  t('copy_project'),
  t('copy_space'),

  // === P3 — Calendar & Search ===
  t('list_events'),
  t('create_event'),
  t('update_event'),
  t('delete_event'),
  t('global_search'),
  t('list_spaces'),

  // === TELEGRAM TOOLS ===
  t('send_telegram_message'),

  // === Printer / 3D Printing Tools ===
  t('printer_status'),
  t('printer_files'),
  t('printer_start'),
  t('printer_pause'),
  t('printer_resume'),
  t('printer_cancel'),
  t('printer_upload'),
  t('printer_temperatures'),
  t('printer_gcode'),
  t('printer_slice'),
  t('printer_slice_and_print'),

  // === ADR-0003 §C-1 — BDD acceptance criteria ===
  t('list_bdd_specs'),

  // === ADR-0028 Phase 4 — connector-backed tools ===
  t('figma_get_file'),
  t('slack_post_message'),
  t('github_get_user'),

  // === ADR-164 Phase 2 — agent passport lifecycle ===
  t('issue_passport'),
  t('revoke_passport'),

  // === Browser scenario runner (appended last so existing prompt prefixes,
  // and therefore the prompt cache, stay byte-identical) ===
  t('ui_probe'),

  // === Constitution v4.3 ops profiles — diagnostics / local-qa via the broker ===
  t('ops_grant_info'),
  t('ops_run_check'),
  t('project_csv'),
  t('midjourney_image_generate'),
  t('midjourney_check_task'),
];

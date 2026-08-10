/**
 * Pipeline Configuration — Space 36 (HOLETRON)
 *
 * Equivalent mapping of all table IDs, state row IDs, priority/type row IDs,
 * and agent user IDs needed to run ChainHandoffService in Space 36.
 *
 * Generated from production database queries on 2026-03-03.
 *
 * Source of truth:
 *   - Ticket States dictionary:  table 2968  (8 rows)
 *   - Priority dictionary:       table 2967  (4 rows)
 *   - Type dictionary:           table 2966  (8 rows)
 *   - Users CRM table:           table  970  (5 rows with system_user_id)
 *   - AI Agents table:           table 1584  (33 rows)
 *   - System `users` table:      SQL users WHERE user_type='agent'
 */

// =============================================================================
// SPACE 11 (Development) — Current hardcoded values in ChainHandoffService.js
// =============================================================================
// Provided here for reference so diffs are easy to spot.

export const SPACE_11_CONFIG = {
  TICKETS_TABLE_ID: 1708,
  AGENT_ACTIVITY_TABLE_ID: 1701,
  AI_AGENTS_TABLE_ID: 1784,

  STATE: {
    BACKLOG:     24275,  // "backlog"
    ASSIGNED:    43436,  // "assigned"
    IN_PROGRESS: 24276,  // "in progress"
    REVIEW:      24277,  // "review"
    CONTROL:     43437,  // "control"
    DONE:        24278,  // "done"
    REJECTED:    43438,  // "rejected"
    // Note: Space 11 has no ON_HOLD state
  },

  PRIORITY: {
    CRITICAL: 24274,  // "critical"
  },

  TYPE: {
    TASK: 24269,  // "task"
  },

  // Users CRM table (1782) row_id → system user_id
  USERS_TABLE_ROW_TO_USER_ID: {
    26283: 19,  // Developer Ralph
    26284: 22,  // Frontend QA
    26285: 21,  // Frontend Developer
    26286: 28,  // Document Agent
    26287: 20,  // Developer
    26288: 24,  // Architect
    36612: 18,  // Orchestrator
  },
};


// =============================================================================
// SPACE 36 (HOLETRON) — Full pipeline configuration
// =============================================================================

export const SPACE_36_CONFIG = {

  // ---- Core Table IDs ----
  TICKETS_TABLE_ID:         3207,
  AGENT_ACTIVITY_TABLE_ID:  3070,
  AI_AGENTS_TABLE_ID:       1584,
  QUALITY_REPORTS_TABLE_ID: 3071,
  ADR_PROJECTS_TABLE_ID:    3069,

  // ---- Dictionary Tables ----
  TICKET_STATES_TABLE_ID:   2968,
  PRIORITY_TABLE_ID:        2967,
  TYPE_TABLE_ID:            2966,
  USERS_TABLE_ID:            970,

  // ---- Ticket States (row IDs from table 2968) ----
  // Sorted by order field; slug in column 21756, order in 21757
  STATE: {
    BACKLOG:     57081,  // order 1 — "backlog"     — #6b7280 — "В очереди"
    ASSIGNED:    57082,  // order 2 — "assigned"    — #6366f1 — "Назначено исполнителю"
    IN_PROGRESS: 57083,  // order 3 — "in progress" — #3b82f6 — "В работе"
    REVIEW:      57084,  // order 4 — "review"      — #a855f7 — "На проверке"
    CONTROL:     57085,  // order 5 — "control"     — #f59e0b — "Контроль качества"
    DONE:        57086,  // order 6 — "done"        — #22c55e — "Завершено"           (is_final: true)
    ON_HOLD:     57087,  // order 7 — "on hold"     — #f59e0b — "Приостановлено"
    REJECTED:    57088,  // order 8 — "rejected"    — #ef4444 — "Отклонено"           (is_final: true)
  },

  // ---- Priority (row IDs from table 2967) ----
  // Slug in column 21752, order/level in 21753
  PRIORITY: {
    LOW:      57077,  // order 1 — "low"      — #6b7280
    MEDIUM:   57078,  // order 2 — "medium"   — #f59e0b
    HIGH:     57079,  // order 3 — "high"     — #f97316
    CRITICAL: 57080,  // order 4 — "critical" — #ef4444
  },

  // ---- Ticket Type (row IDs from table 2966) ----
  // Slug in column 21748, icon in 21749
  TYPE: {
    BUG:        57069,  // "bug"        — icon: bug        — #ef4444
    TASK:       57070,  // "task"       — icon: check      — #22c55e
    STORY:      57071,  // "story"      — icon: book       — #3b82f6
    SPIKE:      57072,  // "spike"      — icon: microscope — #a855f7
    PRODUCTION: 57073,  // "production" — icon: factory    — #f59e0b
    LOGISTICS:  57074,  // "logistics"  — icon: truck      — #6366f1
    MARKETING:  57075,  // "marketing"  — icon: megaphone  — #ec4899
    WEBSITE:    57076,  // "website"    — icon: globe      — #14b8a6
  },

  // ---- Agent User IDs (system `users` table, shared across spaces) ----
  // These are the same integer user IDs used by AgentWorkerService.
  // The `users.managed_by_agent_table_id` for Space-36-native agents is 1584.
  AGENT_USERS: {
    ORCHESTRATOR:     18,  // orchestrator@hltrn.cc       — managed_by row 31112 (table 1784)
    DEV_RALPH:        19,  // developer-ralph@hltrn.cc    — managed_by row 31113 (table 1784)
    DEVELOPER:        20,  // developer@hltrn.cc          — managed_by row 33483 (table 1784)
    FRONTEND:         21,  // frontend@hltrn.cc           — managed_by row 31114 (table 1784)
    FRONTEND_QA:      22,  // frontend-qa@hltrn.cc        — managed_by row 33485 (table 1784)
    TEST_RUNNER:      23,  // test-runner@hltrn.cc        — managed_by row 31115 (table 1784)
    ARCHITECT:        24,  // architect@hltrn.cc          — managed_by row 33491 (table 1784)
    TABLE_ARCHITECT:  25,  // table-architect@hltrn.cc    — managed_by row 33487 (table 1784)
    WIDGET_DEVELOPER: 26,  // widget-developer@hltrn.cc   — managed_by row 33488 (table 1784)
    DOCUMENT_AGENT:   28,  // document-agent@hltrn.cc     — managed_by row 33489 (table 1784)
    MARKETER:         51,  // marketer@hltrn.cc           — managed_by row 44465 (table 1784)
    NIKICH:           53,  // nikich@hltrn.cc             — managed_by row 54430 (table 1784)
    FITNESS_COACH:    54,  // fitness-coach@agents.godcrm.local — managed_by row 75107 (table 1784)
    PES:            2392,  // pes@hltrn.cc                — managed_by row 70373 (table 1584) ← Space 36 native
  },

  // ---- Users CRM Table (970) row_id → system user_id ----
  // The Tickets table (3207) column "assigned_to" (col 25140) is a select
  // referencing table 970 with valueColumn = "system_user_id".
  // When the UI stores a row_id from table 970, this map resolves it to
  // the integer user_id that AgentWorkerService expects.
  USERS_TABLE_ROW_TO_USER_ID: {
    10811:  1,  // GERATRON   (Dev User, owner)   — system_user_id from users.id
    10815:  7,  // NIKITRON   (nikitron2392@gmail.com, owner)
    57126: 18,  // Orchestrator (orchestrator@hltrn.cc, admin)
    74566: 24,  // Architect    (architect@hltrn.cc, admin)
    74567: 25,  // Table Architect (table-architect@hltrn.cc, viewer)
  },

  // ---- AI Agents Table (1584) — Agent Row IDs ----
  // These are the row_ids in the AI Agents table for Space 36.
  // Original/Holetron business agents (rows 57101–57109):
  AGENT_ROWS: {
    // --- Holetron business agents ---
    HOLETRON:              57101,  // Main orchestrator for Holetron business
    PRODUCTION_MANAGER:    57102,
    LOGISTICS_COORDINATOR: 57103,
    MARKETING_MANAGER:     57104,
    SALES_MANAGER:         57105,
    WEBSITE_DEVELOPER:     57106,
    HR_MANAGER:            57107,
    QUALITY_INSPECTOR:     57108,
    FINANCE_ANALYST:       57109,

    // --- Pipeline / dev agents (rows 69310–69328) ---
    WORKSPACE_MANAGER:     69310,
    ARCHITECT:             69311,
    GEMINI_ASSISTANT:      69312,
    ADR_WRITER:            69313,
    FRONTEND:              69314,
    ORCHESTRATOR:          69315,
    GPT_ASSISTANT:         69316,
    TABLE_ARCHITECT:       69317,
    MARKETING_STRATEGIST:  69318,
    DOCUMENT_AGENT:        69319,
    DEVELOPER_RALPH:       69320,
    WIDGET_DEVELOPER:      69321,
    FRONTEND_QA:           69322,
    FRONTEND_DEBUGGER:     69323,
    SYSADMIN:              69324,
    DEVELOPER:             69325,
    TEST_RUNNER:           69326,
    AGENT_TEMPLATE:        69327,
    NIKICH:                69328,

    // --- Additional ---
    PES:                   70373,
  },

  // ---- Default values for dispatchSubtask ----
  DEFAULTS: {
    PRIORITY: 57079,  // "high"     (Space 11 uses 24274 = "critical")
    TYPE:     57070,  // "task"     (Space 11 uses 24269 = "task")
  },

  // ---- Ticket Column IDs (table_columns for table 3207) ----
  // The JSONB `data` in table_rows uses column_name as keys (not column IDs),
  // but these are useful for API calls and column-level operations.
  TICKET_COLUMNS: {
    type:                25137,
    adr_ref:             25138,
    priority:            23683,
    state:               25139,
    assigned_to:         25140,
    what:                23680,
    why:                 23682,
    acceptance_criteria: 25141,
    test_steps:          25142,
    created_date:        25143,
    completed_date:      25144,
    phase:               25145,
    scheduled_date:      25146,
    due_date:            23685,
    progress:            25147,
    depends_on:          25148,
    chain_id:            25149,
    cycle:               25150,
    calendar_event:      25151,
  },

  // ---- Agent Activity Column IDs (table_columns for table 3070) ----
  ACTIVITY_COLUMNS: {
    agent_id:      22590,
    task_id:       22591,
    action:        22592,
    timestamp:     22593,
    details:       22594,
    success:       22595,
    duration_ms:   22596,
    tokens_used:   22597,
    cost_usd:      22598,
    error_message: 22599,
  },

  // ---- Quality Reports Column IDs (table_columns for table 3071) ----
  QUALITY_COLUMNS: {
    task_id:          22600,
    report_type:      22601,
    status:           22602,
    tests_total:      22603,
    tests_passed:     22604,
    tests_failed:     22605,
    tests_skipped:    22606,
    coverage_percent: 22607,
    any_count:        22608,
    lighthouse_score: 22609,
    bundle_size_kb:   22610,
    security_issues:  22611,
    a11y_violations:  22612,
    details:          22613,
    created_at:       22614,
  },

  // ---- ADR Projects Column IDs (table_columns for table 3069) ----
  ADR_COLUMNS: {
    adr_number:            22581,
    title:                 22582,
    status:                22583,
    priority:              22584,
    assigned_orchestrator: 22585,
    start_date:            22586,
    end_date:              22587,
    completion_percentage: 22588,
    notes:                 22589,
  },
};


// =============================================================================
// Convenience: Side-by-side comparison table
// =============================================================================
//
// | Concept              | Space 11 (Dev)  | Space 36 (HOLETRON) |
// |----------------------|-----------------|---------------------|
// | Tickets table        |            1708 |                3207 |
// | Agent Activity table |            1701 |                3070 |
// | AI Agents table      |            1784 |                1584 |
// | Quality Reports      |             N/A |                3071 |
// | ADR Projects         |             N/A |                3069 |
// | Users CRM table      |            1782 |                 970 |
// | States dictionary    |             N/A |                2968 |
// | Priority dictionary  |             N/A |                2967 |
// | Type dictionary      |             N/A |                2966 |
// |                      |                 |                     |
// | STATE.BACKLOG        |           24275 |               57081 |
// | STATE.ASSIGNED       |           43436 |               57082 |
// | STATE.IN_PROGRESS    |           24276 |               57083 |
// | STATE.REVIEW         |           24277 |               57084 |
// | STATE.CONTROL        |           43437 |               57085 |
// | STATE.DONE           |           24278 |               57086 |
// | STATE.ON_HOLD        |             N/A |               57087 |
// | STATE.REJECTED       |           43438 |               57088 |
// |                      |                 |                     |
// | PRIORITY.LOW         |             N/A |               57077 |
// | PRIORITY.MEDIUM      |             N/A |               57078 |
// | PRIORITY.HIGH        |             N/A |               57079 |
// | PRIORITY.CRITICAL    |           24274 |               57080 |
// |                      |                 |                     |
// | TYPE.TASK (default)  |           24269 |               57070 |
// | TYPE.BUG             |             N/A |               57069 |
// | TYPE.STORY           |             N/A |               57071 |
// | TYPE.SPIKE           |             N/A |               57072 |
// | TYPE.PRODUCTION      |             N/A |               57073 |
// | TYPE.LOGISTICS       |             N/A |               57074 |
// | TYPE.MARKETING       |             N/A |               57075 |
// | TYPE.WEBSITE         |             N/A |               57076 |
// =============================================================================

export default SPACE_36_CONFIG;

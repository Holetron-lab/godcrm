/**
 * Pipeline Configuration — Unified multi-space config
 *
 * Provides `getPipelineConfig(spaceId)` to resolve per-space table IDs,
 * state/priority/type option IDs, agent user mappings, and other constants
 * needed by ChainHandoffService and related pipeline services.
 *
 * Space 11 (Development) is the default and preserves all existing hardcoded
 * values for backward compatibility.
 *
 * Space 36 (HOLETRON) is the first additional space.
 *
 * To add a new space, add a SPACE_XX_CONFIG block and register it in the
 * CONFIGS map at the bottom of this file.
 */

// =============================================================================
// SPACE 11 (Development) — Matches original hardcoded values in ChainHandoffService
// =============================================================================

const SPACE_11_CONFIG = {
  spaceId: 11,

  TICKETS_TABLE_ID: 1708,
  AGENT_ACTIVITY_TABLE_ID: 1701,
  AI_AGENTS_TABLE_ID: 1784,

  STATE: {
    BACKLOG:     24275,
    ASSIGNED:    43436,
    IN_PROGRESS: 24276,
    REVIEW:      24277,
    CONTROL:     43437,
    REJECTED:    43438,
    DONE:        24278,
  },

  PRIORITY: {
    CRITICAL: 24274,
  },

  TYPE: {
    TASK: 24269,
  },

  DEFAULTS: {
    PRIORITY: 24274,  // "critical" (historical default for Space 11)
    TYPE:     24269,  // "task"
  },

  AGENT_USERS: {
    ORCHESTRATOR:     18,
    DEV_RALPH:        19,
    DEVELOPER:        20,
    FRONTEND:         21,
    FRONTEND_QA:      22,
    TEST_RUNNER:      23,
    ARCHITECT:        24,
    TABLE_ARCHITECT:  25,
    WIDGET_DEVELOPER: 26,
    DOCUMENT_AGENT:   28,
    MARKETER:         51,
    NIKICH:           53,
    FITNESS_COACH:    54,
    SYSADMIN:         67,
  },

  USERS_TABLE_ROW_TO_USER_ID: {
    26283: 19,  // Developer Ralph
    26284: 22,  // Frontend QA
    26285: 21,  // Frontend Developer
    26286: 28,  // Document Agent
    26287: 20,  // Developer
    26288: 24,  // Architect
    36612: 18,  // Orchestrator
  },

  /**
   * Legacy row-ID-to-user-ID mapping for historical assigned_to values
   * that were stored as Users-table row IDs instead of system user IDs.
   */
  ROW_ID_TO_USER_ID: {
    26283: 19,  // Developer Ralph   -> 19
    26285: 21,  // Frontend Developer -> 21
    26284: 22,  // Frontend QA        -> 22
    26287: 20,  // Developer          -> 20
    26288: 24,  // Architect          -> 24
    26286: 28,  // Document Agent     -> 28
  },

  SUPERVISOR_CONFIG: {
    enabled: true,
    supervisor_agent_id: 53,       // Nikich userId
    trigger_at_step: 9,
    max_cycles: 5,
    max_total_tasks: 50,
    max_duration_ms: 8 * 60 * 60 * 1000,
    cycle_cooldown_ms: 5000,
  },
};


// =============================================================================
// SPACE 36 (HOLETRON) — Full pipeline configuration
// =============================================================================

const SPACE_36_CONFIG = {
  spaceId: 36,

  TICKETS_TABLE_ID:         3207,
  AGENT_ACTIVITY_TABLE_ID:  3070,
  AI_AGENTS_TABLE_ID:       1584,
  QUALITY_REPORTS_TABLE_ID: 3071,
  ADR_PROJECTS_TABLE_ID:    3069,

  // Dictionary table IDs (Space 36 only)
  TICKET_STATES_TABLE_ID: 2968,
  PRIORITY_TABLE_ID:      2967,
  TYPE_TABLE_ID:          2966,
  USERS_TABLE_ID:          970,

  STATE: {
    BACKLOG:     57081,
    ASSIGNED:    57082,
    IN_PROGRESS: 57083,
    REVIEW:      57084,
    CONTROL:     57085,
    DONE:        57086,
    ON_HOLD:     57087,
    REJECTED:    57088,
  },

  PRIORITY: {
    LOW:      57077,
    MEDIUM:   57078,
    HIGH:     57079,
    CRITICAL: 57080,
  },

  TYPE: {
    BUG:        57069,
    TASK:       57070,
    STORY:      57071,
    SPIKE:      57072,
    PRODUCTION: 57073,
    LOGISTICS:  57074,
    MARKETING:  57075,
    WEBSITE:    57076,
  },

  DEFAULTS: {
    PRIORITY: 57079,  // "high"
    TYPE:     57070,  // "task"
  },

  AGENT_USERS: {
    ORCHESTRATOR:     18,
    DEV_RALPH:        19,
    DEVELOPER:        20,
    FRONTEND:         21,
    FRONTEND_QA:      22,
    TEST_RUNNER:      23,
    ARCHITECT:        24,
    TABLE_ARCHITECT:  25,
    WIDGET_DEVELOPER: 26,
    DOCUMENT_AGENT:   28,
    MARKETER:         51,
    NIKICH:           53,
    FITNESS_COACH:    54,
    SYSADMIN:         67,
    PES:            2392,
  },

  USERS_TABLE_ROW_TO_USER_ID: {
    10811:  1,  // GERATRON
    10815:  7,  // NIKITRON
    57126: 18,  // Orchestrator
    74566: 24,  // Architect
    74567: 25,  // Table Architect
  },

  ROW_ID_TO_USER_ID: {
    10811:  1,  // GERATRON
    10815:  7,  // NIKITRON
    57126: 18,  // Orchestrator
    74566: 24,  // Architect
    74567: 25,  // Table Architect
  },

  SUPERVISOR_CONFIG: {
    enabled: true,
    supervisor_agent_id: 53,       // Nikich userId (same across spaces)
    trigger_at_step: 9,
    max_cycles: 5,
    max_total_tasks: 50,
    max_duration_ms: 8 * 60 * 60 * 1000,
    cycle_cooldown_ms: 5000,
  },

  // Space-36-specific extras (not present in Space 11)
  AGENT_ROWS: {
    HOLETRON:              57101,
    PRODUCTION_MANAGER:    57102,
    LOGISTICS_COORDINATOR: 57103,
    MARKETING_MANAGER:     57104,
    SALES_MANAGER:         57105,
    WEBSITE_DEVELOPER:     57106,
    HR_MANAGER:            57107,
    QUALITY_INSPECTOR:     57108,
    FINANCE_ANALYST:       57109,
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
    PES:                   70373,
  },

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
// SPACE 35 (Sixtynine) — Full pipeline configuration
// =============================================================================

const SPACE_35_CONFIG = {
  spaceId: 35,

  TICKETS_TABLE_ID:         3679,
  AGENT_ACTIVITY_TABLE_ID:  3680,
  AI_AGENTS_TABLE_ID:       1574,
  QUALITY_REPORTS_TABLE_ID: 3681,

  // Dictionary table IDs
  TICKET_STATES_TABLE_ID: 3682,
  PRIORITY_TABLE_ID:      3683,
  TYPE_TABLE_ID:          3684,
  USERS_TABLE_ID:          940,

  STATE: {
    BACKLOG:     104402,
    ASSIGNED:    104403,
    IN_PROGRESS: 104404,
    REVIEW:      104405,
    CONTROL:     104406,
    DONE:        104407,
    ON_HOLD:     104408,
    REJECTED:    104409,
  },

  PRIORITY: {
    LOW:      104410,
    MEDIUM:   104411,
    HIGH:     104412,
    CRITICAL: 104413,
  },

  TYPE: {
    BUG:        104414,
    TASK:       104415,
    STORY:      104416,
    SPIKE:      104417,
    PRODUCTION: 104418,
    LOGISTICS:  104419,
    MARKETING:  104420,
    WEBSITE:    104421,
  },

  DEFAULTS: {
    PRIORITY: 104412,  // "high"
    TYPE:     104415,  // "task"
  },

  AGENT_USERS: {
    ORCHESTRATOR:     18,
    DEV_RALPH:        19,
    DEVELOPER:        20,
    FRONTEND:         21,
    FRONTEND_QA:      22,
    TEST_RUNNER:      23,
    ARCHITECT:        24,
    TABLE_ARCHITECT:  25,
    WIDGET_DEVELOPER: 26,
    DOCUMENT_AGENT:   28,
    MARKETER:         51,
    NIKICH:           53,
    FITNESS_COACH:    54,
    SYSADMIN:         67,
    PES:            2392,
  },

  USERS_TABLE_ROW_TO_USER_ID: {
    // Will be populated as users are mapped
  },

  ROW_ID_TO_USER_ID: {
    // Will be populated as users are mapped
  },

  SUPERVISOR_CONFIG: {
    enabled: true,
    supervisor_agent_id: 53,       // Nikich userId
    trigger_at_step: 9,
    max_cycles: 5,
    max_total_tasks: 50,
    max_duration_ms: 8 * 60 * 60 * 1000,
    cycle_cooldown_ms: 5000,
  },

  AGENT_ROWS: {
    GENERAL_ASSISTANT:    22259,
    CODE_EXPERT:          22260,
    CONTENT_WRITER:       22261,
    DATA_ANALYST:         22262,
    GPT_ASSISTANT:       104198,
    IMAGE_GENERATOR:     104204,
    SUMMARY:             104205,
    PES:                 104206,
    N:                   104207,
    HOLETRON:            104208,
    TRAINER:             104209,
    FITNESS_TRAINER:     104210,
    NIKICH:              104211,
    MARKETING_STRATEGIST:104212,
    AGENT_TEMPLATE:      104213,
    ARCHITECT:           104214,
    ADR_WRITER:          104215,
    DOCUMENT_AGENT:      104216,
    WIDGET_DEVELOPER:    104217,
    TABLE_ARCHITECT:     104218,
    FRONTEND_DEBUGGER:   104219,
    FRONTEND_QA:         104220,
    SYSADMIN:            104221,
    DEVELOPER:           104222,
    TEST_RUNNER:         104223,
    FRONTEND:            104224,
    DEVELOPER_RALPH:     104225,
    ORCHESTRATOR:        104226,
    WORKSPACE_MANAGER:   104227,
  },

  TICKET_COLUMNS: {
    what:                26678,
    why:                 26679,
    state:               26680,
    priority:            26681,
    type:                26682,
    assigned_to:         26683,
    acceptance_criteria: 26684,
    test_steps:          26685,
    created_date:        26686,
    completed_date:      26687,
    phase:               26688,
    scheduled_date:      26689,
    due_date:            26690,
    progress:            26691,
    depends_on:          26692,
    chain_id:            26693,
    cycle:               26694,
    calendar_event:      26695,
    adr_ref:             26696,
  },

  ACTIVITY_COLUMNS: {
    agent_id:      26697,
    task_id:       26698,
    action:        26699,
    timestamp:     26700,
    details:       26701,
    success:       26702,
    duration_ms:   26703,
    tokens_used:   26704,
    cost_usd:      26705,
    error_message: 26706,
  },

  QUALITY_COLUMNS: {
    task_id:          26707,
    report_type:      26708,
    status:           26709,
    tests_total:      26710,
    tests_passed:     26711,
    tests_failed:     26712,
    tests_skipped:    26713,
    coverage_percent: 26714,
    details:          26715,
    created_at:       26716,
  },
};


// =============================================================================
// Registry — add new spaces here
// =============================================================================

const CONFIGS = {
  11: SPACE_11_CONFIG,
  35: SPACE_35_CONFIG,
  36: SPACE_36_CONFIG,
};

const DEFAULT_SPACE_ID = 11;

/**
 * Get pipeline configuration for a given space.
 *
 * @param {number|string} [spaceId] - Space ID (defaults to 11)
 * @returns {Object} Pipeline config object for the requested space
 * @throws {Error} If space ID is not registered
 */
export function getPipelineConfig(spaceId) {
  const id = spaceId != null ? Number(spaceId) : DEFAULT_SPACE_ID;
  const config = CONFIGS[id];
  if (!config) {
    throw new Error(`No pipeline config registered for space ${id}. Available: ${Object.keys(CONFIGS).join(', ')}`);
  }
  return config;
}

/**
 * List all registered space IDs.
 * @returns {number[]}
 */
export function getRegisteredSpaceIds() {
  return Object.keys(CONFIGS).map(Number);
}

export { SPACE_11_CONFIG, SPACE_35_CONFIG, SPACE_36_CONFIG, DEFAULT_SPACE_ID };
export default getPipelineConfig;

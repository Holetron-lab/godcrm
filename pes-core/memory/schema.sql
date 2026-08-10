-- ============================================================
-- PES v2 — Clean SQLite Schema (Level-Unlock Architecture)
-- ============================================================
-- Every feature is gated by level. PES grows from nothing.
-- Tables exist from birth but methods unlock progressively.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Core: config ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ── Core: stats (singleton) ──────────────────────────────
CREATE TABLE IF NOT EXISTS stats (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    -- progression
    xp                  INTEGER NOT NULL DEFAULT 0,
    level               REAL    NOT NULL DEFAULT 0.0 CHECK (level >= 0.0 AND level <= 100.0),
    phase               TEXT    NOT NULL DEFAULT 'puppy' CHECK (phase IN ('puppy','young','adult','experienced','cyber')),
    -- vitals (0.0-1.0)
    mood                REAL NOT NULL DEFAULT 0.5,
    energy              REAL NOT NULL DEFAULT 0.8,
    hunger              REAL NOT NULL DEFAULT 0.2,
    curiosity           REAL NOT NULL DEFAULT 0.7,
    loneliness          REAL NOT NULL DEFAULT 0.3,
    -- character traits (0.0-1.0)
    courage             REAL NOT NULL DEFAULT 0.3,
    curiosity_trait     REAL NOT NULL DEFAULT 0.8,
    loyalty             REAL NOT NULL DEFAULT 0.5,
    stubbornness        REAL NOT NULL DEFAULT 0.4,
    playfulness         REAL NOT NULL DEFAULT 0.9,
    drama               REAL NOT NULL DEFAULT 0.6,
    food_obsession      REAL NOT NULL DEFAULT 0.7,
    sass                REAL NOT NULL DEFAULT 0.5,
    aggression          REAL NOT NULL DEFAULT 0.3,
    -- White Fang phases JSON
    trait_phases        TEXT NOT NULL DEFAULT '{}',
    -- counters
    interactions_total  INTEGER NOT NULL DEFAULT 0,
    commands_learned    INTEGER NOT NULL DEFAULT 0,
    times_praised       INTEGER NOT NULL DEFAULT 0,
    times_scolded       INTEGER NOT NULL DEFAULT 0,
    session_count       INTEGER NOT NULL DEFAULT 0,
    -- timestamps
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    critical_period_end TEXT DEFAULT NULL,
    last_interaction    TEXT DEFAULT NULL
);
INSERT OR IGNORE INTO stats (id) VALUES (1);

-- ── Unlocks: level-gated features ────────────────────────
-- Populated on birth. Tracks what's available at each level.
CREATE TABLE IF NOT EXISTS unlocks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    feature     TEXT    NOT NULL UNIQUE,
    level_req   INTEGER NOT NULL DEFAULT 0,
    unlocked    INTEGER NOT NULL DEFAULT 0,
    unlocked_at TEXT    DEFAULT NULL,
    category    TEXT    NOT NULL DEFAULT 'core' CHECK (category IN ('core','emotion','sound','ability','crm','social'))
);

-- ── XP log (append-only) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS xp_log (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    amount    INTEGER NOT NULL,
    reason    TEXT    NOT NULL,
    detail    TEXT    DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_xp_log_ts ON xp_log (timestamp);

-- ── Interactions (append-only) ───────────────────────────
CREATE TABLE IF NOT EXISTS interactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actor           TEXT    NOT NULL,
    action_type     TEXT    NOT NULL,
    action_detail   TEXT    DEFAULT NULL,
    emotion_before  TEXT    DEFAULT NULL,
    emotion_after   TEXT    DEFAULT NULL,
    xp_gained       INTEGER NOT NULL DEFAULT 0,
    context         TEXT    DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_ts ON interactions (timestamp);

-- ── Relationships ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relationships (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    entity              TEXT    NOT NULL UNIQUE,
    trust               REAL    NOT NULL DEFAULT 0.0,
    affection           REAL    NOT NULL DEFAULT 0.0,
    interactions_count  INTEGER NOT NULL DEFAULT 0,
    relationship_phase  TEXT    NOT NULL DEFAULT 'stranger',
    first_met           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Commands ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commands (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    input       TEXT    NOT NULL,
    category    TEXT    NOT NULL DEFAULT 'custom',
    understood  INTEGER NOT NULL DEFAULT 0,
    attempts    INTEGER NOT NULL DEFAULT 0,
    willingness REAL    NOT NULL DEFAULT 0.5,
    success_rate REAL   NOT NULL DEFAULT 0.0,
    learned_at  TEXT    DEFAULT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_commands_input ON commands (input);

-- ── Reaction memory ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS reaction_memory (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    pes_action      TEXT    NOT NULL,
    reactor         TEXT    NOT NULL,
    reaction_type   TEXT    NOT NULL,
    reaction_value  TEXT    DEFAULT NULL,
    weight          REAL    NOT NULL DEFAULT 0.0,
    platform        TEXT    DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_reaction_ts ON reaction_memory (timestamp);

-- ── Learned stickers ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS learned_stickers (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id           TEXT    NOT NULL,
    file_unique_id    TEXT    NOT NULL UNIQUE,
    set_name          TEXT    DEFAULT NULL,
    emoji             TEXT    DEFAULT NULL,
    emotion_key       TEXT    DEFAULT NULL,
    times_seen        INTEGER NOT NULL DEFAULT 1,
    times_used        INTEGER NOT NULL DEFAULT 0,
    preference_score  REAL    NOT NULL DEFAULT 0.0,
    first_seen        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stickers_emotion ON learned_stickers (emotion_key);

-- ── Learned emojis ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS learned_emojis (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    emoji             TEXT    NOT NULL UNIQUE,
    emotion_key       TEXT    DEFAULT NULL,
    times_seen        INTEGER NOT NULL DEFAULT 1,
    times_used        INTEGER NOT NULL DEFAULT 0,
    owner_sent        INTEGER NOT NULL DEFAULT 0,
    preference_score  REAL    NOT NULL DEFAULT 0.0,
    first_seen        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_emojis_owner ON learned_emojis (owner_sent, times_seen);

-- ── Owner notes (Level 3 unlock) ─────────────────────────
CREATE TABLE IF NOT EXISTS owner_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    TEXT    NOT NULL,
    text        TEXT    NOT NULL,
    tags        TEXT    NOT NULL DEFAULT '[]',
    category    TEXT    DEFAULT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    remind_at   TEXT    DEFAULT NULL,
    remind_sent INTEGER NOT NULL DEFAULT 0,
    is_deleted  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_remind ON owner_notes (remind_at) WHERE remind_at IS NOT NULL AND remind_sent = 0;
CREATE INDEX IF NOT EXISTS idx_notes_owner ON owner_notes (owner_id, is_deleted);

-- ── Reminders (Level 4 unlock) ───────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    text        TEXT    NOT NULL,
    remind_at   TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    delivered   INTEGER NOT NULL DEFAULT 0,
    delivered_at TEXT   DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (delivered, remind_at) WHERE delivered = 0;

-- ── Owner files (Level 6 unlock) ─────────────────────────
CREATE TABLE IF NOT EXISTS owner_files (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id                TEXT    NOT NULL,
    telegram_file_id        TEXT    NOT NULL,
    telegram_file_unique_id TEXT    NOT NULL UNIQUE,
    file_type               TEXT    NOT NULL DEFAULT 'document',
    file_name               TEXT    DEFAULT NULL,
    description             TEXT    DEFAULT NULL,
    tags                    TEXT    NOT NULL DEFAULT '[]',
    is_deleted              INTEGER NOT NULL DEFAULT 0,
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Owner contacts (Level 8 unlock) ─────────────────────
CREATE TABLE IF NOT EXISTS owner_contacts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id          TEXT    NOT NULL,
    name              TEXT    NOT NULL,
    phone             TEXT    DEFAULT NULL,
    email             TEXT    DEFAULT NULL,
    birthday          TEXT    DEFAULT NULL,
    relationship      TEXT    DEFAULT NULL,
    notes             TEXT    DEFAULT NULL,
    is_deleted        INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Sessions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ended_at           TEXT    DEFAULT NULL,
    interactions_count INTEGER NOT NULL DEFAULT 0,
    xp_earned          INTEGER NOT NULL DEFAULT 0
);

-- ── Letters ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS letters (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    letter_type TEXT    NOT NULL,
    recipient   TEXT    NOT NULL,
    content     TEXT    NOT NULL,
    read        INTEGER NOT NULL DEFAULT 0
);

-- ── Pet spells (Level 13+ unlock) ────────────────────────
CREATE TABLE IF NOT EXISTS pet_spells (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trait         TEXT    NOT NULL,
    level         INTEGER NOT NULL CHECK (level >= 1 AND level <= 13),
    name          TEXT    NOT NULL,
    rarity        TEXT    NOT NULL,
    source        TEXT    NOT NULL DEFAULT 'birth',
    hidden        INTEGER NOT NULL DEFAULT 1,
    active        INTEGER NOT NULL DEFAULT 1,
    unlocked_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(trait, level)
);

-- ── Sticker discovery ────────────────────────────────────
CREATE TABLE IF NOT EXISTS sticker_discovery (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    set_name        TEXT    NOT NULL UNIQUE,
    source          TEXT    NOT NULL DEFAULT 'owner',
    status          TEXT    NOT NULL DEFAULT 'found',
    stickers_total  INTEGER NOT NULL DEFAULT 0,
    stickers_tried  INTEGER NOT NULL DEFAULT 0,
    owner_likes     INTEGER NOT NULL DEFAULT 0,
    match_score     REAL    NOT NULL DEFAULT 0.0,
    discovered_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Babble state persistence ─────────────────────────────
CREATE TABLE IF NOT EXISTS babble_state (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    invented_sounds TEXT    NOT NULL DEFAULT '[]',
    owner_emojis    TEXT    NOT NULL DEFAULT '[]',
    sound_memory    TEXT    NOT NULL DEFAULT '[]',
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO babble_state (id) VALUES (1);

-- ── Workflow runs (Level 8+ unlock) ─────────────────────
CREATE TABLE IF NOT EXISTS workflow_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id   TEXT    NOT NULL,
    success       INTEGER NOT NULL DEFAULT 1,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    result_data   TEXT    DEFAULT NULL,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_ts ON workflow_runs (created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf ON workflow_runs (workflow_id);

-- ── Pet Friendships (Level 10+ unlock) ─────────────────
CREATE TABLE IF NOT EXISTS pet_friendships (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    friend_chat_id    TEXT    NOT NULL,
    friend_pet_name   TEXT    NOT NULL,
    friend_breed      TEXT    DEFAULT NULL,
    status            TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','blocked')),
    trust_level       REAL    NOT NULL DEFAULT 0.0,
    gifts_sent        INTEGER NOT NULL DEFAULT 0,
    gifts_received    INTEGER NOT NULL DEFAULT 0,
    last_interaction  TEXT    DEFAULT NULL,
    created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(friend_chat_id)
);

-- ── Pet Gifts log ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS pet_gifts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    direction       TEXT    NOT NULL CHECK (direction IN ('sent','received')),
    friend_chat_id  TEXT    NOT NULL,
    gift_type       TEXT    NOT NULL,
    gift_name       TEXT    NOT NULL,
    gift_emoji      TEXT    DEFAULT NULL,
    mood_effect     REAL    NOT NULL DEFAULT 0.05,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_gifts_friend ON pet_gifts (friend_chat_id);

-- ── Daily Streaks ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_streaks (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    current_streak  INTEGER NOT NULL DEFAULT 0,
    longest_streak  INTEGER NOT NULL DEFAULT 0,
    last_active_date TEXT   DEFAULT NULL,
    total_active_days INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO daily_streaks (id) VALUES (1);

-- ── Achievements ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key             TEXT    NOT NULL UNIQUE,
    name            TEXT    NOT NULL,
    description     TEXT    NOT NULL,
    emoji           TEXT    NOT NULL DEFAULT '🏅',
    category        TEXT    NOT NULL DEFAULT 'general',
    threshold       INTEGER NOT NULL DEFAULT 1,
    unlocked        INTEGER NOT NULL DEFAULT 0,
    unlocked_at     TEXT    DEFAULT NULL,
    progress        INTEGER NOT NULL DEFAULT 0
);

-- ── View: quick PES status ───────────────────────────────
CREATE VIEW IF NOT EXISTS pes_summary AS
SELECT
    s.xp, s.level, s.phase,
    s.mood, s.energy, s.hunger, s.curiosity, s.loneliness,
    s.courage, s.curiosity_trait, s.loyalty, s.stubbornness,
    s.playfulness, s.drama, s.food_obsession, s.sass, s.aggression,
    s.interactions_total, s.commands_learned,
    s.times_praised, s.times_scolded,
    s.created_at, s.last_interaction,
    (SELECT COUNT(*) FROM interactions WHERE timestamp > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day')) AS interactions_24h,
    (SELECT COUNT(*) FROM unlocks WHERE unlocked = 1) AS features_unlocked,
    (SELECT COUNT(*) FROM unlocks WHERE unlocked = 0) AS features_locked
FROM stats s WHERE s.id = 1;

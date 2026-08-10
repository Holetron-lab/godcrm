// ============================================================
// PES Platform — Telegram Adapter
// ============================================================
// Connects PES to Telegram via Bot API (raw fetch, 0 deps).
//
// Features:
//   - Sticker delivery (from ANY public sticker pack)
//   - Emoji reactions on owner messages (setMessageReaction)
//   - Reaction collection (message_reaction updates → feedback loop)
//   - Bot commands (/start, /status, /feed, /command, /silent, /stickers)
//   - Keyword parser (привет→greeting, молодец→praise)
//   - "Typing..." delay scaled by PES level
//   - Sticker pack hot-swap
//
// Dependencies: 0 (uses built-in fetch)
// ============================================================

import { PesPlatformAdapter, RENDER_MODE, PRESENCE, MEDIA_TYPE } from './base.js';
import { sleep } from '../utils.js';
import { LLMAdapter } from '../brain/llm-adapter.js';
import { buildSystemPrompt, buildMessages } from '../brain/prompt-builder.js';
import { BabbleEngine } from '../soul/babble-engine.js';
import { CrmClient } from './crm-client.js';
import { WorkflowEngine } from '../core/workflows.js';

// Valid emotions for LLM classification — must match babble-engine EMOTION_INSTRUMENTS keys
const EMOTION_INSTRUMENTS_SET = new Set([
  'happy', 'playful', 'greeting_frenzy', 'butt_wiggle', 'zoomies', 'excited',
  'idle', 'content', 'nap', 'sleep',
  'sad', 'lonely', 'scared', 'anxious',
  'food_obsessed', 'hungry',
  'alert', 'angry', 'bark',
  'curious', 'puzzle_solving',
  'dramatic_tantrum', 'sulking', 'stubborn_refuse',
]);
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __tg_dirname = dirname(fileURLToPath(import.meta.url));
const DEV_LOG_DIR = join(__tg_dirname, '..', 'pes-data');
const DEV_LOG_FILE = join(DEV_LOG_DIR, 'dev-requests.log');


// ── TELEGRAM API BASE ─────────────────────────────────────

const TG_API = 'https://api.telegram.org/bot';

// ── TELEGRAM ALLOWED REACTION EMOJI ──────────────────────
// Telegram only allows a specific set of emoji for reactions.
// This is the official list for regular (non-premium) reactions.
const ALLOWED_REACTIONS = new Set([
  '👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱', '🤬', '😢', '🎉',
  '🤩', '🤮', '💩', '✍️', '👀', '🎅', '🎄', '☃️', '💅', '🤪', '🗿', '🆒', '💘',
  '🙈', '😇', '😨', '🤝', '✊', '🫡', '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾',
  '💋', '🖕', '😈', '😴', '😭', '🤓', '👻', '👨‍💻', '🎃', '🙏', '🤡', '🥱', '🥴',
  '😍', '🐳', '❤️‍🔥', '🌚', '🌭', '💯', '🤣', '⚡', '🍕', '😘', '💊', '🙊',
  '😎', '👾', '🤷', '🤷‍♂️', '🤷‍♀️', '😡',
]);

// ── KEYWORD PATTERNS ──────────────────────────────────────

const KEYWORDS = {
  greetings: {
    patterns: [/^привет/i, /^здравствуй/i, /^хай/i, /^hi\b/i, /^hello/i, /^hey\b/i, /^yo\b/i, /^салам/i, /^дарова/i],
    event: { type: 'owner_returned', from: 'owner' },
  },
  praise: {
    patterns: [/молодец/i, /хорош/i, /класс/i, /супер/i, /отлично/i, /круто/i, /\bgood\b/i, /\bgreat\b/i, /\bnice\b/i, /\bperfect/i, /\bawesome/i, /умница/i, /браво/i, /ура/i],
    action: 'praise',
  },
  scold: {
    patterns: [/^нет$/i, /^нет[,.\s!]/i, /плохо/i, /^стоп$/i, /^стоп[,.\s!]/i, /не надо/i, /хватит/i, /\bbad\b/i, /\bstop\b/i, /\bno\b/i, /\bwrong\b/i, /фу/i, /нельзя/i],
    action: 'scold',
  },
  file_search: {
    patterns: [/где мо[йяеи]/i, /найди файл/i, /найди фото/i, /найди документ/i, /принеси файл/i, /принеси фото/i, /принеси документ/i, /покажи файл/i, /покажи фото/i, /где файл/i, /где фото/i, /где документ/i, /где паспорт/i, /где страховк/i, /где договор/i],
    action: 'file_search',
  },
  fetch: {
    patterns: [/^принеси/i, /^найди/i, /^ищи/i, /^fetch\b/i, /^find\b/i, /^search\b/i, /^апорт/i, /^мячик/i],
    action: 'command',
    command: 'fetch',
  },
  status: {
    patterns: [/как дела/i, /как ты/i, /статус/i, /\bstatus\b/i, /что нового/i, /как жизнь/i],
    action: 'status',
  },
  feed: {
    patterns: [/^кушай/i, /^ешь/i, /^на\s/i, /^держи/i, /^feed\b/i],
    action: 'feed',
  },
  play: {
    patterns: [/^играть/i, /^играем/i, /^play\b/i, /^давай играть/i],
    event: { type: 'play_initiated', from: 'owner' },
  },
  triage: {
    patterns: [/^что.?нов(ого|ое)/i, /^triage/i, /^триаж/i, /^проверь crm/i, /^скань/i],
    action: 'workflow',
    command: 'triage',
  },
  daily_summary: {
    patterns: [/итоги дня/i, /итоги за день/i, /расскажи итоги/i, /daily.?summary/i, /сводка/i, /^отчёт$/i, /^отчет$/i],
    action: 'workflow',
    command: 'daily_summary',
  },
  health: {
    patterns: [/^здоровье$/i, /^health$/i, /как здоровье/i, /проверь себя/i, /самочувствие/i],
    action: 'workflow',
    command: 'health_check',
  },
};


// ── STICKER EMOTION MAP (default mapping) ─────────────────

const DEFAULT_STICKER_EMOTION_MAP = {
  // body keys → sticker keys
  butt_wiggle_turbo: 'happy',
  butt_wiggle_fast:  'excited',
  butt_wiggle_slow:  'interested',
  no_wiggle:         'sad',
  ears_forward:      'alert',
  ears_flat:         'scared',
  sploot:            'relaxed',
  play_bow:          'playful',
  corgi_flop:        'trust',
  zoomies:           'zoomies',
  sleep_curl:        'sleeping',
  low_crouch:        'working',
  freeze:            'alert',
  hide_behind:       'scared',
  belly_up:          'submissive',
  nose_nudge:        'curious',
  paw_lift:          'asking',
  head_tilt:         'confused',
  spin:              'excited',
  bunny_hop:         'happy',
};


// ── BODY ACTION SYMBOLS (no human words — only sounds, emoji, symbols) ───
// Animals don't describe actions in words. They EXPRESS through sounds + emoji.

const BODY_ACTIONS = {
  butt_wiggle_turbo: ['🍑💨💨💨', '🍑⚡⚡', '🍑🌀🌀🌀'],
  butt_wiggle_fast:  ['🍑💨', '🍑~~', '🍑✨'],
  butt_wiggle_slow:  ['🍑~', '🍑...'],
  no_wiggle:         ['🍑.', '...'],
  ears_forward:      ['👂⬆️👂', '👂❗', '📡📡'],
  ears_airplane:     ['👂↔️👂', '✈️👂'],
  ears_one_up:       ['👂⬆️👂↗️', '👂❓'],
  ears_flat:         ['👂⬇️👂', '👂...'],
  ears_twitching:    ['👂〰️👂', '👂⚡'],
  sploot:            ['🫠', '___🐾', '⬇️🫠'],
  play_bow:          ['🔽🐾⬆️🍑', '⬇️🐾 ⬆️🍑', '🐾↘️ 🍑↗️'],
  corgi_flop:        ['💥🫠', '🐾→🫠'],
  low_crouch:        ['🐾⬇️⬇️', '👀⬇️🐾'],
  belly_up:          ['🔄🐾☁️', '⬆️🫄', '🐾🔄☁️'],
  lean:              ['🐾→💛', '↗️💛', '🐾~💛'],
  body_block:        ['🐾🚧', '⛔🐾'],
  bunny_hop:         ['🐾⬆️⬆️⬆️', '🐾↗️↗️', '⬆️⬆️⬆️'],
  spin:              ['🌀🐾🌀', '🔄🐾', '🌀🌀'],
  paw_tap:           ['🐾👆', '🐾👆👆', '🐾❗'],
  nose_nudge:        ['👃💨', '👃→', '👃❗'],
  side_eye:          ['👀↗️', '👀...', '🫣'],
  hide_behind:       ['🫣🐾', '👀...🐾'],
  circle:            ['🔄🐾🔄', '🐾↻↻'],
  zoomies:           ['🐾💨💨💨💨', '⚡🐾⚡', '🏃💨💨'],
  freeze:            ['🐾...⏸️', '❄️🐾', '⏸️...'],
  sleep_curl:        ['💤🐾', '😴💤', '🐾~💤'],
  head_tilt:         ['🐾↗️❓', '😮❓'],
  paw_lift:          ['🐾⬆️', '🐾☝️'],
};

// ── PUPPY BABBLE — random personality phrases ────────────

const PUPPY_BABBLE = {
  idle:     ['', '', '', 'ууу~...', 'ыыы...', 'скууу...'],
  playful:  ['тяф тяф!! ваф!!', 'ЫЫЫ!! ваф-ваф!!', 'рру!! тяф!!', 'гав ГАВ!!', ''],
  happy:    ['', '', 'ррууу~ ♡', '💛', 'ваф!!'],
  content:  ['', 'ммм~...', 'рру~...', 'ууу~'],
  butt_wiggle: ['', '', 'ыыыЫЫЫ!!', 'рррРРР!!'],
  alert:    ['ГАВ?!', 'рр!! ваф!!', 'ррр?! ууу?!', 'ВАФ!!'],
  scared:   ['ууу...', 'хнн...', '😱', ''],
  grumble:  ['хмфф.', 'ррр.', 'мрр...', 'пфф.'],
  food_obsessed: ['МНЯМ!!', 'хрум хрум!!', 'ааау мням!!', 'ваф! ваф! мням!!'],
  zoomies:  ['ЫЫЫЫ!!', 'РРРР!!', 'ВАФФФ!!', 'АААУУУ!!'],
  puppy_eyes: ['ууу~...', '🥺', 'скууу~...'],
  sad:      ['...', 'хнн...', '', '💧'],
  sleep:    ['zzz...', 'хррр...', '💤', 'ммрр...'],
};

// ── OWNER REPLY PHRASES — for when PES reacts to owner ───

const OWNER_REPLIES = {
  greeting: [
    'ГАВВВ!! рруу ууу ыыыа!! ♡ тяф-тяф!!',
    'ыыыЫЫЫ!! ваф ваф ВАФ!! 💛💛',
    'ррРРуууу!! гав! гав! ГАААВ!! ♡♡',
    'тяф-тяф-тяф!! ууууу!! 💛💛💛',
  ],
  praise: [
    'ррРРРуууу!! ыыыыы гав-гав ~~ ♡♡ вввуууф!!',
    'ууууУУУ!! тяф! тяф! 💛💛💛!!',
    'ммммм~ рру~ ♡ ууу~... ваф!',
    'ЫЫЫЫ!! рр рр РРРР!! ♡♡♡!!',
  ],
  scold: [
    'скууу... ыыы.. хнн.. 💧',
    'ууу... хнн... ... 💧',
    '... хххн.. скс.. ...',
    'скууу...... .......',
  ],
  feed: [
    'МНЯМ мням мням!! ррр ффф хрум-хрум ааау!!',
    'ваф! ваф! МНЯМ!! хрум хрум!! 🤤',
    'АААУ!! мням-мням-МНЯМ!! ррр!!',
    'хрум!! хрум!! МНЯЯЯМ!! ваф!!',
  ],
  generic: [
    'рру? ...тяф? 🐾',
    'ваф. ...ыы? ...рру~',
    'гав? ...ууу~ 🐾',
    'тяф! рру~ ваф?',
    'ыыы~ ...рр? 🐾',
  ],
};

// ── EMOTION → EMOJI STATUS MAP ──────────────────────────
// Maps PES emotion states to emoji for bot bio / status display

const EMOTION_EMOJI_STATUS = {
  happy:            { emoji: '😊', label: 'счастлив', short: '💛 счастлив' },
  playful:          { emoji: '🎾', label: 'играет', short: '🎾 играет' },
  greeting_frenzy:  { emoji: '🤩', label: 'в восторге', short: '🤩 в восторге' },
  butt_wiggle:      { emoji: '🍑', label: 'виляет', short: '🍑 виляет хвостом' },
  zoomies:          { emoji: '⚡', label: 'зумис', short: '⚡ зумис!!' },
  excited:          { emoji: '🎉', label: 'возбуждён', short: '🎉 возбуждён' },
  idle:             { emoji: '😐', label: 'скучает', short: '😐 скучает' },
  content:          { emoji: '☺️', label: 'доволен', short: '☺️ доволен' },
  nap:              { emoji: '😪', label: 'дремлет', short: '😪 дремлет' },
  sleep:            { emoji: '💤', label: 'спит', short: '💤 спит' },
  sad:              { emoji: '😢', label: 'грустит', short: '😢 грустит' },
  lonely:           { emoji: '🥺', label: 'скучает', short: '🥺 скучает по хозяину' },
  scared:           { emoji: '😨', label: 'испуган', short: '😨 испуган' },
  anxious:          { emoji: '😰', label: 'тревожен', short: '😰 тревожится' },
  food_obsessed:    { emoji: '🤤', label: 'голоден', short: '🤤 хочет есть' },
  hungry:           { emoji: '🍖', label: 'голоден', short: '🍖 голоден' },
  alert:            { emoji: '👀', label: 'настороже', short: '👀 настороже' },
  angry:            { emoji: '😤', label: 'злится', short: '😤 злится' },
  bark:             { emoji: '🐕', label: 'лает', short: '🐕 ГАВ!' },
  curious:          { emoji: '🔍', label: 'исследует', short: '🔍 исследует' },
  puzzle_solving:   { emoji: '🧩', label: 'думает', short: '🧩 решает задачу' },
  dramatic_tantrum: { emoji: '🎭', label: 'драматизирует', short: '🎭 драма!' },
  sulking:          { emoji: '😒', label: 'дуется', short: '😒 дуется' },
  stubborn_refuse:  { emoji: '🙅', label: 'упрямится', short: '🙅 не хочу!' },
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── THINKING DELAY per level ──────────────────────────────

function thinkingDelay(level) {
  // Level gates removed — fast response for testing
  return 500 + Math.random() * 500; // 0.5-1s
}


// ── TELEGRAM ADAPTER ──────────────────────────────────────

class TelegramAdapter extends PesPlatformAdapter {
  /**
   * @param {Pes}    pes     — PES instance
   * @param {Object} config
   * @param {string} config.botToken       — Telegram Bot API token
   * @param {string|number} config.chatId  — Chat ID with owner
   * @param {string}  [config.stickerPack]   — sticker pack name to load
   * @param {Object}  [config.stickerMapping] — { stickerIndex: emotionKey }
   * @param {number}  [config.pollingInterval] — ms between getUpdates (default: 2000)
   * @param {boolean} [config.useThinkingDelay] — show "typing..." before reply (default: true)
   * @param {string}  [config.ownerUsername]  — owner's Telegram username (for identity check)
   */
  constructor(pes, config = {}) {
    super(pes, {
      platformName: 'telegram',
      renderMode: RENDER_MODE.RICH,
      ...config,
    });

    if (!config.botToken) throw new Error('TelegramAdapter: botToken required');
    if (!config.chatId) throw new Error('TelegramAdapter: chatId required');

    this.botToken = config.botToken;
    this.chatId = String(config.chatId);
    this.ownerUsername = config.ownerUsername || null;
    this.pollingInterval = config.pollingInterval || 2000;
    this.useThinkingDelay = config.useThinkingDelay !== false;

    // Polling state
    this._pollOffset = 0;
    this._polling = false;
    this._pollTimer = null;

    // Last owner message ID (for reactions)
    this._lastOwnerMessageId = null;

    // Sticker pack info
    this._currentStickerPack = config.stickerPack || null;
    this._stickerMapping = config.stickerMapping || {};
    this._learnedPacks = new Set(); // all packs learned from owner's stickers

    // Bot info (filled on first API call)
    this._botInfo = null;

    // ── LLM Brain ──────────────────────────────────────
    this._llm = null;
    if (config.llmApiKey) {
      this._llm = new LLMAdapter({
        apiKey: config.llmApiKey,
        model: config.llmModel || 'gpt-4o-mini',
        timeout: 5000,
        maxTokens: 200,
      });
    }
    this._characterDesc = config.characterDesc || null;

    // ── Orchestrator LLM (live chat mode via /orchestrator) ──
    this._orchestratorLLM = null;
    if (config.llmApiKey) {
      this._orchestratorLLM = new LLMAdapter({
        apiKey: config.llmApiKey,
        model: 'gpt-4o',
        timeout: 30000,
        maxTokens: 1500,
      });
    }
    this._orchestratorHistory = []; // conversation memory for orchestrator mode
    this._orchestratorHistoryLimit = 30;

    // ── Shadow Orchestrator — always-on observer ──
    this._shadowBuffer = [];          // last N messages for context
    this._shadowBufferLimit = 50;     // how many messages to remember
    this._shadowEnabled = true;       // always on
    // Trigger keywords that summon orchestrator inline (PES stays active)
    this._shadowTriggers = /^(N23|n23|оркестратор|orchestrator|фикс|fix|почини|repair|диагноз|diagnose|анализ|analyze|проблема|problem|баг|bug|что не так|what.?s wrong)/i;

    // ── Short Memory with context compression ──
    this._memory = [];
    this._memoryLimit = 10;
    this._contextSummary = ''; // accumulated compressed context from past messages
    this._summarizing = false; // lock to prevent concurrent summarization

    // ── Emoji learning ──
    this._emojiAnalysisQueue = []; // emojis waiting for LLM description
    this._analyzingEmojis = false;

    // ── Sticker learning ──
    this._stickerAnalysisQueue = []; // stickers waiting for LLM description
    this._analyzingStickers = false;

    // ── Reminders ──
    this._reminderInterval = null;

    // ── File handling ──
    this._fileAnalysisQueue = []; // files waiting for LLM description
    this._analyzingFiles = false;
    // Per-user files directory in managed mode
    this._filesDir = config.managed
      ? join(__tg_dirname, '..', 'pes-data', 'users', String(config.chatId), 'files')
      : join(__tg_dirname, '..', 'pes-data', 'files');
    this._maxFileSizeMB = 20; // max file size in MB
    this._maxDiskQuotaMB = 500; // max total disk usage in MB

    // ── Reaction Memory ──
    this._lastBotAction = null;   // { action: 'reply', text: '...', category: '...', timestamp: Date.now() }
    this._reactionRecalcCounter = 0; // recalculate preferences every N reactions
    this._recentReactions = [];   // last 8 reactions for anti-repeat
    this._dailyReactionLog = [];  // all reactions today for diversity tracking

    // ── Sticker Mirror (delayed "try back") ──
    this._pendingMirrorSticker = null; // { fileId, fileUniqueId, emoji, receivedAt, messagesUntilMirror }
    this._messagesSinceMirror = 0;

    // ── Last sent sticker tracking (for reaction → preference_score) ──
    this._lastSentStickerUniqueId = null;
    this._recentSentStickers = []; // last 10 sent sticker unique_ids — for anti-repeat

    // ── Babble Engine — use PES's engine if available, else create own ──
    if (pes?.babble) {
      this._babble = pes.babble;
    } else {
      const pesSeed = pes?.identity?.seed || 0.42;
      const pesTraits = pes?.emotions?.traits || {};
      this._babble = new BabbleEngine(pesSeed, pesTraits);
      if (pes?.store) {
        try {
          const babbleData = pes.store.getBabbleState?.();
          if (babbleData) this._babble.load(babbleData);
        } catch (_) {}
      }
    }

    // ── CRM Client (bidirectional bridge) ──
    this._crm = null;
    if (config.jwtSecret) {
      this._crm = new CrmClient({
        baseUrl: config.crmBaseUrl || 'http://127.0.0.1:5000',
        jwtSecret: config.jwtSecret,
        spaceId: config.crmSpaceId || 11,
      });
    }

    // ── Workflow Engine (agentic workflows) ──
    this._workflows = new WorkflowEngine({
      store: pes?.store,
      crm: this._crm,
      pes: pes,
    });

    // ── Managed mode (PesManager controls polling) ──
    this._managed = config.managed || false;
    this._managedInit = false;

    // ── Emoji Status ──
    this._lastEmojiStatus = null;    // last emotion synced to bio
    this._emojiStatusInterval = null;
    this._lastBioUpdate = 0;         // timestamp of last bio update (rate limit)
  }

  // ═══════════════════════════════════════════════════════════
  // MANAGED MODE (called by PesManager)
  // ═══════════════════════════════════════════════════════════

  /**
   * Initialize adapter without starting polling.
   * Called by PesManager for managed instances.
   */
  async initManaged() {
    if (this._managedInit) return;
    this._managedInit = true;

    // Mark as connected (normally done by startListening → startCollecting)
    this._connected = true;

    // Wire PES expression auto-delivery (same as base.startListening)
    this.pes.on('expression', async (result) => {
      if (this._connected) {
        try { await this.deliver(result); } catch (_) {}
      }
    });

    // Wire achievement notifications
    this.pes.on('achievement', async (ach) => {
      if (this._connected && this.chatId) {
        try {
          await this._sendText(this.chatId, `🏆 *Достижение разблокировано!*\n\n${ach.emoji} *${ach.name}*\n${ach.description}`, { parse_mode: 'Markdown' });
        } catch (e) { console.error('[PES] achievement notification error:', e.message); }
      }
    });

    // Set bot commands (only once per bot, not per user — but harmless to call)
    try { await this._setMyCommands(); } catch (_) {}

    // Set Mini App menu button
    try { await this._setMenuButton(); } catch (_) {}

    // Initialize owner relationship
    this._initOwnerRelationship();

    // Load persisted context summary from DB
    this._loadContextSummary();

    // Load sticker packs from DB
    this._loadStickerPacksFromDB();

    // Start reminder checker
    this.startReminderChecker();

    // Start idle behavior timer
    this._startIdleTimer();

    // Start emoji status sync
    this._startEmojiStatusSync();

    // Start workflow scheduler with auto-run notifications
    try {
      const stats = this.pes?.store?.getStats?.();
      if (stats) {
        this._workflows.startScheduler(stats.level);
        this._workflows.onAutoRun((workflowId, result) => {
          if (this.chatId && result.text) {
            const prefix = `🤖 Авто-workflow: ${workflowId}\n\n`;
            this._sendText(this.chatId, prefix + result.text).catch(() => {});
          }
        });
      }
    } catch (_) {}
  }

  /**
   * Handle a single Telegram update routed by PesManager.
   * Replaces the chatId filter — PesManager already routed correctly.
   */
  async handleUpdate(update) {
    await this._processUpdate(update);
  }

  // ═══════════════════════════════════════════════════════════
  // TELEGRAM API WRAPPER (raw fetch)
  // ═══════════════════════════════════════════════════════════

  /**
   * Raw Telegram Bot API call.
   * @param {string} method — API method name
   * @param {Object} params — request body
   * @returns {Promise<Object>} — API response result
   */
  async _call(method, params = {}) {
    const url = `${TG_API}${this.botToken}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`Telegram API error: ${data.description || 'unknown'}`);
      err.code = data.error_code;
      throw err;
    }
    return data.result;
  }

  /**
   * Call Telegram API with multipart/form-data (for file uploads).
   * Uses native FormData + Blob (Node 18+).
   * @param {string} method — API method name
   * @param {Object} params — regular params (will be appended as form fields)
   * @param {Buffer} fileBuffer — file data
   * @param {string} fieldName — form field name for the file (e.g. 'sticker', 'png_sticker', 'photo')
   * @param {string} fileName — filename to send
   * @returns {Promise<Object>}
   */
  async _callWithFile(method, params = {}, fileBuffer, fieldName, fileName = 'file.png') {
    const url = `${TG_API}${this.botToken}/${method}`;
    const formData = new FormData();

    // Add regular params
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    }

    // Add file
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    formData.append(fieldName, blob, fileName);

    const res = await fetch(url, { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(`Telegram API error: ${data.description || 'unknown'}`);
      err.code = data.error_code;
      throw err;
    }
    return data.result;
  }

  /** Send a text message. */
  async _sendText(chatId, text, opts = {}) {
    return this._call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: opts.parseMode || undefined,
      reply_to_message_id: opts.replyTo || undefined,
      disable_notification: opts.silent || false,
      reply_markup: opts.reply_markup || undefined,
    });
  }

  /**
   * Send text with inline custom emoji entities.
   * @param {string} chatId
   * @param {string} text — text with placeholder markers like {emoji:ID}
   * Custom emoji IDs are embedded inline: "text {emoji:5368324170671202286} more text"
   * The placeholder is replaced with a Unicode placeholder char and entities array is built.
   */
  async _sendTextWithCustomEmoji(chatId, text) {
    // Parse {emoji:ID} placeholders
    const emojiRegex = /\{emoji:(\d+)\}/g;
    const entities = [];
    let cleanText = '';
    let lastIndex = 0;
    let match;

    // UTF-16 code units length (Telegram API uses UTF-16 offsets)
    const utf16Len = (str) => {
      let len = 0;
      for (const ch of str) { len += ch.codePointAt(0) > 0xFFFF ? 2 : 1; }
      return len;
    };

    while ((match = emojiRegex.exec(text)) !== null) {
      // Add text before the placeholder
      cleanText += text.slice(lastIndex, match.index);
      // Calculate offset in UTF-16 code units
      const offset = utf16Len(cleanText);
      // Add a single placeholder character (the custom emoji occupies 1 char visually)
      const placeholder = '⭐'; // visible fallback for non-premium users
      cleanText += placeholder;
      entities.push({
        type: 'custom_emoji',
        offset,
        length: utf16Len(placeholder),
        custom_emoji_id: match[1],
      });
      lastIndex = match.index + match[0].length;
    }
    cleanText += text.slice(lastIndex);

    if (entities.length === 0) {
      // No custom emoji found — send as plain text
      return this._sendText(chatId, cleanText);
    }

    return this._call('sendMessage', {
      chat_id: chatId,
      text: cleanText,
      entities,
    });
  }

  /** Send a sticker, optionally with origin attribution button. */
  async _sendSticker(chatId, stickerFileId, opts = {}) {
    const params = {
      chat_id: chatId,
      sticker: stickerFileId,
    };

    // Auto-attach origin button if available and not explicitly disabled
    if (opts.reply_markup) {
      params.reply_markup = opts.reply_markup;
    } else if (opts.skipOrigin !== true && this.pes.store) {
      const origin = this.pes.store.getOriginByFileId(stickerFileId);
      if (origin && origin.original_set_name) {
        const title = (origin.original_set_title || origin.original_set_name).slice(0, 30);
        params.reply_markup = JSON.stringify({
          inline_keyboard: [[{
            text: `📦 Из пака «${title}»`,
            url: `https://t.me/addstickers/${origin.original_set_name}`,
          }]],
        });
      }
    }

    return this._call('sendSticker', params);
  }

  /**
   * Set emoji reaction on a message.
   * Bots can only use standard emoji reactions (75 allowed by Telegram).
   */
  async _setReaction(chatId, messageId, emoji) {
    try {
      return await this._call('setMessageReaction', {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }],
      });
    } catch (err) {
      if (err.code === 400) return null;
      throw err;
    }
  }

  /**
   * Proactively react to owner's message with an emoji.
   * Dog "sniffs" the message and reacts emotionally.
   * Probability and emoji choice depend on traits, mood, context.
   */
  async _reactToOwnerMessage(msg, category) {
    if (!this._lastOwnerMessageId) return;

    const traits = this.pes.traits || {};
    const mood = this.pes.mood || 0.5;
    const level = this.pes.level || 0;

    // ── Reaction probability: not every message ──
    let prob = 0.40;
    prob += (traits.playfulness || 0.5) * 0.15;
    prob -= (traits.stubbornness || 0.5) * 0.10;
    prob += (mood - 0.5) * 0.20;
    prob += Math.min(level, 50) * 0.003;

    const alwaysReact = ['praise', 'greetings', 'scold', 'feed', 'play'];
    if (alwaysReact.includes(category)) prob = 1.0;
    if (msg.sticker) prob = 0.95;
    if (msg.photo || msg.document) prob = Math.max(prob, 0.70);

    if (Math.random() > prob) return;

    // ── Build weighted emoji pool ──
    const emoji = this._pickReactionEmoji(category, traits, mood, level);
    if (!emoji) return;

    // ── Set the reaction ──
    try {
      await this._setReaction(this.chatId, this._lastOwnerMessageId, emoji);
      this._recentReactions.push(emoji);
      if (this._recentReactions.length > 8) this._recentReactions.shift();
      this._dailyReactionLog.push(emoji);
      if (this.pes.store) {
        try { this.pes.store.markEmojiUsed(emoji); } catch (_) {}
      }
      console.log(`🐾 PES reacted: ${emoji} (category: ${category || 'general'}, pool-size: ${this._lastReactionPoolSize || '?'})`);
    } catch (err) {
      console.log(`⚠️ Reaction failed: ${emoji} — ${err.message}`);
    }
  }

  /**
   * STANDARD 269: Smart emoji selection with anti-repeat, character pools,
   * learned emoji priority, mood-drift, and weighted random.
   */
  _pickReactionEmoji(category, traits, mood, level) {
    // ── 1. Base context pool ──
    const contextSets = {
      greetings:   ['❤️', '🔥', '👋', '😊', '🐾', '🤗', '💕'],
      praise:      ['❤️', '😍', '🥰', '🔥', '💯', '🎉', '👏', '✨'],
      scold:       ['😢', '💔', '😔', '🥺'],
      feed:        ['🤤', '❤️', '😋', '🔥', '🍖'],
      play:        ['🔥', '🎉', '❤️', '😂', '💯', '🤩', '⚡'],
      status:      ['👀', '🐾', '❤️', '🧐'],
      file_search: ['👀', '🔍', '🐾', '✨'],
      fetch:       ['🔥', '🎉', '❤️', '💯', '💪'],
    };

    const moodPool = mood > 0.7
      ? ['❤️', '🔥', '😊', '👍', '💯', '🎉', '😍', '🤩', '✨']
      : mood > 0.4
        ? ['👍', '❤️', '😊', '🐾', '👀', '😌', '🙂']
        : ['😢', '💔', '😔', '👀', '🥺'];

    let basePool = contextSets[category] || moodPool;

    // ── 2. Character trait pools — each trait > 0.5 adds its emoji ──
    const traitEmoji = {
      courage:      ['💪', '🦁', '⚡', '🏆', '👊'],
      curiosity:    ['👀', '🧐', '🔍', '❓', '🤔'],
      loyalty:      ['❤️', '🥰', '🤗', '💕', '🫶'],
      stubbornness: ['😤', '😏', '🙄', '💅'],
      playfulness:  ['😜', '🤪', '🎮', '🎲', '😝'],
      drama:        ['😍', '🔥', '💯', '🎉', '😱', '🤩', '💫'],
      foodDrive:    ['🤤', '😋', '🍖', '🍕', '😍'],
      sassiness:    ['😏', '💅', '✨', '😌', '👑'],
      aggression:   ['😤', '💢', '⚡'],
    };

    const characterPool = [];
    for (const [trait, emojis] of Object.entries(traitEmoji)) {
      const val = traits[trait] || traits[trait.replace(/([A-Z])/g, '_$1').toLowerCase()] || 0;
      if (val > 0.5) {
        // Higher trait = more emoji from this pool (1-3 emoji)
        const count = val > 0.8 ? 3 : val > 0.65 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          characterPool.push(emojis[Math.floor(Math.random() * emojis.length)]);
        }
      }
    }

    // ── 3. Learned emoji from owner (×2 weight via duplication) ──
    const learnedPool = [];
    if (this.pes.store) {
      try {
        const learned = this.pes.store.getLearnedEmojis({ owner_only: true, limit: 20 });
        for (const le of learned) {
          if (le.emoji && le.emoji.length <= 4) { // Only single emoji, not sequences
            // ×2 weight for owner-sent, ×3 if preference_score > 0
            const copies = (le.preference_score || 0) > 0 ? 3 : 2;
            for (let i = 0; i < copies; i++) learnedPool.push(le.emoji);
          }
        }
      } catch (_) {}
      // Custom emoji reactions removed — Telegram Bot API doesn't support them for bots
    }

    // ── 4. Mood-drift: time-of-day emoji ──
    const hour = new Date().getHours();
    const timeEmoji = hour >= 6 && hour < 12
      ? ['☀️', '😊', '🌅']      // morning
      : hour >= 12 && hour < 18
        ? ['👍', '🔥', '💪']     // afternoon
        : hour >= 18 && hour < 23
          ? ['🌙', '😌', '✨']   // evening
          : ['👀', '😳', '🌙'];  // night

    // ── 5. Merge all pools with weights ──
    const weightedPool = [];
    for (const e of basePool) { weightedPool.push(e); weightedPool.push(e); } // ×2
    for (const e of characterPool) { weightedPool.push(e); } // ×1 (already trait-filtered)
    // Learned emoji from owner get ×4 extra (they ARE the owner's language)
    for (const e of learnedPool) { for (let i = 0; i < 4; i++) weightedPool.push(e); }
    // Time emoji — only add 1 copy (subtle)
    if (Math.random() < 0.3) {
      weightedPool.push(timeEmoji[Math.floor(Math.random() * timeEmoji.length)]);
    }

    // ── 5c. Filter pool — only ALLOWED standard emoji ──
    const filteredPool = weightedPool.filter(e => typeof e === 'string' && ALLOWED_REACTIONS.has(e));
    if (filteredPool.length === 0) {
      filteredPool.push('👍', '❤️', '🔥', '😁', '👏');
    }

    // ── 6. Anti-repeat weighting ──
    const recentCounts = {};
    for (const r of this._recentReactions) {
      recentCounts[r] = (recentCounts[r] || 0) + 1;
    }

    // Build final weighted candidates
    const finalWeights = [];
    const seenKeys = new Set();
    for (const e of filteredPool) {
      if (seenKeys.has(e)) {
        const existing = finalWeights.find(fw => fw.key === e);
        if (existing) existing.weight += 1;
        continue;
      }
      seenKeys.add(e);
      finalWeights.push({ emoji: e, key: e, weight: 1 });
    }
    // Count duplicates properly
    for (const e of filteredPool) {
      const fw = finalWeights.find(f => f.key === e);
      if (fw && fw.weight === 1) {
        fw.weight = filteredPool.filter(x => x === e).length;
      }
    }

    // Apply anti-repeat penalties
    for (const fw of finalWeights) {
      const recentCount = recentCounts[fw.key] || 0;
      if (recentCount >= 3) fw.weight *= 0.05;      // used 3+ of last 8 → almost blocked
      else if (recentCount === 2) fw.weight *= 0.3;  // used 2 times → heavy penalty
      else if (recentCount === 1) fw.weight *= 0.6;  // used once → moderate penalty
      else fw.weight *= 1.3;                          // never used recently → bonus
      fw.weight = Math.max(0.01, fw.weight);
    }

    if (finalWeights.length === 0) return null;
    this._lastReactionPoolSize = finalWeights.length;

    // ── 7. Weighted random selection ──
    const totalWeight = finalWeights.reduce((sum, fw) => sum + fw.weight, 0);
    let r = Math.random() * totalWeight;
    for (const fw of finalWeights) {
      r -= fw.weight;
      if (r <= 0) return fw.emoji;
    }
    return finalWeights[finalWeights.length - 1].emoji;
  }

  /** Send chat action ("typing...", etc.). */
  async _sendChatAction(chatId, action = 'typing') {
    return this._call('sendChatAction', { chat_id: chatId, action });
  }

  /** Get sticker set by name. */
  async _getStickerSet(name) {
    return this._call('getStickerSet', { name });
  }

  /** Get file path for downloading. */
  async _getFilePath(fileId) {
    return this._call('getFile', { file_id: fileId });
  }

  /** Download a file from Telegram servers. Returns Buffer. */
  async _downloadTelegramFile(filePath) {
    const url = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Send a document (file) to chat. */
  async _sendDocument(chatId, fileIdOrPath, opts = {}) {
    return this._call('sendDocument', {
      chat_id: chatId,
      document: fileIdOrPath,
      caption: opts.caption || undefined,
    });
  }

  /** Send a photo to chat. */
  async _sendPhoto(chatId, fileIdOrPath, opts = {}) {
    return this._call('sendPhoto', {
      chat_id: chatId,
      photo: fileIdOrPath,
      caption: opts.caption || undefined,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // STICKER PACK CREATION — process images, create packs
  // ═══════════════════════════════════════════════════════════

  /**
   * Process an image buffer for use as a Telegram sticker.
   * Resizes to 512px (longest side), converts to PNG with transparent padding.
   * @param {Buffer} buffer — raw image data
   * @param {string} type — 'regular' (512px) or 'custom_emoji' (100px)
   * @returns {Promise<Buffer>} — processed PNG buffer
   */
  async _processImageForSticker(buffer, type = 'regular') {
    const sharp = (await import('sharp')).default;
    const size = type === 'custom_emoji' ? 100 : 512;
    return sharp(buffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
  }

  /**
   * Convert video/GIF buffer to WEBM for Telegram video sticker.
   * Requirements: VP9, ≤3 sec, ≤256KB, 512x512 (regular) or 100x100 (emoji), no audio.
   * @param {Buffer} buffer — raw video/GIF data
   * @param {string} type — 'regular' (512px) or 'custom_emoji' (100px)
   * @returns {Promise<Buffer>} — WEBM buffer
   */
  async _processVideoForSticker(buffer, type = 'regular') {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const size = type === 'custom_emoji' ? 100 : 512;
    const tmpDir = '/tmp/pes_stickers';
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const inputPath = join(tmpDir, `input_${Date.now()}.tmp`);
    const outputPath = join(tmpDir, `output_${Date.now()}.webm`);

    try {
      writeFileSync(inputPath, buffer);

      // Convert: scale to size, max 3 sec, no audio, VP9, target ≤256KB
      await execFileAsync('ffmpeg', [
        '-y', '-i', inputPath,
        '-t', '3',                          // max 3 seconds
        '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
        '-c:v', 'libvpx-vp9',
        '-pix_fmt', 'yuva420p',             // alpha channel support
        '-b:v', '400k',                     // target bitrate
        '-maxrate', '500k',
        '-bufsize', '500k',
        '-an',                              // no audio
        '-auto-alt-ref', '0',               // required for alpha
        '-deadline', 'good',
        '-cpu-used', '4',
        outputPath,
      ], { timeout: 30000 });

      let webm = readFileSync(outputPath);

      // If > 256KB, re-encode with lower bitrate
      if (webm.length > 256 * 1024) {
        const lowerBitrate = Math.floor(200 * (256 * 1024) / webm.length);
        await execFileAsync('ffmpeg', [
          '-y', '-i', inputPath,
          '-t', '3',
          '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
          '-c:v', 'libvpx-vp9',
          '-pix_fmt', 'yuva420p',
          '-b:v', `${lowerBitrate}k`,
          '-maxrate', `${lowerBitrate + 50}k`,
          '-bufsize', `${lowerBitrate + 50}k`,
          '-an',
          '-auto-alt-ref', '0',
          '-deadline', 'good',
          '-cpu-used', '4',
          outputPath,
        ], { timeout: 30000 });
        webm = readFileSync(outputPath);
      }

      console.log(`🎬 Video sticker: ${buffer.length} → ${webm.length} bytes (${type}, ${size}px)`);
      return webm;
    } finally {
      try { unlinkSync(inputPath); } catch (_) {}
      try { unlinkSync(outputPath); } catch (_) {}
    }
  }

  /**
   * Generate metronome click track as OGG audio.
   * Uses ffmpeg to create sine wave clicks at specified BPM.
   * @param {number} bpm — beats per minute (40-300)
   * @param {number} duration — duration in seconds (default 30)
   * @param {number} timeSignature — beats per measure for accent (default 4)
   * @returns {Promise<Buffer>} — OGG Opus audio buffer
   */
  async _generateMetronome(bpm = 120, duration = 30, timeSignature = 4) {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    bpm = Math.max(40, Math.min(300, bpm));
    duration = Math.max(5, Math.min(120, duration));

    const tmpDir = '/tmp/pes_metronome';
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

    const outputPath = join(tmpDir, `metronome_${bpm}_${Date.now()}.ogg`);

    try {
      // Single aevalsrc filter — generates clicks mathematically.
      // No matter how many beats, it's always 1 input stream.
      // Accent (beat 1 of measure): 1000Hz, louder. Others: 800Hz, softer.
      const interval = 60 / bpm;
      const clickDur = 0.02;

      // aevalsrc expression (commas escaped with \,):
      // beat = current beat index, phase = time within beat
      // is_accent = 1 if first beat of measure
      // freq = accent ? 1000 : 800, vol = accent ? 0.9 : 0.55
      const expr = [
        `if(lt(mod(t\\,${interval})\\,${clickDur})\\,`,
        `if(eq(floor(mod(t/${interval}\\,${timeSignature}))\\,0)\\,`,
        `0.9*sin(2*PI*1000*mod(t\\,${interval}))\\,`,
        `0.55*sin(2*PI*800*mod(t\\,${interval})))\\,`,
        `0)`,
      ].join('');

      await execFileAsync('ffmpeg', [
        '-y',
        '-f', 'lavfi',
        '-i', `aevalsrc=${expr}:s=48000`,
        '-t', String(duration),
        '-c:a', 'libopus',
        '-b:a', '64k',
        outputPath,
      ], { timeout: 30000 });

      const ogg = readFileSync(outputPath);
      console.log(`🎵 Metronome: ${bpm} BPM, ${duration}s, ${timeSignature}/4, ${ogg.length} bytes`);
      return ogg;
    } finally {
      try { unlinkSync(outputPath); } catch (_) {}
    }
  }

  /**
   * Send metronome audio + inline keyboard with BPM controls.
   * @param {number} bpm — beats per minute
   * @param {number} duration — duration in seconds
   */
  async _sendMetronome(bpm = 120, duration = 30) {
    try {
      await this._sendText(this.chatId, `🎵🐾 ${bpm} BPM... гав!`);

      const ogg = await this._generateMetronome(bpm, duration);

      // Send as voice with BPM controls
      const keyboard = {
        inline_keyboard: [
          [
            { text: '⏪ -20', callback_data: `metro_${bpm - 20}_${duration}` },
            { text: '◀️ -5', callback_data: `metro_${bpm - 5}_${duration}` },
            { text: `🎵 ${bpm}`, callback_data: `metro_${bpm}_${duration}` },
            { text: '▶️ +5', callback_data: `metro_${bpm + 5}_${duration}` },
            { text: '⏩ +20', callback_data: `metro_${bpm + 20}_${duration}` },
          ],
          [
            { text: '60', callback_data: `metro_60_${duration}` },
            { text: '80', callback_data: `metro_80_${duration}` },
            { text: '100', callback_data: `metro_100_${duration}` },
            { text: '120', callback_data: `metro_120_${duration}` },
            { text: '140', callback_data: `metro_140_${duration}` },
            { text: '160', callback_data: `metro_160_${duration}` },
          ],
          [
            { text: '15с', callback_data: `metro_${bpm}_15` },
            { text: '30с', callback_data: `metro_${bpm}_30` },
            { text: '60с', callback_data: `metro_${bpm}_60` },
            { text: '90с', callback_data: `metro_${bpm}_90` },
          ],
        ],
      };

      await this._callWithFile('sendVoice', {
        chat_id: this.chatId,
        reply_markup: JSON.stringify(keyboard),
        duration: duration,
      }, ogg, 'voice', `metronome_${bpm}bpm.ogg`);

    } catch (err) {
      console.error('❌ Metronome error:', err.message);
      await this._sendText(this.chatId, `ыыы... 🐾 не получилось (${err.message})`);
    }
  }

  /**
   * Upload a sticker file to Telegram.
   * @param {number} userId — Telegram user ID (owner)
   * @param {Buffer} stickerPng — processed PNG buffer
   * @param {string} stickerFormat — 'static' or 'animated'
   * @returns {Promise<Object>} — File object with file_id
   */
  async _uploadStickerFile(userId, stickerData, stickerFormat = 'static') {
    const fileName = stickerFormat === 'video' ? 'sticker.webm' : 'sticker.png';
    return this._callWithFile('uploadStickerFile', {
      user_id: userId,
      sticker_format: stickerFormat,
    }, stickerData, 'sticker', fileName);
  }

  /**
   * Create a new sticker set.
   * @param {number} userId — Telegram user ID (owner)
   * @param {string} name — sticker set name (must end with _by_<bot_username>)
   * @param {string} title — display title
   * @param {Buffer} firstStickerPng — processed PNG of first sticker
   * @param {string} emoji — emoji associated with the sticker
   * @param {string} stickerType — 'regular' or 'custom_emoji'
   * @returns {Promise<boolean>}
   */
  async _createStickerSet(userId, name, title, firstStickerData, emoji = '🐾', stickerType = 'regular', stickerFormat = 'static') {
    // First upload the sticker file
    const uploaded = await this._uploadStickerFile(userId, firstStickerData, stickerFormat);

    // Create the set with the uploaded file
    return this._call('createNewStickerSet', {
      user_id: userId,
      name,
      title,
      stickers: [{ sticker: uploaded.file_id, emoji_list: [emoji], format: stickerFormat }],
      sticker_type: stickerType,
    });
  }

  /**
   * Add a sticker to an existing sticker set.
   * @param {number} userId — Telegram user ID (owner)
   * @param {string} name — sticker set name
   * @param {Buffer} stickerPng — processed PNG buffer
   * @param {string} emoji — associated emoji
   * @returns {Promise<boolean>}
   */
  async _addStickerToSet(userId, name, stickerData, emoji = '🐾', stickerFormat = 'static') {
    const uploaded = await this._uploadStickerFile(userId, stickerData, stickerFormat);
    return this._call('addStickerToSet', {
      user_id: userId,
      name,
      sticker: { sticker: uploaded.file_id, emoji_list: [emoji], format: stickerFormat },
    });
  }

  /**
   * Handle "сделай стикер" / "создай эмодзи" / "создай пак" intent.
   * Takes a photo from the owner and creates/adds to a sticker or custom emoji pack.
   * @param {Object} msg — Telegram message
   * @param {string} createType — 'regular' (512px sticker) or 'custom_emoji' (100px emoji)
   */
  async _handleStickerCreation(msg, createType = 'regular') {
    // Need a photo, sticker, GIF, video, or animation to create a sticker
    let fileId, buffer, isSticker = false, stickerEmoji = null;
    let originalSetName = null, originalFileUniqueId = null;
    let isVideoSource = false; // GIF/video/animation → video sticker

    // 1. Direct sticker from message
    if (msg.sticker) {
      fileId = msg.sticker.file_id;
      isSticker = true;
      isVideoSource = msg.sticker.is_video || msg.sticker.is_animated || false;
      stickerEmoji = msg.sticker.emoji;
      originalSetName = msg.sticker.set_name || null;
      originalFileUniqueId = msg.sticker.file_unique_id || null;
    // 2. Reply to a sticker message
    } else if (msg.reply_to_message?.sticker) {
      const stk = msg.reply_to_message.sticker;
      fileId = stk.file_id;
      isSticker = true;
      isVideoSource = stk.is_video || stk.is_animated || false;
      stickerEmoji = stk.emoji;
      originalSetName = stk.set_name || null;
      originalFileUniqueId = stk.file_unique_id || null;
    // 3. Animation/GIF from message
    } else if (msg.animation) {
      fileId = msg.animation.file_id;
      isVideoSource = true;
    // 4. Video from message (short clips)
    } else if (msg.video && (msg.video.duration || 0) <= 10) {
      fileId = msg.video.file_id;
      isVideoSource = true;
    // 5. Reply to animation/GIF
    } else if (msg.reply_to_message?.animation) {
      fileId = msg.reply_to_message.animation.file_id;
      isVideoSource = true;
    // 6. Reply to video
    } else if (msg.reply_to_message?.video && (msg.reply_to_message.video.duration || 0) <= 10) {
      fileId = msg.reply_to_message.video.file_id;
      isVideoSource = true;
    // 7. Photo from message
    } else if (msg.photo) {
      const photo = msg.photo[msg.photo.length - 1];
      fileId = photo.file_id;
    // 8. Image document
    } else if (msg.document && msg.document.mime_type?.startsWith('image/')) {
      // GIF sent as document
      if (msg.document.mime_type === 'image/gif') {
        isVideoSource = true;
      }
      fileId = msg.document.file_id;
    // 9. Video document (MP4 etc sent as file)
    } else if (msg.document && msg.document.mime_type?.startsWith('video/')) {
      fileId = msg.document.file_id;
      isVideoSource = true;
    // 10. Reply to a photo
    } else if (msg.reply_to_message?.photo) {
      const photo = msg.reply_to_message.photo[msg.reply_to_message.photo.length - 1];
      fileId = photo.file_id;
    // 11. Reply to image/video document
    } else if (msg.reply_to_message?.document) {
      const doc = msg.reply_to_message.document;
      if (doc.mime_type?.startsWith('image/')) {
        if (doc.mime_type === 'image/gif') isVideoSource = true;
        fileId = doc.file_id;
      } else if (doc.mime_type?.startsWith('video/')) {
        fileId = doc.file_id;
        isVideoSource = true;
      }
    }

    if (!fileId) {
      await this._sendText(this.chatId, pickRandom([
        'рру?.. 📸🐾 ...тяф? (фото! стикер! гифка!)',
        'ваф! 📸 рру~ ...нужна картинка, стикер или GIF... 🐾',
      ]));
      return;
    }

    // Show "working on it" animation
    await this._sendChatAction(this.chatId, 'upload_photo');

    try {
      // Download the source
      const fileInfo = await this._getFilePath(fileId);
      buffer = await this._downloadTelegramFile(fileInfo.file_path);

      // Determine sticker format
      let stickerData, stickerFormat;
      if (isVideoSource) {
        // Video/GIF/animation → WEBM video sticker
        stickerData = await this._processVideoForSticker(buffer, createType);
        stickerFormat = 'video';
      } else {
        // Photo/image → PNG static sticker
        stickerData = await this._processImageForSticker(buffer, createType);
        stickerFormat = 'static';
      }
      const sourceDesc = isVideoSource ? 'video/GIF' : (isSticker ? 'sticker' : 'photo');
      console.log(`🎨 ${createType === 'custom_emoji' ? 'Emoji' : 'Sticker'} source: ${sourceDesc} (${stickerFormat}), size: ${buffer.length} → ${stickerData.length}`);

      // ── STICKER EDITOR: show preview + action buttons ──
      // Store pending sticker data for callback processing
      const pendingId = `stk_${Date.now()}`;
      this._pendingStickers = this._pendingStickers || {};
      this._pendingStickers[pendingId] = {
        buffer,          // original raw buffer
        stickerData,     // processed sticker data
        stickerFormat,
        createType,
        isVideoSource,
        isSticker,
        stickerEmoji,
        originalSetName,
        originalFileUniqueId,
        msg,
        createdAt: Date.now(),
      };

      // Clean up old pending stickers (>10 min)
      for (const [k, v] of Object.entries(this._pendingStickers)) {
        if (Date.now() - v.createdAt > 600000) delete this._pendingStickers[k];
      }

      // Send preview image + buttons
      const buttons = [];
      if (!isVideoSource) {
        // Static image → offer remove bg and animate
        buttons.push([
          { text: '✅ В пак', callback_data: `stk_add_${pendingId}` },
          { text: '🔲 Убрать фон', callback_data: `stk_rmbg_${pendingId}` },
        ]);
        buttons.push([
          { text: '✨ Анимировать', callback_data: `stk_anim_${pendingId}` },
        ]);
      } else {
        // Video → just add or re-encode
        buttons.push([
          { text: '✅ В пак', callback_data: `stk_add_${pendingId}` },
        ]);
      }

      // Send the processed image as preview
      try {
        if (isVideoSource) {
          // Send as video note or animation
          await this._call('sendAnimation', {
            chat_id: this.chatId,
            animation: { source: stickerData, filename: 'preview.webm' },
            caption: '🎨🐾',
            reply_markup: JSON.stringify({ inline_keyboard: buttons }),
          });
        } else {
          await this._call('sendPhoto', {
            chat_id: this.chatId,
            photo: { source: stickerData, filename: 'preview.png' },
            caption: '🎨🐾',
            reply_markup: JSON.stringify({ inline_keyboard: buttons }),
          });
        }
      } catch (previewErr) {
        // If preview fails, send text buttons instead
        console.log(`⚠️ Preview send failed: ${previewErr.message}, sending text buttons`);
        await this._sendText(this.chatId, '🎨🐾', {
          reply_markup: JSON.stringify({ inline_keyboard: buttons }),
        });
      }

      // Don't add to pack yet — wait for button callback
      this._processSmartXP(msg, 'command', 'create_sticker');
    } catch (err) {
      console.error(`⚠️ Sticker creation failed: ${err.message}`);
      await this._sendText(this.chatId, pickRandom([
        'хнн... 🎨💧🐾',
        'скууу... 😿🐾',
      ]));
    }
  }

  /**
   * Add a sticker to pack — called from sticker editor callback buttons.
   */
  async _addStickerToPack(pending, stickerData, stickerFormat) {
    const { createType, isSticker, stickerEmoji, originalSetName, originalFileUniqueId, msg, isVideoSource } = pending;

    try {
      const botInfo = await this._getMe();
      const botUsername = botInfo.username;
      const ownerId = Number(msg.from.id);
      const petName = this.pes.store?.getConfig('pet_name') || 'PES';
      const sanitizedName = petName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'PES';
      const isEmoji = createType === 'custom_emoji';
      const packPrefix = isEmoji ? 'emoji' : 'stickers';

      let packName;
      let isNewPack = false;

      if (!isEmoji && this.pes.store) {
        const mainPack = this.pes.store.getMainCollectionPack();
        if (mainPack) packName = mainPack.pack_name;
      }

      if (!packName) {
        const existingPacks = this.pes.store?.getCreatedPacks(createType) || [];
        if (existingPacks.length > 0) packName = existingPacks[0].pack_name;
      }

      if (packName) {
        try {
          const caption = msg.caption || msg.text || '';
          const emoji = stickerEmoji || this._guessEmojiForSticker(caption) || '🐾';
          await this._addStickerToSet(ownerId, packName, stickerData, emoji, stickerFormat);
          if (this.pes.store) this.pes.store.incrementPackStickerCount(packName);
        } catch (addErr) {
          console.log(`⚠️ Failed to add to pack ${packName}: ${addErr.message}`);
          if (addErr.message?.includes('STICKERS_TOO_MUCH') || addErr.message?.includes('STICKERPACK_STICKERS_TOO_MUCH')) {
            const overflowNum = (this.pes.store?.getCreatedPacks(createType) || []).length + 1;
            packName = `${sanitizedName}_${packPrefix}_${overflowNum}_by_${botUsername}`;
            isNewPack = true;
          } else {
            isNewPack = true;
            packName = `${sanitizedName}_${packPrefix}_${Date.now()}_by_${botUsername}`;
          }
        }
      } else {
        isNewPack = true;
        packName = `${sanitizedName}_${packPrefix}_by_${botUsername}`;
      }

      if (isNewPack) {
        const title = isEmoji
          ? (this._pendingPackTitle ? `${this._pendingPackTitle} ✨` : `${petName} Emoji ✨`)
          : (this._pendingPackTitle || `${petName} Stickers 🐾`);
        this._pendingPackTitle = null;
        const caption = msg.caption || msg.text || '';
        const emoji = stickerEmoji || this._guessEmojiForSticker(caption) || '🐾';
        await this._createStickerSet(ownerId, packName, title, stickerData, emoji, createType, stickerFormat);
        if (this.pes.store) {
          this.pes.store.saveCreatedPack({ pack_name: packName, title, owner_id: String(ownerId), pack_type: createType });
          this.pes.store.incrementPackStickerCount(packName);
          if (!isEmoji && !this.pes.store.getMainCollectionPack()) {
            this.pes.store.setMainCollectionPack(packName);
          }
        }
      }

      // Track origin
      if (isSticker && originalSetName && originalFileUniqueId && this.pes.store) {
        let originalSetTitle = null;
        try {
          const setInfo = await this._call('getStickerSet', { name: originalSetName });
          originalSetTitle = setInfo?.title || originalSetName;
        } catch (_) { originalSetTitle = originalSetName; }
        this.pes.store.saveStickerOrigin({
          file_unique_id: originalFileUniqueId,
          my_pack_name: packName,
          original_set_name: originalSetName,
          original_set_title: originalSetTitle,
          original_emoji: stickerEmoji || '🐾',
        });
      }

      // Success — send the actual sticker from the pack so user can save it
      await sleep(500);
      try {
        const setInfo = await this._call('getStickerSet', { name: packName });
        if (setInfo?.stickers?.length > 0) {
          // Send the last sticker (the one we just added)
          const lastSticker = setInfo.stickers[setInfo.stickers.length - 1];
          await this._call('sendSticker', {
            chat_id: this.chatId,
            sticker: lastSticker.file_id,
          });
        }
      } catch (stkErr) {
        console.log(`⚠️ Could not send sticker preview: ${stkErr.message}`);
      }

      // Reaction
      const typeLabel = isVideoSource ? '🎬' : '🎨';
      await this._sendText(this.chatId, pickRandom([
        `${typeLabel}✨🐾`,
        `${typeLabel}🎉🐾`,
        `${typeLabel}💫🐾`,
      ]));

      console.log(`${typeLabel} Sticker added to pack=${packName}, format=${stickerFormat}, isNew=${isNewPack}`);
    } catch (err) {
      console.error(`⚠️ Sticker add to pack failed: ${err.message}`);
      await this._sendText(this.chatId, pickRandom([
        'хнн... 🎨💧 🐾',
        'скууу... 😿🐾',
      ]));
    }
  }

  /**
   * Guess an appropriate emoji for a sticker based on caption text.
   * Simple keyword matching — LLM analysis can enhance later.
   */
  /**
   * Try to inject a learned custom emoji into a reply text.
   * 20% chance if custom emoji are available in the store.
   * Returns text with {emoji:ID} placeholders, or original text if no injection.
   */
  _tryInjectCustomEmoji(text) {
    if (Math.random() > 0.45) return text; // 45% chance (Premium owner!)
    if (!this.pes.store) return text;

    const customEmojis = this.pes.store.getCustomEmojiStickers({ limit: 20 });
    if (!customEmojis || customEmojis.length === 0) return text;

    // Pick a random custom emoji
    const chosen = customEmojis[Math.floor(Math.random() * customEmojis.length)];
    if (!chosen.custom_emoji_id) return text;

    // Inject at the end of the text (before trailing whitespace)
    const trimmed = text.trimEnd();
    return `${trimmed} {emoji:${chosen.custom_emoji_id}}`;
  }

  _guessEmojiForSticker(text) {
    if (!text) return null;
    const t = text.toLowerCase();
    if (/кот|кош|cat/i.test(t)) return '😺';
    if (/собак|пёс|пес|dog/i.test(t)) return '🐕';
    if (/смех|смешн|lol|хах/i.test(t)) return '😂';
    if (/грус|sad|плач/i.test(t)) return '😢';
    if (/люб|love|серд/i.test(t)) return '❤️';
    if (/еда|food|вкусн/i.test(t)) return '🍕';
    if (/огонь|fire|жар/i.test(t)) return '🔥';
    if (/крут|cool|класс/i.test(t)) return '🤩';
    return null;
  }

  /** Get updates (long polling). */
  async _getUpdates(offset, timeout = 30) {
    return this._call('getUpdates', {
      offset,
      timeout,
      allowed_updates: ['message', 'message_reaction', 'inline_query', 'callback_query'],
    });
  }

  /** Get bot info. */
  async _getMe() {
    if (!this._botInfo) {
      this._botInfo = await this._call('getMe');
    }
    return this._botInfo;
  }

  /** Set bot commands menu. */
  async _setMyCommands() {
    return this._call('setMyCommands', {
      commands: [
        { command: 'start',        description: '🐾 Запустить / разбудить ПЕС' },
        { command: 'home',         description: '🏠 Открыть дом питомца' },
        { command: 'status',       description: '📊 Статус ПЕС' },
        { command: 'setname',      description: '✏️ Дать имя ПЕС — /setname Имя' },
        { command: 'feed',         description: '🍖 Покормить данными' },
        { command: 'command',      description: '🎾 Дать команду' },
        { command: 'silent',       description: '🤫 Тихий режим' },
        { command: 'stickers',     description: '🎨 Стикерпак' },
        { command: 'files',        description: '📂 Мои файлы и фото' },
        { command: 'notes',        description: '📝 Мои заметки' },
        { command: 'remind',       description: '⏰ Напоминалка — /remind 30м купить молоко' },
        { command: 'reminders',    description: '📋 Список напоминалок' },
        { command: 'translate',    description: '📜 Перевести текст — /translate en текст' },
        { command: 'share',        description: '📤 Поделиться — /share note|status|card' },
        { command: 'emoji',        description: '✨ Emoji статус питомца' },
        { command: 'orchestrator', description: '🎯 Вызвать @orchestrator' },
        { command: 'geratron',     description: '⚡ Вызвать @geratron' },
        { command: 'dev',          description: '🔧 Dev mode' },
      ],
    });
  }

  async _setMenuButton() {
    const appUrl = this.config.miniAppUrl || 'https://crm.hltrn.cc/api/v3/pes/app';
    return this._call('setChatMenuButton', {
      menu_button: {
        type: 'web_app',
        text: '🏠 Дом',
        web_app: { url: appUrl },
      },
    });
  }


  // ═══════════════════════════════════════════════════════════
  // ABSTRACT IMPLEMENTATIONS
  // ═══════════════════════════════════════════════════════════

  /**
   * Send rendered expression to Telegram.
   * @param {Object} output — from renderExpression()
   * @returns {Promise<string|null>} — message ID
   */
  async sendMessage(output) {
    if (!output) return null;

    let lastMsgId = null;

    // "Thinking..." delay
    if (this.useThinkingDelay) {
      const delay = thinkingDelay(this.pes.level);
      if (delay > 100) {
        await this._sendChatAction(this.chatId);
        await sleep(delay);
      }
    }

    // 1. Send sticker (if available)
    if (output.sticker && typeof output.sticker === 'string' && output.sticker.length > 20) {
      // Looks like a Telegram file_id
      try {
        const msg = await this._sendSticker(this.chatId, output.sticker);
        lastMsgId = String(msg.message_id);
      } catch (_) {
        // Sticker send failed — fall through to text
      }
    }

    // 2. Build rich text: [body action] + [glyphs] + [voice] + [babble]
    const textParts = [];

    // Body action description (if no sticker was sent)
    if (!lastMsgId && output.expressionId) {
      const bodyKey = this.pes?.engine?.lastExpression?.expression?.bodyKey ||
                      output.meta?.bodyKey;
      if (bodyKey && BODY_ACTIONS[bodyKey]) {
        textParts.push(pickRandom(BODY_ACTIONS[bodyKey]));
      }
    }

    // Glyphs
    if (output.text) textParts.push(output.text);

    // Voice sound
    if (output.meta?.voiceText && !this.pes?.engine?.silentMode) {
      textParts.push(`_${output.meta.voiceText}_`);
    }

    // Dynamic babble — ALWAYS add evolving sounds (core voice of PES)
    {
      const emotion = this.pes?.emotions?.state || 'idle';
      const intensity = this.pes?.emotions?.intensity || 0.5;
      const level = this.pes?.level || 0;
      const babble = this._babble.generate(level, emotion, intensity);
      if (babble) textParts.push(babble);
    }

    if (output.meta?.caption && !textParts.length) {
      textParts.push(output.meta.caption);
    }

    const text = textParts.join(' ');
    if (text) {
      try {
        const msg = await this._sendText(this.chatId, text, { parseMode: 'Markdown' });
        lastMsgId = String(msg.message_id);
      } catch (err) {
        console.error('⚠️ sendMessage (Markdown) error:', err.message);
        // Markdown failed — try plain text
        try {
          const msg = await this._sendText(this.chatId, text.replace(/[_*]/g, ''));
          lastMsgId = String(msg.message_id);
        } catch (err2) {
          console.error('⚠️ sendMessage (plain) error:', err2.message);
        }
      }
    }

    // 2b. Track sent message for reaction feedback loop
    if (lastMsgId && output.expressionId) {
      this.trackMessage(output.expressionId, lastMsgId);
    }

    // 3. Set reaction on owner's last message (if applicable)
    if (output.reaction && this._lastOwnerMessageId) {
      try {
        await this._setReaction(this.chatId, this._lastOwnerMessageId, output.reaction);
      } catch (_) {
        // Reaction failed — not critical
      }
    }

    return lastMsgId;
  }

  /**
   * Start polling for updates from Telegram.
   */
  async startCollecting() {
    if (this._polling) return;
    this._polling = true;

    // Delete any existing webhook to ensure polling works (especially for inline queries)
    try {
      await this._call('deleteWebhook', { drop_pending_updates: false });
      console.log('🔧 Webhook deleted, polling mode active');
    } catch (_) {}

    // Set bot commands
    try { await this._setMyCommands(); } catch (_) {}

    // ── Initialize owner relationship ──
    this._initOwnerRelationship();

    // ── Load persisted context summary from DB ──
    this._loadContextSummary();

    // ── Load sticker packs from DB (not hardcoded) ──
    this._loadStickerPacksFromDB();

    // Start reminder checker
    this.startReminderChecker();

    // Start idle behavior timer
    this._startIdleTimer();

    // Start emoji status sync
    this._startEmojiStatusSync();

    this._pollLoop();
  }

  /**
   * Stop polling.
   */
  async stopCollecting() {
    this._polling = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  /**
   * Set presence (typing/online via chat action).
   */
  async setPresence(state) {
    if (state === PRESENCE.TYPING) {
      await this._sendChatAction(this.chatId, 'typing');
    }
    // Telegram bots don't have online/offline status
    // but we can track it internally
  }


  // ═══════════════════════════════════════════════════════════
  // POLLING LOOP
  // ═══════════════════════════════════════════════════════════

  async _pollLoop() {
    while (this._polling) {
      try {
        const updates = await this._getUpdates(this._pollOffset, 30);

        for (const update of updates) {
          this._pollOffset = update.update_id + 1;

          try {
            await this._processUpdate(update);
          } catch (err) {
            this.emit('error', err);
          }
        }
      } catch (err) {
        // Network error — retry after delay
        this.emit('error', err);
        if (this._polling) {
          await sleep(this.pollingInterval);
        }
      }
    }
  }


  // ═══════════════════════════════════════════════════════════
  // UPDATE PROCESSING
  // ═══════════════════════════════════════════════════════════

  /**
   * Route incoming Telegram update.
   */
  async _processUpdate(update) {
    // Debug: log ALL updates for diagnostics
    if (update.message?.text) {
      console.log(`📨 [DEBUG] Message from ${update.message.chat.id}: "${update.message.text.slice(0, 80)}"`);
    } else if (!update.message) {
      const keys = Object.keys(update).filter(k => k !== 'update_id');
      if (keys.length > 0) {
        console.log(`📨 Update type: ${keys.join(', ')}`, JSON.stringify(update).substring(0, 300));
      }
    }

    // Message (text, sticker, etc.)
    if (update.message) {
      const msg = update.message;

      // In standalone mode, only process messages from our chat.
      // In managed mode (PesManager), routing is already done — skip filter.
      if (!this._managed && String(msg.chat.id) !== this.chatId) return;

      // Track last owner message for reactions
      this._lastOwnerMessageId = msg.message_id;

      // Bot commands
      if (msg.text && msg.text.startsWith('/')) {
        await this._handleBotCommand(msg);
        return;
      }

      // Sticker from owner — check if "add to pack" was requested
      if (msg.sticker) {
        if (this._pendingAddToPack && Date.now() - this._pendingAddToPack < 60000) {
          const pendingType = this._pendingAddType || 'regular';
          this._pendingAddToPack = null;
          this._pendingAddType = null;
          await this._handleStickerCreation(msg, pendingType);
          this._updateRelationship('message');
          return;
        }
        await this._handleStickerMessage(msg);
        return;
      }

      // Text message
      if (msg.text) {
        await this._handleTextMessage(msg);
        return;
      }

      // Photo/document/GIF/video — check if "add to pack" was requested
      const isMediaForPack = msg.photo || msg.animation || msg.video ||
        (msg.document && (msg.document.mime_type?.startsWith('image/') || msg.document.mime_type?.startsWith('video/')));
      if (isMediaForPack && this._pendingAddToPack && Date.now() - this._pendingAddToPack < 60000) {
        const pendingType = this._pendingAddType || 'regular';
        this._pendingAddToPack = null;
        this._pendingAddType = null;
        await this._handleStickerCreation(msg, pendingType);
        this._updateRelationship('message');
        return;
      }

      // Shared contact (vCard) — auto-save
      if (msg.contact) {
        await this._handleSharedContact(msg);
        return;
      }

      // Photo/document/video/voice/audio/video_note — save and analyze
      if (msg.photo || msg.document || msg.video || msg.voice || msg.audio || msg.video_note) {
        await this._handleMediaMessage(msg);
        return;
      }
    }

    // Reaction on PES's message
    if (update.message_reaction) {
      await this._handleReaction(update.message_reaction);
    }

    // Inline query — show sticker collection in any chat
    if (update.inline_query) {
      await this._handleInlineQuery(update.inline_query);
    }

    // Callback query — inline keyboard button presses (metronome BPM, etc.)
    if (update.callback_query) {
      await this._handleCallbackQuery(update.callback_query);
    }
  }

  /**
   * Handle inline keyboard callback queries (button presses).
   */
  async _handleCallbackQuery(query) {
    const data = query.data || '';

    // Metronome BPM control: metro_{bpm}_{duration}
    const metroMatch = data.match(/^metro_(\d+)_(\d+)$/);
    if (metroMatch) {
      const bpm = Math.max(40, Math.min(300, parseInt(metroMatch[1])));
      const duration = Math.max(5, Math.min(120, parseInt(metroMatch[2])));

      await this._call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: `🎵 ${bpm} BPM`,
      }).catch(() => {});

      await this._sendMetronome(bpm, duration);
      return;
    }

    // ── Sticker editor callbacks ──
    const stkMatch = data.match(/^stk_(add|rmbg|anim)_(stk_\d+)$/);
    if (stkMatch) {
      const action = stkMatch[1];
      const pendingId = stkMatch[2];
      const pending = this._pendingStickers?.[pendingId];

      if (!pending) {
        await this._call('answerCallbackQuery', {
          callback_query_id: query.id,
          text: 'рру?.. 🐾 (истекло)',
          show_alert: false,
        }).catch(() => {});
        return;
      }

      await this._call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: action === 'add' ? '✅ 🐾' : action === 'rmbg' ? '🔲 🐾' : '✨ 🐾',
      }).catch(() => {});

      // Remove buttons from preview message
      try {
        await this._call('editMessageReplyMarkup', {
          chat_id: this.chatId,
          message_id: query.message.message_id,
          reply_markup: JSON.stringify({ inline_keyboard: [] }),
        });
      } catch (_) {}

      await this._sendChatAction(this.chatId, 'upload_photo');

      let finalData = pending.stickerData;
      let finalFormat = pending.stickerFormat;

      if (action === 'rmbg') {
        // Remove background using sharp — make light/white areas transparent
        try {
          const sharp = (await import('sharp')).default;
          const size = pending.createType === 'custom_emoji' ? 100 : 512;

          // Extract alpha: remove background by making near-white pixels transparent
          const raw = await sharp(pending.buffer)
            .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

          const pixels = raw.data;
          const { width, height } = raw.info;

          // Make light pixels transparent (threshold-based bg removal)
          for (let i = 0; i < pixels.length; i += 4) {
            const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
            const brightness = (r + g + b) / 3;
            // If pixel is very light (near white), make transparent
            if (brightness > 220 && Math.abs(r - g) < 30 && Math.abs(g - b) < 30) {
              pixels[i + 3] = 0; // alpha = 0
            }
            // Edge softening for medium-light pixels
            else if (brightness > 190 && Math.abs(r - g) < 40 && Math.abs(g - b) < 40) {
              pixels[i + 3] = Math.floor(pixels[i + 3] * (220 - brightness) / 30);
            }
          }

          finalData = await sharp(pixels, { raw: { width, height, channels: 4 } })
            .png()
            .toBuffer();

          console.log(`🔲 Background removed: ${pending.stickerData.length} → ${finalData.length}`);
        } catch (bgErr) {
          console.error(`⚠️ BG removal failed: ${bgErr.message}`);
          // Fall back to original processed data
          finalData = pending.stickerData;
        }
      } else if (action === 'anim') {
        // Animate: create a simple zoom/pulse animation from static image
        try {
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);

          const tmpDir = '/tmp/pes_stickers';
          if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

          const inputPath = join(tmpDir, `anim_in_${Date.now()}.png`);
          const outputPath = join(tmpDir, `anim_out_${Date.now()}.webm`);

          writeFileSync(inputPath, pending.stickerData);

          const size = pending.createType === 'custom_emoji' ? 100 : 512;

          // Create pulse/zoom animation: 3 sec, zooms in slightly then back
          await execFileAsync('ffmpeg', [
            '-y',
            '-loop', '1', '-i', inputPath,
            '-t', '3',
            '-vf', [
              `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
              `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`,
              `zoompan=z='1+0.15*sin(2*PI*t/1.5)':d=75:s=${size}x${size}:fps=25`,
            ].join(','),
            '-c:v', 'libvpx-vp9',
            '-pix_fmt', 'yuva420p',
            '-b:v', '300k',
            '-an',
            '-auto-alt-ref', '0',
            '-deadline', 'good',
            '-cpu-used', '4',
            outputPath,
          ], { timeout: 30000 });

          let webm = readFileSync(outputPath);

          // Re-encode if too large
          if (webm.length > 256 * 1024) {
            const lowerBr = Math.floor(150 * (256 * 1024) / webm.length);
            await execFileAsync('ffmpeg', [
              '-y',
              '-loop', '1', '-i', inputPath,
              '-t', '3',
              '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,zoompan=z='1+0.15*sin(2*PI*t/1.5)':d=75:s=${size}x${size}:fps=25`,
              '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p',
              '-b:v', `${lowerBr}k`, '-an', '-auto-alt-ref', '0',
              '-deadline', 'good', '-cpu-used', '4',
              outputPath,
            ], { timeout: 30000 });
            webm = readFileSync(outputPath);
          }

          finalData = webm;
          finalFormat = 'video';

          try { unlinkSync(inputPath); } catch (_) {}
          try { unlinkSync(outputPath); } catch (_) {}

          console.log(`✨ Animated sticker: ${pending.stickerData.length} → ${finalData.length}`);
        } catch (animErr) {
          console.error(`⚠️ Animation failed: ${animErr.message}`);
          finalData = pending.stickerData;
        }
      }

      // Now add to pack (reuse logic from _handleStickerCreation)
      await this._addStickerToPack(pending, finalData, finalFormat);

      // Clean up
      delete this._pendingStickers[pendingId];
      return;
    }

    // ── Share callbacks ──
    if (data.startsWith('share_')) {
      await this._call('answerCallbackQuery', {
        callback_query_id: query.id,
      }).catch(() => {});

      switch (data) {
        case 'share_status':    return this._shareStatus();
        case 'share_card':      return this._sharePetCard();
        case 'share_last_note': return this._shareNote('');
        case 'share_summary':   return this._shareSummary();
      }
      return;
    }

    // ── Workflow callbacks ──
    if (data.startsWith('wf_run_')) {
      const workflowId = data.replace('wf_run_', '');
      await this._call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: `▶️ ${workflowId}...`,
      }).catch(() => {});
      await this._cmdWorkflow({ chat: { id: this.chatId } }, workflowId);
      return;
    }

    if (data === 'wf_history') {
      await this._call('answerCallbackQuery', {
        callback_query_id: query.id,
      }).catch(() => {});
      await this._cmdWorkflow({ chat: { id: this.chatId } }, 'history');
      return;
    }

    // ── Friendship callbacks ──
    const friendMatch = data.match(/^friend_(accept|reject)_(\d+)$/);
    if (friendMatch) {
      const action = friendMatch[1];
      const fromChatId = friendMatch[2];
      await this._call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: action === 'accept' ? '🤝 Принято!' : '❌ Отклонено',
      }).catch(() => {});

      try {
        await this._call('editMessageReplyMarkup', {
          chat_id: this.chatId,
          message_id: query.message.message_id,
          reply_markup: JSON.stringify({ inline_keyboard: [] }),
        });
      } catch (_) {}

      if (action === 'accept') {
        this.pes.store.acceptFriendRequest(fromChatId);
        const friendship = this.pes.store.getFriendship(fromChatId);
        const petName = friendship?.friend_pet_name || 'ПЕС';
        await this._sendText(this.chatId, `🤝 ${this.pes.name} теперь друг с ${petName}! 🐾♡`);
        // Notify the requester
        try {
          await this._sendText(fromChatId, `🤝 ${petName} принял дружбу от ${this.pes.name}! Теперь вы друзья! 🐾♡`);
        } catch (_) {}
        // Mood boost
        if (this.pes.emotions) {
          this.pes.emotions.mood = Math.min(1.0, (this.pes.emotions.mood || 0.5) + 0.1);
        }
      } else {
        this.pes.store.rejectFriendRequest(fromChatId);
        await this._sendText(this.chatId, `❌ Запрос на дружбу отклонён.`);
      }
      return;
    }

    // ── Gift accept callback ──
    const giftMatch = data.match(/^gift_thanks_(\d+)$/);
    if (giftMatch) {
      await this._call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: '💛 Спасибо!',
      }).catch(() => {});
      try {
        await this._call('editMessageReplyMarkup', {
          chat_id: this.chatId,
          message_id: query.message.message_id,
          reply_markup: JSON.stringify({ inline_keyboard: [] }),
        });
      } catch (_) {}
      return;
    }

    // Unknown callback — just answer to dismiss
    await this._call('answerCallbackQuery', {
      callback_query_id: query.id,
    }).catch(() => {});
  }


  // ═══════════════════════════════════════════════════════════
  // MESSAGE HANDLERS
  // ═══════════════════════════════════════════════════════════

  /**
   * Handle text message from owner.
   * Matches keywords → triggers PES events.
   */
  async _handleTextMessage(msg) {
    const text = msg.text.trim();

    // Track owner activity for idle behavior
    this._lastOwnerMessageTime = Date.now();

    // Dev mode or agent mode: all text goes to log instead of PES
    if (this._devMode) {
      return this._logDevRequest('message', text, msg);
    }
    if (this._agentMode) {
      await this._logDevRequest(`@${this._agentMode}`, text, msg);
      // Live orchestrator chat — real AI responses
      if (this._agentMode === 'orchestrator' && this._orchestratorLLM) {
        await this._handleOrchestratorChat(text, msg);
        return;
      }
      const label = this._agentMode === 'orchestrator' ? '🎯' : '⚡';
      await this._sendText(this.chatId, `${label} @${this._agentMode} получил: «${text.slice(0, 200)}»\n\n_Записано в лог._`, { parse_mode: 'Markdown' });
      return;
    }

    // ── Shadow Orchestrator: always observe, respond on trigger ──
    // Buffer every message for context (regardless of LLM availability)
    this._shadowBuffer.push({ role: 'user', content: text, ts: Date.now() });
    if (this._shadowBuffer.length > this._shadowBufferLimit) {
      this._shadowBuffer = this._shadowBuffer.slice(-this._shadowBufferLimit);
    }

    // Check N23 / trigger keywords — BEFORE any other handler
    if (this._shadowTriggers.test(text)) {
      if (this._orchestratorLLM) {
        console.log(`🎯 Shadow Orchestrator triggered by: "${text.slice(0, 50)}"`);
        await this._handleShadowOrchestratorCall(text, msg);
        return;
      } else {
        console.log(`⚠️ Shadow trigger matched but no _orchestratorLLM available`);
      }
    }

    // ── Check pending mirror sticker (delayed "try back") ──
    this._tryMirrorSticker().catch(err =>
      console.error('⚠️ Mirror sticker error:', err.message)
    );

    // ── Check for sticker/emoji/gif creation intent ──
    const stickerCreateMatch = /^(сделай стикер|создай стикер|стикер из|сделай пак|создай пак|make sticker|create sticker|добавь стикер|добавь в пак|add sticker|add to pack|сделай гифку|сделай gif|создай гифку|gif стикер|гиф стикер|видео стикер|video sticker)/i.test(text);
    const emojiCreateMatch = /^(сделай эмодзи|создай эмодзи|сделай эмоджи|создай эмоджи|сделай emoji|создай emoji|make emoji|create emoji|эмодзи из|эмоджи из)/i.test(text);
    const hasMediaSource = msg.photo || msg.animation || msg.video ||
      (msg.document && (msg.document.mime_type?.startsWith('image/') || msg.document.mime_type?.startsWith('video/'))) ||
      msg.reply_to_message?.sticker || msg.reply_to_message?.photo || msg.reply_to_message?.animation || msg.reply_to_message?.video ||
      (msg.reply_to_message?.document && (msg.reply_to_message.document.mime_type?.startsWith('image/') || msg.reply_to_message.document.mime_type?.startsWith('video/')));
    const captionMatch = (msg.photo || msg.animation || msg.video || (msg.document && (msg.document.mime_type?.startsWith('image/') || msg.document.mime_type?.startsWith('video/')))) && /стикер|sticker|пак|pack|эмодзи|эмоджи|emoji|гифк|gif/i.test(msg.caption || '');
    const captionIsEmoji = captionMatch && /эмодзи|эмоджи|emoji/i.test(msg.caption || '');

    // "добавь в пак" + foreign sticker → physically add to pack + save origin
    // "сохрани" → collection bookmark (separate flow)

    if (stickerCreateMatch || emojiCreateMatch || captionMatch) {
      const createType = (emojiCreateMatch || captionIsEmoji) ? 'custom_emoji' : 'regular';
      if (hasMediaSource) {
        await this._handleStickerCreation(msg, createType);
        this._updateRelationship('message');
        return;
      }
      // No media — set pending flag, ask user to send sticker/photo/GIF
      this._pendingAddToPack = Date.now();
      this._pendingAddType = createType;
      await this._sendText(this.chatId, pickRandom([
        'тяф! 🎨🐾 ...жду стикер, фото или GIF! 📸',
        'ваф! 🖌️🐾 ...пришли стикер, картинку или гифку! ✨',
        'рру~~ 🎨 ...давай! стикер! фото! GIF! 🐾',
      ]));
      return;
    }

    // ── Check for sticker COLLECTION intent (reply to sticker + "сохрани"/"в коллекцию") ──
    const collectionSaveMatch = /^(сохрани|в коллекцию|добавь в коллекцию|save|collect|bookmark)/i.test(text);
    const collectionRemoveMatch = /^(убери из коллекции|удали из коллекции|remove from collection)/i.test(text);
    if ((collectionSaveMatch || collectionRemoveMatch) && msg.reply_to_message?.sticker && this.pes.store) {
      const sticker = msg.reply_to_message.sticker;
      if (collectionRemoveMatch) {
        await this._removeFromCollection(msg, sticker);
      } else {
        await this._addToCollection(msg, sticker);
      }
      return;
    }

    // ── Check for translation intent ──
    const translateMatch = text.match(/^(переведи|translate|перевод)\s+(на\s+)?(английский|english|англ|испанский|spanish|исп|немецкий|german|нем|французский|french|фр|китайский|chinese|кит|японский|japanese|яп|корейский|korean|кор|арабский|arabic|араб|итальянский|italian|итал|португальский|portuguese|порт|турецкий|turkish|тур|русский|russian|рус)\s*[:\s]+(.+)/i);
    const translateMatch2 = text.match(/^(переведи|translate|перевод)\s*[:\s]+(.+)/i);
    if (translateMatch || translateMatch2) {
      const targetLang = translateMatch ? translateMatch[3] : null;
      const sourceText = translateMatch ? translateMatch[4] : translateMatch2[2];
      await this._handleTranslation(sourceText.trim(), targetLang?.trim() || 'английский');
      await this._processSmartXP(msg, 'command', 'translate');
      this._updateRelationship('message');
      return;
    }

    // ── Check for metronome intent ──
    const metronomeMatch = text.match(/^(метроном|metronome|темп|tempo)\s*(\d+)?\s*(\d+[смmс]?\w*)?/i);
    if (metronomeMatch) {
      const bpm = metronomeMatch[2] ? parseInt(metronomeMatch[2]) : 120;
      let duration = 30;
      if (metronomeMatch[3]) {
        const durMatch = metronomeMatch[3].match(/^(\d+)(мин|m|min)?/i);
        if (durMatch) {
          duration = parseInt(durMatch[1]);
          if (durMatch[2]) duration *= 60;
        }
      }
      await this._sendMetronome(Math.max(40, Math.min(300, bpm)), Math.max(5, Math.min(120, duration)));
      await this._processSmartXP(msg, 'command', 'metronome');
      this._updateRelationship('message');
      return;
    }

    // ── Check for note-saving intent ──
    const noteMatch = text.match(/^(запомни|запиши|сохрани|заметка)[:\s]+(.+)/i);
    const noteSearchMatch = text.match(/^(что ты помнишь|что помнишь|что знаешь|вспомни)\s*(про|о|об)?\s*(.+)/i);

    if (noteMatch && this.pes.store) {
      const noteText = noteMatch[2].trim();
      const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);

      // Auto-tag via simple keyword extraction
      const tags = noteText
        .replace(/[^\wа-яА-ЯёЁ\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2)
        .slice(0, 10);

      // Check for "важно" → pinned
      const pinned = /важно|навсегда|не забудь/i.test(text);

      // Detect date/time in the note → set remind_at
      const remindAt = this._extractDateTimeFromNote(noteText);

      const saved = this.pes.store.saveNote({
        owner_id: ownerId,
        text: noteText,
        tags,
        category: this._guessNoteCategory(noteText),
        pinned,
        source_message_id: msg.message_id,
        remind_at: remindAt,
      });

      if (remindAt) {
        await this._sendText(this.chatId, pickRandom([
          `ваф! 📝🐾 рру~ ⏰`,
          `тяф! 📝 ♡ рру~~ ⏰`,
          `гав! 📝🐾 ррФФ~ ⏰`,
        ]));
      } else {
        await this._sendText(this.chatId, pickRandom([
          `ваф! 📝🐾${pinned ? ' 📌' : ''} рру~`,
          `тяф! 📝 ♡${pinned ? ' 📌' : ''} рру~~`,
          `гав! 📝🐾${pinned ? ' 📌' : ''} ррФФ~`,
        ]));
      }
      this._addToMemory('owner', text);
      this._addToMemory('pes', `[запомнил: ${noteText}${remindAt ? ` → принесу ${this._formatReminderTime(remindAt)}` : ''}]`);
      await this._processSmartXP(msg, 'note', 'note');
      this._updateRelationship('message');
      return;
    }

    if (noteSearchMatch && this.pes.store) {
      const query = noteSearchMatch[3].trim();
      const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);
      const notes = this.pes.store.searchNotes(query, { owner_id: ownerId, limit: 5 });

      if (notes.length === 0) {
        await this._sendText(this.chatId, pickRandom([
          `скууу... ыыы... рру?.. 💧`,
          `рру?... ...ууу... хнн... 💧`,
        ]));
      } else {
        // Dog "brings" the notes — sounds first, then data
        await this._sendText(this.chatId, pickRandom([
          `ваф! 📝🐾 рру!!`,
          `тяф тяф! 📝 ррРР!! 🐾`,
        ]));
        const lines = [];
        for (const n of notes) {
          lines.push(`${n.pinned ? '📌 ' : ''}• ${n.text}`);
        }
        await this._sendText(this.chatId, lines.join('\n'));
      }
      this._addToMemory('owner', `[спросил: что помнишь про ${query}]`);
      this._addToMemory('pes', `[нашёл ${notes.length} заметок про ${query}]`);
      await this._processSmartXP(msg, 'text');
      this._updateRelationship('message');
      return;
    }

    // ── Check for contact-saving intent ──
    const contactSaveMatch = text.match(/^(запомни контакт|добавь контакт|сохрани контакт|новый контакт|add contact)[:\s]+(.+)/i);
    const contactQueryMatch = text.match(/^(кто такой|кто такая|кто это|who is)\s+(.+)/i);

    if (contactSaveMatch && this.pes.store) {
      const contactStr = contactSaveMatch[2].trim();
      await this._parseAndSaveContact(msg, contactStr);
      return;
    }

    if (contactQueryMatch && this.pes.store) {
      const query = contactQueryMatch[2].trim().replace(/[?？]$/, '');
      await this._searchAndShowContact(msg, query);
      return;
    }

    // ── Check for reminder intent ──
    const reminderIntent = await this._detectReminderIntent(text);
    if (reminderIntent && this.pes.store) {
      this.pes.store.createReminder(reminderIntent.text, reminderIntent.remindAt);
      const timeStr = this._formatReminderTime(reminderIntent.remindAt);
      await this._sendText(this.chatId, pickRandom([
        `ваф! 📋🐾 рру~ ⏰`,
        `тяф! 📋 рру~~ ⏰ 🐾`,
        `гав! 📋🐾 ррФФ~ ⏰`,
      ]));
      this._addToMemory('owner', text);
      this._addToMemory('pes', `[напоминалка: ${reminderIntent.text} — ${timeStr}]`);
      return; // Don't process as normal message
    }

    // ── CRM Bridge v2: bidirectional CRM access through chat ──
    if (this._crm) {
      const crmHandled = await this._handleCrmIntent(msg, text);
      if (crmHandled) return;
    }

    // ── Detect keyword category for PES event triggering ──
    let detectedCategory = null;
    let detectedKw = null;
    for (const [category, kw] of Object.entries(KEYWORDS)) {
      if (kw.patterns.some(p => p.test(text))) {
        detectedCategory = category;
        detectedKw = kw;
        break;
      }
    }

    // ── Extract and learn emojis from owner's message ──
    this._extractAndLearnEmojis(text, true);

    // ── Extract and learn custom emoji from message entities ──
    if (msg.entities) {
      this._extractAndLearnCustomEmojis(msg.entities);
    }

    // ── File search intent ──
    if (detectedKw && detectedKw.action === 'file_search') {
      await this._handleFileSearch(text);
      await this._processSmartXP(msg, 'text');
      this._updateRelationship('message');
      return;
    }

    // ── LLM Intent Router: when no specific regex matched ──
    // Keywords like greetings/praise/scold still go to generic reply path
    // But unrecognized text → LLM classifies → routes to handler
    if (!detectedKw || !detectedKw.action || detectedKw.action === 'command') {
      try {
        const intent = await this._classifyIntent(text);
        if (intent && intent.intent !== 'none') {
          const handled = await this._routeIntent(msg, intent);
          if (handled) {
            // Still do emoji learning + patterns + XP
            this._extractAndLearnEmojis(text, true);
            if (msg.entities) this._extractAndLearnCustomEmojis(msg.entities);
            await this._processSmartXP(msg, 'text', intent.intent);
            this._updateRelationship('message');
            this._observeInteractionPatterns(text, null);
            return;
          }
        }
      } catch (err) {
        console.error('⚠️ LLM router error:', err.message);
        // Fall through to generic reply
      }
    }

    // ── React to owner's message (proactive emoji reaction) ──
    this._reactToOwnerMessage(msg, detectedCategory).catch(() => {});

    // ── Imprint: positive reaction = хозяин доволен предыдущим звуком ──
    if (detectedCategory === 'praise' || detectedCategory === 'greetings') {
      const boost = detectedCategory === 'praise' ? 0.5 : 0.2;
      this._babble.imprint(this._lastPesReply, boost);
      this._saveBabbleState();
    }

    // ── Generate reply via LLM (or fallback to templates) ──
    await this._sendChatAction(this.chatId);
    await sleep(thinkingDelay(this.pes.level));

    const reply = await this._generateReply(text, detectedCategory);
    console.log(`💬 Reply to owner: "${reply.slice(0, 100)}"`);

    // ── v4: Smart response composition ──
    // Decide response pattern: sticker-first, text-first, text-only, sticker-only
    const responsePattern = this._pickResponsePattern(detectedCategory);

    if (responsePattern === 'sticker_first') {
      // Sticker → pause → babble text
      await this._sendContextualSticker(detectedCategory);
      await sleep(300 + Math.random() * 500);
      const enrichedReply = this._tryInjectCustomEmoji(reply);
      if (enrichedReply !== reply) {
        await this._sendTextWithCustomEmoji(this.chatId, enrichedReply);
      } else {
        await this._sendText(this.chatId, reply);
      }
    } else if (responsePattern === 'sticker_only') {
      // Only sticker — for very emotional moments (zoomies, greeting_frenzy)
      await this._sendContextualSticker(detectedCategory);
    } else if (responsePattern === 'text_then_sticker') {
      // Text → sticker (classic flow)
      const enrichedReply = this._tryInjectCustomEmoji(reply);
      if (enrichedReply !== reply) {
        await this._sendTextWithCustomEmoji(this.chatId, enrichedReply);
      } else {
        await this._sendText(this.chatId, reply);
      }
      await this._sendContextualSticker(detectedCategory);
    } else {
      // Text only — most common, clean
      const enrichedReply = this._tryInjectCustomEmoji(reply);
      if (enrichedReply !== reply) {
        await this._sendTextWithCustomEmoji(this.chatId, enrichedReply);
      } else {
        await this._sendText(this.chatId, reply);
      }
      // 25% chance of follow-up sticker for flavor
      if (Math.random() < 0.25) {
        await this._sendContextualSticker(detectedCategory);
      }
    }

    // ── Track last bot action for reaction memory ──
    this._lastBotAction = {
      action: detectedCategory || 'reply',
      text: reply.slice(0, 200),
      category: detectedCategory,
      timestamp: Date.now(),
    };

    // ── Save to short memory ──
    this._addToMemory('owner', text);
    this._addToMemory('pes', reply);

    // ── Persist babble state (combos, momentum) ──
    this._saveBabbleState();

    // ── Trigger PES event based on keyword ──
    if (detectedKw) {
      if (detectedKw.event) {
        this.pes.event(detectedKw.event);
      } else if (detectedKw.action === 'praise') {
        this.pes.praise(text);
        this._logReactionToLastAction('praise', text, 1.0);
        await this._grantXp('praise', 3);
        this._updateRelationship('praise');
      } else if (detectedKw.action === 'scold') {
        this.pes.scold(text);
        this._logReactionToLastAction('scold', text, -1.0);
        this._updateRelationship('scold');
      } else if (detectedKw.action === 'command' && detectedKw.command === 'fetch') {
        const target = text.replace(detectedKw.patterns[0], '').trim();
        await this._handleFetch(target || 'мячик');
      } else if (detectedKw.action === 'command') {
        const args = text.replace(detectedKw.patterns[0], '').trim();
        this.pes.command(detectedKw.command, { target: args || undefined });
      } else if (detectedKw.action === 'workflow') {
        await this._cmdWorkflow(msg, detectedKw.command);
      } else if (detectedKw.action === 'status') {
        await this._sendStatus();
      } else if (detectedKw.action === 'feed') {
        const content = text.replace(detectedKw.patterns[0], '').trim();
        this.pes.feed({ type: 'text', content });
      }
    } else {
      this.pes.event({
        type: 'message',
        from: 'owner',
        content: text,
        sentiment: 'neutral',
      });
    }

    // Smart XP for every message from owner (dynamic based on quality)
    await this._processSmartXP(msg, 'text', detectedKw?.action);

    // Update owner relationship
    this._updateRelationship('message');

    // Observe interaction patterns — drives sticker discovery
    this._observeInteractionPatterns(text, detectedKw);

    // Proactive insights — share observations (max 1/day, 15% chance)
    this._tryProactiveInsight().catch(err =>
      console.error('⚠️ Proactive insight error:', err.message)
    );

    // Check if there are upcoming note reminders to "bring" contextually
    this._checkContextualReminders().catch(err =>
      console.error('⚠️ Contextual reminder check error:', err.message)
    );
  }

  /**
   * Generate reply — BABBLE-FIRST architecture.
   *
   * v1: LLM generates text → strip human words → fallback to babble
   * v2: LLM classifies emotion → babble generates sounds with phonetic echo
   *
   * LLM is used ONLY for emotion/context classification.
   * Babble Engine is the CORE sound generator — no patches, no stripping.
   *
   * @param {string} ownerText — owner's message
   * @param {string|null} category — detected keyword category
   * @returns {Promise<string>}
   */
  async _generateReply(ownerText, category) {
    // Update babble engine with current traits and owner emoji
    this._updateBabbleContext();

    const level = this.pes?.level || 0;
    let emotion = this.pes?.emotions?.state || 'idle';
    let intensity = this.pes?.emotions?.intensity || 0.5;

    // ── Step 1: LLM classifies emotion/context (NOT generate text) ──
    if (this._llm && category !== 'greetings' && category !== 'praise' && category !== 'scold' && category !== 'feed') {
      try {
        const classifyPrompt = `Ты анализируешь сообщение хозяина для животного (ПЕС).
Определи ЭМОЦИЮ которую ПЕС должен выразить в ответ и её ИНТЕНСИВНОСТЬ.
Ответь ТОЛЬКО JSON: {"emotion": "...", "intensity": 0.0-1.0}

Доступные эмоции: happy, playful, excited, content, idle, curious, hungry, sad, lonely, scared, anxious, angry, alert, bark, nap, sleep, greeting_frenzy, butt_wiggle, zoomies, food_obsessed, dramatic_tantrum, sulking, stubborn_refuse, puzzle_solving

Контекст:
- Текущая эмоция ПЕС: ${emotion}
- Уровень: ${level}
- Настроение: ${Math.round((this.pes?.emotions?.mood || 0.5) * 100)}%`;

        const classified = await this._llm.classify(classifyPrompt, ownerText);
        if (classified?.emotion && EMOTION_INSTRUMENTS_SET.has(classified.emotion)) {
          emotion = classified.emotion;
          intensity = Math.max(0.1, Math.min(1.0, classified.intensity || 0.5));
        }
      } catch (err) {
        console.error('⚠️ LLM classify error:', err.message);
        // Use current PES emotion — no problem
      }
    }

    // ── Step 2: Babble Engine generates sounds (CORE) ──
    // v4: Context-aware generation with blends and after-silence

    let reply;

    // Check if owner just returned after silence
    const silenceMin = this._lastOwnerMessageTime
      ? (Date.now() - this._lastOwnerMessageTime) / 60000
      : 0;

    if (category === 'greetings' && silenceMin > 30 && this._babble.generateAfterSilence) {
      // Owner returned after long absence — special greeting
      reply = this._babble.generateAfterSilence(level, silenceMin, emotion);
    } else if (this.pes?.emotions) {
      // v4: Try emotion blend (current PES state + LLM-classified emotion)
      const pesEmotion = this.pes.emotions.state;
      if (pesEmotion !== emotion && this._babble.generateBlended && Math.random() < 0.3) {
        reply = this._babble.generateBlended(level, pesEmotion, emotion, intensity);
      } else {
        reply = this._babble.generateEnhanced(level, emotion, intensity, ownerText);
      }
    } else {
      reply = this._babble.generateEnhanced(level, emotion, intensity, ownerText);
    }

    // Track last reply for imprinting
    this._lastPesReply = reply;

    return reply;
  }

  /**
   * Send a sticker that matches the emotional context.
   * Uses preference_score + freshness boost + tag-matching from DB.
   * NO random stickers — only contextually relevant ones.
   * @param {string|null} category — detected keyword category
   */
  /**
   * v4: Pick response pattern — how to combine sticker + text + reaction.
   * Based on emotion, energy, category, and randomness.
   */
  _pickResponsePattern(category) {
    const emotion = this.pes?.emotions?.state || 'idle';
    const energy = this.pes?.emotions?.energy || 0.5;
    const intensity = this.pes?.emotions?.intensity || 0.5;

    // High-energy emotional moments → sticker first or sticker only
    if (['greeting_frenzy', 'zoomies', 'play_bow'].includes(emotion) && intensity > 0.7) {
      return Math.random() < 0.3 ? 'sticker_only' : 'sticker_first';
    }

    // Greetings/praise → sticker first (excited dog runs to you first, then barks)
    if (category === 'greetings' || category === 'praise') {
      return Math.random() < 0.5 ? 'sticker_first' : 'text_then_sticker';
    }

    // Scared/sad → text only (quiet, no sticker spam)
    if (['scared', 'sad', 'lonely', 'anxious', 'sulking'].includes(emotion)) {
      return 'text_only';
    }

    // Low energy → mostly text
    if (energy < 0.3) {
      return Math.random() < 0.85 ? 'text_only' : 'text_then_sticker';
    }

    // Normal flow — weighted random
    const r = Math.random();
    if (r < 0.45) return 'text_only';
    if (r < 0.70) return 'text_then_sticker';
    if (r < 0.90) return 'sticker_first';
    return 'sticker_only';
  }

  async _sendContextualSticker(category) {
    if (!this._stickerFileIds || this._stickerFileIds.length === 0) return;

    // Map category to emotion for sticker selection
    const emotionMap = {
      greetings: ['happy', 'excited', 'playful'],
      praise: ['happy', 'excited', 'trust'],
      scold: ['sad', 'scared', 'submissive'],
      feed: ['happy', 'excited', 'food_obsessed'],
      play: ['playful', 'zoomies', 'excited'],
      status: ['curious', 'interested'],
      excited: ['excited', 'happy', 'playful'],
    };

    const targetEmotions = emotionMap[category] || null;

    // ── EXPLORATION MODE: 30% chance to pick from loaded packs (not just DB) ──
    // This helps PES discover new stickers and not get stuck on favorites
    if (Math.random() < 0.3 && this._stickerFileIds && this._stickerFileIds.length > 0) {
      // Try emotion-matched from loaded packs first
      let explored = null;
      if (targetEmotions && this._stickerEmotionIndex) {
        for (const emotion of targetEmotions) {
          const stickers = this._stickerEmotionIndex[emotion];
          if (stickers && stickers.length > 0) {
            // Filter out recently sent
            const fresh = stickers.filter(s => !this._recentSentStickers.includes(s));
            explored = fresh.length > 0 ? pickRandom(fresh) : pickRandom(stickers);
            break;
          }
        }
      }
      // No emotion match — pick any random sticker from full pool
      if (!explored) {
        const fresh = this._stickerFileIds.filter(s => !this._recentSentStickers.includes(s));
        explored = fresh.length > 0 ? pickRandom(fresh) : pickRandom(this._stickerFileIds);
      }
      if (explored) {
        try {
          await this._sendSticker(this.chatId, explored);
          this._recentSentStickers.push(explored);
          if (this._recentSentStickers.length > 10) this._recentSentStickers.shift();
          return;
        } catch (_) {}
      }
    }

    // ── DB-ranked stickers with DIVERSITY enforcement ──
    if (this.pes.store && targetEmotions) {
      for (const emotion of targetEmotions) {
        const ranked = this.pes.store.getStickersByRelevance({ emotion_key: emotion, limit: 10 });
        if (ranked.length > 0) {
          // Weighted random with anti-repeat penalty
          const weights = ranked.map(s => {
            let w = Math.max(0.1, (s.preference_score || 0) + (s.freshness_boost || 1) + 1);
            // Penalize recently sent stickers (×0.15 weight)
            if (this._recentSentStickers.includes(s.file_unique_id) || this._recentSentStickers.includes(s.file_id)) {
              w *= 0.15;
            }
            // Diminishing returns on heavy use — prevent single sticker domination
            if (s.times_used > 3) w *= (3 / s.times_used);
            return w;
          });
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          let r = Math.random() * totalWeight;
          let chosen = ranked[0];
          for (let i = 0; i < ranked.length; i++) {
            r -= weights[i];
            if (r <= 0) { chosen = ranked[i]; break; }
          }
          try {
            await this._sendSticker(this.chatId, chosen.file_id);
            this._lastSentStickerUniqueId = chosen.file_unique_id;
            this.pes.store.markStickerUsed(chosen.file_unique_id);
            this._recentSentStickers.push(chosen.file_unique_id);
            if (this._recentSentStickers.length > 10) this._recentSentStickers.shift();
            return;
          } catch (_) {}
        }
      }
    }

    // Fallback: emotion index from loaded packs (if DB has no analyzed stickers)
    if (targetEmotions && this._stickerEmotionIndex) {
      for (const emotion of targetEmotions) {
        const stickers = this._stickerEmotionIndex[emotion];
        if (stickers && stickers.length > 0) {
          const fresh = stickers.filter(s => !this._recentSentStickers.includes(s));
          const sticker = fresh.length > 0 ? pickRandom(fresh) : pickRandom(stickers);
          try {
            await this._sendSticker(this.chatId, sticker);
            this._recentSentStickers.push(sticker);
            if (this._recentSentStickers.length > 10) this._recentSentStickers.shift();
          } catch (_) {}
          return;
        }
      }
    }

    // No match found — pick any random sticker from loaded packs
    if (this._stickerFileIds && this._stickerFileIds.length > 0) {
      const fresh = this._stickerFileIds.filter(s => !this._recentSentStickers.includes(s));
      const sticker = fresh.length > 0 ? pickRandom(fresh) : pickRandom(this._stickerFileIds);
      try {
        await this._sendSticker(this.chatId, sticker);
        this._recentSentStickers.push(sticker);
        if (this._recentSentStickers.length > 10) this._recentSentStickers.shift();
      } catch (_) {}
    }
  }

  // ── Short Memory ────────────────────────────────────────────

  _addToMemory(role, text) {
    this._memory.push({ role, text, ts: Date.now() });
    // At 9 messages — trigger context compression (async, non-blocking)
    if (this._memory.length >= 9 && !this._summarizing) {
      this._compressContext();
    }
  }

  /**
   * Compress current memory into a summary using LLM.
   * Accumulated summary grows — old info is never lost.
   */
  async _compressContext() {
    if (!this._llm || this._summarizing) return;
    this._summarizing = true;

    try {
      const historyText = this._memory.map(m => {
        const who = m.role === 'owner' ? 'Хозяин' : 'ПЕС';
        return `${who}: ${m.text}`;
      }).join('\n');

      const existingCtx = this._contextSummary
        ? `Предыдущий контекст:\n${this._contextSummary}\n\n`
        : '';

      const summaryPrompt = `Ты — система памяти для ПЕС (собака-корги). Твоя задача — сжать диалог в краткое резюме, сохранив ВСЮ важную информацию.

${existingCtx}Новый диалог для сжатия:
${historyText}

ИНСТРУКЦИИ:
- Сохрани ВСЕ факты: имена, события, предпочтения хозяина, ключевые темы
- Сохрани эмоциональный контекст: как прошёл разговор, настроение
- Если есть предыдущий контекст — объедини с новой информацией
- Формат: краткие тезисы, максимум 150 слов
- Пиши на русском`;

      const result = await this._llm.generate(summaryPrompt, [
        { role: 'user', content: 'Сожми этот диалог в краткое резюме.' }
      ]);

      if (result) {
        this._contextSummary = result;
        // Keep only last 2 messages as bridge, clear the rest
        this._memory = this._memory.slice(-2);
        // Persist to DB so it survives restarts
        this._saveContextSummary();
        console.log(`🧠 Context compressed. Summary: ${result.substring(0, 80)}...`);
      }
    } catch (err) {
      console.error('⚠️ Context compression failed:', err.message);
    } finally {
      this._summarizing = false;
    }
  }

  // ── Context Persistence ────────────────────────────────────

  /** Load context summary from SQLite on startup. */
  _loadContextSummary() {
    if (!this.pes.store) return;
    try {
      const saved = this.pes.store.getConfig('context_summary');
      if (saved) {
        this._contextSummary = saved;
        console.log(`🧠 Context summary loaded from DB (${saved.length} chars)`);
      }
    } catch (err) {
      console.error('⚠️ Failed to load context summary:', err.message);
    }
  }

  /** Save context summary to SQLite after compression. */
  _saveContextSummary() {
    if (!this.pes.store || !this._contextSummary) return;
    try {
      this.pes.store.setConfig('context_summary', this._contextSummary);
    } catch (err) {
      console.error('⚠️ Failed to save context summary:', err.message);
    }
  }

  // ── Idle Behavior ─────────────────────────────────────────

  /** Start idle timer — Тор скучает если хозяин молчит. */
  _startIdleTimer() {
    this._lastOwnerMessageTime = Date.now();
    this._idleTimer = setInterval(() => this._checkIdle(), 5 * 60 * 1000); // every 5 min
    this._lastIdleMessage = 0; // prevent spam

    // ── Proactive daily messages (Живой бот) ──
    this._proactiveToday = 0;
    this._proactiveDate = '';
    this._loadProactiveState();
    // Check proactive every 30 min (separate from idle)
    this._proactiveTimer = setInterval(() => this._checkProactive(), 30 * 60 * 1000);

    console.log('😴 Idle behavior timer started (check every 5min, proactive every 30min)');
  }

  /** Load proactive message state from DB. */
  _loadProactiveState() {
    try {
      const raw = this.pes?.store?.getConfig?.('proactive_state');
      if (raw) {
        const state = JSON.parse(raw);
        this._proactiveDate = state.date || '';
        this._proactiveToday = state.count || 0;
      }
    } catch (_) {}
  }

  /** Save proactive message state to DB. */
  _saveProactiveState() {
    try {
      this.pes?.store?.setConfig?.('proactive_state', JSON.stringify({
        date: this._proactiveDate,
        count: this._proactiveToday,
      }));
    } catch (_) {}
  }

  /**
   * Proactive daily messages — PES сам пишет если хозяин давно не заходил.
   * Rules: max 2/day, not at night (23-7 Moscow), only after 3h+ silence.
   * Content depends on mood/hunger/loneliness.
   */
  async _checkProactive() {
    if (!this._lastOwnerMessageTime || !this.chatId) return;
    if (this._devMode || this._agentMode) return;

    // Reset daily counter if new day
    const today = new Date().toISOString().slice(0, 10);
    if (this._proactiveDate !== today) {
      this._proactiveDate = today;
      this._proactiveToday = 0;
      this._saveProactiveState();
    }

    // Max 2 proactive messages per day
    if (this._proactiveToday >= 2) return;

    // Not at night (Moscow time)
    const moscowHour = (new Date().getUTCHours() + 3) % 24;
    if (moscowHour >= 23 || moscowHour < 8) return;

    // Only after 3+ hours of silence
    const silentHours = (Date.now() - this._lastOwnerMessageTime) / (3600 * 1000);
    if (silentHours < 3) return;

    // Don't overlap with idle messages (at least 60 min gap)
    const sinceLastIdle = (Date.now() - (this._lastIdleMessage || 0)) / (60 * 1000);
    if (sinceLastIdle < 60) return;

    const level = this.pes?.level || 0;
    const mood = this.pes?.emotions?.mood ?? 0.5;
    const hunger = this.pes?.emotions?.hunger ?? 0.2;
    const loneliness = this.pes?.emotions?.loneliness ?? 0.1;
    const energy = this.pes?.emotions?.energy ?? 0.5;
    const name = this.pes?.name || 'PES';

    // Pick message type based on vitals
    let messageType;
    if (hunger > 0.6) messageType = 'hungry';
    else if (loneliness > 0.5) messageType = 'lonely';
    else if (energy < 0.3) messageType = 'sleepy';
    else if (mood < 0.3) messageType = 'sad';
    else if (mood > 0.7) messageType = 'playful';
    else messageType = 'curious';

    const PROACTIVE_MESSAGES = {
      hungry: [
        '🍖❓ ...ав... 🐾',
        '👃💨🍖 ... *тыкает миску носом*',
        '🐾🥺 ...ммм... кушать...',
      ],
      lonely: [
        '🐾💧 ...скууучно... 👀',
        '📱👀 ...ты где?... 🐾',
        '🐾... *лежит у двери и вздыхает* 💨',
      ],
      sleepy: [
        '😴🐾 *зевает и ищет тёплое место*',
        '💤... *свернулся калачиком* 🐾',
        '🐾😴 ...ззз... *дёргает лапкой во сне*',
      ],
      sad: [
        '🐾💧 *грустно смотрит в окно*',
        '...🥺🐾... *тихо скулит*',
        '👀💧 ...давно не играли... 🐾',
      ],
      playful: [
        '🎾🐾 ав! играть?! 👀✨',
        '🐾💨 *принёс мячик и положил у ног* 🎾',
        '🐾🌀 *крутится вокруг себя* ...авав! 🎉',
      ],
      curious: [
        '👃💨 ...интересно... 🐾👀',
        '🐾📡 *навострил уши — что-то слышит*',
        '👀🐾 *заглядывает в телефон* ...привет? 📱',
      ],
    };

    const messages = PROACTIVE_MESSAGES[messageType] || PROACTIVE_MESSAGES.curious;
    const text = messages[Math.floor(Math.random() * messages.length)];

    try {
      await this._sendText(this.chatId, text);

      // Sometimes add a sticker (30% chance)
      if (Math.random() < 0.3) {
        const stickerEmotion = messageType === 'hungry' ? 'feed' :
          messageType === 'playful' ? 'praise' :
          messageType === 'sad' || messageType === 'lonely' ? 'scold' : null;
        await this._sendContextualSticker(stickerEmotion);
      }

      this._proactiveToday++;
      this._lastIdleMessage = Date.now(); // prevent idle overlap
      this._saveProactiveState();

      console.log(`🐾 Proactive message sent (${messageType}, #${this._proactiveToday}/2 today)`);
    } catch (err) {
      console.error('⚠️ Proactive message error:', err.message);
    }
  }

  /** Check if owner has been silent too long and send idle behavior. */
  async _checkIdle() {
    if (!this._lastOwnerMessageTime) return;
    if (this._devMode || this._agentMode) return; // don't idle in dev/agent mode

    const silentMinutes = (Date.now() - this._lastOwnerMessageTime) / (60 * 1000);
    const sinceLastIdle = (Date.now() - this._lastIdleMessage) / (60 * 1000);

    // Don't spam — minimum 30 min between idle messages
    if (sinceLastIdle < 30) return;

    // Check time of day (Moscow) — don't idle at night
    const moscowHour = (new Date().getUTCHours() + 3) % 24;
    if (moscowHour >= 23 || moscowHour < 7) return;

    // ── Sticker discovery on idle (young+ level) ──
    if (silentMinutes >= 15 && silentMinutes < 30) {
      // Dog is bored — time to explore stickers
      this._exploreStickerDiscovery().catch(err =>
        console.error('⚠️ Idle sticker discovery error:', err.message)
      );
    }

    const level = this.pes?.level || 0;
    const vitals = {
      energy: this.pes?.emotions?.energy || 0.5,
      hunger: this.pes?.emotions?.hunger || 0.2,
      loneliness: this.pes?.emotions?.loneliness || 0.1,
      curiosity: this.pes?.emotions?.curiosity || 0.5,
    };

    if (silentMinutes >= 120) {
      // Very long absence (2h+) — deep lonely sounds via babble engine
      const babble = this._babble.generateAfterSilence
        ? this._babble.generateIdle(level, { ...vitals, loneliness: 0.8, energy: 0.3 })
        : this._babble.generate(level, 'lonely', 0.6);
      await this._sendText(this.chatId, babble + ' 💧');
      // Sometimes a sad sticker
      if (Math.random() < 0.5) {
        await this._sendContextualSticker('scold'); // sad stickers
      }
      this._lastIdleMessage = Date.now();
    } else if (silentMinutes >= 60) {
      // Lonely — 1+ hour of silence — use babble idle generator
      const babble = this._babble.generateIdle
        ? this._babble.generateIdle(level, { ...vitals, loneliness: 0.6 })
        : this._babble.generate(level, 'sad', 0.4);
      await this._sendText(this.chatId, babble);
      this._lastIdleMessage = Date.now();
    } else if (silentMinutes >= 30) {
      // Mildly bored — 30+ min — generate curiosity/bored babble
      const babble = this._babble.generateIdle
        ? this._babble.generateIdle(level, { ...vitals, curiosity: 0.3 })
        : this._babble.generate(level, 'curious', 0.3);
      await this._sendText(this.chatId, babble);

      // v4: Spontaneous action — sometimes do something interesting
      const spontaneous = Math.random();
      if (spontaneous < 0.25) {
        // Send a sticker
        await this._sendContextualSticker(null);
      } else if (spontaneous < 0.40 && level >= 5) {
        // "Sniff around" — small observation
        const observations = [
          '👃💨 🐾', // sniffing
          '👀... 🐾', // looking around
          '👂⬆️👂 ...', // ears perked
          '📡📡 ...?', // scanning
        ];
        await sleep(2000 + Math.random() * 3000);
        await this._sendText(this.chatId, pickRandom(observations));
      }
      this._lastIdleMessage = Date.now();
    }
  }

  // ── Interaction Pattern Observation ──────────────────────────

  /**
   * Observe and record interaction patterns from owner's message.
   * Tracks: emotions, topics, sticker types, time of day, message styles.
   * This data drives sticker discovery (not a hardcoded catalog).
   */
  _observeInteractionPatterns(text, detectedKw = null) {
    if (!this.pes.store) return;
    try {
      // 1. Time of day pattern
      const moscowHour = (new Date().getUTCHours() + 3) % 24;
      const timeSlot = moscowHour < 6 ? 'night' : moscowHour < 12 ? 'morning' : moscowHour < 18 ? 'afternoon' : 'evening';
      this.pes.store.recordPattern('time_of_day', timeSlot, 0.5);

      // 2. Keyword/action pattern
      if (detectedKw && detectedKw.action) {
        this.pes.store.recordPattern('action', detectedKw.action, 1.0);
        if (detectedKw.command) {
          this.pes.store.recordPattern('command', detectedKw.command, 1.5);
        }
      }

      // 3. Emotion from text (simple keyword detection)
      const emotionPatterns = {
        happy: /(?:хаха|лол|😂|🤣|ахах|класс|круто|огонь|🔥|супер|ура)/i,
        sad: /(?:грустно|печально|😢|😭|жаль|увы|скучаю)/i,
        angry: /(?:бесит|злой|злюсь|😡|🤬|блин|чёрт)/i,
        love: /(?:люблю|❤️|💕|♡|обнимаю|скучаю|♥)/i,
        excited: /(?:вау|ого|офигеть|🤩|amazing|wow|урааа|!!!)/i,
        playful: /(?:играть|игра|прикол|😜|🤪|хех|жжёшь)/i,
        food: /(?:еда|есть|кушать|голод|🍕|🍔|🍩|вкусн|кормить)/i,
      };

      for (const [emotion, pattern] of Object.entries(emotionPatterns)) {
        if (pattern.test(text)) {
          this.pes.store.recordPattern('emotion', emotion, 1.0);
        }
      }

      // 4. Message length pattern (affects communication style)
      const lengthType = text.length < 10 ? 'short' : text.length < 50 ? 'medium' : 'long';
      this.pes.store.recordPattern('message_style', lengthType, 0.3);

      // 5. Emoji usage pattern — which emojis owner prefers
      const emojis = text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
      if (emojis) {
        for (const em of emojis) {
          this.pes.store.recordPattern('emoji_used', em, 1.0);
        }
      }
    } catch (err) {
      // Non-critical — don't crash on pattern observation
      console.error('⚠️ Pattern observation error:', err.message);
    }
  }

  /**
   * Record sticker-specific patterns when owner sends sticker.
   */
  _observeStickerPattern(emoji, setName, emotionKey = null) {
    if (!this.pes.store) return;
    try {
      this.pes.store.recordPattern('sticker_emoji', emoji, 1.5);
      if (setName) {
        this.pes.store.recordPattern('sticker_pack', setName, 1.0);
      }
      if (emotionKey) {
        this.pes.store.recordPattern('sticker_emotion', emotionKey, 1.5);
      }
    } catch (err) {
      console.error('⚠️ Sticker pattern error:', err.message);
    }
  }

  /**
   * Auto-load a sticker/custom emoji set if not already known.
   */
  async _autoLoadStickerSet(setName) {
    if (!setName || this._learnedPacks.has(setName)) return;
    try {
      await this.loadStickerPack(setName, null, true);
      this._learnedPacks.add(setName);
      this._saveStickerPackToDB(setName);
      console.log(`📦 Auto-loaded sticker set: ${setName}`);
    } catch (_) {
      // Pack not accessible (custom emoji sets may not be loadable as regular packs)
    }
  }

  // ── Sticker Discovery from Interaction Patterns ──────────

  /**
   * Explore sticker packs based on observed interaction patterns.
   * Called periodically (from idle timer or after N messages).
   * The dog doesn't use a catalog — it learns from watching the owner.
   */
  async _exploreStickerDiscovery() {
    if (!this.pes.store) return;

    // Only young+ can explore
    const stats = this.pes.store.getStats();
    if (!stats) return;
    // Level gate removed — testing all features

    // Check cooldown — max 1 exploration per 4 hours
    const lastExploreTime = this.pes.store.getConfig('last_sticker_explore');
    if (lastExploreTime) {
      const elapsed = Date.now() - new Date(lastExploreTime).getTime();
      if (elapsed < 4 * 60 * 60 * 1000) return; // 4 hours
    }

    try {
      // Strategy 1: Explore untried stickers from known packs
      const explorablePacks = this.pes.store.getExplorablePacks(3);
      for (const pack of explorablePacks) {
        const untried = this.pes.store.getUntriedStickersFromPack(pack.set_name, 1);
        if (untried.length > 0) {
          const sticker = untried[0];
          // Dog found something to try!
          await this._showStickerDiscovery(sticker, pack);
          this.pes.store.setConfig('last_sticker_explore', new Date().toISOString());
          return; // One discovery at a time
        }
      }

      // Strategy 2: Look for new packs from owner's sticker patterns
      const packPatterns = this.pes.store.getTopPatterns('sticker_pack', 5);
      if (packPatterns.length > 0) {
        // Try to discover related packs by name variation
        for (const pattern of packPatterns) {
          const baseName = pattern.pattern_value;
          // Check if there's a discovery record for this pack's "family"
          const disc = this.pes.store.db.prepare(
            'SELECT COUNT(*) as cnt FROM sticker_discovery WHERE set_name = ?'
          ).get(baseName);

          if (!disc || disc.cnt === 0) {
            // First time seeing this pack in discovery — register it
            const stickerCount = this.pes.store.db.prepare(
              'SELECT COUNT(*) as cnt FROM learned_stickers WHERE set_name = ?'
            ).get(baseName);

            this.pes.store.saveDiscovery(baseName, {
              source: 'owner',
              stickersTotal: stickerCount?.cnt || 0,
              matchScore: pattern.weight,
              notes: { reason: 'owner_uses', occurrences: pattern.occurrences },
            });
          }
        }
      }

      this.pes.store.setConfig('last_sticker_explore', new Date().toISOString());
    } catch (err) {
      console.error('⚠️ Sticker discovery error:', err.message);
    }
  }

  /**
   * Show a discovered sticker to the owner — dog "brings" it proudly.
   * Waits for owner's reaction (👍/👎) via the reaction handler.
   */
  async _showStickerDiscovery(sticker, pack) {
    try {
      // Typing — dog "runs to get" the sticker
      await this._sendChatAction(this.chatId);
      await sleep(1500 + Math.random() * 2000);

      // Send the sticker
      await this._sendSticker(this.chatId, sticker.file_id);

      // Proud sounds
      const sounds = [
        'тяф?! ✨🐾 рру~!',
        'ГАВВ! ✨ тяф-тяф! 🐾',
        'рруу~! ✨ ваф? 🐾',
        'ыыыа! ✨ тяф! 🐾',
      ];
      await this._sendText(this.chatId, pickRandom(sounds));

      // Track this as the last bot action for reaction tracking
      this._lastBotAction = {
        action: 'sticker_discovery',
        text: `discovered sticker from ${pack.set_name}`,
        category: 'sticker',
        timestamp: Date.now(),
        discoveryPackName: pack.set_name,
        stickerUniqueId: sticker.file_unique_id,
      };

      // Mark sticker as tried
      this.pes.store.markStickerTried(sticker.file_unique_id);
      this.pes.store.incrementDiscoveryTried(pack.set_name);

      console.log(`🔍 Sticker discovery: showed sticker from ${pack.set_name}`);
    } catch (err) {
      console.error('⚠️ Show sticker discovery error:', err.message);
    }
  }

  // ── Dynamic Sticker Packs from DB ─────────────────────────

  /** Load sticker pack names from DB config instead of hardcoded array. */
  async _loadStickerPacksFromDB() {
    if (!this.pes.store) return;
    try {
      const saved = this.pes.store.getConfig('sticker_packs');
      let packs = [];
      if (saved) {
        packs = JSON.parse(saved);
      } else {
        // First run — use defaults and save to DB
        packs = ['CorgiLove', 'corgi_life', 'CorgiBaby', 'CorgiPower'];
        this.pes.store.setConfig('sticker_packs', JSON.stringify(packs));
      }

      let firstPack = true;
      for (const pack of packs) {
        try {
          await this.loadStickerPack(pack, null, !firstPack);
          this._learnedPacks.add(pack);
          console.log(`📦 Loaded sticker pack from DB: ${pack}`);
          firstPack = false;
        } catch (err) {
          console.log(`⚠️ Pack "${pack}" not available: ${err.message}`);
        }
      }
      console.log(`📦 Total stickers loaded: ${this._stickerFileIds?.length || 0} from ${packs.length} packs`);
    } catch (err) {
      console.error('⚠️ Failed to load sticker packs from DB:', err.message);
    }
  }

  /** Save a new sticker pack name to DB config. */
  _saveStickerPackToDB(packName) {
    if (!this.pes.store) return;
    try {
      const saved = this.pes.store.getConfig('sticker_packs');
      const packs = saved ? JSON.parse(saved) : [];
      if (!packs.includes(packName)) {
        packs.push(packName);
        this.pes.store.setConfig('sticker_packs', JSON.stringify(packs));
        console.log(`📦 Saved sticker pack to DB: ${packName}`);
      }
    } catch (err) {
      console.error('⚠️ Failed to save sticker pack:', err.message);
    }
  }

  // ── Emoji Learning ─────────────────────────────────────────

  /**
   * Log a reaction (praise/scold/text feedback) to the last bot action.
   * @param {string} reactionType — 'praise' | 'scold' | 'positive' | 'negative'
   * @param {string} reactionValue — the text that triggered this
   * @param {number} weight — -2 to 2
   */
  _logReactionToLastAction(reactionType, reactionValue, weight) {
    if (!this.pes.store || !this._lastBotAction) return;

    const speedMs = Date.now() - this._lastBotAction.timestamp;

    try {
      this.pes.store.logReaction({
        pes_action: this._lastBotAction.action || 'reply',
        pes_expression: this._lastBotAction.text || null,
        pes_context: this._lastBotAction.category || null,
        reactor: 'owner',
        reactor_role: 'owner',
        reaction_type: reactionType,
        reaction_value: reactionValue?.slice(0, 200) || null,
        reaction_speed: speedMs,
        weight,
        platform: 'telegram',
      });

      // Recalculate preferences periodically
      this._reactionRecalcCounter++;
      if (this._reactionRecalcCounter >= 5) {
        this._reactionRecalcCounter = 0;
        this.pes.store.recalculatePreference(this._lastBotAction.action || 'reply');
      }

      console.log(`💭 Reaction logged: ${reactionType} (weight=${weight}) → action "${this._lastBotAction.action}"`);
    } catch (err) {
      console.error('⚠️ Failed to log reaction:', err.message);
    }
  }

  /**
   * Grant XP and handle level-up notifications.
   * @param {string} reason — 'message' | 'praise' | 'scold' | 'sticker' | 'reaction' | 'emoji'
   * @param {number} amount — base XP amount
   */
  async _grantXp(reason, amount) {
    if (!this.pes.store) return;
    try {
      const result = this.pes.store.addXP(amount, reason);
      const capInfo = result.dailyXP >= result.dailyCap ? ' [CAP]' : '';
      console.log(`⭐ XP +${result.added} (${reason}) → level ${result.level} [${result.phase}]${capInfo} daily:${result.dailyXP}/${result.dailyCap}`);

      // Level-up notification
      if (result.leveledUp) {
        const levelUpSounds = [
          'ГАВВВ!! ГАВГАВГАВ!! ♡♡♡ ыыыыааа!! ⭐⭐⭐',
          'рррРРРУУУУ!! ваф-ваф-ваф!! ⭐ тяф!!',
          'УУУУУ!! гав! гав! гав! ♡ ⭐⭐',
        ];
        const sound = levelUpSounds[Math.floor(Math.random() * levelUpSounds.length)];

        // Show age gate info — how many days until next phase
        const ageDays = this.pes.store.getAgeDays();
        const AGE_GATES = { puppy: 0, young: 30, adult: 365, experienced: 1095, cyber: 1825 };
        const phaseOrder = ['puppy', 'young', 'adult', 'experienced', 'cyber'];
        const currentPhaseIdx = phaseOrder.indexOf(result.phase);
        let nextPhaseInfo = '';
        if (currentPhaseIdx < phaseOrder.length - 1) {
          const nextPhase = phaseOrder[currentPhaseIdx + 1];
          const daysNeeded = AGE_GATES[nextPhase] - ageDays;
          if (daysNeeded > 0) {
            nextPhaseInfo = `\n📅 ${nextPhase}: ${daysNeeded}д`;
          }
        }

        const msg = `${sound}\n\n⬆️ ${Math.floor(result.level)} [${result.phase}] ✨${nextPhaseInfo}`;
        await this._sendText(this.chatId, msg);

        // Send a celebratory sticker
        await this._sendContextualSticker('excited');
      }

      // Artifact drop chance (5% per XP grant, unlocked at L5)
      if (this.pes.store.isUnlocked?.('artifacts') || Math.floor(result.level) >= 5) {
        await this._tryArtifactDrop(reason, result);
      }
    } catch (err) {
      console.error('⚠️ Failed to grant XP:', err.message);
    }
  }

  // ── Artifact Drop System ──────────────────────────────────

  async _tryArtifactDrop(reason, xpResult) {
    const DROP_CHANCE = 0.05; // 5% base
    const LEVEL_BONUS = Math.floor(xpResult.level) * 0.002; // +0.2% per level
    const roll = Math.random();
    if (roll > DROP_CHANCE + LEVEL_BONUS) return;

    const ARTIFACT_POOL = [
      // Common (60%)
      { name: 'Мячик', emoji: '⚽', type: 'toy', rarity: 'common', weight: 12 },
      { name: 'Палка', emoji: '🪵', type: 'toy', rarity: 'common', weight: 12 },
      { name: 'Косточка', emoji: '🦴', type: 'food', rarity: 'common', weight: 12 },
      { name: 'Камешек', emoji: '🪨', type: 'toy', rarity: 'common', weight: 12 },
      { name: 'Перо', emoji: '🪶', type: 'toy', rarity: 'common', weight: 12 },
      // Uncommon (25%)
      { name: 'Бабочка в банке', emoji: '🦋', type: 'trophy', rarity: 'uncommon', weight: 7 },
      { name: 'Блестящая монета', emoji: '🪙', type: 'trophy', rarity: 'uncommon', weight: 6 },
      { name: 'Ракушка', emoji: '🐚', type: 'trophy', rarity: 'uncommon', weight: 6 },
      { name: 'Колокольчик', emoji: '🔔', type: 'gift', rarity: 'uncommon', weight: 6 },
      // Rare (10%)
      { name: 'Кристалл', emoji: '💎', type: 'rare', rarity: 'rare', weight: 4 },
      { name: 'Звёздная пыль', emoji: '✨', type: 'rare', rarity: 'rare', weight: 3 },
      { name: 'Лунный камень', emoji: '🌙', type: 'rare', rarity: 'rare', weight: 3 },
      // Epic (4%)
      { name: 'Драконий зуб', emoji: '🐉', type: 'rare', rarity: 'epic', weight: 2 },
      { name: 'Огненный цветок', emoji: '🌺', type: 'rare', rarity: 'epic', weight: 2 },
      // Legendary (1%)
      { name: 'Сердце Вселенной', emoji: '💫', type: 'secret', rarity: 'legendary', weight: 1 },
    ];

    // Weighted random
    const totalWeight = ARTIFACT_POOL.reduce((s, a) => s + a.weight, 0);
    let r = Math.random() * totalWeight;
    let picked = ARTIFACT_POOL[0];
    for (const art of ARTIFACT_POOL) {
      r -= art.weight;
      if (r <= 0) { picked = art; break; }
    }

    const ownerId = String(this.chatId);
    try {
      this.pes.store.addArtifact({
        owner_id: ownerId,
        artifact_type: picked.type,
        name: picked.name,
        emoji: picked.emoji,
        rarity: picked.rarity,
        source: reason,
        source_detail: `xp_grant_${reason}`,
      });

      const RARITY_STARS = { common: '⬜', uncommon: '🟩', rare: '🟦', epic: '🟪', legendary: '🟨' };
      const star = RARITY_STARS[picked.rarity] || '⬜';
      await this._sendText(this.chatId, `${picked.emoji} нашёл ${picked.name}! ${star} ${picked.rarity}\nгав! гав! 🐾 → /artifacts`);
      console.log(`🎁 Artifact drop: ${picked.name} (${picked.rarity}) for ${ownerId}`);
    } catch (err) {
      console.error('⚠️ Artifact drop failed:', err.message);
    }
  }

  // ── Smart XP System ──────────────────────────────────────

  /**
   * Calculate dynamic XP for a message based on quality.
   * Replaces fixed +1 with context-aware scoring.
   */
  _calculateMessageXP(msg, intent = null) {
    const text = msg?.text || msg?.caption || '';
    let xp = 1; // base
    let detail = { length: 'short' };

    // Length bonus: medium (+1), long (+2)
    if (text.length > 100) {
      xp = 3;
      detail.length = 'long';
    } else if (text.length > 40) {
      xp = 2;
      detail.length = 'medium';
    }

    // Teaching intent: "знай что", "запомни", file with caption
    if (intent === 'note' || intent === 'teach') {
      xp = Math.max(xp, 3);
      detail.teaching = true;
    }

    // File with caption = content contribution
    if ((msg?.photo || msg?.document || msg?.video || msg?.voice) && text.length > 5) {
      xp = Math.max(xp, 3);
      detail.file_with_desc = true;
    }

    // Correction bonus: owner continues after negative reaction
    if (this._lastReactionWasNegative && Date.now() - (this._lastReactionTime || 0) < 5 * 60 * 1000) {
      xp += 2;
      detail.correction = true;
      this._lastReactionWasNegative = false;
    }

    return { xp, detail: JSON.stringify(detail) };
  }

  /**
   * Track dialogue session. Returns bonus XP if milestone reached.
   */
  _trackDialogue() {
    const now = Date.now();
    const SESSION_GAP = 10 * 60 * 1000; // 10 min

    if (!this._dialogueStartTime || (now - (this._lastDialogueMessageTime || 0)) > SESSION_GAP) {
      // New session
      this._dialogueStartTime = now;
      this._dialogueMessageCount = 1;
    } else {
      this._dialogueMessageCount = (this._dialogueMessageCount || 0) + 1;
    }
    this._lastDialogueMessageTime = now;

    // Bonus at 5, 10, 15 messages in session
    if (this._dialogueMessageCount === 5 || this._dialogueMessageCount === 10 || this._dialogueMessageCount === 15) {
      return this._dialogueMessageCount === 5 ? 5 : this._dialogueMessageCount === 10 ? 3 : 2;
    }
    return 0;
  }

  /**
   * Check and update daily streak. Returns streak info.
   * Called on first message of the day.
   */
  _checkStreak() {
    if (!this.pes.store) return null;
    try {
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const lastDate = this.pes.store.getConfig('streak_last_date');
      const currentStreak = parseInt(this.pes.store.getConfig('streak_current') || '0', 10);

      if (lastDate === today) return null; // already checked today

      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      let newStreak;

      if (lastDate === yesterday) {
        // Consecutive day — increment
        newStreak = currentStreak + 1;
      } else if (!lastDate) {
        // First ever
        newStreak = 1;
      } else {
        // Streak broken
        newStreak = 1;
      }

      this.pes.store.setConfig('streak_current', String(newStreak));
      this.pes.store.setConfig('streak_last_date', today);

      // XP scales with streak: 1-3 days = 1, 4-6 = 2, 7-13 = 3, 14-29 = 4, 30+ = 5
      const streakXP = newStreak >= 30 ? 5 : newStreak >= 14 ? 4 : newStreak >= 7 ? 3 : newStreak >= 4 ? 2 : 1;

      return { streak: newStreak, xp: streakXP, isMilestone: [3, 7, 14, 30, 60, 100, 365].includes(newStreak), broken: lastDate && lastDate !== yesterday && currentStreak > 1 };
    } catch (err) {
      console.error('⚠️ Streak check error:', err.message);
      return null;
    }
  }

  /**
   * Track interaction type diversity for daily bonus.
   * Types: text, sticker, reaction, file, note, command
   */
  _trackDiversity(type) {
    const today = new Date().toISOString().slice(0, 10);
    if (this._diversityDate !== today) {
      this._diversityDate = today;
      this._diversityTypes = new Set();
      this._diversityBonusGiven = false;
    }
    this._diversityTypes.add(type);

    // Bonus when reaching 3 unique types, once per day
    if (this._diversityTypes.size >= 3 && !this._diversityBonusGiven) {
      this._diversityBonusGiven = true;
      return true;
    }
    return false;
  }

  /**
   * Check if this is the first message of the day. Returns true once per day.
   */
  _checkFirstDaily() {
    const today = new Date().toISOString().slice(0, 10);
    if (this._firstDailyDate === today) return false;
    this._firstDailyDate = today;
    return true;
  }

  /**
   * Process all Smart XP grants for a message.
   * Central hub — called from _handleTextMessage, _handleMediaMessage, etc.
   */
  async _processSmartXP(msg, interactionType = 'text', intent = null) {
    if (!this.pes.store) return;

    // 1. First daily bonus
    const isFirstDaily = this._checkFirstDaily();
    if (isFirstDaily) {
      await this._grantXp('first_daily', 3);

      // Streak check (also first-daily)
      const streakInfo = this._checkStreak();
      if (streakInfo) {
        await this._grantXp('streak', streakInfo.xp);

        if (streakInfo.isMilestone) {
          // Milestone reaction — dog celebrates
          const milestoneReactions = [
            `ГАААВВ!! ррРРуууу!! 🔥${streakInfo.streak}🔥 тяф-тяф!! ✨🐾`,
            `ууУУУ!! ваф!! 🔥${streakInfo.streak}🔥 ГАВВ!! ♡♡ 🐾`,
            `рррРРР!! ГАВГАВ!! 🔥${streakInfo.streak}🔥 ыыы!! ⭐🐾`,
          ];
          await this._sendText(this.chatId, milestoneReactions[Math.floor(Math.random() * milestoneReactions.length)]);
          await this._sendContextualSticker('excited');
        } else if (streakInfo.broken) {
          // Streak was broken — dog is a bit sad but happy you're back
          await this._sendText(this.chatId, 'скууу... ыыы... 💧 ...рру~ ♡ 🐾');
        }
      }
    }

    // 2. Dynamic message XP (replaces fixed +1)
    const { xp, detail } = this._calculateMessageXP(msg, intent);
    await this._grantXp('message', xp);

    // 3. Dialogue bonus
    const dialogueBonus = this._trackDialogue();
    if (dialogueBonus > 0) {
      await this._grantXp('dialogue_bonus', dialogueBonus);
    }

    // 4. Diversity tracking
    const diversityReached = this._trackDiversity(interactionType);
    if (diversityReached) {
      await this._grantXp('diversity', 5);
    }

    // 5. Spell discovery check (rare — every 10th message)
    if (Math.random() < 0.1) {
      await this._checkSpellDiscovery();
    }
  }

  /**
   * Check for spell discovery and display animation if found.
   */
  async _checkSpellDiscovery() {
    if (!this.pes || !this.pes.checkSpellDiscovery) return;
    try {
      const spell = this.pes.checkSpellDiscovery();
      if (spell) {
        // Spell discovery animation!
        const rarityStars = {
          spark: '✦', glint: '✧', flash: '⚡', pulse: '💫',
          surge: '🌊', wave: '🌊', storm: '⛈️', blaze: '🔥',
          nova: '💥', eclipse: '🌑', cosmos: '🌌', god: '👁️‍🗨️',
        };
        const icon = rarityStars[spell.rarity] || '✨';
        const percent = 100 + spell.level;

        await this._sendChatAction(this.chatId);
        await sleep(2000);

        // Dramatic reveal
        await this._sendText(this.chatId, '✨✨✨✨✨✨✨✨✨✨✨✨');
        await sleep(1500);
        await this._sendText(this.chatId, `${icon} SPELL AWAKENED ${icon}`);
        await sleep(1000);
        await this._sendText(this.chatId, `${icon} ${spell.name} (${percent}%) ${icon}`);
        await sleep(1000);
        await this._sendText(this.chatId, `[${spell.rarity.toUpperCase()}]`);
        await sleep(500);
        await this._sendText(this.chatId, '✨✨✨✨✨✨✨✨✨✨✨✨');

        // Dog reaction
        await sleep(1000);
        const reactions = [
          'ррРРРуууу!! ...тяф?! ...ГАВВ!! ✨🐾',
          'ууУУУ!! ...рру~... ...ГАВГАВ!! ✨🐾',
          '...тяф... ...рррРР!! ...ГАААВВ!! ✨🐾',
        ];
        await this._sendText(this.chatId, reactions[Math.floor(Math.random() * reactions.length)]);
        await this._sendContextualSticker('excited');
      }
    } catch (err) {
      console.error('⚠️ Spell discovery check error:', err.message);
    }
  }

  // ── Relationships ─────────────────────────────────────────

  /**
   * Initialize owner relationship on bot start.
   * Creates 'owner' entity if doesn't exist.
   */
  _initOwnerRelationship() {
    if (!this.pes.store) return;
    try {
      const existing = this.pes.store.getRelationship('owner');
      if (!existing) {
        this.pes.store.addOrUpdateRelationship('owner', {
          trust: 0.3,
          affection: 0.3,
          relationship_phase: 'acquaintance',
        });
        console.log('💛 Owner relationship initialized (trust=0.3, affection=0.3, acquaintance)');
      } else {
        console.log(`💛 Owner relationship loaded: trust=${existing.trust.toFixed(2)}, affection=${existing.affection.toFixed(2)}, phase=${existing.relationship_phase}, interactions=${existing.interactions_count}`);
      }
    } catch (err) {
      console.error('⚠️ Failed to init owner relationship:', err.message);
    }
  }

  /**
   * Update owner relationship based on interaction type.
   * @param {'message'|'praise'|'scold'|'sticker'|'reaction'|'emoji'} type
   */
  _updateRelationship(type) {
    if (!this.pes.store) return;
    try {
      // Delta values for trust and affection
      const deltas = {
        message:  { trust: 0.005, affection: 0.005 },
        praise:   { trust: 0.02,  affection: 0.03 },
        scold:    { trust: -0.01, affection: -0.005 },
        sticker:  { trust: 0.01,  affection: 0.015 },
        reaction: { trust: 0.01,  affection: 0.01 },
        emoji:    { trust: 0.005, affection: 0.008 },
      };

      const d = deltas[type] || deltas.message;

      // Update trust
      this.pes.store.updateTrust('owner', d.trust);

      // Update affection via addOrUpdateRelationship (it increments interactions_count too)
      const rel = this.pes.store.getRelationship('owner');
      if (rel) {
        const newAffection = Math.max(0, Math.min(1, rel.affection + d.affection));
        this.pes.store.addOrUpdateRelationship('owner', { affection: newAffection });
      }

      // Auto-advance phase
      const updated = this.pes.store.updatePhase('owner');
      if (updated && rel && updated.relationship_phase !== rel.relationship_phase) {
        console.log(`💛 Relationship phase: ${rel.relationship_phase} → ${updated.relationship_phase}!`);
        // Notify in chat about phase change
        this._notifyPhaseChange(rel.relationship_phase, updated.relationship_phase);
      }
    } catch (err) {
      console.error('⚠️ Failed to update relationship:', err.message);
    }
  }

  /**
   * Send celebration message when relationship phase changes.
   */
  async _notifyPhaseChange(oldPhase, newPhase) {
    const phaseSounds = {
      acquaintance: 'рру? рруу~... гав! ♡',
      friend:       'ГАВВВ!! ррРРРууу!! ♡♡♡ тяф-тяф!! ыыыыы!!',
      favorite:     'УУУУААА!! ГАВГАВГАВ!! ♡♡♡♡♡ рррррууу!! ⭐⭐',
      bonded:       'ммммм... рру~ ♡♡♡♡♡♡ ууу~ ♡♡♡ ...ррруууу~ ⭐⭐⭐',
    };

    const phaseNames = {
      stranger: 'незнакомец',
      acquaintance: 'знакомый',
      friend: 'друг',
      favorite: 'любимый',
      bonded: 'неразлучный',
    };

    const sound = phaseSounds[newPhase] || 'гав! ♡';
    const name = phaseNames[newPhase] || newPhase;
    await this._sendText(this.chatId, `${sound}\n\n💛 Уровень привязанности: **${name}**`);
    await this._sendContextualSticker('excited');
  }

  /**
   * Get relationship info for LLM prompt injection.
   * @returns {string}
   */
  _getRelationshipForPrompt() {
    if (!this.pes.store) return '';
    try {
      const rel = this.pes.store.getRelationship('owner');
      if (!rel) return '';

      const trustPct = Math.round(rel.trust * 100);
      const affectionPct = Math.round(rel.affection * 100);

      return `\n\n## Привязанность к хозяину
- Доверие: ${trustPct}% (${trustPct > 70 ? 'полностью доверяет' : trustPct > 40 ? 'доверяет' : 'осторожничает'})
- Привязанность: ${affectionPct}% (${affectionPct > 70 ? 'обожает' : affectionPct > 40 ? 'привязан' : 'присматривается'})
- Фаза: ${rel.relationship_phase}
- Встреч: ${rel.interactions_count}
${trustPct > 80 ? '- Ты ОБОЖАЕШЬ хозяина. Радуешься каждому сообщению.' : ''}
${trustPct < 30 ? '- Ты ещё не очень доверяешь. Осторожен, сдержан.' : ''}`;
    } catch (_) {
      return '';
    }
  }

  /**
   * Get pinned notes for LLM prompt context.
   */
  _getPinnedNotesForPrompt() {
    if (!this.pes.store) return '';
    try {
      const pinned = this.pes.store.getPinnedNotes();
      if (!pinned || pinned.length === 0) return '';

      const items = pinned.slice(0, 5).map(n => `- ${n.text}`).join('\n');
      return `\n\n## Важные заметки хозяина (запомнены навсегда)
${items}
Если хозяин спрашивает об этих вещах — ты знаешь ответ.`;
    } catch (_) {
      return '';
    }
  }

  /**
   * Get files summary for LLM prompt — so PES knows what it stores.
   */
  _getFilesContextForPrompt() {
    if (!this.pes.store) return '';
    try {
      const total = this.pes.store.db.prepare('SELECT COUNT(*) as cnt FROM owner_files WHERE is_deleted = 0').get();
      if (!total || total.cnt === 0) return '';

      const recent = this.pes.store.getRecentFiles({ limit: 5 });
      const items = recent.map(f => `- ${f.file_type}: ${f.file_name}${f.description ? ' — ' + f.description : ''}`).join('\n');

      return `\n\n## Файлы хозяина (ты хранишь ${total.cnt} файлов)
Последние:
${items}
Если хозяин просит найти файл — ты можешь! Ответь звуками и принеси.`;
    } catch (_) {
      return '';
    }
  }

  /**
   * Extract emojis from text and learn them.
   * Saves to SQLite, queues new ones for LLM description.
   */
  _extractAndLearnEmojis(text, ownerSent = true) {
    const emojiRegex = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;
    const found = text.match(emojiRegex);
    if (!found || !this.pes.store) return;

    const unique = [...new Set(found)];
    for (const emoji of unique) {
      // Skip simple digits/symbols that match emoji regex
      if (/^[0-9#*]$/.test(emoji)) continue;

      const existing = this.pes.store.getEmoji(emoji);
      if (existing) {
        // Reinforce — seen again
        this.pes.store.learnEmoji(emoji, { owner_sent: ownerSent });
      } else {
        // New emoji — save and queue for LLM analysis
        this.pes.store.learnEmoji(emoji, { owner_sent: ownerSent });
        this._emojiAnalysisQueue.push(emoji);
      }
    }

    // Trigger async analysis for new emojis
    if (this._emojiAnalysisQueue.length > 0 && !this._analyzingEmojis) {
      this._analyzeNewEmojis();
    }
  }

  /**
   * Extract and learn Telegram custom emoji from message entities.
   * Custom emoji are premium animated/static stickers used inline.
   * They have type: "custom_emoji" with custom_emoji_id in entities.
   */
  async _extractAndLearnCustomEmojis(entities) {
    if (!entities || !this.pes.store) return;
    const customEmojiIds = entities
      .filter(e => e.type === 'custom_emoji' && e.custom_emoji_id)
      .map(e => e.custom_emoji_id);
    if (customEmojiIds.length === 0) return;

    // Deduplicate
    const uniqueIds = [...new Set(customEmojiIds)];

    try {
      // Resolve custom emoji IDs to sticker objects via Telegram API
      const stickers = await this._call('getCustomEmojiStickers', { custom_emoji_ids: uniqueIds });
      if (!stickers || stickers.length === 0) return;

      for (const sticker of stickers) {
        const existing = this.pes.store.getSticker(sticker.file_unique_id);
        if (existing) {
          // Reinforce — seen again
          this.pes.store.learnSticker(sticker.file_id, sticker.file_unique_id, { owner_sent: 1 });
          // Update custom_emoji_id if we have it
          if (sticker.custom_emoji_id) {
            this.pes.store.updateStickerCustomEmojiId(sticker.file_unique_id, sticker.custom_emoji_id);
          }
        } else {
          // New custom emoji — save and queue for analysis
          this.pes.store.learnSticker(sticker.file_id, sticker.file_unique_id, {
            set_name: sticker.set_name || null,
            emoji: sticker.emoji || null,
            owner_sent: 1,
            custom_emoji_id: sticker.custom_emoji_id || null,
          });
          console.log(`🎭 Learned custom emoji: ${sticker.emoji || '?'} (id: ${sticker.custom_emoji_id || '?'}) from set "${sticker.set_name}" (message entity)`);
          // Auto-load the custom emoji set if new
          if (sticker.set_name) this._autoLoadStickerSet(sticker.set_name);
        }
      }
    } catch (err) {
      console.log(`⚠️ Could not resolve custom emojis: ${err.message}`);
    }
  }

  /**
   * Use LLM to describe what new emojis depict and map to emotions.
   * Runs async, non-blocking.
   */
  async _analyzeNewEmojis() {
    if (!this._llm || this._analyzingEmojis || this._emojiAnalysisQueue.length === 0) return;
    this._analyzingEmojis = true;

    try {
      // Process batch of up to 20 emojis at once
      const batch = this._emojiAnalysisQueue.splice(0, 20);
      const emojiList = batch.join(' ');

      const prompt = `Для каждого эмодзи напиши JSON-массив. Каждый элемент: {"emoji":"<эмодзи>","desc":"<что изображено, 3-5 слов>","emotion":"<happy|sad|excited|scared|angry|love|playful|confused|sleeping|food|celebration|alert|curious|relaxed|brave>","tags":["<когда использовать>"]}.

Эмодзи: ${emojiList}

ВАЖНО: Ответь ТОЛЬКО JSON-массивом, без маркдауна, без пояснений.`;

      const result = await this._llm.generate(prompt, [
        { role: 'user', content: 'Проанализируй эмодзи.' }
      ]);

      if (result) {
        try {
          // Try to parse JSON from response (strip markdown if present)
          const clean = result.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(clean);

          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item.emoji && this.pes.store) {
                this.pes.store.updateEmojiMeta(item.emoji, {
                  description: item.desc || null,
                  emotion_key: item.emotion || null,
                  context_tags: item.tags || null,
                });
              }
            }
            console.log(`🎨 Analyzed ${parsed.length} new emojis`);
          }
        } catch (parseErr) {
          console.error('⚠️ Emoji analysis parse error:', parseErr.message);
        }
      }
    } catch (err) {
      console.error('⚠️ Emoji analysis failed:', err.message);
    } finally {
      this._analyzingEmojis = false;
      // If more emojis queued during analysis, process them
      if (this._emojiAnalysisQueue.length > 0) {
        this._analyzeNewEmojis();
      }
    }
  }

  /**
   * Get learned emojis formatted for LLM prompt injection.
   * Returns string describing available emojis and when to use them.
   */
  /**
   * Strip human words from LLM output, keep only sounds + emoji.
   * If LLM ignored the "no words" rule, this filter catches it.
   */
  _stripHumanWords(text) {
    // Remove *action descriptions*
    let cleaned = text.replace(/\*[^*]+\*/g, '');

    // Allowed sound-words (case insensitive) — base set + babble engine atoms
    const ALLOWED_SOUNDS = new Set([
      'гав', 'тяф', 'ваф', 'мням', 'ррр', 'рррр', 'ууу', 'уууу', 'ыыы', 'ыыыы',
      'хрум', 'скууу', 'скуу', 'вуф', 'аууу', 'ауу', 'хнн', 'хн', 'мрр', 'мррр',
      'аф', 'хм', 'хмм', 'скс', 'руу', 'рру', 'яп', 'пфф', 'хааа', 'гяв',
      'рр', 'уу', 'ыы', 'мр', 'хх', 'фф', 'вв', 'гг', 'хмфф',
      'гавв', 'гаввв', 'тяфф', 'ваффф', 'ррруу', 'рруу', 'ууууу',
      'ыыыыы', 'скууу~', 'вввуууф', 'руу-руу',
      'гав-гав', 'тяф-тяф', 'ваф-ваф', 'мням-мням',
      // babble engine additional atoms
      'га', 'ру', 'ма', 'ха', 'фу', 'ва', 'та', 'ку', 'ну', 'бу',
      'гу', 'му', 'ху', 'ту', 'су', 'ду', 'лу', 'шу', 'жу',
      'мрр-гав', 'тяф-ваф', 'рру-тяф', 'ыыы-ваф', 'аф-хм',
    ]);

    // Split into tokens, keep only sounds, emoji, and punctuation
    const tokens = cleaned.split(/\s+/);
    const kept = [];
    for (const token of tokens) {
      // Pure emoji or symbols (no cyrillic/latin letters that form words)
      const stripped = token.replace(/[!.,~\-?…]+$/g, '').toLowerCase();

      // Check if it's an allowed sound
      if (ALLOWED_SOUNDS.has(stripped)) {
        kept.push(token);
        continue;
      }

      // Pure emoji (no letters)
      if (/^[\p{Emoji}\p{Emoji_Component}\s♡◈∿≋⟡⊹⟁∞◌⊕⑂]+$/u.test(token)) {
        kept.push(token);
        continue;
      }

      // Repeated consonants/vowels (raw babble): "ррр", "ууу", "хххх"
      if (/^[а-яё]{1,8}$/i.test(stripped) && /^(.)\1*$/.test(stripped)) {
        kept.push(token);
        continue;
      }

      // Sound-like: consonant+vowel combos up to 10 chars — babble engine produces these
      if (/^[а-яё~\-]{1,10}$/i.test(stripped)) {
        // Allow up to 4 unique chars (babble atoms use 2-3 letter combos)
        const unique = new Set(stripped.replace(/[-~]/g, '').split(''));
        if (unique.size <= 4) {
          kept.push(token);
          continue;
        }
      }

      // Compound sounds with dash: "рру-тяф", "гав-мням"
      if (/^[а-яё]+-[а-яё]+$/i.test(stripped) && stripped.length <= 12) {
        const parts = stripped.split('-');
        const allShort = parts.every(p => p.length <= 5 && new Set(p.split('')).size <= 3);
        if (allShort) {
          kept.push(token);
          continue;
        }
      }

      // CAPS version of allowed sounds
      if (ALLOWED_SOUNDS.has(stripped.toLowerCase())) {
        kept.push(token);
        continue;
      }

      // Everything else is a human word — DROP IT
    }

    return kept.join(' ').trim();
  }

  /**
   * Update babble engine with current PES traits and owner's top emoji.
   */
  _updateBabbleContext() {
    // Update traits
    if (this.pes?.emotions?.traits) {
      this._babble.traits = this.pes.emotions.traits;
    }
    // Update owner's top emoji from store
    if (this.pes.store) {
      try {
        const emojis = this.pes.store.getLearnedEmojis({ limit: 10, owner_only: true });
        this._babble.updateOwnerEmoji(emojis.map(e => e.emoji));
      } catch (_) {}
    }
  }

  /**
   * Persist babble engine state (affinity, combos, drift).
   */
  _saveBabbleState() {
    if (this.pes?.store?.saveBabbleState) {
      try {
        this.pes.store.saveBabbleState(this._babble.save());
      } catch (_) {}
    }
  }

  _getLearnedEmojisForPrompt() {
    if (!this.pes.store) return '';

    const emojis = this.pes.store.getLearnedEmojis({ limit: 30, owner_only: false });
    if (emojis.length === 0) return '';

    const lines = emojis
      .filter(e => e.description || e.emotion_key)
      .map(e => {
        const parts = [e.emoji];
        if (e.description) parts.push(`= ${e.description}`);
        if (e.emotion_key) parts.push(`(${e.emotion_key})`);
        if (e.context_tags) {
          try { parts.push(`→ ${JSON.parse(e.context_tags).join(', ')}`); } catch {}
        }
        if (e.owner_sent) parts.push('[хозяин отправлял]');
        return parts.join(' ');
      });

    if (lines.length === 0) return '';

    return `\n## Выученные эмодзи (используй их в ответах!)
${lines.join('\n')}
Предпочитай эмодзи которые хозяин отправлял и которые он одобрил. Новые эмодзи пробуй сразу — если хозяин одобрит, используй чаще.`;
  }

  /**
   * Get learned stickers formatted for LLM prompt injection.
   * Level affects how much sticker knowledge is shown.
   */
  _getLearnedStickersForPrompt() {
    if (!this.pes.store) return '';

    const stickers = this.pes.store.getLearnedStickers({ limit: 30, analyzed_only: true });
    if (stickers.length === 0) return '';

    // Level gate removed — show all stickers
    const level = this.pes.level || 0;
    const maxStickers = 20;
    const shown = stickers.slice(0, maxStickers);

    const lines = shown.map(s => {
      const parts = [];
      if (s.emoji) parts.push(s.emoji);
      if (s.description) parts.push(`— ${s.description}`);
      if (s.emotion_key) parts.push(`(${s.emotion_key})`);
      if (s.context_tags) {
        try { parts.push(`→ ${JSON.parse(s.context_tags).join(', ')}`); } catch {}
      }
      // Show freshness and preference
      const now = Date.now();
      const lastSeen = s.last_seen ? new Date(s.last_seen).getTime() : 0;
      const hoursSince = (now - lastSeen) / (3600 * 1000);
      if (hoursSince < 1) parts.push('[НОВЫЙ! только что получил]');
      else parts.push(`[видел ${s.times_seen}x]`);
      if (s.preference_score > 0.5) parts.push('[хозяин одобряет!]');
      if (s.preference_score < -0.5) parts.push('[хозяину не нравится]');
      return parts.join(' ');
    });

    // Level gate removed — full sticker knowledge
    const usage = 'Ты хорошо знаешь стикеры хозяина и активно реагируешь на них. Предпочитай стикеры которые хозяин одобрял.';

    return `\n## Выученные стикеры хозяина
${usage}
${lines.join('\n')}`;
  }

  /**
   * Get reaction preferences for LLM prompt context.
   * Shows what owner liked/disliked so PES can adapt.
   */
  _getReactionPreferencesForPrompt() {
    if (!this.pes.store) return '';

    try {
      // Get recent reactions from DB
      const reactions = this.pes.store.db.prepare(
        `SELECT pes_action, reaction_type, reaction_value, weight
         FROM reaction_memory
         ORDER BY timestamp DESC LIMIT 20`
      ).all();

      if (reactions.length === 0) return '';

      // Get learned preferences
      const preferences = this.pes.store.db.prepare(
        `SELECT pattern, behavior, confidence
         FROM learned_preferences
         WHERE confidence > 0.2
         ORDER BY confidence DESC LIMIT 5`
      ).all();

      let ctx = '\n\n## Обратная связь от хозяина';

      // Summarize recent reactions
      const positive = reactions.filter(r => r.weight > 0).length;
      const negative = reactions.filter(r => r.weight < 0).length;
      if (positive > 0 || negative > 0) {
        ctx += `\nПоследние реакции: ${positive} положительных, ${negative} отрицательных.`;
      }

      // Show preferences
      if (preferences.length > 0) {
        const prefLines = preferences.map(p => {
          const beh = {
            prefer: 'хозяину НРАВИТСЯ',
            increase: 'хозяину скорее нравится',
            neutral: 'нейтрально',
            decrease: 'хозяину скорее не нравится',
            avoid: 'хозяину НЕ нравится',
            never: 'НИКОГДА так не делай',
          }[p.behavior] || 'нейтрально';
          return `- ${p.pattern}: ${beh} (уверенность ${Math.round(p.confidence * 100)}%)`;
        });
        ctx += `\nЧто ты выучил:\n${prefLines.join('\n')}`;
      }

      // Show last few positive reactions for reinforcement
      const lastPositive = reactions.filter(r => r.weight > 0).slice(0, 3);
      if (lastPositive.length > 0) {
        ctx += '\nХозяин недавно одобрил: ' + lastPositive.map(r => r.reaction_value || r.reaction_type).join(', ');
      }

      return ctx;
    } catch (err) {
      return '';
    }
  }

  /**
   * Handle sticker from owner.
   * PES learns the sticker (what's depicted), auto-learns the pack,
   * and queues a "mirror" sticker to send back 1-2 messages later.
   */
  async _handleStickerMessage(msg) {
    // Track owner activity for idle behavior
    this._lastOwnerMessageTime = Date.now();

    // ── Imprint: стикер от хозяина = положительная реакция на предыдущий звук ──
    this._babble.imprint(this._lastPesReply, 0.3);
    this._saveBabbleState();

    const sticker = msg.sticker;
    const emoji = sticker.emoji || '😊';
    const setName = sticker.set_name;
    const fileId = sticker.file_id;
    const fileUniqueId = sticker.file_unique_id;

    // Learn the sticker's emoji
    this._extractAndLearnEmojis(emoji, true);

    // ── Save sticker to DB and queue for LLM analysis ──
    if (this.pes.store && fileUniqueId) {
      const existing = this.pes.store.getSticker(fileUniqueId);
      if (existing) {
        this.pes.store.learnSticker(fileId, fileUniqueId, { set_name: setName, emoji });
      } else {
        this.pes.store.learnSticker(fileId, fileUniqueId, { set_name: setName, emoji });
        // Queue for LLM analysis — figure out what's depicted
        this._stickerAnalysisQueue.push({ fileId, fileUniqueId, setName, emoji });
        if (!this._analyzingStickers) {
          this._analyzeNewStickers().catch(err =>
            console.error('⚠️ Auto sticker analysis failed:', err.message)
          );
        }
      }
    }

    // Auto-learn sticker pack from owner
    if (setName && !this._learnedPacks.has(setName)) {
      try {
        await this.loadStickerPack(setName, null, true); // additive
        this._learnedPacks.add(setName);
        this._saveStickerPackToDB(setName); // persist to DB
        this.emit('stickerPackLoaded', { pack: setName, count: '(auto-learned)' });
      } catch (_) {
        // Pack not accessible, ignore
      }
    }

    // ── Observe sticker interaction patterns ──
    this._observeStickerPattern(emoji, setName);

    // ── Queue "mirror" sticker — try it back after 1-2 messages (delayed, like thinking how to use it) ──
    this._pendingMirrorSticker = {
      fileId,
      fileUniqueId,
      emoji,
      receivedAt: Date.now(),
      messagesUntilMirror: 1 + Math.floor(Math.random() * 2), // 1-2 messages later
    };
    this._messagesSinceMirror = 0;

    // ── React to sticker with emoji ──
    this._reactToOwnerMessage(msg, 'play').catch(() => {});

    // ── Generate a sound reply (not just a sticker) ──
    await this._sendChatAction(this.chatId);
    await sleep(thinkingDelay(this.pes.level));

    const stickerDesc = this.pes.store?.getSticker(fileUniqueId)?.description || null;
    const contextHint = stickerDesc
      ? `Хозяин отправил стикер: ${stickerDesc} (эмодзи: ${emoji})`
      : `Хозяин отправил стикер с эмодзи: ${emoji}`;

    const reply = await this._generateReply(contextHint, null);
    await this._sendText(this.chatId, reply);
    this._addToMemory('owner', `[стикер: ${emoji}]`);
    this._addToMemory('pes', reply);

    // Show sticker origin if this sticker is in our collection
    if (this.pes.store && fileUniqueId) {
      const origin = this.pes.store.getStickerOrigin(fileUniqueId);
      if (origin && origin.original_set_title) {
        await this._sendText(this.chatId, `📋 из «${origin.original_set_title}» ${origin.original_emoji || ''}`);
      }
    }

    this.pes.event({
      type: 'message',
      from: 'owner',
      content: 'sticker',
      sticker_emoji: emoji,
      sentiment: this._classifyReaction(emoji).includes('positive') ? 'positive' : 'neutral',
    });

    // XP for sticker interaction + diversity tracking
    await this._grantXp('sticker', 2);
    if (this._trackDiversity('sticker')) {
      await this._grantXp('diversity', 5);
    }
    this._updateRelationship('sticker');

    // React with a contextual sticker from same emotion
    const emotionKey = this._emojiToEmotionKey(emoji);
    if (emotionKey) {
      await this._sendContextualSticker(emotionKey);
    }
  }

  /**
   * Check if there's a pending mirror sticker to send back.
   * Called from _handleTextMessage after each owner message.
   * The dog "thinks about" the sticker for 1-2 messages, then tries to use it.
   */
  async _tryMirrorSticker() {
    if (!this._pendingMirrorSticker) return;

    this._messagesSinceMirror++;
    if (this._messagesSinceMirror < this._pendingMirrorSticker.messagesUntilMirror) return;

    const mirror = this._pendingMirrorSticker;
    this._pendingMirrorSticker = null;

    // Only mirror if it's still fresh (< 10 min)
    if (Date.now() - mirror.receivedAt > 10 * 60 * 1000) return;

    // Send the same sticker back — puppy copying behavior
    try {
      await this._sendSticker(this.chatId, mirror.fileId);
      this._lastSentStickerUniqueId = mirror.fileUniqueId;
      if (this.pes.store) this.pes.store.markStickerUsed(mirror.fileUniqueId);
      console.log(`🐾 Mirror sticker sent: ${mirror.emoji} (delayed ${this._messagesSinceMirror} msgs)`);
    } catch (_) {
      // Sticker send failed — ignore
    }
  }

  /**
   * Handle translation request.
   * Level-based: puppy can't, young makes mistakes + corrections, adult is accurate.
   * Dog "brings" the translation like a scroll.
   * @param {string} text — text to translate
   * @param {string} targetLang — target language name (e.g. "английский")
   */
  async _handleTranslation(text, targetLang) {
    const level = this.pes.level || 0;
    const phase = level >= 60 ? 'experienced' : level >= 40 ? 'adult' : level >= 20 ? 'young' : 'puppy';

    // Level gate removed — testing all features

    // Language mapping
    const langMap = {
      'английский': 'English', 'english': 'English', 'англ': 'English',
      'испанский': 'Spanish', 'spanish': 'Spanish', 'исп': 'Spanish',
      'немецкий': 'German', 'german': 'German', 'нем': 'German',
      'французский': 'French', 'french': 'French', 'фр': 'French',
      'китайский': 'Chinese', 'chinese': 'Chinese', 'кит': 'Chinese',
      'японский': 'Japanese', 'japanese': 'Japanese', 'яп': 'Japanese',
      'корейский': 'Korean', 'korean': 'Korean', 'кор': 'Korean',
      'арабский': 'Arabic', 'arabic': 'Arabic', 'араб': 'Arabic',
      'итальянский': 'Italian', 'italian': 'Italian', 'итал': 'Italian',
      'португальский': 'Portuguese', 'portuguese': 'Portuguese', 'порт': 'Portuguese',
      'турецкий': 'Turkish', 'turkish': 'Turkish', 'тур': 'Turkish',
      'русский': 'Russian', 'russian': 'Russian', 'рус': 'Russian',
    };
    const lang = langMap[targetLang.toLowerCase()] || 'English';

    // Young level: only RU↔EN
    if (phase === 'young' && lang !== 'English' && lang !== 'Russian') {
      await this._sendText(this.chatId, pickRandom([
        `рру?.. хнн... 🐾 ...тяф... ❓`,
        `ууу... ваф?.. 🐾 ...скууу...`,
      ]));
      // Still try EN as fallback
    }

    if (!this._llm) {
      await this._sendText(this.chatId, `ууу... хнн... 🐾💧`);
      return;
    }

    // "Running to fetch the scroll"
    await this._sendChatAction(this.chatId);
    const traits = this.pes.store ? this.pes.store.getStats() : null;
    const drama = traits?.drama || 0.5;
    const stubbornness = traits?.stubbornness || 0.5;
    const curiosity = traits?.curiosity || 0.5;

    // Dramatic dogs take longer
    const runTime = 2000 + (drama > 0.7 ? 2000 : 1000) + Math.random() * 1000;
    await sleep(runTime);

    // Build translation prompt based on level
    let translationPrompt;
    // Level gate removed — all translations are accurate
    {
      translationPrompt = `Translate this text to ${lang}. You are an experienced translator dog.
RULES:
1. Provide accurate translation
2. Provide 1-2 alternative variants
3. Format:
MAIN: [main translation]
ALT1: [alternative 1]
${phase === 'experienced' ? 'ALT2: [alternative 2 — more colloquial/idiomatic]' : ''}

Text: "${text}"

ONLY output the lines above, nothing else.`;
    }

    try {
      const result = await this._llm.generate(translationPrompt, [
        { role: 'user', content: text }
      ]);

      if (!result) {
        await this._sendText(this.chatId, `ууу... хнн... 🐾💧`);
        return;
      }

      // Dog arrives with the scroll
      await this._sendContextualSticker('excited');

      // Arrival sounds — influenced by traits
      let arrivalSound;
      if (drama > 0.7) {
        arrivalSound = `РРРРРУУУУУ!! ВАФ ВАФ ВАФ!! 📜✨✨ тяф тяф!! ♡♡`;
      } else if (stubbornness > 0.7 && phase === 'young') {
        arrivalSound = `хмфф... рру... 📜 ...тяф.`;
      } else if (curiosity > 0.7) {
        arrivalSound = `ррРРуу!! тяф! 📜🐾 ваф!!`;
      } else {
        arrivalSound = pickRandom([
          `ррРРуу!! тяф! 📜🐾`,
          `ГАВВ!! рру!! 📜 ваф!!`,
          `тяф тяф!! 📜✨ рру!!`,
        ]);
      }
      await this._sendText(this.chatId, arrivalSound);
      await sleep(500);

      // Parse and format translation
      const lines = result.split('\n').filter(l => l.trim());
      let output = `═══════════════\n`;

      if (phase === 'young') {
        // Show mistake → correction → alternative (learning together)
        for (const line of lines) {
          if (line.startsWith('ATTEMPT:')) {
            output += `❌ ${line.replace('ATTEMPT:', '').trim()}\n`;
          } else if (line.startsWith('CORRECT:')) {
            output += `✅ ${line.replace('CORRECT:', '').trim()}\n`;
          } else if (line.startsWith('ALT:')) {
            output += `💡 ${line.replace('ALT:', '').trim()}\n`;
          } else {
            output += `📜 ${line.trim()}\n`;
          }
        }
      } else {
        // Clean translation
        for (const line of lines) {
          if (line.startsWith('MAIN:')) {
            output += `📜 ${line.replace('MAIN:', '').trim()}\n`;
          } else if (line.startsWith('ALT1:') || line.startsWith('ALT2:')) {
            output += `💡 ${line.replace(/ALT\d:/, '').trim()}\n`;
          } else {
            output += `📜 ${line.trim()}\n`;
          }
        }
      }

      output += `═══════════════`;
      await this._sendText(this.chatId, output);

      // Curiosity bonus: sometimes bring 2 languages
      if (curiosity > 0.7 && phase !== 'young' && Math.random() < 0.2) {
        const bonusLang = lang === 'English' ? 'Spanish' : 'English';
        try {
          const bonus = await this._llm.generate(
            `Translate to ${bonusLang}: "${text}"\nONLY the translation, nothing else.`,
            [{ role: 'user', content: text }]
          );
          if (bonus) {
            await sleep(1000);
            await this._sendText(this.chatId, `тяф! 🎁📜 ${bonus.trim()}`);
          }
        } catch (_) {}
      }

      // Track
      this._lastBotAction = { action: 'translate', text: `translate: ${text} → ${lang}`, category: 'translate', timestamp: Date.now() };
      this._addToMemory('owner', `[переведи на ${targetLang}: ${text}]`);
      this._addToMemory('pes', `[принёс перевод на ${lang}]`);
      await this._grantXp('command', 2);
    } catch (err) {
      console.error('⚠️ Translation failed:', err.message);
      await this._sendText(this.chatId, `ууу... хнн... рру?.. 📜💧`);
    }
  }

  /**
   * Handle fetch command ("принеси мячик", "fetch ball", etc.)
   * On puppy level: decorative (sticker + sound). Success rate grows with level.
   * @param {string} target — what to fetch
   */
  async _handleFetch(target) {
    // "Running to fetch" — typing with suspense pause
    await this._sendChatAction(this.chatId);
    await sleep(2000 + Math.random() * 2000); // 2-4 sec "running"

    // Level gate removed — testing all features
    const level = this.pes.level || 0;
    const successChance = 0.95;
    const success = Math.random() < successChance;

    if (success) {
      const sounds = [
        `ГАВВВ!! ваф-ваф!! 🎾 рррРРуу!! ♡`,
        `тяф тяф ТЯФФ!! ыыыЫЫЫ!! 🎾 ваф!!`,
        `УУУУУ!! гав гав!! рррр!! 🎾🎾 ♡♡`,
        `ЫЫЫЫ!! ваф ваф ВАФ!! 🎾 рруу!! ♡♡`,
      ];
      await this._sendText(this.chatId, pickRandom(sounds));
      await this._sendContextualSticker('praise');
    } else {
      const sounds = [
        `рру?... ...ууу... 🐾 ...тяф?`,
        `ыыы... гав?.. ...скууу... 💧`,
        `...ррр... ...ууу?.. тяф... 🐾`,
        `скууу... ...рру?... ... 💧`,
      ];
      await this._sendText(this.chatId, pickRandom(sounds));
      await this._sendContextualSticker('status');
    }

    // Log to DB
    if (this.pes.store) {
      this.pes.store.logFetch(
        'anything',
        JSON.stringify({ target, success, level }),
        success ? 2 : 0
      );
    }

    // Track last bot action
    this._lastBotAction = {
      action: 'fetch',
      text: `fetch: ${target} (${success ? 'success' : 'fail'})`,
      category: 'fetch',
      timestamp: Date.now(),
    };

    // XP
    await this._grantXp('command', 2);
    this._updateRelationship('message');

    // Memory
    this._addToMemory('owner', `[принеси: ${target}]`);
    this._addToMemory('pes', `[${success ? 'принёс' : 'не нашёл'}: ${target}]`);

    // PES event
    this.pes.command('fetch', { target });
  }


  // ═══════════════════════════════════════════════════════════
  // FILE HANDLING — download, store, analyze, search
  // ═══════════════════════════════════════════════════════════

  /**
   * Handle photo/document/video/voice/audio from owner.
   * Downloads to disk, saves metadata in DB, queues LLM analysis.
   */
  async _handleMediaMessage(msg) {
    this._lastOwnerMessageTime = Date.now();

    // ── Check for sticker creation intent in caption ──
    const mediaCaption = msg.caption || '';
    const isMediaWithCaption = msg.photo || msg.animation || msg.video ||
      (msg.document && (msg.document.mime_type?.startsWith('image/') || msg.document.mime_type?.startsWith('video/')));
    if (isMediaWithCaption && /стикер|sticker|пак|pack|сделай.*стикер|создай.*пак|гифк|gif|эмодзи|emoji/i.test(mediaCaption)) {
      const captionCreateType = /эмодзи|emoji/i.test(mediaCaption) ? 'custom_emoji' : 'regular';
      console.log(`🎨 Sticker creation intent detected in media caption (type=${captionCreateType})`);
      await this._handleStickerCreation(msg, captionCreateType);
      this._updateRelationship('message');
      return;
    }

    // Determine file type and extract file info
    let fileId, fileUniqueId, fileSize, fileName, mimeType, fileType;

    if (msg.photo) {
      // Photo — take largest version
      const photo = msg.photo[msg.photo.length - 1];
      fileId = photo.file_id;
      fileUniqueId = photo.file_unique_id;
      fileSize = photo.file_size || 0;
      fileName = `photo_${Date.now()}.jpg`;
      mimeType = 'image/jpeg';
      fileType = 'photo';
    } else if (msg.document) {
      fileId = msg.document.file_id;
      fileUniqueId = msg.document.file_unique_id;
      fileSize = msg.document.file_size || 0;
      fileName = msg.document.file_name || `doc_${Date.now()}`;
      mimeType = msg.document.mime_type || 'application/octet-stream';
      fileType = 'document';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      fileUniqueId = msg.video.file_unique_id;
      fileSize = msg.video.file_size || 0;
      fileName = msg.video.file_name || `video_${Date.now()}.mp4`;
      mimeType = msg.video.mime_type || 'video/mp4';
      fileType = 'video';
    } else if (msg.voice) {
      fileId = msg.voice.file_id;
      fileUniqueId = msg.voice.file_unique_id;
      fileSize = msg.voice.file_size || 0;
      fileName = `voice_${Date.now()}.ogg`;
      mimeType = msg.voice.mime_type || 'audio/ogg';
      fileType = 'voice';
    } else if (msg.audio) {
      fileId = msg.audio.file_id;
      fileUniqueId = msg.audio.file_unique_id;
      fileSize = msg.audio.file_size || 0;
      fileName = msg.audio.file_name || `audio_${Date.now()}.mp3`;
      mimeType = msg.audio.mime_type || 'audio/mpeg';
      fileType = 'audio';
    } else if (msg.video_note) {
      fileId = msg.video_note.file_id;
      fileUniqueId = msg.video_note.file_unique_id;
      fileSize = msg.video_note.file_size || 0;
      fileName = `videonote_${Date.now()}.mp4`;
      mimeType = 'video/mp4';
      fileType = 'video_note';
    } else {
      return; // Unknown media type
    }

    // Size check (Telegram Bot API limit: 20MB for downloads)
    const sizeMB = (fileSize || 0) / (1024 * 1024);
    if (sizeMB > this._maxFileSizeMB) {
      await this._sendText(this.chatId, pickRandom([
        `ууу... рру?.. 📦💧 ...слишком большой...`,
        `хнн... ваф?.. 📦 ...не могу поднять... 💧`,
      ]));
      return;
    }

    // Disk quota check
    const diskUsage = this._getDiskUsageMB();
    if (diskUsage > this._maxDiskQuotaMB) {
      await this._sendText(this.chatId, pickRandom([
        `ууу... рру?.. 📦💧 хнн...`,
        `хнн... скууу... 📦 ...ууу... 💧`,
      ]));
      return;
    }

    const ownerId = this.pes.store ? (this.pes.store.getConfig('owner_id') || String(msg.from.id)) : String(msg.from.id);
    const caption = msg.caption || '';

    // React to media with emoji
    this._reactToOwnerMessage(msg, null).catch(() => {});

    // Acknowledge receipt immediately
    await this._sendChatAction(this.chatId, 'upload_document');
    await this._sendText(this.chatId, pickRandom([
      `ррФФ!! 📂🐾 тяф!`,
      `ваф! 📂 рру~~ 🐾`,
      `гав! 📂✨ ррФ!`,
      `тяф тяф! 📂 рру~! ♡`,
    ]));

    // Download file from Telegram
    let localPath = null;
    let fileHash = null;
    try {
      const fileInfo = await this._getFilePath(fileId);
      const buffer = await this._downloadTelegramFile(fileInfo.file_path);

      // Compute SHA-256 hash
      fileHash = createHash('sha256').update(buffer).digest('hex');

      // Save to disk
      const typeDir = join(this._filesDir, fileType);
      if (!existsSync(typeDir)) mkdirSync(typeDir, { recursive: true });

      // Sanitize filename
      const safeName = fileName.replace(/[^a-zA-Z0-9._\-а-яА-ЯёЁ]/g, '_');
      const uniqueName = `${Date.now()}_${safeName}`;
      localPath = join(typeDir, uniqueName);
      writeFileSync(localPath, buffer);
    } catch (err) {
      this.emit('error', err);
      // Continue with metadata only — file_id still works for Telegram
    }

    // Save to DB
    if (this.pes.store) {
      // Extract tags from caption via simple parsing
      let tags = [];
      let description = caption || null;

      if (caption) {
        // Use caption as initial description + extract keywords as tags
        tags = caption
          .replace(/[^\wа-яА-ЯёЁ\s]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 2)
          .slice(0, 10);
      }

      const saved = this.pes.store.saveFile({
        owner_id: ownerId,
        telegram_file_id: fileId,
        telegram_file_unique_id: fileUniqueId,
        file_type: fileType,
        file_name: fileName,
        file_size: fileSize,
        mime_type: mimeType,
        local_path: localPath,
        file_hash: fileHash,
        description,
        tags,
        category: this._guessCategory(fileName, mimeType, caption),
      });

      // Queue for LLM analysis (background)
      if (saved && saved.id) {
        this._fileAnalysisQueue.push({
          id: saved.id,
          fileName,
          mimeType,
          fileType,
          caption,
          fileSize,
        });
        // Analyze in background (don't await)
        this._analyzeNewFiles().catch(err =>
          console.error('⚠️ Auto file analysis failed:', err.message)
        );
      }
    }

    // Learn emojis from caption
    if (caption) {
      this._extractAndLearnEmojis(caption, true);
    }
    // Learn custom emoji from caption entities
    if (msg.caption_entities) {
      this._extractAndLearnCustomEmojis(msg.caption_entities);
    }

    // Smart XP + relationship (files with description get bonus)
    await this._processSmartXP(msg, 'file');
    this._updateRelationship('message');

    // Memory
    this._addToMemory('owner', `[отправил ${fileType}: ${fileName}${caption ? ' — ' + caption : ''}]`);
    this._addToMemory('pes', `[сохранил файл: ${fileName}]`);

    // PES event
    this.pes.event({ type: 'message', from: 'owner', content: 'media', sentiment: 'positive' });
  }

  /**
   * Guess file category from filename, mime type, and caption.
   */
  _guessCategory(fileName, mimeType, caption) {
    const text = `${fileName} ${mimeType} ${caption}`.toLowerCase();

    if (/паспорт|passport|удостоверение|свидетельств|инн|снилс/.test(text)) return 'документы';
    if (/договор|контракт|contract|соглашение/.test(text)) return 'документы';
    if (/чек|receipt|квитанц|invoice|счёт|счет/.test(text)) return 'финансы';
    if (/рецепт|recipe|лекарств|медицин|health/.test(text)) return 'медицина';
    if (/image\/|photo|фото|jpg|jpeg|png/.test(text)) return 'фото';
    if (/video\/|видео|mp4/.test(text)) return 'видео';
    if (/audio\/|voice|голос|ogg|mp3/.test(text)) return 'аудио';
    if (/pdf|doc|docx|txt|xls|xlsx/.test(text)) return 'документы';

    return 'прочее';
  }

  /**
   * Guess note category from text.
   */
  _guessNoteCategory(text) {
    const t = text.toLowerCase();
    if (/встреча|созвон|митинг|собрание|дедлайн/.test(t)) return 'события';
    if (/купить|список|молоко|хлеб|магазин/.test(t)) return 'списки';
    if (/идея|придумал|концепт|проект/.test(t)) return 'идеи';
    if (/телефон|номер|контакт|почта|email/.test(t)) return 'контакты';
    if (/работа|задача|проект|клиент|заказ/.test(t)) return 'работа';
    if (/пароль|логин|ключ|код|пин/.test(t)) return 'важное';
    return 'прочее';
  }

  /**
   * Get disk usage of files directory in MB.
   */
  _getDiskUsageMB() {
    if (!existsSync(this._filesDir)) return 0;
    let total = 0;
    const walk = (dir) => {
      try {
        for (const entry of readdirSync(dir)) {
          const p = join(dir, entry);
          try {
            const s = statSync(p);
            if (s.isDirectory()) walk(p);
            else total += s.size;
          } catch (_) {}
        }
      } catch (_) {}
    };
    walk(this._filesDir);
    return total / (1024 * 1024);
  }

  /**
   * Analyze queued files via LLM — describe contents, assign tags/category.
   */
  async _analyzeNewFiles() {
    if (!this._llm || this._analyzingFiles || this._fileAnalysisQueue.length === 0) return;
    this._analyzingFiles = true;

    try {
      const batch = this._fileAnalysisQueue.splice(0, 5);
      const fileList = batch.map((f, i) =>
        `${i + 1}. file: "${f.fileName}", type: ${f.fileType}, mime: ${f.mimeType}, size: ${f.fileSize}B${f.caption ? `, caption: "${f.caption}"` : ''}`
      ).join('\n');

      const prompt = `Ты анализируешь файлы, отправленные хозяином собаке-боту для хранения. Для каждого файла определи:
1. Краткое описание на русском (10-20 слов) — что это может быть
2. Категория: документы, фото, видео, аудио, финансы, медицина, работа, учёба, личное, прочее
3. Теги (3-5 штук) для поиска

Файлы:
${fileList}

Верни JSON массив:
[{"idx":1, "desc":"фотография документа, возможно паспорт", "category":"документы", "tags":["паспорт","документ","удостоверение"]}]

ТОЛЬКО JSON, без markdown.`;

      const result = await this._llm.generate(prompt, [
        { role: 'user', content: 'Проанализируй файлы.' }
      ]);

      if (result && this.pes.store) {
        try {
          const cleaned = result.replace(/```json\s*/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          for (const item of parsed) {
            const idx = (item.idx || item.index || 1) - 1;
            if (idx >= 0 && idx < batch.length) {
              this.pes.store.updateFileMeta(batch[idx].id, {
                description: item.desc || item.description,
                tags: item.tags || [],
                category: item.category,
              });
            }
          }
        } catch (_) {
          // JSON parse error — skip
        }
      }
    } catch (err) {
      this.emit('error', err);
    } finally {
      this._analyzingFiles = false;
      // Process remaining queue
      if (this._fileAnalysisQueue.length > 0) {
        setTimeout(() => this._analyzeNewFiles().catch(err =>
          console.error('⚠️ Auto file analysis retry failed:', err.message)
        ), 2000);
      }
    }
  }

  /**
   * Search for files by owner's query and send back.
   */
  async _handleFileSearch(text) {
    if (!this.pes.store) return;

    // Extract search query from text
    const query = text
      .replace(/где мо[йяеи]\s*/i, '')
      .replace(/найди (файл|фото|документ)\s*/i, '')
      .replace(/принеси (файл|фото|документ)\s*/i, '')
      .replace(/покажи (файл|фото|документ)\s*/i, '')
      .replace(/где (файл|фото|документ)\s*/i, '')
      .replace(/где\s*/i, '')
      .trim();

    if (!query) {
      await this._sendText(this.chatId, pickRandom([
        `рру?.. ...тяф?.. 🐾`,
        `ваф?.. ...ууу?.. 🐾`,
      ]));
      return;
    }

    // "Running to search" animation
    await this._sendChatAction(this.chatId);
    await sleep(1500 + Math.random() * 1500);

    const results = this.pes.store.searchFiles(query, { limit: 5 });

    if (results.length === 0) {
      await this._sendText(this.chatId, pickRandom([
        `скууу... ыыы... рру?.. 🐾💧`,
        `рру?... ...ууу... хнн... 💧`,
        `хнн... ...тяф?.. ...ууу... 💧`,
      ]));
      this._addToMemory('owner', `[искал файл: ${query}]`);
      this._addToMemory('pes', `[не нашёл файл: ${query}]`);
      return;
    }

    // Send found files — dog sounds first, then delivers the file
    await this._sendText(this.chatId, pickRandom([
      `ГАВВ!! 📂✨ рру!! ррРР!! 🐾`,
      `ваф ваф!! 📂 рррРР!! тяф!! ♡`,
      `тяф тяф!! 📂✨ рру!! ♡♡`,
    ]));

    for (const file of results) {
      try {
        if (file.file_type === 'photo') {
          await this._sendPhoto(this.chatId, file.telegram_file_id, {
            caption: file.description || file.file_name,
          });
        } else {
          await this._sendDocument(this.chatId, file.telegram_file_id, {
            caption: file.description || file.file_name,
          });
        }
      } catch (err) {
        // file_id may have expired — try local path
        if (file.local_path && existsSync(file.local_path)) {
          await this._sendText(this.chatId, `📂 ${file.file_name}`);
        } else {
          await this._sendText(this.chatId, `📂 ${file.file_name} 💧`);
        }
      }
    }

    // Memory
    this._addToMemory('owner', `[искал файл: ${query}]`);
    this._addToMemory('pes', `[нашёл ${results.length} файл(ов): ${query}]`);
  }

  /**
   * /files command — list recent files, optionally filter by category.
   */
  async _cmdFiles(msg, args) {
    if (!this.pes.store) return;

    let files;
    if (args) {
      // Search by category or query
      files = this.pes.store.searchFiles(args, { limit: 10 });
    } else {
      files = this.pes.store.getRecentFiles({ limit: 10 });
    }

    if (files.length === 0) {
      await this._sendText(this.chatId,
        `📂 —${args ? ` "${args}"` : ''}\n\n` +
        `💡 📷/📄 → 📂🐾`
      );
      return;
    }

    const lines = [`📂 **Мои файлы** ${args ? `(поиск: "${args}")` : '(последние 10)'}`, ''];
    for (const f of files) {
      const typeIcon = { photo: '🖼️', document: '📄', video: '🎬', voice: '🎤', audio: '🎵', video_note: '📹' }[f.file_type] || '📎';
      const tags = f.tags ? JSON.parse(f.tags).slice(0, 3).join(', ') : '';
      lines.push(`${typeIcon} ${f.file_name || 'файл'}`);
      if (f.description) lines.push(`   ${f.description}`);
      if (tags) lines.push(`   🏷️ ${tags}`);
      lines.push('');
    }

    const totalFiles = this.pes.store.db.prepare('SELECT COUNT(*) as cnt FROM owner_files WHERE is_deleted = 0').get();
    const diskMB = this._getDiskUsageMB().toFixed(1);
    lines.push(`📊 Всего: ${totalFiles.cnt} файлов | ${diskMB} МБ на диске`);
    lines.push(`💡 "найди ..." → 📂🐾`);

    await this._sendText(this.chatId, lines.join('\n'), { parseMode: 'Markdown' });
  }

  /**
   * /notes command — list or add notes.
   */
  async _cmdNotes(msg, args) {
    if (!this.pes.store) return;

    const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);

    if (!args) {
      // Show recent notes
      const notes = this.pes.store.getRecentNotes({ owner_id: ownerId, limit: 10 });
      if (notes.length === 0) {
        await this._sendText(this.chatId,
          `📝 —\n\n` +
          `💡 "запомни: ..." → 📝🐾`
        );
        return;
      }

      const lines = [`📝 **Мои заметки** (последние 10)`, ''];
      for (const n of notes) {
        const pin = n.pinned ? '📌 ' : '';
        const tags = n.tags ? JSON.parse(n.tags).slice(0, 3).join(', ') : '';
        lines.push(`${pin}• ${n.text.slice(0, 100)}`);
        if (tags) lines.push(`  🏷️ ${tags}`);
      }

      const totalNotes = this.pes.store.db.prepare('SELECT COUNT(*) as cnt FROM owner_notes WHERE is_deleted = 0').get();
      lines.push('');
      lines.push(`📊 Всего: ${totalNotes.cnt} заметок`);
      lines.push(`💡 "запомни: ..." → 📝 | "что помнишь про ...?" → 🔍`);

      await this._sendText(this.chatId, lines.join('\n'), { parseMode: 'Markdown' });
      return;
    }

    // Search notes
    const notes = this.pes.store.searchNotes(args, { owner_id: ownerId, limit: 10 });
    if (notes.length === 0) {
      await this._sendText(this.chatId, `📝 — "${args}" 💧`);
      return;
    }

    const lines = [`📝 **Заметки** (поиск: "${args}")`, ''];
    for (const n of notes) {
      const pin = n.pinned ? '📌 ' : '';
      lines.push(`${pin}• ${n.text.slice(0, 150)}`);
    }
    await this._sendText(this.chatId, lines.join('\n'), { parseMode: 'Markdown' });
  }

  // ═══════════════════════════════════════════════════════════
  // SHARING ARTIFACTS
  // ═══════════════════════════════════════════════════════════

  /**
   * /share command — share notes, status card, or pet card to other chats.
   * Usage:
   *   /share           — show share menu with inline buttons
   *   /share status    — generate shareable status card
   *   /share note текст — share specific note by search
   *   /share card      — generate pet card for forwarding
   */
  // ═══════════════════════════════════════════════════════════
  // AGENTIC WORKFLOWS
  // ═══════════════════════════════════════════════════════════

  async _cmdWorkflow(msg, args) {
    const stats = this.pes?.store?.getStats?.();
    const currentLevel = stats?.level || 0;

    if (!args) {
      // List available workflows
      const available = this._workflows.list(currentLevel);
      if (available.length === 0) {
        await this._sendText(this.chatId, '🔒 Workflows разблокируются на Level 8');
        return;
      }

      const lines = available.map(w => {
        const lastRun = w.lastRun ? `(${Math.round((Date.now() - w.lastRun) / 60000)}м назад)` : '';
        const schedIcon = w.schedule !== 'manual' ? '⏰' : '🖐';
        return `${schedIcon} /${w.id} — ${w.description} ${lastRun}`;
      });

      const keyboard = {
        inline_keyboard: available.map(w => ([
          { text: `▶️ ${w.name}`, callback_data: `wf_run_${w.id}` },
        ])),
      };

      // Add history button
      keyboard.inline_keyboard.push([
        { text: '📜 История', callback_data: 'wf_history' },
      ]);

      await this._sendText(this.chatId,
        `🤖 **Agentic Workflows** (L${Math.floor(currentLevel)})\n\n${lines.join('\n')}`,
        { parseMode: 'Markdown', reply_markup: JSON.stringify(keyboard) }
      );
      return;
    }

    // Run specific workflow
    const workflowId = args.trim().toLowerCase().replace(/^\//, '');

    // Check for history subcommand
    if (workflowId === 'history' || workflowId === 'log') {
      const history = this._workflows.getHistory(10);
      if (!history.length) {
        await this._sendText(this.chatId, '📜 Нет запусков');
        return;
      }
      const lines = history.map(h => {
        const icon = h.success ? '✅' : '❌';
        const time = new Date(h.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        return `${icon} ${h.workflow_id} — ${h.duration_ms}ms — ${time}`;
      });
      await this._sendText(this.chatId, `📜 **Последние запуски:**\n\n${lines.join('\n')}`, { parseMode: 'Markdown' });
      return;
    }

    // Show typing
    try { await this._sendChatAction(this.chatId, 'typing'); } catch (_) {}

    const result = await this._workflows.run(workflowId, currentLevel);

    // Add PES babble reaction
    const babbleReaction = result.ok
      ? this._babble?.generateBlended?.('happy', 0.7, { energy: stats?.energy || 0.5 }) || 'ВАФ!'
      : this._babble?.generateBlended?.('alert', 0.5, { energy: stats?.energy || 0.5 }) || 'рру?..';

    await this._sendText(this.chatId, `${result.text}\n\n${babbleReaction}`);
  }

  async _cmdShare(msg, args) {
    if (!args) {
      // Show share menu with buttons
      const petName = this.pes?.identity?.name || 'ПЕС';
      const keyboard = {
        inline_keyboard: [
          [
            { text: '📊 Статус', callback_data: 'share_status' },
            { text: '🐾 Карточка', callback_data: 'share_card' },
          ],
          [
            { text: '📝 Последняя заметка', callback_data: 'share_last_note' },
            { text: '📋 Итоги дня', callback_data: 'share_summary' },
          ],
          [
            { text: '📤 В другой чат (inline)', switch_inline_query: '' },
          ],
        ],
      };

      await this._sendText(this.chatId,
        `📤 **Поделиться** — выбери что отправить\n\n` +
        `Или перешли любое сообщение от ${petName} в другой чат!`,
        { parseMode: 'Markdown', reply_markup: JSON.stringify(keyboard) }
      );
      return;
    }

    const subCmd = args.split(/\s+/)[0].toLowerCase();
    const subArgs = args.slice(subCmd.length).trim();

    switch (subCmd) {
      case 'status': return this._shareStatus();
      case 'card':   return this._sharePetCard();
      case 'note':   return this._shareNote(subArgs);
      case 'summary': return this._shareSummary();
      default:
        // Try search note by text
        return this._shareNote(args);
    }
  }

  /** Generate a shareable status card. */
  async _shareStatus() {
    const s = this.pes;
    const name = s.identity?.name || 'ПЕС';
    const species = s.identity?.species || '???';
    const level = s.level?.current || 0;
    const xp = s.level?.xp || 0;
    const mood = Math.round((s.state?.mood || 0) * 100);
    const energy = Math.round((s.state?.energy || 0) * 100);
    const emotion = s.state?.emotion || 'idle';

    const emotionMap = {
      happy: '😊', playful: '🎾', excited: '🎉', content: '😌',
      curious: '🔍', alert: '⚡', hungry: '🍖', sad: '😢',
      lonely: '💧', scared: '😰', angry: '😤', nap: '💤',
      zoomies: '🏃', idle: '🐾',
    };
    const emojiEmotion = emotionMap[emotion] || '🐾';

    const moodBar = this._buildBar(mood);
    const energyBar = this._buildBar(energy);

    const card = [
      `┌─────────────────────┐`,
      `│ 🐾 ${name}`,
      `│ ${species} · Level ${level} · ${xp} XP`,
      `│`,
      `│ ${emojiEmotion} ${emotion}`,
      `│ 💚 ${moodBar} ${mood}%`,
      `│ ⚡ ${energyBar} ${energy}%`,
      `└─────────────────────┘`,
      ``,
      `🏠 t.me/${this.config.botUsername || 'HoleThor_Bot'}`,
    ].join('\n');

    const keyboard = {
      inline_keyboard: [[
        { text: '📤 Отправить в чат', switch_inline_query: `status` },
      ]],
    };

    await this._sendText(this.chatId, card, {
      reply_markup: JSON.stringify(keyboard),
    });
  }

  /** Build a simple text progress bar. */
  _buildBar(percent) {
    const filled = Math.round(percent / 10);
    return '▓'.repeat(filled) + '░'.repeat(10 - filled);
  }

  /** Generate a shareable pet card (identity + traits). */
  async _sharePetCard() {
    const s = this.pes;
    const name = s.identity?.name || 'ПЕС';
    const species = s.identity?.species || '???';
    const level = s.level?.current || 0;
    const age = s.level?.ageDays || 0;

    // Top traits
    const traits = s.traits || {};
    const traitList = Object.entries(traits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `  ${k}: ${'█'.repeat(Math.round(v * 10))} ${Math.round(v * 100)}%`)
      .join('\n');

    // Abilities count
    const unlocks = s.unlocks || {};
    const unlockedCount = Object.values(unlocks).filter(u => u.unlocked).length;

    const card = [
      `╔═══════════════════════╗`,
      `║  🐾 ${name}`,
      `║  ${species} · ${age} дней · Level ${level}`,
      `╠═══════════════════════╣`,
      `║  Характер:`,
      traitList.split('\n').map(l => `║ ${l}`).join('\n'),
      `║`,
      `║  🔓 ${unlockedCount} способностей`,
      `╚═══════════════════════╝`,
      ``,
      `🏠 t.me/${this.config.botUsername || 'HoleThor_Bot'}`,
    ].join('\n');

    const keyboard = {
      inline_keyboard: [[
        { text: '📤 Отправить в чат', switch_inline_query: `card` },
      ]],
    };

    await this._sendText(this.chatId, card, {
      reply_markup: JSON.stringify(keyboard),
    });
  }

  /** Share a specific note (by search text). */
  async _shareNote(searchText) {
    if (!this.pes.store) return;

    const ownerId = this.pes.store.getConfig('owner_id') || '';
    let note;

    if (!searchText) {
      // Share last note
      const notes = this.pes.store.getRecentNotes({ owner_id: ownerId, limit: 1 });
      note = notes[0];
    } else {
      const notes = this.pes.store.searchNotes(searchText, { owner_id: ownerId, limit: 1 });
      note = notes[0];
    }

    if (!note) {
      await this._sendText(this.chatId, '📝 Заметка не найдена 💧');
      return;
    }

    const petName = this.pes?.identity?.name || 'ПЕС';
    const tags = note.tags ? JSON.parse(note.tags).join(', ') : '';
    const date = new Date(note.created_at).toLocaleDateString('ru-RU');
    const pin = note.pinned ? '📌 ' : '';

    const card = [
      `${pin}📝 Заметка от ${petName}`,
      `━━━━━━━━━━━━━━━━━`,
      note.text,
      `━━━━━━━━━━━━━━━━━`,
      tags ? `🏷️ ${tags}` : '',
      `📅 ${date}`,
    ].filter(Boolean).join('\n');

    const keyboard = {
      inline_keyboard: [[
        { text: '📤 Переслать', switch_inline_query: `note:${note.text.slice(0, 50)}` },
      ]],
    };

    await this._sendText(this.chatId, card, {
      reply_markup: JSON.stringify(keyboard),
    });
  }

  /** Generate daily summary for sharing. */
  async _shareSummary() {
    if (!this.pes.store) return;

    const petName = this.pes?.identity?.name || 'ПЕС';
    const today = new Date().toISOString().slice(0, 10);

    // Count today's interactions
    let interactionCount = 0;
    let notesCount = 0;
    let remindersCount = 0;
    try {
      interactionCount = this.pes.store.db.prepare(
        `SELECT COUNT(*) as cnt FROM interactions WHERE date(timestamp) = ?`
      ).get(today)?.cnt || 0;

      notesCount = this.pes.store.db.prepare(
        `SELECT COUNT(*) as cnt FROM owner_notes WHERE date(created_at) = ? AND is_deleted = 0`
      ).get(today)?.cnt || 0;

      remindersCount = this.pes.store.db.prepare(
        `SELECT COUNT(*) as cnt FROM reminders WHERE date(created_at) = ?`
      ).get(today)?.cnt || 0;
    } catch (_) {}

    const mood = Math.round((this.pes.state?.mood || 0) * 100);
    const level = this.pes.level?.current || 0;
    const xp = this.pes.level?.xp || 0;
    const emotion = this.pes.state?.emotion || 'idle';

    const summary = [
      `📋 **Итоги дня** — ${petName}`,
      `📅 ${new Date().toLocaleDateString('ru-RU')}`,
      ``,
      `💬 Взаимодействий: ${interactionCount}`,
      `📝 Заметок создано: ${notesCount}`,
      `⏰ Напоминаний: ${remindersCount}`,
      ``,
      `💚 Настроение: ${mood}%`,
      `🎭 Эмоция: ${emotion}`,
      `📊 Level ${level} · ${xp} XP`,
    ].join('\n');

    const keyboard = {
      inline_keyboard: [[
        { text: '📤 Отправить в чат', switch_inline_query: `summary` },
      ]],
    };

    await this._sendText(this.chatId, summary, {
      parseMode: 'Markdown',
      reply_markup: JSON.stringify(keyboard),
    });
  }

  /**
   * Build inline query results for sharing artifacts in other chats.
   * Called from _handleInlineQuery when query matches share patterns.
   */
  _buildShareInlineResults(queryText) {
    const results = [];
    const name = this.pes?.identity?.name || 'ПЕС';
    const species = this.pes?.identity?.species || '???';
    const level = this.pes?.level?.current || 0;
    const xp = this.pes?.level?.xp || 0;
    const mood = Math.round((this.pes?.state?.mood || 0) * 100);
    const energy = Math.round((this.pes?.state?.energy || 0) * 100);
    const emotion = this.pes?.state?.emotion || 'idle';
    const botUser = this.config.botUsername || 'HoleThor_Bot';

    if (queryText === 'status') {
      const moodBar = this._buildBar(mood);
      const energyBar = this._buildBar(energy);
      results.push({
        type: 'article',
        id: 'share_status',
        title: `📊 Статус ${name}`,
        description: `Level ${level} · ${emotion} · ${mood}% mood`,
        input_message_content: {
          message_text: [
            `🐾 **${name}** — ${species}`,
            `Level ${level} · ${xp} XP`,
            ``,
            `🎭 ${emotion}`,
            `💚 ${moodBar} ${mood}%`,
            `⚡ ${energyBar} ${energy}%`,
            ``,
            `🏠 t.me/${botUser}`,
          ].join('\n'),
          parse_mode: 'Markdown',
        },
      });
    }

    if (queryText === 'card') {
      const traits = this.pes?.traits || {};
      const topTraits = Object.entries(traits)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
        .join(' · ');

      results.push({
        type: 'article',
        id: 'share_card',
        title: `🐾 Карточка ${name}`,
        description: `${species} · Level ${level} · ${topTraits}`,
        input_message_content: {
          message_text: [
            `╔═══════════════════════╗`,
            `║ 🐾 **${name}**`,
            `║ ${species} · Level ${level}`,
            `║ ${topTraits}`,
            `╚═══════════════════════╝`,
            `🏠 t.me/${botUser}`,
          ].join('\n'),
          parse_mode: 'Markdown',
        },
      });
    }

    if (queryText === 'summary') {
      const today = new Date().toLocaleDateString('ru-RU');
      let interactionCount = 0;
      try {
        const todayISO = new Date().toISOString().slice(0, 10);
        interactionCount = this.pes.store?.db?.prepare(
          `SELECT COUNT(*) as cnt FROM interactions WHERE date(timestamp) = ?`
        ).get(todayISO)?.cnt || 0;
      } catch (_) {}

      results.push({
        type: 'article',
        id: 'share_summary',
        title: `📋 Итоги дня — ${name}`,
        description: `${today} · ${interactionCount} взаимодействий · ${mood}% mood`,
        input_message_content: {
          message_text: [
            `📋 **Итоги дня** — ${name}`,
            `📅 ${today}`,
            ``,
            `💬 Взаимодействий: ${interactionCount}`,
            `💚 Настроение: ${mood}%`,
            `🎭 Эмоция: ${emotion}`,
            `📊 Level ${level} · ${xp} XP`,
          ].join('\n'),
          parse_mode: 'Markdown',
        },
      });
    }

    if (queryText.startsWith('note:')) {
      const search = queryText.slice(5).trim();
      if (this.pes.store && search) {
        const ownerId = this.pes.store.getConfig('owner_id') || '';
        const notes = this.pes.store.searchNotes(search, { owner_id: ownerId, limit: 5 });
        for (let i = 0; i < notes.length; i++) {
          const n = notes[i];
          const date = new Date(n.created_at).toLocaleDateString('ru-RU');
          const tags = n.tags ? JSON.parse(n.tags).join(', ') : '';
          results.push({
            type: 'article',
            id: `share_note_${n.id || i}`,
            title: `📝 ${n.text.slice(0, 60)}`,
            description: `${date}${tags ? ' · ' + tags : ''}`,
            input_message_content: {
              message_text: [
                `📝 **Заметка от ${name}**`,
                `━━━━━━━━━━━━━━━━━`,
                n.text,
                `━━━━━━━━━━━━━━━━━`,
                tags ? `🏷️ ${tags}` : '',
                `📅 ${date}`,
              ].filter(Boolean).join('\n'),
              parse_mode: 'Markdown',
            },
          });
        }
      }
    }

    // Always add status and card as fallback options
    if (results.length === 0) {
      results.push({
        type: 'article',
        id: 'share_hint',
        title: `🐾 ${name} — Level ${level}`,
        description: 'Нажми чтобы поделиться статусом',
        input_message_content: {
          message_text: `🐾 **${name}** — ${species} · Level ${level}\n💚 ${mood}% · 🎭 ${emotion}\n🏠 t.me/${botUser}`,
          parse_mode: 'Markdown',
        },
      });
    }

    return results;
  }


  /**
   * Analyze new stickers via LLM — figure out what's depicted.
   * Batches stickers and asks LLM to describe each one.
   */
  async _analyzeNewStickers() {
    if (!this._llm || this._analyzingStickers || this._stickerAnalysisQueue.length === 0) return;
    this._analyzingStickers = true;

    try {
      const batch = this._stickerAnalysisQueue.splice(0, 10);
      const stickerList = batch.map((s, i) =>
        `${i + 1}. emoji: ${s.emoji}, pack: ${s.setName || 'unknown'}`
      ).join('\n');

      const prompt = `Ты анализируешь стикеры из Telegram. Для каждого стикера по его эмодзи и названию пака определи:
1. Что скорее всего изображено на стикере (описание на русском, 5-10 слов)
2. Какая эмоция (emotion_key): happy, sad, excited, playful, scared, angry, love, curious, sleeping, confused, hungry, greeting, farewell
3. Когда уместно использовать (context_tags): ["приветствие", "еда", "игра", "грусть", "радость", "прощание", "удивление"]

Стикеры:
${stickerList}

Верни JSON массив:
[{"idx":1, "desc":"корги виляет попой", "emotion":"happy", "tags":["радость","приветствие"]}]

ТОЛЬКО JSON, без markdown.`;

      const result = await this._llm.generate(prompt, [
        { role: 'user', content: 'Проанализируй стикеры.' }
      ]);

      if (result && this.pes.store) {
        try {
          const cleaned = result.replace(/```json\s*/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          for (const item of parsed) {
            const idx = (item.idx || item.index || 1) - 1;
            if (idx >= 0 && idx < batch.length) {
              this.pes.store.updateStickerMeta(batch[idx].fileUniqueId, {
                description: item.desc || item.description,
                emotion_key: item.emotion || item.emotion_key,
                context_tags: item.tags || item.context_tags,
              });
              console.log(`🎨 Sticker analyzed: ${batch[idx].emoji} → ${item.desc}`);
            }
          }
        } catch (parseErr) {
          console.error('⚠️ Sticker analysis parse error:', parseErr.message);
        }
      }
    } catch (err) {
      console.error('⚠️ Sticker analysis failed:', err.message);
    } finally {
      this._analyzingStickers = false;
      // Process remaining queue
      if (this._stickerAnalysisQueue.length > 0) {
        setTimeout(() => this._analyzeNewStickers().catch(err =>
          console.error('⚠️ Auto sticker analysis retry failed:', err.message)
        ), 1000);
      }
    }
  }

  /**
   * Handle reaction on PES's message (feedback loop).
   */
  async _handleReaction(reactionUpdate) {
    if (!reactionUpdate) return;

    const chatId = String(reactionUpdate.chat?.id);
    if (chatId !== this.chatId) return;

    const msgId = String(reactionUpdate.message_id);
    const newReaction = reactionUpdate.new_reaction;
    if (!newReaction || newReaction.length === 0) return;

    const reactionObj = newReaction[0];
    // Handle both regular emoji and custom emoji reactions
    let emoji = null;
    let customEmojiId = null;
    if (reactionObj?.type === 'custom_emoji') {
      customEmojiId = reactionObj.custom_emoji_id;
      // Resolve custom emoji to learn it
      try {
        const customStickers = await this._call('getCustomEmojiStickers', { custom_emoji_ids: [customEmojiId] });
        if (customStickers && customStickers.length > 0) {
          const cs = customStickers[0];
          emoji = cs.emoji || '✨'; // fallback emoji associated with custom emoji
          // Learn this custom emoji sticker
          if (this.pes.store) {
            const existing = this.pes.store.getSticker(cs.file_unique_id);
            if (!existing) {
              this.pes.store.learnSticker(cs.file_id, cs.file_unique_id, {
                set_name: cs.set_name || null,
                emoji: cs.emoji || null,
                owner_sent: 1,
                custom_emoji_id: customEmojiId || cs.custom_emoji_id || null,
              });
              console.log(`🎭 Learned custom emoji: ${cs.emoji} (id: ${customEmojiId}) from set "${cs.set_name}" (reaction)`);
              // If new set — auto-load it
              if (cs.set_name) this._autoLoadStickerSet(cs.set_name);
            } else {
              this.pes.store.learnSticker(cs.file_id, cs.file_unique_id, { owner_sent: 1 });
              // Update custom_emoji_id if we have it
              if (customEmojiId) this.pes.store.updateStickerCustomEmojiId(cs.file_unique_id, customEmojiId);
            }
          }
        }
      } catch (err) {
        console.log(`⚠️ Could not resolve custom emoji ${customEmojiId}: ${err.message}`);
        emoji = '✨'; // fallback
      }
    } else {
      emoji = reactionObj?.emoji || null;
    }

    if (!emoji) return;

    const userId = String(reactionUpdate.user?.id || '');

    console.log(`🔔 Reaction received: ${emoji} (type: ${reactionObj?.type}, customId: ${customEmojiId || 'none'}) on msg ${msgId}`);

    // Feed back through base class
    this.onUserReaction(msgId, emoji, userId, {
      isOwner: chatId === this.chatId,
      speed_ms: null,
    });

    // ── Log to reaction_memory in store ──
    const POSITIVE_REACTIONS = ['👍', '❤️', '🔥', '😍', '🎉', '💯', '⚡', '🏆', '🥰', '😂', '🤣', '♥️', '💕', '👏', '🤩', '😘', '💋', '🙏', '✨', '💪', '🫶'];
    const NEGATIVE_REACTIONS = ['👎', '😡', '🤮', '💩', '😤', '🙄', '😒', '🤢', '💔'];

    let weight = 0;
    let reactionType = 'neutral';
    // Custom emoji reactions are generally positive (user engaged enough to use premium emoji)
    if (customEmojiId) {
      weight = 1.0;
      reactionType = 'positive';
    } else if (POSITIVE_REACTIONS.includes(emoji)) {
      weight = 1.0;
      reactionType = 'positive';
    } else if (NEGATIVE_REACTIONS.includes(emoji)) {
      weight = -1.0;
      reactionType = 'negative';
    } else {
      weight = 0.3; // unknown emoji = slightly positive (they interacted)
      reactionType = 'emoji';
    }

    // Log reaction to whatever PES last did
    const pesAction = this._lastBotAction?.action || 'unknown';
    const pesExpression = this._lastBotAction?.text || null;
    const speedMs = this._lastBotAction ? Date.now() - this._lastBotAction.timestamp : null;

    try {
      if (this.pes.store) {
        this.pes.store.logReaction({
          pes_action: pesAction,
          pes_expression: pesExpression,
          reactor: userId || 'owner',
          reactor_role: 'owner',
          reaction_type: reactionType,
          reaction_value: emoji,
          reaction_speed: speedMs,
          weight,
          platform: 'telegram',
        });

        // Recalculate preferences periodically
        this._reactionRecalcCounter++;
        if (this._reactionRecalcCounter >= 5) {
          this._reactionRecalcCounter = 0;
          this.pes.store.recalculatePreference(pesAction);
        }

        // Update preference_score on last sent sticker
        if (this._lastSentStickerUniqueId) {
          const stickerDelta = reactionType === 'positive' ? 1.0 : reactionType === 'negative' ? -0.5 : 0.1;
          this.pes.store.updateStickerPreference(this._lastSentStickerUniqueId, stickerDelta);
          console.log(`🎨 Sticker preference: ${this._lastSentStickerUniqueId} ${stickerDelta > 0 ? '+' : ''}${stickerDelta}`);
        }

        // Update discovery feedback if reaction was on a discovered sticker
        if (this._lastBotAction?.action === 'sticker_discovery' && this._lastBotAction?.discoveryPackName) {
          const liked = reactionType === 'positive';
          this.pes.store.updateDiscoveryFeedback(this._lastBotAction.discoveryPackName, liked);
          console.log(`🔍 Discovery feedback: ${this._lastBotAction.discoveryPackName} → ${liked ? '👍 liked' : '👎 disliked'}`);
        }

        console.log(`💭 Reaction logged: ${emoji} (${reactionType}, weight=${weight}) → action "${pesAction}"`);
      }

      // XP for reaction + diversity tracking + correction tracking
      await this._grantXp('reaction', reactionType === 'positive' ? 2 : 1);
      if (this._trackDiversity('reaction')) {
        await this._grantXp('diversity', 5);
      }
      // Track negative reactions for correction bonus
      if (reactionType === 'negative') {
        this._lastReactionWasNegative = true;
        this._lastReactionTime = Date.now();
      } else {
        this._lastReactionWasNegative = false;
      }
      this._updateRelationship('reaction');
    } catch (err) {
      console.error('⚠️ Failed to log reaction:', err.message);
    }
  }


  // ═══════════════════════════════════════════════════════════
  // BOT COMMANDS
  // ═══════════════════════════════════════════════════════════

  async _handleBotCommand(msg) {
    const text = msg.text.trim();
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/@.*$/, ''); // strip @botname
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/start':    return this._cmdStart(msg);
      case '/home':     return this._cmdHome(msg);
      case '/help':     return this._cmdHelp(msg);
      case '/status':   return this._sendStatus();
      case '/setname':  return this._cmdSetName(msg, args);
      case '/feed':     return this._cmdFeed(msg, args);
      case '/command':  return this._cmdCommand(msg, args);
      case '/silent':   return this._cmdSilent(msg);
      case '/stickers':  return this._cmdStickers(msg, args);
      case '/files':     return this._cmdFiles(msg, args);
      case '/notes':     return this._cmdNotes(msg, args);
      case '/translate':  return this._cmdTranslate(msg, args);
      case '/remind':    return this._cmdRemind(msg, args);
      case '/reminders': return this._cmdReminders(msg);
      case '/packs':     return this._cmdPacks(msg);
      case '/collection': return this._cmdCollection(msg);
      case '/artifacts':  return this._cmdArtifacts(msg);
      case '/insights':  return this._cmdInsights(msg);
      case '/contacts':  return this._cmdContacts(msg);
      case '/addcontact': return this._cmdAddContact(msg, args);
      case '/abilities': return this._cmdAbilities(msg);
      case '/origin':    return this._cmdOrigin(msg);
      case '/newpack':      return this._cmdNewPack(msg, args);
      case '/newemojipack': return this._cmdNewEmojiPack(msg, args);
      case '/mypack':       return this._cmdMyPack(msg);
      case '/myemoji':      return this._cmdMyEmojiPack(msg);
      case '/renamepack':   return this._cmdRenamePack(msg, args);
      case '/metronome':     return this._cmdMetronome(msg, args);
      case '/share':        return this._cmdShare(msg, args);
      case '/emoji':        return this._cmdEmoji(msg, args);
      case '/workflow':     return this._cmdWorkflow(msg, args);
      case '/wf':           return this._cmdWorkflow(msg, args);
      case '/triage':       return this._cmdWorkflow(msg, 'triage');
      case '/summary':      return this._cmdWorkflow(msg, 'daily_summary');
      case '/digest':       return this._cmdWorkflow(msg, 'crm_digest');
      case '/health':       return this._cmdWorkflow(msg, 'health_check');
      case '/cleanup':      return this._cmdWorkflow(msg, 'task_cleanup');
      case '/achievements': return this._cmdAchievements(msg);
      case '/streak':       return this._cmdStreak(msg);
      case '/friends':      return this._cmdFriends(msg);
      case '/addfriend':    return this._cmdAddFriend(msg, args);
      case '/gift':         return this._cmdGift(msg, args);
      case '/dev':          return this._cmdDev(msg, args);
      case '/orchestrator': return this._cmdAgent(msg, 'orchestrator', args);
      case '/geratron':     return this._cmdAgent(msg, 'geratron', args);
      case '/exit':         return this._cmdDevExit(msg);
      default:
        // In dev/agent mode, treat unknown commands as messages too
        if (this._devMode) {
          return this._logDevRequest('command', text, msg);
        }
        if (this._agentMode) {
          await this._logDevRequest(`@${this._agentMode}`, text, msg);
          if (this._agentMode === 'orchestrator' && this._orchestratorLLM) {
            await this._handleOrchestratorChat(text, msg);
            return;
          }
          const label = this._agentMode === 'orchestrator' ? '🎯' : '⚡';
          await this._sendText(this.chatId, `${label} @${this._agentMode} получил: «${text.slice(0, 200)}»\n\n_Записано в лог._`, { parse_mode: 'Markdown' });
          return;
        }
        // Unknown command → treat as command attempt
        this.pes.command(cmd.slice(1), { source: 'telegram' });
    }
  }

  async _cmdStart(msg) {
    if (!this.pes.isAlive) {
      this.pes.birth();
      // onBorn handler will send greeting

      // Check if name has been set; if not, prompt user
      const hasName = this.pes.store && this.pes.store.getConfig('pet_name');
      if (!hasName) {
        // Save default name
        if (this.pes.store) this.pes.store.setPetName(this.pes.name);
        await sleep(1500);
        await this._sendText(this.chatId, [
          `тяф... тяф?.. 🐾`,
          ``,
          `...ууууу... ♡`,
          ``,
          `я ${this.pes.name}! твой щенок!`,
          `я буду запоминать, приносить, создавать стикеры`,
          `и расти вместе с тобой 🐾`,
          ``,
          `✏️ /setname <имя> — дай мне имя!`,
          `📦 /newpack <имя> — создай свою коллекцию`,
          `🐾 /help — что я умею`,
        ].join('\n'));
      }
    } else if (!this.pes.isAwake) {
      this.pes.wake();
      // onWake handler will send greeting
    } else {
      // Already awake — check if missing pack setup
      const hasPack = this.pes.store && this.pes.store.getMainCollectionPack();
      if (!hasPack) {
        await this._sendText(this.chatId, pickRandom([
          `ГАВВВ!! 🐾💛 тяф тяф!\n\n📦 /newpack <имя> — создай коллекцию!`,
          `ууууУУУ!! гав гав!! 💛\n\n📦 у тебя ещё нет пака! /newpack <имя>`,
        ]));
      } else {
        await this._sendText(this.chatId, pickRandom([
          `ГАВВВ!! ыыыЫЫЫ!! ррууу!! 🐾💛💛💛`,
          `тяф! тяф! ТЯФ!! ваф-ваф!! 🐾`,
          `ууууУУУ!! гав гав ГАААВ!! 💛💛💛`,
          `ЫЫЫЫ!! ррр ваф ваф ВАФ!! 🐾✨`,
        ]));
      }
      this.pes.event({ type: 'owner_returned', from: 'owner' });
    }
  }

  async _cmdHome(msg) {
    const appUrl = this.config.miniAppUrl || 'https://crm.hltrn.cc/api/v3/pes/app';
    const name = this.pes.name || 'ПЕС';
    await this._sendText(this.chatId, `🏠 Дом ${name}`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🏠 Открыть дом', web_app: { url: appUrl } }
        ]]
      }
    });
  }

  async _cmdHelp(msg) {
    const name = this.pes.name || 'ПЕС';
    const level = Math.floor(this.pes.level || 0);

    // Build capabilities list based on current level
    const lines = [
      `🐾 ${name} — Level ${level}`,
      ``,
      `━━ Что я умею ━━`,
      ``,
      `📝 Заметки`,
      `  "запомни: встреча в пятницу"`,
      `  "что помнишь про встречу?"`,
      `  /notes — список заметок`,
      ``,
      `⏰ Напоминания`,
      `  "напомни через 30 мин позвонить"`,
      `  /remind 2ч проверить деплой`,
      `  /reminders — активные`,
      ``,
      `👤 Контакты`,
      `  "запомни контакт Олег +7999..."`,
      `  "кто такой Олег?"`,
      `  /contacts — все контакты`,
      ``,
      `🎒 Артефакты`,
      `  выпадают при общении`,
      `  /artifacts — мои находки`,
      ``,
      `🎨 Стикеры`,
      `  Отправь фото + "сделай стикер"`,
      `  "сделай эмодзи" — emoji пак`,
      `  "сделай гифку" — анимированный`,
      `  Reply стикер + "сохрани" — в коллекцию`,
      `  /packs — мои паки`,
      `  /collection — коллекция`,
      ``,
      `🌐 Перевод`,
      `  "переведи на английский привет"`,
      ``,
      `🎵 Метроном`,
      `  "метроном 120" или /metronome 90`,
      ``,
      `🎾 Игра`,
      `  "апорт!", "играть!", "мячик!"`,
      ``,
    ];

    // Level-gated features
    if (level >= 8) {
      lines.push(`📊 CRM (Level 8+)`);
      lines.push(`  "покажи таблицы" — список таблиц`);
      lines.push(`  "найди в crm Олег" — поиск`);
      lines.push(`  "что у меня на сегодня?" — задачи`);
      lines.push(``);
    }
    if (level >= 10) {
      lines.push(`✏️ CRM Запись (Level 10+)`);
      lines.push(`  "создай тикет: ..." — новая запись`);
      lines.push(``);
    }

    if (level >= 8) {
      lines.push(`🤖 Workflows (Level 8+)`);
      lines.push(`  /workflow — все workflows`);
      lines.push(`  /triage — что нового в CRM`);
      lines.push(`  /health — проверка здоровья`);
      lines.push(`  "итоги дня" — daily summary`);
      lines.push(`  "что нового?" — triage`);
      lines.push(``);
    }

    if (level >= 10) {
      lines.push(`🤝 Дружба (Level 10+)`);
      lines.push(`  /friends — список друзей`);
      lines.push(`  /addfriend <chat_id> — запрос дружбы`);
      lines.push(`  /gift <chat_id> — отправить подарок`);
      lines.push(``);
    }

    lines.push(`🎯 Orchestrator`);
    lines.push(`  N23 + вопрос — быстрый вызов AI`);
    lines.push(`  /orchestrator — режим диалога`);
    lines.push(`  /exit — вернуться к ПЕС`);
    lines.push(``);

    lines.push(`━━ Настройки ━━`);
    lines.push(`  /setname <имя> — переименовать`);
    lines.push(`  /status — полная статистика`);
    lines.push(`  /abilities — способности по уровням`);
    lines.push(`  /silent — тихий режим`);
    lines.push(``);
    lines.push(`🐾♡`);

    await this._sendText(this.chatId, lines.join('\n'));
  }

  async _cmdAbilities(msg) {
    const level = Math.floor(this.pes.level || 0);
    const name = this.pes.name || 'ПЕС';

    // All abilities with their unlock levels
    const abilities = [
      { lvl: 0,  icon: '🐾', name: 'Базовые эмоции', desc: '9 состояний' },
      { lvl: 0,  icon: '🔊', name: 'Простые звуки', desc: 'гласные + согласные' },
      { lvl: 0,  icon: '😀', name: 'Стикеры + реакции', desc: 'отправка и обучение' },
      { lvl: 2,  icon: '💬', name: 'Комбо-фразы', desc: 'гав, тяф, ваф, рру' },
      { lvl: 2,  icon: '😊', name: 'Изучение эмодзи', desc: 'запоминает твои эмодзи' },
      { lvl: 3,  icon: '📝', name: 'Заметки', desc: '"запомни: ...", /notes' },
      { lvl: 3,  icon: '🐶', name: 'Социальные эмоции', desc: '+6 состояний' },
      { lvl: 4,  icon: '⏰', name: 'Напоминания', desc: '/remind, "напомни через..."' },
      { lvl: 4,  icon: '🔊', name: 'Звуки Tier 1', desc: 'мням, хрум, аууу' },
      { lvl: 5,  icon: '🔍', name: 'Поиск по памяти', desc: '"что помнишь про...?"' },
      { lvl: 5,  icon: '💼', name: 'Рабочие эмоции', desc: '+6 состояний' },
      { lvl: 5,  icon: '🎒', name: 'Артефакты', desc: 'находки при общении, /artifacts' },
      { lvl: 6,  icon: '📂', name: 'Хранение файлов', desc: 'сохраняет фото/документы' },
      { lvl: 6,  icon: '🔊', name: 'Звуки Tier 2', desc: 'сложные звуки' },
      { lvl: 8,  icon: '👤', name: 'Контакты', desc: '"запомни контакт...", /contacts' },
      { lvl: 8,  icon: '🎭', name: 'Драматичные эмоции', desc: '+5 состояний' },
      { lvl: 8,  icon: '📊', name: 'CRM чтение', desc: '"покажи таблицы", поиск' },
      { lvl: 10, icon: '✏️', name: 'CRM запись', desc: '"создай тикет: ..."' },
      { lvl: 10, icon: '🌈', name: 'Полный спектр эмоций', desc: '32 состояния' },
      { lvl: 10, icon: '🔊', name: 'Звуки Tier 3', desc: 'экстремальные звуки' },
      { lvl: 12, icon: '🎯', name: 'Orchestrator', desc: 'AI-помощник в чате' },
      { lvl: 12, icon: '📈', name: 'Аналитика', desc: 'сводка по данным' },
      { lvl: 15, icon: '🎶', name: 'Изобретение звуков', desc: 'создаёт новые звуки' },
      { lvl: 15, icon: '📋', name: 'CRM задачи', desc: 'управление задачами' },
      { lvl: 20, icon: '🧠', name: 'Продвинутый babble', desc: 'сложные комбинации' },
      { lvl: 20, icon: '⚙️', name: 'Автоматизации', desc: 'периодические действия' },
      { lvl: 10, icon: '🤝', name: 'Социальные питомцы', desc: 'дружба между ПЕС' },
      { lvl: 30, icon: '✨', name: 'Спеллы', desc: 'уникальные способности' },
      { lvl: 40, icon: '◈', name: 'Крипто-язык', desc: 'абстрактные символы' },
    ];

    const lines = [`🐾 ${name} — Level ${level}`, ``, `━━ Способности ━━`, ``];

    let lastLvl = -1;
    for (const a of abilities) {
      if (a.lvl !== lastLvl) {
        if (lastLvl !== -1) lines.push(``);
        const marker = level >= a.lvl ? '🟢' : '🔒';
        lines.push(`${marker} Level ${a.lvl}:`);
        lastLvl = a.lvl;
      }
      const status = level >= a.lvl ? '✅' : '⬜';
      lines.push(`  ${status} ${a.icon} ${a.name} — ${a.desc}`);
    }

    // Progress to next unlock
    const nextUnlock = abilities.find(a => a.lvl > level);
    if (nextUnlock) {
      lines.push(``);
      lines.push(`━━ Следующий анлок: Level ${nextUnlock.lvl} ━━`);
      lines.push(`  ${nextUnlock.icon} ${nextUnlock.name}`);
    }

    lines.push(``);
    const unlocked = abilities.filter(a => a.lvl <= level).length;
    lines.push(`📊 ${unlocked}/${abilities.length} способностей открыто`);

    await this._sendText(this.chatId, lines.join('\n'));
  }

  async _cmdSetName(msg, args) {
    const newName = args.trim();
    if (!newName) {
      await this._sendText(this.chatId,
        `✏️ /setname <имя>\n` +
        `🐾 ${this.pes.name}`
      );
      return;
    }

    if (newName.length > 30) {
      await this._sendText(this.chatId, `❌ ✏️ max 30`);
      return;
    }

    const oldName = this.pes.name;
    this.pes.name = newName;

    // Persist to DB
    if (this.pes.store) {
      this.pes.store.setPetName(newName);
    }

    await this._sendText(this.chatId, pickRandom([
      `🐾✨ ррРРуу!! ${newName}!! ыыыЫЫЫ!! 💛`,
      `${newName}! ${newName}! ГАВВВ!! тяф тяф!! 🐾💛💛💛`,
      `рру?~ ${newName}... ууУУУ!! ВАФ!! ✨🐾`,
      `ЫЫЫ!! ваф ваф!! ${newName}!! рррРР!! 🐾✨`,
    ]));
  }

  async _sendStatus() {
    const s = this.pes.status();
    if (!s.alive) {
      await this._sendText(this.chatId, `💤 ${this.pes.name}... 💧`);
      return;
    }

    const moodBar = this._bar(s.mood);
    const energyBar = this._bar(s.energy);
    const hungerBar = this._bar(1 - (s.hunger || 0));

    // Phase info
    const phaseInfo = {
      puppy:       { icon: '🐣', name: 'Щенок',     next: 'Подросток', nextLvl: 20 },
      young:       { icon: '🐕', name: 'Подросток',  next: 'Взрослый',  nextLvl: 40 },
      adult:       { icon: '🦮', name: 'Взрослый',   next: 'Опытный',   nextLvl: 60 },
      experienced: { icon: '🎓', name: 'Опытный',    next: 'КиберPes',  nextLvl: 80 },
      cyber:       { icon: '🤖', name: 'КиберPes',   next: null,        nextLvl: 100 },
    };
    const pi = phaseInfo[s.phase] || phaseInfo.puppy;

    // XP progress bar to next level
    const currentLvl = Math.floor(s.level || 0);
    const levelProgress = (s.level || 0) - currentLvl;
    const xpBar = this._bar(levelProgress);

    // Relationship info
    let relInfo = '';
    if (this.pes.store) {
      try {
        const rel = this.pes.store.getRelationship('owner');
        if (rel) {
          const phaseNames = { stranger: '🔲 Незнакомец', acquaintance: '🟨 Знакомый', friend: '🟩 Друг', favorite: '💛 Любимый', bonded: '❤️ Неразлучный' };
          const trustBar = this._bar(rel.trust);
          const affBar = this._bar(rel.affection);
          relInfo = [
            ``,
            `━━ Привязанность ━━`,
            `${phaseNames[rel.relationship_phase] || rel.relationship_phase}`,
            `🤝 ${trustBar} ${Math.round(rel.trust * 100)}%`,
            `💕 ${affBar} ${Math.round(rel.affection * 100)}%`,
            `📅 Встреч: ${rel.interactions_count}`,
          ].join('\n');
        }
      } catch (_) {}
    }

    // Days together
    const daysTogether = s.age || 0;
    const daysText = daysTogether === 0 ? 'первый день!' :
                     daysTogether === 1 ? '1 день' :
                     daysTogether < 5 ? `${daysTogether} дня` :
                     `${daysTogether} дней`;

    // Sticker/emoji counts
    let stickerCount = 0, emojiCount = 0;
    if (this.pes.store) {
      try {
        stickerCount = this.pes.store.getLearnedStickers({ limit: 1000 }).length;
        emojiCount = this.pes.store.getLearnedEmojis({ limit: 1000 }).length;
      } catch (_) {}
    }

    // Spell info
    let spellLines = '';
    if (this.pes.store) {
      try {
        const revealedSpells = this.pes.store.getRevealedSpells();
        if (revealedSpells.length > 0) {
          const rarityIcons = {
            spark: '✦', glint: '✧', flash: '⚡', pulse: '💫',
            surge: '🌊', wave: '🌊', storm: '⛈️', blaze: '🔥',
            nova: '💥', eclipse: '🌑', cosmos: '🌌', god: '👁️‍🗨️',
            beyond: '🔮',
          };
          const traitNames = {
            courage: 'Храбрость', curiosity: 'Любопытство', loyalty: 'Верность',
            stubbornness: 'Упрямство', playfulness: 'Игривость', drama: 'Драма',
            food_obsession: 'Аппетит', sass: 'Дерзость', aggression: 'Сила',
          };
          const lines = revealedSpells.map(sp => {
            const icon = rarityIcons[sp.rarity] || '✨';
            const trait = traitNames[sp.trait] || sp.trait;
            return `${icon} ${sp.name} (${trait} ${100 + sp.level}%) [${sp.rarity.toUpperCase()}]`;
          });
          spellLines = `\n━━ Спэлы ━━\n${lines.join('\n')}`;
        }
        // Check hidden spells count
        const hiddenCount = this.pes.store.getSpells({ hiddenOnly: true }).length;
        if (hiddenCount > 0) {
          spellLines += spellLines ? `\n❓ Скрытых: ${hiddenCount}` : `\n━━ Спэлы ━━\n❓ Скрытых: ${hiddenCount}`;
        }
      } catch (_) {}
    }

    // Smart XP info
    let dailyXP = 0, streak = 0;
    if (this.pes.store) {
      try {
        dailyXP = this.pes.store.getDailyXP();
        streak = parseInt(this.pes.store.getConfig('streak_current') || '0', 10);
      } catch (_) {}
    }
    const dailyXPBar = this._bar(Math.min(dailyXP / 50, 1));
    const streakText = streak > 0 ? ` 🔥${streak}` : '';
    const diversityCount = this._diversityTypes?.size || 0;

    // Next phase progress
    const nextPhaseText = pi.next
      ? `\n📈 До «${pi.next}»: ур. ${currentLvl}/${pi.nextLvl}`
      : `\n🏆 Максимальная фаза!`;

    const lines = [
      `🐾 ━━━ ${s.name} ━━━ 🐾`,
      ``,
      `${pi.icon} ${pi.name} • Ур. ${currentLvl}`,
      `⭐ ${xpBar} ${s.xp} XP`,
      `📊 ${dailyXPBar} ${dailyXP}/50 XP сегодня${streakText}`,
      nextPhaseText,
      ``,
      `━━ Состояние ━━`,
      `😊 ${moodBar} ${Math.round(s.mood * 100)}%`,
      `⚡ ${energyBar} ${Math.round(s.energy * 100)}%`,
      `🍖 ${hungerBar} ${Math.round((1 - (s.hunger || 0)) * 100)}%`,
      `💭 ${s.emotion} (${Math.round((s.intensity || 0) * 100)}%)`,
      relInfo,
      ``,
      `━━ Статистика ━━`,
      `📅 Вместе: ${daysText}${streakText ? ` • серия ${streak}д` : ''}`,
      `🎓 Команд: ${s.commandsKnown}`,
      `👍 ${s.timesPraised} похвал • 👎 ${s.timesScolded} ругани`,
      `🎨 ${stickerCount} стикеров • ${emojiCount} эмодзи`,
      `📦 ${this._stickerFileIds?.length || 0} стикеров в паках`,
      `🎯 Разнообразие: ${diversityCount}/3 типов`,
      spellLines,
    ];

    await this._sendText(this.chatId, lines.join('\n'));
  }

  async _cmdFeed(msg, args) {
    // Personality reaction to feeding
    await this._sendChatAction(this.chatId);
    await sleep(thinkingDelay(this.pes.level));
    const feedBabble = this._babble.generateReply(this.pes?.level || 0, 'food_obsessed', 0.8, 'feed');
    await this._sendText(this.chatId, feedBabble);

    if (!args) {
      this.pes.feed({ type: 'generic' });
    } else {
      this.pes.feed({ type: 'text', content: args });
    }
  }

  async _cmdCommand(msg, args) {
    if (!args) {
      await this._sendText(this.chatId, '🎾 /command <команда>\nfetch, sit, scan_api');
      return;
    }
    const result = this.pes.command(args.split(/\s+/)[0], {
      source: 'telegram',
      args: args.split(/\s+/).slice(1).join(' '),
    });

    // If PES is learning
    if (result.reason === 'unknown') {
      await this._sendText(this.chatId, pickRandom([
        `рру?.. ...тяф?.. 🐾 ❓`,
        `ваф?.. ...ууу?.. хнн.. ❓`,
      ]));
    } else if (result.reason === 'just_learned') {
      await this._sendText(this.chatId, pickRandom([
        `ГАВВ!! ррРРуу!! ✨🐾🎉`,
        `ваф ваф ВАФ!! ыыыЫЫ!! 🎉🐾`,
      ]));
    } else if (result.reason === 'stubborn') {
      // Expression already sent via PES events
    }
  }

  async _cmdSilent(msg) {
    const current = this.pes.engine?.silentMode || false;
    this.pes.setSilentMode(!current);
    await this._sendText(this.chatId,
      !current ? `🤫 ...ш-ш-ш... 🐾` : `🔊 ГАВВ!! ваф ваф!! 🐾`
    );
  }

  async _cmdTranslate(msg, args) {
    if (!args || !args.trim()) {
      await this._sendText(this.chatId, [
        `📜 /translate <язык> <текст>`,
        ``,
        `  /translate en привет мир`,
        `  /translate es доброе утро`,
        `  /translate fr как дела`,
      ].join('\n'));
      return;
    }

    // Parse: first word = lang, rest = text
    const parts = args.trim().split(/\s+/);
    const langHint = parts[0];
    const text = parts.slice(1).join(' ');
    if (!text) {
      await this._sendText(this.chatId, `📜 /translate <язык> <текст>`);
      return;
    }

    // Short lang codes
    const shortLangs = {
      'en': 'английский', 'ru': 'русский', 'es': 'испанский', 'de': 'немецкий',
      'fr': 'французский', 'zh': 'китайский', 'ja': 'японский', 'ko': 'корейский',
      'ar': 'арабский', 'it': 'итальянский', 'pt': 'португальский', 'tr': 'турецкий',
    };
    const targetLang = shortLangs[langHint.toLowerCase()] || langHint;

    await this._handleTranslation(text, targetLang);
    await this._processSmartXP(msg, 'command', 'translate');
    this._updateRelationship('message');
  }

  async _cmdStickers(msg, args) {
    if (!args) {
      const stickerCount = this._stickerFileIds?.length || 0;
      const packs = [...this._learnedPacks];
      if (this._currentStickerPack) packs.unshift(this._currentStickerPack);
      const packList = packs.length > 0 ? packs.join(', ') : 'нет';
      await this._sendText(this.chatId,
        `🎨 ${packList}\n📦 ${stickerCount}\n\n💡 🎨 → 🐾 | /stickers <пак>`
      );
      return;
    }

    try {
      await this.loadStickerPack(args, null, true); // additive
      this._learnedPacks.add(args);
      const count = this._stickerFileIds?.length || 0;
      await this._sendText(this.chatId, `✅ 🎨 ${args} (📦 ${count})`);
    } catch (err) {
      await this._sendText(this.chatId, `❌ 🎨 ${args} 💧`);
    }
  }


  // ═══════════════════════════════════════════════════════════
  // REMINDERS
  // ═══════════════════════════════════════════════════════════

  /**
   * /remind — set a reminder.
   * Usage:
   *   /remind 30м купить молоко
   *   /remind 2ч позвонить маме
   *   /remind 1д проверить деплой
   *   /remind 15:30 встреча
   */
  async _cmdRemind(msg, args) {
    if (!args || !args.trim()) {
      // No command-line help — just a dog reaction
      await this._sendText(this.chatId, pickRandom([
        `рру?.. ⏰🐾`,
        `тяф? ⏰🐾`,
        `ваф~ ⏰🐾`,
      ]));
      return;
    }

    const parsed = this._parseReminderFromCommand(args);
    if (!parsed) {
      // Try to treat the whole args as natural language reminder
      const reminderIntent = await this._detectReminderIntent(`напомни ${args}`);
      if (reminderIntent && this.pes.store) {
        this.pes.store.createReminder(reminderIntent.text, reminderIntent.remindAt);
        await this._sendText(this.chatId, pickRandom([
          `⏰ ГАВ! рру~~ 🐾`,
          `⏰ тяф! ррФФ~ 🐾`,
          `⏰ ваф-ваф! 🐾♡`,
        ]));
        return;
      }
      // Still couldn't parse — just acknowledge
      await this._sendText(this.chatId, pickRandom([
        `рру?.. ⏰🐾`,
        `тяф?.. ⏰🐾`,
      ]));
      return;
    }

    if (!this.pes.store) {
      await this._sendText(this.chatId, `скууу... 💧🐾`);
      return;
    }

    const reminder = this.pes.store.createReminder(parsed.text, parsed.remindAt);

    await this._sendText(this.chatId, pickRandom([
      `⏰ ГАВ! рру~~ 🐾`,
      `⏰ тяф! ррФФ~ 🐾`,
      `⏰ ваф-ваф! 🐾♡`,
    ]));
  }

  /**
   * /reminders — list pending reminders.
   */
  async _cmdReminders(msg) {
    if (!this.pes.store) {
      await this._sendText(this.chatId, `скууу... 💧 память не работает... рру?.. 🐾`);
      return;
    }

    const pending = this.pes.store.getPendingReminders();
    if (pending.length === 0) {
      await this._sendText(this.chatId, `📋 —\n💡 /remind 30м текст`);
      return;
    }

    const lines = ['📋 Активные напоминалки:', ''];
    for (const r of pending) {
      const timeStr = this._formatReminderTime(r.remind_at);
      lines.push(`  ⏰ ${timeStr} — ${r.text}`);
    }
    lines.push('');
    lines.push(`Всего: ${pending.length}`);

    await this._sendText(this.chatId, lines.join('\n'));
  }

  async _cmdPacks(msg) {
    if (!this.pes.store) {
      await this._sendText(this.chatId, `скууу... 💧 память не работает... рру?.. 🐾`);
      return;
    }

    const allPacks = this.pes.store.getCreatedPacks();
    if (allPacks.length === 0) {
      await this._sendText(this.chatId, `📦 —\n💡 Отправь фото + "сделай стикер" или "сделай эмодзи"`);
      return;
    }

    const lines = ['📦 Созданные паки:', ''];
    for (const p of allPacks) {
      const typeIcon = p.pack_type === 'custom_emoji' ? '✨' : '🎨';
      const linkPrefix = p.pack_type === 'custom_emoji' ? 'addemoji' : 'addstickers';
      const origins = this.pes.store.getPackOrigins(p.pack_name);
      const originCount = origins.filter(o => o.original_set_name).length;
      const originInfo = originCount > 0 ? ` (${originCount} из других паков)` : '';
      lines.push(`${typeIcon} ${p.title} — ${p.sticker_count} шт.${originInfo}`);
      lines.push(`   → https://t.me/${linkPrefix}/${p.pack_name}`);
      // Show origins
      if (origins.length > 0) {
        const uniqueSets = [...new Set(origins.filter(o => o.original_set_title).map(o => o.original_set_title))];
        if (uniqueSets.length > 0) {
          lines.push(`   📋 Источники: ${uniqueSets.slice(0, 5).join(', ')}${uniqueSets.length > 5 ? ` (+${uniqueSets.length - 5})` : ''}`);
        }
      }
    }
    lines.push('');
    lines.push(`Всего паков: ${allPacks.length}`);

    await this._sendText(this.chatId, lines.join('\n'));
  }

  // ═══════════════════════════════════════════════════════════
  // STICKER COLLECTION — bookmarked stickers with attribution
  // ═══════════════════════════════════════════════════════════

  /**
   * Add a sticker to the collection (bookmark with origin).
   * Called when owner replies to a sticker with "сохрани" / "в коллекцию".
   */
  async _addToCollection(msg, sticker) {
    const fileId = sticker.file_id;
    const fileUniqueId = sticker.file_unique_id;
    const setName = sticker.set_name || null;
    const emoji = sticker.emoji || '';

    // Check if already in collection
    if (this.pes.store.isInCollection(fileUniqueId)) {
      await this._sendText(this.chatId, pickRandom([
        'тяф! 📦🐾 уже в коллекции! ♡',
        'ваф! 📦 уже собрал этот! 🐾',
      ]));
      return;
    }

    // Check if it's from our own created pack
    const createdPacks = this.pes.store.getCreatedPacks();
    const ownPackNames = createdPacks.map(p => p.pack_name);
    if (setName && ownPackNames.includes(setName)) {
      await this._sendText(this.chatId, pickRandom([
        'тяф! 🐾 это же МОЙ стикер! ♡',
        'ваф! 🎨🐾 это из нашего пака! ♡',
      ]));
      return;
    }

    // Get set title from Telegram API
    let setTitle = null;
    if (setName) {
      try {
        const setInfo = await this._call('getStickerSet', { name: setName });
        setTitle = setInfo?.title || setName;
      } catch (_) {
        setTitle = setName;
      }
    }

    // Save to collection
    this.pes.store.saveToCollection({
      file_id: fileId,
      file_unique_id: fileUniqueId,
      set_name: setName,
      set_title: setTitle,
      emoji,
    });

    const count = this.pes.store.getCollectionCount();
    const originLabel = setTitle ? ` из «${setTitle}»` : '';

    await this._sendText(this.chatId, pickRandom([
      `ваф! 📦🐾 сохранил${originLabel}! (${count} в коллекции) ♡`,
      `тяф! 📦 в коллекции!${originLabel} 🐾 (${count} шт.)`,
      `гав! 📦🐾 собрал!${originLabel} ♡ (${count})`,
    ]));

    this._addToMemory('pes', `[сохранил стикер в коллекцию${originLabel}]`);
    await this._processSmartXP(msg, 'sticker', 'collection');
    this._updateRelationship('message');
  }

  /**
   * /artifacts — show artifact collection stats.
   */
  async _cmdArtifacts(msg) {
    if (!this.pes.store) {
      await this._sendText(this.chatId, '💧 память не работает...');
      return;
    }

    const ownerId = String(this.chatId);
    const stats = this.pes.store.getArtifactStats(ownerId);

    if (stats.total === 0) {
      await this._sendText(this.chatId, '🎒 Рюкзак пуст\n💡 Артефакты выпадают случайно при общении!\nчем больше общаемся — тем больше находок 🐾');
      return;
    }

    const RARITY_LABEL = { common: '⬜ обычный', uncommon: '🟩 необычный', rare: '🟦 редкий', epic: '🟪 эпик', legendary: '🟨 легенда' };
    const TYPE_LABEL = { toy: '🧸 Игрушки', trophy: '🏆 Трофеи', gift: '🎁 Подарки', food: '🦴 Еда', rare: '💎 Редкости', secret: '🔮 Секреты' };

    const lines = ['🎒 Мои артефакты:', ''];

    // By type
    for (const [type, label] of Object.entries(TYPE_LABEL)) {
      const count = stats.byType[type];
      if (count) lines.push(`  ${label}: ${count}`);
    }

    lines.push('');

    // By rarity
    for (const [rarity, label] of Object.entries(RARITY_LABEL)) {
      const count = stats.byRarity[rarity];
      if (count) lines.push(`  ${label}: ${count}`);
    }

    lines.push('');
    lines.push(`Всего: ${stats.total} артефактов`);
    if (stats.favorites > 0) lines.push(`⭐ Избранных: ${stats.favorites}`);

    // Show last 5 finds
    const recent = this.pes.store.getArtifacts(ownerId, { limit: 5 });
    if (recent.length > 0) {
      lines.push('');
      lines.push('Последние находки:');
      for (const a of recent) {
        lines.push(`  ${a.emoji || '•'} ${a.name}`);
      }
    }

    await this._sendText(this.chatId, lines.join('\n'));
  }

  /**
   * Remove a sticker from the collection.
   */
  async _removeFromCollection(msg, sticker) {
    const fileUniqueId = sticker.file_unique_id;

    if (!this.pes.store.isInCollection(fileUniqueId)) {
      await this._sendText(this.chatId, pickRandom([
        'тяф?.. 🐾 этого нет в коллекции 💧',
        'ваф?.. 📦 не нашёл в коллекции 💧',
      ]));
      return;
    }

    this.pes.store.removeFromCollection(fileUniqueId);
    const count = this.pes.store.getCollectionCount();

    await this._sendText(this.chatId, pickRandom([
      `ваф! 🗑️🐾 убрал из коллекции (${count} осталось)`,
      `тяф! 🗑️ убрал! 🐾 (${count} в коллекции)`,
    ]));
    this._updateRelationship('message');
  }

  /**
   * /collection — show sticker collection grouped by packs.
   */
  async _cmdCollection(msg) {
    if (!this.pes.store) {
      await this._sendText(this.chatId, `скууу... 💧 память не работает... рру?.. 🐾`);
      return;
    }

    const byPack = this.pes.store.getCollectionByPack();
    const total = this.pes.store.getCollectionCount();

    if (total === 0) {
      await this._sendText(this.chatId, `📦 Коллекция пуста\n💡 Reply на стикер + "сохрани" чтобы добавить`);
      return;
    }

    const lines = ['📦 Моя коллекция:', ''];

    // Stickers from known packs
    for (const pack of byPack) {
      const title = pack.set_title || pack.set_name || '???';
      const emojis = (pack.emojis || '').slice(0, 8);
      lines.push(`  ${emojis} «${title}» — ${pack.count} шт.`);
      if (pack.set_name) {
        lines.push(`     → https://t.me/addstickers/${pack.set_name}`);
      }
    }

    // Stickers without a pack
    const noPack = this.pes.store.getCollection().filter(s => !s.set_name);
    if (noPack.length > 0) {
      lines.push(`  🐾 Без пака — ${noPack.length} шт.`);
    }

    lines.push('');
    lines.push(`Всего: ${total} стикеров из ${byPack.length} паков`);
    lines.push('');
    lines.push(`💡 Inline: @${this._botUsername || 'bot'} — показать коллекцию в любом чате`);

    await this._sendText(this.chatId, lines.join('\n'));
  }

  // ═══════════════════════════════════════════════════════════
  // ORIGIN — sticker source attribution
  // ═══════════════════════════════════════════════════════════

  async _cmdOrigin(msg) {
    const sticker = msg.reply_to_message?.sticker;
    if (!sticker) {
      await this._sendText(this.chatId, '🐾 Reply на стикер → /origin — покажу откуда он!');
      return;
    }

    const fileUniqueId = sticker.file_unique_id;

    // Check sticker_origins (stickers added to our pack from foreign packs)
    if (this.pes.store) {
      const origin = this.pes.store.getStickerOrigin(fileUniqueId);
      if (origin && origin.original_set_name) {
        const title = origin.original_set_title || origin.original_set_name;
        await this._sendText(this.chatId,
          `📦 Из пака «${title}» ${origin.original_emoji || ''}\n→ https://t.me/addstickers/${origin.original_set_name}`
        );
        return;
      }
    }

    // Check sticker_collection
    if (this.pes.store) {
      const col = this.pes.store.getCollection().find(s => s.file_unique_id === fileUniqueId);
      if (col && col.set_name) {
        const title = col.set_title || col.set_name;
        await this._sendText(this.chatId,
          `📦 Из пака «${title}» ${col.emoji || ''}\n→ https://t.me/addstickers/${col.set_name}`
        );
        return;
      }
    }

    // Check Telegram sticker set_name directly
    if (sticker.set_name) {
      let title = sticker.set_name;
      try {
        const setInfo = await this._call('getStickerSet', { name: sticker.set_name });
        if (setInfo?.title) title = setInfo.title;
      } catch (_) {}
      await this._sendText(this.chatId,
        `📦 Из пака «${title}»\n→ https://t.me/addstickers/${sticker.set_name}`
      );
      return;
    }

    await this._sendText(this.chatId, '🐾 Этот стикер без пака — одинокий путешественник!');
  }

  // ═══════════════════════════════════════════════════════════
  // PACK MANAGEMENT — setup, rename, mypack
  // ═══════════════════════════════════════════════════════════

  /**
   * /newpack <Name> — create or set main collection pack with custom name.
   * Pack Telegram name: <Name>_by_<BotUsername>
   * Pack display title: <Name>
   */
  async _cmdNewPack(msg, args) {
    const desiredTitle = args.trim();
    if (!desiredTitle) {
      await this._sendText(this.chatId, '🐾 /newpack <Название>\n💡 Пример: /newpack Nikich2392');
      return;
    }
    if (desiredTitle.length > 60) {
      await this._sendText(this.chatId, '❌ Максимум 60 символов');
      return;
    }

    if (!this.pes.store) {
      await this._sendText(this.chatId, 'скууу... 💧 память не работает... рру?.. 🐾');
      return;
    }

    const ownerId = Number(msg.from.id);

    // Check if we already have a main collection pack
    const mainPack = this.pes.store.getMainCollectionPack();
    if (mainPack) {
      // Rename existing pack title
      try {
        await this._call('setStickerSetTitle', { name: mainPack.pack_name, title: desiredTitle });
        this.pes.store.updatePackTitle(mainPack.pack_name, desiredTitle);
        await this._sendText(this.chatId, `ГААВВВ!! 🎨✨🐾 Пак переименован!\n🏷️ «${desiredTitle}»\n→ https://t.me/addstickers/${mainPack.pack_name}`);
        return;
      } catch (err) {
        console.log(`⚠️ setStickerSetTitle failed: ${err.message}`);
        // If rename fails, create a new pack instead
      }
    }

    // Create new pack — need first sticker
    // Set pending state for pack creation with custom title
    this._pendingPackTitle = desiredTitle;
    this._pendingAddToPack = Date.now();
    this._pendingAddType = 'regular';
    await this._sendText(this.chatId, `тяф! 🎨🐾 Пак «${desiredTitle}» — жду первый стикер!\n📸 Пришли фото или стикер`);
  }

  /**
   * /mypack — show link to main collection pack + stats.
   */
  async _cmdMyPack(msg) {
    if (!this.pes.store) {
      await this._sendText(this.chatId, 'скууу... 💧 память не работает... рру?.. 🐾');
      return;
    }

    const mainPack = this.pes.store.getMainCollectionPack();
    if (!mainPack) {
      await this._sendText(this.chatId, '📦 Пак ещё не создан\n💡 /newpack <Название> — создай свою коллекцию!');
      return;
    }

    // Get origins stats
    const origins = this.pes.store.getPackOrigins(mainPack.pack_name);
    const ownStickers = mainPack.sticker_count - origins.length;
    const foreignStickers = origins.length;

    // Group origins by source pack
    const byPack = {};
    for (const o of origins) {
      const key = o.original_set_name || 'unknown';
      if (!byPack[key]) byPack[key] = { title: o.original_set_title || o.original_set_name, name: o.original_set_name, count: 0, emojis: [] };
      byPack[key].count++;
      if (o.original_emoji && byPack[key].emojis.length < 6) byPack[key].emojis.push(o.original_emoji);
    }

    const lines = [
      `📦 «${mainPack.title}»`,
      ``,
      `🎨 Своих стикеров: ${Math.max(0, ownStickers)}`,
      `📋 Из других паков: ${foreignStickers}`,
      `📊 Всего: ${mainPack.sticker_count}`,
    ];

    // Show each source pack with count and emojis
    const packEntries = Object.values(byPack).sort((a, b) => b.count - a.count);
    if (packEntries.length > 0) {
      lines.push('');
      lines.push('📋 Источники:');
      for (const p of packEntries.slice(0, 12)) {
        const emojis = p.emojis.join('');
        lines.push(`  ${emojis} «${p.title}» — ${p.count} шт.`);
        if (p.name) lines.push(`  → t.me/addstickers/${p.name}`);
      }
      if (packEntries.length > 12) {
        lines.push(`  ...и ещё ${packEntries.length - 12} паков`);
      }
    }

    lines.push('');
    lines.push(`→ https://t.me/addstickers/${mainPack.pack_name}`);
    lines.push('');
    lines.push(`💡 Поделись ссылкой — друзья добавят твою коллекцию!`);

    await this._sendText(this.chatId, lines.join('\n'));
  }

  /**
   * /renamepack <NewTitle> — rename main collection pack.
   */
  async _cmdRenamePack(msg, args) {
    const newTitle = args.trim();
    if (!newTitle) {
      await this._sendText(this.chatId, '🐾 /renamepack <Новое название>');
      return;
    }
    if (newTitle.length > 60) {
      await this._sendText(this.chatId, '❌ Максимум 60 символов');
      return;
    }
    if (!this.pes.store) {
      await this._sendText(this.chatId, 'скууу... 💧 память не работает... рру?.. 🐾');
      return;
    }

    const mainPack = this.pes.store.getMainCollectionPack();
    if (!mainPack) {
      await this._sendText(this.chatId, '📦 Пак ещё не создан. /newpack <Название>');
      return;
    }

    try {
      await this._call('setStickerSetTitle', { name: mainPack.pack_name, title: newTitle });
      this.pes.store.updatePackTitle(mainPack.pack_name, newTitle);
      await this._sendText(this.chatId, `ваф! 🏷️🐾 «${newTitle}»\n→ https://t.me/addstickers/${mainPack.pack_name}`);
    } catch (err) {
      console.error(`⚠️ Rename pack failed: ${err.message}`);
      await this._sendText(this.chatId, `❌ Не удалось переименовать: ${err.message}`);
    }
  }

  /**
   * /newemojipack <Name> — create custom emoji pack.
   */
  async _cmdNewEmojiPack(msg, args) {
    const desiredTitle = args.trim();
    if (!desiredTitle) {
      await this._sendText(this.chatId, '🐾 /newemojipack <Название>\n💡 Пример: /newemojipack MyEmoji');
      return;
    }
    if (desiredTitle.length > 60) {
      await this._sendText(this.chatId, '❌ Максимум 60 символов');
      return;
    }
    if (!this.pes.store) {
      await this._sendText(this.chatId, 'скууу... 💧 память не работает... рру?.. 🐾');
      return;
    }

    // Check if we already have an emoji pack
    const existingPacks = this.pes.store.getCreatedPacks('custom_emoji');
    if (existingPacks.length > 0) {
      // Rename existing
      try {
        await this._call('setStickerSetTitle', { name: existingPacks[0].pack_name, title: `${desiredTitle} ✨` });
        this.pes.store.updatePackTitle(existingPacks[0].pack_name, `${desiredTitle} ✨`);
        await this._sendText(this.chatId, `ГААВВВ!! ✨🐾 Emoji пак переименован!\n🏷️ «${desiredTitle}»\n→ https://t.me/addemoji/${existingPacks[0].pack_name}`);
        return;
      } catch (err) {
        console.log(`⚠️ setStickerSetTitle failed for emoji pack: ${err.message}`);
      }
    }

    // Create new emoji pack — need first emoji
    this._pendingPackTitle = desiredTitle;
    this._pendingAddToPack = Date.now();
    this._pendingAddType = 'custom_emoji';
    await this._sendText(this.chatId, `тяф! ✨🐾 Emoji пак «${desiredTitle}» — жду первую картинку!\n📸 Пришли фото или изображение`);
  }

  /**
   * /myemoji — show link to emoji pack + stats.
   */
  async _cmdMyEmojiPack(msg) {
    if (!this.pes.store) {
      await this._sendText(this.chatId, 'скууу... 💧 память не работает... рру?.. 🐾');
      return;
    }

    const emojiPacks = this.pes.store.getCreatedPacks('custom_emoji');
    if (emojiPacks.length === 0) {
      await this._sendText(this.chatId, '✨ Emoji пак ещё не создан\n💡 /newemojipack <Название> — создай!');
      return;
    }

    const lines = [];
    for (const pack of emojiPacks) {
      lines.push(`✨ «${pack.title}» — ${pack.sticker_count} эмодзи`);
      lines.push(`→ https://t.me/addemoji/${pack.pack_name}`);
      lines.push('');
    }
    lines.push('💡 "сделай эмодзи" + фото — добавить в пак');
    await this._sendText(this.chatId, lines.join('\n'));
  }

  // ═══════════════════════════════════════════════════════════
  // METRONOME
  // ═══════════════════════════════════════════════════════════

  /**
   * /metronome [bpm] [duration] — generate and send metronome click track.
   * Examples: /metronome, /metronome 140, /metronome 80 60
   */
  async _cmdMetronome(msg, args) {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    let bpm = 120;
    let duration = 30;

    if (parts[0]) {
      const parsed = parseInt(parts[0]);
      if (!isNaN(parsed) && parsed >= 40 && parsed <= 300) bpm = parsed;
    }
    if (parts[1]) {
      // Duration: "60" or "60с" or "1мин" or "1m"
      const durMatch = parts[1].match(/^(\d+)(с|сек|s|мин|m|min)?$/i);
      if (durMatch) {
        let val = parseInt(durMatch[1]);
        const unit = durMatch[2]?.toLowerCase();
        if (unit && (unit === 'мин' || unit === 'm' || unit === 'min')) val *= 60;
        duration = Math.max(5, Math.min(120, val));
      }
    }

    await this._sendMetronome(bpm, duration);
  }

  // ═══════════════════════════════════════════════════════════
  // INSIGHTS — conversation analysis
  // ═══════════════════════════════════════════════════════════

  async _cmdInsights(msg) {
    if (!this.pes.store) {
      await this._sendText(this.chatId, 'скууу... 💧 память не работает... рру?.. 🐾');
      return;
    }

    const data = this.pes.store.gatherInsightsData();
    if (!data || data.totalInteractions < 15) {
      const status = this.pes.status();
      const sounds = status.phase === 'puppy'
        ? 'тяф... тяф-тяф... 🐾'
        : 'ррр... гав! 🐾';
      await this._sendText(this.chatId,
        `🔍 ${sounds}\n\n` +
        `Ещё мало данных... Пообщаемся побольше и я расскажу что заметил!\n` +
        `📊 Наблюдений: ${data?.totalInteractions || 0} / 15`
      );
      return;
    }

    // Build prompt for LLM
    const insightsPrompt = this._buildInsightsPrompt(data);

    if (!this._llm) {
      // No LLM — raw data fallback
      await this._sendInsightsRaw(data);
      return;
    }

    try {
      await this._sendText(this.chatId, '🔍 ...');

      const result = await this._llm.generate(insightsPrompt, [
        { role: 'user', text: 'Расскажи что ты заметил о хозяине. Будь искренним, полезным, конкретным.' }
      ]);

      if (result) {
        const cleaned = result.replace(/\*[^*]+\*/g, '').trim();
        await this._sendText(this.chatId, `🔍 Мои наблюдения:\n\n${cleaned}`);

        // Save to insights log (anti-repeat)
        this.pes.store.saveInsight('requested', cleaned, {
          emotions: data.emotions.slice(0, 3).map(e => e.pattern_value),
          totalInteractions: data.totalInteractions,
        });
      } else {
        await this._sendInsightsRaw(data);
      }
    } catch (err) {
      console.error('⚠️ Insights LLM error:', err.message);
      await this._sendInsightsRaw(data);
    }
  }

  _buildInsightsPrompt(data) {
    const status = this.pes.status();
    const petName = status.name || 'ПЕС';

    // Format patterns for prompt
    const emotionStr = data.emotions.map(e =>
      `${e.pattern_value}: вес ${e.weight.toFixed(1)}, ${e.occurrences} раз`
    ).join('; ') || 'пока не определены';

    const timeStr = data.timeOfDay.map(t =>
      `${t.pattern_value}: вес ${t.weight.toFixed(1)}`
    ).join('; ') || 'пока не определено';

    const styleStr = data.messageStyle.map(s =>
      `${s.pattern_value}: вес ${s.weight.toFixed(1)}`
    ).join('; ') || 'не определён';

    const emojisStr = data.emojisUsed.slice(0, 10).map(e =>
      `${e.pattern_value} (${e.occurrences}×)`
    ).join(' ') || 'не использует';

    const actionsStr = data.actions.map(a =>
      `${a.pattern_value}: ${a.occurrences} раз`
    ).join('; ') || 'не зафиксированы';

    // Relationship context
    let relStr = '';
    if (data.relationship) {
      const r = data.relationship;
      relStr = `Фаза: ${r.relationship_phase}, доверие: ${Math.round(r.trust * 100)}%, привязанность: ${Math.round(r.affection * 100)}%, встреч: ${r.interactions_count}`;
    }

    // Recent insights (anti-repeat)
    const recentStr = data.recentInsights.length > 0
      ? `\nУЖЕ ГОВОРИЛ (НЕ ПОВТОРЯЙ ЭТО):\n${data.recentInsights.map(i => `- ${i.insight_text.slice(0, 100)}`).join('\n')}`
      : '';

    return `Ты — ${petName}, домашнее животное (ПЕС). Ты наблюдаешь за хозяином и делишься своими наблюдениями.
Говори от первого лица, как пёс. Используй звуки (гав, ррр, тяф) умеренно — 1-2 раза.
Будь КОНКРЕТНЫМ — называй цифры, паттерны, тренды. Не будь банальным.
Будь ЧЕСТНЫМ — если видишь что-то необычное, скажи. Ты — друг, а не подхалим.

ДАННЫЕ НАБЛЮДЕНИЙ:
- Всего взаимодействий: ${data.totalInteractions}
- Эмоции хозяина: ${emotionStr}
- Время активности: ${timeStr}
- Стиль сообщений: ${styleStr}
- Любимые эмодзи: ${emojisStr}
- Действия: ${actionsStr}
${relStr ? `- Отношения: ${relStr}` : ''}
${recentStr}

ПРАВИЛА:
- 3-5 конкретных наблюдений, каждое на новой строке
- Начни с самого интересного/неочевидного
- Если есть тренд (хозяин стал чаще/реже что-то делать) — скажи
- Не повторяй то что уже говорил
- Без звёздочек *действий*
- Максимум 500 символов`;
  }

  async _sendInsightsRaw(data) {
    const lines = ['🔍 Мои наблюдения:', ''];

    if (data.emotions.length > 0) {
      lines.push('😊 Эмоции:');
      for (const e of data.emotions.slice(0, 5)) {
        lines.push(`  ${e.pattern_value}: ${e.occurrences}×`);
      }
    }

    if (data.timeOfDay.length > 0) {
      lines.push('');
      lines.push('🕐 Активность:');
      for (const t of data.timeOfDay) {
        const labels = { morning: '☀️ Утро', afternoon: '🌤 День', evening: '🌅 Вечер', night: '🌙 Ночь' };
        lines.push(`  ${labels[t.pattern_value] || t.pattern_value}: ${t.occurrences}×`);
      }
    }

    if (data.emojisUsed.length > 0) {
      lines.push('');
      lines.push('💬 Любимые эмодзи:');
      lines.push(`  ${data.emojisUsed.slice(0, 8).map(e => `${e.pattern_value}(${e.occurrences})`).join(' ')}`);
    }

    if (data.messageStyle.length > 0) {
      lines.push('');
      lines.push('📝 Стиль:');
      for (const s of data.messageStyle) {
        const labels = { short: 'Короткие', medium: 'Средние', long: 'Длинные' };
        lines.push(`  ${labels[s.pattern_value] || s.pattern_value}: ${s.occurrences}×`);
      }
    }

    lines.push('');
    lines.push(`📊 Всего наблюдений: ${data.totalInteractions}`);

    await this._sendText(this.chatId, lines.join('\n'));
  }

  /**
   * Proactive observation — PES shares an insight unprompted (max 1/day).
   */
  async _tryProactiveInsight() {
    if (!this.pes.store || !this._llm) return;

    try {
      // Check last proactive insight time
      const lastTime = this.pes.store.getLastInsightTime();
      if (lastTime) {
        const hoursSince = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);
        if (hoursSince < 24) return; // Max 1 per day
      }

      const data = this.pes.store.gatherInsightsData();
      if (!data || data.totalInteractions < 30) return; // Need enough data

      // 15% chance per qualifying interaction (after cooldown passes)
      if (Math.random() > 0.15) return;

      const proactivePrompt = this._buildInsightsPrompt(data) +
        '\n\nЭто ПРОАКТИВНОЕ наблюдение — ты сам решил поделиться. ' +
        'Выбери ОДНО самое интересное наблюдение. Коротко, 1-2 предложения. ' +
        'Начни с "Гав! Я заметил..." или "Ррр... знаешь что?" или подобного.';

      const result = await this._llm.generate(proactivePrompt, [
        { role: 'user', text: 'Поделись одним наблюдением.' }
      ]);

      if (result) {
        const cleaned = result.replace(/\*[^*]+\*/g, '').trim();
        await this._sendText(this.chatId, `💡 ${cleaned}`);

        this.pes.store.saveInsight('proactive', cleaned, {
          trigger: 'auto',
          totalInteractions: data.totalInteractions,
        });
      }
    } catch (err) {
      console.error('⚠️ Proactive insight error:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // OWNER CONTACTS
  // ═══════════════════════════════════════════════════════════

  /**
   * Handle shared Telegram contact (vCard).
   * Auto-saves name + phone + telegram_user_id.
   */
  async _handleSharedContact(msg) {
    if (!this.pes.store) return;
    const c = msg.contact;
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown';
    const phone = c.phone_number || null;
    const telegramUserId = c.user_id ? String(c.user_id) : null;
    const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);

    const saved = this.pes.store.saveContact({
      owner_id: ownerId,
      name,
      phone,
      telegram_user_id: telegramUserId,
    });

    await this._sendText(this.chatId, pickRandom([
      `ваф! 👤🐾 ${name} — запомнил! рру~`,
      `тяф! 👤 ${name} 🐾 ррФФ!`,
      `гав! 👤 ${name} — в памяти! 🐾`,
    ]));
    this._addToMemory('owner', `[поделился контактом: ${name}]`);
    this._addToMemory('pes', `[запомнил контакт: ${name}${phone ? ' ' + phone : ''}]`);
    await this._processSmartXP(msg, 'note', 'contact');
    this._updateRelationship('message');
  }

  /**
   * Parse free-text contact string and save.
   * Expected: "Имя +79161234567 ДР 15 мая email@test.com друг"
   */
  async _parseAndSaveContact(msg, contactStr) {
    if (!this.pes.store) return;
    const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);

    // Extract phone
    const phoneMatch = contactStr.match(/(\+?\d[\d\s\-()]{6,15}\d)/);
    const phone = phoneMatch ? phoneMatch[1].replace(/[\s\-()]/g, '') : null;

    // Extract email
    const emailMatch = contactStr.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const email = emailMatch ? emailMatch[1] : null;

    // Extract birthday (DD.MM, DD/MM, DD месяца, ДР DD.MM)
    let birthday = null;
    let birthdayYear = null;
    const bdMatch = contactStr.match(/(?:др|день рождения|birthday|ДР)\s*[:\s]*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{4}))?/i);
    const bdMatch2 = contactStr.match(/(?:др|день рождения|birthday|ДР)\s*[:\s]*(\d{1,2})\s*(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)/i);

    if (bdMatch) {
      const day = bdMatch[1].padStart(2, '0');
      const month = bdMatch[2].padStart(2, '0');
      birthday = `${month}-${day}`;
      if (bdMatch[3]) birthdayYear = parseInt(bdMatch[3]);
    } else if (bdMatch2) {
      const day = bdMatch2[1].padStart(2, '0');
      const months = { 'января': '01', 'февраля': '02', 'марта': '03', 'апреля': '04', 'мая': '05', 'июня': '06', 'июля': '07', 'августа': '08', 'сентября': '09', 'октября': '10', 'ноября': '11', 'декабря': '12' };
      const month = months[bdMatch2[2].toLowerCase()];
      if (month) birthday = `${month}-${day}`;
    }

    // Extract relationship
    const relMatch = contactStr.match(/(?:друг|подруга|коллега|брат|сестра|мама|папа|жена|муж|начальник|клиент|family|friend|colleague)/i);
    const relationship = relMatch ? relMatch[0].toLowerCase() : null;

    // Name = everything except extracted parts
    let name = contactStr
      .replace(phoneMatch ? phoneMatch[0] : '', '')
      .replace(emailMatch ? emailMatch[0] : '', '')
      .replace(bdMatch ? bdMatch[0] : (bdMatch2 ? bdMatch2[0] : ''), '')
      .replace(relMatch ? relMatch[0] : '', '')
      .replace(/[,;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!name) {
      await this._sendText(this.chatId, pickRandom([
        'рру?.. 👤 имя? 🐾',
        'ваф?.. кто это? имя! 🐾',
      ]));
      return;
    }

    const saved = this.pes.store.saveContact({
      owner_id: ownerId,
      name,
      phone,
      email,
      birthday,
      birthday_year: birthdayYear,
      relationship,
    });

    const parts = [`👤 ${name}`];
    if (phone) parts.push(`📱 ${phone}`);
    if (email) parts.push(`📧 ${email}`);
    if (birthday) parts.push(`🎂 ${birthday}${birthdayYear ? '.' + birthdayYear : ''}`);
    if (relationship) parts.push(`🤝 ${relationship}`);

    await this._sendText(this.chatId, pickRandom([
      `ваф! 🐾 запомнил!\n${parts.join('\n')}`,
      `тяф! 👤🐾 рру!\n${parts.join('\n')}`,
      `гав! 📋🐾\n${parts.join('\n')}`,
    ]));

    this._addToMemory('owner', `[добавил контакт: ${name}]`);
    this._addToMemory('pes', `[запомнил: ${parts.join(', ')}]`);
    await this._processSmartXP(msg, 'note', 'contact');
    this._updateRelationship('message');
  }

  /**
   * Search contacts and show results.
   */
  async _searchAndShowContact(msg, query) {
    if (!this.pes.store) return;
    const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);
    const contacts = this.pes.store.searchContacts(query, { owner_id: ownerId, limit: 5 });

    if (contacts.length === 0) {
      await this._sendText(this.chatId, pickRandom([
        `скууу... рру?.. не знаю... 💧`,
        `ыыы... хнн... рру?.. 💧🐾`,
      ]));
      this._addToMemory('owner', `[спросил: кто такой ${query}]`);
      this._addToMemory('pes', `[не нашёл контакт: ${query}]`);
      return;
    }

    await this._sendText(this.chatId, pickRandom([
      `ваф! 👤🐾 рру!!`,
      `тяф тяф! 👤 ррРР!! 🐾`,
    ]));

    const lines = [];
    for (const c of contacts) {
      lines.push(`👤 ${c.name}`);
      if (c.phone) lines.push(`  📱 ${c.phone}`);
      if (c.email) lines.push(`  📧 ${c.email}`);
      if (c.birthday) {
        const bd = c.birthday; // MM-DD
        lines.push(`  🎂 ${bd.split('-').reverse().join('.')}${c.birthday_year ? '.' + c.birthday_year : ''}`);
      }
      if (c.relationship) lines.push(`  🤝 ${c.relationship}`);
      if (c.notes) lines.push(`  📝 ${c.notes}`);
      if (contacts.length > 1) lines.push('');
    }

    await this._sendText(this.chatId, lines.join('\n'));
    this._addToMemory('owner', `[спросил: кто такой ${query}]`);
    this._addToMemory('pes', `[нашёл ${contacts.length} контактов: ${query}]`);
    await this._processSmartXP(msg, 'text');
    this._updateRelationship('message');
  }

  /**
   * /contacts command — show all saved contacts.
   */
  async _cmdContacts(msg) {
    if (!this.pes.store) return;
    const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from?.id);
    const contacts = this.pes.store.getAllContacts(ownerId);

    if (contacts.length === 0) {
      await this._sendText(this.chatId, [
        `👤 Контактов пока нет 🐾`,
        ``,
        `Добавь:`,
        `• "запомни контакт: Олег +79161234567 ДР 15.05"`,
        `• Переслать контакт из Telegram`,
        `• /addcontact Имя +phone`,
      ].join('\n'));
      return;
    }

    const lines = [`👤 Контакты (${contacts.length}):`];
    for (const c of contacts) {
      let line = `\n• ${c.name}`;
      if (c.phone) line += ` 📱${c.phone}`;
      if (c.birthday) line += ` 🎂${c.birthday.split('-').reverse().join('.')}`;
      if (c.relationship) line += ` (${c.relationship})`;
      lines.push(line);
    }

    await this._sendText(this.chatId, lines.join(''));
  }

  /**
   * /addcontact Name +phone — quick add.
   */
  async _cmdAddContact(msg, args) {
    if (!args.trim()) {
      await this._sendText(this.chatId, [
        `👤 /addcontact Имя +79161234567`,
        ``,
        `Или: "запомни контакт: Олег +7916... ДР 15.05 друг"`,
      ].join('\n'));
      return;
    }
    await this._parseAndSaveContact(msg, args.trim());
  }

  /**
   * Check birthdays — called from reminder checker (daily).
   * Alerts 1 day before and on the day itself.
   */
  async _checkBirthdays() {
    if (!this.pes.store) return;
    try {
      const due = this.pes.store.getDueBirthdays();
      if (due.length === 0) return;

      const d = new Date();
      const msk = new Date(d.getTime() + 3 * 3600000);
      const todayStr = String(msk.getMonth() + 1).padStart(2, '0') + '-' + String(msk.getDate()).padStart(2, '0');

      for (const c of due) {
        const isToday = c.birthday === todayStr;
        const ageStr = c.birthday_year ? ` (${msk.getFullYear() - c.birthday_year} лет!)` : '';

        if (isToday) {
          await this._sendText(this.chatId, pickRandom([
            `ГАААВ!! 🎂🎉🐾 У ${c.name} СЕГОДНЯ ДЕНЬ РОЖДЕНИЯ${ageStr}!! ваф-ваф-ваф!! 🎈`,
            `тяф тяф!! 🎂🎉 ${c.name} — ДЕНЬ РОЖДЕНИЯ${ageStr}!! ГАААВ!! 🐾🎈`,
          ]));
        } else {
          await this._sendText(this.chatId, pickRandom([
            `тяф! 🎂🐾 Завтра у ${c.name} день рождения${ageStr}! рру~`,
            `ваф! 🎂 ${c.name} — завтра ДР${ageStr}! 🐾`,
          ]));
        }

        this.pes.store.markBirthdayReminded(c.id);
        console.log(`🎂 Birthday alert: ${c.name} (${c.birthday})`);
      }
    } catch (err) {
      console.error('⚠️ Birthday check error:', err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INLINE QUERY — sticker collection in any chat
  // ═══════════════════════════════════════════════════════════

  async _handleInlineQuery(query) {
    try {
      const queryText = (query.query || '').trim().toLowerCase();
      if (!this.pes.store) {
        await this._call('answerInlineQuery', { inline_query_id: query.id, results: [] });
        return;
      }

      const results = [];

      // ── Sharing artifacts via inline mode ──
      if (queryText === 'status' || queryText === 'card' || queryText === 'summary' || queryText.startsWith('note:')) {
        const shareResults = this._buildShareInlineResults(queryText);
        await this._call('answerInlineQuery', {
          inline_query_id: query.id,
          results: shareResults.slice(0, 50),
          cache_time: 5,
          is_personal: true,
        });
        return;
      }

      // ── Main collection pack (priority) + other packs ──
      const mainPack = this.pes.store.getMainCollectionPack();
      const allPacks = this.pes.store.getCreatedPacks();

      // Reorder: main pack first, then others
      const orderedPacks = [];
      if (mainPack) orderedPacks.push(mainPack);
      for (const p of allPacks) {
        if (mainPack && p.pack_name === mainPack.pack_name) continue;
        orderedPacks.push(p);
      }

      for (const pack of orderedPacks.slice(0, 3)) {
        // Skip emoji packs in regular sticker section (they go separately)
        if (pack.pack_type === 'custom_emoji') continue;
        if (queryText && !pack.title.toLowerCase().includes(queryText) && !pack.pack_name.toLowerCase().includes(queryText)) {
          continue;
        }

        try {
          const setInfo = await this._call('getStickerSet', { name: pack.pack_name });
          if (setInfo && setInfo.stickers) {
            const isMain = mainPack && pack.pack_name === mainPack.pack_name;
            for (const stk of setInfo.stickers.slice(0, isMain ? 40 : 15)) {
              const origin = this.pes.store.getStickerOrigin(stk.file_unique_id);
              let replyMarkup;

              if (origin && origin.original_set_name) {
                const title = (origin.original_set_title || origin.original_set_name).slice(0, 30);
                replyMarkup = {
                  inline_keyboard: [[{
                    text: `📦 Из пака «${title}»`,
                    url: `https://t.me/addstickers/${origin.original_set_name}`,
                  }]],
                };
              } else {
                replyMarkup = {
                  inline_keyboard: [[{
                    text: `🎨 «${(pack.title || '').slice(0, 30)}»`,
                    url: `https://t.me/addstickers/${pack.pack_name}`,
                  }]],
                };
              }

              results.push({
                type: 'sticker',
                id: `pack_${pack.id}_${stk.file_unique_id}`,
                sticker_file_id: stk.file_id,
                reply_markup: replyMarkup,
              });

              if (results.length >= 45) break;
            }
          }
        } catch (err) {
          console.error(`⚠️ Inline getStickerSet error for ${pack.pack_name}: ${err.message}`);
          results.push({
            type: 'article',
            id: `pack_${pack.id}`,
            title: `🎨 ${pack.title} (${pack.sticker_count})`,
            description: `Мой пак — ${pack.sticker_count} шт.`,
            input_message_content: {
              message_text: `🎨 ${pack.title}\n📦 ${pack.sticker_count} стикеров\n→ https://t.me/addstickers/${pack.pack_name}`,
            },
          });
        }
      }

      // ── Collection bookmarks (fill remaining slots) ──
      if (results.length < 50) {
        const maxCollection = Math.max(5, 50 - results.length);
        const collection = this.pes.store.getCollection({ query: queryText || null });

        for (const item of collection.slice(0, maxCollection)) {
          const setTitle = item.set_title || item.set_name || 'Без пака';
          const replyMarkup = item.set_name ? {
            inline_keyboard: [[{
              text: `📦 Открыть пак «${setTitle.slice(0, 30)}»`,
              url: `https://t.me/addstickers/${item.set_name}`,
            }]],
          } : undefined;

          results.push({
            type: 'sticker',
            id: `col_${item.id}`,
            sticker_file_id: item.file_id,
            reply_markup: replyMarkup,
          });
        }
      }

      // If empty, show hint
      if (results.length === 0) {
        const hint = mainPack
          ? `📦 Коллекция пуста\n💡 "добавь в пак" + стикер/фото\n→ https://t.me/addstickers/${mainPack.pack_name}`
          : '📦 Коллекция пуста\n💡 /newpack <Название> — создай свою коллекцию!';
        results.push({
          type: 'article',
          id: 'empty_hint',
          title: '📦 Коллекция пуста',
          description: mainPack ? 'Добавь стикеры в пак!' : '/newpack — создай коллекцию!',
          input_message_content: { message_text: hint },
        });
      }

      await this._call('answerInlineQuery', {
        inline_query_id: query.id,
        results: results.slice(0, 50),
        cache_time: 10,
        is_personal: true,
      });

      console.log(`🔍 Inline query "${queryText}" → ${results.length} results (${collection.length} collection)`);
    } catch (err) {
      console.error(`⚠️ Inline query error: ${err.message}`);
      try {
        await this._call('answerInlineQuery', { inline_query_id: query.id, results: [] });
      } catch (_) {}
    }
  }

  /**
   * Parse reminder time from command args.
   * Formats: "30м текст", "2ч текст", "1д текст", "15:30 текст"
   */
  _parseReminderFromCommand(args) {
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) return null;

    const timeStr = parts[0];
    const text = parts.slice(1).join(' ');

    // Duration: 30м, 2ч, 1д
    const durMatch = timeStr.match(/^(\d+)(м|мин|ч|час|д|дн|день|дней)$/i);
    if (durMatch) {
      const val = parseInt(durMatch[1]);
      const unit = durMatch[2].toLowerCase();
      let ms = 0;
      if (unit.startsWith('м')) ms = val * 60 * 1000;
      else if (unit.startsWith('ч')) ms = val * 60 * 60 * 1000;
      else if (unit.startsWith('д')) ms = val * 24 * 60 * 60 * 1000;

      const remindAt = new Date(Date.now() + ms).toISOString();
      return { text, remindAt };
    }

    // Time: 15:30
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const minute = parseInt(timeMatch[2]);
      // Moscow timezone (UTC+3)
      const now = new Date();
      const moscowNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      let target = new Date(moscowNow);
      target.setUTCHours(hour - 3, minute, 0, 0); // convert MSK to UTC
      if (target <= now) target.setDate(target.getDate() + 1); // next day
      return { text, remindAt: target.toISOString() };
    }

    return null;
  }

  /**
   * Parse reminder intent from natural text (via LLM or keywords).
   * Returns { text, remindAt } or null.
   */
  async _detectReminderIntent(text) {
    // Quick keyword check first
    const reminderPatterns = [
      /напомни\s+(через\s+)?(\d+)\s*(мин|минут|час|часа|часов|день|дня|дней)/i,
      /напомни\s+в\s+(\d{1,2}):(\d{2})/i,
      /напоминалк/i,
      /reminder/i,
    ];

    const match1 = text.match(/напомни\s+(?:мне\s+)?(?:через\s+)?(\d+)\s*(мин(?:ут(?:у|ы|ок)?)?|час(?:а|ов)?|день|дн(?:я|ей)?)\s+(.+)/i);
    if (match1) {
      const val = parseInt(match1[1]);
      const unit = match1[2].toLowerCase();
      const reminderText = match1[3].trim();

      let ms = 0;
      if (unit.startsWith('мин')) ms = val * 60 * 1000;
      else if (unit.startsWith('час')) ms = val * 60 * 60 * 1000;
      else if (unit.startsWith('д')) ms = val * 24 * 60 * 60 * 1000;

      if (ms > 0 && reminderText) {
        return { text: reminderText, remindAt: new Date(Date.now() + ms).toISOString() };
      }
    }

    const match2 = text.match(/напомни\s+(?:мне\s+)?в\s+(\d{1,2}):(\d{2})\s+(.+)/i);
    if (match2) {
      const hour = parseInt(match2[1]);
      const minute = parseInt(match2[2]);
      const reminderText = match2[3].trim();
      const now = new Date();
      let target = new Date(now);
      target.setUTCHours(hour - 3, minute, 0, 0); // MSK to UTC
      if (target <= now) target.setDate(target.getDate() + 1);
      return { text: reminderText, remindAt: target.toISOString() };
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // LLM INTENT ROUTER
  // ═══════════════════════════════════════════════════════════

  /**
   * Classify intent using LLM when regex fails.
   * Returns { intent, params, confidence } or null.
   */
  async _classifyIntent(text) {
    if (!this._llm) return null;

    const systemPrompt = `Ты классификатор намерений. Пользователь пишет своему домашнему питомцу-боту.
Определи намерение и извлеки параметры. Ответь ТОЛЬКО JSON, без markdown.

Доступные намерения:
- contact_search: поиск контакта (по имени, телефону). params: { name }
- contact_save: сохранить контакт. params: { name, phone?, email?, birthday?, relationship? }
- note_save: сохранить заметку/запомнить. params: { text }
- note_search: найти заметку/вспомнить. params: { query }
- reminder_create: создать напоминание. params: { text, time? }
- sticker_create: создать стикер из фото/стикера. params: { type: "regular"|"custom_emoji" }
- sticker_add: добавить стикер в пак. params: {}
- packs_list: показать паки стикеров. params: {}
- file_search: найти файл/фото/документ. params: { query }
- file_save: сохранить файл. params: {}
- translate: перевести текст. params: { text, lang? }
- status: статус/как дела. params: {}
- insights: аналитика/инсайты. params: {}
- contacts_list: показать все контакты. params: {}
- help: помощь/команды. params: {}
- silent_toggle: тихий режим. params: {}
- fetch: принеси/найди (игра). params: { target? }
- birthday_query: когда день рождения у X. params: { name }
- note_delete: удалить заметку. params: { query }
- reminders_list: показать напоминания. params: {}
- collection_add: сохранить стикер в коллекцию. params: {}
- collection_remove: убрать стикер из коллекции. params: {}
- collection_list: показать коллекцию стикеров. params: {}
- sticker_origin: откуда стикер, из какого пака, кто автор. params: {}
- mypack: показать мой пак/коллекцию, ссылка на пак. params: {}
- rename_pack: переименовать пак. params: { name }
- create_pack: создать пак/коллекцию. params: { name? }
- create_emoji_pack: создать emoji пак. params: { name? }
- my_emoji: показать emoji пак. params: {}
- gif_sticker: сделать GIF/видео стикер. params: {}
- metronome: метроном/темп/ритм. params: { bpm?, duration? }
- none: не подходит ни одно намерение

Формат ответа:
{"intent":"...","params":{...},"confidence":0.0-1.0}

Примеры:
"номер Олега" → {"intent":"contact_search","params":{"name":"Олег"},"confidence":0.95}
"кинь стикер в пак" → {"intent":"sticker_add","params":{},"confidence":0.9}
"что у меня завтра" → {"intent":"note_search","params":{"query":"завтра"},"confidence":0.85}
"покажи мои стикеры" → {"intent":"packs_list","params":{},"confidence":0.9}
"когда ДР у Маши" → {"intent":"birthday_query","params":{"name":"Маша"},"confidence":0.95}
"тихо" → {"intent":"silent_toggle","params":{},"confidence":0.8}
"удали заметку про встречу" → {"intent":"note_delete","params":{"query":"встречу"},"confidence":0.9}
"напомни позвонить маме" → {"intent":"reminder_create","params":{"text":"позвонить маме"},"confidence":0.9}
"сохрани Олег +79161234567 друг" → {"intent":"contact_save","params":{"name":"Олег","phone":"+79161234567","relationship":"друг"},"confidence":0.95}
"переведи на англ спасибо" → {"intent":"translate","params":{"text":"спасибо","lang":"английский"},"confidence":0.95}
"покажи коллекцию" → {"intent":"collection_list","params":{},"confidence":0.9}
"мои стикеры" → {"intent":"collection_list","params":{},"confidence":0.85}
"сохрани стикер" → {"intent":"collection_add","params":{},"confidence":0.9}
"убери из коллекции" → {"intent":"collection_remove","params":{},"confidence":0.9}
"откуда этот стикер" → {"intent":"sticker_origin","params":{},"confidence":0.9}
"из какого пака" → {"intent":"sticker_origin","params":{},"confidence":0.85}
"мой пак" → {"intent":"mypack","params":{},"confidence":0.9}
"ссылка на пак" → {"intent":"mypack","params":{},"confidence":0.9}
"создай пак Nikich" → {"intent":"create_pack","params":{"name":"Nikich"},"confidence":0.95}
"создай коллекцию" → {"intent":"create_pack","params":{},"confidence":0.9}
"переименуй пак в NewName" → {"intent":"rename_pack","params":{"name":"NewName"},"confidence":0.95}
"создай эмодзи пак" → {"intent":"create_emoji_pack","params":{},"confidence":0.9}
"мои эмодзи" → {"intent":"my_emoji","params":{},"confidence":0.9}
"сделай гифку" → {"intent":"gif_sticker","params":{},"confidence":0.9}
"видео стикер" → {"intent":"gif_sticker","params":{},"confidence":0.85}
"ррр привет лол" → {"intent":"none","params":{},"confidence":0.3}`;

    // Add recent conversation context for follow-ups ("да", "нет", "ещё")
    let userText = text;
    if (text.length < 15 && this._memory && this._memory.length > 0) {
      const recent = this._memory.slice(-4).map(m => `${m.role}: ${m.text}`).join('\n');
      userText = `[Контекст последних сообщений:\n${recent}]\n\nТекущее сообщение: ${text}`;
    }

    try {
      const result = await this._llm.classify(systemPrompt, userText);
      if (!result || !result.intent) return null;
      if (result.confidence < 0.6) return null;
      if (result.intent === 'none') return null;
      console.log(`🧠 LLM Intent: ${result.intent} (${result.confidence}) params:`, JSON.stringify(result.params));
      return result;
    } catch (err) {
      console.error('⚠️ LLM classify error:', err.message);
      return null;
    }
  }

  /**
   * Route a classified intent to the correct handler.
   * Returns true if handled, false if should fall through to generic reply.
   */
  async _routeIntent(msg, intent) {
    const text = msg.text?.trim() || '';
    const p = intent.params || {};

    switch (intent.intent) {
      case 'contact_search':
      case 'birthday_query': {
        const name = p.name || text.replace(/^.*?(номер|контакт|телефон|дн|birthday|когда)\s*/i, '').trim();
        if (name && this.pes.store) {
          await this._searchAndShowContact(msg, name);
          return true;
        }
        return false;
      }

      case 'contact_save': {
        if (this.pes.store) {
          // Build contact string from params
          const parts = [p.name || ''];
          if (p.phone) parts.push(p.phone);
          if (p.email) parts.push(p.email);
          if (p.birthday) parts.push(`ДР ${p.birthday}`);
          if (p.relationship) parts.push(p.relationship);
          await this._parseAndSaveContact(msg, parts.join(' ').trim() || text);
          return true;
        }
        return false;
      }

      case 'contacts_list': {
        await this._cmdContacts(msg);
        return true;
      }

      case 'note_save': {
        if (this.pes.store) {
          const noteText = p.text || text.replace(/^(запомни|запиши|сохрани|заметка)\s*/i, '').trim();
          if (!noteText) return false;
          const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);
          const tags = noteText.replace(/[^\wа-яА-ЯёЁ\s]/g, '').split(/\s+/).filter(w => w.length > 2).slice(0, 10);
          const pinned = /важно|навсегда|не забудь/i.test(text);
          const remindAt = this._extractDateTimeFromNote(noteText);
          this.pes.store.saveNote({ owner_id: ownerId, text: noteText, tags, category: this._guessNoteCategory(noteText), pinned, source_message_id: msg.message_id, remind_at: remindAt });
          await this._sendText(this.chatId, pickRandom([`ваф! 📝🐾${pinned ? ' 📌' : ''} рру~${remindAt ? ' ⏰' : ''}`, `тяф! 📝 ♡${pinned ? ' 📌' : ''} рру~~${remindAt ? ' ⏰' : ''}`, `гав! 📝🐾${pinned ? ' 📌' : ''} ррФФ~${remindAt ? ' ⏰' : ''}`]));
          this._addToMemory('owner', text);
          this._addToMemory('pes', `[запомнил: ${noteText}]`);
          await this._processSmartXP(msg, 'note', 'note');
          this._updateRelationship('message');
          return true;
        }
        return false;
      }

      case 'note_search': {
        if (this.pes.store) {
          const query = p.query || text;
          const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);
          const notes = this.pes.store.searchNotes(query, { owner_id: ownerId, limit: 5 });
          if (notes.length === 0) {
            await this._sendText(this.chatId, pickRandom(['скууу... ыыы... рру?.. 💧', 'рру?... ...ууу... хнн... 💧']));
          } else {
            await this._sendText(this.chatId, pickRandom(['ваф! 📝🐾 рру!!', 'тяф тяф! 📝 ррРР!! 🐾']));
            const lines = notes.map(n => `${n.pinned ? '📌 ' : ''}• ${n.text}`);
            await this._sendText(this.chatId, lines.join('\n'));
          }
          this._addToMemory('owner', `[спросил: ${query}]`);
          this._addToMemory('pes', `[нашёл ${notes.length} заметок]`);
          await this._processSmartXP(msg, 'text');
          this._updateRelationship('message');
          return true;
        }
        return false;
      }

      case 'note_delete': {
        if (this.pes.store) {
          const query = p.query || text;
          const ownerId = this.pes.store.getConfig('owner_id') || String(msg.from.id);
          const notes = this.pes.store.searchNotes(query, { owner_id: ownerId, limit: 1 });
          if (notes.length > 0) {
            this.pes.store.deleteNote(notes[0].id);
            await this._sendText(this.chatId, pickRandom(['ваф! 🗑️🐾 рру~', 'тяф! 🗑️ ♡ ррр~']));
            this._addToMemory('pes', `[удалил заметку: ${notes[0].text}]`);
          } else {
            await this._sendText(this.chatId, pickRandom(['скууу... рру?.. 💧', 'ыыы... хнн... 💧']));
          }
          return true;
        }
        return false;
      }

      case 'reminder_create': {
        if (this.pes.store) {
          const reminderText = p.text || text.replace(/^напомни\s*/i, '').trim();
          if (!reminderText) return false;
          // Try to extract time from params or text
          let remindAt = null;
          if (p.time) {
            remindAt = this._extractDateTimeFromNote(p.time);
          }
          if (!remindAt) {
            remindAt = this._extractDateTimeFromNote(text);
          }
          if (!remindAt) {
            // Default: 1 hour from now
            remindAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
          }
          this.pes.store.createReminder(reminderText, remindAt);
          await this._sendText(this.chatId, pickRandom(['ваф! 📋🐾 рру~ ⏰', 'тяф! 📋 рру~~ ⏰ 🐾', 'гав! 📋🐾 ррФФ~ ⏰']));
          this._addToMemory('owner', text);
          this._addToMemory('pes', `[напоминалка: ${reminderText}]`);
          return true;
        }
        return false;
      }

      case 'reminders_list': {
        await this._cmdReminders(msg);
        return true;
      }

      case 'sticker_create': {
        const createType = (p.type === 'custom_emoji') ? 'custom_emoji' : 'regular';
        this._pendingAddToPack = Date.now();
        this._pendingAddType = createType;
        await this._sendText(this.chatId, pickRandom([
          'тяф! 🎨🐾 ...жду стикер или фото! 📸',
          'ваф! 🖌️🐾 ...пришли стикер или картинку! ✨',
          'рру~~ 🎨 ...давай! стикер! фото! 🐾',
        ]));
        return true;
      }

      case 'sticker_add': {
        this._pendingAddToPack = Date.now();
        this._pendingAddType = 'regular';
        await this._sendText(this.chatId, pickRandom([
          'тяф! 🎨🐾 ...жду стикер или фото! 📸',
          'ваф! 🖌️🐾 ...пришли стикер или картинку! ✨',
        ]));
        return true;
      }

      case 'packs_list': {
        await this._cmdPacks(msg);
        return true;
      }

      case 'collection_list': {
        await this._cmdCollection(msg);
        return true;
      }

      case 'collection_add': {
        // Need a reply to sticker for this to work
        if (msg.reply_to_message?.sticker && this.pes.store) {
          await this._addToCollection(msg, msg.reply_to_message.sticker);
          return true;
        }
        // No sticker to save — tell user
        await this._sendText(this.chatId, pickRandom([
          'тяф! 📦🐾 ...reply на стикер + "сохрани"! 💡',
          'ваф! 📦 ...ответь на стикер чтобы сохранить! 🐾',
        ]));
        return true;
      }

      case 'collection_remove': {
        if (msg.reply_to_message?.sticker && this.pes.store) {
          await this._removeFromCollection(msg, msg.reply_to_message.sticker);
          return true;
        }
        await this._sendText(this.chatId, pickRandom([
          'тяф! 📦🐾 ...reply на стикер + "убери"! 💡',
        ]));
        return true;
      }

      case 'sticker_origin': {
        await this._cmdOrigin(msg);
        return true;
      }

      case 'mypack': {
        await this._cmdMyPack(msg);
        return true;
      }

      case 'create_pack': {
        const name = p.name || '';
        await this._cmdNewPack(msg, name);
        return true;
      }

      case 'create_emoji_pack': {
        const name = p.name || '';
        await this._cmdNewEmojiPack(msg, name);
        return true;
      }

      case 'my_emoji': {
        await this._cmdMyEmojiPack(msg);
        return true;
      }

      case 'gif_sticker': {
        // Set pending for GIF/video sticker creation
        this._pendingAddToPack = Date.now();
        this._pendingAddType = 'regular';
        await this._sendText(this.chatId, pickRandom([
          'тяф! 🎬🐾 ...жду GIF или видео! 📹',
          'ваф! 🎬 ...пришли гифку или видео! 🐾',
        ]));
        return true;
      }

      case 'metronome': {
        const bpm = (p.bpm && parseInt(p.bpm)) || 120;
        const duration = (p.duration && parseInt(p.duration)) || 30;
        await this._sendMetronome(Math.max(40, Math.min(300, bpm)), Math.max(5, Math.min(120, duration)));
        return true;
      }

      case 'rename_pack': {
        const name = p.name || '';
        await this._cmdRenamePack(msg, name);
        return true;
      }

      case 'file_search': {
        await this._handleFileSearch(p.query || text);
        await this._processSmartXP(msg, 'text');
        this._updateRelationship('message');
        return true;
      }

      case 'file_save': {
        await this._sendText(this.chatId, pickRandom([
          'тяф! 📁🐾 ...жду файл! 📎',
          'ваф! 📁 ...пришли файл! 🐾',
        ]));
        return true;
      }

      case 'translate': {
        const sourceText = p.text || text.replace(/^(переведи|translate|перевод)\s*/i, '').trim();
        const lang = p.lang || 'английский';
        if (sourceText) {
          await this._handleTranslation(sourceText, lang);
          await this._processSmartXP(msg, 'command', 'translate');
          this._updateRelationship('message');
          return true;
        }
        return false;
      }

      case 'status': {
        await this._sendStatus();
        return true;
      }

      case 'insights': {
        await this._cmdInsights(msg);
        return true;
      }

      case 'help': {
        await this._cmdHelp(msg);
        return true;
      }

      case 'silent_toggle': {
        await this._cmdSilent(msg);
        return true;
      }

      case 'fetch': {
        const target = p.target || text.replace(/^(принеси|найди|ищи|fetch|find|апорт)\s*/i, '').trim();
        await this._handleFetch(target || 'мячик');
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Extract date/time from a note text for auto-remind.
   * Detects patterns like: "в пятницу", "завтра", "через 2 часа", "в 15:00", "20 марта"
   * Returns ISO-8601 string or null.
   */
  _extractDateTimeFromNote(text) {
    const lower = text.toLowerCase();

    // "через N минут/часов/дней"
    const durationMatch = lower.match(/через\s+(\d+)\s*(мин(?:ут(?:у|ы|ок)?)?|час(?:а|ов)?|дн(?:я|ей)?|день)/);
    if (durationMatch) {
      const val = parseInt(durationMatch[1]);
      const unit = durationMatch[2];
      let ms = 0;
      if (unit.startsWith('мин')) ms = val * 60 * 1000;
      else if (unit.startsWith('час')) ms = val * 60 * 60 * 1000;
      else if (unit.startsWith('д')) ms = val * 24 * 60 * 60 * 1000;
      if (ms > 0) return new Date(Date.now() + ms).toISOString();
    }

    // "в HH:MM"
    const timeMatch = lower.match(/в\s+(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      const hour = parseInt(timeMatch[1]);
      const minute = parseInt(timeMatch[2]);
      const now = new Date();
      let target = new Date(now);
      target.setUTCHours(hour - 3, minute, 0, 0); // MSK to UTC
      if (target <= now) target.setDate(target.getDate() + 1);
      return target.toISOString();
    }

    // Day of week detection
    const dayNames = {
      'понедельник': 1, 'вторник': 2, 'среду': 3, 'среда': 3, 'четверг': 4,
      'пятницу': 5, 'пятница': 5, 'субботу': 6, 'суббота': 6,
      'воскресенье': 0, 'воскресень': 0,
    };
    const dayMatch = lower.match(/в\s+(понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье)/);
    if (dayMatch) {
      const targetDay = dayNames[dayMatch[1]];
      if (targetDay !== undefined) {
        const now = new Date();
        const moscowNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
        const currentDay = moscowNow.getUTCDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) daysUntil += 7;
        const target = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
        target.setUTCHours(9 - 3, 0, 0, 0); // Default: 09:00 MSK
        return target.toISOString();
      }
    }

    // "завтра"
    if (/завтра/.test(lower)) {
      const target = new Date(Date.now() + 24 * 60 * 60 * 1000);
      target.setUTCHours(9 - 3, 0, 0, 0); // 09:00 MSK
      return target.toISOString();
    }

    // "послезавтра"
    if (/послезавтра/.test(lower)) {
      const target = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      target.setUTCHours(9 - 3, 0, 0, 0);
      return target.toISOString();
    }

    return null; // No date/time detected
  }

  /**
   * Check for upcoming note reminders and mention them contextually
   * when owner sends a message. Called from _handleTextMessage.
   */
  async _checkContextualReminders() {
    if (!this.pes.store) return;

    // Don't check too often (max once per 10 min)
    if (this._lastContextualCheck && Date.now() - this._lastContextualCheck < 10 * 60 * 1000) return;
    this._lastContextualCheck = Date.now();

    const upcoming = this.pes.store.getUpcomingNoteReminders(30); // within 30 min
    if (upcoming.length === 0) return;

    // "Bring" the most urgent one
    const urgent = upcoming[0];
    const diffMs = new Date(urgent.remind_at).getTime() - Date.now();
    const mins = Math.round(diffMs / (60 * 1000));

    if (mins <= 0) return; // Will be caught by _checkReminders

    // Dog tugs at owner's sleeve — contextual hint
    await sleep(1000);
    await this._sendText(this.chatId, pickRandom([
      `тяф? рру~! 📋🐾 ...${mins} мин...`,
      `ваф! рру? 📋🐾 ...скоро...`,
      `ррруу~ тяф! 📋🐾 ...${mins} мин...`,
    ]));
    await this._sendText(this.chatId, `📋 ${urgent.text}`);
  }

  /**
   * Format reminder time for display (MSK).
   */
  _formatReminderTime(isoDate) {
    const date = new Date(isoDate);
    const moscowDate = new Date(date.getTime() + 3 * 60 * 60 * 1000);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();

    if (diffMs < 60 * 60 * 1000) {
      const mins = Math.round(diffMs / (60 * 1000));
      return `через ${mins} мин`;
    }
    if (diffMs < 24 * 60 * 60 * 1000) {
      const hours = Math.round(diffMs / (60 * 60 * 1000));
      return `через ${hours}ч`;
    }

    const hh = String(moscowDate.getUTCHours()).padStart(2, '0');
    const mm = String(moscowDate.getUTCMinutes()).padStart(2, '0');
    const dd = String(moscowDate.getUTCDate()).padStart(2, '0');
    const mo = String(moscowDate.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mo} в ${hh}:${mm} (MSK)`;
  }

  /**
   * Start the reminder checker — runs every 30 seconds.
   */
  startReminderChecker() {
    if (this._reminderInterval) return;
    this._reminderInterval = setInterval(() => this._checkReminders(), 30 * 1000);
    console.log('⏰ Reminder checker started (every 30s)');

    // Auto-migrate: set first regular pack as main_collection_pack if not set
    if (this.pes.store && !this.pes.store.getMainCollectionPack()) {
      const packs = this.pes.store.getCreatedPacks('regular');
      if (packs.length > 0) {
        this.pes.store.setMainCollectionPack(packs[0].pack_name);
        console.log(`📦 Auto-set main collection pack: ${packs[0].pack_name} (${packs[0].title})`);
      }
    }
  }

  /**
   * Stop the reminder checker.
   */
  stopReminderChecker() {
    if (this._reminderInterval) {
      clearInterval(this._reminderInterval);
      this._reminderInterval = null;
    }
  }

  /**
   * Check for due reminders AND note reminders — deliver them by "bringing" like a dog.
   * The dog doesn't TELL — it BRINGS the note in its mouth.
   */
  async _checkReminders() {
    if (!this.pes.store) return;

    // 1. Check classic /remind reminders
    const due = this.pes.store.getDueReminders();
    for (const r of due) {
      try {
        await this._bringToOwner(r.text, 'reminder');
        this.pes.store.markReminderDelivered(r.id);
        console.log(`📋 Brought reminder: "${r.text}"`);
      } catch (err) {
        console.error(`⚠️ Failed to bring reminder ${r.id}:`, err.message);
      }
    }

    // 2. Check birthdays (once per cycle, lightweight — getDueBirthdays checks date)
    this._checkBirthdays().catch(err =>
      console.error('⚠️ Birthday check error in reminder loop:', err.message)
    );

    // 3. Check note reminders (запомни ... в пятницу → remind_at)
    const dueNotes = this.pes.store.getDueNoteReminders();
    for (const n of dueNotes) {
      try {
        await this._bringToOwner(n.text, 'note');
        this.pes.store.markNoteReminderSent(n.id);
        console.log(`📋 Brought note: "${n.text}"`);
      } catch (err) {
        console.error(`⚠️ Failed to bring note ${n.id}:`, err.message);
      }
    }
  }

  /**
   * "Bring" something to the owner — like a dog carrying a note in its mouth.
   * Flow: typing pause → sticker → excited sounds → the "object" (note/reminder text)
   * @param {string} text - The content being brought
   * @param {'reminder'|'note'|'file'} type - What kind of object
   */
  async _bringToOwner(text, type = 'note') {
    // 1. "Running" — typing indicator (dog is running to you)
    await this._sendChatAction(this.chatId, 'typing');
    await sleep(1500 + Math.random() * 2000); // 1.5-3.5 sec "running"

    // 2. Sticker — dog carrying something
    await this._sendContextualSticker('greetings');

    // 3. Excited arrival sounds
    const arrivalSounds = [
      `ррРРуу!! тяф-тяф!! 🐾`,
      `ГАВВ!! рруу!! ваф!! 🐾`,
      `ууУУ!! тяф тяф!! рррр!! 🐾`,
      `ваф-ВАФ!! ррруу!! 🐾`,
    ];
    await this._sendText(this.chatId, pickRandom(arrivalSounds));
    await sleep(500);

    // 4. "Drop" the object — the actual content, formatted as a brought item
    const icon = type === 'reminder' ? '⏰' : type === 'file' ? '📂' : '📋';
    await this._sendText(this.chatId, `${icon} ${text}`);
  }


  // ═══════════════════════════════════════════════════════════
  // DEV MODE — Owner↔Orchestrator Bridge
  // ═══════════════════════════════════════════════════════════

  /**
   * /dev — enter dev mode or send a tagged dev request.
   * Usage:
   *   /dev           → enter dev mode (all messages → dev log)
   *   /dev bug ...   → log a bug report
   *   /dev fix ...   → request a fix
   *   /dev ask ...   → ask orchestrator a question
   *   /dev log       → show last 5 dev requests
   *   /exit          → exit dev mode
   */
  async _cmdDev(msg, args) {
    if (!args) {
      // Enter dev mode
      this._devMode = true;
      await this._sendText(this.chatId, [
        `🔧 *DEV MODE — ON*`,
        ``,
        `Все сообщения теперь идут в лог для @orchestrator.`,
        `ПЕС поставлен на паузу.`,
        ``,
        `Команды:`,
        `  /dev bug <текст> — баг-репорт`,
        `  /dev fix <текст> — запрос фикса`,
        `  /dev ask <текст> — вопрос`,
        `  /dev log — последние 5 записей`,
        `  /exit — выйти из dev mode`,
        ``,
        `Или просто пиши — всё пойдёт в лог.`,
      ].join('\n'), { parse_mode: 'Markdown' });
      this._logDevRequest('system', 'DEV MODE ENTERED', msg);
      return;
    }

    const parts = args.split(/\s+/);
    const subCmd = parts[0].toLowerCase();
    const body = parts.slice(1).join(' ');

    switch (subCmd) {
      case 'bug':
        await this._logDevRequest('BUG', body || '(no description)', msg);
        await this._sendText(this.chatId, `🐛 Баг записан. @orchestrator увидит.`);
        break;
      case 'fix':
        await this._logDevRequest('FIX', body || '(no description)', msg);
        await this._sendText(this.chatId, `🔧 Запрос на фикс записан.`);
        break;
      case 'ask':
        await this._logDevRequest('ASK', body || '(no description)', msg);
        await this._sendText(this.chatId, `❓ Вопрос записан. Ответ будет в следующей сессии.`);
        break;
      case 'log':
        await this._showDevLog();
        break;
      default:
        // Treat whole args as a dev message
        await this._logDevRequest('DEV', args, msg);
        await this._sendText(this.chatId, `📝 Записано.`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AGENT CALL MODE
  // ═══════════════════════════════════════════════════════════

  /**
   * /orchestrator [text] or /geratron [text]
   * - Without args: enter agent mode (all messages → live AI chat or tagged log)
   * - With args: quick one-shot message to agent
   */
  async _cmdAgent(msg, agentName, args) {
    const label = agentName === 'orchestrator' ? '🎯' : '⚡';

    if (!args) {
      // Enter agent mode
      this._agentMode = agentName;
      this._devMode = false; // exit dev mode if active
      this._orchestratorHistory = []; // reset conversation on new session

      const isLive = agentName === 'orchestrator' && this._orchestratorLLM;
      await this._sendText(this.chatId, [
        `${label} *@${agentName} — НА СВЯЗИ*`,
        ``,
        isLive
          ? `💬 Живой чат. Пиши — отвечу сразу.`
          : `Все сообщения идут к @${agentName}.`,
        `ПЕС на паузе.`,
        ``,
        `/exit — вернуться к ПЕС`,
      ].join('\n'), { parse_mode: 'Markdown' });
      this._logDevRequest('system', `AGENT MODE: @${agentName}${isLive ? ' (LIVE)' : ''}`, msg);
      return;
    }

    // One-shot message to agent
    if (agentName === 'orchestrator' && this._orchestratorLLM) {
      await this._handleOrchestratorChat(args, msg);
      return;
    }
    await this._logDevRequest(`@${agentName}`, args, msg);
    await this._sendText(this.chatId, `${label} Записано для @${agentName}: «${args.slice(0, 120)}${args.length > 120 ? '...' : ''}»`);
  }

  /**
   * Live orchestrator chat — sends message to GPT-4o and returns response
   */
  async _handleOrchestratorChat(text, msg) {
    // Show typing indicator
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    // Build PES context for orchestrator
    const pesState = this.pes;
    const storeInfo = pesState.store ? {
      level: pesState.store.getConfig('level') || pesState.level,
      xp: pesState.store.getConfig('xp') || 0,
      petName: pesState.store.getConfig('pet_name') || pesState.name,
      stickerCount: pesState.store.getStickerCount?.() || 0,
      noteCount: pesState.store.getNoteCount?.() || 0,
    } : { level: pesState.level, petName: pesState.name };

    const systemPrompt = [
      `Ты — Orchestrator, AI-помощник проекта ПЕС (Питомец-Единая-Система).`,
      `Ты общаешься напрямую с хозяином через Telegram бот @HoleThor_Bot.`,
      ``,
      `КОНТЕКСТ:`,
      `- ПЕС "${storeInfo.petName}" — Level ${storeInfo.level}, ${storeInfo.stickerCount || '?'} стикеров`,
      `- Проект: 113% BEYOND — система уникальных цифровых питомцев`,
      `- Каждый ПЕС уникален: свои звуки, характер, эмоции`,
      `- Бот работает в Telegram, общается стикерами + звуками (babble engine)`,
      ``,
      `ТВОЯ РОЛЬ:`,
      `- Помогаешь хозяину с любыми вопросами по ПЕС и проекту`,
      `- Диагностируешь проблемы других животных (будущее)`,
      `- Даёшь рекомендации по развитию, фичам, обучению`,
      `- Отвечаешь на русском (или на языке вопроса)`,
      `- Кратко и по делу, но дружелюбно`,
      ``,
      `ВАЖНО:`,
      `- Ты НЕ ПЕС. Ты Orchestrator — отдельная сущность.`,
      `- Не используй babble/звуки. Говори нормальным языком.`,
      `- Можешь использовать emoji для акцентов.`,
      `- Если не знаешь — честно скажи, не выдумывай.`,
    ].join('\n');

    // Add user message to history
    this._orchestratorHistory.push({ role: 'user', content: text });

    // Trim history if too long
    if (this._orchestratorHistory.length > this._orchestratorHistoryLimit) {
      this._orchestratorHistory = this._orchestratorHistory.slice(-this._orchestratorHistoryLimit);
    }

    try {
      const response = await this._orchestratorLLM.generate(systemPrompt, this._orchestratorHistory);

      if (response) {
        // Save assistant response to history
        this._orchestratorHistory.push({ role: 'assistant', content: response });

        // Split long messages (Telegram limit ~4096)
        if (response.length > 4000) {
          const chunks = [];
          let remaining = response;
          while (remaining.length > 0) {
            const chunk = remaining.slice(0, 4000);
            const lastNewline = chunk.lastIndexOf('\n');
            const splitAt = lastNewline > 3000 ? lastNewline : 4000;
            chunks.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trim();
          }
          for (const chunk of chunks) {
            await this._sendText(this.chatId, `🎯 ${chunk}`);
          }
        } else {
          await this._sendText(this.chatId, `🎯 ${response}`);
        }
      } else {
        await this._sendText(this.chatId, `🎯 _Не удалось получить ответ. Попробуй ещё раз._`, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error('Orchestrator LLM error:', err.message);
      await this._sendText(this.chatId, `🎯 ⚠️ Ошибка: ${err.message.slice(0, 200)}`);
    }
  }

  /**
   * Shadow Orchestrator — responds inline when triggered by keyword.
   * PES does NOT pause. Orchestrator uses shadow buffer for context.
   */
  // ═══════════════════════════════════════════════════════════
  // CRM BRIDGE v2 — Bidirectional CRM Access Through Chat
  // ═══════════════════════════════════════════════════════════

  /**
   * Detect CRM intent and route to handler.
   * Returns true if handled, false if not a CRM command.
   */
  async _handleCrmIntent(msg, text) {
    // ── CRM READ patterns ──
    const showTablesMatch = /^(покажи таблицы|мои таблицы|таблицы|tables|crm таблицы|что есть в crm|show tables)/i.test(text);
    const searchMatch = text.match(/^(найди в crm|поищи в crm|crm поиск|crm search|crm найди|искать в crm)\s+(.+)/i);
    const showRowsMatch = text.match(/^(покажи|открой|show)\s+(таблицу|table)\s+(.+)/i);
    const queryMatch = text.match(/^(что у меня|мои дела|мои задачи|мои тикеты|my tasks|my tickets|что на сегодня|что сегодня)/i);
    const crmFindMatch = text.match(/^(найди|поищи|search|find)\s+(контакт|клиент|задачу|тикет|запись|contact|client|ticket|record|entry)\s+(.+)/i);

    // ── CRM WRITE patterns ──
    const createMatch = text.match(/^(создай|добавь|create|add)\s+(в таблицу|в|to|into)\s+(.+?)[\s:]+(.+)/i);
    const quickCreateMatch = text.match(/^(создай|добавь|create|add)\s+(тикет|задачу|ticket|task|запись|record)\s+(.+)/i);

    // Route to handlers
    if (showTablesMatch) return this._crmShowTables(msg);
    if (searchMatch) return this._crmSearch(msg, searchMatch[2].trim());
    if (showRowsMatch) return this._crmShowRows(msg, showRowsMatch[3].trim());
    if (queryMatch) return this._crmMyTasks(msg);
    if (crmFindMatch) return this._crmFindEntity(msg, crmFindMatch[2].trim(), crmFindMatch[3].trim());
    if (createMatch) return this._crmCreateRow(msg, createMatch[3].trim(), createMatch[4].trim());
    if (quickCreateMatch) return this._crmQuickCreate(msg, quickCreateMatch[2].trim(), quickCreateMatch[3].trim());

    return false;
  }

  /**
   * Check if PES has unlocked a CRM feature. Shows "locked" message if not.
   */
  _checkCrmUnlock(feature) {
    if (!this.pes?.store) return false;
    const level = this.pes.level || 0;
    const requiredLevels = { crm_read: 8, crm_write: 10, analytics: 12, crm_tasks: 15 };
    const required = requiredLevels[feature] || 8;
    return level >= required;
  }

  async _crmLocked(msg, feature) {
    const requiredLevels = { crm_read: 8, crm_write: 10, analytics: 12, crm_tasks: 15 };
    const required = requiredLevels[feature] || 8;
    const current = this.pes?.level || 0;
    await this._sendText(this.chatId, pickRandom([
      `скууу... 🔒🐾 ыыы... рру~~ (Level ${required})`,
      `хнн... 🔒 рру?.. ууу... 🐾 (Level ${required})`,
    ]));
    this._addToMemory('pes', `[CRM ${feature} заблокирован — нужен Level ${required}, сейчас ${current.toFixed(1)}]`);
    return true;
  }

  /**
   * Show all tables in the space.
   */
  async _crmShowTables(msg) {
    if (!this._checkCrmUnlock('crm_read')) return this._crmLocked(msg, 'crm_read');
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    const tables = await this._crm.getTables();
    if (!tables || !tables.length) {
      await this._sendText(this.chatId, `рру?.. 📋💧 ...пусто...`);
      return true;
    }

    // Sound first, then data
    await this._sendText(this.chatId, pickRandom([
      `ваф! 📋🐾 рру!!`,
      `тяф! 📋 ррРР!! 🐾`,
    ]));

    const lines = tables.map(t => `• ${t.display_name || t.name} (ID: ${t.id})`);
    await this._sendText(this.chatId, lines.join('\n'));

    this._addToMemory('owner', `[спросил: покажи таблицы]`);
    this._addToMemory('pes', `[показал ${tables.length} таблиц из CRM]`);
    await this._processSmartXP(msg, 'command', 'crm_read');
    this._updateRelationship('message');
    this.pes.event({ type: 'command_learned', from: msg.from?.id, data: 'crm_tables' });
    return true;
  }

  /**
   * Search across CRM tables.
   */
  async _crmSearch(msg, query) {
    if (!this._checkCrmUnlock('crm_read')) return this._crmLocked(msg, 'crm_read');
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    const results = await this._crm.searchAll(query);
    if (!results.length) {
      await this._sendText(this.chatId, pickRandom([
        `скууу... 🔍💧 ыыы... рру?..`,
        `рру?.. 🔍 ...ууу... хнн... 💧`,
      ]));
      this._addToMemory('pes', `[искал "${query}" в CRM — не нашёл]`);
      return true;
    }

    await this._sendText(this.chatId, pickRandom([
      `ваф! 🔍🐾 рру!! НАШЁЛ!`,
      `тяф тяф! 🔍 ррРР!! 🐾`,
    ]));

    for (const r of results) {
      const header = `📋 **${r.table}**:`;
      const formatted = this._crm.formatRows(r.rows, 4);
      await this._sendText(this.chatId, `${header}\n${formatted}`, { parse_mode: 'Markdown' });
    }

    this._addToMemory('owner', `[искал в CRM: ${query}]`);
    this._addToMemory('pes', `[нашёл в ${results.length} таблицах по запросу "${query}"]`);
    await this._processSmartXP(msg, 'command', 'crm_search');
    this._updateRelationship('message');
    return true;
  }

  /**
   * Show rows from a specific table.
   */
  async _crmShowRows(msg, tableName) {
    if (!this._checkCrmUnlock('crm_read')) return this._crmLocked(msg, 'crm_read');
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    const table = await this._crm.findTable(tableName);
    if (!table) {
      await this._sendText(this.chatId, pickRandom([
        `рру?.. 📋💧 ...не знаю такую таблицу...`,
        `хнн... 📋 рру?.. ууу... 💧`,
      ]));
      return true;
    }

    const rows = await this._crm.getRows(table.id, { limit: 10 });
    await this._sendText(this.chatId, pickRandom([
      `ваф! 📋🐾 рру!!`,
      `тяф! 📋 ррРР!! 🐾`,
    ]));

    const formatted = this._crm.formatRows(rows, 5);
    await this._sendText(this.chatId, `📋 **${table.display_name || table.name}** (${rows.length} записей):\n\n${formatted}`, { parse_mode: 'Markdown' });

    this._addToMemory('pes', `[показал таблицу ${table.name}: ${rows.length} записей]`);
    await this._processSmartXP(msg, 'command', 'crm_show');
    this._updateRelationship('message');
    return true;
  }

  /**
   * Show user's tasks/tickets.
   */
  async _crmMyTasks(msg) {
    if (!this._checkCrmUnlock('crm_read')) return this._crmLocked(msg, 'crm_read');
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    // Search in Tickets table (ID: 1708)
    const rows = await this._crm.getRows(1708, { limit: 10 });
    if (!rows.length) {
      await this._sendText(this.chatId, pickRandom([
        `ваф! 📋✨ рру~~ ...всё чисто! 🐾`,
        `тяф! ✨ ррррр~ ...нет задач! 🐾`,
      ]));
      return true;
    }

    await this._sendText(this.chatId, pickRandom([
      `ваф! 📋🐾 рру!!`,
      `тяф! 📋 ррРР!! 🐾`,
    ]));

    const formatted = this._crm.formatRows(rows, 5);
    await this._sendText(this.chatId, `📋 **Тикеты:**\n\n${formatted}`, { parse_mode: 'Markdown' });

    this._addToMemory('pes', `[показал ${rows.length} тикетов]`);
    await this._processSmartXP(msg, 'command', 'crm_tasks');
    this._updateRelationship('message');
    return true;
  }

  /**
   * Find a specific entity type in CRM.
   */
  async _crmFindEntity(msg, entityType, query) {
    if (!this._checkCrmUnlock('crm_read')) return this._crmLocked(msg, 'crm_read');
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    // Map entity type to table
    const tableMap = {
      'контакт': null, 'клиент': null, 'contact': null, 'client': null,
      'задачу': 'tickets', 'тикет': 'tickets', 'ticket': 'tickets', 'task': 'tickets',
      'запись': null, 'record': null, 'entry': null,
    };
    const tableName = tableMap[entityType.toLowerCase()];

    let results;
    if (tableName) {
      const table = await this._crm.findTable(tableName);
      if (table) {
        const rows = await this._crm.getRows(table.id, { search: query, limit: 10 });
        results = rows.length ? [{ table: table.name, rows }] : [];
      } else {
        results = await this._crm.searchAll(query, { maxTables: 3, maxRows: 5 });
      }
    } else {
      // Search across all tables
      results = await this._crm.searchAll(query, { maxTables: 5, maxRows: 5 });
    }

    if (!results || !results.length) {
      await this._sendText(this.chatId, pickRandom([
        `скууу... 🔍💧 рру?..`,
        `хнн... 🔍 ...ууу... 💧`,
      ]));
      return true;
    }

    await this._sendText(this.chatId, pickRandom([
      `ваф! 🔍🐾 НАШЁЛ! рру!!`,
      `тяф! 🔍 ррРР!! 🐾`,
    ]));

    for (const r of results) {
      const formatted = this._crm.formatRows(r.rows, 5);
      await this._sendText(this.chatId, `📋 **${r.table}**:\n${formatted}`, { parse_mode: 'Markdown' });
    }

    this._addToMemory('pes', `[нашёл "${query}" — ${entityType}]`);
    await this._processSmartXP(msg, 'command', 'crm_find');
    this._updateRelationship('message');
    return true;
  }

  /**
   * Create a row in a specific table.
   */
  async _crmCreateRow(msg, tableName, dataStr) {
    if (!this._checkCrmUnlock('crm_write')) return this._crmLocked(msg, 'crm_write');
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    const table = await this._crm.findTable(tableName);
    if (!table) {
      await this._sendText(this.chatId, `рру?.. 📋💧 ...не знаю таблицу "${tableName}"...`);
      return true;
    }

    // Get columns to understand schema
    const columns = await this._crm.getColumns(table.id);
    if (!columns.length) {
      await this._sendText(this.chatId, `хнн... 📋💧 ...таблица пустая...`);
      return true;
    }

    // Use LLM to parse the free-text data string into structured fields
    const data = await this._crmParseDataWithLLM(dataStr, columns);
    if (!data) {
      // Fallback: put everything in the first text column
      const textCol = columns.find(c => c.type === 'text' || c.type === 'string' || c.name === 'name' || c.name === 'title');
      if (textCol) {
        const created = await this._crm.createRow(table.id, { [textCol.name]: dataStr });
        if (created) {
          await this._sendText(this.chatId, pickRandom([
            `ваф! ✅🐾 рру!! СОЗДАЛ!`,
            `тяф! ✅ ррРР!! 🐾`,
          ]));
          this.pes.event({ type: 'command_learned', from: msg.from?.id, data: 'crm_create' });
        } else {
          await this._sendText(this.chatId, `хнн... ❌ рру?.. ошибка... 💧`);
        }
        return true;
      }
      await this._sendText(this.chatId, `хнн... ❌ рру?.. не понял данные... 💧`);
      return true;
    }

    const created = await this._crm.createRow(table.id, data);
    if (created) {
      await this._sendText(this.chatId, pickRandom([
        `ваф! ✅🐾 рру!! СОЗДАЛ!`,
        `тяф! ✅ ррРР!! 🐾 ГОТОВО!`,
      ]));
      this._addToMemory('pes', `[создал запись в ${table.name}: ${dataStr.slice(0, 100)}]`);
      await this._processSmartXP(msg, 'command', 'crm_create');
      this._updateRelationship('message');
      this.pes.event({ type: 'command_learned', from: msg.from?.id, data: 'crm_create' });
    } else {
      await this._sendText(this.chatId, `хнн... ❌ рру?.. ошибка создания... 💧`);
    }
    return true;
  }

  /**
   * Quick create: "создай тикет bug with login" → create in Tickets table.
   */
  async _crmQuickCreate(msg, entityType, dataStr) {
    if (!this._checkCrmUnlock('crm_write')) return this._crmLocked(msg, 'crm_write');
    this._sendChatAction(this.chatId, 'typing').catch(() => {});

    const entityTableMap = {
      'тикет': 1708, 'задачу': 1708, 'ticket': 1708, 'task': 1708,
      'запись': null, 'record': null,
    };

    let tableId = entityTableMap[entityType.toLowerCase()];
    if (!tableId) {
      // Try to find table by name
      const table = await this._crm.findTable(entityType);
      if (table) tableId = table.id;
    }

    if (!tableId) {
      await this._sendText(this.chatId, `рру?.. не знаю куда добавить "${entityType}"... 💧`);
      return true;
    }

    // Get columns and try to map
    const columns = await this._crm.getColumns(tableId);
    const data = await this._crmParseDataWithLLM(dataStr, columns);

    if (!data) {
      // Fallback: first text column
      const textCol = columns.find(c =>
        c.type === 'text' || c.type === 'string' || c.name === 'name' || c.name === 'title'
      );
      if (textCol) {
        const created = await this._crm.createRow(tableId, { [textCol.name]: dataStr });
        if (created) {
          await this._sendText(this.chatId, pickRandom([
            `ваф! ✅🐾 рру!! СОЗДАЛ!`,
            `тяф! ✅ ррРР!! 🐾`,
          ]));
          this.pes.event({ type: 'command_learned', from: msg.from?.id, data: 'crm_create' });
        }
        return true;
      }
    }

    const created = await this._crm.createRow(tableId, data || { title: dataStr });
    if (created) {
      await this._sendText(this.chatId, pickRandom([
        `ваф! ✅🐾 рру!! СОЗДАЛ ${entityType}!`,
        `тяф! ✅ ррРР!! 🐾 ${entityType} ГОТОВ!`,
      ]));
      this._addToMemory('pes', `[создал ${entityType}: ${dataStr.slice(0, 100)}]`);
      await this._processSmartXP(msg, 'command', 'crm_create');
      this._updateRelationship('message');
      this.pes.event({ type: 'command_learned', from: msg.from?.id, data: 'crm_create' });
    } else {
      await this._sendText(this.chatId, `хнн... ❌ рру?.. ошибка... 💧`);
    }
    return true;
  }

  /**
   * Use LLM to parse free-text data into structured fields based on column schema.
   */
  async _crmParseDataWithLLM(dataStr, columns) {
    if (!this._llm || !columns.length) return null;
    const colInfo = columns
      .filter(c => c.name !== 'id' && !c.name.startsWith('_'))
      .slice(0, 15)
      .map(c => `${c.name} (${c.type})`)
      .join(', ');

    try {
      const prompt = `Parse this text into JSON fields for a database table.
Columns: ${colInfo}
Text: "${dataStr}"
Return ONLY valid JSON object with matching column names. Example: {"title": "value", "status": "new"}
If unsure about a field, skip it. Always include the most important field (name/title).`;

      const response = await this._llm.generate(prompt, [{ role: 'user', content: dataStr }]);
      if (!response) return null;

      // Extract JSON from response
      const jsonMatch = response.match(/\{[^}]+\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('[CRM] LLM parse error:', err.message);
    }
    return null;
  }

  async _handleShadowOrchestratorCall(text, msg) {
    const chatId = msg.chat?.id || this.chatId;
    console.log(`🎯 [SHADOW] Step 1: Starting. chatId=${chatId}, text="${text.slice(0, 60)}"`);

    this._sendChatAction(chatId, 'typing').catch(() => {});

    const pesState = this.pes;
    const storeInfo = pesState.store ? {
      level: pesState.store.getConfig('level') || pesState.level,
      xp: pesState.store.getConfig('xp') || 0,
      petName: pesState.store.getConfig('pet_name') || pesState.name,
      stickerCount: pesState.store.getStickerCount?.() || 0,
    } : { level: pesState.level, petName: pesState.name };

    // Build recent context from shadow buffer
    const recentMessages = this._shadowBuffer.slice(-20).map(m => {
      const ago = Math.round((Date.now() - m.ts) / 60000);
      return `[${ago}m ago] ${m.role}: ${m.content}`;
    }).join('\n');

    // Build knowledge context from stored data
    let knowledgeContext = '';
    if (pesState.store) {
      try {
        const ownerId = pesState.store.getConfig('owner_id') || String(msg.from?.id || this.chatId);
        // Recent notes
        const notes = pesState.store.searchNotes('', { owner_id: ownerId, limit: 10 });
        if (notes.length > 0) {
          knowledgeContext += `\nЗАМЕТКИ ХОЗЯИНА (${notes.length}):\n`;
          for (const n of notes) {
            knowledgeContext += `- ${n.pinned ? '📌 ' : ''}${n.text}\n`;
          }
        }
        // Contacts
        const contacts = pesState.store.searchContacts?.(ownerId, '');
        if (contacts?.length > 0) {
          knowledgeContext += `\nКОНТАКТЫ (${contacts.length}):\n`;
          for (const c of contacts) {
            const parts = [c.name];
            if (c.phone) parts.push(c.phone);
            if (c.relationship) parts.push(`(${c.relationship})`);
            knowledgeContext += `- ${parts.join(' ')}\n`;
          }
        }
        // Pending reminders
        const reminders = pesState.store.getPendingReminders?.();
        if (reminders?.length > 0) {
          knowledgeContext += `\nАКТИВНЫЕ НАПОМИНАНИЯ (${reminders.length}):\n`;
          for (const r of reminders) {
            knowledgeContext += `- ⏰ ${r.text} (${this._formatReminderTime(r.remind_at)})\n`;
          }
        }
        // Context summary
        if (this._contextSummary) {
          knowledgeContext += `\nКОНТЕКСТ ПРОШЛЫХ РАЗГОВОРОВ:\n${this._contextSummary}\n`;
        }
      } catch (err) {
        console.error('⚠️ Shadow knowledge context error:', err.message);
      }
    }

    const systemPrompt = [
      `Ты — Shadow Orchestrator проекта ПЕС (113% BEYOND).`,
      `Ты ВСЕГДА наблюдаешь за чатом. Хозяин вызвал тебя ключевым словом.`,
      ``,
      `ПЕС "${storeInfo.petName}" — Level ${storeInfo.level}, ${storeInfo.stickerCount || '?'} стикеров`,
      ``,
      `ТЕКУЩАЯ ФАЗА: Создание ЯДРА и наполнение интерфейса.`,
      `Задача — наполнить интерфейс функционалом, фиксить проблемы, развивать систему.`,
      knowledgeContext ? `\n━━ БАЗА ЗНАНИЙ ПЕС ━━${knowledgeContext}` : '',
      ``,
      `ПОСЛЕДНИЕ СООБЩЕНИЯ В ЧАТЕ:`,
      recentMessages,
      ``,
      `ПРАВИЛА:`,
      `- Отвечай кратко и по делу`,
      `- Ты видишь ВСЁ что происходит в чате`,
      `- У тебя есть доступ к заметкам, контактам и напоминаниям хозяина`,
      `- Если спрашивают "что я записывал" / "мои контакты" — отвечай из базы знаний выше`,
      `- Если просят фикс/диагноз — анализируй на основе контекста`,
      `- После ответа ПЕС продолжит работать как обычно`,
      `- Используй 🎯 как свой маркер`,
      `- Отвечай на русском`,
      ``,
      `ФОРМАТ ОТВЕТА ПРИ ВЗЯТИИ ЗАДАЧИ:`,
      `Когда берёшь задачу, ВСЕГДА пиши в таком формате:`,
      ``,
      `🎯 ЗАДАЧА: [краткое описание]`,
      `⏱ ВРЕМЯ: ~[X минут/часов]`,
      ``,
      `📋 ШАГИ:`,
      `1. [шаг] — [описание]`,
      `2. [шаг] — [описание]`,
      `...`,
      ``,
      `▶️ Начинаю. Не отвлекай пока не отпишусь.`,
      ``,
      `Когда задача завершена:`,
      `✅ ГОТОВО: [что сделано]`,
      `📊 РЕЗУЛЬТАТ: [что изменилось]`,
    ].filter(Boolean).join('\n');

    // Use orchestrator history for continuity (keep only user messages to avoid stale data)
    this._orchestratorHistory.push({ role: 'user', content: text });
    if (this._orchestratorHistory.length > this._orchestratorHistoryLimit) {
      this._orchestratorHistory = this._orchestratorHistory.slice(-this._orchestratorHistoryLimit);
    }

    console.log(`🎯 [SHADOW] Step 2: Calling LLM (history=${this._orchestratorHistory.length} msgs)...`);
    const t0 = Date.now();

    try {
      const response = await this._orchestratorLLM.generate(systemPrompt, this._orchestratorHistory);
      const elapsed = Date.now() - t0;
      console.log(`🎯 [SHADOW] Step 3: LLM responded in ${elapsed}ms, length=${response?.length || 0}`);

      if (response) {
        this._orchestratorHistory.push({ role: 'assistant', content: response });
        const prefix = '🎯 ';
        if (response.length > 4000) {
          const chunks = [];
          let remaining = response;
          while (remaining.length > 0) {
            const splitAt = Math.min(4000, remaining.lastIndexOf('\n', 4000) > 3000 ? remaining.lastIndexOf('\n', 4000) : 4000);
            chunks.push(remaining.slice(0, splitAt));
            remaining = remaining.slice(splitAt).trim();
          }
          for (const chunk of chunks) {
            await this._sendText(chatId, `${prefix}${chunk}`);
          }
        } else {
          await this._sendText(chatId, `${prefix}${response}`);
        }
        console.log(`🎯 [SHADOW] Step 4: Response sent to Telegram ✅`);
      } else {
        console.log(`🎯 [SHADOW] Step 3b: LLM returned null after ${elapsed}ms`);
        await this._sendText(chatId, `🎯 Не получил ответ от LLM. Попробуй ещё.`);
      }
    } catch (err) {
      const elapsed = Date.now() - t0;
      console.error(`🎯 [SHADOW] ERROR after ${elapsed}ms:`, err.message, err.stack);
      try {
        await this._sendText(chatId, `🎯 ⚠️ Ошибка: ${err.message.slice(0, 200)}`);
      } catch (sendErr) {
        console.error(`🎯 [SHADOW] SEND ERROR:`, sendErr.message);
      }
    }
  }

  async _cmdDevExit(msg) {
    if (!this._devMode && !this._agentMode) {
      await this._sendText(this.chatId, `ℹ️ Никакой режим не активен.`);
      return;
    }
    const wasAgent = this._agentMode;
    this._devMode = false;
    this._agentMode = null;
    this._logDevRequest('system', wasAgent ? `AGENT MODE @${wasAgent} EXITED` : 'DEV MODE EXITED', msg);
    await this._sendText(this.chatId, [
      `✅ ${wasAgent ? `@${wasAgent}` : 'Dev mode'} OFF — ПЕС снова активен!`,
      `${this.pes.name}: ваф! тяф тяф!! 🐾`,
    ].join('\n'), { parse_mode: 'Markdown' });
    // Wake PES up if sleeping
    if (!this.pes.isAwake && this.pes.isAlive) {
      this.pes.wake();
    }
  }

  /**
   * Log a dev request to dev-requests.log
   */
  _logDevRequest(tag, text, msg) {
    if (!existsSync(DEV_LOG_DIR)) mkdirSync(DEV_LOG_DIR, { recursive: true });

    const ts = new Date().toISOString();
    const from = msg?.from?.username || msg?.from?.first_name || 'owner';
    const line = `[${ts}] [${tag.toUpperCase()}] @${from}: ${text}\n`;

    try {
      appendFileSync(DEV_LOG_FILE, line);
    } catch (e) {
      console.error('Failed to write dev log:', e.message);
    }

    // Also log to main console/pm2 logs
    console.log(`[DEV] [${tag}] ${text}`);

    // Confirm receipt in chat if it's a freeform message in dev mode
    if (this._devMode && tag === 'message') {
      this._sendText(this.chatId, `📝 «${text.slice(0, 100)}${text.length > 100 ? '...' : ''}»`);
    }
  }

  async _showDevLog() {
    try {
      const { readFileSync } = await import('node:fs');
      const content = readFileSync(DEV_LOG_FILE, 'utf8');
      const lines = content.trim().split('\n');
      const last5 = lines.slice(-5);

      if (last5.length === 0) {
        await this._sendText(this.chatId, `📋 Лог пуст.`);
        return;
      }

      const formatted = last5.map(l => {
        // Parse [ts] [TAG] @user: text
        const m = l.match(/\[(.+?)\] \[(.+?)\] @(.+?): (.+)/);
        if (!m) return l;
        const [, ts, tag, , text] = m;
        const time = new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        return `${time} [${tag}] ${text}`;
      });

      await this._sendText(this.chatId, `📋 Последние записи:\n\n${formatted.join('\n')}`);
    } catch {
      await this._sendText(this.chatId, `📋 Лог пуст.`);
    }
  }


  // ═══════════════════════════════════════════════════════════
  // STICKER MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  /**
   * Load stickers from a Telegram sticker pack.
   * Maps stickers to internal PES emotion keys.
   *
   * @param {string} packName — Telegram sticker pack name
   * @param {Object} [mapping] — { stickerIndex: emotionKey }
   *   If empty, auto-maps by sticker emoji.
   */
  async loadStickerPack(packName, mapping = null, additive = false) {
    const pack = await this._getStickerSet(packName);

    if (!pack || !pack.stickers || pack.stickers.length === 0) {
      throw new Error(`Sticker pack "${packName}" is empty or not found`);
    }

    const finalMapping = mapping || this._stickerMapping || {};
    const hasExplicitMapping = Object.keys(finalMapping).length > 0;

    // Only clear when not additive (first pack load)
    if (!additive) {
      this.media[MEDIA_TYPE.STICKER] = {};
      this._stickerFileIds = [];
      this._stickerEmotionIndex = {};
    }

    for (let i = 0; i < pack.stickers.length; i++) {
      const sticker = pack.stickers[i];
      const fileId = sticker.file_id;
      this._stickerFileIds.push(fileId);

      if (hasExplicitMapping) {
        // Explicit: index → emotionKey
        const key = finalMapping[i];
        if (key) {
          this.registerMedia(MEDIA_TYPE.STICKER, key, fileId);
          if (!this._stickerEmotionIndex[key]) this._stickerEmotionIndex[key] = [];
          this._stickerEmotionIndex[key].push(fileId);
        }
      } else {
        // Auto-map by emoji
        const emoji = sticker.emoji || '';
        const autoKey = this._emojiToEmotionKey(emoji);
        if (autoKey) {
          this.registerMedia(MEDIA_TYPE.STICKER, autoKey, fileId);
          if (!this._stickerEmotionIndex[autoKey]) this._stickerEmotionIndex[autoKey] = [];
          this._stickerEmotionIndex[autoKey].push(fileId);
        }
        // Also register by index
        this.registerMedia(MEDIA_TYPE.STICKER, `pack_${i}`, fileId);
      }
    }

    this._currentStickerPack = packName;
    this.emit('stickerPackLoaded', { pack: packName, count: pack.stickers.length });
  }

  /**
   * Map a sticker emoji to internal emotion key (best-effort).
   */
  _emojiToEmotionKey(emoji) {
    const map = {
      '😊': 'happy',    '😃': 'happy',     '😄': 'happy',     '🥰': 'happy',
      '😂': 'playful',  '🤣': 'playful',   '😆': 'playful',
      '😢': 'sad',      '😭': 'sad',       '🥺': 'puppy_eyes',
      '😡': 'rage',     '🤬': 'rage',      '😠': 'grumble',
      '😱': 'scared',   '😰': 'anxious',   '😨': 'scared',
      '😴': 'sleeping', '💤': 'sleeping',   '😪': 'nap',
      '🤔': 'confused', '🧐': 'puzzle_solving',
      '❤️': 'love',    '💕': 'love',       '😍': 'love',
      '🔥': 'excited',  '⚡': 'alert',
      '🎉': 'celebration', '🎊': 'celebration',
      '🐾': 'default',  '🐕': 'default',   '🐶': 'default',
      '😋': 'food_obsessed', '🤤': 'food_obsessed',
      '😤': 'stubborn_refuse', '💪': 'brave',
    };
    return map[emoji] || null;
  }

  /**
   * Get current sticker pack name.
   */
  get currentStickerPack() {
    return this._currentStickerPack;
  }


  // ═══════════════════════════════════════════════════════════
  // RENDER (override base for Telegram-specific)
  // ═══════════════════════════════════════════════════════════

  /**
   * Format bodyKey → Telegram sticker file_id.
   */
  formatBody(bodyKey, result) {
    if (!bodyKey) return null;

    // Direct body key lookup
    let sticker = this.getMedia(MEDIA_TYPE.STICKER, bodyKey);
    if (sticker) return sticker;

    // Map body key to emotion via DEFAULT_STICKER_EMOTION_MAP
    const emotionKey = DEFAULT_STICKER_EMOTION_MAP[bodyKey];
    if (emotionKey) {
      sticker = this.getMedia(MEDIA_TYPE.STICKER, emotionKey);
      if (sticker) return sticker;
    }

    // Try emotion from snapshot
    const emotion = result?.emotionSnapshot?.state;
    if (emotion) {
      sticker = this.getMedia(MEDIA_TYPE.STICKER, emotion);
      if (sticker) return sticker;
    }

    // Fallback: default sticker
    sticker = this.getMedia(MEDIA_TYPE.STICKER, 'default');
    if (sticker) return sticker;

    // No sticker available — return null (text-only mode)
    return null;
  }

  /**
   * Format voiceKey → text description (Telegram has no sound).
   */
  formatVoice(voiceKey, result) {
    if (!voiceKey) return null;
    // Return text representation from expression
    return result?.expression?.renderVoice?.() || null;
  }

  /**
   * Format glyphKeys → emoji chain text.
   */
  formatGlyphs(glyphKeys, result) {
    if (!glyphKeys || glyphKeys.length === 0) return null;
    return result?.expression?.renderGlyphs?.() || null;
  }


  // ═══════════════════════════════════════════════════════════
  // LIFECYCLE (override base for Telegram-specific messages)
  // ═══════════════════════════════════════════════════════════

  async onBorn(data) {
    await super.onBorn(data);

    // Send birth announcement
    const sticker = this.getMedia(MEDIA_TYPE.STICKER, 'happy') ||
                    this.getMedia(MEDIA_TYPE.STICKER, 'default');
    if (sticker) {
      try { await this._sendSticker(this.chatId, sticker); } catch (_) {}
    }

    await this._sendText(this.chatId,
      `🐾✨ ${data.name} ✨🐾\n\n` +
      `тяф! ...тяф? ...ыыы~ ♡\n\n` +
      `🎾 /feed\n` +
      `📊 /status\n` +
      `🔍 /insights`
    );
  }

  async onWake(data) {
    await super.onWake(data);

    const sticker = this.getMedia(MEDIA_TYPE.STICKER, 'happy') ||
                    this.getMedia(MEDIA_TYPE.STICKER, 'default');
    if (sticker) {
      try { await this._sendSticker(this.chatId, sticker); } catch (_) {}
    }

    if (data.minutesAway > 60) {
      await this._sendText(this.chatId, pickRandom([
        `ммрр... хррр... ...рру? ...УУУУУ!! ГАВВВ!! 💛`,
        `zzz... ...рр?.. ....ЫЫЫЫ!! ваф ваф ВАФ!! 🐾💛`,
        `хррр... ...тяф?.. ГАААВ!! ррРРуу!! ♡♡`,
      ]));
    } else {
      await this._sendText(this.chatId, pickRandom([
        `ммрр~... рру~ 🐾`,
        `хррр... тяф~ ваф~ ♡`,
      ]));
    }
  }

  async onSleep(data) {
    await super.onSleep(data);

    const sticker = this.getMedia(MEDIA_TYPE.STICKER, 'sleeping') ||
                    this.getMedia(MEDIA_TYPE.STICKER, 'nap');
    if (sticker) {
      try { await this._sendSticker(this.chatId, sticker); } catch (_) {}
    }
  }

  async onRunaway(data) {
    await super.onRunaway(data);

    // Send farewell letter
    const letter = data.letter;
    if (letter) {
      const snapshot = letter.snapshot || {};
      const lines = [
        `📜 ${this.pes.name.toUpperCase()}`,
        `━━━━━━━━━━━━━━━━━━`,
        ``,
        letter.finalWords || '🐾...💤',
        ``,
        `🐾 ${snapshot.total_interactions || 0}`,
        `🎓 ${snapshot.commands_learned || 0}`,
        `📅 ${this.pes.age || 0}`,
        ``,
        `🐾...←`,
      ];

      await this._sendText(this.chatId, lines.join('\n'));
    }

    // Stop polling
    await this.stopCollecting();
  }

  async onLevelUp(data) {
    await super.onLevelUp(data);

    const phase = data.level < 20 ? 'щенок' :
                  data.level < 40 ? 'подросток' :
                  data.level < 60 ? 'взрослый' :
                  data.level < 80 ? 'опытный' : 'КиберPes';

    // Level-up: only sounds + sticker + level info
    await this._sendContextualSticker('greetings');
    await this._sendText(this.chatId, pickRandom([
      `ГАААВВ!! ррРРуууу!! ыыыЫЫЫ!! ✨🐾🎉`,
      `ууУУУ!! ваф ВАФ ВАФ!! ррру!! ✨🎉🐾`,
      `ыыыЫЫЫ!! тяф тяф ТЯФФ!! ррРР!! 🎉✨`,
    ]));
    await this._sendText(this.chatId, `⬆️ ${data.level} ${phase} ✨`);
  }


  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  /** Progress bar helper. */
  _bar(val, len = 10) {
    const filled = Math.round((val || 0) * len);
    return '█'.repeat(filled) + '░'.repeat(len - filled);
  }

  // ═══════════════════════════════════════════════════════════
  // EMOJI STATUS INTEGRATION
  // ═══════════════════════════════════════════════════════════

  /**
   * Start auto-sync of PES emotion → bot bio/description.
   * Updates every 2 minutes if emotion changed.
   */
  _startEmojiStatusSync() {
    this._syncEmojiStatus().catch(() => {});
    this._emojiStatusInterval = setInterval(() => {
      this._syncEmojiStatus().catch(err =>
        console.error('⚠️ Emoji status sync error:', err.message)
      );
    }, 2 * 60 * 1000); // every 2 min
    console.log('✨ Emoji status sync started (every 2min)');
  }

  /**
   * Sync current PES emotion to bot short description.
   * Rate-limited to 1 update per 60 seconds.
   */
  async _syncEmojiStatus() {
    const emotion = this.pes?.emotions?.state || 'idle';
    const mood = this.pes?.emotions?.mood ?? 0.5;
    const level = this.pes?.level || 0;

    // Don't update if emotion hasn't changed
    if (emotion === this._lastEmojiStatus) return;

    // Rate limit: minimum 60s between updates
    const now = Date.now();
    if (now - this._lastBioUpdate < 60_000) return;

    const statusInfo = EMOTION_EMOJI_STATUS[emotion] || EMOTION_EMOJI_STATUS.idle;
    const name = this.pes?.name || 'ПЕС';
    const moodPct = Math.round(mood * 100);

    // Build short description: "🐾 Тор • 😊 счастлив • ур.9 • 85%"
    const shortDesc = `🐾 ${name} • ${statusInfo.emoji} ${statusInfo.label} • ур.${Math.floor(level)} • ${moodPct}%`;

    try {
      await this._call('setMyShortDescription', {
        short_description: shortDesc,
      });
      this._lastEmojiStatus = emotion;
      this._lastBioUpdate = now;
      console.log(`✨ Emoji status updated: ${statusInfo.emoji} ${emotion}`);
    } catch (err) {
      // Telegram rate limits — not critical
      if (err.code !== 429) {
        console.error('⚠️ setMyShortDescription failed:', err.message);
      }
    }
  }

  /**
   * Get current emoji status info.
   * @returns {{ emoji, label, short, emotion, mood, level }}
   */
  _getEmojiStatus() {
    const emotion = this.pes?.emotions?.state || 'idle';
    const mood = this.pes?.emotions?.mood ?? 0.5;
    const level = this.pes?.level || 0;
    const statusInfo = EMOTION_EMOJI_STATUS[emotion] || EMOTION_EMOJI_STATUS.idle;
    return { ...statusInfo, emotion, mood, level };
  }

  /**
   * /emoji command — show current emoji status or force update.
   */
  async _cmdEmoji(msg, args) {
    if (args === 'sync' || args === 'update') {
      // Force sync
      this._lastEmojiStatus = null;
      this._lastBioUpdate = 0;
      await this._syncEmojiStatus();
      await this._sendText(this.chatId, '✨ Статус обновлён!');
      return;
    }

    const status = this._getEmojiStatus();
    const name = this.pes?.name || 'ПЕС';
    const moodPct = Math.round(status.mood * 100);
    const energyPct = Math.round((this.pes?.emotions?.energy ?? 0.5) * 100);

    // Build rich status card
    const lines = [
      `✨ ━━━ СТАТУС ${name.toUpperCase()} ━━━ ✨`,
      ``,
      `${status.emoji} ${status.short}`,
      ``,
      `💛 Настроение: ${moodPct}%`,
      `⚡ Энергия: ${energyPct}%`,
      `🎓 Уровень: ${Math.floor(status.level)}`,
      ``,
      `━━ Сейчас ━━`,
      this._getActivityLine(),
      ``,
      `🔄 /emoji sync — обновить статус`,
    ];

    await this._sendText(this.chatId, lines.join('\n'));
  }

  /**
   * Generate a human-readable activity line based on current state.
   */
  _getActivityLine() {
    const emotion = this.pes?.emotions?.state || 'idle';
    const silentMin = this._lastOwnerMessageTime
      ? Math.round((Date.now() - this._lastOwnerMessageTime) / 60_000)
      : 0;

    if (this._devMode) return '🔧 В режиме разработки';
    if (this._agentMode) return `🎯 Работает с @${this._agentMode}`;

    if (emotion === 'sleep' || emotion === 'nap') return '💤 Спит, тсс...';
    if (silentMin > 120) return `🥺 Ждёт хозяина уже ${Math.floor(silentMin / 60)}ч`;
    if (silentMin > 30) return `😐 Скучает ${silentMin} мин`;
    if (emotion === 'zoomies') return '⚡ БЕГАЕТ ПО КРУГУ!!';
    if (emotion === 'playful') return '🎾 Хочет играть!';
    if (emotion === 'food_obsessed' || emotion === 'hungry') return '🍖 Голодный...';
    if (emotion === 'curious') return '🔍 Что-то нюхает...';
    if (emotion === 'happy' || emotion === 'content') return '💛 Просто счастлив';
    if (emotion === 'alert') return '👀 Что-то заметил!';

    const statusInfo = EMOTION_EMOJI_STATUS[emotion];
    return statusInfo ? `${statusInfo.emoji} ${statusInfo.label}` : '🐾 Живёт';
  }

  // ═══════════════════════════════════════════════════════════
  // FRIENDSHIP SYSTEM (Level 10)
  // ═══════════════════════════════════════════════════════════

  /**
   * /achievements — show all achievements and progress
   */
  async _cmdAchievements(msg) {
    const { total, unlocked, achievements } = this.pes.store.getAchievementProgress();
    const streak = this.pes.store.getStreak();

    let text = `🏆 *Достижения* (${unlocked}/${total})\n`;
    text += `🔥 Streak: ${streak.current} дн | Рекорд: ${streak.longest} дн | Всего: ${streak.total} дн\n\n`;

    for (const a of achievements) {
      const status = a.unlocked ? '✅' : '⬜';
      const progress = a.unlocked ? '' : ` (${a.progress}/${a.threshold})`;
      text += `${status} ${a.emoji} *${a.name}* — ${a.description}${progress}\n`;
    }

    await this._sendText(this.chatId, text, { parse_mode: 'Markdown' });
  }

  /**
   * /streak — show current streak info
   */
  async _cmdStreak(msg) {
    const streak = this.pes.store.getStreak();
    const fire = '🔥'.repeat(Math.min(streak.current, 10));
    let text = `${fire}\n\n`;
    text += `*Текущий streak:* ${streak.current} дней\n`;
    text += `*Рекорд:* ${streak.longest} дней\n`;
    text += `*Всего активных дней:* ${streak.total}\n`;

    if (streak.current >= 7) text += `\n💎 Потрясающая серия!`;
    else if (streak.current >= 3) text += `\n⭐ Так держать!`;

    await this._sendText(this.chatId, text, { parse_mode: 'Markdown' });
  }

  /**
   * /friends — show friends list, pending requests, gift stats
   */
  async _cmdFriends(msg) {
    if (!this.pes.store.isUnlocked('social_pets')) {
      await this._sendText(this.chatId, '🔒 Дружба открывается на уровне 10!');
      return;
    }

    const friends = this.pes.store.getFriends();
    const pending = this.pes.store.getPendingFriendRequests();
    const name = this.pes.name || 'ПЕС';

    const lines = [`🤝 ━━━ ДРУЗЬЯ ${name.toUpperCase()} ━━━ 🤝`, ''];

    if (friends.length === 0 && pending.length === 0) {
      lines.push('У тебя пока нет друзей... 🐾');
      lines.push('');
      lines.push('📝 /addfriend <chat_id> — добавить друга');
      lines.push('(Попроси друга написать /start боту, потом узнай его chat_id)');
      await this._sendText(this.chatId, lines.join('\n'));
      return;
    }

    if (friends.length > 0) {
      lines.push(`👥 Друзья (${friends.length}):`);
      for (const f of friends) {
        const trustBar = '❤️'.repeat(Math.round(f.trust_level * 5)) + '🖤'.repeat(5 - Math.round(f.trust_level * 5));
        const giftsInfo = f.gifts_sent + f.gifts_received > 0
          ? ` | 🎁 ${f.gifts_sent}↑ ${f.gifts_received}↓`
          : '';
        lines.push(`  ${f.friend_breed === 'corgi' ? '🐕' : f.friend_breed === 'cat' ? '🐱' : f.friend_breed === 'fox' ? '🦊' : f.friend_breed === 'owl' ? '🦉' : '🐻'} ${f.friend_pet_name} — ${trustBar}${giftsInfo}`);
      }
      lines.push('');
    }

    if (pending.length > 0) {
      lines.push(`📨 Ожидают ответа (${pending.length}):`);
      for (const p of pending) {
        lines.push(`  🐾 ${p.friend_pet_name} (${p.friend_chat_id})`);
      }
      lines.push('');
    }

    lines.push('━━━━━━━━━━━━━━━━━━━━');
    lines.push('/addfriend <chat_id> — добавить друга');
    lines.push('/gift <chat_id> — отправить подарок');

    await this._sendText(this.chatId, lines.join('\n'));
  }

  /**
   * /addfriend <chat_id> — send friendship request to another PES
   */
  async _cmdAddFriend(msg, args) {
    if (!this.pes.store.isUnlocked('social_pets')) {
      await this._sendText(this.chatId, '🔒 Дружба открывается на уровне 10!');
      return;
    }

    const targetChatId = (args || '').trim();
    if (!targetChatId || !/^\d+$/.test(targetChatId)) {
      await this._sendText(this.chatId, '📝 Использование: /addfriend <chat_id>\n\nПопроси друга написать /start боту, потом узнай его chat_id.');
      return;
    }

    if (targetChatId === String(this.chatId)) {
      await this._sendText(this.chatId, `${this.pes.name} не может дружить сам с собой! 🐾😅`);
      return;
    }

    const existing = this.pes.store.getFriendship(targetChatId);
    if (existing?.status === 'accepted') {
      await this._sendText(this.chatId, `🤝 Вы уже друзья! Используй /gift ${targetChatId} для подарка.`);
      return;
    }
    if (existing?.status === 'pending') {
      await this._sendText(this.chatId, '⏳ Запрос уже отправлен, ждём ответа...');
      return;
    }

    // Store locally as outgoing (we don't know the friend's pet name yet)
    this.pes.store.sendFriendRequest(targetChatId, 'ПЕС', null);

    // Send request to the target chat with accept/reject buttons
    const name = this.pes.name || 'ПЕС';
    const myLevel = Math.floor(this.pes.status().level || 0);
    const requestText = [
      `🐾 ━━━ ЗАПРОС НА ДРУЖБУ ━━━ 🐾`,
      ``,
      `${name} (уровень ${myLevel}) хочет дружить!`,
      ``,
      `Принять дружбу?`,
    ].join('\n');

    try {
      await this._sendText(targetChatId, requestText, {
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            { text: '✅ Принять', callback_data: `friend_accept_${this.chatId}` },
            { text: '❌ Отклонить', callback_data: `friend_reject_${this.chatId}` },
          ]],
        }),
      });

      await this._sendText(this.chatId, `📨 Запрос на дружбу отправлен! ${name} виляет хвостом в ожидании... 🐾`);
    } catch (err) {
      // Target hasn't started the bot
      this.pes.store.removeFriend(targetChatId);
      await this._sendText(this.chatId, `❌ Не удалось отправить запрос. Убедись что друг написал /start боту.`);
    }
  }

  /**
   * /gift <chat_id> [тип] — send a gift to a friend's PES
   */
  async _cmdGift(msg, args) {
    if (!this.pes.store.isUnlocked('social_pets')) {
      await this._sendText(this.chatId, '🔒 Дружба открывается на уровне 10!');
      return;
    }

    const parts = (args || '').trim().split(/\s+/);
    const targetChatId = parts[0];
    const giftArg = parts.slice(1).join(' ').toLowerCase();

    if (!targetChatId || !/^\d+$/.test(targetChatId)) {
      // Show available gifts
      const friends = this.pes.store.getFriends();
      if (friends.length === 0) {
        await this._sendText(this.chatId, '🐾 Сначала нужны друзья! /addfriend <chat_id>');
        return;
      }
      const lines = [
        '🎁 ━━━ ПОДАРКИ ━━━ 🎁',
        '',
        '📝 /gift <chat_id> [тип]',
        '',
        '🎾 мячик — +5% настроения',
        '🦴 косточка — +7% настроения',
        '🧸 игрушка — +8% настроения',
        '💌 письмо — +10% настроения',
        '🌟 звезда — +12% настроения',
        '',
        '👥 Твои друзья:',
      ];
      for (const f of friends) {
        lines.push(`  🐾 ${f.friend_pet_name} — ${f.friend_chat_id}`);
      }
      await this._sendText(this.chatId, lines.join('\n'));
      return;
    }

    const friendship = this.pes.store.getFriendship(targetChatId);
    if (!friendship || friendship.status !== 'accepted') {
      await this._sendText(this.chatId, '❌ Это не твой друг. Сначала /addfriend');
      return;
    }

    // Gift catalog
    const GIFTS = {
      'мячик':    { emoji: '🎾', name: 'Мячик', mood: 0.05 },
      'ball':     { emoji: '🎾', name: 'Мячик', mood: 0.05 },
      'косточка': { emoji: '🦴', name: 'Косточка', mood: 0.07 },
      'bone':     { emoji: '🦴', name: 'Косточка', mood: 0.07 },
      'игрушка':  { emoji: '🧸', name: 'Игрушка', mood: 0.08 },
      'toy':      { emoji: '🧸', name: 'Игрушка', mood: 0.08 },
      'письмо':   { emoji: '💌', name: 'Письмо', mood: 0.10 },
      'letter':   { emoji: '💌', name: 'Письмо', mood: 0.10 },
      'звезда':   { emoji: '🌟', name: 'Звезда', mood: 0.12 },
      'star':     { emoji: '🌟', name: 'Звезда', mood: 0.12 },
    };

    // Default gift = мячик
    const giftKey = giftArg && GIFTS[giftArg] ? giftArg : 'мячик';
    const gift = GIFTS[giftKey];

    // Record in sender's DB
    this.pes.store.sendGift(targetChatId, giftKey, gift.name, gift.emoji, gift.mood);

    // Mood boost for sender (joy of giving)
    if (this.pes.emotions) {
      this.pes.emotions.mood = Math.min(1.0, (this.pes.emotions.mood || 0.5) + gift.mood * 0.5);
    }

    const name = this.pes.name || 'ПЕС';

    // Notify sender
    await this._sendText(this.chatId, `${gift.emoji} ${name} отправил ${gift.name.toLowerCase()} для ${friendship.friend_pet_name}! 🐾💛`);

    // Notify receiver
    try {
      await this._sendText(targetChatId, [
        `${gift.emoji} ━━━ ПОДАРОК! ━━━ ${gift.emoji}`,
        ``,
        `${name} прислал ${gift.name.toLowerCase()}!`,
        `💛 +${Math.round(gift.mood * 100)}% к настроению`,
      ].join('\n'), {
        reply_markup: JSON.stringify({
          inline_keyboard: [[
            { text: '💛 Спасибо!', callback_data: `gift_thanks_${this.chatId}` },
          ]],
        }),
      });
    } catch (err) {
      await this._sendText(this.chatId, `⚠️ Подарок записан, но не доставлен (друг не в сети).`);
    }

    // XP for social interaction
    this.pes.store.addXP(3, 'gift_sent', `sent ${gift.name} to ${targetChatId}`);
  }

  /**
   * Cleanup.
   */
  destroy() {
    this.stopReminderChecker();
    if (this._idleTimer) {
      clearInterval(this._idleTimer);
      this._idleTimer = null;
    }
    if (this._proactiveTimer) {
      clearInterval(this._proactiveTimer);
      this._proactiveTimer = null;
    }
    if (this._emojiStatusInterval) {
      clearInterval(this._emojiStatusInterval);
      this._emojiStatusInterval = null;
    }
    this.stopCollecting();
    super.destroy();
  }
}


// ── EXPORTS ─────────────────────────────────────────────────

export {
  TelegramAdapter,
  KEYWORDS,
  DEFAULT_STICKER_EMOTION_MAP,
  thinkingDelay,
};

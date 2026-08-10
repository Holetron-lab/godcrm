// ============================================================
// PES Manager — Multi-User PES Instance Manager
// ============================================================
// Manages multiple PES instances, one per user.
// Single Telegram polling loop → routes to correct PES.
//
// Architecture:
//   - One bot token, one polling loop
//   - Map<chatId, { pes, adapter }> — lazy-loaded
//   - Per-user SQLite in pes-data/users/{chatId}/
//   - Тор (owner 331468767) uses legacy pes-data/bublik.db
//   - New users: /start → create PES with defaults
// ============================================================

import { Pes } from './core/pes.js';
import { TelegramAdapter } from './platform/telegram.js';
import { CrmBridge } from './platform/crm-bridge.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'pes-data');
const USERS_DIR = join(DATA_DIR, 'users');
const REGISTRY_PATH = join(DATA_DIR, 'users-registry.json');
const LOG_FILE = join(DATA_DIR, 'pes.log');

const TG_API = 'https://api.telegram.org/bot';

// Default pet configs for new users
const DEFAULT_BREEDS = ['corgi', 'cat', 'fox', 'owl', 'bear'];

function log(category, message, data = null) {
  const ts = new Date().toISOString();
  const line = data
    ? `[${ts}] [${category}] ${message} ${JSON.stringify(data)}`
    : `[${ts}] [${category}] ${message}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

export class PesManager {
  /**
   * @param {Object} config
   * @param {string} config.botToken     — Telegram Bot API token
   * @param {string} config.llmApiKey    — OpenAI API key
   * @param {string} config.masterChatId — Master owner chatId (Тор)
   */
  constructor(config = {}) {
    if (!config.botToken) throw new Error('PesManager: botToken required');

    this.botToken = config.botToken;
    this.llmApiKey = config.llmApiKey || null;
    this.jwtSecret = config.jwtSecret || null;
    this.masterChatId = String(config.masterChatId || '331468767');

    // Active instances: chatId → { pes, adapter, crmBridge }
    this.instances = new Map();

    // User registry: chatId → { name, petName, breed, seed, createdAt }
    this.registry = this._loadRegistry();

    // Polling state
    this._pollOffset = 0;
    this._polling = false;

    // Ensure dirs exist
    if (!existsSync(USERS_DIR)) mkdirSync(USERS_DIR, { recursive: true });

    // Auto-register master if not in registry
    if (!this.registry[this.masterChatId]) {
      this.registry[this.masterChatId] = {
        chatId: this.masterChatId,
        name: 'NIKITRON',
        username: null,
        petName: 'Тор',
        breed: 'corgi',
        seed: 0.42,
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      this._saveRegistry();
    }

    log('MANAGER', `PesManager initialized. Registry: ${Object.keys(this.registry).length} users`);
  }

  // ── REGISTRY ──────────────────────────────────────────────

  _loadRegistry() {
    try {
      if (existsSync(REGISTRY_PATH)) {
        return JSON.parse(readFileSync(REGISTRY_PATH, 'utf-8'));
      }
    } catch (err) {
      log('MANAGER', `Registry load error: ${err.message}`);
    }
    return {};
  }

  _saveRegistry() {
    try {
      const tmp = REGISTRY_PATH + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.registry, null, 2));
      renameSync(tmp, REGISTRY_PATH);
    } catch (err) {
      log('MANAGER', `Registry save error: ${err.message}`);
    }
  }

  _registerUser(chatId, userData = {}) {
    const id = String(chatId);
    if (this.registry[id]) return this.registry[id];

    const seed = Math.random();
    const breed = DEFAULT_BREEDS[Math.floor(seed * DEFAULT_BREEDS.length)];

    this.registry[id] = {
      chatId: id,
      name: userData.firstName || 'Unknown',
      username: userData.username || null,
      petName: null, // set later via /setname
      breed,
      seed: parseFloat(seed.toFixed(4)),
      createdAt: new Date().toISOString(),
    };

    this._saveRegistry();
    log('MANAGER', `New user registered: ${id}`, this.registry[id]);
    return this.registry[id];
  }

  // ── INSTANCE MANAGEMENT ───────────────────────────────────

  /**
   * Get or create PES instance for a chatId.
   * Master (Тор) uses legacy DB path.
   * New users get per-user directory.
   */
  _getOrCreateInstance(chatId) {
    const id = String(chatId);

    // Already loaded?
    if (this.instances.has(id)) return this.instances.get(id);

    // Determine paths
    let dbPath, dataDir;

    if (id === this.masterChatId) {
      // Тор — legacy path
      dbPath = join(DATA_DIR, 'bublik.db');
      dataDir = DATA_DIR;
    } else {
      // New user — per-user directory
      dataDir = join(USERS_DIR, id);
      if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      dbPath = join(dataDir, 'pes.db');
    }

    // Get or create registry entry
    const userInfo = this.registry[id] || {};
    const petName = userInfo.petName || (id === this.masterChatId ? 'Тор' : 'ПЕС');
    const breed = userInfo.breed || 'corgi';
    const seed = userInfo.seed || 0.5;

    // Create PES instance
    const isExisting = existsSync(dbPath);

    const pes = new Pes({
      name: petName,
      ownerId: id,
      dbPath,
      breed,
      seed,
      domain: id === this.masterChatId ? 'devops' : 'general',
      autoTick: true,
    });

    // Load pet name from DB if exists
    if (isExisting && pes.store) {
      try {
        const dbName = pes.store.getConfig('pet_name') || pes.store.getConfig('name');
        if (dbName && dbName !== petName) pes.name = dbName;
      } catch (e) { log('INSTANCE', `Pet name load error: ${e.message}`); }
    }

    // Wire PES events to logger
    this._wirePesEvents(pes, id);

    // Birth or Wake
    if (isExisting) {
      log('INSTANCE', `Waking PES for chat ${id} (${petName})`);
      pes.wake();
    } else {
      log('INSTANCE', `Birthing new PES for chat ${id} (${petName})`);
      pes.birth();
    }

    // Master-specific config (Тор)
    if (id === this.masterChatId && pes.store) {
      const ensureConfig = (key, val) => {
        if (!pes.store.getConfig(key)) pes.store.setConfig(key, val);
      };
      ensureConfig('can_escape', 'false');
      ensureConfig('aggression_locked', '1');
      ensureConfig('name_locked', 'true');
      ensureConfig('owner_id', id);

      // Force aggression = 0 for Тор
      if (pes.emotions?.traits) {
        pes.emotions.traits.aggression = 0;
        if (pes.store) pes.store.updateStats({ aggression: 0 });
      }
    }

    // Create TelegramAdapter (without polling — PesManager handles polling)
    const adapter = new TelegramAdapter(pes, {
      botToken: this.botToken,
      chatId: id,
      useThinkingDelay: true,
      pollingInterval: 2000,
      llmApiKey: this.llmApiKey,
      jwtSecret: this.jwtSecret,        // CRM Bridge v2
      crmBaseUrl: 'http://127.0.0.1:5000', // Local CRM API
      crmSpaceId: 11,                    // Development space
      managed: true, // flag: don't start own polling
    });

    adapter.on('error', (err) => {
      log('TG_ERROR', `[${id}] ${err.message}`);
    });

    // CRM Bridge only for master
    let crmBridge = null;
    if (id === this.masterChatId) {
      crmBridge = new CrmBridge(pes, {
        pollInterval: 10_000,
        onEvent: (event, mapping) => {
          log('CRM', `📡 ${event.type} → ${mapping.trigger}`, event.data);
        },
      });
      crmBridge.start();
    }

    const instance = { pes, adapter, crmBridge };
    this.instances.set(id, instance);

    log('INSTANCE', `PES instance active for ${id}: ${petName} (${breed}), level ${pes.status().level}`);
    return instance;
  }

  _wirePesEvents(pes, chatId) {
    const prefix = chatId === this.masterChatId ? '' : `[${chatId}] `;

    pes.on('born', (data) => log('LIFE', `${prefix}🐾 ${data.name} РОДИЛСЯ!`, { breed: data.breed }));
    pes.on('wake', (data) => log('LIFE', `${prefix}☀️ ${data.name} проснулся`, { sleptMin: data.minutesSleeping }));
    pes.on('sleep', () => log('LIFE', `${prefix}💤 заснул`));
    pes.on('level_up', (data) => log('LEVEL', `${prefix}🎉 Уровень ${data.level}! (${data.phase})`));
    pes.on('unlock', (data) => log('UNLOCK', `${prefix}🔓 ${data.feature} (level ${data.level})`));
    pes.on('error', (err) => log('ERROR', `${prefix}❌ ${err.message}`));
  }

  // ── TELEGRAM POLLING ──────────────────────────────────────

  async start() {
    log('MANAGER', 'Starting PesManager...');

    // Pre-load master instance (Тор)
    const masterInstance = this._getOrCreateInstance(this.masterChatId);

    // Initialize master adapter (loads stickers, context, etc.)
    await masterInstance.adapter.initManaged();

    // Pre-load all registered users
    for (const chatId of Object.keys(this.registry)) {
      if (chatId !== this.masterChatId) {
        try {
          const inst = this._getOrCreateInstance(chatId);
          await inst.adapter.initManaged();
        } catch (err) {
          log('MANAGER', `Failed to load user ${chatId}: ${err.message}`);
        }
      }
    }

    // Delete webhook, set bot commands
    try {
      await this._tgCall('deleteWebhook', { drop_pending_updates: false });
      log('MANAGER', '🔧 Webhook deleted, polling mode active');
    } catch (e) { log('MANAGER', `Webhook delete failed: ${e.message}`); }

    // Start polling
    this._polling = true;
    log('MANAGER', `✅ PesManager LIVE! ${this.instances.size} instance(s) active`);
    this._pollLoop();
  }

  async stop() {
    log('MANAGER', 'Stopping PesManager...');
    this._polling = false;

    for (const [chatId, inst] of this.instances) {
      try {
        if (inst.crmBridge) inst.crmBridge.stop();
        inst.adapter.destroy();
        inst.pes.sleep();
        inst.pes.destroy();
        log('INSTANCE', `Shut down PES for ${chatId}`);
      } catch (err) {
        log('ERROR', `Shutdown error for ${chatId}: ${err.message}`);
      }
    }

    this.instances.clear();
    log('MANAGER', 'All instances shut down');
  }

  async _pollLoop() {
    while (this._polling) {
      try {
        const updates = await this._tgCall('getUpdates', {
          offset: this._pollOffset,
          timeout: 30,
          allowed_updates: ['message', 'message_reaction', 'inline_query', 'callback_query'],
        });

        for (const update of updates) {
          this._pollOffset = update.update_id + 1;
          try {
            await this._routeUpdate(update);
          } catch (err) {
            log('ROUTE_ERROR', err.message);
          }
        }
      } catch (err) {
        log('POLL_ERROR', err.message);
        if (this._polling) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
  }

  /**
   * Route an update to the correct PES instance.
   * New users get onboarded on /start.
   */
  async _routeUpdate(update) {
    let chatId = null;

    if (update.message) {
      chatId = String(update.message.chat.id);
    } else if (update.message_reaction) {
      chatId = String(update.message_reaction.chat.id);
    } else if (update.callback_query) {
      chatId = String(update.callback_query.message?.chat?.id);
    } else if (update.inline_query) {
      // Inline queries don't have a chatId, route to master
      chatId = this.masterChatId;
    }

    if (!chatId) return;

    // Check if this is a new user sending /start
    if (update.message?.text?.startsWith('/start') && !this.registry[chatId]) {
      await this._handleNewUser(update.message);
      return;
    }

    // Get or create instance for this user
    if (!this.registry[chatId] && chatId !== this.masterChatId) {
      // Unknown user, not /start — send welcome prompt
      await this._sendWelcomePrompt(chatId);
      return;
    }

    // Ensure instance is loaded
    const instance = this._getOrCreateInstance(chatId);

    // If adapter not yet initialized, init it
    if (!instance.adapter._managedInit) {
      await instance.adapter.initManaged();
    }

    // Route update to the adapter
    await instance.adapter.handleUpdate(update);
  }

  /**
   * Handle new user onboarding.
   */
  async _handleNewUser(msg) {
    const chatId = String(msg.chat.id);
    const user = msg.from || {};

    log('ONBOARD', `New user: ${chatId}`, { firstName: user.first_name, username: user.username });

    // Register user
    this._registerUser(chatId, {
      firstName: user.first_name || 'User',
      username: user.username || null,
    });

    // Create PES instance
    const instance = this._getOrCreateInstance(chatId);
    await instance.adapter.initManaged();

    // Send welcome message
    const petName = 'ПЕС';
    const breed = this.registry[chatId]?.breed || 'corgi';

    const welcomeText = [
      `🐾 *Привет, ${user.first_name || 'хозяин'}!*`,
      '',
      `У тебя появился новый питомец!`,
      `Порода: *${breed}*`,
      `Имя: *${petName}* (измени через /setname)`,
      '',
      `Он пока маленький и знает только простые звуки.`,
      `Общайся с ним — он будет учиться и расти! 🎉`,
      '',
      `Команды:`,
      `/status — как он себя чувствует`,
      `/setname Имя — дать имя`,
      `/stickers — управление стикерами`,
      `/notes — заметки`,
      `/remind — напоминания`,
    ].join('\n');

    await this._tgCall('sendMessage', {
      chat_id: chatId,
      text: welcomeText,
      parse_mode: 'Markdown',
    });

    log('ONBOARD', `User ${chatId} onboarded with ${breed} PES`);
  }

  async _sendWelcomePrompt(chatId) {
    try {
      await this._tgCall('sendMessage', {
        chat_id: chatId,
        text: '🐾 Привет! Нажми /start чтобы получить своего питомца!',
      });
    } catch (e) { log('ONBOARD', `Welcome message failed: ${e.message}`); }
  }

  // ── TELEGRAM API ──────────────────────────────────────────

  async _tgCall(method, params = {}) {
    const url = `${TG_API}${this.botToken}/${method}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const json = await resp.json();
    if (!json.ok) {
      throw new Error(`TG API ${method}: ${json.description}`);
    }
    return json.result;
  }

  // ── STATUS ────────────────────────────────────────────────

  getStatus() {
    const instances = [];
    for (const [chatId, inst] of this.instances) {
      const s = inst.pes.status();
      instances.push({
        chatId,
        name: s.name || inst.pes.name,
        level: s.level,
        mood: Math.round((s.vitals?.mood ?? 0.5) * 100) + '%',
        mode: s.tickMode || 'unknown',
        breed: this.registry[chatId]?.breed,
      });
    }
    return {
      totalUsers: Object.keys(this.registry).length,
      activeInstances: this.instances.size,
      instances,
    };
  }
}

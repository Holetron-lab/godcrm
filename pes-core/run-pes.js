#!/usr/bin/env node
// ============================================================
// PES Runner — Multi-User PES via PesManager
// ============================================================
// Launches PES Manager: single polling loop, multiple users.
// Master user (Тор) loads from legacy bublik.db.
// New users get their own PES on /start.
//
// Usage:
//   node run-pes.js
//   BOT_TOKEN=xxx CHAT_ID=yyy node run-pes.js
//
// Environment:
//   BOT_TOKEN  — Telegram Bot API token
//   CHAT_ID    — Master owner's Telegram chat ID (default: Тор)
//   LOG_FILE   — Log file path (default: ./pes-data/pes.log)
// ============================================================

import { PesManager } from './pes-manager.js';
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CONFIG ────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN || '<TELEGRAM_BOT_TOKEN>';
const CHAT_ID   = process.env.CHAT_ID   || '331468767';
const DATA_DIR  = join(__dirname, 'pes-data');
const LOG_FILE  = process.env.LOG_FILE  || join(DATA_DIR, 'pes.log');

// ── LLM API Key (read from backend .env or env var) ──────────
function loadLLMKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const envPath = join(__dirname, '..', 'backend', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^OPENAI_API_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch (_) {}
  return null;
}
const LLM_API_KEY = loadLLMKey();

// ── JWT Secret (for CRM Bridge v2) ───────────────────────
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  try {
    const envPath = join(__dirname, '..', '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^JWT_SECRET=(.+)$/m);
    if (match) return match[1].trim();
  } catch (_) {}
  return null;
}
const JWT_SECRET = loadJwtSecret();

// Ensure data dir exists
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });


// ── LOGGER ────────────────────────────────────────────────

function log(category, message, data = null) {
  const ts = new Date().toISOString();
  const line = data
    ? `[${ts}] [${category}] ${message} ${JSON.stringify(data)}`
    : `[${ts}] [${category}] ${message}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}


// ── GLOBAL ERROR HANDLERS (prevent crash → PM2 restart loop) ──

process.on('uncaughtException', (err) => {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [UNCAUGHT] ❌ ${err.message}\n${err.stack}`;
  console.error(msg);
  try { appendFileSync(LOG_FILE, msg + '\n'); } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [UNHANDLED_REJECTION] ❌ ${reason?.message || reason}\n${reason?.stack || ''}`;
  console.error(msg);
  try { appendFileSync(LOG_FILE, msg + '\n'); } catch (_) {}
});

// ── MAIN ──────────────────────────────────────────────────

async function main() {
  log('SYSTEM', '═══════════════════════════════════════');
  log('SYSTEM', 'PES Runner (Multi-User) starting...');
  log('SYSTEM', `Master chat: ${CHAT_ID}`);
  log('SYSTEM', `LLM: ${LLM_API_KEY ? 'ACTIVE' : 'DISABLED'}`);
  log('SYSTEM', `CRM Bridge: ${JWT_SECRET ? 'ACTIVE' : 'DISABLED'}`);
  log('SYSTEM', '═══════════════════════════════════════');

  const manager = new PesManager({
    botToken: BOT_TOKEN,
    llmApiKey: LLM_API_KEY,
    masterChatId: CHAT_ID,
    jwtSecret: JWT_SECRET,
  });

  // ── Graceful shutdown ───────────────────────────────
  const shutdown = (signal) => {
    log('SYSTEM', `${signal} received — shutting down...`);
    manager.stop();
    log('SYSTEM', 'PES Manager safely shut down. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ── Start manager (polling + instances) ─────────────
  await manager.start();

  // Keep alive + heartbeat
  setInterval(() => {
    const status = manager.getStatus();
    log('HEARTBEAT', `♥ ${status.activeInstances} instances, ${status.totalUsers} users`);
    for (const inst of status.instances) {
      log('HEARTBEAT', `  ${inst.name} (${inst.chatId}): level=${inst.level} mood=${inst.mood} mode=${inst.mode}`);
    }
  }, 300_000); // every 5 min
}

main().catch((err) => {
  log('FATAL', `💀 ${err.message}\n${err.stack}`);
  process.exit(1);
});

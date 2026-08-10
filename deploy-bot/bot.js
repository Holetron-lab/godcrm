require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error('[deploy-bot] BOT_TOKEN missing — set it in deploy-bot/.env');
  process.exit(1);
}
const OWNER_ID = process.env.OWNER_ID ? Number(process.env.OWNER_ID) : 423753027;

// --- Topology (env-driven so the bot survives server migrations) ---
// A host value of 'local' / 'localhost' / empty means "run on the box the bot lives on"
// (single-server / single-box mode). Any other value is treated as an ssh target
// (e.g. root@1.2.3.4) and commands are executed over ssh.
const PROD_HOST = process.env.PROD_HOST || 'local';
const DEV_HOST = process.env.DEV_HOST || 'local';
const PROD_PM2 = process.env.PROD_PM2 || 'godcrm';
const DEV_PM2 = process.env.DEV_PM2 || 'godcrm';
const PROD_CODE = process.env.PROD_CODE || '/root/production/business-crm';
// rsync target for /deploy_dev. Empty/local → DEV is this same box, rsync is skipped.
const DEV_RSYNC_TARGET = process.env.DEV_RSYNC_TARGET || '';

// --- DB swap (ADR-A: this box mirrors the live master; local copy is a warm standby) ---
// Named DB targets so a broken PROD app/DB can be swapped in seconds without editing files by hand.
// Targets are defined ENTIRELY in the bot's .env (chmod 600, gitignored) — no DSN or password ever
// lands in CRM owner-settings. Per-target keys (KEY uppercased):
//   DB_TARGET_<KEY>_HOST  _PORT  _DB  _USER  _PASSWORD  _LABEL
// DB_TARGETS is the ordered comma-list of keys, e.g. "local,live".
// The swap rewrites POSTGRES_* in GODCRM_ENV_PATH on SWAP_HOST, then pm2 restart --update-env.
const DB_TARGETS = (process.env.DB_TARGETS || '').split(',').map(s => s.trim()).filter(Boolean);
const GODCRM_ENV_PATH = process.env.GODCRM_ENV_PATH || `${process.env.PROD_CODE || '/root/production/business-crm'}/.env`;
const SWAP_HOST = process.env.SWAP_HOST || 'local';           // box running the godcrm we swap
const SWAP_PM2 = process.env.SWAP_PM2 || process.env.DEV_PM2 || 'godcrm';

function isLocal(host) {
  return !host || host === 'local' || host === 'localhost';
}

const b64 = (s) => Buffer.from(String(s == null ? '' : s), 'utf8').toString('base64');

// Resolve a named DB target from env → {key,host,port,db,user,password,label} or null if undefined.
function targetConf(key) {
  const K = String(key).toUpperCase();
  const g = (s) => process.env[`DB_TARGET_${K}_${s}`];
  const host = g('HOST');
  if (!host) return null;
  return {
    key,
    host,
    port: g('PORT') || '5432',
    db: g('DB') || 'godcrm_prod',
    user: g('USER') || 'godcrm',
    password: g('PASSWORD') || '',
    label: g('LABEL') || key,
  };
}

// Current POSTGRES_HOST:PORT/DB the godcrm on SWAP_HOST is pointed at.
async function readCurrentTarget() {
  const out = await runOn(SWAP_HOST,
    `grep -E '^POSTGRES_(HOST|PORT|DB)=' ${GODCRM_ENV_PATH} 2>/dev/null || true`, 30000).catch(() => '');
  const get = (k) => { const m = out.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : '?'; };
  const host = get('POSTGRES_HOST');
  const matched = DB_TARGETS.map(targetConf).find(c => c && c.host === host);
  return { host, port: get('POSTGRES_PORT'), db: get('POSTGRES_DB'), key: matched ? matched.key : null };
}

// Pre-flight: can we actually reach this target and run `select 1`? Aborts a swap before it breaks the app.
async function checkTarget(conf) {
  const cmd = `PGCONNECT_TIMEOUT=6 PGPASSWORD="$(echo ${b64(conf.password)} | base64 -d)" ` +
    `psql -X -w -h ${conf.host} -p ${conf.port} -U ${conf.user} -d ${conf.db} -tAc 'select 1'`;
  try {
    const out = await runOn(SWAP_HOST, cmd, 20000);
    return { ok: /(^|\n)\s*1\s*($|\n)/.test(out), detail: out.trim().slice(-500) };
  } catch (e) {
    return { ok: false, detail: String(e.message || e).slice(-500) };
  }
}

// Rewrite POSTGRES_* in GODCRM_ENV_PATH (keeping a timestamped .bak), atomically, on SWAP_HOST.
// Everything is base64'd so passwords/metachars never hit a shell or sed. Returns the backup path line.
async function applyDbTarget(conf) {
  const py = [
    'import base64,os,time',
    `p=base64.b64decode(${JSON.stringify(b64(GODCRM_ENV_PATH))}).decode()`,
    'vals={',
    `  "POSTGRES_HOST": ${JSON.stringify(b64(conf.host))},`,
    `  "POSTGRES_PORT": ${JSON.stringify(b64(conf.port))},`,
    `  "POSTGRES_DB": ${JSON.stringify(b64(conf.db))},`,
    `  "POSTGRES_USER": ${JSON.stringify(b64(conf.user))},`,
    `  "POSTGRES_PASSWORD": ${JSON.stringify(b64(conf.password))},`,
    '}',
    'vals={k:base64.b64decode(v).decode() for k,v in vals.items()}',
    'src=open(p).read().splitlines() if os.path.exists(p) else []',
    'seen=set(); out=[]',
    'for ln in src:',
    '  k=ln.split("=",1)[0].strip() if ("=" in ln and not ln.lstrip().startswith("#")) else None',
    '  if k in vals: out.append(k+"="+vals[k]); seen.add(k)',
    '  else: out.append(ln)',
    'for k,v in vals.items():',
    '  if k not in seen: out.append(k+"="+v)',
    'bak=p+".dbswap.bak."+str(int(time.time()))',
    'if os.path.exists(p): os.rename(p,bak)',
    'open(p,"w").write("\\n".join(out)+"\\n"); os.chmod(p,0o600)',
    'print("backup="+bak)',
  ].join('\n');
  return runOn(SWAP_HOST, `echo ${b64(py)} | base64 -d | python3`, 60000);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Guard against duplicate command triggers (Telegram polling can deliver the same update twice)
const activeLocks = new Set();        // active deploy operations
const processedMsgIds = new Map();    // msgId → timestamp, auto-cleaned

function acquireLock(key, msgId) {
  // Deduplicate by message ID (same message delivered twice)
  if (processedMsgIds.has(msgId)) return false;
  processedMsgIds.set(msgId, Date.now());
  // Clean old entries (>60s)
  for (const [id, ts] of processedMsgIds) {
    if (Date.now() - ts > 60000) processedMsgIds.delete(id);
  }
  // Prevent concurrent execution of the same operation
  if (activeLocks.has(key)) return false;
  activeLocks.add(key);
  return true;
}

function releaseLock(key) {
  activeLocks.delete(key);
}

function isAuthorized(msg) {
  if (OWNER_ID === 0) return true; // whitelist disabled
  return msg.from.id === OWNER_ID;
}

function denied(msg) {
  bot.sendMessage(msg.chat.id, `⛔ Access denied. Your ID: ${msg.from.id}`);
}

async function run(cmd, timeout = 120000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return (stdout + stderr).trim();
  } catch (e) {
    // Surface stdout/stderr from failed command (execAsync attaches them to the error)
    const out = ((e.stdout || '') + (e.stderr || '')).trim();
    const err = new Error(out || e.message);
    err.stdout = e.stdout;
    err.stderr = e.stderr;
    err.code = e.code;
    throw err;
  }
}

// Run a command on an arbitrary host (local or ssh target).
async function runOn(host, cmd, timeout = 120000) {
  if (isLocal(host)) return run(cmd, timeout);
  // single-quote the remote command; escape any embedded single quotes
  const escaped = cmd.replace(/'/g, `'\\''`);
  return run(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${host} '${escaped}'`, timeout);
}

// PROD command (over ssh if PROD_HOST is remote, otherwise local)
async function runSSH(cmd, timeout = 120000) {
  return runOn(PROD_HOST, cmd, timeout);
}

// DEV command (local by default, or ssh if DEV_HOST is remote)
async function runDEV(cmd, timeout = 120000) {
  return runOn(DEV_HOST, cmd, timeout);
}

// Self-healing build.
// This environment runs with NODE_ENV=production, so npm install/ci silently
// strips devDependencies (vite, esbuild, etc.). A later `npm run build` then dies
// with "vite: not found". buildWithSelfHeal pre-checks the toolchain, reinstalls
// devDeps if it's gone, and as a last resort reinstalls + retries once if the build
// fails on a missing module. onHeal(text) is an optional progress callback.
async function buildWithSelfHeal(runner, codePath, onHeal) {
  const installDevDeps = () =>
    // --include=dev forces devDeps even under NODE_ENV=production; --no-save keeps package.json clean
    runner(`cd ${codePath} && npm install --include=dev --no-save 2>&1`, 300000);

  // Pre-flight: is the build toolchain (vite) actually present?
  const hasVite = await runner(`test -x ${codePath}/node_modules/.bin/vite && echo OK || echo MISSING`)
    .then(o => o.includes('OK'))
    .catch(() => false);
  if (!hasVite) {
    if (onHeal) await onHeal('🩹 vite missing — installing devDependencies...');
    await installDevDeps();
  }

  try {
    return await runner(`cd ${codePath} && npm run build`, 300000);
  } catch (e) {
    const out = String((e && e.message) || '');
    // Build broke on an absent build-time dep → reinstall devDeps and retry exactly once.
    if (/not found|Cannot find (module|package)|MODULE_NOT_FOUND/i.test(out)) {
      if (onHeal) await onHeal('🩹 build failed on a missing dependency — reinstalling devDependencies & retrying...');
      await installDevDeps();
      return await runner(`cd ${codePath} && npm run build`, 300000);
    }
    throw e;
  }
}

function sendLong(chatId, text, prefix = '') {
  const full = prefix + text;
  // Telegram max message: 4096 chars
  if (full.length <= 4000) {
    return bot.sendMessage(chatId, full, { parse_mode: 'HTML' });
  }
  // Send last 3800 chars
  const truncated = '...(truncated)\n' + full.slice(-3800);
  return bot.sendMessage(chatId, truncated, { parse_mode: 'HTML' });
}

// /whoami — show user ID
bot.onText(/\/whoami/, (msg) => {
  bot.sendMessage(msg.chat.id, `Your Telegram ID: <code>${msg.from.id}</code>`, { parse_mode: 'HTML' });
});

// /start
bot.onText(/\/start/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  bot.sendMessage(msg.chat.id, [
    '🤖 <b>GodCRM Deploy Bot</b>',
    '',
    '/status — PM2 status (PROD + DEV)',
    '/restart_prod — restart PROD PM2',
    '/pull_prod — git pull + restart PROD with --update-env',
    '/deploy_dev — build & restart DEV',
    '/deploy_prod — full PROD deploy (build + restart)',
    '/logs — last 50 lines PROD logs',
    '/logs_dev — last 50 lines DEV logs',
    '',
    '🗄 <b>DB failover (ADR-A)</b>',
    '/swap_db — show current DB target + menu',
    '/swap_db &lt;key&gt; — swap godcrm to that DB (pre-flight + restart)',
    '/sync_edit_db — refresh godcrm_edit (design-preview copy) from master A',
    '',
    '🧠 <b>Claude Code</b>',
    '/claude_kill — kill stuck claude processes',
    '/claude_restart — kill + restart in tmux',
    '',
    '/whoami — show your Telegram ID',
  ].join('\n'), { parse_mode: 'HTML' });
});

// /status
bot.onText(/\/status/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Checking...');
      const [prod, dev] = await Promise.all([
        runSSH(`pm2 jlist`).then(json => {
          const apps = JSON.parse(json);
          const app = apps.find(a => a.name === PROD_PM2);
          if (!app) return `PROD: ❓ ${PROD_PM2} not found`;
          const up = app.pm2_env.status === 'online' ? '🟢' : '🔴';
          const mem = Math.round(app.monit.memory / 1024 / 1024);
          const uptime = Math.round((Date.now() - app.pm2_env.pm_uptime) / 60000);
          return `PROD: ${up} ${app.pm2_env.status} | ${mem}MB | uptime ${uptime}m`;
        }).catch(e => `PROD: ❌ ${e.message}`),
        runDEV(`pm2 jlist`).then(json => {
          const apps = JSON.parse(json);
          const app = apps.find(a => a.name === DEV_PM2);
          if (!app) return `DEV: ❓ ${DEV_PM2} not found`;
          const up = app.pm2_env.status === 'online' ? '🟢' : '🔴';
          const mem = Math.round(app.monit.memory / 1024 / 1024);
          const uptime = Math.round((Date.now() - app.pm2_env.pm_uptime) / 60000);
          return `DEV: ${up} ${app.pm2_env.status} | ${mem}MB | uptime ${uptime}m`;
        }).catch(e => `DEV: ❌ ${e.message}`)
      ]);
      await bot.editMessageText(`📊 <b>Status</b>\n\n${prod}\n${dev}`, {
        chat_id: msg.chat.id,
        message_id: sent.message_id,
        parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
  })();
});

// /restart_prod
bot.onText(/\/restart_prod/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('restart_prod', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ PROD restart already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Restarting PROD PM2...');
      const out = await runSSH(`pm2 restart ${PROD_PM2} && pm2 jlist`);
      // Parse jlist from the output (last line should be JSON)
      const lines = out.split('\n');
      const jsonLine = lines.filter(l => l.startsWith('[')).pop();
      let status = 'restarted';
      if (jsonLine) {
        try {
          const apps = JSON.parse(jsonLine);
          const app = apps.find(a => a.name === PROD_PM2);
          if (app) status = app.pm2_env.status;
        } catch {}
      }
      await bot.editMessageText(`✅ PROD restarted — status: <b>${status}</b>`, {
        chat_id: msg.chat.id,
        message_id: sent.message_id,
        parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ Restart failed: ${e.message}`);
    } finally {
      releaseLock('restart_prod');
    }
  })();
});

// /pull_prod — fetch + ff-pull if possible on PROD, then restart PM2 with --update-env
bot.onText(/\/pull_prod/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('pull_prod', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ PROD pull already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ PROD pull...\n1️⃣ git fetch + status');

      // Step 1: fetch origin and inspect divergence (PROD may be ahead of / diverged from origin)
      const statusOut = await runSSH(
        `cd ${PROD_CODE} && git fetch origin 2>&1 && ` +
        `echo "---HEAD---" && git rev-parse --short HEAD && ` +
        `echo "---ORIGIN---" && git rev-parse --short origin/main && ` +
        `echo "---COUNTS---" && git rev-list --left-right --count HEAD...origin/main`
      );
      const parts = statusOut.split('---');
      const head = (parts.find(p => p.startsWith('HEAD---')) || '').replace('HEAD---', '').trim();
      const origin = (parts.find(p => p.startsWith('ORIGIN---')) || '').replace('ORIGIN---', '').trim();
      const counts = (parts.find(p => p.startsWith('COUNTS---')) || '').replace('COUNTS---', '').trim();
      const [aheadStr, behindStr] = counts.split(/\s+/);
      const ahead = parseInt(aheadStr, 10) || 0;
      const behind = parseInt(behindStr, 10) || 0;

      let pullSummary;
      if (behind === 0) {
        pullSummary = `✅ already up-to-date (HEAD ${head}, origin ${origin}, ahead ${ahead})`;
      } else if (ahead > 0 && behind > 0) {
        pullSummary = `⚠️ skipped pull — diverged (HEAD ${head} ahead ${ahead}, origin ${origin} ahead ${behind}). Restarting anyway with local code.`;
      } else {
        // behind > 0 && ahead == 0 → safe to fast-forward
        const pullOut = await runSSH(`cd ${PROD_CODE} && git pull --ff-only 2>&1`);
        pullSummary = `✅ fast-forwarded\n${pullOut.slice(-800)}`;
      }
      const pullSafe = pullSummary.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await bot.editMessageText(`⏳ PROD pull...\n<pre>${pullSafe}</pre>\n2️⃣ pm2 restart ${PROD_PM2} --update-env`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });

      // Step 2: restart PROD PM2 with --update-env (picks up new env + reloaded code)
      await runSSH(`pm2 restart ${PROD_PM2} --update-env`);
      await bot.editMessageText(`✅ <b>PROD pulled &amp; restarted</b>\n\n<pre>${pullSafe}</pre>\n✅ pm2 restart ${PROD_PM2} --update-env\n\n🔗 https://app.godcrm.ai`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      const errSafe = String(e.message || e).replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(-2000);
      bot.sendMessage(msg.chat.id, `❌ PROD pull failed:\n<pre>${errSafe}</pre>`, { parse_mode: 'HTML' });
    } finally {
      releaseLock('pull_prod');
    }
  })();
});

// /deploy_dev
bot.onText(/\/deploy_dev/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('deploy_dev', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ DEV deploy already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      // Single-box mode (DEV == this host, no separate rsync target): skip the sync step.
      const syncing = !!DEV_RSYNC_TARGET && !isLocal(DEV_HOST);
      const sent = await bot.sendMessage(msg.chat.id,
        syncing ? '⏳ Deploying DEV...\n1️⃣ Syncing code from PROD...'
                : '⏳ Deploying DEV...\n1️⃣ Building locally (single-box mode)...');

      // Step 1: rsync PROD→DEV (only when DEV is a separate host)
      if (syncing) {
        await runSSH(
          `rsync -avz --delete --exclude='node_modules' --exclude='.git' --exclude='.env' --exclude='dist' --exclude='deploy-bot' ${PROD_CODE}/ ${DEV_RSYNC_TARGET}:${PROD_CODE}/`,
          180000
        );
        await bot.editMessageText('⏳ Deploying DEV...\n✅ Code synced\n2️⃣ Building on DEV...', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
      }

      // Step 2: build on DEV (self-healing: reinstalls devDeps if vite/toolchain was stripped)
      await buildWithSelfHeal(runDEV, PROD_CODE, (note) =>
        bot.sendMessage(msg.chat.id, note));
      await bot.editMessageText(`⏳ Deploying DEV...\n${syncing ? '✅ Code synced\n' : ''}✅ Built\n3️⃣ Restarting PM2...`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });

      // Step 3: restart DEV PM2
      await runDEV(`pm2 restart ${DEV_PM2}`);
      await bot.editMessageText('✅ <b>DEV deployed!</b>\n\n✅ Code synced\n✅ Built\n✅ PM2 restarted\n\n🔗 https://devcrm.hltrn.cc', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ DEV deploy failed: ${e.message}`);
    } finally {
      releaseLock('deploy_dev');
    }
  })();
});

// /deploy_prod
bot.onText(/\/deploy_prod/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('deploy_prod', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ PROD deploy already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Deploying PROD...\n1️⃣ Building on PROD...');

      // Step 1: build on PROD (self-healing: reinstalls devDeps if vite/toolchain was stripped)
      await buildWithSelfHeal(runSSH, PROD_CODE, (note) =>
        bot.sendMessage(msg.chat.id, note));
      await bot.editMessageText('⏳ Deploying PROD...\n✅ Built\n2️⃣ Restarting PM2...', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });

      // Step 2: restart PROD PM2. v4.0 (.128): app.godcrm.ai static is served by the
      // node app from its own dist/ via proxy_pass:5000 — no nginx docroot copy needed.
      await runSSH(`pm2 restart ${PROD_PM2}`);
      await bot.editMessageText('✅ <b>PROD deployed!</b>\n\n✅ Built\n✅ PM2 restarted\n\n🔗 https://app.godcrm.ai', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ PROD deploy failed: ${e.message}`);
    } finally {
      releaseLock('deploy_prod');
    }
  })();
});

// /sync_edit_db — refresh the design-preview copy DB (godcrm_edit) from master A (local pg_dump).
//   Copy #2 of the v4.0 pipeline: reads master A on THIS box, drop+recreates godcrm_edit, restores.
//   Read-only against master A; only the copy is written. No tunnel (local). Does NOT touch live.
bot.onText(/\/sync_edit_db/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('sync_edit_db', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ edit-DB sync already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Syncing <b>godcrm_edit</b> ← master A (local dump)...', { parse_mode: 'HTML' });
      // Kill live connections to the copy so dropdb can proceed, then rebuild it from master A.
      await runSSH(
        `sudo -u postgres psql -tAc "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='godcrm_edit' AND pid<>pg_backend_pid();" ; ` +
        `sudo -u postgres dropdb --if-exists godcrm_edit && ` +
        `sudo -u postgres createdb -O godcrm godcrm_edit && ` +
        `sudo -u postgres bash -c "pg_dump godcrm_prod | psql -q godcrm_edit"`,
        300000
      );
      const size = (await runSSH(`sudo -u postgres psql -tAc "SELECT pg_size_pretty(pg_database_size('godcrm_edit'));"`)).trim();
      await bot.editMessageText(`✅ <b>godcrm_edit</b> refreshed from master A (${size}).\n\n🔗 https://edit.godcrm.ai`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ edit-DB sync failed: ${e.message}`);
    } finally {
      releaseLock('sync_edit_db');
    }
  })();
});

// /logs
bot.onText(/\/logs$/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Fetching PROD logs...');
      const out = await runSSH(`pm2 logs ${PROD_PM2} --nostream --lines 50 2>&1`);
      await sendLong(msg.chat.id, `<pre>${out.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`, '📋 <b>PROD logs:</b>\n\n');
      await bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {});
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

// /logs_dev
bot.onText(/\/logs_dev/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Fetching DEV logs...');
      const out = await runDEV(`pm2 logs ${DEV_PM2} --nostream --lines 50 2>&1`);
      await sendLong(msg.chat.id, `<pre>${out.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`, '📋 <b>DEV logs:</b>\n\n');
      await bot.deleteMessage(msg.chat.id, sent.message_id).catch(() => {});
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

// /claude_kill — kill stuck claude processes on PROD
bot.onText(/\/claude_kill/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Killing claude processes on PROD...');
      // Find claude processes first
      const ps = await runSSH(`ps aux | grep -E '[c]laude' | head -20`).catch(() => '');
      if (!ps) {
        await bot.editMessageText('ℹ️ No claude processes found on PROD.', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
        return;
      }
      // Kill them
      await runSSH(`pkill -f 'claude' 2>/dev/null; sleep 1; pkill -9 -f 'claude' 2>/dev/null`).catch(() => {});
      // Verify
      const after = await runSSH(`ps aux | grep -E '[c]laude' | head -5`).catch(() => '');
      const status = after ? '⚠️ Some processes may remain' : '✅ All claude processes killed';
      await bot.editMessageText(`${status}\n\n<b>Before:</b>\n<pre>${ps.slice(0, 2000).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

// /claude_restart — kill + restart claude in tmux session on PROD
bot.onText(/\/claude_restart/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  (async () => {
    try {
      const sent = await bot.sendMessage(msg.chat.id, '⏳ Restarting Claude Code on PROD...\n1️⃣ Killing existing processes...');
      // Kill existing claude processes
      await runSSH(`pkill -f 'claude' 2>/dev/null; sleep 1; pkill -9 -f 'claude' 2>/dev/null`).catch(() => {});
      await bot.editMessageText('⏳ Restarting Claude Code on PROD...\n✅ Killed\n2️⃣ Starting in tmux session...', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
      // Create or recreate tmux session with claude
      await runSSH(`tmux kill-session -t claude 2>/dev/null; sleep 1; tmux new-session -d -s claude -c ${PROD_CODE} 'claude'`);
      // Verify tmux session exists
      const tmux = await runSSH(`tmux list-sessions 2>/dev/null | grep claude`).catch(() => '');
      if (tmux) {
        await bot.editMessageText('✅ <b>Claude Code restarted!</b>\n\n✅ Old processes killed\n✅ Running in tmux session <code>claude</code>\n\n💡 Attach: <code>ssh prod</code> → <code>tmux attach -t claude</code>', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
      } else {
        await bot.editMessageText('⚠️ Claude processes killed but tmux session may not have started.\nCheck manually: <code>ssh prod</code> → <code>tmux ls</code>', {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
      }
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ ${e.message}`);
    }
  })();
});

// /swap_db [target] — hot-swap the DB the local godcrm points at (ADR-A break-glass failover).
//   /swap_db            → show current target + available targets
//   /swap_db <key>      → pre-flight check → backup .env → rewrite POSTGRES_* → pm2 restart --update-env
bot.onText(/\/swap_db(?:\s+(\S+))?/, (msg, match) => {
  if (!isAuthorized(msg)) return denied(msg);
  const arg = (match && match[1] ? match[1] : '').trim().toLowerCase();

  (async () => {
    // No arg → status + menu
    if (!arg) {
      if (!DB_TARGETS.length) {
        return bot.sendMessage(msg.chat.id,
          '⚠️ No DB targets configured. Set <code>DB_TARGETS</code> + <code>DB_TARGET_&lt;KEY&gt;_*</code> in deploy-bot/.env',
          { parse_mode: 'HTML' });
      }
      const cur = await readCurrentTarget().catch(() => null);
      const list = DB_TARGETS.map(k => {
        const c = targetConf(k);
        const here = cur && cur.key === k ? ' ⬅️ <b>current</b>' : '';
        return c ? `• <code>${k}</code> → ${c.label} (${c.host}:${c.port}/${c.db})${here}`
                 : `• <code>${k}</code> ⚠️ misconfigured`;
      }).join('\n');
      const curLine = cur ? `now: <b>${cur.host}:${cur.port}/${cur.db}</b>${cur.key ? ` (${cur.key})` : ' (unknown target)'}` : 'now: <i>unknown</i>';
      return bot.sendMessage(msg.chat.id,
        `🗄 <b>DB swap</b>\n${curLine}\n\n<b>Targets:</b>\n${list}\n\nUsage: <code>/swap_db &lt;key&gt;</code>`,
        { parse_mode: 'HTML' });
    }

    if (!DB_TARGETS.includes(arg)) {
      return bot.sendMessage(msg.chat.id,
        `❌ Unknown target <code>${arg}</code>. Known: ${DB_TARGETS.map(k => `<code>${k}</code>`).join(', ') || '(none)'}`,
        { parse_mode: 'HTML' });
    }
    const conf = targetConf(arg);
    if (!conf) {
      return bot.sendMessage(msg.chat.id, `❌ Target <code>${arg}</code> is misconfigured (missing DB_TARGET_${arg.toUpperCase()}_HOST).`, { parse_mode: 'HTML' });
    }
    if (!acquireLock('swap_db', msg.message_id)) {
      return bot.sendMessage(msg.chat.id, '⚠️ DB swap already in progress, skipping duplicate.');
    }

    let sent;
    try {
      sent = await bot.sendMessage(msg.chat.id, `⏳ Swapping DB → <b>${conf.label}</b>\n1️⃣ pre-flight (select 1 @ ${conf.host}:${conf.port})...`, { parse_mode: 'HTML' });

      // 1) pre-flight — never touch the app if the new target is unreachable
      const chk = await checkTarget(conf);
      if (!chk.ok) {
        const d = chk.detail.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return bot.editMessageText(`🛑 <b>Aborted — target unreachable, nothing changed.</b>\n\nTarget <code>${arg}</code> (${conf.host}:${conf.port}/${conf.db})\n<pre>${d}</pre>`, {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
      }

      // 2) backup + rewrite POSTGRES_* on the godcrm .env
      await bot.editMessageText(`⏳ Swapping DB → <b>${conf.label}</b>\n✅ reachable\n2️⃣ backup + rewrite env...`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
      const applied = await applyDbTarget(conf);
      const bak = (applied.match(/backup=(\S+)/) || [])[1] || '(none)';

      // 3) restart godcrm picking up the new env (pool is rebuilt on boot — no hot pool swap)
      await bot.editMessageText(`⏳ Swapping DB → <b>${conf.label}</b>\n✅ reachable\n✅ env rewritten\n3️⃣ pm2 restart ${SWAP_PM2} --update-env...`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
      await runOn(SWAP_HOST, `pm2 restart ${SWAP_PM2} --update-env`, 120000);

      // 4) verify the app actually came up on the new target
      const now = await readCurrentTarget().catch(() => null);
      const okHost = now && now.host === conf.host && now.db === conf.db;
      const note = arg === 'local'
        ? '\n\n⚠️ <i>local = warm standby copy — may lag master; kept fresh by <code>make sync-db</code>.</i>'
        : (arg === 'live' ? '\n\n⚠️ <i>live = master — writes now hit production data.</i>' : '');
      await bot.editMessageText(
        `${okHost ? '✅' : '⚠️'} <b>DB swapped → ${conf.label}</b>\n\n` +
        `host: <b>${now ? now.host : '?'}:${now ? now.port : '?'}/${now ? now.db : '?'}</b>\n` +
        `backup: <code>${bak}</code>\n` +
        `rollback: <code>/swap_db ${DB_TARGETS.find(k => k !== arg) || '&lt;key&gt;'}</code>` +
        `${okHost ? '' : '\n\n⚠️ env written but app did not report the new host — check /logs_dev'}` + note,
        { chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML' });
    } catch (e) {
      const errSafe = String(e.message || e).replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(-1500);
      const tail = `❌ <b>DB swap failed</b>\n<pre>${errSafe}</pre>\nIf env was already rewritten, a <code>.dbswap.bak.*</code> backup sits next to the .env.`;
      if (sent) bot.editMessageText(tail, { chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML' }).catch(() => bot.sendMessage(msg.chat.id, tail, { parse_mode: 'HTML' }));
      else bot.sendMessage(msg.chat.id, tail, { parse_mode: 'HTML' });
    } finally {
      releaseLock('swap_db');
    }
  })();
});

console.log('🤖 Deploy bot started');
console.log(`   PROD target: ${isLocal(PROD_HOST) ? 'local (this box)' : PROD_HOST}`);
console.log(`   DEV target:  ${isLocal(DEV_HOST) ? 'local (this box)' : DEV_HOST}`);
console.log(`   DEV rsync:   ${DEV_RSYNC_TARGET && !isLocal(DEV_HOST) ? DEV_RSYNC_TARGET : 'disabled (single-box)'}`);
console.log(`   code path:   ${PROD_CODE}`);

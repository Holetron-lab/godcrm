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
// /deploy_dev uses make dev; its destination is scripts/deploy.local.env.

// --- Ring 0 promote target (Constitution v4.2) -----------------------------
// CRITICAL: on .128 the SERVED Ring 0 artifact is PROD_LIVE (/srv/godcrm/live),
// a deploy artifact WITHOUT .git, and godcrm runs from there
// (cwd=/srv/godcrm/live, script=backend/server.js). PROD_CODE (the edit-tree)
// is NOT what prod serves — the old /deploy_prod built + restarted the edit-tree,
// which is a SILENT NO-OP for Ring 0 (process bounces on the same old snapshot).
// /deploy_prod now builds a CLEAN committed artifact and rsyncs it INTO PROD_LIVE,
// migrates master A first, then restarts. See CLAUDE.md v4.2 §Deploy / [[deploy-bot-broken-for-frozen-live]].
const PROD_LIVE = process.env.PROD_LIVE || '/srv/godcrm/live';
// Throwaway git worktree at committed HEAD → guarantees ZERO uncommitted WIP ships.
const DEPLOY_WORKTREE = process.env.DEPLOY_WORKTREE || '/root/wt-deploy-prod';
// Migrations run FIRST against master A (local on .128). Order is load-bearing:
// code before migrations = 500s on columns that don't exist yet. Knex is pointed
// at the live master-A .env explicitly (knexfile.js reads process.env only, no dotenv),
// while migration FILES come from the clean artifact's knexfile.
const KNEXFILE = process.env.KNEXFILE || 'backend/database/knexfile.js';
const RUN_MIGRATIONS = process.env.RUN_MIGRATIONS !== '0';

// --- Ring 1 promote target (NL <RING1_IP> / crm.hltrn.cc, master B) -------
// Ring 1 is the OTHER prod ring: real RU/KZ users, its own forked master B, its
// own .env + SECRETS_MASTER_KEY (never shared). Differences from Ring 0 that the
// handler has to respect:
//   * the tree IS what pm2 runs (no /srv/godcrm/live split), but the FRONTEND is
//     served by nginx from a SEPARATE docroot — syncing the tree alone changes
//     nothing a user can see ([[nl-deploy-needs-build]]);
//   * FE must be published AFTER the backend restart. New FE + old BE = 500s for
//     live users on any endpoint the new bundle calls;
//   * the artifact is built HERE (.128) and shipped — NL is a 2-core box and a
//     vite build there would stall the site under load ([[dev72-build-load-spike]]).
// Constitution note: §3 wants Ring 1 to move only via a soaked tag through gate 2.
// The owner-triggered path enforces a tag/SHA pair and a protected gate-2 receipt.
// A per-release owner waiver can replace duration only, never the other gates.
const RING1_HOST = process.env.RING1_HOST || 'newbox';
const RING1_TREE = process.env.RING1_TREE || '/root/production/business-crm';
const RING1_DOCROOT = process.env.RING1_DOCROOT || '/var/www/business-crm';
const RING1_PM2 = process.env.RING1_PM2 || 'godcrm';
const RING1_STAGE = process.env.RING1_STAGE || '/root/ring1-artifact';   // staging dir ON NL
const RING1_WORKTREE = process.env.RING1_WORKTREE || '/root/wt-deploy-ring1';  // build dir on .128
const RING1_HEALTH = process.env.RING1_HEALTH || 'https://crm.hltrn.cc/api/health';
const RING1_URL = process.env.RING1_URL || 'https://crm.hltrn.cc/';
const RING1_BACKUPS = process.env.RING1_BACKUPS || '/root/backups/temp';

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

// Separate fail-closed owner-only history transport; never receives edited_message.
bot.on('message', msg => {
  if (typeof msg.text !== 'string' || !msg.text.startsWith('/history3496')) return;
  require('./history3496.cjs').handleHistory3496(bot, msg, OWNER_ID).catch(() => {});
});

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

// Extract the built entry-bundle hash from a tree's dist/index.html — lets us prove
// the served artifact actually changed after an rsync+restart (D-o8ogII → DCdn6ceu).
async function servedBundle(runner, root) {
  return runner(
    `grep -oE 'assets/index-[A-Za-z0-9_-]+\\.js' ${root}/dist/index.html 2>/dev/null | head -1 || true`
  ).then(s => s.trim() || '(none)').catch(() => '(unknown)');
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
    '/deploy_prod [full SHA] — Ring 0 deploy with isolated lockfile dependencies (default: committed HEAD)',
    '/deploy_ring1_check &lt;tag&gt; &lt;SHA&gt; — read-only Ring 1 pre-flight',
    '/deploy_ring1 &lt;tag&gt; &lt;SHA&gt; — approved Ring 1 release (gate-2 receipt required)',
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
        } catch {
          // PM2 can emit non-JSON output; retain the fallback status above.
        }
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

// /deploy_dev — use the same staging pipeline as the administrator runbook.
bot.onText(/^\/deploy_dev(?:@[A-Za-z0-9_]+)?\s*$/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('deploy_dev', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ DEV deploy already in progress, skipping duplicate.');
  }
  (async () => {
    try {
      // deploy.sh has a fixed canonical source. Do not silently build a different
      // checkout (or fall back to restarting the bot's local application).
      if (PROD_CODE !== '/root/production/business-crm') {
        throw new Error('make dev requires PROD_CODE=/root/production/business-crm');
      }
      const sent = await bot.sendMessage(msg.chat.id,
        '⏳ Deploying DEV via make dev...\nSync, build and staging restart may take several minutes.');
      // Run on the source host, never on DEV. make propagates deploy.sh failures;
      // do not pipe through tail, retry with self-heal, or restart separately.
      await runSSH('make -C /root/production/business-crm dev', 900000);
      await bot.editMessageText('✅ <b>make dev completed.</b>\n\nGate 1 and real API smoke still required.\n\n🔗 https://dev.godcrm.ai', {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
    } catch (e) {
      bot.sendMessage(msg.chat.id, `❌ DEV deploy failed: ${e.message}`);
    } finally {
      releaseLock('deploy_dev');
    }
  })();
});

// /deploy_prod — full Ring 0 promote into the ACTUAL served artifact (/srv/godcrm/live).
//   Order is LOAD-BEARING: build clean artifact → migrate master A → rsync → restart.
//   The artifact is a throwaway worktree at committed HEAD, so ZERO uncommitted WIP ships.
//   (The old handler built + restarted the edit-tree = silent no-op for Ring 0.)
bot.onText(/\/deploy_prod/, (msg) => {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('deploy_prod', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ PROD deploy already in progress, skipping duplicate.');
  }
  (async () => {
    const esc = (s) => String(s == null ? '' : s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let sent;
    let worktreeMade = false;
    let evidence;
    let evidenceSealed = false;
    let outcome = 'failed';
    let runEvidence = runSSH;
    try {
      const { requestedRevision, buildIsolated, recoverRuntime } = await import('./build-inputs.mjs');
      const revision = requestedRevision(msg.text);
      sent = await bot.sendMessage(msg.chat.id, '⏳ Deploying PROD (Ring 0 → /srv/godcrm/live)...\n1️⃣ Materializing clean artifact from committed HEAD...');

      // We deploy what's COMMITTED — never the (possibly dirty) edit-tree working dir.
      const shaFull = (await runSSH(`git -C ${PROD_CODE} rev-parse --verify ${revision}^{commit}`)).trim();
      if (!/^[a-f0-9]{40}$/.test(shaFull)) throw new Error('Invalid resolved commit');
      const sha = shaFull.slice(0, 8);
      const { startReleaseEvidence } = await import('./release-evidence.mjs');
      evidence = await startReleaseEvidence(runSSH, {
        source: PROD_CODE, worktree: DEPLOY_WORKTREE, appSha: shaFull,
        botFile: __filename, root: process.env.DEPLOY_EVIDENCE_ROOT,
      });
      runEvidence = evidence.run;
      await runEvidence('node --version && npm --version');

      const dirty = (await runEvidence(`git -C ${PROD_CODE} status --porcelain | wc -l`)).trim();

      // Refuse an occupied path: it may belong to another deployment. Resolve HEAD
      // once above, then use that exact commit even if main advances while building.
      // The edit checkout's hook links shared modules. Suppress hooks for this
      // command only; buildIsolated still rejects any pre-existing node_modules.
      await runEvidence(
        `test ! -e ${DEPLOY_WORKTREE} && test ! -L ${DEPLOY_WORKTREE} && ` +
        `git -c core.hooksPath=/dev/null -C ${PROD_CODE} worktree add --detach ${DEPLOY_WORKTREE} ${shaFull}`,
        120000
      );
      worktreeMade = true;
      const materializedSha = (await runEvidence(`git -C ${DEPLOY_WORKTREE} rev-parse HEAD`)).trim();
      if (materializedSha !== shaFull) throw new Error('Materialized commit differs from requested commit');

      // Step 2: install and verify this revision's private dependencies, then build.
      await bot.editMessageText(`⏳ Deploying PROD (Ring 0)...\n✅ Clean artifact @ ${sha}${dirty !== '0' ? ` (${dirty} WIP files in edit-tree — <b>excluded</b>)` : ''}\n2️⃣ Building artifact...`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
      const inputs = await buildIsolated(runEvidence, DEPLOY_WORKTREE, `${PROD_CODE}/deploy-bot/build-inputs.mjs`, { productionFrontend: true });
      await bot.sendMessage(msg.chat.id, `📦 <b>Verified build inputs:</b>\n<pre>${esc(inputs.slice(0, 2500))}</pre>`, { parse_mode: 'HTML' });
      const builtBundle = await servedBundle(runEvidence, DEPLOY_WORKTREE);
      await runEvidence(`cd ${DEPLOY_WORKTREE} && find dist -type f -exec sha256sum {} \\;`);
      const hasDist = (await runEvidence(`test -f ${DEPLOY_WORKTREE}/dist/index.html && echo OK || echo MISSING`)).includes('OK');
      if (!hasDist) throw new Error('build produced no dist/index.html — aborting before touching live');

      // Step 3: MIGRATIONS FIRST (master A, local; additive/idempotent, zero-downtime).
      //   knexfile.js reads process.env only, so we point dotenv explicitly at the live
      //   master-A .env, while migration FILES come from the artifact's knexfile. Deterministic:
      //   right DB (live .env) + right migrations (committed HEAD), no secrets touch the shell.
      if (RUN_MIGRATIONS) {
        await bot.editMessageText(`⏳ Deploying PROD (Ring 0)...\n✅ Built <code>${esc(builtBundle)}</code>\n3️⃣ Migrating master A (knex migrate:latest)...`, {
          chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
        });
        const mig = await runEvidence(
          `cd ${DEPLOY_WORKTREE} && NODE_ENV=production DOTENV_CONFIG_PATH=${PROD_LIVE}/.env ` +
          `node -r dotenv/config node_modules/.bin/knex migrate:latest --knexfile ${KNEXFILE} 2>&1`,
          300000
        );
        await bot.sendMessage(msg.chat.id, `🗄 <b>Migrations (master A):</b>\n<pre>${esc(mig.slice(-1500))}</pre>`, { parse_mode: 'HTML' });
      }

      // Step 4: CODE SWAP — rsync clean artifact → live. NO --delete; preserve mutable state
      //   Preserve PES SQLite/WAL/state and data even when tracked in the artifact.
      const liveBefore = await servedBundle(runEvidence, PROD_LIVE);
      await bot.editMessageText(`⏳ Deploying PROD (Ring 0)...\n✅ Built\n${RUN_MIGRATIONS ? '✅ Migrations applied\n' : ''}4️⃣ Syncing artifact → ${PROD_LIVE}...`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
      await runEvidence(
        `rsync -a --exclude='.env' --exclude='uploads/' --exclude='node_modules' ` +
        `--exclude='.git' --exclude='docs/.snapshots/' --exclude='deploy-bot' --exclude='/.mcp.json' ` +
        `--exclude='/pes-core/pes-data/***' --exclude='/data/***' ` +
        `${DEPLOY_WORKTREE}/ ${PROD_LIVE}/`,
        300000
      );
      const liveAfter = await servedBundle(runEvidence, PROD_LIVE);

      // Reinstall and verify even when lock hashes match: an earlier failed
      // npm ci may already have copied this lock and destroyed node_modules.
      await bot.sendMessage(msg.chat.id, '📦 Rebuilding and verifying live runtime dependencies...');
      await recoverRuntime(runEvidence, PROD_LIVE, `${PROD_CODE}/deploy-bot/build-inputs.mjs`);

      // Step 4c: stamp the promoted SHA into the live tree. /srv/godcrm/live has no .git,
      //   so without this marker the only way to tell what Ring 0 is running is a file-by-file
      //   diff against the edit-tree — which is how every promote audit has started so far.
      //   Written AFTER the rsync (the artifact carries no such file) and BEFORE the restart,
      //   so a crash between the two still leaves the tree correctly labelled. Not in .git,
      //   and rsync runs without --delete, so nothing later removes it.
      await runEvidence(
        `printf '%s %s %s\\n' ${shaFull} "$(date -Is)" ${JSON.stringify(liveAfter)} > ${PROD_LIVE}/.promoted-sha`
      ).catch(() => {});

      // Step 5: restart godcrm. The BOT is the executor (A4) — this is exactly the step the
      //   agent cannot do (IRON RULE 2). Restart last, after code + schema are in place.
      await bot.editMessageText(`⏳ Deploying PROD (Ring 0)...\n✅ Built\n${RUN_MIGRATIONS ? '✅ Migrations\n' : ''}✅ Synced <code>${esc(liveBefore)}</code> → <code>${esc(liveAfter)}</code>\n5️⃣ Restarting PM2 ${PROD_PM2}...`, {
        chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML'
      });
      await runEvidence(`pm2 restart ${PROD_PM2}`);

      outcome = 'completed';
      const swapOk = liveAfter !== '(none)' && liveAfter === builtBundle;
      await bot.editMessageText(
        `✅ <b>PROD deployed (Ring 0)!</b>\n\n` +
        `commit: <code>${sha}</code>\n` +
        `bundle: <code>${esc(liveBefore)}</code> → <code>${esc(liveAfter)}</code>\n` +
        `${swapOk ? '✅ live now serves the freshly-built artifact' : '⚠️ served bundle ≠ built bundle — check /logs'}\n` +
        `${RUN_MIGRATIONS ? '✅ migrations applied\n' : ''}✅ PM2 restarted\n\n🔗 https://app.godcrm.ai`,
        { chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML' }
      );
    } catch (e) {
      const errSafe = String(e.message || e).replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(-2000);
      const tail = `❌ <b>PROD deploy failed:</b>\n<pre>${errSafe}</pre>`;
      if (sent) bot.editMessageText(tail, { chat_id: msg.chat.id, message_id: sent.message_id, parse_mode: 'HTML' }).catch(() => bot.sendMessage(msg.chat.id, tail, { parse_mode: 'HTML' }));
      else bot.sendMessage(msg.chat.id, tail, { parse_mode: 'HTML' });
    } finally {
      // Evidence must seal before cleanup. If persistence fails, preserve the
      // worktree for administrator recovery; never silently discard diagnostics.
      if (evidence) {
        try {
          const archive = await evidence.finish(outcome);
          evidenceSealed = true;
          await bot.sendMessage(msg.chat.id, `Evidence: ${archive.dir}\nSHA256SUMS: ${archive.manifestSha256}`);
        } catch {
          await bot.sendMessage(msg.chat.id, 'Evidence seal failed; worktree retained for investigation.').catch(() => {});
        }
      }
      if (worktreeMade && evidenceSealed) {
        await runSSH(`git -C ${PROD_CODE} worktree remove --force ${DEPLOY_WORKTREE} 2>/dev/null; git -C ${PROD_CODE} worktree prune`, 60000).catch(() => {});
      }
      releaseLock('deploy_prod');
    }
  })();
});

// Ring 1 requires an explicit tag/SHA pair and a reviewed gate-2 receipt.
// The owner may waive soak duration in that receipt; other gates still apply.
function ring1Deploy(msg, dryRun) {
  if (!isAuthorized(msg)) return denied(msg);
  if (!acquireLock('deploy_ring1', msg.message_id)) {
    return bot.sendMessage(msg.chat.id, '⚠️ Ring 1 operation already in progress.');
  }
  (async () => {
    try {
      if (!isLocal(PROD_HOST)) throw Error('Ring 1 requires the build host to be local to this bot');
      const { deployRing1 } = await import('./ring1-release.mjs');
      await deployRing1({
        text: msg.text, dryRun, runLocal: runSSH,
        runRemote: (command, timeout) => runOn(RING1_HOST, command, timeout),
        report: text => bot.sendMessage(msg.chat.id, text),
        config: {
          source: PROD_CODE, worktree: RING1_WORKTREE, host: RING1_HOST,
          tree: RING1_TREE, stage: RING1_STAGE, docroot: RING1_DOCROOT,
          pm2: RING1_PM2, health: RING1_HEALTH, url: RING1_URL,
          backups: RING1_BACKUPS, knexfile: KNEXFILE, botFile: __filename,
          evidenceRoot: process.env.DEPLOY_EVIDENCE_ROOT || '/var/lib/godcrm/deploy-evidence',
          approvalRoot: process.env.RING1_APPROVAL_ROOT || '/var/lib/godcrm/ring1-approvals',
        },
      });
    } catch (error) {
      const { clean } = await import('./release-evidence.mjs');
      await bot.sendMessage(msg.chat.id, `❌ Ring 1 failed: ${clean(error.message).slice(-2500)}`);
    } finally {
      releaseLock('deploy_ring1');
    }
  })();
}

bot.onText(/^\/deploy_ring1_check(?:@\w+)?(?:\s|$)/, msg => ring1Deploy(msg, true));
bot.onText(/^\/deploy_ring1(?:@\w+)?(?:\s|$)/, msg => ring1Deploy(msg, false));

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
console.log('   DEV deploy: make dev (destination: scripts/deploy.local.env on source host)');
console.log(`   code path:   ${PROD_CODE}`);

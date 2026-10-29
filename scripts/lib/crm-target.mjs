/**
 * Куда смотрят SMM-скрипты (apify-ingest-manual, score-posts, benchmark-own,
 * apply-row-patch): локальная база этого сервера или чужая установка CRM по API.
 *
 * По умолчанию — установка этого сервера (app.godcrm.ai, master A): чтение из
 * локальной БД, проект «69 level» в Space 7826 — реестр аккаунтов 100851,
 * посты 100852. Переехало с crm.hltrn.cc (там были 100330/100331) 2026-10-01.
 * Секреты (токен Apify, URL вебхука) берутся из vault этого спейса (ADR-0040).
 *
 * Для другой установки задать:
 *   CRM_BASE=https://<host>
 *   CRM_TOKEN=<Bearer-токен пользователя на той стороне>
 *   CRM_ACCOUNTS_TABLE=<id> CRM_POSTS_TABLE=<id> CRM_WEBHOOK_URL=<входящий вебхук>
 * С CRM_TOKEN строки читаются через GET /api/v3/tables/:id/rows, база не трогается.
 *
 * Если эта же установка живёт под другим хостом — CRM_LOCAL_BASE=<host>.
 */

const LOCAL_BASE = (process.env.CRM_LOCAL_BASE || 'https://app.godcrm.ai').replace(/\/$/, '');
export const CRM_BASE = (process.env.CRM_BASE || LOCAL_BASE).replace(/\/$/, '');
export const CRM_TOKEN = process.env.CRM_TOKEN || null;
export const ACCOUNTS_TABLE = Number(process.env.CRM_ACCOUNTS_TABLE || 100851);
export const POSTS_TABLE = Number(process.env.CRM_POSTS_TABLE || 100852);
/** Спейс, в чьём vault лежат `apify_token` и `apify_crm_webhook_url`. */
export const SPACE_ID = Number(process.env.CRM_SPACE_ID || 7826);
/** От чьего имени пишем строки без CRM_TOKEN (владелец спейса). */
export const CRM_USER_ID = Number(process.env.CRM_USER_ID || 5);
export const IS_REMOTE = CRM_BASE !== LOCAL_BASE;

// Чужая установка без своего токена и ID таблиц = тихо читать/писать эту. Не стартуем.
if (IS_REMOTE) {
  const missing = ['CRM_TOKEN', 'CRM_ACCOUNTS_TABLE', 'CRM_POSTS_TABLE'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`CRM_BASE=${CRM_BASE}: не заданы ${missing.join(', ')}`);
    process.exit(2);
  }
}

let dbAll = null;
async function localDb() {
  if (!dbAll) {
    const dotenv = (await import('dotenv')).default;
    dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });
    ({ dbAll } = await import('../../backend/database/connection.js'));
  }
  return dbAll;
}

/** Все строки таблицы в виде [{id, data}] — из API, если задан CRM_TOKEN, иначе из локальной БД. */
export async function loadRows(tableId) {
  if (!CRM_TOKEN) {
    const all = await localDb();
    const rows = await all('SELECT id, data FROM table_rows WHERE table_id = $1', [tableId]);
    return rows.map((r) => ({ id: r.id, data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data }));
  }
  const out = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${CRM_BASE}/api/v3/tables/${tableId}/rows?limit=500&page=${page}`, {
      headers: { Authorization: `Bearer ${CRM_TOKEN}` },
    });
    if (!res.ok) throw new Error(`GET rows ${tableId} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { rows, pagination } = (await res.json()).data;
    out.push(...rows.map((r) => ({ id: r.id, data: r.data || {} })));
    if (!pagination || page >= pagination.pages) break;
  }
  return out;
}

/** Токен для записи: CRM_TOKEN, а без него — подписанный JWT_SECRET этого сервера (только для своей установки). */
export async function writeToken(userId) {
  if (CRM_TOKEN) return CRM_TOKEN;
  const dotenv = (await import('dotenv')).default;
  dotenv.config({ path: new URL('../../.env', import.meta.url).pathname });
  if (!process.env.JWT_SECRET) throw new Error('нет ни CRM_TOKEN, ни JWT_SECRET в .env');
  const jwt = (await import('jsonwebtoken')).default;
  return jwt.sign({ id: userId, userId, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30m' });
}

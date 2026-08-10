// ============================================================
// PES CRM Client — Bidirectional Bridge to God CRM API
// ============================================================
// Makes HTTP calls to God CRM on behalf of the pet.
// Level-gated: crm_read (L8), crm_write (L10), analytics (L12), crm_tasks (L15).
// ============================================================

import { sign } from 'node:crypto';
import { createHmac } from 'node:crypto';

const DEFAULT_BASE = 'http://127.0.0.1:5000';

// Generate a JWT token for PES service account
function makeServiceToken(secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    userId: 'pes-service',
    role: 'admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
  })).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

export class CrmClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl  — CRM API base (default: http://127.0.0.1:5000)
   * @param {string} opts.jwtSecret — JWT_SECRET from .env
   * @param {number} opts.spaceId  — Default space ID (11 = Development)
   */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    this.jwtSecret = opts.jwtSecret || '';
    this.spaceId = opts.spaceId || 11;
    this._token = null;
    this._tokenExp = 0;
    this._tableCache = null; // cached table list for space
    this._tableCacheExp = 0;
  }

  // ── Auth ─────────────────────────────────────────────────

  _getToken() {
    if (this._token && Date.now() < this._tokenExp) return this._token;
    this._token = makeServiceToken(this.jwtSecret);
    this._tokenExp = Date.now() + 50 * 60 * 1000; // refresh in 50 min
    return this._token;
  }

  // ── HTTP ─────────────────────────────────────────────────

  async _fetch(path, opts = {}) {
    const url = `${this.baseUrl}/api/v3${path}`;
    const headers = {
      'Authorization': `Bearer ${this._getToken()}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    };
    try {
      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error(`[CRM] ${opts.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error(`[CRM] ${opts.method || 'GET'} ${path} error:`, err.message);
      return null;
    }
  }

  // ── Table Discovery ──────────────────────────────────────

  async getTables(spaceId) {
    const sid = spaceId || this.spaceId;
    if (this._tableCache && Date.now() < this._tableCacheExp) return this._tableCache;
    const res = await this._fetch(`/spaces/${sid}/tables`);
    if (res?.data) {
      this._tableCache = res.data;
      this._tableCacheExp = Date.now() + 5 * 60 * 1000;
    }
    return res?.data || [];
  }

  async findTable(nameQuery) {
    const tables = await this.getTables();
    if (!tables.length) return null;
    const q = nameQuery.toLowerCase();
    return tables.find(t =>
      t.name?.toLowerCase().includes(q) ||
      t.display_name?.toLowerCase()?.includes(q)
    ) || null;
  }

  // ── Table Schema ─────────────────────────────────────────

  async getColumns(tableId) {
    const res = await this._fetch(`/tables/${tableId}/columns`);
    return res?.data || res || [];
  }

  // ── Row CRUD ─────────────────────────────────────────────

  async getRows(tableId, { limit = 20, offset = 0, search = '', filters = {} } = {}) {
    let path = `/tables/${tableId}/rows?limit=${limit}&offset=${offset}`;
    if (search) path += `&search=${encodeURIComponent(search)}`;
    const res = await this._fetch(path);
    return res?.data || res?.rows || [];
  }

  async getRow(tableId, rowId) {
    const res = await this._fetch(`/tables/${tableId}/rows/${rowId}`);
    return res?.data || res || null;
  }

  async createRow(tableId, data) {
    const res = await this._fetch(`/tables/${tableId}/rows`, {
      method: 'POST',
      body: { data },
    });
    return res?.data || res || null;
  }

  async updateRow(tableId, rowId, data) {
    const res = await this._fetch(`/tables/${tableId}/rows/${rowId}`, {
      method: 'PUT',
      body: { data },
    });
    return res?.data || res || null;
  }

  // ── High-Level Queries ───────────────────────────────────

  /**
   * Search across all tables in the space for a text query.
   * Returns: [{ table, rows }]
   */
  async searchAll(query, { maxTables = 5, maxRows = 5 } = {}) {
    const tables = await this.getTables();
    if (!tables.length) return [];
    const results = [];
    for (const table of tables.slice(0, maxTables)) {
      const rows = await this.getRows(table.id, { search: query, limit: maxRows });
      if (rows.length) {
        results.push({ table: table.name || table.display_name, tableId: table.id, rows });
      }
    }
    return results;
  }

  /**
   * Get a summary of all tables (name, row count).
   */
  async getSpaceSummary() {
    const tables = await this.getTables();
    const summary = [];
    for (const t of tables) {
      const rows = await this.getRows(t.id, { limit: 1 });
      summary.push({
        name: t.name || t.display_name,
        id: t.id,
        rowCount: rows.length > 0 ? '1+' : '0',
      });
    }
    return summary;
  }

  /**
   * Format rows for display in chat (compact text).
   */
  formatRows(rows, maxFields = 5) {
    if (!rows || !rows.length) return 'Ничего не найдено.';
    return rows.slice(0, 10).map((row, i) => {
      const data = row.data || row;
      const fields = Object.entries(data)
        .filter(([k, v]) => v != null && v !== '' && !k.startsWith('_') && k !== 'id')
        .slice(0, maxFields)
        .map(([k, v]) => {
          const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 50) : String(v).slice(0, 80);
          return `  ${k}: ${val}`;
        });
      return `#${i + 1}\n${fields.join('\n')}`;
    }).join('\n\n');
  }
}

export default CrmClient;

// backend/services/content-aggregator/crm-storage.js
// CRM storage and deduplication for Content Aggregation Service

import { CRM_API_BASE, CONTENT_TABLE_ID } from './config.js';
import { log, truncate, fetchJSON, getCRMAuthToken } from './helpers.js';

/**
 * Fetch existing content titles from CRM table to deduplicate
 * @param {string|null} token - JWT auth token
 * @returns {Promise<Set<string>>} Set of existing titles (lowercased)
 */
export async function getExistingTitles(token) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetchJSON(
      `${CRM_API_BASE}/tables/${CONTENT_TABLE_ID}/rows?limit=500`,
      { headers },
      20000
    );

    const rows = resp?.data?.rows || resp?.data || [];
    const titles = new Set();

    for (const row of rows) {
      const data = row.data || row;
      const title = (data.title || '').toLowerCase().trim();
      if (title) titles.add(title);
    }

    log.info({ existingCount: titles.size }, 'CRM: loaded existing titles for dedup');
    return titles;
  } catch (err) {
    log.warn({ err: err.message }, 'CRM: failed to load existing titles (will skip dedup)');
    return new Set();
  }
}

/**
 * Store a content item in CRM table 2603
 * @param {object} item - Content item to store
 * @param {string|null} token - JWT auth token
 * @returns {Promise<{success: boolean, id?: number, error?: string}>}
 */
export async function storeInCRM(item, token) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Build the body field: combine description + metadata
    const bodyParts = [];
    if (item.description || item.selftext) {
      bodyParts.push(item.description || item.selftext);
    }
    if (item.url) {
      bodyParts.push(`\nLink: ${item.url}`);
    }
    if (item.score) {
      bodyParts.push(`Score: ${item.score}`);
    }
    if (item.author) {
      bodyParts.push(`Author: ${item.author}`);
    }
    if (item.subreddit) {
      bodyParts.push(`Subreddit: r/${item.subreddit}`);
    }
    if (item.source_name) {
      bodyParts.push(`Feed: ${item.source_name}`);
    }

    const rowData = {
      title: truncate(item.title, 255),
      body: bodyParts.join('\n'),
      status: 'draft',
      platform: 'telegram',
      source: item.source || 'unknown',
      source_url: item.url || '',
      source_id: item.source_id || '',
      score: item.score || 0,
      fetched_at: new Date().toISOString(),
    };

    const resp = await fetchJSON(
      `${CRM_API_BASE}/tables/${CONTENT_TABLE_ID}/rows`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: rowData }),
      },
      15000
    );

    const newId = resp?.data?.id || resp?.id;
    return { success: true, id: newId };
  } catch (err) {
    log.warn({ err: err.message, title: item.title }, 'CRM: failed to store item');
    return { success: false, error: err.message };
  }
}

/**
 * Fetch queued (draft) content from CRM table
 * @returns {Promise<Array>}
 */
export async function getContentQueue() {
  try {
    const token = await getCRMAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const resp = await fetchJSON(
      `${CRM_API_BASE}/tables/${CONTENT_TABLE_ID}/rows?limit=100`,
      { headers },
      20000
    );

    const rows = resp?.data?.rows || resp?.data || [];

    // Filter to draft/pending items
    return rows.filter(row => {
      const data = row.data || row;
      const status = (data.status || '').toLowerCase();
      return status === 'draft' || status === 'pending' || status === '';
    }).map(row => {
      const data = row.data || row;
      return {
        id: row.id,
        title: data.title,
        body: data.body,
        source: data.source,
        source_url: data.source_url,
        status: data.status,
        platform: data.platform,
        score: data.score,
        fetched_at: data.fetched_at,
        created_at: row.created_at,
      };
    });
  } catch (err) {
    log.error({ err: err.message }, 'Failed to fetch content queue');
    throw err;
  }
}

/**
 * Publish a content item to Telegram channel
 * @param {number} rowId - CRM row ID
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 */
export async function publishToTelegram(rowId) {
  try {
    const token = await getCRMAuthToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Fetch the row
    const resp = await fetchJSON(
      `${CRM_API_BASE}/tables/${CONTENT_TABLE_ID}/rows/${rowId}`,
      { headers },
      15000
    );

    const row = resp?.data;
    if (!row) {
      return { success: false, error: 'Row not found' };
    }

    const data = row.data || row;
    const title = data.title || 'Untitled';
    const body = data.body || '';
    const sourceUrl = data.source_url || '';

    // Format message for Telegram
    const lines = [];
    lines.push(`*${title.replace(/([_*`\[\]])/g, '\\$1')}*`);
    if (body) {
      lines.push('');
      // Take first 300 chars of body for Telegram
      const snippet = body.length > 300 ? body.slice(0, 300) + '...' : body;
      lines.push(snippet.replace(/([_*`\[\]])/g, '\\$1'));
    }
    if (sourceUrl) {
      lines.push('');
      lines.push(`[Read more](${sourceUrl})`);
    }
    lines.push('');
    lines.push(`Source: ${data.source || 'web'}`);

    const message = lines.join('\n');

    // Send via TelegramService — post to public channel, not admin chat
    const { sendChannelPost } = await import('../TelegramService.js');
    const tgResult = await sendChannelPost(message);

    if (tgResult.success) {
      // Update row status to 'published'
      try {
        await fetchJSON(
          `${CRM_API_BASE}/tables/${CONTENT_TABLE_ID}/rows/${rowId}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({
              data: { ...data, status: 'published', published_at: new Date().toISOString() },
            }),
          },
          15000
        );
      } catch (updateErr) {
        log.warn({ err: updateErr.message, rowId }, 'Failed to update row status after publish');
      }

      return { success: true, message: 'Published to Telegram', messageId: tgResult.messageId };
    } else {
      return { success: false, error: tgResult.error || 'Telegram send failed' };
    }
  } catch (err) {
    log.error({ err: err.message, rowId }, 'Failed to publish to Telegram');
    return { success: false, error: err.message };
  }
}

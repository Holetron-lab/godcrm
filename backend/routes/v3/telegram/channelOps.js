// backend/routes/v3/telegram/channelOps.js
// Channel posting API: post, stats, schedule

import { apiLogger, sendChannelPost, sendChannelPhoto, getChannelMemberCount, dbRun, isPostgres } from './shared.js';

/**
 * Register channel operation routes on the given router.
 */
export default function registerChannelOps(router) {
  /**
   * POST /api/v3/telegram/channel/post
   * Post content to the @godcrm Telegram channel.
   * Body: { text, photo_url?, disable_preview?, reply_markup? }
   * Returns: { success, message_id }
   */
  router.post('/channel/post', async (req, res) => {
    try {
      const { text, photo_url, disable_preview, reply_markup } = req.body;
      if (!text && !photo_url) {
        return res.status(400).json({ success: false, error: 'Either text or photo_url is required' });
      }

      const options = {};
      if (disable_preview) options.disable_web_page_preview = true;
      if (reply_markup) options.reply_markup = reply_markup;

      let result;
      if (photo_url) {
        result = await sendChannelPhoto(photo_url, text || '', options);
      } else {
        result = await sendChannelPost(text, options);
      }

      if (!result.success) {
        return res.status(500).json({ success: false, error: result.error });
      }

      res.json({ success: true, message_id: result.messageId });
    } catch (err) {
      apiLogger.error({ err }, '[Telegram] Channel post error');
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * GET /api/v3/telegram/channel/stats
   * Get channel statistics (member count, etc.)
   */
  router.get('/channel/stats', async (req, res) => {
    try {
      const memberCount = await getChannelMemberCount();

      res.json({
        success: true,
        channel: '@godcrm',
        channel_url: 'https://t.me/godcrm',
        members: memberCount.success ? memberCount.count : null,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  /**
   * POST /api/v3/telegram/channel/schedule
   * Schedule a post for later publishing (stores in content queue).
   * Body: { text, photo_url?, publish_at }
   * For now: stores to DB, a cron job will pick up and publish.
   */
  router.post('/channel/schedule', async (req, res) => {
    try {
      const { text, photo_url, publish_at } = req.body;

      if (!text) {
        return res.status(400).json({ success: false, error: 'text is required' });
      }

      if (!publish_at) {
        return res.status(400).json({ success: false, error: 'publish_at is required (ISO 8601)' });
      }

      // Store scheduled post in content pipeline table (2603) or a dedicated scheduled posts table
      const rowData = JSON.stringify({
        title: text.substring(0, 100),
        body: text,
        photo_url: photo_url || null,
        status: 'scheduled',
        platform: 'telegram',
        publish_at: publish_at,
        content_type: 'post',
        created_at: new Date().toISOString(),
      });

      let result;
      if (isPostgres()) {
        result = await dbRun(
          `INSERT INTO table_rows (table_id, data, created_at, updated_at)
           VALUES (2603, $1::jsonb, NOW(), NOW())
           RETURNING id`,
          [rowData]
        );
      } else {
        result = await dbRun(
          `INSERT INTO table_rows (table_id, data, created_at, updated_at)
           VALUES (2603, ?, datetime('now'), datetime('now'))`,
          [rowData]
        );
      }

      const rowId = result?.rows?.[0]?.id || result?.lastInsertRowid;

      res.json({
        success: true,
        row_id: rowId,
        publish_at,
        status: 'scheduled',
      });
    } catch (err) {
      apiLogger.error({ err }, '[Telegram] Channel schedule error');
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

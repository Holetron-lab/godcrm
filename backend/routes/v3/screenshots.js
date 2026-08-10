import { Router } from 'express';
import { takeScreenshot, screenshotWidget, screenshotTable, generatePostCard, saveScreenshot } from '../../services/ScreenshotService.js';

const router = Router();

// Take screenshot of any URL
router.post('/url', async (req, res) => {
  try {
    const { url, width, height, fullPage, selector, delay } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    const buffer = await takeScreenshot(url, { width, height, fullPage, selector, delay });
    const filename = `screenshot-${Date.now()}.png`;
    const filePath = saveScreenshot(buffer, filename);

    res.json({
      success: true,
      filename,
      path: filePath,
      size: buffer.length,
      url: `/uploads/screenshots/${filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Screenshot a CRM widget
router.post('/widget/:id', async (req, res) => {
  try {
    const widgetId = req.params.id;
    const buffer = await screenshotWidget(widgetId, req.body);
    const filename = `widget-${widgetId}-${Date.now()}.png`;
    const filePath = saveScreenshot(buffer, filename);

    res.json({
      success: true,
      filename,
      path: filePath,
      size: buffer.length,
      url: `/uploads/screenshots/${filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Screenshot a CRM table
router.post('/table/:id', async (req, res) => {
  try {
    const tableId = req.params.id;
    const buffer = await screenshotTable(tableId, req.body);
    const filename = `table-${tableId}-${Date.now()}.png`;
    const filePath = saveScreenshot(buffer, filename);

    res.json({
      success: true,
      filename,
      path: filePath,
      size: buffer.length,
      url: `/uploads/screenshots/${filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate a styled post card
router.post('/post-card', async (req, res) => {
  try {
    const { title, summary, source, sourceUrl, category } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const buffer = await generatePostCard({ title, summary, source, sourceUrl, category });
    const filename = `postcard-${Date.now()}.png`;
    const filePath = saveScreenshot(buffer, filename);

    res.json({
      success: true,
      filename,
      path: filePath,
      size: buffer.length,
      url: `/uploads/screenshots/${filename}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate post card and send directly to Telegram channel
router.post('/post-card/publish', async (req, res) => {
  try {
    const { title, summary, source, sourceUrl, category, caption } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const buffer = await generatePostCard({ title, summary, source, sourceUrl, category });

    // Dynamic import to avoid circular deps
    const { sendChannelPhotoBuffer } = await import('../../services/TelegramService.js');
    const result = await sendChannelPhotoBuffer(buffer, caption || title);

    if (result && result.success) {
      const filename = `postcard-published-${Date.now()}.png`;
      saveScreenshot(buffer, filename);

      res.json({
        success: true,
        telegram: result,
        filename,
        url: `/uploads/screenshots/${filename}`
      });
    } else {
      res.status(500).json({ error: 'Failed to send to Telegram', details: result });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

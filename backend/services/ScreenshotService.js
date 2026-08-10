// backend/services/ScreenshotService.js
// Screenshot Service for GOD CRM
// Auto-generates screenshots from CRM pages for Telegram posts
// Uses Playwright with Chromium for headless browser rendering

import { chromium } from 'playwright';
import { apiLogger } from '../utils/logger.js';
import path from 'path';
import fs from 'fs';

const logger = apiLogger;

// Screenshot cache directory
const SCREENSHOT_DIR = path.join(process.cwd(), 'uploads', 'screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Take a screenshot of any URL
 * @param {string} url - URL to screenshot
 * @param {object} opts - Options
 * @param {number} opts.width - Viewport width (default: 1200)
 * @param {number} opts.height - Viewport height (default: 630)
 * @param {boolean} opts.fullPage - Capture full page (default: false)
 * @param {string} opts.selector - CSS selector to capture specific element
 * @param {number} opts.delay - Wait ms after load (default: 1000)
 * @returns {Buffer} PNG buffer
 */
export async function takeScreenshot(url, opts = {}) {
  const { width = 1200, height = 630, fullPage = false, selector = null, delay = 1000 } = opts;

  let browser;
  try {
    logger.info(`[ScreenshotService] Taking screenshot of: ${url}`);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 2 // Retina quality
    });

    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    if (delay > 0) {
      await page.waitForTimeout(delay);
    }

    let buffer;
    if (selector) {
      const element = await page.$(selector);
      if (element) {
        buffer = await element.screenshot({ type: 'png' });
      } else {
        logger.warn(`[ScreenshotService] Selector "${selector}" not found, taking full page`);
        buffer = await page.screenshot({ type: 'png', fullPage });
      }
    } else {
      buffer = await page.screenshot({ type: 'png', fullPage });
    }

    logger.info(`[ScreenshotService] Screenshot taken: ${buffer.length} bytes`);
    return buffer;

  } catch (error) {
    logger.error(`[ScreenshotService] Error: ${error.message}`);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Take a screenshot of a CRM widget/dashboard
 * @param {number} widgetId - Widget ID
 * @param {object} opts - Screenshot options
 * @returns {Buffer} PNG buffer
 */
export async function screenshotWidget(widgetId, opts = {}) {
  const baseUrl = process.env.CRM_BASE_URL || 'https://devcrm.hltrn.cc';
  const url = `${baseUrl}/widgets/${widgetId}`;
  return takeScreenshot(url, { ...opts, delay: 2000 });
}

/**
 * Take a screenshot of a CRM table view
 * @param {number} tableId - Table ID
 * @param {object} opts - Screenshot options
 * @returns {Buffer} PNG buffer
 */
export async function screenshotTable(tableId, opts = {}) {
  const baseUrl = process.env.CRM_BASE_URL || 'https://devcrm.hltrn.cc';
  const url = `${baseUrl}/tables/${tableId}`;
  return takeScreenshot(url, { ...opts, delay: 2000 });
}

/**
 * Generate a styled post card image from HTML template
 * @param {object} data - Post data
 * @param {string} data.title - Post title
 * @param {string} data.summary - Post summary
 * @param {string} data.source - Source name (Reddit, HN, etc.)
 * @param {string} data.sourceUrl - Link to original
 * @param {string} data.category - Category tag
 * @returns {Buffer} PNG buffer
 */
export async function generatePostCard(data) {
  const { title, summary, source = '', sourceUrl = '', category = 'AI News' } = data;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex; align-items: center; justify-content: center;
  }
  .card {
    width: 1100px; height: 530px;
    background: rgba(255,255,255,0.95);
    border-radius: 24px;
    padding: 48px;
    display: flex; flex-direction: column;
    justify-content: space-between;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  }
  .category {
    display: inline-block;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    padding: 8px 20px;
    border-radius: 20px;
    font-size: 18px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .title {
    font-size: 42px;
    font-weight: 800;
    color: #1a1a2e;
    line-height: 1.2;
    margin: 16px 0;
    max-height: 200px;
    overflow: hidden;
  }
  .summary {
    font-size: 22px;
    color: #4a4a6a;
    line-height: 1.5;
    max-height: 100px;
    overflow: hidden;
  }
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 2px solid #eee;
    padding-top: 20px;
  }
  .source {
    font-size: 18px;
    color: #888;
  }
  .brand {
    font-size: 24px;
    font-weight: 800;
    background: linear-gradient(135deg, #667eea, #764ba2);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
</style>
</head>
<body>
  <div class="card">
    <div>
      <span class="category">${escapeHtml(category)}</span>
    </div>
    <div class="title">${escapeHtml(title)}</div>
    <div class="summary">${escapeHtml(summary)}</div>
    <div class="footer">
      <span class="source">${escapeHtml(source)}</span>
      <span class="brand">GOD CRM</span>
    </div>
  </div>
</body>
</html>`;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(html, { waitUntil: 'networkidle' });
    const buffer = await page.screenshot({ type: 'png' });
    logger.info(`[ScreenshotService] Post card generated: ${buffer.length} bytes`);
    return buffer;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Save screenshot to file system
 * @param {Buffer} buffer - PNG buffer
 * @param {string} filename - File name
 * @returns {string} File path
 */
export function saveScreenshot(buffer, filename) {
  const filePath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  logger.info(`[ScreenshotService] Saved: ${filePath}`);
  return filePath;
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default {
  takeScreenshot,
  screenshotWidget,
  screenshotTable,
  generatePostCard,
  saveScreenshot
};

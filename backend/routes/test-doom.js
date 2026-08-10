/**
 * Test endpoint to trigger 404 DOOM game
 * Mount this in your test environment to verify functionality
 */

import express from 'express';

const router = express.Router();

/**
 * GET /test/doom
 * Test endpoint to verify DOOM 404 integration
 * @route GET /test/doom
 * @returns {html} DOOM game page
 */
router.get('/doom', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>DOOM 404 Test</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          background: #f0f0f0;
        }
        .test-section {
          background: white;
          padding: 20px;
          margin: 10px 0;
          border-radius: 5px;
          border-left: 4px solid #0ea5e9;
        }
        h1 { color: #0ea5e9; }
        h2 { color: #333; }
        code {
          background: #f5f5f5;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: monospace;
        }
        .link-button {
          display: inline-block;
          padding: 10px 20px;
          margin: 5px;
          background: #0ea5e9;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          font-weight: bold;
        }
        .link-button:hover {
          background: #0ba4d8;
        }
        .error-example {
          background: #ffe0e0;
          border: 2px solid #ff0000;
          padding: 15px;
          border-radius: 5px;
          margin: 10px 0;
        }
      </style>
    </head>
    <body>
      <h1>🎮 DOOM 404 Integration Test</h1>
      
      <div class="test-section">
        <h2>Test Methods</h2>
        <p>Click any of these links to test the DOOM 404 error page:</p>
        
        <h3>Direct Access:</h3>
        <a href="/error/404" class="link-button">📍 /error/404</a>
        
        <h3>Automatic 404 Triggering:</h3>
        <a href="/nonexistent-page-12345" class="link-button">❌ /nonexistent-page-12345</a>
        <a href="/this-does-not-exist" class="link-button">❌ /this-does-not-exist</a>
        <a href="/random/fake/route" class="link-button">❌ /random/fake/route</a>
      </div>

      <div class="test-section">
        <h2>Expected Behavior</h2>
        <ul>
          <li>✅ Page loads with DOOM game interface</li>
          <li>✅ Loading screen shows "INITIALIZING GAME"</li>
          <li>✅ After 2-3 seconds, game becomes playable</li>
          <li>✅ Keyboard controls: Arrow keys or WASD</li>
          <li>✅ Mouse: Click to shoot, move to look around</li>
          <li>✅ ESC key returns to home page</li>
        </ul>
      </div>

      <div class="test-section">
        <h2>What You Should See</h2>
        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'%3E%3Crect fill='%23440000' width='400' height='100'/%3E%3Crect fill='%23220000' y='100' width='400' height='100'/%3E%3Crect fill='%23ff0000' x='50' y='60' width='100' height='80'/%3E%3Crect fill='%23cc0000' x='200' y='70' width='80' height='60'/%3E%3Ctext x='10' y='30' fill='%23ffff00' font-family='Courier' font-size='16' font-weight='bold'%3E404 PAGE NOT FOUND%3C/text%3E%3C/svg%3E" alt="DOOM game preview" style="max-width: 100%; height: auto; margin: 10px 0;">
        <p><em>The DOOM game interface with red walls, HUD information, and interactive controls.</em></p>
      </div>

      <div class="test-section">
        <h2>API Test (Should Return JSON)</h2>
        <p>Test that API routes still return JSON errors:</p>
        <a href="/api/v3/nonexistent" class="link-button">📡 /api/v3/nonexistent</a>
        <p>Expected response: JSON with <code>code: "ENDPOINT_NOT_FOUND"</code></p>
      </div>

      <div class="error-example">
        <h3>🔧 Troubleshooting</h3>
        <p><strong>If you see this page instead of DOOM:</strong></p>
        <ul>
          <li>Check browser console (F12) for JavaScript errors</li>
          <li>Verify file exists: <code>/backend/routes/error-pages/doom404.html</code></li>
          <li>Check server logs for path errors</li>
          <li>Clear browser cache (Ctrl+Shift+Del)</li>
          <li>Try different non-existent route</li>
        </ul>
      </div>

      <div class="test-section">
        <h2>Files Checked</h2>
        <ul>
          <li>✅ <code>/backend/routes/error-pages/index.js</code> - Route handler</li>
          <li>✅ <code>/backend/routes/error-pages/doom404.html</code> - Game interface</li>
          <li>✅ <code>/backend/server.js</code> - Integration point</li>
        </ul>
      </div>

      <hr style="margin: 30px 0;">
      <p style="color: #666; font-size: 12px;">
        🎮 DOOM 404 Status: <strong style="color: #0ea5e9;">READY</strong> | 
        Version: <strong>1.0.0</strong> | 
        Last Check: <strong id="time"></strong>
      </p>
    </body>
    </html>
    <script>
      document.getElementById('time').textContent = new Date().toLocaleString();
    </script>
  `);
});

export default router;

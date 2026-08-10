/**
 * Plugin API Routes — Endpoints for external plugins (Photoshop, etc.)
 *
 * POST /api/v3/plugin/login           — Login (UXP-safe, always 200)
 * GET  /api/v3/plugin/spaces          — List user's spaces
 * GET  /api/v3/plugin/spaces/:id/agents — List agents in a space
 * GET  /api/v3/plugin/agents          — List all agents (legacy)
 * GET  /api/v3/plugin/models          — List available image generation models
 * POST /api/v3/plugin/cleanup         — Clean up temporary plugin files
 */

import { Router } from 'express';
import { dbAll, dbRun } from '../../database/connection.js';
import { REPLICATE_MODELS, REPLICATE_3D_MODELS, GEMINI_MODELS } from '../../services/agent-tools/image-tools.js';
import { loginUser } from '../../services/AuthService.js';
import { createAccessToken, createRefreshToken, requireAuth } from './auth/authShared.js';
import fs from 'fs';
import path from 'path';

const router = Router();

const UPLOAD_BASE = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';

/**
 * POST /login — UXP-safe login (always returns 200)
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.json({ success: false, error: 'Email and password required' });
    }
    const user = await loginUser(email, password);
    if (!user) {
      return res.json({ success: false, error: 'Invalid email or password' });
    }
    const accessToken = createAccessToken(user);
    res.json({ success: true, accessToken, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    res.json({ success: false, error: error.message || 'Login failed' });
  }
});

/**
 * GET /spaces — List spaces the user has access to
 */
router.get('/spaces', requireAuth, async (req, res) => {
  try {
    const { getSpacesByUser } = await import('../../services/space/crud.js');
    const spaces = await getSpacesByUser(req.user.id, req.user.role || 'user');
    res.json({ success: true, spaces });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /spaces/:spaceId/agents — List agents in a specific space
 */
router.get('/spaces/:spaceId/agents', requireAuth, async (req, res) => {
  try {
    const { spaceId } = req.params;

    // Find agents table in this space — prefer "AI Agents" exact match, exclude activity logs
    const agentTable = await dbAll(
      `SELECT ut.id, ut.name
       FROM universal_tables ut
       JOIN projects p ON ut.project_id = p.id
       WHERE p.space_id = ?
         AND (ut.name ILIKE '%agent%' OR ut.name ILIKE '%агент%')
         AND ut.name NOT ILIKE '%activity%'
         AND ut.name NOT ILIKE '%log%'
         AND ut.name NOT LIKE 'doc\\_%' ESCAPE '\\'
         AND ut.deleted_at IS NULL
       ORDER BY
         CASE WHEN ut.name ILIKE 'ai agent%' THEN 0
              WHEN ut.name ILIKE '%агент%' THEN 1
              ELSE 2 END,
         ut.id ASC
       LIMIT 1`,
      [spaceId]
    );

    if (!agentTable.length) {
      return res.json({ success: true, agents: [] });
    }

    const tableId = agentTable[0].id;
    const rows = await dbAll(
      `SELECT tr.id, tr.data
       FROM table_rows tr
       WHERE tr.table_id = ?
       ORDER BY tr.created_at DESC`,
      [tableId]
    );

    const agents = rows.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return {
        id: row.id,
        name: data.name || data.title || `Agent #${row.id}`,
        emoji: data.emoji || data.icon || '🤖',
        description: data.description || data.main_instruction?.slice(0, 100) || '',
        model: data.model || '',
        is_active: data.status === 'active' || data.is_active === true,
        has_image_tools: Array.isArray(data.tools) && (
          data.tools.includes('replicate_image_generate') ||
          data.tools.includes('gemini_image_generate')
        ),
        tools: Array.isArray(data.tools) ? data.tools : [],
      };
    }).filter(a => a.is_active);

    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /agents — Legacy: list agents from hardcoded table 1784
 */
router.get('/agents', async (req, res) => {
  try {
    const agents = await dbAll(
      `SELECT tr.id, tr.data
       FROM table_rows tr
       WHERE tr.table_id = 1784
       ORDER BY tr.created_at DESC`
    );

    const result = agents.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return {
        id: row.id,
        name: data.name || data.title || `Agent #${row.id}`,
        emoji: data.emoji || data.icon || '🤖',
        description: data.description || data.main_instruction?.slice(0, 100) || '',
        has_image_tools: Array.isArray(data.tools) && (
          data.tools.includes('replicate_image_generate') ||
          data.tools.includes('gemini_image_generate')
        ),
      };
    });

    res.json({ success: true, agents: result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /models — List available image generation models
 * ?space_id=35 — filter from space's AI Models table (if exists)
 * Without space_id — returns hardcoded Replicate/Gemini models (legacy)
 */
router.get('/models', requireAuth, async (req, res) => {
  try {
    const { space_id } = req.query;

    // If space_id provided, try to load from the space's AI Models table
    if (space_id) {
      const modelsTable = await dbAll(
        `SELECT ut.id FROM universal_tables ut
         JOIN projects p ON ut.project_id = p.id
         WHERE p.space_id = ?
           AND (ut.name ILIKE '%model%' OR ut.name ILIKE '%модел%')
           AND ut.name NOT ILIKE '%activity%'
           AND ut.name NOT ILIKE '%log%'
           AND ut.deleted_at IS NULL
         ORDER BY
           CASE WHEN ut.name ILIKE 'ai model%' THEN 0
                WHEN ut.name ILIKE '%model%' THEN 1
                ELSE 2 END
         LIMIT 1`,
        [space_id]
      );

      if (modelsTable.length) {
        const rows = await dbAll(
          `SELECT tr.id, tr.data FROM table_rows tr
           WHERE tr.table_id = ? AND tr.deleted_at IS NULL
           ORDER BY tr.created_at DESC`,
          [modelsTable[0].id]
        );

        const spaceModels = rows.map(row => {
          const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          return {
            id: row.id,
            name: data.name || data.title || `Model #${row.id}`,
            provider: data.provider || data.operator || '',
            model_id: data.model_id || data.api_model_id || '',
            model_type: data.model_type || data.type || '',
            status: data.status || 'active',
            for_plugin: data.for_plugin === true || data.for_plugin === 'true' || data.tags?.includes('plugin'),
          };
        }).filter(m => m.status === 'active');

        return res.json({ success: true, models: spaceModels, source: 'space', table_id: modelsTable[0].id });
      }
    }

    // Fallback: hardcoded Replicate/Gemini models
    const models = {
      replicate: Object.entries(REPLICATE_MODELS).map(([key, m]) => ({
        key,
        id: m.id,
        title: m.title,
        type: m.type,
      })),
      replicate_3d: Object.entries(REPLICATE_3D_MODELS).map(([key, m]) => ({
        key,
        id: m.id,
        title: m.title,
        outputFormat: m.outputFormat,
      })),
      gemini: Object.entries(GEMINI_MODELS).map(([key, m]) => ({
        key,
        title: m.title,
        url: m.url,
      })),
    };
    res.json({ success: true, models, source: 'hardcoded' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /upload-base64 — Upload image from base64 (UXP-safe, no multipart needed)
 */
router.post('/upload-base64', requireAuth, async (req, res) => {
  try {
    const { base64, filename, space_id } = req.body;
    if (!base64) {
      return res.json({ success: false, error: 'base64 data required' });
    }

    const fname = filename || ('plugin_' + Date.now() + '.png');
    const spaceId = space_id || 'plugin';
    const targetFolder = spaceId === 'plugin' ? 'spaces/plugin' : `spaces/${spaceId}`;
    const targetDir = path.join(UPLOAD_BASE, targetFolder);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileId = 'file_' + Date.now() + '_' + Math.random().toString(16).slice(2, 18);
    const ext = path.extname(fname) || '.png';
    const diskName = fileId + ext;
    const targetPath = path.join(targetDir, diskName);

    // Decode base64 and write to disk (strip data URI prefix if present)
    const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    fs.writeFileSync(targetPath, buffer);

    const fileUrl = `/uploads/${targetFolder}/${diskName}`;

    // Save to DB (PostgreSQL).
    // ADR-0016 §Phase 5: plugin uploads (Photoshop bridge etc.) are orphan
    // files. Default 'internal' so they render in <img> for any logged-in
    // user without forcing a per-row space membership check.
    try {
      await dbRun(`
        INSERT INTO files (id, name, original_name, mime_type, size, path, url,
          storage_provider_id, space_id, uploaded_by, visibility, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      `, [fileId, diskName, fname, 'image/png', buffer.length, targetPath, fileUrl,
          'local', spaceId === 'plugin' ? null : parseInt(spaceId), req.user?.id || null, 'internal']);
    } catch (dbErr) {
      // DB insert is non-critical — file is on disk and URL works
      console.error('[plugin/upload-base64] DB insert error (non-fatal):', dbErr.message);
    }

    res.json({ success: true, url: fileUrl, id: fileId, size: buffer.length });
  } catch (error) {
    console.error('[plugin/upload-base64] Error:', error);
    res.json({ success: false, error: error.message || 'Upload failed' });
  }
});

/**
 * POST /cleanup — Clean up temporary plugin-generated files older than 24h
 */
router.post('/cleanup', async (req, res) => {
  try {
    const spaceDir = path.join(UPLOAD_BASE, 'spaces', 'plugin');
    if (!fs.existsSync(spaceDir)) {
      return res.json({ success: true, deleted: 0 });
    }

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const files = fs.readdirSync(spaceDir);
    let deleted = 0;

    for (const file of files) {
      const filePath = path.join(spaceDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    }

    res.json({ success: true, deleted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /conversations/:id/messages — Get conversation messages (for plugin chat view)
 */
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { after, before, limit = 50 } = req.query;

    let query = `SELECT m.id, m.role, m.content, m.content_type, m.attachments, m.sender_type, m.sender_id, m.created_at
                 FROM messages m
                 WHERE m.conversation_id = ? AND m.is_deleted = 0
                   AND m.content_type IN ('text', 'final_text')`;
    const params = [id];

    if (after) {
      query += ` AND m.id > ?`;
      params.push(after);
    }
    if (before) {
      query += ` AND m.id < ?`;
      params.push(before);
    }

    query += ` ORDER BY m.id DESC LIMIT ?`;
    params.push(parseInt(limit));

    const messages = await dbAll(query, params);
    // Reverse to chronological order
    messages.reverse();
    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

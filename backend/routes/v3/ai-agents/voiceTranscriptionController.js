/**
 * Voice Transcription & Operators Controller
 * ADR-027: Voice transcription API
 * GET /operators, POST /transcribe
 * GET/PATCH /spaces/:spaceId/transcription
 */

import { Router } from 'express';
import { authenticate } from '../../../middleware/auth.js';
import { dbGet, dbAll, dbRun, isPostgres } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, error } from '../../../utils/response.js';
import { getSecret } from '../../../services/secrets/getSecret.js';
import { safeParseJSON } from './shared.js';

const router = Router();

/**
 * GET /operators
 */
router.get('/operators', authenticate, async (req, res) => {
  try {
    const { space_id, capability } = req.query;

    let operatorsTable;
    if (space_id) {
      operatorsTable = await dbGet(`
        SELECT ut.id FROM universal_tables ut JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = ? AND ut.name LIKE '%Operators%' LIMIT 1
      `, [space_id]);
    }
    if (!operatorsTable) {
      operatorsTable = await dbGet(`SELECT id FROM universal_tables WHERE name LIKE '%Operators%' LIMIT 1`);
    }
    if (!operatorsTable) return success(res, []);

    const operators = await dbAll(`
      SELECT id, base_id, data, created_at FROM table_rows WHERE table_id = ? ORDER BY created_at ASC
    `, [operatorsTable.id]);

    let result = operators.map(row => {
      const data = safeParseJSON(row.data, {});
      return {
        id: row.id, base_id: row.base_id, name: data.name || 'Unknown',
        provider: data.provider || 'openai', status: data.status || 'inactive',
        api_url: data.api_url || '', models: data.models || '',
        capabilities: data.capabilities || { chat: true }, description: data.description || ''
      };
    });

    if (capability) {
      result = result.filter(op => op.capabilities && op.capabilities[capability] === true);
    }

    return success(res, result);
  } catch (err) {
    apiLogger.error({ err, context: 'GET operators' }, 'Error fetching operators');
    return error(res, 'FETCH_OPERATORS_ERROR', 'Failed to fetch operators', 500);
  }
});

/**
 * POST /transcribe
 */
router.post('/transcribe', authenticate, async (req, res) => {
  try {
    const { audio, format = 'webm', operator_id, space_id, language } = req.body;
    if (!audio) return badRequest(res, 'Missing required field: audio');

    let operatorData = null;
    let apiKey = null;
    let apiUrl = 'https://api.openai.com/v1';

    if (operator_id) {
      const operatorRow = await dbGet(`
        SELECT tr.data FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id
        WHERE tr.id = ? AND ut.name LIKE '%Operators%'
      `, [operator_id]);
      if (operatorRow) operatorData = safeParseJSON(operatorRow.data, {});
    }

    if (!operatorData && space_id) {
      const space = await dbGet(`SELECT settings FROM spaces WHERE id = ?`, [space_id]);
      if (space) {
        const settings = safeParseJSON(space.settings, {});
        if (settings.transcription?.operator_id) {
          const operatorRow = await dbGet(`
            SELECT tr.data FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id
            WHERE tr.id = ? AND ut.name LIKE '%Operators%'
          `, [settings.transcription.operator_id]);
          if (operatorRow) operatorData = safeParseJSON(operatorRow.data, {});
        }
      }
    }

    if (!operatorData) {
      const operatorRow = await dbGet(`
        SELECT tr.data FROM table_rows tr JOIN universal_tables ut ON tr.table_id = ut.id
        WHERE ut.name LIKE '%Operators%'
          AND (
            ${isPostgres()
              ? "(tr.data::jsonb->'capabilities'->>'transcription')::boolean = true OR tr.data::jsonb->>'provider' = 'openai'"
              : "json_extract(tr.data, '$.capabilities.transcription') = 1 OR json_extract(tr.data, '$.provider') = 'openai'"
            }
          )
          AND ${isPostgres()
            ? "tr.data::jsonb->>'status' = 'active'"
            : "json_extract(tr.data, '$.status') = 'active'"
          }
        ORDER BY tr.created_at ASC LIMIT 1
      `);
      if (operatorRow) operatorData = safeParseJSON(operatorRow.data, {});
    }

    if (operatorData) {
      apiKey = operatorData.api_key;
      apiUrl = operatorData.api_url || 'https://api.openai.com/v1';
    }
    if (!apiKey) apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
    if (!apiKey) return badRequest(res, 'No API key configured for transcription');

    const audioBuffer = Buffer.from(audio, 'base64');
    const maxSize = 25 * 1024 * 1024;
    if (audioBuffer.length > maxSize) return badRequest(res, 'Audio file too large. Maximum size is 25MB.');

    const mimeTypes = {
      'webm': 'audio/webm', 'mp3': 'audio/mpeg', 'wav': 'audio/wav',
      'm4a': 'audio/m4a', 'ogg': 'audio/ogg', 'flac': 'audio/flac'
    };
    const mimeType = mimeTypes[format] || 'audio/webm';

    const FormData = (await import('form-data')).default;
    const formData = new FormData();
    formData.append('file', audioBuffer, { filename: `audio.${format}`, contentType: mimeType });
    formData.append('model', 'whisper-1');
    if (language) formData.append('language', language);

    const fetch = (await import('node-fetch')).default;
    const whisperUrl = `${apiUrl.replace(/\/$/, '')}/audio/transcriptions`;

    const response = await fetch(whisperUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, ...formData.getHeaders() },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      apiLogger.error({ status: response.status, error: errorText, context: 'Whisper API' }, 'Whisper API error');
      return error(res, 'WHISPER_API_ERROR', `Transcription failed: ${response.statusText}`, response.status);
    }

    const result = await response.json();
    return success(res, { data: { text: result.text, language: language || 'auto' } });
  } catch (err) {
    apiLogger.error({ err, context: 'Transcribe' }, 'Error transcribing audio');
    return error(res, 'TRANSCRIBE_ERROR', 'Failed to transcribe audio', 500);
  }
});

/**
 * GET /spaces/:spaceId/transcription
 */
router.get('/spaces/:spaceId/transcription', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const space = await dbGet(`SELECT settings FROM spaces WHERE id = ?`, [spaceId]);
    if (!space) return notFound(res, 'Space not found');

    const settings = safeParseJSON(space.settings, {});
    const transcription = settings.transcription || { enabled: false, operator_id: null, language: 'auto' };

    return success(res, transcription);
  } catch (err) {
    apiLogger.error({ err, context: 'GET transcription settings' }, 'Error fetching settings');
    return error(res, 'FETCH_TRANSCRIPTION_SETTINGS_ERROR', 'Failed to fetch transcription settings', 500);
  }
});

/**
 * PATCH /spaces/:spaceId/transcription
 */
router.patch('/spaces/:spaceId/transcription', authenticate, async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { enabled, operator_id, language } = req.body;

    const space = await dbGet(`SELECT settings FROM spaces WHERE id = ?`, [spaceId]);
    if (!space) return notFound(res, 'Space not found');

    const settings = safeParseJSON(space.settings, {});
    settings.transcription = {
      enabled: enabled !== undefined ? enabled : settings.transcription?.enabled || false,
      operator_id: operator_id !== undefined ? operator_id : settings.transcription?.operator_id || null,
      language: language !== undefined ? language : settings.transcription?.language || 'auto'
    };

    await dbRun(`UPDATE spaces SET settings = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify(settings), spaceId]);

    return success(res, { data: settings.transcription });
  } catch (err) {
    apiLogger.error({ err, context: 'PATCH transcription settings' }, 'Error updating settings');
    return error(res, 'UPDATE_TRANSCRIPTION_SETTINGS_ERROR', 'Failed to update transcription settings', 500);
  }
});

export default router;

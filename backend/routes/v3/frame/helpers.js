/**
 * frame/helpers.js — Multer configuration, audio transcription, file utilities
 */

import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { dbGet, isPostgres, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { getSecret } from '../../../services/secrets/getSecret.js';

// ─── Multer Configuration ──────────────────────────────────────

export const FRAME_UPLOAD_PATH = process.env.UPLOAD_PATH
  ? path.join(process.env.UPLOAD_PATH, '.frame-temp')
  : '/var/lib/business-crm-data/uploads/.frame-temp';

/** Ensure the temp directory exists */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDir(FRAME_UPLOAD_PATH);
    cb(null, FRAME_UPLOAD_PATH);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname) || (file.fieldname === 'audio' ? '.wav' : '.jpg');
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  }
});

/**
 * File filter: only allow WAV audio and JPEG images from Frame glasses.
 */
function frameFileFilter(_req, file, cb) {
  if (file.fieldname === 'audio') {
    const allowedAudio = ['audio/wav', 'audio/wave', 'audio/x-wav', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/flac'];
    if (allowedAudio.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error(`Invalid audio type: ${file.mimetype}. Expected WAV format.`), false);
  }

  if (file.fieldname === 'image') {
    const allowedImage = ['image/jpeg', 'image/jpg', 'image/png'];
    if (allowedImage.includes(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error(`Invalid image type: ${file.mimetype}. Expected JPEG format.`), false);
  }

  cb(new Error(`Unexpected file field: ${file.fieldname}`), false);
}

export const upload = multer({
  storage,
  fileFilter: frameFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB max per file
    files: 2                     // At most 1 audio + 1 image
  }
});

// ─── Helper: Transcribe audio via Whisper API ──────────────────

/**
 * Transcribe an audio buffer using the OpenAI Whisper API.
 */
export async function transcribeAudio(audioBuffer, format = 'wav', language = null) {
  // ADR-0040: vault first, env fallback during transition.
  let apiKey = await getSecret('openai_api_key', 'OPENAI_API_KEY');
  let apiUrl = 'https://api.openai.com/v1';

  if (!apiKey) {
    const operatorRow = await dbGet(
      isPostgres()
        ? `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%Operators%'
             AND (tr.data::jsonb->>'provider' = 'openai')
             AND (tr.data::jsonb->>'status' = 'active')
           ORDER BY tr.created_at ASC LIMIT 1`
        : `SELECT tr.data FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           WHERE ut.name LIKE '%Operators%'
             AND json_extract(tr.data, '$.provider') = 'openai'
             AND json_extract(tr.data, '$.status') = 'active'
           ORDER BY tr.created_at ASC LIMIT 1`
    );

    if (operatorRow) {
      const opData = safeJsonParse(operatorRow.data, {});
      apiKey = opData.api_key || null;
      apiUrl = opData.api_url || apiUrl;
    }
  }

  if (!apiKey) {
    throw new Error('No OpenAI API key configured for audio transcription. Set OPENAI_API_KEY or add an OpenAI operator.');
  }

  const mimeTypes = {
    wav: 'audio/wav',
    webm: 'audio/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/m4a',
    ogg: 'audio/ogg',
    flac: 'audio/flac'
  };
  const mimeType = mimeTypes[format] || 'audio/wav';

  const FormData = (await import('form-data')).default;
  const formData = new FormData();
  formData.append('file', audioBuffer, {
    filename: `audio.${format}`,
    contentType: mimeType
  });
  formData.append('model', 'whisper-1');
  if (language) {
    formData.append('language', language);
  }

  const whisperUrl = `${apiUrl.replace(/\/$/, '')}/audio/transcriptions`;

  const response = await fetch(whisperUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...formData.getHeaders()
    },
    body: formData
  });

  if (!response.ok) {
    const errText = await response.text();
    apiLogger.error({ status: response.status, error: errText, context: 'Frame Whisper' }, 'Whisper API error');
    throw new Error(`Whisper transcription failed (${response.status}): ${errText.substring(0, 200)}`);
  }

  const result = await response.json();
  return result.text || '';
}

/**
 * Safely clean up a temporary file.
 */
export function cleanupTempFile(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      apiLogger.warn({ err, path: filePath }, 'Failed to clean up temp file');
    }
  });
}

/**
 * Sanitize a plain text string — strip control characters, limit length.
 */
export function sanitizeText(input, maxLength = 2000) {
  if (typeof input !== 'string') return '';
  const cleaned = input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return cleaned.substring(0, maxLength);
}

// Non-ASCII upload names on POST /api/v3/files/upload. Browsers send the
// multipart filename as raw UTF-8; multer's default latin1 charset turned
// "Копия.xlsx" into "ÐÐ¾Ð¿Ð¸Ñ.xlsx" (chat 3660). Drives the real multer path
// against the test DB (ADR-0009) and pins the repair helper of migration 101.
//
// UPLOAD_PATH is redirected BEFORE the router is imported, because files.js
// captures UPLOAD_BASE_PATH at module load time.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dbAll, dbGet, dbRun } from '../database/connection.js';
import { decodeMojibake } from '../database/migrations/knex/101_files_original_name_utf8.js';

const UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'utf8-uploads-'));
process.env.UPLOAD_PATH = UPLOAD_ROOT;

const MARKER = `utf8-name-test-${Date.now()}`;
const XLSX = Buffer.from('PK\x03\x04 fake-xlsx');

const uploadedRows = () => dbAll('SELECT * FROM files WHERE description = ?', [MARKER]);
const clearRows = () => dbRun('DELETE FROM files WHERE description = ?', [MARKER]);

describe('POST /api/v3/files/upload — Cyrillic file names', () => {
  let app;

  beforeAll(async () => {
    expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
    const { default: filesRouter } = await import('../routes/v3/files.js');
    app = express();
    app.use(
      '/api/v3',
      (req, _res, next) => {
        req.user = { id: 1, email: 'test@example.com', role: 'admin' };
        next();
      },
      filesRouter
    );
  });

  afterAll(async () => {
    await clearRows();
    fs.rmSync(UPLOAD_ROOT, { recursive: true, force: true });
  });

  test.each([
    'Копия PI - new PRODUCTION ORDER HM.xlsx',
    'Снимок экрана 2026-10-14 в 20.34.28.png',
    'Архив.zip',
    'résumé — final.pdf'
  ])('"%s" is stored and echoed back verbatim', async (filename) => {
    const res = await request(app)
      .post('/api/v3/files/upload')
      .field('description', MARKER)
      .attach('files', XLSX, { filename, contentType: 'application/octet-stream' });

    expect(res.status).toBe(200);
    expect(res.body.data.originalName).toBe(filename);
    const rows = await uploadedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].original_name).toBe(filename);
    await clearRows();
  });
});

describe('migration 101 — decodeMojibake', () => {
  test('repairs latin1-decoded UTF-8 names', () => {
    expect(decodeMojibake('Ð\u009aÐ¾Ð¿Ð¸Ñ\u008f PI.xlsx')).toBe('Копия PI.xlsx');
    expect(decodeMojibake('Ð\u0090Ñ\u0080Ñ\u0085Ð¸Ð².zip')).toBe('Архив.zip');
  });

  test('leaves healthy and ASCII names alone', () => {
    expect(decodeMojibake('Копия PI.xlsx')).toBeNull();
    expect(decodeMojibake('project8408-app-4380.png')).toBeNull();
    expect(decodeMojibake('résumé.pdf')).toBeNull();
    expect(decodeMojibake(null)).toBeNull();
  });
});

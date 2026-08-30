// ADR-194 §B1/B2 — MIME allowlist + itemised rejection contract on
// POST /api/v3/files/upload. Boots a minimal Express app around the real
// files router and drives the real multer path against the test DB
// (ADR-0009 — never a combat master; the boot guard in backend/test/setup.js
// aborts the run if POSTGRES_DB is godcrm_prod).
//
// UPLOAD_PATH is redirected to a temp dir BEFORE the router is imported,
// because files.js captures UPLOAD_BASE_PATH at module load time.

import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dbAll, dbRun } from '../database/connection.js';
import { fileLogger } from '../utils/logger.js';

const UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'adr194-uploads-'));
process.env.UPLOAD_PATH = UPLOAD_ROOT;

// Every row this suite writes is tagged so cleanup can never touch anything else.
const MARKER = `adr194-test-${Date.now()}`;

const EPUB = Buffer.from('PK\x03\x04 fake-epub');
const PDF = Buffer.from('%PDF-1.4 fake');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

const tempFiles = () => {
  const dir = path.join(UPLOAD_ROOT, '.temp');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

const uploadedRows = () => dbAll('SELECT * FROM files WHERE description = ?', [MARKER]);
const clearRows = () => dbRun('DELETE FROM files WHERE description = ?', [MARKER]);

describe('POST /api/v3/files/upload — MIME allowlist (ADR-194 B1/B2)', () => {
  let app;

  const post = (files) => {
    const req = request(app).post('/api/v3/files/upload').field('description', MARKER);
    for (const [buf, filename, contentType] of files) {
      req.attach('files', buf, { filename, contentType });
    }
    return req;
  };

  beforeAll(async () => {
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

  // AC-B1.1 — the bug that opened ADR-194: epub was refused outright.
  // NB: the ADR text says 201, but this endpoint has always answered 200
  // via success(); the status contract is deliberately left untouched.
  test('single .epub is accepted and lands a row in files', async () => {
    const res = await post([[EPUB, 'book.epub', 'application/epub+zip']]);

    expect(res.status).toBe(200);
    expect(res.body.data.mimeType).toBe('application/epub+zip');

    const rows = await uploadedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].original_name).toBe('book.epub');
    expect(fs.existsSync(rows[0].path)).toBe(true);

    await clearRows();
  });

  test.each([
    ['IMG_0001.HEIC', 'image/heic'],
    ['IMG_0002.HEIF', 'image/heif'],
    ['book.mobi', 'application/x-mobipocket-ebook'],
    ['notes.odt', 'application/vnd.oasis.opendocument.text'],
    ['sheet.ods', 'application/vnd.oasis.opendocument.spreadsheet']
  ])('%s (%s) is accepted', async (filename, type) => {
    const res = await post([[EPUB, filename, type]]);

    expect(res.status).toBe(200);
    expect(await uploadedRows()).toHaveLength(1);

    await clearRows();
  });

  // AC-B1.2 / AC-B2.2 / AC-B2.3 — the SEC-3 carve-out stays load-bearing,
  // and the refusal is now itemised instead of a bare sentence.
  test('single .svg is still rejected, with an itemised 400 and a warn line', async () => {
    const warn = vi.spyOn(fileLogger, 'warn');

    const res = await post([[SVG, 'evil.svg', 'image/svg+xml']]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    // filesApi.ts:94 reads exactly error.error.message — it must stay a human string.
    expect(typeof res.body.error.message).toBe('string');
    expect(res.body.error.message).toContain('evil.svg');
    expect(res.body.error.rejected).toEqual([
      { name: 'evil.svg', type: 'image/svg+xml', reason: 'type_not_allowed' }
    ]);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'evil.svg', mimetype: 'image/svg+xml' }),
      expect.any(String)
    );
    warn.mockRestore();

    expect(await uploadedRows()).toHaveLength(0);
  });

  test('text/html is still rejected (SEC-3)', async () => {
    const res = await post([[SVG, 'evil.html', 'text/html']]);

    expect(res.status).toBe(400);
    expect(await uploadedRows()).toHaveLength(0);
  });

  // AC-B2.1 — all-or-nothing survives: one bad file kills the batch, but the
  // body names which one. (The ADR example was epub+pdf; epub is allowed after
  // B1, so svg stands in as the disallowed member.)
  test('mixed batch is rejected wholesale and names only the offending file', async () => {
    const res = await post([
      [SVG, 'evil.svg', 'image/svg+xml'],
      [PDF, 'report.pdf', 'application/pdf']
    ]);

    expect(res.status).toBe(400);
    expect(res.body.error.rejected.map((f) => f.name)).toEqual(['evil.svg']);

    // The allowed PDF must not survive — not in the DB, not as a temp leftover.
    expect(await uploadedRows()).toHaveLength(0);
    expect(tempFiles()).toHaveLength(0);
  });

  test('every rejected file in a batch is named, not just the first', async () => {
    const res = await post([
      [SVG, 'a.svg', 'image/svg+xml'],
      [SVG, 'b.html', 'text/html'],
      [PDF, 'report.pdf', 'application/pdf']
    ]);

    expect(res.status).toBe(400);
    expect(res.body.error.rejected.map((f) => f.name)).toEqual(['a.svg', 'b.html']);
    expect(await uploadedRows()).toHaveLength(0);
  });

  test('a fully allowed batch still uploads every file', async () => {
    const res = await post([
      [EPUB, 'book.epub', 'application/epub+zip'],
      [PDF, 'report.pdf', 'application/pdf']
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(await uploadedRows()).toHaveLength(2);

    await clearRows();
  });
});

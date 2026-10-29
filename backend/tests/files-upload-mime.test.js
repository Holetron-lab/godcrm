// General attachments — unrestricted MIME acceptance and batch limits on
// POST /api/v3/files/upload. Boots a minimal Express app around the real
// files router and drives the real multer path against the test DB
// (ADR-0009 — never a combat master; the boot guard in backend/test/setup.js
// aborts the run if POSTGRES_DB is godcrm_prod).
//
// UPLOAD_PATH is redirected to a temp dir BEFORE the router is imported,
// because files.js captures UPLOAD_BASE_PATH at module load time.

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import { dbAll, dbGet, dbRun } from '../database/connection.js';

const UPLOAD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'adr194-uploads-'));
process.env.UPLOAD_PATH = UPLOAD_ROOT;

// Every row this suite writes is tagged so cleanup can never touch anything else.
const MARKER = `adr194-test-${Date.now()}`;

const EPUB = Buffer.from('PK\x03\x04 fake-epub');
const PDF = Buffer.from('%PDF-1.4 fake');

const tempFiles = () => {
  const dir = path.join(UPLOAD_ROOT, '.temp');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

const uploadedRows = () => dbAll('SELECT * FROM files WHERE description = ?', [MARKER]);
const clearRows = () => dbRun('DELETE FROM files WHERE description = ?', [MARKER]);

describe('POST /api/v3/files/upload — general files', () => {
  let app;

  const post = (files) => {
    const req = request(app).post('/api/v3/files/upload').field('description', MARKER);
    for (const [buf, filename, contentType] of files) {
      req.attach('files', buf, { filename, contentType });
    }
    return req;
  };

  beforeAll(async () => {
    expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
    const { default: filesRouter } = await import('../routes/v3/files.js');
    const { default: uploadStatic } = await import('../middleware/uploadStatic.js');
    const { uploadsFileGuard } = await import('../middleware/fileGuard.js');
    app = express();
    app.use('/uploads', uploadsFileGuard, uploadStatic);
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

  test.each([
    ['voice.webm', 'audio/webm'],
    ['voice.m4a', 'audio/mp4'],
    ['voice.ogg', 'audio/ogg']
  ])('voice recording %s preserves its MIME and chat space', async (filename, type) => {
    const res = await post([[Buffer.from('audio-fixture'), filename, type]])
      .field('spaceId', '11');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ originalName: filename, mimeType: type, spaceId: '11' });
    expect(res.body.data.url).toMatch(/^\/uploads\/spaces\/11\//);
    const rows = await uploadedRows();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].space_id)).toBe(11);
    expect(rows[0].mime_type).toBe(type);
    expect(fs.readFileSync(rows[0].path)).toEqual(Buffer.from('audio-fixture'));
    await clearRows();
  });

  test.each([
    ['clip.mp4', 'video/mp4'],
    ['clip.webm', 'video/webm'],
    ['clip.mov', 'video/quicktime'],
    ['archive.zip', 'application/x-zip-compressed'],
    ['script.py', 'text/x-python'],
    ['unknown.custom', 'application/x-custom-format'],
    ['no-extension', 'application/octet-stream'],
    ['page.html', 'text/html'],
    ['image.svg', 'image/svg+xml'],
    ['clip.mp4', 'application/octet-stream']
  ])('%s accepts browser MIME %s and preserves bytes/visibility', async (filename, type) => {
    const res = await post([[EPUB, filename, type]]).field('visibility', 'private');
    expect(res.status).toBe(200);
    expect(res.body.data.mimeType).toBe(type);
    const rows = await uploadedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ original_name: filename, mime_type: type, visibility: 'private' });
    expect(fs.readFileSync(rows[0].path)).toEqual(EPUB);
    await clearRows();
  });

  test('mixed media, code and unknown files are all retained', async () => {
    const res = await post([
      [EPUB, 'clip.mp4', 'video/mp4'],
      [PDF, 'script.py', 'text/x-python'],
      [EPUB, 'unknown.custom', 'application/x-custom-format']
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(await uploadedRows()).toHaveLength(3);
    expect(tempFiles()).toHaveLength(0);
    await clearRows();
  });

  test.each([
    ['clip.mp4', 'application/octet-stream', 'inline', 'video/mp4'],
    ['page.html', 'image/png', 'attachment', 'application/octet-stream'],
    ['image.svg', 'application/octet-stream', 'attachment', 'application/octet-stream']
  ])('upload → guarded download of %s ignores spoofed MIME for delivery', async (name, mime, disposition, servedMime) => {
    const upload = await post([[EPUB, name, mime]]);
    expect(upload.status).toBe(200);
    const url = upload.body.data.url;
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set('Authorization', 'Bearer invalid')).status).toBe(401);
    const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1m' });
    const download = await request(app).get(url).set('Authorization', `Bearer ${token}`);
    expect(download.status).toBe(200);
    expect(download.headers['content-disposition']).toMatch(new RegExp(`^${disposition};`));
    expect(download.headers['content-type']).toBe(servedMime);
    expect(download.headers['content-length']).toBe(String(EPUB.length));
    await clearRows();
    expect((await request(app).get(url)).status).toBe(404);
  });

  test('browser file without a MIME is accepted as generic binary', async () => {
    const res = await post([[EPUB, 'unknown.extension', undefined]]);
    expect(res.status).toBe(200);
    expect(res.body.data.mimeType).toBe('application/octet-stream');
    await clearRows();
  });

  test('eleven files reject the whole batch without rows or temp files', async () => {
    const res = await post(Array.from({ length: 11 }, (_, i) => [PDF, `file-${i}.pdf`, 'application/pdf']));
    expect(res.status).toBe(400);
    expect(await uploadedRows()).toHaveLength(0);
    expect(tempFiles()).toHaveLength(0);
  });

  test('oversized file rejects the whole mixed batch without leftovers', async () => {
    const res = await post([
      [PDF, 'small.pdf', 'application/pdf'],
      [Buffer.alloc(100 * 1024 * 1024 + 1), 'large.bin', 'application/octet-stream']
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('100 MB');
    expect(await uploadedRows()).toHaveLength(0);
    expect(tempFiles()).toHaveLength(0);
  }, 30000);

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

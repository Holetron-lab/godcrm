// @vitest-environment node
import { beforeAll, afterAll, describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-delivery-'));
const payload = Buffer.from('<script>alert(document.domain)</script>');
let app;

beforeAll(async () => {
  process.env.UPLOAD_PATH = root;
  const { default: uploadStatic } = await import('../uploadStatic.js');
  app = express();
  app.use('/uploads', uploadStatic);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('uploaded file delivery', () => {
  test.each(['html', 'htm', 'svg', 'xhtml', 'xml', 'js', 'mjs', 'css', 'py', 'zip', 'custom', ''])(
    '.%s cannot execute as an inline document or script', async (ext) => {
      const name = `file${ext ? `.${ext}` : ''}`;
      fs.writeFileSync(path.join(root, name), payload);
      const res = await request(app).get(`/uploads/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain('sandbox');
      expect(res.body).toEqual(payload);
    });

  test.each([
    ['image.PNG', 'image/png'], ['clip.mp4', 'video/mp4'],
    ['clip.webm', 'video/webm'], ['voice.ogg', 'audio/ogg'],
    ['voice.m4a', 'audio/mp4'], ['report.pdf', 'application/pdf'],
    ['notes.txt', 'text/plain']
  ])('%s retains inline preview with a server-selected MIME', async (name, mime) => {
    fs.writeFileSync(path.join(root, name), payload);
    const res = await request(app).get(`/uploads/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['content-type']).toContain(mime);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('video supports byte ranges for native playback', async () => {
    fs.writeFileSync(path.join(root, 'range.mp4'), payload);
    const res = await request(app).get('/uploads/range.mp4').set('Range', 'bytes=0-5');
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-5/${payload.length}`);
    expect(res.headers['content-length']).toBe('6');
  });
});

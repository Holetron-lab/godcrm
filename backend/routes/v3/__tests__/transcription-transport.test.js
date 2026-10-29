// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
vi.mock('../../../middleware/auth.js', () => ({ authenticate: (_req, _res, next) => next() }));
vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn(async () => ({ data: { api_key: 'test-only', api_url: 'https://provider.example/v1/' } })),
  dbAll: vi.fn(), dbRun: vi.fn(), isPostgres: () => true,
}));
vi.mock('../../../services/secrets/getSecret.js', () => ({ getSecret: vi.fn() }));
vi.mock('../ai-agents/shared.js', () => ({ safeParseJSON: value => value }));
import router from '../ai-agents/voiceTranscriptionController.js';
const app = express().use(express.json()).use(router);
afterEach(() => vi.unstubAllGlobals());

it('sends native multipart audio with the original filename, MIME type and language', async () => {
  const fetch = vi.fn(async (url, options) => {
    expect(url).toBe('https://provider.example/v1/audio/transcriptions');
    const wire = new Request(url, options);
    expect(wire.headers.get('authorization')).toBe('Bearer test-only');
    expect(wire.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    const form = await wire.formData();
    const file = form.get('file');
    expect(file.name).toBe('audio.ogg');
    expect(file.type).toBe('audio/ogg');
    expect(await file.text()).toBe('fixture audio');
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('ru');
    return Response.json({ text: 'hello' });
  });
  vi.stubGlobal('fetch', fetch);
  const response = await request(app).post('/transcribe').send({
    audio: Buffer.from('fixture audio').toString('base64'), operator_id: 1, format: 'ogg', language: 'ru',
  });
  expect(response.status).toBe(200);
  expect(response.body.data).toEqual({ data: { text: 'hello', language: 'ru' } });
  expect(fetch).toHaveBeenCalledOnce();
});

it('preserves the upstream rejection status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401, statusText: 'Unauthorized' })));
  const response = await request(app).post('/transcribe').send({ audio: 'YQ==', operator_id: 1 });
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('WHISPER_API_ERROR');
});

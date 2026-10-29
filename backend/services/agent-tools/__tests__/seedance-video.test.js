// @vitest-environment node
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mocks = vi.hoisted(() => ({ dbGet: vi.fn(), dbRun: vi.fn(), scoped: vi.fn(), global: vi.fn(), fetch: vi.fn() }));
vi.mock('../../../database/connection.js', () => ({
  dbGet: mocks.dbGet, dbRun: mocks.dbRun, sqlNow: () => 'NOW()',
  withTransactionAsync: async fn => fn({ run: mocks.dbRun }),
}));
vi.mock('../../secrets/SecretsVault.js', () => ({ default: { getSecret: mocks.scoped } }));
vi.mock('../../secrets/getSecret.js', () => ({ getSecret: mocks.global }));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'seedance-test-'));
const originalUploadPath = process.env.UPLOAD_PATH;
process.env.UPLOAD_PATH = root;
await fs.mkdir(path.join(root, 'spaces/44'), { recursive: true });
for (const name of ['1.png', '2.png', '3.png', 'motion.mp4']) await fs.writeFile(path.join(root, 'spaces/44', name), 'fixture');
const { imageToolHandlers: handlers } = await import('../image-tools.js');
const context = { spaceId: 44, conversationId: 3735 };
const args = { prompt: 'Follow [Video1] with [Image1]', reference_images: [1, 2, 3].map(n => `/uploads/spaces/44/${n}.png`), reference_video: '/uploads/spaces/44/motion.mp4' };
const reply = data => ({ ok: true, json: async () => data });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.scoped.mockResolvedValue('space-token');
  mocks.global.mockResolvedValue('global-token');
  mocks.dbRun.mockResolvedValue({});
  mocks.dbGet.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM conversations')) return { id: 3735, space_id: 44 };
    if (sql.includes('FROM files')) return { id: 'input', url: params[0], space_id: 44, mime_type: params[0].endsWith('.mp4') ? 'video/mp4' : 'image/png', storage_provider_id: 'local' };
    if (sql.includes('FROM messages')) return { id: 100 };
    return null;
  });
  mocks.fetch.mockImplementation(async url => url.endsWith('/files')
    ? reply({ urls: { get: 'https://api.replicate.com/v1/files/uploaded' } })
    : reply({ id: 'pred123', status: 'starting', model: 'bytedance/seedance-2.0' }));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  if (originalUploadPath === undefined) delete process.env.UPLOAD_PATH;
  else process.env.UPLOAD_PATH = originalUploadPath;
  await fs.rm(root, { recursive: true, force: true });
});
describe('Seedance space billing and attachments', () => {
  it('uploads three images and one video, submits once and returns the prediction immediately', async () => {
    const result = await handlers.replicate_video_generate(args, 17, context);
    expect(result).toMatchObject({ success: true, async: true, prediction_id: 'pred123', kind: 'video', space_id: 44 });
    expect(mocks.scoped).toHaveBeenCalledWith('replicate_api_key', { spaceId: 44 });
    expect(mocks.global).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
    const [url, options] = mocks.fetch.mock.calls[4];
    expect(url).toBe('https://api.replicate.com/v1/models/bytedance/seedance-2.0/predictions');
    expect(options.headers.Authorization).toBe('Bearer space-token');
    expect(options.headers.Prefer).toBeUndefined();
    expect(JSON.parse(options.body).input).toMatchObject({ duration: 6, resolution: '720p', aspect_ratio: '9:16', generate_audio: false });
    expect(JSON.parse(options.body).input.reference_images).toHaveLength(3);
    expect(JSON.parse(options.body).input.reference_videos).toHaveLength(1);
  });
  it('does not use any global or explicit key when the space key is missing', async () => {
    mocks.scoped.mockResolvedValue(null);
    const result = await handlers.replicate_video_generate(args, 17, { ...context, apiKeys: { replicate: 'explicit' } });
    expect(result.error).toContain('replicate_api_key');
    expect(mocks.global).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { spaceId: 11, conversationId: 3735 }, { spaceId: 45, conversationId: 3735 }])('rejects absent or mismatched conversation scope %j', async ctx => {
    expect((await handlers.replicate_video_generate(args, 17, ctx)).error).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('rejects files outside conversation attachments before uploading anything', async () => {
    const original = mocks.dbGet.getMockImplementation();
    mocks.dbGet.mockImplementation((sql, params) => sql.includes('FROM messages') ? null : original(sql, params));
    expect((await handlers.replicate_video_generate(args, 17, context)).error).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([{ reference_images: ['a', 'b', 'c', 'd'] }, { reference_video: '/uploads/../../etc/passwd' }, { duration: 16 }, { space_id: 11 }])('rejects invalid input %j', async changes => {
    expect((await handlers.replicate_video_generate({ ...args, ...changes }, 17, context)).error).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('video polling never falls back to the common key', async () => {
    mocks.scoped.mockResolvedValue(null);
    expect((await handlers.replicate_check_prediction({ prediction_id: 'pred123', kind: 'video' }, 17, context)).error).toContain('replicate_api_key');
    expect(mocks.global).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('Seedance polling and regressions', () => {
  it.each(['starting', 'processing', 'failed', 'canceled'])('returns %s without writing files', async status => {
    mocks.fetch.mockResolvedValue(reply({ id: 'pred123', status, model: 'bytedance/seedance-2.0' }));
    const result = await handlers.replicate_check_prediction({ prediction_id: 'pred123', kind: 'video' }, 17, context);
    expect(result.status).toBe(status);
    expect(result.success).toBe(!['failed', 'canceled'].includes(status));
    expect(mocks.dbRun).not.toHaveBeenCalled();
  });
  it('saves a private MP4 once and reuses its registry entry on subsequent polls', async () => {
    const original = mocks.dbGet.getMockImplementation();
    let saved = null;
    mocks.dbGet.mockImplementation((sql, params) => sql.includes('WHERE id = ? AND space_id') ? saved : original(sql, params));
    mocks.fetch.mockImplementation(async url => url.includes('/predictions/')
      ? reply({ id: 'pred123', model: 'bytedance/seedance-2.0', status: 'succeeded', output: 'https://replicate.delivery/output.mp4' })
      : new Response(Buffer.from('0000ftypisom')));
    const query = { prediction_id: 'pred123', kind: 'video', space_id: 44 };
    const first = await handlers.replicate_check_prediction(query, 17, context);
    expect(first).toMatchObject({ success: true, kind: 'video', video: { mime_type: 'video/mp4' } });
    const [sql, params] = mocks.dbRun.mock.calls[0];
    expect(sql).toContain("'private'");
    expect(params.slice(-2)).toEqual([44, 17]);
    expect(await fs.readFile(path.join(root, first.video.relative_url.slice('/uploads/'.length)), 'utf8')).toBe('0000ftypisom');
    saved = { id: first.video.file_id, url: first.video.relative_url, size: first.video.size, mime_type: 'video/mp4' };
    const second = await handlers.replicate_check_prediction(query, 17, context);
    expect(second.video).toEqual(first.video);
    expect(mocks.dbRun).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });
  it.each(['http://127.0.0.1/private', 'https://evil.test/a.mp4', 'file:///etc/passwd'])('rejects an untrusted output URL %s', async output => {
    mocks.fetch.mockResolvedValue(reply({ id: 'pred123', status: 'succeeded', model: 'bytedance/seedance-2.0', output }));
    expect((await handlers.replicate_check_prediction({ prediction_id: 'pred123', kind: 'video' }, 17, context)).error).toBeTruthy();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not retry an ambiguous paid submission or expose the token', async () => {
    mocks.fetch.mockImplementation(async url => {
      if (url.endsWith('/files')) return reply({ urls: { get: 'https://api.replicate.com/v1/files/uploaded' } });
      throw new Error('connection reset: space-token');
    });
    const result = await handlers.replicate_video_generate(args, 17, context);
    expect(result.submission_unknown).toBe(true);
    expect(JSON.stringify(result)).not.toContain('space-token');
    expect(mocks.fetch).toHaveBeenCalledTimes(5);
  });
  it('preserves 3D common-key fallback and prefers space keys when available', async () => {
    mocks.scoped.mockResolvedValue(null);
    await handlers.replicate_3d_generate({ image_url: 'https://example.com/input.png' }, 17, context);
    expect(mocks.global).toHaveBeenCalledWith('replicate_api_key', 'REPLICATE_API_KEY');
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer global-token');
    mocks.fetch.mockClear(); mocks.global.mockClear(); mocks.scoped.mockResolvedValue('space-token');
    await handlers.replicate_3d_generate({ image_url: 'https://example.com/input.png' }, 17, { space_id: 44 });
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer space-token');
    expect(mocks.global).not.toHaveBeenCalled();
  });
  it('preserves legacy image polling with an explicit key', async () => {
    const result = await handlers.replicate_check_prediction({ prediction_id: 'pred123', kind: 'image' }, 17, { apiKeys: { replicate: 'explicit' } });
    expect(result).toMatchObject({ async: true, status: 'starting' });
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer explicit');
    expect(mocks.scoped).not.toHaveBeenCalled();
  });
  it('rejects another space and mismatched prediction model during video polling', async () => {
    expect((await handlers.replicate_check_prediction({ prediction_id: 'pred123', kind: 'video', space_id: 11 }, 17, context)).error).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.fetch.mockResolvedValue(reply({ id: 'pred123', status: 'succeeded', model: 'other/model', output: 'https://replicate.delivery/a.mp4' }));
    expect((await handlers.replicate_check_prediction({ prediction_id: 'pred123', kind: 'video' }, 17, context)).error).toBe('VIDEO_PREDICTION_MISMATCH');
  });
  it('refuses a symlink input even if it is registered and attached', async () => {
    const link = path.join(root, 'spaces/44/link.png');
    await fs.symlink(path.join(root, 'spaces/44/1.png'), link);
    expect((await handlers.replicate_video_generate({ ...args, reference_images: ['/uploads/spaces/44/link.png'] }, 17, context)).error).toBe('VIDEO_ATTACHMENT_PATH_DENIED');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe('Seedance tool discovery', () => {
  it('exposes the starter in the canonical agent tool list', async () => {
    const { AGENT_TOOLS } = await import('../tool-definitions.js');
    expect(AGENT_TOOLS.some(tool => tool.function.name === 'replicate_video_generate')).toBe(true);
    expect(AGENT_TOOLS.find(tool => tool.function.name === 'replicate_check_prediction').function.parameters.properties.kind.enum).toContain('video');
  });
});

describe('Agent loop conversation context', () => {
  it('derives the billing space from the trusted conversation when the loop omits spaceId', async () => {
    expect(await handlers.replicate_video_generate(args, 17, { conversationId: 3735 })).toMatchObject({ success: true, space_id: 44 });
    expect(mocks.scoped).toHaveBeenCalledWith('replicate_api_key', { spaceId: 44 });
  });
});

describe('MCP runtime binding', () => {
  it('resolves the conversation from the current active job', async () => {
    const original = mocks.dbGet.getMockImplementation();
    mocks.dbGet.mockImplementation((sql, params) => sql.includes('FROM agent_jobs') ? { conversation_id: 3735 } : original(sql, params));
    expect(await handlers.replicate_video_generate(args, 1, { source: 'mcp', jobId: 9, agentId: 21, spaceId: 44 })).toMatchObject({ success: true, space_id: 44 });
    expect(mocks.dbGet).toHaveBeenCalledWith(expect.stringContaining('j.agent_row_id = ?'), [9, 21, 44]);
  });
  it('refuses inactive/mismatched MCP jobs even with a conversation supplied', async () => {
    expect((await handlers.replicate_video_generate(args, 1, { ...context, source: 'mcp', jobId: 9, agentId: 21 })).error).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

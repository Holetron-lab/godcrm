// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createJob = vi.fn();
const schedule = vi.fn();
const getJob = vi.fn();
const toPublicJob = vi.fn();
const requireEditorAccess = vi.fn();
const dbGet = vi.fn();

vi.mock('../../../../services/documents/import/instance.js', () => ({
  documentConversionService: {
    createJob: (...args) => createJob(...args),
    schedule: (...args) => schedule(...args),
    getJob: (...args) => getJob(...args),
    toPublicJob: (...args) => toPublicJob(...args),
  },
}));
vi.mock('../../../../services/documents/resolveBinding.js', () => ({
  resolveBinding: vi.fn().mockResolvedValue({ project_id: 7, registry_table_id: 2197 }),
}));
vi.mock('../_helpers.js', () => ({
  requireEditorAccess: (...args) => requireEditorAccess(...args),
}));
vi.mock('../../../../database/connection.js', () => ({ dbGet: (...args) => dbGet(...args) }));

const { default: router } = await import('../conversions.js');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { req.user = { id: 42 }; next(); });
  instance.use(router);
  return instance;
}

beforeEach(() => {
  createJob.mockReset().mockResolvedValue({ id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10', status: 'queued' });
  schedule.mockReset();
  getJob.mockReset();
  toPublicJob.mockReset().mockReturnValue({ conversion_id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10', status: 'converted', markdown: '# Doc' });
  requireEditorAccess.mockReset().mockResolvedValue(true);
  dbGet.mockReset().mockResolvedValue({ space_id: 11 });
});

describe('document conversion routes', () => {
  it('accepts one PDF upload and schedules a persisted job', async () => {
    const response = await request(app())
      .post('/documents/conversions')
      .field('widget_id', '218')
      .field('language', 'auto')
      .attach('file', Buffer.from('%PDF-1.7\nbody'), 'a.pdf');

    expect(response.status).toBe(202);
    expect(response.body.data.status).toBe('queued');
    expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ widgetId: 218, requestedBy: 42 }));
    expect(schedule).toHaveBeenCalledWith('6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10');
  });

  it('requires exactly one source', async () => {
    const response = await request(app()).post('/documents/conversions').send({ widget_id: 218 });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DOCUMENT_SOURCE_REQUIRED');
    expect(createJob).not.toHaveBeenCalled();
  });

  it('returns the persisted result only to the owner with editor access', async () => {
    getJob.mockResolvedValue({ id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10', requested_by: 42, project_id: 7, space_id: 11, status: 'converted' });
    const response = await request(app()).get('/documents/conversions/6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10');

    expect(response.status).toBe(200);
    expect(response.body.data.markdown).toBe('# Doc');
    expect(toPublicJob).toHaveBeenCalledWith(expect.objectContaining({ status: 'converted' }), { includeMarkdown: true });
  });

  it('denies another user even when job ids are known', async () => {
    getJob.mockResolvedValue({ id: '6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10', requested_by: 1, project_id: 7, space_id: 11, status: 'converted' });
    const response = await request(app()).get('/documents/conversions/6f32c876-59d1-4a3f-9b6b-c9a0d52f0c10');
    expect(response.status).toBe(403);
    expect(toPublicJob).not.toHaveBeenCalled();
  });
});

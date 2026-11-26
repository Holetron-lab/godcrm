// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../errorHandler.js';
import { sendErrorAlert } from '../../services/TelegramService.js';

vi.mock('../../services/TelegramService.js', () => ({
  sendErrorAlert: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

test('malformed URI escapes return 400 in production without a 500 alert', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  const app = express();
  app.get('*', (_req, res) => res.send('ok'));
  app.use(errorHandler);

  const response = await request(app).get('/%c0');

  expect(response.status).toBe(400);
  expect(response.body.error).toMatchObject({
    code: 'MALFORMED_URI',
    message: 'Malformed URL encoding',
  });
  expect(sendErrorAlert).not.toHaveBeenCalled();
});

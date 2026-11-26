// @vitest-environment node
import '../../../test/setup.js';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';

const state = vi.hoisted(() => ({ schema: '', privateKey: '', publicKey: '' }));

vi.mock('node:fs', async (original) => {
  const fs = await original();
  const readFileSync = (path, ...args) => String(path).endsWith('oidc-private.pem')
    ? state.privateKey
    : fs.readFileSync(path, ...args);
  return { ...fs, readFileSync, default: { ...fs, readFileSync } };
});

vi.mock('../../../database/connection.js', async (original) => {
  const db = await original();
  return {
    ...db,
    dbGet: (sql, params) => db.dbGet(sql.replace(
      /\b(FROM|JOIN) (agent_jobs|conversations|users|conversation_participants)\b/g,
      (_match, keyword, table) => `${keyword} ${state.schema}.${table}`,
    ), params),
  };
});

import { dbAll, dbGet, dbRun, destroyAdapter } from '../../../database/connection.js';
import { createLevelSubjectAssertion } from '../levelSubjectAssertion.js';

const runtime = { jobId: 101, agentId: 17, spaceId: 35 };
const issuer = 'https://id.godcrm.ai';
const audience = 'https://admin.sixtynine.ru/api/oauth/token-exchange';

beforeAll(async () => {
  expect((await dbGet('SELECT current_database() AS name')).name).toBe('godcrm_test');
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  state.privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  state.publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  state.schema = `level_assertion_${randomUUID().replaceAll('-', '')}`;
  await dbRun(`CREATE SCHEMA ${state.schema}`);
  await dbRun(`CREATE TABLE ${state.schema}.conversations (id integer PRIMARY KEY, space_id integer)`);
  await dbRun(`CREATE TABLE ${state.schema}.users (id integer PRIMARY KEY, user_type text, status text)`);
  await dbRun(`CREATE TABLE ${state.schema}.conversation_participants (id serial PRIMARY KEY, conversation_id integer, user_id integer)`);
  await dbRun(`CREATE TABLE ${state.schema}.agent_jobs (
    id integer PRIMARY KEY, job_id text, conversation_id integer, agent_row_id integer,
    agent_user_id integer, trigger_user_id integer, status text, context text DEFAULT '{}'
  )`);
});

beforeEach(async () => {
  await dbRun(`TRUNCATE ${state.schema}.agent_jobs, ${state.schema}.conversation_participants, ${state.schema}.users, ${state.schema}.conversations`);
  await dbRun(`INSERT INTO ${state.schema}.conversations VALUES (42, 35)`);
  await dbRun(`INSERT INTO ${state.schema}.users VALUES (123, 'human', 'active')`);
  await dbRun(`INSERT INTO ${state.schema}.conversation_participants (conversation_id, user_id) VALUES (42, 123), (42, 777)`);
  await dbRun(`INSERT INTO ${state.schema}.agent_jobs
    (id, job_id, conversation_id, agent_row_id, agent_user_id, trigger_user_id, status)
    VALUES (101, 'job-210-1', 42, 17, 777, 123, 'processing')`);
});

afterAll(async () => {
  if (state.schema) await dbRun(`DROP SCHEMA IF EXISTS ${state.schema} CASCADE`);
  await destroyAdapter();
});

test('issues a 60-second RS256 assertion only from the live job and participants', async () => {
  const assertion = await createLevelSubjectAssertion(runtime);
  const complete = jwt.decode(assertion, { complete: true });
  expect(complete.header).toMatchObject({ alg: 'RS256', typ: 'JWT', kid: 'godcrm-oidc-key-1' });
  const claims = jwt.verify(assertion, state.publicKey, { algorithms: ['RS256'], issuer, audience });
  expect(claims).toEqual({
    iss: issuer,
    sub: '123',
    aud: audience,
    space_id: 35,
    crm_job_id: 'job-210-1',
    crm_agent_id: '17',
    iat: expect.any(Number),
    nbf: expect.any(Number),
    exp: expect.any(Number),
    jti: expect.any(String),
  });
  expect(claims.exp - claims.iat).toBe(60);
  expect(claims.nbf).toBe(claims.iat);
  expect(claims).not.toHaveProperty('site');
  expect(claims).not.toHaveProperty('object');
  expect(claims).not.toHaveProperty('scope');
  const second = jwt.decode(await createLevelSubjectAssertion(runtime));
  expect(second.jti).not.toBe(claims.jti);
  expect(JSON.stringify(await dbAll(`SELECT * FROM ${state.schema}.agent_jobs`))).not.toContain(assertion);
});

test.each([
  ['missing job', { jobId: 999, agentId: 17, spaceId: 35 }, async () => {}],
  ['completed job', runtime, async () => dbRun(`UPDATE ${state.schema}.agent_jobs SET status = 'completed'`)],
  ['wrong agent', { ...runtime, agentId: 18 }, async () => {}],
  ['wrong runtime space', { ...runtime, spaceId: 11 }, async () => {}],
  ['wrong conversation space', runtime, async () => dbRun(`UPDATE ${state.schema}.conversations SET space_id = 11`)],
  ['inactive human', runtime, async () => dbRun(`UPDATE ${state.schema}.users SET status = 'disabled'`)],
  ['non-human initiator', runtime, async () => dbRun(`UPDATE ${state.schema}.users SET user_type = 'agent'`)],
  ['human not participant', runtime, async () => dbRun(`DELETE FROM ${state.schema}.conversation_participants WHERE user_id = 123`)],
  ['agent not participant', runtime, async () => dbRun(`DELETE FROM ${state.schema}.conversation_participants WHERE user_id = 777`)],
])('rejects %s without signing', async (_name, input, mutate) => {
  await mutate();
  await expect(createLevelSubjectAssertion(input)).rejects.toThrow('LEVEL_JOB_FORBIDDEN');
});

test('rejects caller-supplied identity and assertion fields', async () => {
  await expect(createLevelSubjectAssertion({ ...runtime, sub: '999', crm_job_id: 'forged' }))
    .rejects.toThrow('LEVEL_JOB_FORBIDDEN');
});

test('fails closed instead of falling back to another signing algorithm', async () => {
  state.privateKey = '';
  await expect(createLevelSubjectAssertion(runtime)).rejects.toThrow('LEVEL_OIDC_RS256_UNAVAILABLE');
});

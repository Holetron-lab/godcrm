import express from 'express';
import { z } from 'zod';
import {
  BlueprintError,
  ModuleRegistryError,
  createInternalDraft,
  getModuleRegistryEntry,
  listModuleRegistry,
  moderateModule,
  publishModule,
  submitModule,
  updateModuleMeta,
} from '../../services/ModuleRegistryService.js';
import { badRequest, created, error, notFound, success } from '../../utils/response.js';
import { apiLogger } from '../../utils/logger.js';

const router = express.Router();
const spaceId = z.coerce.number().int().positive();
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const key = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const category = z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/).optional();
const blueprint = z.record(z.unknown());
const mediaItemSchema = z.object({
  type: z.enum(['image', 'video']),
  url: z.string().min(1).max(2000),
  title: z.string().max(255).optional(),
  thumbnail_url: z.string().min(1).max(2000).optional(),
  captions_url: z.string().min(1).max(2000).optional(),
}).strict();

const createSchema = z.object({
  space_id: spaceId,
  origin: z.enum(['default', 'internal', 'external']).optional(),
  blueprint,
  category,
}).strict();
const publishSchema = z.object({
  space_id: spaceId,
  version,
  blueprint: blueprint.optional(),
  category,
}).strict();
const updateSchema = z.object({
  space_id: spaceId,
  version,
  blueprint: z.object({
    description: z.string().max(2000).optional(),
    readme: z.string().max(100000).optional(),
    media: z.array(mediaItemSchema).max(20).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0),
}).strict();
const transitionSchema = z.object({ space_id: spaceId, version }).strict();
const moderateSchema = transitionSchema.extend({ decision: z.enum(['audited', 'rejected']) }).strict();
const listSchema = z.object({
  space_id: spaceId,
  origin: z.enum(['default', 'internal', 'external']).optional(),
  components: z.union([z.string(), z.array(z.string())]).optional(),
  category,
  search: z.string().max(200).optional(),
  can_install: z.enum(['true', 'false']).optional(),
  key: key.optional(),
  version: version.optional(),
}).strict();

function parsed(schema, value, res) {
  const result = schema.safeParse(value);
  if (!result.success) {
    badRequest(res, 'Invalid module registry request', 'REGISTRY_REQUEST_INVALID');
    return null;
  }
  return result.data;
}

function components(value) {
  if (!value) return [];
  return [...new Set((Array.isArray(value) ? value : value.split(','))
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function fail(res, err, context) {
  if (err instanceof ModuleRegistryError) return error(res, err.code, err.message, err.status);
  if (err instanceof BlueprintError) return error(res, err.code, err.message, 422, err.details);
  apiLogger.error({ err, ...context }, '[module-registry] operation failed');
  return error(res, 'MODULE_REGISTRY_OPERATION_FAILED', 'Module registry operation failed');
}

router.get('/', async (req, res) => {
  const query = parsed(listSchema, req.query, res);
  if (!query) return;
  try {
    const items = await listModuleRegistry({
      ...query,
      spaceId: query.space_id,
      userId: req.user?.id,
      components: components(query.components),
      canInstall: query.can_install === undefined ? undefined : query.can_install === 'true',
    });
    return success(res, { items });
  } catch (err) {
    return fail(res, err, { spaceId: query.space_id });
  }
});

router.get('/:key', async (req, res) => {
  const query = parsed(listSchema, req.query, res);
  if (!query) return;
  const moduleKey = parsed(key, req.params.key, res);
  if (!moduleKey) return;
  try {
    const item = await getModuleRegistryEntry({
      ...query,
      spaceId: query.space_id,
      userId: req.user?.id,
      key: moduleKey,
      components: components(query.components),
      canInstall: query.can_install === undefined ? undefined : query.can_install === 'true',
    });
    if (!item) return notFound(res, 'Module registry entry');
    return success(res, { item });
  } catch (err) {
    return fail(res, err, { spaceId: query.space_id, key: moduleKey });
  }
});

router.post('/', async (req, res) => {
  const body = parsed(createSchema, req.body, res);
  if (!body) return;
  try {
    const item = await createInternalDraft({
      ...body,
      spaceId: body.space_id,
      userId: req.user?.id,
    });
    return created(res, { item });
  } catch (err) {
    return fail(res, err, { spaceId: body.space_id, key: body.blueprint.key });
  }
});

router.patch('/:key', async (req, res) => {
  const moduleKey = parsed(key, req.params.key, res);
  const body = parsed(updateSchema, req.body, res);
  if (!moduleKey || !body) return;
  try {
    const item = await updateModuleMeta({
      key: moduleKey,
      version: body.version,
      spaceId: body.space_id,
      userId: req.user?.id,
      blueprint: body.blueprint,
    });
    return success(res, { item });
  } catch (err) {
    return fail(res, err, { spaceId: body.space_id, key: moduleKey });
  }
});

router.post('/:key/publish', async (req, res) => {
  const moduleKey = parsed(key, req.params.key, res);
  const body = parsed(publishSchema, req.body, res);
  if (!moduleKey || !body) return;
  try {
    const item = await publishModule({
      ...body,
      key: moduleKey,
      spaceId: body.space_id,
      userId: req.user?.id,
    });
    return success(res, { item });
  } catch (err) {
    return fail(res, err, { spaceId: body.space_id, key: moduleKey });
  }
});

router.post('/:key/submit', async (req, res) => {
  const moduleKey = parsed(key, req.params.key, res);
  const body = parsed(transitionSchema, req.body, res);
  if (!moduleKey || !body) return;
  try {
    const item = await submitModule({
      key: moduleKey,
      version: body.version,
      spaceId: body.space_id,
      userId: req.user?.id,
    });
    return success(res, { item });
  } catch (err) {
    return fail(res, err, { spaceId: body.space_id, key: moduleKey });
  }
});

router.post('/:key/moderate', async (req, res) => {
  const moduleKey = parsed(key, req.params.key, res);
  const body = parsed(moderateSchema, req.body, res);
  if (!moduleKey || !body) return;
  try {
    const item = await moderateModule({
      key: moduleKey,
      version: body.version,
      decision: body.decision,
      spaceId: body.space_id,
      userId: req.user?.id,
    });
    return success(res, { item });
  } catch (err) {
    return fail(res, err, { spaceId: body.space_id, key: moduleKey });
  }
});

export default router;

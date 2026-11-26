import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { changeLevelClient, levelActionSchema } from '../../services/oidc/levelProvisioning.js';
import { verifyLevelPilotEmail } from '../../services/oidc/levelEmailVerification.js';
import { apiLogger } from '../../utils/logger.js';

const router = express.Router();
const bodySchema = z.object({ data: levelActionSchema }).strict();
const emailVerificationSchema = z.object({ data: z.object({
  user_id: z.literal(6), request_id: z.string().uuid(),
}).strict() }).strict();
const conflicts = new Set(['WRONG_MASTER', 'WRONG_DATABASE', 'SCHEMA_MISMATCH', 'SCHEMA_REQUIRED_COLUMN',
  'CLIENT_CONFLICT', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'SECRET_VAULT_UNAVAILABLE',
  'SECRET_READBACK_FAILED', 'SECRET_UNAVAILABLE', 'BACKUP_PERMISSIONS', 'BACKUP_MISMATCH', 'TARGET_NOT_ELIGIBLE']);

router.post('/admin/level', authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.authMethod !== 'jwt') return res.status(401).json({ error: 'OWNER_SESSION_REQUIRED' });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  try {
    const data = await changeLevelClient({ ...parsed.data.data, actor: req.user.id });
    return res.json({ success: true, data });
  } catch (err) {
    const code = err.message;
    if (code === 'OWNER_REQUIRED') return res.status(403).json({ error: code });
    if (code === 'CLIENT_NOT_FOUND') return res.status(404).json({ error: code });
    if (conflicts.has(code)) return res.status(409).json({ error: code });
    apiLogger.error({ action: parsed.data.data.action, actor: req.user.id }, 'Level operation failed');
    return res.status(500).json({ error: 'LEVEL_OPERATION_FAILED' });
  }
});

router.post('/admin/level/email-verification', authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.authMethod !== 'jwt') return res.status(401).json({ error: 'OWNER_SESSION_REQUIRED' });
  const parsed = emailVerificationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  try {
    const data = await verifyLevelPilotEmail({ ...parsed.data.data, actor: req.user.id });
    return res.json({ success: true, data });
  } catch (err) {
    const code = err.message;
    if (code === 'OWNER_REQUIRED') return res.status(403).json({ error: code });
    if (code === 'TARGET_NOT_FOUND') return res.status(404).json({ error: code });
    if (conflicts.has(code)) return res.status(409).json({ error: code });
    apiLogger.error({ actor: req.user.id }, 'Level email verification failed');
    return res.status(500).json({ error: 'EMAIL_VERIFICATION_FAILED' });
  }
});

export default router;

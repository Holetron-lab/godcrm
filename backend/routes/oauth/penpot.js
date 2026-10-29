import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { changePenpotClient, penpotActionSchema } from '../../services/oidc/penpotProvisioning.js';
import { apiLogger } from '../../utils/logger.js';

const router = express.Router();
const bodySchema = z.object({ data: penpotActionSchema }).strict();
const conflicts = new Set(['WRONG_MASTER', 'WRONG_DATABASE', 'SCHEMA_MISMATCH', 'SCHEMA_REQUIRED_COLUMN',
  'CLIENT_CONFLICT', 'REVISION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'SECRET_VAULT_UNAVAILABLE',
  'SECRET_READBACK_FAILED', 'SECRET_UNAVAILABLE', 'BACKUP_PERMISSIONS', 'BACKUP_MISMATCH']);

router.post('/admin/penpot', authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.authMethod !== 'jwt') return res.status(401).json({ error: 'OWNER_SESSION_REQUIRED' });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  try {
    const data = await changePenpotClient({ ...parsed.data.data, actor: req.user.id });
    return res.json({ success: true, data });
  } catch (err) {
    const code = err.message;
    if (code === 'OWNER_REQUIRED') return res.status(403).json({ error: code });
    if (code === 'CLIENT_NOT_FOUND') return res.status(404).json({ error: code });
    if (conflicts.has(code)) return res.status(409).json({ error: code });
    // Database/vault failures can contain secrets; record only safe identifiers.
    apiLogger.error({ action: parsed.data.data.action, actor: req.user.id }, 'Penpot operation failed');
    return res.status(500).json({ error: 'PENPOT_OPERATION_FAILED' });
  }
});

export default router;

import express from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { changeForgejoClient } from '../../services/oidc/forgejoProvisioning.js';
import { apiLogger } from '../../utils/logger.js';

const router = express.Router();
const bodySchema = z.object({ data: z.object({ action: z.enum(['provision', 'disable', 'enable']) }).strict() }).strict();
const conflicts = new Set(['WRONG_MASTER', 'WRONG_DATABASE', 'SCHEMA_MISMATCH', 'SCHEMA_REQUIRED_COLUMN',
  'CLIENT_CONFLICT', 'CLIENT_DISABLED_CONFLICT', 'SECRET_VAULT_UNAVAILABLE', 'SECRET_READBACK_FAILED', 'SECRET_UNAVAILABLE',
  'BACKUP_PERMISSIONS', 'BACKUP_MISMATCH']);

router.post('/admin/forgejo', authenticate, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.authMethod !== 'jwt') return res.status(401).json({ error: 'OWNER_SESSION_REQUIRED' });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  try {
    const result = await changeForgejoClient({ action: parsed.data.data.action, actor: req.user.id });
    return res.json({ success: true, data: result });
  } catch (err) {
    const code = err.message;
    if (code === 'OWNER_REQUIRED') return res.status(403).json({ error: code });
    if (code === 'CLIENT_NOT_FOUND') return res.status(404).json({ error: code });
    if (conflicts.has(code)) return res.status(409).json({ error: code });
    // DB errors can embed SQL parameters (including vault ciphertext). Do not log err.
    apiLogger.error({ action: parsed.data.data.action, actor: req.user.id }, 'Forgejo provisioning failed');
    return res.status(500).json({ error: 'PROVISIONING_FAILED' });
  }
});

export default router;

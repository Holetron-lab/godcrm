import { z } from 'zod';
import { runCrmScript } from '../codemode/client.js';

const inputSchema = z.object({
  code: z.string().min(1).max(100_000),
  timeout_ms: z.number().int().positive().max(60_000).optional(),
  purpose: z.string().max(200).optional(),
}).strict();

export const codemodeToolHandlers = {
  run_crm_script: async (args, userId, context) => {
    if (process.env.CODEMODE_ENABLED !== 'true') return { error: 'codemode_disabled' };
    if (Number(context?.codemode?.depth || 0) > 0) return { error: 'codemode_nested_forbidden' };
    const parsed = inputSchema.safeParse(args);
    if (!parsed.success) return { error: 'invalid_arguments', details: parsed.error.flatten() };
    return runCrmScript({
      code: parsed.data.code,
      limits: { timeout_ms: parsed.data.timeout_ms },
      context,
      userId,
      purpose: parsed.data.purpose,
    });
  },
};

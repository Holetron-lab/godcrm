// ADR-0011 · Phase C · method plugin registry.
//
// Plugin contract:
//   {
//     name: string,
//     verify({ context, submission }) -> Promise<
//       | { ok: true, at: string, code_hash: string }
//       | { ok: false, code: string, message: string, status?: number }
//     >
//   }
//
// context: { userId, tableId, rowId, columnId, column, config }
// submission: { method: string, code?: string, token?: string, ... }

import { totpMethod } from './totp.js';
import { captchaMethod } from './captcha.js';
import { smsMethod } from './sms.js';
import { emailMethod } from './email.js';

const registry = new Map();

export function registerMethod(plugin) {
  if (!plugin || typeof plugin.name !== 'string' || typeof plugin.verify !== 'function') {
    throw new Error('method plugin must expose { name: string, verify: function }');
  }
  registry.set(plugin.name, plugin);
}

export function getMethod(name) {
  return registry.get(name) || null;
}

export function listRegisteredMethods() {
  return Array.from(registry.keys());
}

// Bootstrap built-ins on module load.
registerMethod(totpMethod);
registerMethod(captchaMethod);
registerMethod(smsMethod);
registerMethod(emailMethod);

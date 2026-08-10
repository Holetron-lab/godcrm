// resolve hook used by register-stub.mjs — maps TelegramService.js → telegram-stub.mjs
import { pathToFileURL } from 'node:url';

const STUB = pathToFileURL(process.cwd() + '/scripts/smoke/telegram-stub.mjs').href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('TelegramService.js')) {
    return { url: STUB, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

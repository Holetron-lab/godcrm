// ESM resolve hook: redirect any import of TelegramService.js to the smoke stub.
// No source files are modified — interception happens purely at module resolution.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./resolve-hook.mjs', pathToFileURL('./scripts/smoke/'));

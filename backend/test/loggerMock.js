// loggerMock — a utils/logger.js module mock that cannot go stale.
//
// Three suites hand-listed the four pino levels they expected to be called:
//
//   vi.mock('../../../utils/logger.js', () => ({
//     apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
//   }));
//
// Then SecretsVault.js grew `const log = apiLogger.child({ module: 'secrets_vault' })`
// at module scope. `.child` was not on the stub, so the *import* threw — and a
// suite whose module never loads reports no failing assertions at all, just
// "no tests". All three files vanished from the run rather than failing loudly.
//
// A logger stub is pure output: nothing a test asserts depends on which methods
// exist, only that calling them is harmless. So return a self-similar recorder —
// `child()` hands back the same object, and every named logger is present.

import { vi } from 'vitest';

/** One recorder whose `.child()` is itself, so arbitrarily deep chaining works. */
export function createLoggerStub() {
  const stub = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    silent: vi.fn(),
    level: 'silent',
  };
  stub.child = () => stub;
  return stub;
}

/**
 * Use as the whole factory:
 *
 *   vi.mock('../../../utils/logger.js', async () =>
 *     (await import('../../test/loggerMock.js')).loggerMock());
 *
 * The dynamic import is required: `vi.mock` factories are hoisted above the
 * file's imports, so a top-level import would be in the temporal dead zone.
 */
export function loggerMock() {
  const logger = createLoggerStub();
  return {
    logger,
    default: logger,
    dbLogger: logger,
    authLogger: logger,
    apiLogger: logger,
    webhookLogger: logger,
    fileLogger: logger,
    aiLogger: logger,
    syncLogger: logger,
    requestLogger: (_req, _res, next) => next?.(),
    createOperationLogger: () => logger,
    logQuery: vi.fn(),
    logAuthEvent: vi.fn(),
  };
}

export default loggerMock;

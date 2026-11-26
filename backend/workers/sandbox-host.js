import { apiLogger } from '../utils/logger.js';
import { codemodeEnvScrubbed, scrubCodemodeEnv } from '../services/codemode/env.js';

const log = apiLogger.child({ module: 'codemode_sandbox' });

async function main() {
  scrubCodemodeEnv();
  const key = process.env.CODEMODE_HMAC_KEY;
  if (!key || key.length < 32) throw new Error('CODEMODE_HMAC_KEY must contain at least 32 characters');

  const [{ selectSandboxDriver }, { startSandboxServer }] = await Promise.all([
    import('../services/codemode/drivers/index.js'),
    import('../services/codemode/host.js'),
  ]);
  const selected = await selectSandboxDriver();
  if (selected.warning) log.warn({ warning: selected.warning }, 'Code Mode sandbox driver fallback');
  const { driver } = selected;
  const probe = { ...selected.probe, env_scrub: codemodeEnvScrubbed() };
  if (!probe.ok || !probe.env_scrub) throw new Error(`Sandbox self-test failed: ${JSON.stringify(probe)}`);

  const socketPath = process.env.CODEMODE_SOCKET || '/run/godcrm/sandbox.sock';
  const server = await startSandboxServer({ socketPath, key, driver });
  log.info({ socket: socketPath, driver: driver.name, probe }, 'Code Mode sandbox host ready');

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  log.error({ err: error }, 'Code Mode sandbox host failed to start');
  process.exit(1);
});

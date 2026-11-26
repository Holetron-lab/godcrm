import { QuickJsDriver } from './quickjs.js';

async function loadIsolatedVm() {
  const { IsolatedVmDriver } = await import('./isolated-vm.js');
  return IsolatedVmDriver.create();
}

export async function selectSandboxDriver({
  requested = process.env.CODEMODE_DRIVER || 'auto',
  loadPrimary = loadIsolatedVm,
  fallback = new QuickJsDriver(),
} = {}) {
  if (!['auto', 'isolated-vm', 'quickjs'].includes(requested)) {
    throw new Error(`Unsupported CODEMODE_DRIVER: ${requested}`);
  }

  let warning = null;
  if (requested !== 'quickjs') {
    try {
      const primary = await loadPrimary();
      const probe = await primary.probe();
      if (probe.ok) return { driver: primary, probe, warning };
      warning = `isolated-vm sandbox self-test failed: ${JSON.stringify(probe.details)}`;
    } catch (error) {
      warning = `isolated-vm unavailable: ${error.message}`;
    }
  }

  const probe = await fallback.probe();
  if (!probe.ok) throw new Error(`QuickJS sandbox self-test failed: ${JSON.stringify(probe.details)}`);
  return { driver: fallback, probe, warning };
}

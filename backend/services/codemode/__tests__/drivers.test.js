// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { selectSandboxDriver } from '../drivers/index.js';

function fakeDriver(name, ok = true) {
  return {
    name,
    probe: vi.fn(async () => ({ ok, version: name, abi: 'test', details: ok ? 'ok' : 'failed' })),
  };
}

describe('selectSandboxDriver', () => {
  it('uses isolated-vm after a successful probe in auto mode', async () => {
    const primary = fakeDriver('isolated-vm');
    const fallback = fakeDriver('quickjs');
    const selected = await selectSandboxDriver({
      requested: 'auto',
      loadPrimary: async () => primary,
      fallback,
    });
    expect(selected.driver).toBe(primary);
    expect(selected.warning).toBeNull();
    expect(fallback.probe).not.toHaveBeenCalled();
  });

  it('falls back to QuickJS when isolated-vm cannot load in forced mode', async () => {
    const fallback = fakeDriver('quickjs');
    const selected = await selectSandboxDriver({
      requested: 'isolated-vm',
      loadPrimary: async () => { throw new Error('MODULE_NOT_FOUND'); },
      fallback,
    });
    expect(selected.driver).toBe(fallback);
    expect(selected.probe.ok).toBe(true);
    expect(selected.warning).toContain('MODULE_NOT_FOUND');
  });

  it('does not load isolated-vm when QuickJS is selected', async () => {
    const fallback = fakeDriver('quickjs');
    const loadPrimary = vi.fn();
    const selected = await selectSandboxDriver({ requested: 'quickjs', loadPrimary, fallback });
    expect(selected.driver).toBe(fallback);
    expect(loadPrimary).not.toHaveBeenCalled();
  });

  it('fails startup when neither driver passes its probe', async () => {
    await expect(selectSandboxDriver({
      requested: 'auto',
      loadPrimary: async () => fakeDriver('isolated-vm', false),
      fallback: fakeDriver('quickjs', false),
    })).rejects.toThrow('QuickJS sandbox self-test failed');
  });
});

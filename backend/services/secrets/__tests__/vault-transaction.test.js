// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import vault from '../SecretsVault.js';

afterEach(async () => { await vault.shutdown(); vi.unstubAllEnvs(); });

test('transactional vault writes/readback do not escape into pool or plaintext cache on rollback', async () => {
  vi.stubEnv('SECRETS_MASTER_KEY', 'a'.repeat(64));
  await vault.init({ allowEnvFallback: false });
  const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const transaction = { query };
  await vault.putSecret('oidc_forgejo_client_secret', 'generated-secret', { transaction, actor: 1 });
  const encrypted = query.mock.calls[0][1][1];
  expect(encrypted).not.toContain('generated-secret');
  expect(vault.health().cacheSize).toBe(0);
  query.mockResolvedValue({ rows: [{ encrypted_payload: encrypted }], rowCount: 1 });
  expect(await vault.getSecret('oidc_forgejo_client_secret', { transaction })).toBe('generated-secret');
  expect(vault.health().cacheSize).toBe(0);
  // The pool has never seen a commit; no uncommitted value may be returned.
  expect(await vault.getSecret('oidc_forgejo_client_secret')).toBeNull();
});

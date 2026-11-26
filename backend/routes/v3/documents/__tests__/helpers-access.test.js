// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEffectiveRole = vi.fn();
const forbidden = vi.fn();

vi.mock('../../../../services/EffectiveRoleService.js', () => ({
  getEffectiveRole: (...args) => getEffectiveRole(...args),
  ACCESS_LEVEL_VALUES: { viewer: 1, editor: 2, admin: 3 },
}));

vi.mock('../../../../utils/response.js', () => ({
  forbidden: (...args) => forbidden(...args),
  success: vi.fn(),
  created: vi.fn(),
  error: vi.fn(),
  badRequest: vi.fn(),
  notFound: vi.fn(),
  unauthorized: vi.fn(),
}));

vi.mock('../../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { requireEditorAccess } = await import('../_helpers.js');

beforeEach(() => {
  getEffectiveRole.mockReset();
  forbidden.mockReset();
});

describe('requireEditorAccess', () => {
  it('denies access when role resolution fails', async () => {
    getEffectiveRole.mockRejectedValue(new Error('role service unavailable'));
    const req = { user: { id: 42 } };
    const res = {};

    await expect(requireEditorAccess(req, res, 7)).resolves.toBe(false);
    expect(forbidden).toHaveBeenCalledWith(res, 'Unable to verify document permissions.');
  });

  it('preserves the normal editor allow path', async () => {
    getEffectiveRole.mockResolvedValue({ effectiveRole: 'editor' });

    await expect(requireEditorAccess({ user: { id: 42 } }, {}, 7)).resolves.toBe(true);
    expect(forbidden).not.toHaveBeenCalled();
  });
});

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';

const initialize = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (selector: (state: { initialize: typeof initialize }) => unknown) => selector({ initialize }),
}));

describe('AppProviders embed ticket initialization', () => {
  beforeEach(() => initialize.mockClear());

  it('does not start cookie auth or refresh for ticket mode', () => {
    window.history.replaceState({}, '', '/embed/chat?auth=ticket&client_id=level');
    render(<AppProviders><div>Embed</div></AppProviders>);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('keeps ordinary cookie initialization', () => {
    window.history.replaceState({}, '', '/embed/chat?space=11');
    render(<AppProviders><div>Embed</div></AppProviders>);
    expect(initialize).toHaveBeenCalledTimes(1);
  });
});

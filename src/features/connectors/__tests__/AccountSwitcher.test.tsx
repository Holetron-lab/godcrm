/**
 * @file AccountSwitcher.test.tsx
 * @description ADR-159 — account switcher state branches + identity binding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { AccountSwitcher } from '../components/AccountSwitcher';
import type { SpaceConnector } from '../api/connectorsApi';

const mockUse = vi.fn();
vi.mock('../hooks/useConnectedAccounts', () => ({
  useConnectedAccounts: (...args: unknown[]) => mockUse(...args),
}));

function account(over: Partial<SpaceConnector> = {}): SpaceConnector {
  return {
    id: 1,
    space_id: 11,
    type_slug: 'google',
    kind: 'oauth2',
    display_name: 'Google',
    status: 'active',
    scopes_requested: [],
    scopes_granted: [],
    account_label: null,
    custom_definition: null,
    expires_at: null,
    last_refresh_at: null,
    last_error: null,
    created_by: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    has_payload: true,
    account_sub: 'sub-1',
    email: 'ada@example.com',
    account_name: 'Ada Lovelace',
    avatar_url: null,
    ...over,
  };
}

const baseProps = {
  spaceId: 11,
  compatibleWith: 'mail',
  activeId: null,
  onSwitch: vi.fn(),
  onConnect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AccountSwitcher', () => {
  it('shows a busy skeleton while loading', () => {
    mockUse.mockReturnValue({ data: [], isLoading: true, isError: false });
    const { container } = render(<AccountSwitcher {...baseProps} />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows an error message on failure', () => {
    mockUse.mockReturnValue({ data: [], isLoading: false, isError: true });
    render(<AccountSwitcher {...baseProps} />);
    expect(screen.getByText(/couldn.t load accounts/i)).toBeInTheDocument();
  });

  it('renders a connect CTA when there are no accounts and calls onConnect', () => {
    mockUse.mockReturnValue({ data: [], isLoading: false, isError: false });
    const onConnect = vi.fn();
    render(<AccountSwitcher {...baseProps} onConnect={onConnect} />);
    const cta = screen.getByRole('button', { name: /connect a mailbox/i });
    fireEvent.click(cta);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('binds the trigger to identity columns (name + email)', () => {
    mockUse.mockReturnValue({ data: [account()], isLoading: false, isError: false });
    render(<AccountSwitcher {...baseProps} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('falls back to the first account when activeId is unknown', () => {
    mockUse.mockReturnValue({
      data: [account({ id: 1, account_name: 'First' }), account({ id: 2, account_name: 'Second' })],
      isLoading: false,
      isError: false,
    });
    render(<AccountSwitcher {...baseProps} activeId={999} />);
    expect(screen.getByRole('button', { name: /active account: First/i })).toBeInTheDocument();
  });
});

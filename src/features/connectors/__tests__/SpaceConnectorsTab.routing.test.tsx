/**
 * @file SpaceConnectorsTab.routing.test.tsx
 * @description ADR-160 — add-form is routed by `auth_kind`, not slug prefix.
 * Locks the contract that a first-class api_key type (e.g. `imap`, no `custom_`
 * prefix) renders the data-driven CustomTypeForm — so postfix IMAP/SMTP mailboxes
 * can be connected via host/port/user/pass — instead of the OAuth-only branded form.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { SpaceConnectorsTab } from '../components/SpaceConnectorsTab';
import type { CatalogueType } from '../api/connectorsApi';

const mockCatalogue = vi.fn();
const mockList = vi.fn();
vi.mock('../api/connectorsApi', async (orig) => {
  const actual = await orig<typeof import('../api/connectorsApi')>();
  return {
    ...actual,
    connectorsApi: {
      ...actual.connectorsApi,
      catalogue: () => mockCatalogue(),
      list: () => mockList(),
    },
  };
});

function type(over: Partial<CatalogueType> = {}): CatalogueType {
  return {
    slug: 'imap',
    display_name: 'IMAP / SMTP',
    icon: '📧',
    auth_kind: 'api_key',
    authorize_url: null,
    token_url: null,
    scopes_default: [],
    scopes_choices: [],
    client_env: null,
    fields: [
      { key: 'host', label: 'IMAP host', type: 'text', required: true },
      { key: 'port', label: 'IMAP port', type: 'text', required: true },
      { key: 'user', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    refresh_supported: false,
    ...over,
  };
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider><MemoryRouter>
        <SpaceConnectorsTab spaceId={11} />
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue([]);
});

describe('SpaceConnectorsTab — add-form routing', () => {
  it('renders CustomTypeForm fields for a first-class api_key type (imap)', async () => {
    mockCatalogue.mockResolvedValue([type()]);
    renderTab();

    const chip = await screen.findByRole('button', { name: /IMAP \/ SMTP/i });
    fireEvent.click(chip);

    // Data-driven fields from t.fields — proves CustomTypeForm, not the OAuth form.
    expect(await screen.findByText('IMAP host')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
    // OAuth form would render a "Connect" button; api_key form renders "Save".
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^connect$/i })).not.toBeInTheDocument();
  });

  it('still routes a branded oauth2 type to the OAuth form', async () => {
    mockCatalogue.mockResolvedValue([
      type({ slug: 'google', display_name: 'Google', auth_kind: 'oauth2', fields: [] }),
    ]);
    renderTab();

    const chip = await screen.findByRole('button', { name: /Google/i });
    fireEvent.click(chip);

    expect(await screen.findByRole('button', { name: /^connect$/i })).toBeInTheDocument();
  });
});

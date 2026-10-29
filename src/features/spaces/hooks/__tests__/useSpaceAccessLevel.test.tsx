/**
 * Fleet Audit WP-5 — Bugs 1552/228713, ADR-203 G5 / D3 default:
 * the global `user.role` gates system settings only; inside a space the level
 * comes from the backend, then ownership, then the space's access-control
 * table, and only then (access control off) from the global role.
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/features/auth/store/authStore';
import type { AuthUser } from '@/features/auth/types/auth.types';
import { useSpacesStore } from '../../store/spacesStore';
import type { SpaceModel } from '../../types/space.types';
import {
  resolveSpaceAccessLevel,
  getSpaceAccessLevel,
  useSpaceAccessLevel,
  useSpaceAccessLevelSync,
  hasPrivilegedAccess,
} from '../useSpaceAccessLevel';

const user = (role: AuthUser['role'], id = '77'): AuthUser => ({ id, email: `${role}@example.test`, name: role, role });

const space = (over: Partial<SpaceModel> = {}): SpaceModel => ({
  id: 5,
  owner_id: 77,
  name: 'S',
  type: 'business',
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  ...over,
});

const OWNER_TOOLS = ['canManageSpace', 'canAddWidget', 'canEditSchema'] as const;

describe('resolveSpaceAccessLevel — D3 default (1552/228713)', () => {
  it('G5: a global viewer who owns the space is owner_owner (FE fallback, no backend level)', () => {
    const level = resolveSpaceAccessLevel(space(), user('viewer'));
    expect(level).toBe('owner_owner');
    expect(hasPrivilegedAccess(level)).toBe(true);
  });

  it('ownership wins for every global role, with numeric or string ids', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(resolveSpaceAccessLevel(space(), user(role))).toBe('owner_owner');
      expect(resolveSpaceAccessLevel(space({ owner_id: 77 }), user(role, '77'))).toBe('owner_owner');
    }
  });

  it('trusts the backend-computed level over everything else', () => {
    expect(resolveSpaceAccessLevel(space({ user_access_level: 'editor' }), user('owner'))).toBe('editor');
    expect(resolveSpaceAccessLevel(space({ user_access_level: 'denied', owner_id: 1 }), user('admin'))).toBe('denied');
    // garbage from the API is ignored, not propagated
    expect(resolveSpaceAccessLevel(space({ user_access_level: 'superuser' }), user('viewer'))).toBe('owner_owner');
  });

  it('access control off: global owner/admin are space admins, member and viewer are viewers', () => {
    const foreign = space({ owner_id: 1 });
    expect(resolveSpaceAccessLevel(foreign, user('owner'))).toBe('admin');
    expect(resolveSpaceAccessLevel(foreign, user('admin'))).toBe('admin');
    expect(resolveSpaceAccessLevel(foreign, user('member'))).toBe('viewer');
    expect(resolveSpaceAccessLevel(foreign, user('viewer'))).toBe('viewer');
  });

  it('access control on: the global role is ignored, the space table decides', () => {
    const gated = space({
      owner_id: 1,
      access_control: { enabled: true, roleMapping: { admin: ['boss'], editor: ['writer'], denied: ['banned'] } } as SpaceModel['access_control'],
    });
    // global admin without a table role is a plain viewer here
    expect(resolveSpaceAccessLevel(gated, user('admin'))).toBe('viewer');
    expect(resolveSpaceAccessLevel(gated, user('admin'), null)).toBe('viewer');
    expect(resolveSpaceAccessLevel(gated, user('viewer'), 'Boss')).toBe('admin');
    expect(resolveSpaceAccessLevel(gated, user('viewer'), 'writer')).toBe('editor');
    expect(resolveSpaceAccessLevel(gated, user('owner'), 'banned')).toBe('denied');
  });

  it('no space or no user degrade safely', () => {
    expect(resolveSpaceAccessLevel(null, user('owner'))).toBe('denied');
    expect(resolveSpaceAccessLevel(space({ owner_id: 1 }), null)).toBe('viewer');
    expect(getSpaceAccessLevel(space(), user('viewer'))).toBe('owner_owner');
  });
});

const withQueryClient = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('hooks — G5: global viewer + space owner sees the owner tools', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: user('viewer'), token: 't', initialized: true });
    useSpacesStore.setState({ spaces: [space(), space({ id: 6, owner_id: 1 })] });
  });

  it('useSpaceAccessLevel: every owner flag is on in the own space', () => {
    const { result } = renderHook(() => useSpaceAccessLevel(5), { wrapper: withQueryClient() });
    expect(result.current.accessLevel).toBe('owner_owner');
    expect(result.current.isOwner).toBe(true);
    for (const tool of OWNER_TOOLS) expect(result.current[tool]).toBe(true);
    expect(result.current.canEdit).toBe(true);
  });

  it('useSpaceAccessLevel: the same user is a viewer in a foreign space', () => {
    const { result } = renderHook(() => useSpaceAccessLevel(6), { wrapper: withQueryClient() });
    expect(result.current.accessLevel).toBe('viewer');
    for (const tool of OWNER_TOOLS) expect(result.current[tool]).toBe(false);
    expect(result.current.canView).toBe(true);
  });

  it('useSpaceAccessLevelSync agrees with the async hook', () => {
    const own = renderHook(() => useSpaceAccessLevelSync(space()));
    const foreign = renderHook(() => useSpaceAccessLevelSync(space({ owner_id: 1 })));
    expect(own.result.current).toBe('owner_owner');
    expect(foreign.result.current).toBe('viewer');
  });
});

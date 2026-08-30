import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Loader2, Check, Info, ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { Button } from '@/shared/components/ui';
import { registrationApi } from '../api/registrationApi';
import {
  DEFAULT_REGISTRATION_CONFIG,
  type RegistrationConfig,
  type SignupMode,
  type DefaultRole,
  type SpaceAccessLevel,
} from '../registration.types';

const SIGNUP_MODES: { value: SignupMode; label: string; hint: string }[] = [
  { value: 'open', label: 'Open', hint: 'Anyone can self-register from the login page.' },
  { value: 'invite', label: 'Invite only', hint: 'Only users with a valid referral/invite code can register.' },
  { value: 'closed', label: 'Closed', hint: 'Registration is disabled — the front door is shut.' },
];

const ACCESS_LEVELS: SpaceAccessLevel[] = ['viewer', 'editor', 'admin'];

/**
 * ADR-188 Block F1/F3 — owner-only runtime registration policy editor.
 * Toggles signup mode, the default global role for sign-ups, and the set of
 * spaces new users are auto-joined into. Writes to `_app_settings.registration`
 * via the F1 endpoint; the backend evicts its 60s cache cluster-wide.
 */
export const RegistrationPolicySettings = () => {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [config, setConfig] = useState<RegistrationConfig>(DEFAULT_REGISTRATION_CONFIG);

  // Owner only — hard gate before any fetch.
  const isOwner = user?.role === 'owner';

  const { isLoading } = useQuery({
    queryKey: ['registration-policy'],
    enabled: isOwner,
    queryFn: async () => {
      try {
        const res = await registrationApi.getConfig();
        if (res.data) {
          setConfig({ ...DEFAULT_REGISTRATION_CONFIG, ...res.data, auto_join: res.data.auto_join ?? [] });
          return res.data;
        }
      } catch {
        // Fail-closed: keep the closed default if the policy can't be read.
      }
      return DEFAULT_REGISTRATION_CONFIG;
    },
  });

  const { data: spaces } = useSpacesQuery();

  const updateMutation = useMutation({
    mutationFn: (next: RegistrationConfig) => registrationApi.updateConfig(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['registration-policy'] }),
  });

  if (!isOwner) return null;

  const autoJoinLevel = (spaceId: number): SpaceAccessLevel | null =>
    config.auto_join.find((e) => e.space_id === spaceId)?.access_level ?? null;

  const toggleAutoJoin = (spaceId: number, checked: boolean) => {
    setConfig((prev) => ({
      ...prev,
      auto_join: checked
        ? [...prev.auto_join.filter((e) => e.space_id !== spaceId), { space_id: spaceId, access_level: 'viewer' }]
        : prev.auto_join.filter((e) => e.space_id !== spaceId),
    }));
  };

  const setAutoJoinLevel = (spaceId: number, access_level: SpaceAccessLevel) => {
    setConfig((prev) => ({
      ...prev,
      auto_join: prev.auto_join.map((e) => (e.space_id === spaceId ? { ...e, access_level } : e)),
    }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  const activeMode = SIGNUP_MODES.find((m) => m.value === config.signup_mode);

  return (
    <div className="space-y-6 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3">
        <UserPlus className="h-5 w-5 text-[var(--color-primary-500)]" />
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Registration</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Control who can sign up, the role they get, and where they land — applied without a redeploy.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Signup mode */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Sign-up mode</label>
          <div className="relative">
            <select
              value={config.signup_mode}
              onChange={(e) => setConfig((p) => ({ ...p, signup_mode: e.target.value as SignupMode }))}
              className="w-full appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 pr-10 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
            >
              {SIGNUP_MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-[var(--text-tertiary)]" />
          </div>
          {activeMode && <p className="text-xs text-[var(--text-tertiary)]">{activeMode.hint}</p>}
        </div>

        {/* Default role */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-[var(--text-secondary)]">Default role for new sign-ups</label>
          <div className="relative">
            <select
              value={config.default_role}
              onChange={(e) => setConfig((p) => ({ ...p, default_role: e.target.value as DefaultRole }))}
              className="w-full appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 pr-10 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
            >
              <option value="viewer">Viewer (read-only)</option>
              <option value="user">User</option>
            </select>
            <ChevronDown className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-[var(--text-tertiary)]" />
          </div>
          <p className="text-xs text-[var(--text-tertiary)]">The global account role — auto-join grants space access separately.</p>
        </div>
      </div>

      {/* Auto-join spaces */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-secondary)]">Auto-join spaces</label>
        <p className="text-xs text-[var(--text-tertiary)]">
          New users are added to the selected spaces on registration, at the chosen access level.
        </p>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-2">
          {!spaces?.length && (
            <p className="px-2 py-3 text-sm text-[var(--text-tertiary)]">No spaces available.</p>
          )}
          {spaces?.map((space) => {
            const level = autoJoinLevel(space.id);
            const checked = level !== null;
            return (
              <div
                key={space.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--bg-secondary)]"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleAutoJoin(space.id, e.target.checked)}
                    className="h-4 w-4 flex-shrink-0 cursor-pointer rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
                  />
                  <span className="flex-shrink-0">{space.icon}</span>
                  <span className="truncate text-sm text-[var(--text-primary)]">{space.name}</span>
                </label>
                {checked && (
                  <div className="relative flex-shrink-0">
                    <select
                      value={level ?? 'viewer'}
                      onChange={(e) => setAutoJoinLevel(space.id, e.target.value as SpaceAccessLevel)}
                      className="appearance-none rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] py-1 pl-2 pr-7 text-xs text-[var(--text-primary)] focus:border-primary-500 focus:outline-none cursor-pointer"
                    >
                      {ACCESS_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>{lvl}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute inset-y-0 right-1.5 my-auto h-3 w-3 text-[var(--text-tertiary)]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Info + save */}
      <div className="flex items-start gap-2 rounded-lg border border-primary-500/20 bg-primary-500/10 p-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-500" />
        <p className="text-xs text-primary-600 dark:text-primary-400">
          Changes apply immediately across the cluster — no restart needed. Sign-up mode is enforced on the server.
        </p>
      </div>

      <div className="flex items-center justify-end gap-3">
        {updateMutation.isSuccess && !updateMutation.isPending && (
          <span className="flex items-center gap-1 text-sm text-emerald-500">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
        <Button onClick={() => updateMutation.mutate(config)} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Save registration policy
        </Button>
      </div>
    </div>
  );
};

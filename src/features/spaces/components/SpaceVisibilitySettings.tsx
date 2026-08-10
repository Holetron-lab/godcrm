/**
 * SpaceVisibilitySettings - ADR-105
 * Visibility selector UI for spaces: Internal / Open / External
 * With public URL display, custom slug, and password protection for External mode.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/shared/components/ui/Input';
import { Switch } from '@/shared/components/ui/Switch';
import { showToast } from '@/shared/hooks/useToast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { spacesApi } from '../api/spacesApi';
import type { SpaceVisibility, SpaceVisibilityData } from '../types/space.types';
import {
  Lock,
  Globe,
  Link2,
  Copy,
  Check,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck
} from 'lucide-react';

interface SpaceVisibilitySettingsProps {
  spaceId: number;
}

/** Visibility option configuration */
interface VisibilityOption {
  value: SpaceVisibility;
  icon: typeof Lock;
  label: string;
  description: string;
  iconColor: string;
  borderColor: string;
  bgColor: string;
}

const VISIBILITY_OPTIONS: VisibilityOption[] = [
  {
    value: 'internal',
    icon: Lock,
    label: 'Internal',
    description: 'Only space members can access this space',
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/40',
    bgColor: 'bg-amber-500/10'
  },
  {
    value: 'open',
    icon: Globe,
    label: 'Open',
    description: 'All logged-in users can view this space',
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/40',
    bgColor: 'bg-blue-500/10'
  },
  {
    value: 'external',
    icon: Link2,
    label: 'External',
    description: 'Anyone with the link can view (read-only)',
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/40',
    bgColor: 'bg-emerald-500/10'
  }
];

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,63}$/;

interface SlugPatchError {
  error?: 'slug_taken' | 'slug_reserved' | 'invalid_slug' | string;
  message?: string;
}

export const SpaceVisibilitySettings = ({ spaceId }: SpaceVisibilitySettingsProps) => {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  // Local state
  const [selectedVisibility, setSelectedVisibility] = useState<SpaceVisibility>('internal');
  const [customSlug, setCustomSlug] = useState('');
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedAgent, setCopiedAgent] = useState(false);
  const [slugDirty, setSlugDirty] = useState(false);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [sidebarDefaultOpen, setSidebarDefaultOpen] = useState(true);
  const [sidebarHidden, setSidebarHidden] = useState(false);

  // ─── Queries ───────────────────────────────────────────────────────

  const {
    data: visibilityData,
    isLoading,
    error,
    refetch
  } = useQuery<SpaceVisibilityData>({
    queryKey: ['space-visibility', spaceId],
    queryFn: () => spacesApi.getVisibility(spaceId)
  });

  // Sync server state to local state
  useEffect(() => {
    if (visibilityData) {
      setSelectedVisibility(visibilityData.visibility);
      setPasswordEnabled(visibilityData.has_password);
      if (visibilityData.public_slug && !slugDirty) {
        setCustomSlug(visibilityData.public_slug);
      }
      const prefs = visibilityData.public_sidebar;
      if (prefs) {
        setSidebarDefaultOpen(prefs.default_open);
        setSidebarHidden(prefs.hidden);
      }
    }
  }, [visibilityData, slugDirty]);

  // Live validation: matches backend contract ^[a-z0-9][a-z0-9-]{2,63}$
  const slugIsValid = useMemo(() => SLUG_REGEX.test(customSlug.trim()), [customSlug]);
  const slugChangedFromServer = customSlug.trim() !== (visibilityData?.public_slug ?? '');

  // ─── Mutations ─────────────────────────────────────────────────────

  const setVisibilityMutation = useMutation({
    mutationFn: (visibility: SpaceVisibility) =>
      spacesApi.setVisibility(spaceId, {
        visibility,
        custom_slug: customSlug.trim() || undefined
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      showToast(`Visibility changed to ${data.visibility}`, 'success');
      // Sync slug from server response
      if (data.public_slug) {
        setCustomSlug(data.public_slug);
        setSlugDirty(false);
      }
    },
    onError: () => {
      showToast('Failed to update visibility', 'error');
    }
  });

  const setPasswordMutation = useMutation({
    mutationFn: (pwd: string) => spacesApi.setPublicPassword(spaceId, { password: pwd }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      showToast('Password set successfully', 'success');
      setPassword('');
      setShowPassword(false);
    },
    onError: () => {
      showToast('Failed to set password', 'error');
    }
  });

  const sidebarPrefsMutation = useMutation({
    mutationFn: (prefs: Partial<{ default_open: boolean; hidden: boolean }>) =>
      spacesApi.setPublicSidebarPrefs(spaceId, prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      showToast('Public sidebar updated', 'success');
    },
    onError: () => {
      showToast('Failed to update public sidebar', 'error');
    }
  });

  const removePasswordMutation = useMutation({
    mutationFn: () => spacesApi.removePublicPassword(spaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      showToast('Password removed', 'success');
      setPasswordEnabled(false);
      setPassword('');
    },
    onError: () => {
      showToast('Failed to remove password', 'error');
    }
  });

  // T-152460: dedicated slug update endpoint
  // PATCH /api/v3/spaces/:id/public-slug   body { slug }
  // 200 → { space: {...} }; 409 → { error: 'slug_taken'|'slug_reserved' }; 400 → { error: 'invalid_slug' }
  const updateSlugMutation = useMutation({
    mutationFn: async (slug: string) => {
      try {
        return await apiClient.patch<{ space: Record<string, unknown> }>(
          `/spaces/${spaceId}/public-slug`,
          { slug }
        );
      } catch (err) {
        // apiClient throws Error with raw response body as message — recover structured JSON
        const raw = err instanceof Error ? err.message : String(err);
        let parsed: SlugPatchError | null = null;
        try {
          parsed = JSON.parse(raw) as SlugPatchError;
        } catch {
          // not JSON — bubble generic
        }
        const wrapped = new Error(parsed?.error ?? 'update_failed');
        (wrapped as Error & { payload?: SlugPatchError }).payload = parsed ?? undefined;
        throw wrapped;
      }
    },
    onSuccess: (_data, slug) => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
      setCustomSlug(slug);
      setSlugDirty(false);
      setSlugError(null);
      showToast(t('spaces.external.updated'), 'success');
    },
    onError: (err: Error) => {
      const code = err.message;
      let label: string;
      switch (code) {
        case 'slug_taken':
          label = t('spaces.external.slugTaken');
          break;
        case 'slug_reserved':
          label = t('spaces.external.slugReserved');
          break;
        case 'invalid_slug':
          label = t('spaces.external.invalidSlug');
          break;
        default:
          label = t('spaces.external.updateFailed');
      }
      setSlugError(label);
    }
  });

  // ─── Handlers ──────────────────────────────────────────────────────

  const handleVisibilityChange = useCallback(
    (visibility: SpaceVisibility) => {
      setSelectedVisibility(visibility);
      setVisibilityMutation.mutate(visibility);
    },
    [setVisibilityMutation]
  );

  const handleSaveSlug = useCallback(() => {
    const trimmed = customSlug.trim();
    if (!slugChangedFromServer) return;
    if (!SLUG_REGEX.test(trimmed)) {
      setSlugError(t('spaces.external.invalidSlug'));
      return;
    }
    setSlugError(null);
    updateSlugMutation.mutate(trimmed);
  }, [customSlug, slugChangedFromServer, t, updateSlugMutation]);

  const handlePasswordToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        setPasswordEnabled(true);
      } else {
        // Remove the password
        removePasswordMutation.mutate();
      }
    },
    [removePasswordMutation]
  );

  const handleSetPassword = useCallback(() => {
    if (password.trim().length < 4) {
      showToast('Password must be at least 4 characters', 'error');
      return;
    }
    setPasswordMutation.mutate(password.trim());
  }, [password, setPasswordMutation]);

  // T-152458: Public URL points at the frontend route /s/:slug (NOT /api/v3/public/...).
  const publicUrl = visibilityData?.public_slug
    ? `${window.location.origin}/s/${visibilityData.public_slug}`
    : null;

  // T-152459: Agent URL points at the JSON API for unauthenticated agents.
  const agentUrl = visibilityData?.public_slug
    ? `${window.location.origin}/api/v3/public/s/${visibilityData.public_slug}`
    : null;

  const handleCopyUrl = useCallback(async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      showToast('URL copied to clipboard', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Failed to copy URL', 'error');
    }
  }, [publicUrl]);

  const handleCopyAgentUrl = useCallback(async () => {
    if (!agentUrl) return;
    try {
      await navigator.clipboard.writeText(agentUrl);
      setCopiedAgent(true);
      showToast('URL copied to clipboard', 'success');
      setTimeout(() => setCopiedAgent(false), 2000);
    } catch {
      showToast('Failed to copy URL', 'error');
    }
  }, [agentUrl]);

  const isMutating =
    setVisibilityMutation.isPending ||
    setPasswordMutation.isPending ||
    removePasswordMutation.isPending;

  // ─── Render ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="text-sm">Failed to load visibility settings</span>
        <button
          onClick={() => refetch()}
          className="ml-auto text-xs underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-5 h-5 text-[var(--accent-primary)]" />
          <h4 className="text-sm font-medium text-[var(--text-primary)]">
            Space Visibility
          </h4>
          {isMutating && (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
          )}
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          Control who can discover and access this space. Members with direct access always retain their permissions.
        </p>
      </div>

      {/* Visibility Options */}
      <div className="space-y-2">
        {VISIBILITY_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = selectedVisibility === option.value;

          return (
            <button
              key={option.value}
              type="button"
              disabled={isMutating}
              onClick={() => handleVisibilityChange(option.value)}
              className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-all text-left ${
                isSelected
                  ? `${option.borderColor} ${option.bgColor}`
                  : 'border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)]'
              } ${isMutating ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {/* Radio indicator */}
              <div className="mt-0.5 shrink-0">
                <div
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? `${option.borderColor} ${option.bgColor}`
                      : 'border-[var(--border-primary)]'
                  }`}
                >
                  {isSelected && (
                    <div
                      className={`w-2 h-2 rounded-full ${
                        option.value === 'internal'
                          ? 'bg-amber-400'
                          : option.value === 'open'
                            ? 'bg-blue-400'
                            : 'bg-emerald-400'
                      }`}
                    />
                  )}
                </div>
              </div>

              {/* Icon */}
              <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${isSelected ? option.iconColor : 'text-[var(--text-tertiary)]'}`} />

              {/* Text */}
              <div className="flex-1 min-w-0">
                <span
                  className={`text-sm font-medium ${
                    isSelected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {option.label}
                </span>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  {option.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* External mode details */}
      {selectedVisibility === 'external' && (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 space-y-4">
          {/* Public URL */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('spaces.external.publicUrl')}
            </label>
            {publicUrl ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] font-mono truncate select-all">
                  {publicUrl}
                </div>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400">{t('spaces.external.copied')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>{t('spaces.external.copy')}</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="px-3 py-2 rounded-md border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm text-[var(--text-tertiary)] italic">
                URL will be generated after saving
              </div>
            )}
          </div>

          {/* Agent URL (JSON) — T-152459 */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('spaces.external.agentUrl')}
            </label>
            {agentUrl ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] font-mono truncate select-all">
                  {agentUrl}
                </div>
                <button
                  type="button"
                  onClick={handleCopyAgentUrl}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  {copiedAgent ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400">{t('spaces.external.copied')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>{t('spaces.external.copy')}</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="px-3 py-2 rounded-md border border-dashed border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm text-[var(--text-tertiary)] italic">
                URL will be generated after saving
              </div>
            )}
          </div>

          {/* Editable slug — T-152460 */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Custom slug
            </label>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 flex items-stretch rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden focus-within:border-[var(--accent-primary)] transition-colors">
                <span className="px-2.5 inline-flex items-center text-sm font-mono text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] border-r border-[var(--border-primary)] select-none">
                  /s/
                </span>
                <input
                  id="space-custom-slug"
                  type="text"
                  value={customSlug}
                  onChange={(e) => {
                    const next = e.target.value.toLowerCase();
                    setCustomSlug(next);
                    setSlugDirty(true);
                    if (slugError) setSlugError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveSlug();
                    }
                  }}
                  placeholder="my-space"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-0 px-2.5 py-2 bg-transparent text-sm text-[var(--text-primary)] font-mono outline-none"
                />
              </div>
              <button
                type="button"
                onClick={handleSaveSlug}
                disabled={
                  !slugChangedFromServer ||
                  !slugIsValid ||
                  updateSlugMutation.isPending
                }
                className="shrink-0 px-3 py-2 text-sm font-medium bg-[var(--accent-primary)] text-white rounded-md hover:bg-[var(--accent-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {updateSlugMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  t('spaces.external.save')
                )}
              </button>
            </div>
            {slugError ? (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {slugError}
              </p>
            ) : !slugIsValid && customSlug.length > 0 ? (
              <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
                {t('spaces.external.invalidSlug')}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
                Letters (a–z), numbers, and hyphens. 3–64 characters.
              </p>
            )}
          </div>

          {/* Public sidebar prefs (owner-managed, applies to public viewers) */}
          <div className="space-y-3 pt-1">
            <Switch
              label="Open sidebar by default"
              description="When unchecked, the public viewer lands with the sidebar collapsed."
              checked={sidebarDefaultOpen}
              onCheckedChange={(checked) => {
                setSidebarDefaultOpen(checked);
                sidebarPrefsMutation.mutate({ default_open: checked });
              }}
              disabled={sidebarPrefsMutation.isPending || sidebarHidden}
            />
            <Switch
              label="Hide menu entirely"
              description="Use when the space has no menu-worthy projects — the hamburger and sidebar are removed."
              checked={sidebarHidden}
              onCheckedChange={(checked) => {
                setSidebarHidden(checked);
                sidebarPrefsMutation.mutate({ hidden: checked });
              }}
              disabled={sidebarPrefsMutation.isPending}
            />
          </div>

          {/* Password Protection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[var(--text-tertiary)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  Password Protection
                </span>
              </div>
              <Switch
                checked={passwordEnabled}
                onCheckedChange={handlePasswordToggle}
                disabled={isMutating}
              />
            </div>

            {passwordEnabled && (
              <div className="space-y-2">
                {visibilityData?.has_password && (
                  <p className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Password is currently set
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      id="space-public-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={visibilityData?.has_password ? 'Enter new password...' : 'Enter password...'}
                      autoComplete="new-password"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSetPassword();
                        }
                      }}
                      rightAddon={
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="hover:text-[var(--text-primary)] transition-colors"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSetPassword}
                    disabled={!password.trim() || setPasswordMutation.isPending}
                    className="shrink-0 px-3 py-2 text-sm font-medium bg-[var(--accent-primary)] text-white rounded-md hover:bg-[var(--accent-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {setPasswordMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : visibilityData?.has_password ? (
                      'Update'
                    ) : (
                      'Set'
                    )}
                  </button>
                </div>
                <p className="text-xs text-[var(--text-tertiary)]">
                  Visitors will need to enter this password before viewing the space.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

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
import { SpaceSeoSettings } from './SpaceSeoSettings';
import {
  Lock,
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
      showToast(t('spaces.visibility.changed', { visibility: t(`spaces.visibility.${data.visibility}`) }), 'success');
      // Sync slug from server response
      if (data.public_slug) {
        setCustomSlug(data.public_slug);
        setSlugDirty(false);
      }
    },
    onError: () => {
      showToast(t('spaces.visibility.updateFailed'), 'error');
    }
  });

  const setPasswordMutation = useMutation({
    mutationFn: (pwd: string) => spacesApi.setPublicPassword(spaceId, { password: pwd }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      showToast(t('spaces.visibility.passwordSet'), 'success');
      setPassword('');
      setShowPassword(false);
    },
    onError: () => {
      showToast(t('spaces.visibility.passwordFailed'), 'error');
    }
  });

  const sidebarPrefsMutation = useMutation({
    mutationFn: (prefs: Partial<{ default_open: boolean; hidden: boolean }>) =>
      spacesApi.setPublicSidebarPrefs(spaceId, prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      showToast(t('spaces.visibility.sidebarUpdated'), 'success');
    },
    onError: () => {
      showToast(t('spaces.visibility.sidebarFailed'), 'error');
    }
  });

  const removePasswordMutation = useMutation({
    mutationFn: () => spacesApi.removePublicPassword(spaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      showToast(t('spaces.visibility.passwordRemoved'), 'success');
      setPasswordEnabled(false);
      setPassword('');
    },
    onError: () => {
      showToast(t('spaces.visibility.removePasswordFailed'), 'error');
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
      setVisibilityMutation.mutate(visibility, {
        onError: () => setSelectedVisibility(visibilityData?.visibility ?? 'internal'),
      });
    },
    [setVisibilityMutation, visibilityData?.visibility]
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
      showToast(t('spaces.visibility.passwordMinLength'), 'error');
      return;
    }
    setPasswordMutation.mutate(password.trim());
  }, [password, setPasswordMutation, t]);

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
      showToast(t('spaces.visibility.urlCopied'), 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast(t('spaces.visibility.copyFailed'), 'error');
    }
  }, [publicUrl, t]);

  const handleCopyAgentUrl = useCallback(async () => {
    if (!agentUrl) return;
    try {
      await navigator.clipboard.writeText(agentUrl);
      setCopiedAgent(true);
      showToast(t('spaces.visibility.urlCopied'), 'success');
      setTimeout(() => setCopiedAgent(false), 2000);
    } catch {
      showToast(t('spaces.visibility.copyFailed'), 'error');
    }
  }, [agentUrl, t]);

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
        <span className="text-sm">{t('spaces.visibility.loadFailed')}</span>
        <button
          onClick={() => refetch()}
          className="ml-auto text-xs underline hover:no-underline"
        >
          {t('spaces.visibility.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor={`space-visibility-${spaceId}`} className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
            <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[var(--accent-primary)]" />
            {t('spaces.visibility.title')}
          </label>
          <select id={`space-visibility-${spaceId}`} value={selectedVisibility}
            disabled={isMutating} aria-describedby={`space-visibility-hint-${spaceId}`}
            onChange={event => handleVisibilityChange(event.target.value as SpaceVisibility)}
            className="w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] disabled:opacity-60 sm:w-48">
            {(['internal', 'open', 'external'] as const).map(value => (
              <option key={value} value={value}>{t(`spaces.visibility.${value}`)}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">{t('spaces.visibility.description')}</p>
        <p id={`space-visibility-hint-${spaceId}`} className="text-sm text-[var(--text-secondary)]">
          {t(`spaces.visibility.${selectedVisibility}Hint`)}
        </p>
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
                {t('spaces.visibility.urlPending')}
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
                {t('spaces.visibility.urlPending')}
              </div>
            )}
          </div>

          {/* Editable slug — T-152460 */}
          <div>
            <label htmlFor="space-custom-slug" className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              {t('spaces.visibility.customSlug')}
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
                {t('spaces.visibility.slugHint')}
              </p>
            )}
          </div>

          {/* Public sidebar prefs (owner-managed, applies to public viewers) */}
          <div className="space-y-3 pt-1">
            <Switch
              label={t('spaces.visibility.sidebarOpen')}
              description={t('spaces.visibility.sidebarOpenHint')}
              checked={sidebarDefaultOpen}
              onCheckedChange={(checked) => {
                setSidebarDefaultOpen(checked);
                sidebarPrefsMutation.mutate({ default_open: checked });
              }}
              disabled={sidebarPrefsMutation.isPending || sidebarHidden}
            />
            <Switch
              label={t('spaces.visibility.sidebarHidden')}
              description={t('spaces.visibility.sidebarHiddenHint')}
              checked={sidebarHidden}
              onCheckedChange={(checked) => {
                setSidebarHidden(checked);
                sidebarPrefsMutation.mutate({ hidden: checked });
              }}
              disabled={sidebarPrefsMutation.isPending}
            />
          </div>

          {/* {t('spaces.visibility.passwordProtection')} */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[var(--text-tertiary)]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {t('spaces.visibility.passwordProtection')}
                </span>
              </div>
              <Switch
                aria-label={t('spaces.visibility.passwordProtection')}
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
                    {t('spaces.visibility.passwordIsSet')}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <Input
                      aria-label={t('spaces.visibility.passwordProtection')}
                      id="space-public-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={visibilityData?.has_password ? t('spaces.visibility.newPassword') : t('spaces.visibility.enterPassword')}
                      autoComplete="new-password"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSetPassword();
                        }
                      }}
                      rightAddon={
                        <button
                          type="button"
                          aria-label={t(showPassword ? 'spaces.visibility.hidePassword' : 'spaces.visibility.showPassword')}
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
                      t('spaces.visibility.updatePassword')
                    ) : (
                      t('spaces.visibility.setPassword')
                    )}
                  </button>
                </div>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {t('spaces.visibility.passwordHint')}
                </p>
              </div>
            )}
          </div>

          {/* Search-engine settings — ADR-190-A */}
          <SpaceSeoSettings
            spaceId={spaceId}
            hasPassword={!!visibilityData?.has_password}
            value={visibilityData?.public_seo}
          />
        </div>
      )}
    </div>
  );
};

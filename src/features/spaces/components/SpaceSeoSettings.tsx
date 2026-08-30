/**
 * SpaceSeoSettings — ADR-190-A D1
 * Owner-managed search-engine settings for an external space, persisted into
 * `spaces.settings.public_seo`.
 *
 * Everything here is a hint, not enforcement: the backend resolver force-excludes
 * a space that is not External or carries a password (D2), whatever is stored.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@/shared/components/ui/Input';
import { Select } from '@/shared/components/ui/Select';
import { Switch } from '@/shared/components/ui/Switch';
import { showToast } from '@/shared/hooks/useToast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { spacesApi } from '../api/spacesApi';
import type { PublicSeoPrefs } from '../types/space.types';
import { AlertCircle, Loader2, Search } from 'lucide-react';

/**
 * Used whenever the space has no `public_seo` stored yet — indexing is opt-in.
 * Mirrors PUBLIC_SEO_DEFAULTS in SpaceVisibilityService.js, `site_origin` and
 * `og_image` included: they are empty because empty means "not configured",
 * which is what lets the backend's origin fallback (space → env → compiled)
 * run. A helpful-looking default sitting in the field gets saved as a real
 * value the first time the owner touches anything else on the form.
 */
export const SEO_DEFAULTS: PublicSeoPrefs = {
  indexable: false,
  in_sitemap: false,
  site_origin: '',
  site_name: 'GOD CRM',
  title_template: '%s — GOD CRM Docs',
  default_description:
    'GOD CRM documentation — spaces, tables, agents, modules and widgets.',
  og_image: '',
  default_lang: 'en'
};

/** Greyed examples for the two fields that default to empty — never persisted. */
const PLACEHOLDERS = {
  site_origin: 'https://godcrm.ai',
  og_image: '/og/godcrm-docs.png'
};

const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' }
];

const ABSOLUTE_URL_REGEX = /^https?:\/\/\S+$/i;

interface SpaceSeoSettingsProps {
  spaceId: number;
  hasPassword: boolean;
  /** Absent until the ADR-190-A backend lands, and for spaces never configured. */
  value?: PublicSeoPrefs;
}

export const SpaceSeoSettings = ({
  spaceId,
  hasPassword,
  value
}: SpaceSeoSettingsProps) => {
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  const [seo, setSeo] = useState<PublicSeoPrefs>(SEO_DEFAULTS);
  const [dirty, setDirty] = useState(false);

  // Stored keys are all optional (D1) — absent ones fall back to defaults.
  useEffect(() => {
    if (!dirty) setSeo({ ...SEO_DEFAULTS, ...(value ?? {}) });
  }, [value, dirty]);

  // Mirrors the backend filters: safeUrl() accepts http(s) or root-relative, an
  // origin must additionally be absolute, and title_template takes one `%s`.
  const errors = useMemo(() => {
    const found: Partial<Record<keyof PublicSeoPrefs, string>> = {};
    const origin = seo.site_origin.trim();
    if (origin && !ABSOLUTE_URL_REGEX.test(origin)) {
      found.site_origin = t('spaces.external.seo.errOrigin');
    }
    const ogImage = seo.og_image.trim();
    if (ogImage && !ABSOLUTE_URL_REGEX.test(ogImage) && !ogImage.startsWith('/')) {
      found.og_image = t('spaces.external.seo.errOgImage');
    }
    if (seo.title_template && seo.title_template.split('%s').length !== 2) {
      found.title_template = t('spaces.external.seo.errTitleTemplate');
    }
    return found;
  }, [seo, t]);

  const hasErrors = Object.keys(errors).length > 0;

  const seoMutation = useMutation({
    mutationFn: (prefs: Partial<PublicSeoPrefs>) =>
      spacesApi.setPublicSeoPrefs(spaceId, prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['space-visibility', spaceId] });
      showToast(t('spaces.external.seo.saved'), 'success');
    },
    onError: () => {
      showToast(t('spaces.external.seo.saveFailed'), 'error');
    }
  });

  // Toggles persist on change (like the sidebar prefs); the text fields are
  // saved as a group, so half-typed values are never persisted.
  const handleToggle = useCallback(
    (key: 'indexable' | 'in_sitemap', checked: boolean) => {
      setSeo((prev) => ({ ...prev, [key]: checked }));
      seoMutation.mutate({ [key]: checked });
    },
    [seoMutation]
  );

  const handleField = useCallback((key: keyof PublicSeoPrefs, fieldValue: string) => {
    setSeo((prev) => ({ ...prev, [key]: fieldValue }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    if (hasErrors) return;
    seoMutation.mutate(
      {
        site_origin: seo.site_origin.trim(),
        site_name: seo.site_name.trim(),
        title_template: seo.title_template.trim(),
        default_description: seo.default_description.trim(),
        og_image: seo.og_image.trim(),
        default_lang: seo.default_lang
      },
      { onSuccess: () => setDirty(false) }
    );
  }, [seo, hasErrors, seoMutation]);

  return (
    <div className="space-y-3 border-t border-[var(--border-primary)] pt-4">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-[var(--text-tertiary)]" />
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {t('spaces.external.seo.title')}
        </span>
        {seoMutation.isPending && (
          <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
        )}
      </div>

      <Switch
        label={t('spaces.external.seo.indexable')}
        description={t('spaces.external.seo.indexableHint')}
        checked={seo.indexable}
        onCheckedChange={(checked) => handleToggle('indexable', checked)}
        disabled={seoMutation.isPending}
      />
      <Switch
        label={t('spaces.external.seo.inSitemap')}
        description={t('spaces.external.seo.inSitemapHint')}
        checked={seo.in_sitemap}
        onCheckedChange={(checked) => handleToggle('in_sitemap', checked)}
        disabled={seoMutation.isPending}
      />

      {hasPassword && (seo.indexable || seo.in_sitemap) && (
        <p className="text-xs text-amber-400 flex items-start gap-1.5">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          {t('spaces.external.seo.passwordWarning')}
        </p>
      )}

      <div className="space-y-3 pt-1">
        <Input
          id="space-seo-origin"
          label={t('spaces.external.seo.origin')}
          value={seo.site_origin}
          onChange={(e) => handleField('site_origin', e.target.value)}
          placeholder={PLACEHOLDERS.site_origin}
          autoComplete="off"
          spellCheck={false}
          error={errors.site_origin}
          hint={t('spaces.external.seo.originHint')}
        />
        <Input
          id="space-seo-site-name"
          label={t('spaces.external.seo.siteName')}
          value={seo.site_name}
          onChange={(e) => handleField('site_name', e.target.value)}
          placeholder={SEO_DEFAULTS.site_name}
          autoComplete="off"
          hint={t('spaces.external.seo.siteNameHint')}
        />
        <Input
          id="space-seo-title-template"
          label={t('spaces.external.seo.titleTemplate')}
          value={seo.title_template}
          onChange={(e) => handleField('title_template', e.target.value)}
          placeholder={SEO_DEFAULTS.title_template}
          autoComplete="off"
          spellCheck={false}
          error={errors.title_template}
          hint={t('spaces.external.seo.titleTemplateHint')}
        />

        <div>
          <label
            htmlFor="space-seo-description"
            className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5"
          >
            {t('spaces.external.seo.description')}
          </label>
          <textarea
            id="space-seo-description"
            value={seo.default_description}
            onChange={(e) => handleField('default_description', e.target.value)}
            rows={2}
            aria-describedby="space-seo-description-hint"
            className="w-full px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] outline-none resize-y focus:border-[var(--accent-primary)] transition-colors"
          />
          <p
            id="space-seo-description-hint"
            className="mt-1.5 text-xs text-[var(--text-tertiary)]"
          >
            {t('spaces.external.seo.descriptionHint')}
          </p>
        </div>

        <Input
          id="space-seo-og-image"
          label={t('spaces.external.seo.ogImage')}
          value={seo.og_image}
          onChange={(e) => handleField('og_image', e.target.value)}
          placeholder={PLACEHOLDERS.og_image}
          autoComplete="off"
          spellCheck={false}
          error={errors.og_image}
          hint={t('spaces.external.seo.ogImageHint')}
        />

        <div>
          <Select
            id="space-seo-lang"
            label={t('spaces.external.seo.lang')}
            value={seo.default_lang}
            onChange={(lang) => handleField('default_lang', lang)}
            options={LANG_OPTIONS}
          />
          <p className="mt-1.5 text-xs text-[var(--text-tertiary)]">
            {t('spaces.external.seo.langHint')}
          </p>
        </div>

        <div className="flex items-center justify-end gap-3">
          {dirty && (
            <span className="text-xs text-[var(--text-tertiary)]">
              {t('spaces.external.seo.unsaved')}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || hasErrors || seoMutation.isPending}
            className="shrink-0 px-3 py-2 text-sm font-medium bg-[var(--accent-primary)] text-white rounded-md hover:bg-[var(--accent-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {seoMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              t('spaces.external.save')
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

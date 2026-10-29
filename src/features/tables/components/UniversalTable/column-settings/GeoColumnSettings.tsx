import React, { useEffect, useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ColumnSettingsProps } from './types';
import type { AddressColumnConfig, ColumnModel } from '../../../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { isSystemColumnId } from '@/features/tables/utils/systemColumns';
import { secretsApi } from '@/features/secrets/api/secretsApi';
import { TemplateHighlight } from './TemplateHighlight';

/**
 * «Гео» column settings (ADR-0035 / ADR-0035-A).
 *
 * - `geo_point`: no settings — the Slice-1 raw `lat, lng` sibling toggle is gone
 *   (ADR-0035-A); a one-line hint explains how the point is entered.
 * - `address`: «Linked geo point» (`config.address.geo_column_id`, only `geo_point`
 *   columns of this table, defaults to the single one), «Label template»
 *   (`config.address.name_template`, §Amendment 1, with a column-key picker), and a
 *   collapsed «Geocoder (soon)» block storing `geocoder.secret_key` / `provider`
 *   for slice B. Key *names* come from `GET /secrets?space_id=`; values never do (AC8).
 */
export const NAME_TEMPLATE_MAX = 200;
export const GEOCODER_PROVIDERS = ['photon', 'dadata', 'nominatim'] as const;
const NONE = '';

const fieldClass =
  'w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]';

export const GeoColumnSettings: React.FC<ColumnSettingsProps> = (props) => {
  const { t } = useLanguage();
  if (props.draft.type === 'address') return <AddressSettings {...props} />;
  return (
    <div className="space-y-1 rounded-lg border border-[var(--border-primary)] p-3" data-testid="geo-point-settings">
      <div className="text-sm font-medium text-[var(--text-primary)]">📍 {t('columnSettings.geo.title')}</div>
      <p className="text-xs text-[var(--text-tertiary)]">{t('columnSettings.geo.hint')}</p>
    </div>
  );
};

const AddressSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft, allColumns = [], spaceId }) => {
  const { t } = useLanguage();
  const linkId = useId();
  const templateId = useId();
  const secretId = useId();
  const providerId = useId();

  const address: AddressColumnConfig = draft.config?.address ?? { geo_column_id: null };
  const geoColumns = useMemo(
    () => allColumns.filter((c: ColumnModel) => c.type === 'geo_point' && !isSystemColumnId(c.id) && c.id !== draft.id),
    [allColumns, draft.id]
  );
  const templateColumns = useMemo(
    () => allColumns.filter((c: ColumnModel) => !isSystemColumnId(c.id) && c.id !== draft.id),
    [allColumns, draft.id]
  );
  const availableKeys = useMemo(() => new Set(templateColumns.map((c) => c.name)), [templateColumns]);

  const patch = (next: Partial<AddressColumnConfig>) =>
    setDraft((prev) => ({
      ...prev,
      config: { ...prev.config, address: { geo_column_id: null, ...(prev.config?.address ?? {}), ...next } },
    }));

  // Default: a column that has never had a link yet (no `address` block at all) and exactly one
  // geo_point in the table → preselect it. An explicit `null` (server-stamped) is respected.
  const hasLinkKey = draft.config?.address?.geo_column_id !== undefined;
  useEffect(() => {
    if (!hasLinkKey && geoColumns.length === 1) patch({ geo_column_id: Number(geoColumns[0].id) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLinkKey, geoColumns]);

  // Key names only — the list endpoint is scrubbed; nothing here ever requests a reveal (AC8).
  const { data: secretNames = [] } = useQuery({
    queryKey: ['secrets', spaceId, 'key-names'],
    queryFn: async () => (await secretsApi.list(spaceId as number)).secrets.map((s) => s.key),
    enabled: typeof spaceId === 'number' && spaceId > 0,
    retry: false,
    staleTime: 60_000,
  });

  const nameTemplate = address.name_template ?? '';
  const setNameTemplate = (raw: string) => patch({ name_template: raw.slice(0, NAME_TEMPLATE_MAX) });
  const commitNameTemplate = () => {
    const trimmed = nameTemplate.trim();
    patch({ name_template: trimmed ? trimmed : null });
  };
  const insertKey = (key: string) => setNameTemplate(`${nameTemplate}${nameTemplate && !nameTemplate.endsWith(' ') ? ' ' : ''}{{${key}}}`);

  const geocoder = address.geocoder ?? { secret_key: null, provider: null };
  const setGeocoder = (next: Partial<AddressColumnConfig['geocoder'] & object>) =>
    patch({ geocoder: { secret_key: geocoder.secret_key ?? null, provider: geocoder.provider ?? null, ...next } });

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border-primary)] p-3" data-testid="address-settings">
      <div className="text-sm font-medium text-[var(--text-primary)]">📮 {t('columnSettings.address.title')}</div>

      {/* Linked geo point */}
      <div className="space-y-1">
        <label htmlFor={linkId} className="block text-sm font-medium text-[var(--text-secondary)]">
          {t('columnSettings.address.linkedPoint')}
        </label>
        <select
          id={linkId}
          data-testid="address-geo-link"
          className={fieldClass}
          value={address.geo_column_id == null ? NONE : String(address.geo_column_id)}
          onChange={(event) => patch({ geo_column_id: event.target.value === NONE ? null : Number(event.target.value) })}
        >
          <option value={NONE}>{t('columnSettings.address.linkedPointNone')}</option>
          {geoColumns.map((c) => (
            <option key={c.id} value={String(c.id)}>📍 {c.displayName || c.name}</option>
          ))}
        </select>
        <p className="text-xs text-[var(--text-tertiary)]">
          {geoColumns.length === 0 ? t('columnSettings.address.linkedPointMissing') : t('columnSettings.address.linkedPointHint')}
        </p>
      </div>

      {/* Label template (§Amendment 1) */}
      <div className="space-y-1">
        <label htmlFor={templateId} className="block text-sm font-medium text-[var(--text-secondary)]">
          {t('columnSettings.address.nameTemplate')}
        </label>
        <input
          id={templateId}
          data-testid="address-name-template"
          type="text"
          className={fieldClass}
          value={nameTemplate}
          maxLength={NAME_TEMPLATE_MAX}
          placeholder="{{title}}"
          onChange={(event) => setNameTemplate(event.target.value)}
          onBlur={commitNameTemplate}
        />
        {templateColumns.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--text-tertiary)]">
            <span>{t('columnSettings.address.insertKey')}</span>
            {templateColumns.map((c) => (
              <button
                key={c.id}
                type="button"
                data-testid={`address-template-key-${c.name}`}
                onClick={() => insertKey(c.name)}
                className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              >
                {`{{${c.name}}}`}
              </button>
            ))}
          </div>
        )}
        <TemplateHighlight text={nameTemplate} availableColumns={availableKeys} />
        <p className="text-xs text-[var(--text-tertiary)]">{t('columnSettings.address.nameTemplateHint')}</p>
      </div>

      {/* Geocoder — reserved for slice B, collapsed, no action buttons */}
      <details data-testid="address-geocoder" className="rounded border border-[var(--border-secondary)]">
        <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[var(--text-secondary)]">
          🧭 {t('columnSettings.address.geocoder')}
        </summary>
        <div className="space-y-3 border-t border-[var(--border-secondary)] p-3">
          <p className="text-xs text-[var(--text-tertiary)]">{t('columnSettings.address.geocoderHint')}</p>
          <div className="space-y-1">
            <label htmlFor={secretId} className="block text-xs font-medium text-[var(--text-secondary)]">
              {t('columnSettings.address.secretKey')}
            </label>
            <input
              id={secretId}
              data-testid="address-geocoder-secret-key"
              type="text"
              list={`${secretId}-names`}
              className={fieldClass}
              placeholder={t('columnSettings.address.secretKeyPlaceholder')}
              value={geocoder.secret_key ?? ''}
              onChange={(event) => setGeocoder({ secret_key: event.target.value.trim() || null })}
            />
            <datalist id={`${secretId}-names`}>
              {secretNames.map((name) => <option key={name} value={name} />)}
            </datalist>
          </div>
          <div className="space-y-1">
            <label htmlFor={providerId} className="block text-xs font-medium text-[var(--text-secondary)]">
              {t('columnSettings.address.provider')}
            </label>
            <select
              id={providerId}
              data-testid="address-geocoder-provider"
              className={fieldClass}
              value={geocoder.provider ?? NONE}
              onChange={(event) => setGeocoder({ provider: event.target.value === NONE ? null : event.target.value })}
            >
              <option value={NONE}>{t('columnSettings.address.providerNone')}</option>
              {GEOCODER_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </details>
    </div>
  );
};

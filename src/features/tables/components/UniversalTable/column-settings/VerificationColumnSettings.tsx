/**
 * VerificationColumnSettings (ADR-0011)
 * Multi-method N-of-M verification gate configuration for a column.
 */

import React, { useMemo, useState } from 'react';
import type { ColumnSettingsProps } from './types';
import type {
  ColumnOption,
  VerificationColumnConfig,
  VerificationMethod,
} from '@/features/tables/types/table.types';

const DEFAULT_VERIFICATION: VerificationColumnConfig = {
  available_methods: ['totp'],
  required_methods: 1,
  locks_on_statuses: [],
  unlocks_on_statuses: [],
  cooldown_seconds: 300,
  ttl_seconds: null,
  guards: [],
  policy: 'all',
};

const METHOD_LABELS: Record<VerificationMethod, string> = {
  totp: '🔐 TOTP',
  captcha: '🧩 Captcha',
  sms: '📱 SMS',
  email: '✉️ Email',
};

const METHODS: VerificationMethod[] = ['totp', 'captcha', 'sms', 'email'];

interface TagInputProps {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

const TagInput: React.FC<TagInputProps> = ({ label, values, onChange, placeholder }) => {
  const [draftTag, setDraftTag] = useState('');

  const addTag = () => {
    const trimmed = draftTag.trim();
    if (!trimmed) return;
    if (values.includes(trimmed)) {
      setDraftTag('');
      return;
    }
    onChange([...values, trimmed]);
    setDraftTag('');
  };

  const removeTag = (tag: string) => {
    onChange(values.filter((v) => v !== tag));
  };

  return (
    <div className="space-y-2">
      <label className="text-sm text-[var(--text-secondary)]">{label}</label>
      <div className="flex flex-wrap gap-1.5 min-h-[2rem] p-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]">
        {values.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-color)]"
          >
            {tag}
            <button
              type="button"
              className="text-[var(--text-tertiary)] hover:text-red-500"
              onClick={() => removeTag(tag)}
              title="Удалить"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draftTag}
          onChange={(e) => setDraftTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag();
            } else if (e.key === 'Backspace' && !draftTag && values.length > 0) {
              removeTag(values[values.length - 1]);
            }
          }}
          onBlur={addTag}
          placeholder={placeholder ?? 'Enter или запятая…'}
          className="flex-1 min-w-[8rem] bg-transparent outline-none text-sm px-1"
        />
      </div>
    </div>
  );
};

interface StatusMultiSelectProps {
  label: string;
  options: Array<{ value: string; label: string; color?: string; source: string }>;
  selected: string[];
  onToggle: (value: string) => void;
}

const StatusMultiSelect: React.FC<StatusMultiSelectProps> = ({
  label,
  options,
  selected,
  onToggle,
}) => (
  <div className="space-y-2">
    <label className="text-sm text-[var(--text-secondary)]">{label}</label>
    <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] min-h-[2rem]">
      {options.map((opt) => {
        const checked = selected.includes(opt.value);
        const color = opt.color || 'var(--color-primary-500)';
        return (
          <button
            type="button"
            key={`${opt.source}:${opt.value}`}
            onClick={() => onToggle(opt.value)}
            title={`${opt.source} → ${opt.label}`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
              checked
                ? 'text-white'
                : 'text-[var(--text-primary)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)]'
            }`}
            style={
              checked
                ? { backgroundColor: color, borderColor: color }
                : { borderColor: 'var(--border-color)' }
            }
          >
            {checked && <span>✓</span>}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  </div>
);

export const VerificationColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns = [],
}) => {
  // ADR-0011 Phase F: config is FLAT at draft.config.* — backend
  // validateVerificationConfig() reads top-level fields. Nested
  // `config.verification.*` is legacy fallback for in-memory state only.
  const flat = draft.config ?? {};
  const legacy = flat.verification;
  const cfg: VerificationColumnConfig = {
    available_methods: flat.available_methods ?? legacy?.available_methods ?? DEFAULT_VERIFICATION.available_methods,
    required_methods: flat.required_methods ?? legacy?.required_methods ?? DEFAULT_VERIFICATION.required_methods,
    locks_on_statuses: flat.locks_on_statuses ?? legacy?.locks_on_statuses ?? DEFAULT_VERIFICATION.locks_on_statuses,
    unlocks_on_statuses: flat.unlocks_on_statuses ?? legacy?.unlocks_on_statuses ?? DEFAULT_VERIFICATION.unlocks_on_statuses,
    cooldown_seconds: flat.cooldown_seconds ?? legacy?.cooldown_seconds ?? DEFAULT_VERIFICATION.cooldown_seconds,
    ttl_seconds: flat.ttl_seconds !== undefined ? flat.ttl_seconds : legacy?.ttl_seconds ?? DEFAULT_VERIFICATION.ttl_seconds,
    guards: flat.guards ?? legacy?.guards ?? DEFAULT_VERIFICATION.guards,
    policy: (flat.policy ?? legacy?.policy ?? DEFAULT_VERIFICATION.policy) as VerificationColumnConfig['policy'],
    rate_limit: flat.rate_limit ?? legacy?.rate_limit,
  };

  const patch = (partial: Partial<VerificationColumnConfig>) => {
    setDraft((prev) => {
      const prevFlat = prev.config ?? {};
      const prevLegacy = prevFlat.verification;
      // Merge from current effective state + patch, then write FLAT on root.
      const merged: VerificationColumnConfig = {
        available_methods: prevFlat.available_methods ?? prevLegacy?.available_methods ?? DEFAULT_VERIFICATION.available_methods,
        required_methods: prevFlat.required_methods ?? prevLegacy?.required_methods ?? DEFAULT_VERIFICATION.required_methods,
        locks_on_statuses: prevFlat.locks_on_statuses ?? prevLegacy?.locks_on_statuses ?? DEFAULT_VERIFICATION.locks_on_statuses,
        unlocks_on_statuses: prevFlat.unlocks_on_statuses ?? prevLegacy?.unlocks_on_statuses ?? DEFAULT_VERIFICATION.unlocks_on_statuses,
        cooldown_seconds: prevFlat.cooldown_seconds ?? prevLegacy?.cooldown_seconds ?? DEFAULT_VERIFICATION.cooldown_seconds,
        ttl_seconds: prevFlat.ttl_seconds !== undefined ? prevFlat.ttl_seconds : prevLegacy?.ttl_seconds ?? DEFAULT_VERIFICATION.ttl_seconds,
        guards: prevFlat.guards ?? prevLegacy?.guards ?? DEFAULT_VERIFICATION.guards,
        policy: (prevFlat.policy ?? prevLegacy?.policy ?? DEFAULT_VERIFICATION.policy) as VerificationColumnConfig['policy'],
        rate_limit: prevFlat.rate_limit ?? prevLegacy?.rate_limit,
        ...partial,
      };
      // Strip legacy nested verification to prevent stale round-trips.
      const { verification: _dropped, ...rest } = prevFlat;
      return {
        ...prev,
        config: {
          ...rest,
          available_methods: merged.available_methods,
          required_methods: merged.required_methods,
          locks_on_statuses: merged.locks_on_statuses,
          unlocks_on_statuses: merged.unlocks_on_statuses,
          cooldown_seconds: merged.cooldown_seconds,
          ttl_seconds: merged.ttl_seconds,
          guards: merged.guards,
          policy: merged.policy,
          rate_limit: merged.rate_limit,
        },
      };
    });
  };

  const toggleMethod = (method: VerificationMethod) => {
    const next = cfg.available_methods.includes(method)
      ? cfg.available_methods.filter((m) => m !== method)
      : [...cfg.available_methods, method];
    const clampedRequired =
      next.length === 0 ? 0 : Math.max(1, Math.min(cfg.required_methods, next.length));
    patch({ available_methods: next, required_methods: clampedRequired });
  };

  const toggleGuard = (colName: string) => {
    const next = cfg.guards.includes(colName)
      ? cfg.guards.filter((g) => g !== colName)
      : [...cfg.guards, colName];
    patch({ guards: next });
  };

  const toggleStatus = (key: 'locks_on_statuses' | 'unlocks_on_statuses', value: string) => {
    const current = cfg[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    patch({ [key]: next } as Partial<VerificationColumnConfig>);
  };

  const rateLimitEnabled = !!cfg.rate_limit;

  const availableCount = cfg.available_methods.length;
  const requiredInvalid =
    cfg.required_methods < 1 ||
    (availableCount > 0 && cfg.required_methods > availableCount);

  const guardCandidates = allColumns.filter((c) => c.id !== draft.id);

  // Auto-detect: pull options from select-type guard columns (ADR-0011 §C-25)
  const statusOptions = useMemo(() => {
    const byValue = new Map<string, { value: string; label: string; color?: string; source: string }>();
    for (const col of guardCandidates) {
      if (col.type !== 'select') continue;
      if (!cfg.guards.includes(col.name)) continue;
      const rawOpts =
        (col.config?.options as ColumnOption[] | undefined) ??
        ((col.config?.select as { options?: ColumnOption[] } | undefined)?.options ?? []);
      for (const opt of rawOpts) {
        if (!opt?.value) continue;
        if (byValue.has(opt.value)) continue;
        byValue.set(opt.value, {
          value: opt.value,
          label: opt.label || opt.value,
          color: opt.color,
          source: col.displayName || col.name,
        });
      }
    }
    return Array.from(byValue.values());
  }, [guardCandidates, cfg.guards]);

  const hasSelectGuards = statusOptions.length > 0;

  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🛡️ Настройки верификации
      </h4>

      {/* Available methods */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Доступные методы
        </div>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((method) => {
            const checked = cfg.available_methods.includes(method);
            return (
              <label
                key={method}
                className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
                  checked
                    ? 'border-[var(--color-primary-500)] bg-primary-50'
                    : 'border-[var(--border-primary)] bg-[var(--bg-primary)]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleMethod(method)}
                  className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)]"
                />
                <span className="text-sm text-[var(--text-primary)]">
                  {METHOD_LABELS[method]}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Required methods + Policy */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm text-[var(--text-secondary)]">
            Требуется методов (N из {availableCount || 0})
          </label>
          <input
            type="number"
            min={1}
            max={Math.max(availableCount, 1)}
            value={cfg.required_methods}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              if (Number.isNaN(raw)) return;
              const clamped =
                availableCount === 0
                  ? 0
                  : Math.max(1, Math.min(raw, availableCount));
              patch({ required_methods: clamped });
            }}
            className={`w-full px-3 py-2 text-sm rounded-lg border bg-[var(--bg-primary)] ${
              requiredInvalid
                ? 'border-red-500 focus:ring-red-500'
                : 'border-[var(--border-primary)] focus:ring-[var(--color-primary-500)]'
            } focus:ring-2 focus:border-transparent`}
          />
          {requiredInvalid && (
            <p className="text-xs text-red-500">
              ADR §C-25: required_methods должен быть от 1 до{' '}
              {availableCount || 1}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm text-[var(--text-secondary)]">Политика</label>
          <div className="flex gap-3 pt-2">
            {(['all', 'any_n'] as const).map((p) => (
              <label key={p} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="verification-policy"
                  checked={cfg.policy === p}
                  onChange={() => patch({ policy: p })}
                  className="text-[var(--color-primary-500)]"
                />
                <span className="text-sm text-[var(--text-primary)]">
                  {p === 'all' ? 'all' : 'any_n'}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Guards (columns) — FIRST: pick a column, then its statuses */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Защищаемые колонки
        </div>
        {guardCandidates.length > 0 ? (
          <div className="max-h-40 overflow-y-auto border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)] divide-y divide-[var(--border-color)]">
            {guardCandidates.map((col) => {
              const checked = cfg.guards.includes(col.name);
              const isSelect = col.type === 'select';
              return (
                <label
                  key={col.id}
                  className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-[var(--bg-tertiary)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleGuard(col.name)}
                    className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)]"
                  />
                  <span className="text-sm text-[var(--text-primary)]">
                    {col.displayName || col.name}
                  </span>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    ({col.type})
                  </span>
                  {isSelect && checked && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary-50 text-[var(--color-primary-500)] uppercase tracking-wider">
                      статусы
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        ) : (
          <TagInput
            label=""
            values={cfg.guards}
            onChange={(next) => patch({ guards: next })}
            placeholder="имя колонки…"
          />
        )}
      </div>

      {/* Lock / Unlock statuses — auto-detected from select-type guards */}
      <div className="space-y-3">
        <div className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
          Статусы
        </div>

        {hasSelectGuards ? (
          <>
            <StatusMultiSelect
              label="Блокирует на статусах"
              options={statusOptions}
              selected={cfg.locks_on_statuses}
              onToggle={(v) => toggleStatus('locks_on_statuses', v)}
            />
            <StatusMultiSelect
              label="Разблокирует на статусах"
              options={statusOptions}
              selected={cfg.unlocks_on_statuses}
              onToggle={(v) => toggleStatus('unlocks_on_statuses', v)}
            />
          </>
        ) : (
          <>
            <p className="text-xs text-[var(--text-tertiary)] italic">
              Отметьте колонку типа <code>select</code> выше — её статусы появятся здесь автоматически.
            </p>
            <TagInput
              label="Блокирует на статусах"
              values={cfg.locks_on_statuses}
              onChange={(next) => patch({ locks_on_statuses: next })}
              placeholder="например: published"
            />
            <TagInput
              label="Разблокирует на статусах"
              values={cfg.unlocks_on_statuses}
              onChange={(next) => patch({ unlocks_on_statuses: next })}
              placeholder="например: draft"
            />
          </>
        )}
      </div>

      {/* Cooldown + TTL */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm text-[var(--text-secondary)]">
            Cooldown (сек)
          </label>
          <input
            type="number"
            min={0}
            value={cfg.cooldown_seconds}
            onChange={(e) => {
              const raw = parseInt(e.target.value, 10);
              patch({ cooldown_seconds: Number.isNaN(raw) ? 0 : Math.max(0, raw) });
            }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
            placeholder="300"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-[var(--text-secondary)]">TTL (сек)</label>
          <div className="space-y-1">
            <input
              type="number"
              min={0}
              value={cfg.ttl_seconds ?? ''}
              disabled={cfg.ttl_seconds === null}
              onChange={(e) => {
                const raw = parseInt(e.target.value, 10);
                patch({ ttl_seconds: Number.isNaN(raw) ? 0 : Math.max(0, raw) });
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] disabled:opacity-50 focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
              placeholder="Без истечения"
            />
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.ttl_seconds === null}
                onChange={(e) =>
                  patch({ ttl_seconds: e.target.checked ? null : 3600 })
                }
                className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)]"
              />
              <span className="text-xs text-[var(--text-secondary)]">
                Без истечения
              </span>
            </label>
          </div>
        </div>
      </div>

      {/* Rate limit (optional) */}
      <div className="space-y-2 p-3 rounded-lg bg-[var(--bg-tertiary)] border border-dashed border-[var(--border-color)]">
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm font-medium text-[var(--text-primary)]">
            ⏱️ Rate limit
          </span>
          <input
            type="checkbox"
            checked={rateLimitEnabled}
            onChange={(e) =>
              patch({
                rate_limit: e.target.checked
                  ? { window_seconds: 60, max_attempts: 5 }
                  : undefined,
              })
            }
            className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)]"
          />
        </label>

        {rateLimitEnabled && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-secondary)]">
                Окно (сек)
              </label>
              <input
                type="number"
                min={1}
                value={cfg.rate_limit?.window_seconds ?? 60}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10);
                  patch({
                    rate_limit: {
                      window_seconds: Number.isNaN(raw) ? 1 : Math.max(1, raw),
                      max_attempts: cfg.rate_limit?.max_attempts ?? 5,
                    },
                  });
                }}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--text-secondary)]">
                Макс. попыток
              </label>
              <input
                type="number"
                min={1}
                value={cfg.rate_limit?.max_attempts ?? 5}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10);
                  patch({
                    rate_limit: {
                      window_seconds: cfg.rate_limit?.window_seconds ?? 60,
                      max_attempts: Number.isNaN(raw) ? 1 : Math.max(1, raw),
                    },
                  });
                }}
                className="w-full px-2 py-1.5 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// NotificationMatrix.tsx — ADR-0064 WP-C.
//
// Shared form used by Personal, Per-chat, Space-default, and Global-default
// notification preference editors. Layers share the same JSON shape (see
// resolveChatPrefs.js §CHAT_PREFS_DEFAULTS), so the form is rendered once
// and re-used.

import React from 'react';
import { cn } from '@/shared/utils/cn';
import {
  playNotificationSound,
  resetDebounce,
} from '@/shared/services/notificationSoundService';

export interface PrefsValue {
  enabled?: boolean | null;
  sound_enabled?: boolean | null;
  sound_volume?: number | null;
  humans?: { sound?: boolean | null; popup?: boolean | null; badge?: boolean | null } | null;
  agents?: { sound?: boolean | null; popup?: boolean | null; badge?: boolean | null } | null;
}

interface Props {
  value: PrefsValue;
  onChange: (next: PrefsValue) => void;
  /** When true (declared-key layer mode), each toggle renders a tri-state
   *  (Inherit / On / Off). When false (Personal — full defaults), toggles
   *  are binary. */
  triState?: boolean;
  /** Show the "Test sound" buttons next to each sound toggle. */
  showTestButtons?: boolean;
  disabled?: boolean;
}

type ToggleVal = true | false | null;

function ToggleCell({
  val,
  onChange,
  triState,
  disabled,
}: {
  val: ToggleVal;
  onChange: (next: ToggleVal) => void;
  triState: boolean;
  disabled?: boolean;
}) {
  if (!triState) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(val === true ? false : true)}
        className={cn(
          'w-10 h-5 rounded-full relative transition-colors',
          val
            ? 'bg-[var(--color-primary-500)]'
            : 'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]',
          disabled && 'opacity-50',
        )}
        aria-pressed={val === true}
      >
        <span
          className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
            val ? 'right-0.5' : 'left-0.5',
          )}
        />
      </button>
    );
  }
  const next: Record<string, ToggleVal> = { on: true, off: false, inherit: null };
  const current = val === true ? 'on' : val === false ? 'off' : 'inherit';
  return (
    <div className="inline-flex rounded-md border border-[var(--border-primary)] overflow-hidden text-[10px]">
      {(['inherit', 'on', 'off'] as const).map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          onClick={() => onChange(next[k])}
          className={cn(
            'px-2 py-0.5',
            current === k
              ? 'bg-[var(--color-primary-500)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
            disabled && 'opacity-50',
          )}
        >
          {k === 'inherit' ? '↑' : k === 'on' ? 'on' : 'off'}
        </button>
      ))}
    </div>
  );
}

function getBlock(
  v: PrefsValue,
  block: 'humans' | 'agents',
): { sound: ToggleVal; popup: ToggleVal; badge: ToggleVal } {
  const b = v[block] ?? {};
  return {
    sound: (b.sound ?? null) as ToggleVal,
    popup: (b.popup ?? null) as ToggleVal,
    badge: (b.badge ?? null) as ToggleVal,
  };
}

function setBlock(
  v: PrefsValue,
  block: 'humans' | 'agents',
  key: 'sound' | 'popup' | 'badge',
  next: ToggleVal,
): PrefsValue {
  const current = v[block] ?? {};
  const updated = { ...current, [key]: next };
  return { ...v, [block]: updated };
}

export function NotificationMatrix({
  value,
  onChange,
  triState = false,
  showTestButtons = false,
  disabled = false,
}: Props) {
  const enabled = (value.enabled ?? null) as ToggleVal;
  const soundEnabled = (value.sound_enabled ?? null) as ToggleVal;
  const volume = typeof value.sound_volume === 'number' ? value.sound_volume : 0.6;
  const humans = getBlock(value, 'humans');
  const agents = getBlock(value, 'agents');

  const onTestSound = (kind: 'human' | 'agent') => {
    resetDebounce();
    playNotificationSound(kind, {
      senderSlug: `test:${kind}`,
      volume,
      force: true,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-tertiary)]">
        <div>
          <div className="text-xs text-[var(--text-primary)]">Уведомления включены</div>
          <div className="text-[10px] text-[var(--text-tertiary)]">Master switch для этого слоя</div>
        </div>
        <ToggleCell val={enabled} onChange={(v) => onChange({ ...value, enabled: v })} triState={triState} disabled={disabled} />
      </div>

      <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-tertiary)]">
        <div>
          <div className="text-xs text-[var(--text-primary)]">Звук</div>
          <div className="text-[10px] text-[var(--text-tertiary)]">Глобальный sound master</div>
        </div>
        <ToggleCell val={soundEnabled} onChange={(v) => onChange({ ...value, sound_enabled: v })} triState={triState} disabled={disabled} />
      </div>

      <div className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
        <div className="flex items-center justify-between mb-1">
          <div className="text-xs text-[var(--text-primary)]">Громкость</div>
          <div className="text-[10px] text-[var(--text-tertiary)]">{Math.round(volume * 100)}%</div>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, sound_volume: parseFloat(e.target.value) })}
          className="w-full accent-[var(--color-primary-500)]"
        />
      </div>

      {(['humans', 'agents'] as const).map((block) => {
        const cells = block === 'humans' ? humans : agents;
        const label = block === 'humans' ? 'Люди' : 'AI агенты';
        return (
          <div key={block} className="p-2 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-[var(--text-primary)]">{label}</div>
              {showTestButtons && (
                <button
                  type="button"
                  onClick={() => onTestSound(block === 'humans' ? 'human' : 'agent')}
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--color-primary-500)]/10"
                >
                  ▶ Test
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['sound', 'popup', 'badge'] as const).map((k) => (
                <div key={k} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{k}</span>
                  <ToggleCell
                    val={cells[k]}
                    onChange={(v) => onChange(setBlock(value, block, k, v))}
                    triState={triState}
                    disabled={disabled}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

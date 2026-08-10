/**
 * ContextSettingsSection Component
 * ADR-110 Phase 1: Context Settings UI (AC11-AC12)
 *
 * Three collapsible sections added to the AI Settings tab:
 * 1. Context Depth — checkbox levels controlling what context is sent
 * 2. Auto-Summary — automatic conversation summarization settings
 * 3. Vector Memory — vector search settings (top-K, similarity threshold)
 *
 * All values are stored in the agent's context_settings JSON column.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  FileText,
  Search,
  ChevronDown,
  Loader2,
  Save,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type {
  ContextSettings,
  ContextLevels,
  AutoSummarySettings,
  VectorSearchSettings,
} from '../../types';
import { DEFAULT_CONTEXT_SETTINGS } from '../../types';

// ─── Helper to parse context_settings that may arrive as a JSON string ──
function parseContextSettings(raw: ContextSettings | string | undefined | null): ContextSettings {
  if (!raw) return { ...DEFAULT_CONTEXT_SETTINGS };
  if (typeof raw === 'string') {
    try {
      return { ...DEFAULT_CONTEXT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CONTEXT_SETTINGS };
    }
  }
  return { ...DEFAULT_CONTEXT_SETTINGS, ...raw };
}

// ─── Props ────────────────────────────────────────────────────────────
export interface ContextSettingsSectionProps {
  /** Raw context_settings from the agent (may be JSON string or object) */
  contextSettings: ContextSettings | string | undefined | null;
  /** Called when user changes any context setting */
  onChange: (settings: ContextSettings) => void;
  /** Called when user clicks Save */
  onSave: (settings: ContextSettings) => void;
  /** Whether save is in progress */
  isSaving: boolean;
  /** Whether editing is allowed (admin/owner only) */
  disabled?: boolean;
}

// ─── Section collapse toggle ──────────────────────────────────────────
interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  icon,
  title,
  subtitle,
  expanded,
  onToggle,
  badge,
}) => (
  <button
    type="button"
    onClick={onToggle}
    className="w-full flex items-center gap-2 py-2 text-left group"
  >
    <div className="w-5 h-5 flex items-center justify-center text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-colors">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
          {title}
        </span>
        {badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
            {badge}
          </span>
        )}
      </div>
      {subtitle && (
        <span className="text-[10px] text-[var(--text-tertiary)]">{subtitle}</span>
      )}
    </div>
    <ChevronDown
      className={cn(
        'w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform',
        expanded && 'rotate-180'
      )}
    />
  </button>
);

// ─── Checkbox row ─────────────────────────────────────────────────────
interface CheckboxRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}

const CheckboxRow: React.FC<CheckboxRowProps> = ({
  checked,
  onChange,
  label,
  hint,
  disabled,
}) => (
  <label
    className={cn(
      'flex items-start gap-2 py-1 cursor-pointer',
      disabled && 'opacity-50 cursor-not-allowed'
    )}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="mt-0.5 w-3.5 h-3.5 rounded border-[var(--border-primary)] text-purple-500 focus:ring-purple-500/30"
    />
    <div className="min-w-0">
      <span className="text-xs text-[var(--text-primary)]">{label}</span>
      {hint && (
        <span className="block text-[10px] text-[var(--text-tertiary)]">{hint}</span>
      )}
    </div>
  </label>
);

// ─── Number input ─────────────────────────────────────────────────────
interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

const NumberInput: React.FC<NumberInputProps> = ({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  disabled,
}) => (
  <div className="flex items-center gap-2">
    <label className="text-[10px] text-[var(--text-tertiary)] whitespace-nowrap">{label}</label>
    <input
      type="number"
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isNaN(n)) onChange(Math.max(min, Math.min(max, n)));
      }}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className="w-16 px-2 py-1 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-purple-500/30 disabled:opacity-50"
    />
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────
export const ContextSettingsSection: React.FC<ContextSettingsSectionProps> = ({
  contextSettings: rawSettings,
  onChange,
  onSave,
  isSaving,
  disabled = false,
}) => {
  // Parse the raw value into a typed object
  const [settings, setSettings] = useState<ContextSettings>(() =>
    parseContextSettings(rawSettings)
  );

  // Track whether settings have diverged from the persisted value
  const [isDirty, setIsDirty] = useState(false);

  // Section collapse state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    context_depth: false,
    auto_summary: false,
    vector_search: false,
  });

  // Re-sync when the agent's persisted settings change (e.g. agent switch)
  useEffect(() => {
    const parsed = parseContextSettings(rawSettings);
    setSettings(parsed);
    setIsDirty(false);
  }, [rawSettings]);

  const toggleSection = useCallback((key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ─── Updaters ─────────────────────────────────────────────────────
  const updateContextLevels = useCallback(
    (patch: Partial<ContextLevels>) => {
      setSettings((prev) => {
        const next: ContextSettings = {
          ...prev,
          context_levels: { ...(prev.context_levels ?? DEFAULT_CONTEXT_SETTINGS.context_levels!), ...patch },
        };
        onChange(next);
        return next;
      });
      setIsDirty(true);
    },
    [onChange]
  );

  const updateAutoSummary = useCallback(
    (patch: Partial<AutoSummarySettings>) => {
      setSettings((prev) => {
        const next: ContextSettings = {
          ...prev,
          auto_summary: { ...(prev.auto_summary ?? DEFAULT_CONTEXT_SETTINGS.auto_summary!), ...patch },
        };
        onChange(next);
        return next;
      });
      setIsDirty(true);
    },
    [onChange]
  );

  const updateVectorSearch = useCallback(
    (patch: Partial<VectorSearchSettings>) => {
      setSettings((prev) => {
        const next: ContextSettings = {
          ...prev,
          vector_search: { ...(prev.vector_search ?? DEFAULT_CONTEXT_SETTINGS.vector_search!), ...patch },
        };
        onChange(next);
        return next;
      });
      setIsDirty(true);
    },
    [onChange]
  );

  const handleSave = useCallback(() => {
    onSave(settings);
    setIsDirty(false);
  }, [onSave, settings]);

  // Resolved sub-objects with defaults
  const levels = settings.context_levels ?? DEFAULT_CONTEXT_SETTINGS.context_levels!;
  const summary = settings.auto_summary ?? DEFAULT_CONTEXT_SETTINGS.auto_summary!;
  const vector = settings.vector_search ?? DEFAULT_CONTEXT_SETTINGS.vector_search!;

  return (
    <div className="space-y-1">
      {/* ─── Section: Context Depth ─────────────────────────────────── */}
      <div className="border-t border-[var(--border-secondary)] pt-2">
        <SectionHeader
          icon={<Layers className="w-3.5 h-3.5" />}
          title="Context Depth"
          subtitle="What gets included in the conversation window"
          expanded={expandedSections.context_depth}
          onToggle={() => toggleSection('context_depth')}
        />
        {expandedSections.context_depth && (
          <div className="pl-7 pb-2 space-y-1">
            <CheckboxRow
              checked={true}
              onChange={() => {}}
              label="Messages only (Level 1)"
              hint="~baseline tokens"
              disabled={true}
            />
            <CheckboxRow
              checked={levels.thinking}
              onChange={(v) => updateContextLevels({ thinking: v })}
              label="+ Reasoning chains (Level 2)"
              hint="~+20% tokens"
              disabled={disabled}
            />
            {levels.thinking && (
              <div className="pl-5 pb-1">
                <NumberInput
                  label="Preview chars:"
                  value={levels.thinking_preview_chars}
                  onChange={(v) => updateContextLevels({ thinking_preview_chars: v })}
                  min={0}
                  max={5000}
                  step={50}
                  disabled={disabled}
                />
              </div>
            )}
            <CheckboxRow
              checked={levels.tool_summaries}
              onChange={(v) => updateContextLevels({ tool_summaries: v })}
              label="+ Tool summaries (Level 3)"
              hint="~+30% tokens"
              disabled={disabled}
            />
            {levels.tool_summaries && (
              <div className="pl-5 pb-1">
                <NumberInput
                  label="Preview chars:"
                  value={levels.tool_preview_chars}
                  onChange={(v) => updateContextLevels({ tool_preview_chars: v })}
                  min={0}
                  max={5000}
                  step={50}
                  disabled={disabled}
                />
              </div>
            )}
            <CheckboxRow
              checked={levels.full_tool_results}
              onChange={(v) => updateContextLevels({ full_tool_results: v })}
              label="+ Full tool results (Level 4)"
              hint="~+200% tokens — use with caution"
              disabled={disabled}
            />
          </div>
        )}
      </div>

      {/* ─── Section: Auto-Summary ──────────────────────────────────── */}
      <div className="border-t border-[var(--border-secondary)] pt-2">
        <SectionHeader
          icon={<FileText className="w-3.5 h-3.5" />}
          title="Auto-Summary"
          subtitle="Compress old messages into summaries"
          expanded={expandedSections.auto_summary}
          onToggle={() => toggleSection('auto_summary')}
        />
        {expandedSections.auto_summary && (
          <div className="pl-7 pb-2 space-y-1">
            <CheckboxRow
              checked={summary.enabled}
              onChange={(v) => updateAutoSummary({ enabled: v })}
              label="Enable auto-summary"
              disabled={disabled}
            />
            {summary.enabled && (
              <div className="space-y-2 pt-1">
                <NumberInput
                  label="Chunk size:"
                  value={summary.chunk_size}
                  onChange={(v) => updateAutoSummary({ chunk_size: v })}
                  min={3}
                  max={100}
                  disabled={disabled}
                />
                <NumberInput
                  label="Keep recent:"
                  value={summary.keep_recent}
                  onChange={(v) => updateAutoSummary({ keep_recent: v })}
                  min={1}
                  max={50}
                  disabled={disabled}
                />
                <CheckboxRow
                  checked={summary.inject_in_system}
                  onChange={(v) => updateAutoSummary({ inject_in_system: v })}
                  label="Inject summaries into system prompt"
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Section: Vector Memory ─────────────────────────────────── */}
      <div className="border-t border-[var(--border-secondary)] pt-2">
        <SectionHeader
          icon={<Search className="w-3.5 h-3.5" />}
          title="Vector Memory"
          expanded={expandedSections.vector_search}
          onToggle={() => toggleSection('vector_search')}
        />
        {expandedSections.vector_search && (
          <div className="pl-7 pb-2 space-y-1">
            <CheckboxRow
              checked={vector.enabled}
              onChange={(v) => updateVectorSearch({ enabled: v })}
              label="Enable vector search"
              hint="Semantic retrieval from past conversations"
              disabled={disabled}
            />
            {vector.enabled && (
              <div className="space-y-2 pt-1">
                <NumberInput
                  label="Top-K results:"
                  value={vector.top_k}
                  onChange={(v) => updateVectorSearch({ top_k: v })}
                  min={1}
                  max={20}
                  disabled={disabled}
                />
                <NumberInput
                  label="Similarity threshold:"
                  value={vector.similarity_threshold}
                  onChange={(v) => updateVectorSearch({ similarity_threshold: v })}
                  min={0}
                  max={1}
                  step={0.05}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── Save button ────────────────────────────────────────────── */}
      {isDirty && !disabled && (
        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 transition-colors"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save Context Settings
          </button>
        </div>
      )}
    </div>
  );
};

ContextSettingsSection.displayName = 'ContextSettingsSection';

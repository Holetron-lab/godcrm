/**
 * ADR-0017 Phase 3-4 — JSON cell editor.
 *
 * Modes (driven by `config.defaultMode`, default `code`):
 *  - code: Monaco editor with JSON syntax + folding.
 *  - tree: collapsible editable tree (inline edit / add / delete / rename).
 *  - form: recursive form for object/array (nested objects collapsible).
 *
 * Renders as a centered full-overlay modal (mirroring FilePreviewModal),
 * not anchored to the originating cell.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Editor from '@monaco-editor/react';
import type { JsonColumnConfig } from '../../types/table.types';
import {
  DEFAULT_MODE,
  MODE_LABELS,
  deleteAt,
  detectType,
  renameKey,
  seedInitial,
  setAt,
  tryParse,
  type Mode,
  type MutateAPI,
} from './JsonEditor.helpers';
import { FormNode, TreeNode } from './JsonEditor.parts';

interface JsonEditorProps {
  value: string;
  config?: JsonColumnConfig;
  onChange: (value: string) => void;
  onCommit: (valueOverride?: string) => void;
  onCancel: () => void;
}

export const JsonEditor = ({ value, config, onChange, onCommit, onCancel }: JsonEditorProps) => {
  const initial = useMemo(() => seedInitial(value, config), [value, config]);
  const [draft, setDraft] = useState<string>(initial);
  const initialMode: Mode = (config?.defaultMode as Mode) ?? DEFAULT_MODE;
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    onChange(initial);
  }, []);

  const parsed = useMemo(() => tryParse(draft), [draft]);
  const parseError = parsed.ok ? null : parsed.error ?? null;

  const updateDraft = useCallback(
    (next: string) => {
      setDraft(next);
      onChange(next);
    },
    [onChange],
  );

  const writeRoot = useCallback(
    (newRoot: unknown) => {
      if (newRoot === undefined) updateDraft('');
      else updateDraft(JSON.stringify(newRoot, null, 2));
    },
    [updateDraft],
  );

  const mutateAPI: MutateAPI = useMemo(
    () => ({
      setAt: (path, val) => writeRoot(setAt(parsed.data, path, val)),
      deleteAt: (path) => writeRoot(deleteAt(parsed.data, path)),
      renameKey: (parentPath, oldKey, newKey) =>
        writeRoot(renameKey(parsed.data, parentPath, oldKey, newKey)),
    }),
    [parsed.data, writeRoot],
  );

  const handleSave = useCallback(() => {
    if (parseError) return;
    if (!draft.trim()) {
      onCommit('');
      return;
    }
    try {
      const obj = JSON.parse(draft);
      const pretty = config?.prettyInCell ?? true;
      const out = JSON.stringify(obj, null, pretty ? 2 : 0);
      onCommit(out);
    } catch {
      // parseError gate above should have caught this
    }
  }, [draft, parseError, config?.prettyInCell, onCommit]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, handleSave]);

  const handleFormatPretty = () => {
    if (parseError) return;
    if (!draft.trim()) return;
    try {
      const obj = JSON.parse(draft);
      updateDraft(JSON.stringify(obj, null, 2));
    } catch {
      /* ignore */
    }
  };

  const renderCodeMode = () => (
    <div className="h-full border border-[var(--border-secondary)] rounded overflow-hidden">
      <Editor
        height="100%"
        defaultLanguage="json"
        value={draft}
        onChange={(v) => updateDraft(v ?? '')}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'on',
          folding: true,
          lineDecorationsWidth: 8,
          lineNumbersMinChars: 3,
        }}
      />
    </div>
  );

  const renderEmpty = () => (
    <div className="p-6 flex flex-col items-center gap-3">
      <div className="text-sm text-[var(--text-tertiary)]">Пусто. Создать:</div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => writeRoot({})}
          className="px-3 py-1.5 text-xs rounded border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          Объект {'{ }'}
        </button>
        <button
          type="button"
          onClick={() => writeRoot([])}
          className="px-3 py-1.5 text-xs rounded border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          Массив [ ]
        </button>
      </div>
    </div>
  );

  const renderTreeMode = () => {
    if (parseError) {
      return (
        <div className="p-4 text-xs text-red-500 bg-red-500/5 rounded border border-red-500/30">
          ⚠️ JSON невалиден — переключитесь в режим Код, чтобы исправить.
        </div>
      );
    }
    if (parsed.data === undefined) return renderEmpty();
    return (
      <div className="h-full border border-[var(--border-secondary)] rounded p-2 overflow-auto bg-[var(--bg-secondary)]">
        <TreeNode
          value={parsed.data}
          keyName="root"
          path={[]}
          parentIsArray={false}
          depth={0}
          isRoot
          mutate={mutateAPI}
        />
      </div>
    );
  };

  const renderFormMode = () => {
    if (parseError) {
      return (
        <div className="p-4 text-xs text-red-500 bg-red-500/5 rounded border border-red-500/30">
          ⚠️ JSON невалиден — переключитесь в режим Код.
        </div>
      );
    }
    if (parsed.data === undefined) return renderEmpty();
    const t = detectType(parsed.data);
    if (t !== 'object' && t !== 'array') {
      return (
        <div className="p-4 text-xs text-[var(--text-tertiary)]">
          Корень — примитив ({t}). Используйте Код для редактирования.
        </div>
      );
    }
    return (
      <div className="h-full border border-[var(--border-secondary)] rounded overflow-auto bg-[var(--bg-secondary)]">
        <FormNode value={parsed.data} path={[]} depth={0} isRoot mutate={mutateAPI} />
      </div>
    );
  };

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal — full screen on mobile, centered on desktop */}
      <div
        className="relative bg-[var(--bg-primary)] text-[var(--text-primary)] w-[100vw] h-[100vh] sm:w-[90vw] sm:max-w-3xl sm:h-[80vh] sm:rounded-lg shadow-2xl border border-[var(--border-primary)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — title + tabs + format */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          <span className="text-sm font-medium text-[var(--text-primary)] mr-2">
            Редактирование JSON
          </span>
          <div className="flex items-center">
            {(['code', 'tree', 'form'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors rounded ${
                  mode === m
                    ? 'text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleFormatPretty}
            disabled={Boolean(parseError) || !draft.trim()}
            className="px-2 py-1 text-[10px] rounded border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 disabled:cursor-not-allowed"
            title="Pretty-print (2 spaces)"
          >
            Форматировать
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onCancel}
            className="ml-1 rounded-full p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 p-3 overflow-hidden">
          {mode === 'code' && renderCodeMode()}
          {mode === 'tree' && renderTreeMode()}
          {mode === 'form' && renderFormMode()}
        </div>

        {/* Footer — status + actions */}
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          <div className="text-[11px] flex-1 min-w-0">
            {parseError ? (
              <span className="text-red-500 truncate block" title={parseError}>
                ⚠️ {parseError}
              </span>
            ) : (
              <span className="text-[var(--text-tertiary)]">
                ⌘/Ctrl+Enter — сохранить · Esc — отмена
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={Boolean(parseError)}
            className="px-3 py-1.5 text-xs rounded bg-[var(--color-primary-500)] text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

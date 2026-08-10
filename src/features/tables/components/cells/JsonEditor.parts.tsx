/**
 * Sub-components for JsonEditor (ADR-0017 Phase 3-4):
 *   - PrimitiveEditor: inline edit for string/number/boolean/null
 *   - AdderRow:        type+name picker for new keys/items
 *   - TreeNode:        recursive collapsible editable tree
 *   - FormNode:        recursive form for object/array containers
 *   - FormFieldRow:    one key→value row inside FormNode
 */

import { useState } from 'react';
import {
  detectType,
  nextUniqueKey,
  TYPE_DEFAULTS,
  type MutateAPI,
  type Path,
  type ValueType,
} from './JsonEditor.helpers';

// === PrimitiveEditor — inline edit a primitive value ===

interface PrimitiveEditorProps {
  value: string | number | boolean | null;
  path: Path;
  mutate: MutateAPI;
}

export const PrimitiveEditor = ({ value, path, mutate }: PrimitiveEditorProps) => {
  if (typeof value === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => mutate.setAt(path, e.target.checked)}
        className="accent-[var(--color-primary-500)]"
      />
    );
  }
  if (value === null) {
    return (
      <button
        type="button"
        onClick={() => mutate.setAt(path, '')}
        title="null — клик для конвертации в строку"
        className="text-[10px] italic text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] px-1.5 py-0.5 border border-dashed border-[var(--border-secondary)] rounded"
      >
        null
      </button>
    );
  }
  if (typeof value === 'number') {
    return (
      <input
        key={`num-${path.join('.')}`}
        type="number"
        defaultValue={String(value)}
        onChange={(e) => {
          const t = e.target.value;
          if (t === '' || t === '-' || t.endsWith('.')) return;
          const n = Number(t);
          if (Number.isFinite(n)) mutate.setAt(path, n);
        }}
        onBlur={(e) => {
          const t = e.target.value;
          const n = t === '' ? 0 : Number(t);
          mutate.setAt(path, Number.isFinite(n) ? n : 0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="px-1.5 py-0.5 text-xs font-mono rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] focus:outline-none focus:border-[var(--color-primary-500)] w-28"
      />
    );
  }
  return (
    <input
      type="text"
      value={String(value)}
      onChange={(e) => mutate.setAt(path, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="flex-1 min-w-0 px-1.5 py-0.5 text-xs font-mono rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] focus:outline-none focus:border-[var(--color-primary-500)]"
    />
  );
};

// === AdderRow — pick type and key for new entries ===

interface AdderRowProps {
  isArray: boolean;
  existingKeys: string[];
  onAdd: (typ: ValueType, key?: string) => void;
  onCancel: () => void;
  indent: number;
}

export const AdderRow = ({
  isArray,
  existingKeys,
  onAdd,
  onCancel,
  indent,
}: AdderRowProps) => {
  const [name, setName] = useState('');
  const [typ, setTyp] = useState<ValueType>('string');
  const nameError =
    !isArray && name && existingKeys.includes(name) ? 'ключ уже есть' : null;
  return (
    <div
      style={{ paddingLeft: `${indent * 14}px` }}
      className="flex items-center gap-1 py-1 bg-[var(--bg-tertiary)]/40"
    >
      {!isArray && (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ключ (auto)"
          className="px-1 py-0.5 text-xs font-mono rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:outline-none"
          style={{ width: '12ch' }}
        />
      )}
      <select
        value={typ}
        onChange={(e) => setTyp(e.target.value as ValueType)}
        className="px-1 py-0.5 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]"
      >
        <option value="string">string</option>
        <option value="number">number</option>
        <option value="boolean">boolean</option>
        <option value="null">null</option>
        <option value="object">object</option>
        <option value="array">array</option>
      </select>
      <button
        type="button"
        disabled={Boolean(nameError)}
        onClick={() => onAdd(typ, name || undefined)}
        className="px-2 py-0.5 text-xs rounded bg-[var(--color-primary-500)] text-white disabled:opacity-40"
      >
        Добавить
      </button>
      <button
        type="button"
        onClick={onCancel}
        title="Отменить"
        className="text-[11px] text-[var(--text-tertiary)] px-1 hover:text-red-500"
      >
        ×
      </button>
      {nameError && <span className="text-[10px] text-red-500">{nameError}</span>}
    </div>
  );
};

// === TreeNode — recursive collapsible editable tree ===

interface TreeNodeProps {
  value: unknown;
  keyName: string;
  path: Path;
  parentIsArray: boolean;
  depth: number;
  isRoot?: boolean;
  mutate: MutateAPI;
}

export const TreeNode = ({
  value,
  keyName,
  path,
  parentIsArray,
  depth,
  isRoot,
  mutate,
}: TreeNodeProps) => {
  const [open, setOpen] = useState<boolean>(Boolean(isRoot) || depth < 2);
  const [adderOpen, setAdderOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const indent = { paddingLeft: `${depth * 14}px` };
  const t = detectType(value);
  const isContainer = t === 'object' || t === 'array';

  const renderKeyLabel = () => {
    if (isRoot) {
      return <span className="text-[var(--text-tertiary)] font-mono mr-1">root:</span>;
    }
    if (parentIsArray) {
      return (
        <span className="text-[var(--text-tertiary)] font-mono mr-1">[{keyName}]</span>
      );
    }
    if (renaming) {
      return (
        <input
          autoFocus
          defaultValue={keyName}
          onBlur={(e) => {
            setRenaming(false);
            const v = e.target.value.trim();
            if (v && v !== keyName) mutate.renameKey(path.slice(0, -1), keyName, v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setRenaming(false);
            }
          }}
          className="px-1 py-0 text-xs font-mono rounded border border-[var(--color-primary-500)] bg-[var(--bg-primary)] mr-1 focus:outline-none"
          style={{ width: `${Math.max(keyName.length, 6)}ch` }}
        />
      );
    }
    return (
      <button
        type="button"
        onDoubleClick={() => setRenaming(true)}
        title="Double-click для переименования"
        className="text-[var(--text-secondary)] font-mono mr-1 hover:underline"
      >
        {keyName}:
      </button>
    );
  };

  const renderDeleteBtn = () =>
    isRoot ? null : (
      <button
        type="button"
        onClick={() => mutate.deleteAt(path)}
        title="Удалить"
        className="text-[10px] text-[var(--text-tertiary)] hover:text-red-500 px-1 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    );

  if (!isContainer) {
    return (
      <div style={indent} className="flex items-center gap-1 py-0.5">
        {renderKeyLabel()}
        <PrimitiveEditor
          value={value as string | number | boolean | null}
          path={path}
          mutate={mutate}
        />
        {renderDeleteBtn()}
      </div>
    );
  }

  const isArray = t === 'array';
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  const handleAdd = (typ: ValueType, newKeyName?: string) => {
    setAdderOpen(false);
    if (isArray) {
      mutate.setAt([...path, (value as unknown[]).length], TYPE_DEFAULTS[typ]);
    } else {
      const obj = value as Record<string, unknown>;
      const k = newKeyName?.trim() || nextUniqueKey(obj);
      if (k in obj) return;
      mutate.setAt([...path, k], TYPE_DEFAULTS[typ]);
    }
  };

  return (
    <div className="font-mono">
      <div style={indent} className="flex items-center gap-1 py-0.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-[var(--text-tertiary)] w-3 text-center hover:text-[var(--text-primary)]"
        >
          {open ? '▾' : '▸'}
        </button>
        {renderKeyLabel()}
        <span className="text-[var(--text-tertiary)] text-xs">{summary}</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setAdderOpen(!adderOpen);
          }}
          title={isArray ? 'Добавить элемент' : 'Добавить ключ'}
          className="text-[11px] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] px-1"
        >
          +
        </button>
        {renderDeleteBtn()}
      </div>
      {adderOpen && (
        <AdderRow
          isArray={isArray}
          existingKeys={isArray ? [] : entries.map(([k]) => k)}
          onAdd={handleAdd}
          onCancel={() => setAdderOpen(false)}
          indent={depth + 1}
        />
      )}
      {open && entries.length === 0 && !adderOpen && (
        <div
          style={{ paddingLeft: `${(depth + 1) * 14}px` }}
          className="text-[10px] text-[var(--text-tertiary)] py-0.5 italic"
        >
          (пусто)
        </div>
      )}
      {open &&
        entries.map(([k, v]) => (
          <TreeNode
            key={k}
            value={v}
            keyName={k}
            path={[...path, isArray ? Number(k) : k]}
            parentIsArray={isArray}
            depth={depth + 1}
            mutate={mutate}
          />
        ))}
    </div>
  );
};

// === FormNode — recursive form-style renderer for object/array containers ===

interface FormNodeProps {
  value: unknown;
  path: Path;
  depth: number;
  isRoot?: boolean;
  mutate: MutateAPI;
}

export const FormNode = ({ value, path, depth, isRoot, mutate }: FormNodeProps) => {
  const [adderOpen, setAdderOpen] = useState(false);
  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  const handleAdd = (typ: ValueType, name?: string) => {
    setAdderOpen(false);
    if (isArray) {
      mutate.setAt([...path, (value as unknown[]).length], TYPE_DEFAULTS[typ]);
    } else {
      const obj = value as Record<string, unknown>;
      const k = name?.trim() || nextUniqueKey(obj);
      if (k in obj) return;
      mutate.setAt([...path, k], TYPE_DEFAULTS[typ]);
    }
  };

  return (
    <div className={isRoot ? '' : 'border-l border-[var(--border-secondary)] ml-1'}>
      {entries.length === 0 && !adderOpen && (
        <div className="px-3 py-2 text-xs text-[var(--text-tertiary)] text-center italic">
          (пусто)
        </div>
      )}
      <div className="divide-y divide-[var(--border-secondary)]">
        {entries.map(([k, v]) => (
          <FormFieldRow
            key={k}
            keyName={k}
            value={v}
            path={[...path, isArray ? Number(k) : k]}
            parentIsArray={isArray}
            depth={depth + 1}
            mutate={mutate}
          />
        ))}
      </div>
      <div className="px-3 py-2">
        {!adderOpen ? (
          <button
            type="button"
            onClick={() => setAdderOpen(true)}
            className="px-2 py-1 text-[11px] rounded border border-dashed border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            + {isArray ? 'элемент' : 'ключ'}
          </button>
        ) : (
          <AdderRow
            isArray={isArray}
            existingKeys={isArray ? [] : entries.map(([k]) => k)}
            onAdd={handleAdd}
            onCancel={() => setAdderOpen(false)}
            indent={0}
          />
        )}
      </div>
    </div>
  );
};

// === FormFieldRow — single key/value row in form mode ===

interface FormFieldRowProps {
  keyName: string;
  value: unknown;
  path: Path;
  parentIsArray: boolean;
  depth: number;
  mutate: MutateAPI;
}

const FormFieldRow = ({
  keyName,
  value,
  path,
  parentIsArray,
  depth,
  mutate,
}: FormFieldRowProps) => {
  const [renaming, setRenaming] = useState(false);
  const [expanded, setExpanded] = useState(depth < 2);
  const t = detectType(value);
  const isContainer = t === 'object' || t === 'array';

  const renderKey = () => {
    if (parentIsArray) {
      return (
        <span className="text-xs font-mono text-[var(--text-tertiary)] truncate block">
          [{keyName}]
        </span>
      );
    }
    if (renaming) {
      return (
        <input
          autoFocus
          defaultValue={keyName}
          onBlur={(e) => {
            setRenaming(false);
            const v = e.target.value.trim();
            if (v && v !== keyName) mutate.renameKey(path.slice(0, -1), keyName, v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setRenaming(false);
            }
          }}
          className="w-full px-1 py-0 text-xs font-mono rounded border border-[var(--color-primary-500)] bg-[var(--bg-primary)] focus:outline-none"
        />
      );
    }
    return (
      <button
        type="button"
        onDoubleClick={() => setRenaming(true)}
        title="Double-click для переименования"
        className="text-xs font-mono text-[var(--text-secondary)] truncate w-full text-left hover:underline"
      >
        {keyName}
      </button>
    );
  };

  if (isContainer) {
    const summary =
      t === 'array'
        ? `[${(value as unknown[]).length}]`
        : `{${Object.keys(value as Record<string, unknown>).length}}`;
    return (
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-[var(--text-tertiary)] w-3 text-center hover:text-[var(--text-primary)]"
          >
            {expanded ? '▾' : '▸'}
          </button>
          <div className="flex-1 min-w-0">{renderKey()}</div>
          <span className="text-[10px] text-[var(--text-tertiary)] font-mono">{summary}</span>
          <button
            type="button"
            onClick={() => mutate.deleteAt(path)}
            title="Удалить"
            className="text-[11px] text-[var(--text-tertiary)] hover:text-red-500 px-1 opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
        {expanded && <FormNode value={value} path={path} depth={depth} mutate={mutate} />}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[140px_1fr_auto] gap-2 px-3 py-2 items-center">
      <div className="min-w-0">{renderKey()}</div>
      <PrimitiveEditor
        value={value as string | number | boolean | null}
        path={path}
        mutate={mutate}
      />
      <button
        type="button"
        onClick={() => mutate.deleteAt(path)}
        title="Удалить"
        className="text-[11px] text-[var(--text-tertiary)] hover:text-red-500 px-1 opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
};

/**
 * Shared types and pure helpers for the JSON cell editor (ADR-0017 Phase 3-4).
 * Tree and Form modes mutate the parsed object via these helpers and re-stringify
 * back into the editor's `draft` string.
 */

import type { JsonColumnConfig } from '../../types/table.types';

export type Mode = 'code' | 'tree' | 'form';
export type Path = (string | number)[];
export type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export const MODE_LABELS: Record<Mode, string> = {
  code: 'Код',
  tree: 'Дерево',
  form: 'Форма',
};

export const DEFAULT_MODE: Mode = 'code';

export const TYPE_DEFAULTS: Record<ValueType, unknown> = {
  string: '',
  number: 0,
  boolean: false,
  null: null,
  object: {},
  array: [],
};

export interface MutateAPI {
  setAt: (path: Path, value: unknown) => void;
  deleteAt: (path: Path) => void;
  renameKey: (parentPath: Path, oldKey: string, newKey: string) => void;
}

export const tryParse = (
  raw: string,
): { ok: boolean; data?: unknown; error?: string } => {
  if (!raw || !raw.trim()) return { ok: true, data: undefined };
  try {
    return { ok: true, data: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

export const seedInitial = (value: string, config?: JsonColumnConfig): string => {
  if (value && value.trim()) return value;
  const tpl = config?.template;
  if (tpl && tryParse(tpl).ok) return tpl;
  return '';
};

const cloneDeep = <T,>(v: T): T =>
  v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);

export const setAt = (root: unknown, path: Path, value: unknown): unknown => {
  if (path.length === 0) return value;
  const cloned = cloneDeep(root) as Record<string, unknown>;
  let cur: any = cloned;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i] as keyof typeof cur];
  cur[path[path.length - 1] as keyof typeof cur] = value;
  return cloned;
};

export const deleteAt = (root: unknown, path: Path): unknown => {
  if (path.length === 0) return undefined;
  const cloned = cloneDeep(root) as Record<string, unknown>;
  let cur: any = cloned;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i] as keyof typeof cur];
  const last = path[path.length - 1];
  if (Array.isArray(cur)) cur.splice(Number(last), 1);
  else delete cur[last as string];
  return cloned;
};

export const renameKey = (
  root: unknown,
  parentPath: Path,
  oldKey: string,
  newKey: string,
): unknown => {
  if (oldKey === newKey || !newKey) return root;
  let parent: any = root;
  for (const k of parentPath) parent = parent[k];
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return root;
  if (!(oldKey in parent) || newKey in parent) return root;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parent)) {
    next[k === oldKey ? newKey : k] = v;
  }
  return setAt(root, parentPath, next);
};

export const nextUniqueKey = (obj: Record<string, unknown>, base = 'key'): string => {
  if (!(base in obj)) return base;
  let i = 1;
  while (`${base}_${i}` in obj) i++;
  return `${base}_${i}`;
};

export const detectType = (v: unknown): ValueType => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'object') return 'object';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  return 'string';
};

/**
 * Динамика числовой ячейки (number displayStyle='trend'): текущее значение и изменение
 * относительно предыдущего сопоставимого замера, прочитанные из служебной JSON-колонки
 * (`config.number.trendField`). Писатель ячейки — scripts/lib/seo-positions-core.mjs (applyResult).
 *
 * Семантика «позиция в выдаче»: меньше = лучше, поэтому delta = prev − current.
 */

export interface TrendPoint {
  position?: number | null;
  status?: string;
  depth?: number | null;
  checked?: number | null;
  at?: string;
  run_id?: string;
}

export interface TrendCell extends TrendPoint {
  url?: string | null;
  received_at?: string;
  prev?: TrendPoint | null;
  error?: string | null;
  error_at?: string | null;
  pending?: { operation_id?: string; submitted_at?: string } | null;
  baseline_reset?: boolean;
}

export type TrendTone = 'up' | 'down' | 'flat' | 'none';

export interface Trend {
  value: string;          // «4» | «>50» | «—»
  delta: string | null;   // «↑1» | «↓3» | «—» | «↑ в топ-50» | «↓ из топ-50» | null (первый замер)
  tone: TrendTone;
  marker: '⏳' | '⚠' | null;
  title: string;          // подсказка: обе даты, URL, ошибка/ожидание
}

export function parseTrendCell(raw: unknown): TrendCell | null {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as TrendCell) : null;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const topN = (p: TrendPoint) => p.checked ?? p.depth ?? '?';

export function trendOf(cell: TrendCell): Trend {
  const cur = cell.position;
  const value = isNum(cur) ? String(cur) : cell.status === 'not_found' ? `>${topN(cell)}` : '—';
  const prev = cell.prev ?? null;
  const prevNum = prev && isNum(prev.position) ? prev.position : null;

  let delta: string | null = null;
  let tone: TrendTone = 'none';
  if (prev) {
    if (isNum(cur) && prevNum !== null) {
      const d = prevNum - cur;
      delta = d > 0 ? `↑${d}` : d < 0 ? `↓${-d}` : '—';
      tone = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    } else if (isNum(cur)) {
      delta = `↑ в топ-${topN(prev)}`; tone = 'up';
    } else if (prevNum !== null) {
      delta = `↓ из топ-${topN(cell)}`; tone = 'down';
    } else {
      delta = '—'; tone = 'flat';
    }
  }

  const lines = [`Замер: ${fmtDate(cell.at)}${cell.run_id ? ` (${cell.run_id})` : ''}`];
  if (prev) lines.push(`Предыдущий: ${fmtDate(prev.at)}${prev.run_id ? ` (${prev.run_id})` : ''}`);
  else if (cell.baseline_reset) lines.push('Изменена методика — новая база сравнения');
  else if (cell.at) lines.push('Первый замер');
  if (cell.url) lines.push(`URL: ${cell.url}`);
  if (cell.error) lines.push(`Ошибка ${fmtDate(cell.error_at ?? undefined)}: ${cell.error} — показана последняя успешная позиция`);
  if (cell.pending?.operation_id) lines.push(`Ожидает результат: ${cell.pending.operation_id} (отправлено ${fmtDate(cell.pending.submitted_at)})`);

  return { value, delta, tone, marker: cell.pending?.operation_id ? '⏳' : cell.error ? '⚠' : null, title: lines.join('\n') };
}

export const TONE_CLASS: Record<TrendTone, string> = {
  up: 'text-green-600 dark:text-green-400',
  down: 'text-red-600 dark:text-red-400',
  flat: 'text-[var(--text-tertiary)]',
  none: '',
};

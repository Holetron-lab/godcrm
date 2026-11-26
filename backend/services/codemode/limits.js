export const DEFAULT_LIMITS = Object.freeze({
  timeout_ms: 10_000,
  memory_mb: 128,
  max_tool_calls: 50,
});

export const MAX_RESULT_BYTES = 64 * 1024;
export const MAX_LOG_LINES = 200;
export const MAX_LOG_BYTES = 16 * 1024;

function clampInteger(value, fallback, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}

export function normalizeLimits(limits = {}) {
  return {
    timeout_ms: clampInteger(limits.timeout_ms, DEFAULT_LIMITS.timeout_ms, 60_000),
    memory_mb: clampInteger(limits.memory_mb, DEFAULT_LIMITS.memory_mb, 256),
    max_tool_calls: clampInteger(limits.max_tool_calls, DEFAULT_LIMITS.max_tool_calls, 50),
  };
}

export function truncateUtf8(value, maximumBytes) {
  const text = String(value);
  if (Buffer.byteLength(text, 'utf8') <= maximumBytes) return { value: text, truncated: false };
  let output = '';
  let bytes = 0;
  const ellipsisBytes = Buffer.byteLength('…', 'utf8');
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes + ellipsisBytes > maximumBytes) break;
    output += character;
    bytes += characterBytes;
  }
  return { value: `${output}…`, truncated: true };
}

export function truncateResult(value, maximumBytes = MAX_RESULT_BYTES) {
  const serialized = JSON.stringify(value === undefined ? null : value);
  if (Buffer.byteLength(serialized, 'utf8') <= maximumBytes) return { result: value, truncated: false };
  const truncated = truncateUtf8(serialized, maximumBytes);
  return { result: truncated.value, truncated: true };
}

function formatLogValue(value) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createLogCollector() {
  const lines = [];
  let bytes = 0;
  const collect = (level, values) => {
    if (lines.length >= MAX_LOG_LINES) return;
    const prefix = level === 'log' ? '' : `${level}: `;
    const line = `${prefix}${values.map(formatLogValue).join(' ')}`;
    const separatorBytes = lines.length ? 1 : 0;
    const remaining = MAX_LOG_BYTES - bytes - separatorBytes;
    if (remaining <= 0) return;
    const truncated = truncateUtf8(line, remaining).value;
    lines.push(truncated);
    bytes += separatorBytes + Buffer.byteLength(truncated, 'utf8');
  };
  collect.lines = () => [...lines];
  return collect;
}

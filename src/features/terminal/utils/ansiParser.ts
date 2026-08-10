/**
 * ANSI Parser - ADR-076
 * Converts ANSI escape codes to spans with CSS classes.
 * Covers basic colors (30-37, 90-97) and styles (bold, dim, underline).
 */

export interface AnsiSpan {
  text: string;
  className: string;
}

const ANSI_COLORS: Record<number, string> = {
  // Standard colors
  30: 'text-gray-900 dark:text-gray-300',
  31: 'text-red-400',
  32: 'text-green-400',
  33: 'text-yellow-400',
  34: 'text-blue-400',
  35: 'text-purple-400',
  36: 'text-cyan-400',
  37: 'text-white',
  // Bright colors
  90: 'text-gray-500',
  91: 'text-red-300',
  92: 'text-green-300',
  93: 'text-yellow-300',
  94: 'text-blue-300',
  95: 'text-purple-300',
  96: 'text-cyan-300',
  97: 'text-white',
};

const ANSI_STYLES: Record<number, string> = {
  1: 'font-bold',
  2: 'opacity-60',
  3: 'italic',
  4: 'underline',
};

// Regex: matches \x1b[ followed by semicolon-separated numbers and a letter
const ANSI_REGEX = /\x1b\[([0-9;]*)m/g;

/**
 * Parse a string with ANSI escape codes into styled spans
 */
export function parseAnsi(input: string): AnsiSpan[] {
  if (!input) return [{ text: '', className: '' }];

  const spans: AnsiSpan[] = [];
  let currentClasses: string[] = [];
  let lastIndex = 0;

  // Strip other escape sequences we don't handle (cursor, erase, etc.)
  const cleaned = input.replace(/\x1b\[[0-9;]*[A-HJKSTfhilmnsu]/g, (match) => {
    // Keep color sequences (ending with 'm'), strip everything else
    return match.endsWith('m') ? match : '';
  });

  let match: RegExpExecArray | null;
  ANSI_REGEX.lastIndex = 0;

  while ((match = ANSI_REGEX.exec(cleaned)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      const text = cleaned.slice(lastIndex, match.index);
      if (text) {
        spans.push({ text, className: currentClasses.join(' ') });
      }
    }

    // Parse the codes
    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0) {
        // Reset
        currentClasses = [];
      } else if (ANSI_COLORS[code]) {
        // Remove any existing color class
        currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
        currentClasses.push(ANSI_COLORS[code]);
      } else if (ANSI_STYLES[code]) {
        if (!currentClasses.includes(ANSI_STYLES[code])) {
          currentClasses.push(ANSI_STYLES[code]);
        }
      }
    }

    lastIndex = ANSI_REGEX.lastIndex;
  }

  // Add remaining text
  if (lastIndex < cleaned.length) {
    spans.push({
      text: cleaned.slice(lastIndex),
      className: currentClasses.join(' '),
    });
  }

  // Collapse empty spans
  return spans.filter(s => s.text.length > 0);
}

/**
 * Strip all ANSI escape codes from a string
 */
export function stripAnsi(input: string): string {
  return input.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

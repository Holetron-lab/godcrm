/**
 * Markdown Checkbox Utilities
 *
 * Pure functions for normalizing, toggling, and analyzing
 * checkbox syntax in markdown content.
 *
 * Supports:
 * - GFM task lists: - [ ] / - [x]
 * - Unicode: ☐/☑, □/■, ⬜/✅, ✓, ☒
 * - Non-standard: [*]
 */

/**
 * Normalize unicode/emoji checkbox symbols to GFM task list syntax.
 * Converts: ☐/☑, □/■, ⬜/✅, [*] → - [ ] / - [x]
 */
export function normalizeCheckboxes(text: string): string {
  const lines = text.split('\n');
  return lines.map(line => {
    // Already GFM task list syntax — skip
    if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) return line;

    // [*] syntax (non-standard "checked") → - [x]
    if (/^\s*[-*+]\s+\[\*\]/.test(line)) {
      return line.replace(/\[\*\]/, '[x]');
    }

    // Standalone [*] at line start without list marker
    if (/^\s*\[\*\]\s/.test(line)) {
      return line.replace(/^\s*\[\*\]/, '- [x]');
    }

    // Unicode checkboxes as list items: - ☐ text → - [ ] text
    // Unchecked symbols: ☐ (U+2610), □ (U+25A1), ⬜ (U+2B1C), ⬜️
    if (/^\s*[-*+]\s+[☐□⬜]️?\s/.test(line)) {
      return line.replace(/[-*+]\s+[☐□⬜]️?/, '- [ ]');
    }
    // Checked symbols: ☑ (U+2611), ☑️, ■ (U+25A0), ✅, ✓, ☒ (U+2612)
    if (/^\s*[-*+]\s+[☑■✅✓☒]️?\s/.test(line)) {
      return line.replace(/[-*+]\s+[☑■✅✓☒]️?/, '- [x]');
    }

    // Standalone unicode checkboxes at line start (no list marker)
    // Unchecked
    if (/^\s*[☐□⬜]️?\s/.test(line)) {
      return line.replace(/^\s*[☐□⬜]️?/, '- [ ]');
    }
    // Checked
    if (/^\s*[☑■✅✓☒]️?\s/.test(line)) {
      return line.replace(/^\s*[☑■✅✓☒]️?/, '- [x]');
    }

    return line;
  }).join('\n');
}

/**
 * Toggle a specific checkbox in markdown content by its index.
 * Returns the new content with the checkbox toggled.
 */
export function toggleCheckboxByIndex(text: string, checkboxIndex: number): string {
  const lines = text.split('\n');
  let currentIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match GFM task list checkbox (after normalization)
    const match = line.match(/^(\s*[-*+]\s+)\[([ xX])\](.*)$/);
    if (match) {
      if (currentIdx === checkboxIndex) {
        const prefix = match[1];
        const wasChecked = match[2] !== ' ';
        const suffix = match[3];
        lines[i] = `${prefix}[${wasChecked ? ' ' : 'x'}]${suffix}`;
        break;
      }
      currentIdx++;
    }
  }

  return lines.join('\n');
}

/**
 * Get context info for a checkbox at a given index.
 * Returns the line text and nearest heading above.
 */
export function getCheckboxContext(text: string, checkboxIndex: number): { lineText: string; heading: string } {
  const lines = text.split('\n');
  let currentIdx = 0;
  let lastHeading = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track headings
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      lastHeading = headingMatch[1].trim();
    }

    // Match GFM task list checkbox
    const cbMatch = line.match(/^(\s*[-*+]\s+)\[([ xX])\]\s*(.*)$/);
    if (cbMatch) {
      if (currentIdx === checkboxIndex) {
        return { lineText: cbMatch[3].trim(), heading: lastHeading };
      }
      currentIdx++;
    }
  }

  return { lineText: '', heading: '' };
}

/**
 * Denormalize GFM checkboxes back to their original format
 * based on what symbols the original content used.
 * Preserves the user's preferred checkbox style.
 */
export function denormalizeCheckboxes(normalizedContent: string, originalContent: string): string {
  // Detect the original checkbox style from the source
  const hasUnicodeUnchecked = /[☐□⬜]️?/.test(originalContent);
  const hasUnicodeChecked = /[☑■✅✓☒]️?/.test(originalContent);
  const hasStarSyntax = /\[\*\]/.test(originalContent);

  // If original used standard GFM syntax, return as-is
  if (!hasUnicodeUnchecked && !hasUnicodeChecked && !hasStarSyntax) {
    return normalizedContent;
  }

  // Detect which specific symbols were used
  const uncheckedSymbol = originalContent.match(/[☐□⬜]️?/)?.[0] || '☐';
  const checkedSymbol = originalContent.match(/[☑■✅✓☒]️?/)?.[0] || '☑';
  const hadListMarker = /^\s*[-*+]\s+[☐□⬜☑■✅✓☒]/m.test(originalContent);

  const lines = normalizedContent.split('\n');
  return lines.map(line => {
    const match = line.match(/^(\s*)([-*+]\s+)\[([ xX])\](.*)$/);
    if (match) {
      const indent = match[1];
      const isChecked = match[3] !== ' ';
      const suffix = match[4];
      const symbol = isChecked ? checkedSymbol : uncheckedSymbol;

      if (hadListMarker) {
        return `${indent}- ${symbol}${suffix}`;
      }
      return `${indent}${symbol}${suffix}`;
    }
    return line;
  }).join('\n');
}

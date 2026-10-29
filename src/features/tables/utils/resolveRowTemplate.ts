/**
 * ADR-0035-A §Amendment 1 — the one display-time `{{column_key}}` resolver.
 *
 * Extracted verbatim from `TextCell.replaceVariables` so the address cell does
 * not become the tenth copy of the regex. Semantics are exactly TextCell's:
 *   - `{{row_id}}` → `rowData.id ?? rowData.row_id ?? rowData._id` (system variable)
 *   - `{{<key>}}`  → `String(rowData[key])`, null/undefined → ''
 *   - no Liquid conditionals or filters, no `{{row_title}}` magic
 *
 * Consumers in this slice: `TextCell` (formula / prefix / suffix) and
 * `AddressCell` (label resolution). Display only — never write the result back.
 */
export const resolveRowTemplate = (template: string, rowData: Record<string, unknown>): string => {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '';
    }
    const value = rowData[key];
    if (value === null || value === undefined) return '';
    return String(value);
  });
};

/** True when the string carries at least one `{{key}}` placeholder. */
export const hasRowTemplate = (template: string | null | undefined): boolean =>
  typeof template === 'string' && /\{\{\w+\}\}/.test(template);

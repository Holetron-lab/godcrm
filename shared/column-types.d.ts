/** Frontend normalization exports; runtime values live in column-types.js. */
export const COLUMN_TYPE_ALIASES: Readonly<Record<string, string>>;
export function canonicalizeColumnType(type: string): string;

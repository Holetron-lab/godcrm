/**
 * Merge a validated patch without retaining a stale alias of an edited column.
 * Untouched fields stay byte-for-byte equivalent; this is not a data migration.
 * If both aliases are supplied, the name wins, as in the REST normalization.
 */
export function mergeRowData(columns, existing, patch) {
  const merged = { ...existing, ...patch };
  for (const { id, column_name: name } of columns) {
    if (String(id) === name) continue;
    if (Object.hasOwn(patch, name)) delete merged[id];
    else if (Object.hasOwn(patch, id)) delete merged[name];
  }
  return merged;
}

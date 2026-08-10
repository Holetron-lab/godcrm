/**
 * Utility functions for ColumnsEditingTab
 */

// Helper function to set nested value in object
export function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  if (path.length === 0) return obj;
  if (path.length === 1) {
    return { ...obj, [path[0]]: value };
  }

  const [first, ...rest] = path;
  return {
    ...obj,
    [first]: setNestedValue((obj[first] as Record<string, unknown>) || {}, rest, value)
  };
}

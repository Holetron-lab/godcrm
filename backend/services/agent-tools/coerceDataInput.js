/**
 * coerceDataInput — normalize the `data` arg passed to row-mutation tools.
 *
 * MCP/agent callers occasionally pass `data` as a JSON-encoded string
 * instead of a parsed object. Without normalization, downstream
 * `JSON.stringify(data)` writes a *quoted string* into the JSONB column
 * (jsonb_typeof = 'string'), so subsequent reads have to JSON.parse the
 * payload twice and atom-renderers that read fields directly miss them.
 *
 * Bug reference: BUG-MCP-001 (ADR-0020 audit pass).
 */

export function coerceDataObject(data, fieldName = 'data') {
  if (data === null || data === undefined) return null;

  if (typeof data === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new Error(
        `${fieldName} must be a JSON object; received a string that is not valid JSON`
      );
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
    const got = parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed;
    throw new Error(`${fieldName} must decode to a JSON object; got ${got}`);
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(
      `${fieldName} must be a JSON object; got ${Array.isArray(data) ? 'array' : typeof data}`
    );
  }

  return data;
}

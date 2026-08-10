/**
 * Parse tool name from content that may be:
 * - Just the tool name: "Bash"
 * - JSON with tool field: {"tool":"Bash","input":{...}}
 * - JSON with name field: {"name":"search_files","args":{...}}
 * - Descriptive text: "calling: search_files"
 *
 * Also checks toolResults for the most reliable tool name.
 */
export function parseToolName(
  content: string,
  toolResults?: unknown,
): string {
  if (!content && !toolResults) return 'tool';

  // 1. Try toolResults first (most reliable source)
  if (toolResults) {
    if (Array.isArray(toolResults) && toolResults[0]?.tool) {
      return toolResults[0].tool;
    }
    if (typeof toolResults === 'object' && toolResults !== null && 'tool' in toolResults) {
      return (toolResults as Record<string, unknown>).tool as string;
    }
  }

  if (!content) return 'tool';

  // 2. Try JSON parsing
  try {
    const parsed = JSON.parse(content);
    if (parsed.tool) return parsed.tool;
    if (parsed.name) return parsed.name;
  } catch {
    // Not JSON, try pattern matching
  }

  // 3. Regex pattern
  const match = content.match(/(?:tool|function|calling)[:\s]+(\w+)/i);
  if (match) return match[1];

  // 4. Fallback: return first line trimmed (likely plain tool name like "Bash")
  const firstLine = content.split('\n')[0].trim();
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
}

/**
 * Parse tool arguments from content or toolResults.
 */
export function parseToolArgs(
  content: string,
  toolResults?: unknown,
): Record<string, unknown> | undefined {
  // 1. Try toolResults first
  if (toolResults) {
    if (Array.isArray(toolResults) && toolResults[0]?.args) {
      return toolResults[0].args as Record<string, unknown>;
    }
    if (typeof toolResults === 'object' && toolResults !== null && 'args' in toolResults) {
      return (toolResults as Record<string, unknown>).args as Record<string, unknown>;
    }
  }

  if (!content) return undefined;

  // 2. Try JSON parsing
  try {
    const parsed = JSON.parse(content);
    if (parsed.args) return parsed.args as Record<string, unknown>;
    if (parsed.input) return parsed.input as Record<string, unknown>;
  } catch {
    // Not JSON
  }
  return undefined;
}

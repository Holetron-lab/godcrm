import type { Step, Section, ToolStep } from './types';

// Shared utility — extracted to avoid duplication with AgentStepsBubble
export { parseToolName } from '../../../../../utils/parseToolName';

export const TOOL_RESULT_TRUNCATE_LENGTH = 500;
export const TOOL_RESULT_FULL_LENGTH = 5000;

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/** Insert zero-width spaces after / and around | so long paths/commands can wrap */
export function softBreakText(text: string): string {
  return text.replace(/\//g, '/\u200B').replace(/\|/g, '\u200B|\u200B');
}

export function parseToolArgs(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content);
    if (parsed.args) return parsed.args as Record<string, unknown>;
    if (parsed.input) return parsed.input as Record<string, unknown>;
  } catch {
    // Not JSON
  }
  return undefined;
}

export function parseToolResult(content: string): { result: unknown; success: boolean } {
  try {
    const parsed = JSON.parse(content);
    const success = parsed.error ? false : true;
    return { result: parsed.result ?? parsed, success };
  } catch {
    return { result: content, success: !content.toLowerCase().includes('error') };
  }
}

export function formatResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

export function formatTime(timestamp: Date | string | undefined): string {
  if (!timestamp) return '';
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  if (isThisYear) return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${time}`;
  return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

/**
 * Groups steps into sections: consecutive tool calls -> one ToolGroupSection,
 * thinking -> ThinkingSection. This preserves chronological order.
 */
export function groupStepsIntoSections(steps: Step[]): Section[] {
  const sections: Section[] = [];
  let currentTools: ToolStep[] = [];

  const flushTools = () => {
    if (currentTools.length > 0) {
      sections.push({ kind: 'tool_group', tools: [...currentTools] });
      currentTools = [];
    }
  };

  for (const step of steps) {
    if (step.kind === 'thinking') {
      flushTools();
      sections.push({ kind: 'thinking', content: step.content });
    } else if (step.kind === 'tool_approval') {
      flushTools();
      sections.push({ kind: 'tool_approval', step });
    } else if (step.kind === 'plan') {
      flushTools();
      sections.push({ kind: 'plan', tasks: step.tasks });
    } else {
      currentTools.push(step);
    }
  }
  flushTools();
  return sections;
}

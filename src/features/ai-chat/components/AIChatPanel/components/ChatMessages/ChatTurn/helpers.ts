import type { Step, Section, ToolStep } from './types';
import type { ChatMessage } from '../../../types';

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

type StepGroupTimes = { first_at?: string | null; last_at?: string | null };
type TimedMessage = ChatMessage & {
  created_at?: string;
  _step_groups_before?: StepGroupTimes[];
  _step_groups_after?: StepGroupTimes[];
};

/** Earliest and latest instant of a turn — its messages plus the hidden step
 *  groups annotated on them. History loads lazily (steps collapse into
 *  `_step_groups_before/_after` on the visible message), so a bubble loaded from
 *  history usually holds one message and its steps' times survive only as
 *  `first_at` / `last_at` on the groups. `end` is undefined for a single instant. */
export function turnTimeSpan(
  messages: ChatMessage[],
): { start: Date | string | undefined; end: Date | string | undefined } {
  let start: Date | string | undefined;
  let end: Date | string | undefined;
  let startMs = Infinity;
  let endMs = -Infinity;
  const consider = (value: Date | string | null | undefined) => {
    if (!value) return;
    const ms = new Date(value).getTime();
    if (Number.isNaN(ms)) return;
    if (ms < startMs) { startMs = ms; start = value; }
    if (ms > endMs) { endMs = ms; end = value; }
  };
  for (const raw of messages) {
    const msg = raw as TimedMessage;
    for (const g of msg._step_groups_before ?? []) { consider(g.first_at); consider(g.last_at); }
    consider(msg.created_at || msg.timestamp);
  }
  const last = messages[messages.length - 1] as TimedMessage | undefined;
  for (const g of last?._step_groups_after ?? []) { consider(g.first_at); consider(g.last_at); }
  return { start, end: endMs > startMs ? end : undefined };
}

export function formatTime(timestamp: Date | string | undefined, timestampEnd?: Date | string, language = 'ru'): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const end = timestampEnd ? new Date(timestampEnd) : undefined;
  const timeOptions = { hour: '2-digit', minute: '2-digit' } as const;
  const time = date.toLocaleTimeString(language, timeOptions);
  const day = date.toLocaleDateString(language, {
    day: '2-digit', month: '2-digit',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
  });
  const start = date.toDateString() === new Date().toDateString() ? time : `${day} ${time}`;
  if (!end || Number.isNaN(end.getTime())) return start;
  if (date.toDateString() !== end.toDateString()) return `${start} - ${formatTime(end)}`;
  const endTime = end.toLocaleTimeString(language, timeOptions);
  return time === endTime ? start : `${start} - ${endTime}`;
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

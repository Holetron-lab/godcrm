/**
 * AgentTurnBubble Component
 * ADR-092: Telegram-style agent message bubble with reasoning chains and tool steps
 *
 * Renders multiple agent messages (thinking, tool_call, tool_result, final text)
 * as a single compact Telegram-style bubble.
 *
 * Visual structure (updated):
 * ┌─────────────────────────────────────────┐
 * │ 🧠 Reasoning                            │
 * │ │ Analyzing the request. I need to...   │
 * │ │                      [Show full →]    │
 * │                                         │
 * │ 🔧 Used 3 tools                    ▼   │
 * │  ├─ $ npm test --run             ✓      │
 * │  │   Preview: 12 tests passed...        │
 * │  ├─ Read: src/api/users.ts       ✓      │
 * │  └─ Edit: src/api/users.ts       ✓      │
 * │                                         │
 * │ 🧠 Reasoning                            │
 * │ │ Now I understand the fix...           │
 * │                                         │
 * │ 🔧 Used 2 tools                    ▼   │
 * │  ├─ ...                                 │
 * │                                         │
 * │ Final markdown response here...         │
 * │                                    14:32│
 * └─────────────────────────────────────────┘
 */

import React, { useState } from 'react';
import {
  Wrench,
  Terminal,
  ChevronDown,
  ChevronRight,
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  Eye,
  PenLine,
  Globe,
  Database,
  Search,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview, type CheckboxClickInfo, type CheckboxUser } from '@/shared/components/MarkdownPreview';
import type { ChatMessageItem } from './ChatConversationView';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ToolStep {
  kind: 'tool';
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  success: boolean;
}

interface ThinkingStep {
  kind: 'thinking';
  content: string;
}

type Step = ToolStep | ThinkingStep;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOL_RESULT_TRUNCATE = 500;
const TOOL_RESULT_FULL_LENGTH = 5000;

function truncateText(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '...';
}

/** Insert zero-width spaces after / and around | so long paths/commands can wrap */
function softBreakText(text: string): string {
  return text.replace(/\//g, '/\u200B').replace(/\|/g, '\u200B|\u200B');
}

/**
 * Extract tool name from message content or toolResults.
 * Handles multiple formats:
 * - AgentLoopService: content="Bash", toolResults={tool:"Bash",args:{...}}
 * - Claude Code mirror: content='{"tool":"Bash","input":{...}}', toolResults=null
 * - Legacy: plain text with "calling: toolName" pattern
 */
function parseToolName(content: string, toolResults?: ChatMessageItem['toolResults']): string {
  // 1. Try toolResults first (most reliable)
  if (toolResults) {
    if (Array.isArray(toolResults)) {
      if (toolResults[0]?.tool) return toolResults[0].tool;
    } else if (typeof toolResults === 'object' && 'tool' in toolResults) {
      return (toolResults as Record<string, unknown>).tool as string;
    }
  }
  // 2. Try JSON parsing
  try {
    const parsed = JSON.parse(content);
    if (parsed.tool) return parsed.tool;
    if (parsed.name) return parsed.name;
  } catch { /* not JSON */ }
  // 3. Regex pattern
  const match = content.match(/(?:tool|function|calling)[:\s]+(\w+)/i);
  if (match) return match[1];
  // 4. Fallback: use first line (likely plain tool name like "Bash")
  const firstLine = content.split('\n')[0].trim();
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '...' : firstLine;
}

/**
 * Extract tool arguments from message content or toolResults.
 */
function parseToolArgs(content: string, toolResults?: ChatMessageItem['toolResults']): Record<string, unknown> | undefined {
  // 1. Try toolResults first
  if (toolResults) {
    if (Array.isArray(toolResults)) {
      if (toolResults[0]?.args) return toolResults[0].args;
    } else if (typeof toolResults === 'object' && 'args' in toolResults) {
      return (toolResults as Record<string, unknown>).args as Record<string, unknown>;
    }
  }
  // 2. Try JSON parsing
  try {
    const parsed = JSON.parse(content);
    if (parsed.args) return parsed.args as Record<string, unknown>;
    if (parsed.input) return parsed.input as Record<string, unknown>;
  } catch { /* not JSON */ }
  return undefined;
}

function parseToolResult(content: string): { result: unknown; success: boolean } {
  try {
    const parsed = JSON.parse(content);
    return { result: parsed.result ?? parsed, success: !parsed.error };
  } catch {
    return { result: content, success: !content.toLowerCase().includes('error') };
  }
}

function formatResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

/** Map tool name to a descriptive icon */
function getToolIcon(toolName: string) {
  const name = toolName.toLowerCase();
  if (name === 'bash' || name === 'shell' || name === 'execute') {
    return <Terminal className="w-3 h-3 text-green-500 flex-shrink-0" />;
  }
  if (name === 'read' || name === 'readfile' || name === 'cat') {
    return <Eye className="w-3 h-3 text-blue-400 flex-shrink-0" />;
  }
  if (name === 'write' || name === 'writefile' || name === 'edit') {
    return <PenLine className="w-3 h-3 text-amber-400 flex-shrink-0" />;
  }
  if (name === 'grep' || name === 'search' || name === 'glob' || name === 'find') {
    return <Search className="w-3 h-3 text-cyan-400 flex-shrink-0" />;
  }
  if (name === 'webfetch' || name === 'websearch' || name === 'web') {
    return <Globe className="w-3 h-3 text-indigo-400 flex-shrink-0" />;
  }
  if (name === 'sql' || name === 'query' || name === 'database') {
    return <Database className="w-3 h-3 text-orange-400 flex-shrink-0" />;
  }
  if (name === 'task' || name === 'agent') {
    return <Sparkles className="w-3 h-3 text-purple-400 flex-shrink-0" />;
  }
  return <Wrench className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />;
}

// ---------------------------------------------------------------------------
// Section types & grouping
// ---------------------------------------------------------------------------

interface ThinkingSection {
  kind: 'thinking';
  content: string;
}

interface ToolGroupSection {
  kind: 'tool_group';
  tools: ToolStep[];
}

type Section = ThinkingSection | ToolGroupSection;

/**
 * Groups steps into sections: consecutive tool calls → one ToolGroupSection,
 * thinking → ThinkingSection. Preserves chronological order.
 */
function groupStepsIntoSections(steps: Step[]): Section[] {
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
    } else {
      currentTools.push(step);
    }
  }
  flushTools();
  return sections;
}

// ---------------------------------------------------------------------------
// Sub-components: ThinkingBlock + ToolGroupAccordion
// ---------------------------------------------------------------------------

/** Renders thinking/reasoning content as a visible block (NOT hidden in accordion) */
const ThinkingBlock: React.FC<{ content: string }> = ({ content }) => {
  const [expanded, setExpanded] = useState(content.length <= 500);

  return (
    <div className="mb-2 pl-3 border-l-2 border-purple-500/30">
      <div className="flex items-center gap-1.5 mb-1">
        <Brain className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-[10px] font-medium text-purple-400 uppercase tracking-wide">
          Reasoning
        </span>
      </div>
      <div
        className={cn(
          'text-xs text-[var(--text-secondary)] whitespace-pre-wrap leading-relaxed',
          !expanded && 'line-clamp-6'
        )}
      >
        {content}
      </div>
      {content.length > 500 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-purple-400 hover:text-purple-300 cursor-pointer transition-colors"
        >
          {expanded ? '← Collapse' : 'Show full →'}
        </button>
      )}
    </div>
  );
};

/** Renders a group of consecutive tool calls as a collapsible accordion with result previews */
const ToolGroupAccordion: React.FC<{ tools: ToolStep[] }> = ({ tools }) => {
  const [expanded, setExpanded] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Record<number, boolean>>({});

  if (tools.length === 0) return null;

  const toggleResult = (idx: number) => {
    setExpandedResults((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="mb-2">
      {/* Summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors w-full text-left"
      >
        <Wrench className="w-3 h-3" />
        <span className="font-medium">
          Used {tools.length} tool{tools.length !== 1 ? 's' : ''}
        </span>
        {expanded ? (
          <ChevronDown className="w-3 h-3 ml-auto" />
        ) : (
          <ChevronRight className="w-3 h-3 ml-auto" />
        )}
      </button>

      {/* Expanded tool list */}
      {expanded && (
        <div className="mt-2 mb-1 space-y-1 pl-1 border-l-2 border-[var(--border-secondary)]">
          {tools.map((step, idx) => {
            const isBash = step.toolName === 'Bash' || step.toolName === 'bash';
            const bashCmd = isBash && step.args?.command ? String(step.args.command) : null;
            const isResultExpanded = expandedResults[idx] || false;
            const resultText = step.result !== undefined ? formatResult(step.result) : '';

            // Build tool description for preview
            let toolDescription = step.toolName;
            if (isBash && bashCmd) {
              toolDescription = `$ ${truncateText(bashCmd, 120)}`;
            } else if (step.toolName === 'Read' && step.args?.file_path) {
              toolDescription = `Read: ${String(step.args.file_path)}`;
            } else if (step.toolName === 'Edit' && step.args?.file_path) {
              toolDescription = `Edit: ${String(step.args.file_path)}`;
            } else if (step.toolName === 'Write' && step.args?.file_path) {
              toolDescription = `Write: ${String(step.args.file_path)}`;
            } else if (step.toolName === 'Grep' && step.args?.pattern) {
              toolDescription = `Grep: ${String(step.args.pattern)}`;
            } else if (step.toolName === 'Glob' && step.args?.pattern) {
              toolDescription = `Glob: ${String(step.args.pattern)}`;
            }

            return (
              <div key={`tool-${idx}`} className="py-0.5 pl-2">
                {/* Tool header with name/command + status icon */}
                <div className="flex items-start gap-1.5 text-[11px] min-w-0">
                  {getToolIcon(step.toolName)}
                  <span
                    className={cn(
                      'font-mono leading-tight min-w-0 break-all',
                      isBash ? 'text-green-400' : 'text-[var(--text-secondary)]'
                    )}
                  >
                    {softBreakText(toolDescription)}
                  </span>
                  {step.success ? (
                    <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                  )}
                </div>

                {/* Result preview (always show first 200 chars) + expand to full */}
                {resultText && (
                  <div className="mt-1 ml-4">
                    <pre
                      className="p-1.5 rounded bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-all font-mono"
                      style={{ maxHeight: isResultExpanded ? '400px' : '60px', overflowY: 'auto' }}
                    >
                      {isResultExpanded
                        ? truncateText(resultText, TOOL_RESULT_FULL_LENGTH)
                        : truncateText(resultText, 200)}
                    </pre>
                    {resultText.length > 200 && (
                      <button
                        onClick={() => toggleResult(idx)}
                        className="mt-1 text-[10px] text-[var(--color-primary-500)] hover:text-[var(--color-primary-400)] cursor-pointer transition-colors"
                      >
                        {isResultExpanded ? '← Collapse' : 'Show full result →'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AgentTurnBubbleProps {
  messages: ChatMessageItem[];
  isProcessing?: boolean;
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  /** New: callback for interactive checkbox toggle that persists to DB + sends system message */
  onCheckboxToggle?: (messageId: number | string, content: string, checkboxIndex: number) => void;
  currentUser?: CheckboxUser;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentTurnBubble: React.FC<AgentTurnBubbleProps> = ({
  messages,
  isProcessing = false,
  onCheckboxClick,
  onCheckboxToggle,
  currentUser,
  className,
}) => {
  // --- Parse messages into steps + final text ---
  const steps: Step[] = [];
  let finalText: ChatMessageItem | null = null;
  let toolCount = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const ct = msg.contentType;

    if (ct === 'thinking') {
      steps.push({ kind: 'thinking', content: msg.content });
    } else if (ct === 'tool_call') {
      toolCount++;
      const toolName = parseToolName(msg.content, msg.toolResults);
      const args = parseToolArgs(msg.content, msg.toolResults);

      let result: unknown;
      let success = true;
      // Look ahead for paired tool_result
      if (i + 1 < messages.length && messages[i + 1].contentType === 'tool_result') {
        const resultMsg = messages[i + 1];
        const parsed = parseToolResult(resultMsg.content);
        result = parsed.result;
        success = parsed.success;
        i++; // skip paired result
      } else {
        // Check if toolResults on this message already contains a result (AgentLoopService format)
        const tr = msg.toolResults;
        if (tr) {
          const trObj = Array.isArray(tr) ? tr[0] : (typeof tr === 'object' ? tr : null);
          if (trObj && 'result' in (trObj as Record<string, unknown>)) {
            const r = (trObj as Record<string, unknown>).result;
            result = r;
            const rStr = formatResult(r);
            success = !rStr.toLowerCase().includes('error');
          }
        }
      }

      steps.push({ kind: 'tool', toolName, args, result, success });
    } else if (ct === 'tool_result') {
      // Orphaned tool_result — try to attach to previous tool step
      const prevStep = steps.length > 0 ? steps[steps.length - 1] : null;
      if (prevStep && prevStep.kind === 'tool' && prevStep.result === undefined) {
        // Attach to previous tool step that has no result
        const parsed = parseToolResult(msg.content);
        prevStep.result = parsed.result;
        prevStep.success = parsed.success;
      } else {
        // Truly orphaned
        toolCount++;
        const parsed = parseToolResult(msg.content);
        steps.push({ kind: 'tool', toolName: 'tool', result: parsed.result, success: parsed.success });
      }
    } else if (ct === 'text' || !ct) {
      finalText = msg;
    }
  }

  // Legacy toolResults on single message
  if (messages.length === 1 && messages[0].toolResults?.length && toolCount === 0) {
    for (const tr of messages[0].toolResults) {
      toolCount++;
      const resultStr = formatResult(tr.result);
      steps.push({
        kind: 'tool',
        toolName: tr.tool,
        args: tr.args,
        result: tr.result,
        success: !resultStr.toLowerCase().includes('error'),
      });
    }
  }

  const hasSteps = steps.length > 0;
  const hasFinalText = finalText && finalText.content && !finalText.is_deleted;

  // Group steps into sections: thinking blocks shown as visible text,
  // tool groups shown as collapsible accordions
  const sections = hasSteps ? groupStepsIntoSections(steps) : [];

  return (
    <div className={cn('max-w-[85%]', className)}>
      <div className="bg-[var(--bg-primary)] text-[var(--text-primary)] rounded-2xl rounded-bl-md shadow-sm overflow-hidden">
        {/* --- Sections: Thinking blocks (visible) + Tool groups (accordion) --- */}
        {sections.length > 0 && (
          <div className="px-3 pt-2.5">
            {sections.map((section, idx) => {
              if (section.kind === 'thinking') {
                return (
                  <ThinkingBlock
                    key={`section-thinking-${idx}`}
                    content={section.content}
                  />
                );
              }
              return (
                <ToolGroupAccordion
                  key={`section-tools-${idx}`}
                  tools={section.tools}
                />
              );
            })}

            {/* Separator between steps and final text */}
            {hasFinalText && (
              <div className="border-b border-[var(--border-secondary)] mt-1 mb-0" />
            )}
          </div>
        )}

        {/* --- Final text (markdown) --- */}
        {hasFinalText && (
          <div className="px-3 py-2">
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none">
              <MarkdownPreview
                content={finalText!.content}
                onCheckboxClick={onCheckboxToggle
                  ? (info) => onCheckboxToggle(finalText!.id, finalText!.content, info.index)
                  : onCheckboxClick
                }
                currentUser={currentUser}
              />
            </div>
          </div>
        )}

        {/* --- Deleted message --- */}
        {finalText?.is_deleted && (
          <div className="px-3 py-2 text-sm italic text-[var(--text-tertiary)]">
            Message deleted
          </div>
        )}

        {/* --- Processing indicator with tool name + count --- */}
        {isProcessing && !hasFinalText && (
          <div className="px-3 py-2 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
            {toolCount > 0 ? (
              <span className="flex items-center gap-1.5">
                <span>{steps.filter(s => s.kind === 'tool').slice(-1)[0]?.toolName || 'tool'}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[10px] tabular-nums">
                  {toolCount} {toolCount === 1 ? 'tool' : 'tools'}
                </span>
              </span>
            ) : (
              <span>Думает...</span>
            )}
          </div>
        )}

        {/* --- Empty state: streaming dots --- */}
        {!isProcessing && !hasFinalText && !hasSteps && messages.length === 1 && (
          <div className="px-3 py-2.5 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>
    </div>
  );
};

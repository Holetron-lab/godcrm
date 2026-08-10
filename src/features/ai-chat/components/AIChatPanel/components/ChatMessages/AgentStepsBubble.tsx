import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  Brain,
  MessageSquare,
  Loader2,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Copy,
  Forward,
  Plus,
  Terminal,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import type { ChatMessage, ToolResult } from '../../types';

interface MessageReaction {
  emoji: string;
  users: { user_id: number; user_name: string }[];
  hasMyReaction: boolean;
}

interface AgentStepsBubbleProps {
  messages: ChatMessage[];
  agentName?: string;
  isProcessing?: boolean;
  markdownEnabled?: boolean;
  reactions?: Record<string, { user_id: number; user_name: string }[]>;
  quickEmojis?: string[];
  currentUserId?: number;
  onReact?: (messageId: number, emoji: string) => void;
  onCopy?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  onOpenTerminal?: (sessionId?: number) => void;
}

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

const TOOL_RESULT_TRUNCATE_LENGTH = 500;

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/** Insert zero-width spaces after / and around | so long paths/commands can wrap */
function softBreakText(text: string): string {
  return text.replace(/\//g, '/\u200B').replace(/\|/g, '\u200B|\u200B');
}

// Shared utility — extracted to avoid duplication with ChatTurn
import { parseToolName } from '../../../../utils/parseToolName';

function parseToolArgs(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content);
    if (parsed.args) return parsed.args as Record<string, unknown>;
    if (parsed.input) return parsed.input as Record<string, unknown>;
  } catch {
    // Not JSON
  }
  return undefined;
}

function parseToolResult(content: string): { result: unknown; success: boolean } {
  try {
    const parsed = JSON.parse(content);
    const success = parsed.error ? false : true;
    return { result: parsed.result ?? parsed, success };
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

// ---------------------------------------------------------------------------
// Sub-component: ToolGroupInline — shows a group of tool calls with expand
// ---------------------------------------------------------------------------

const TOOL_RESULT_FULL_LENGTH = 5000;

interface ToolGroupInlineProps {
  tools: ToolStep[];
  hasBash: boolean;
  terminalSessionId?: number;
  onOpenTerminal?: (sessionId?: number) => void;
}

const ToolGroupInline: React.FC<ToolGroupInlineProps> = ({
  tools,
  hasBash,
  terminalSessionId,
  onOpenTerminal,
}) => {
  const [exp, setExp] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Record<number, boolean>>({});

  const toggleResult = (idx: number) => {
    setExpandedResults((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div
          onClick={() => setExp(!exp)}
          className="cursor-pointer select-none flex items-center gap-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <Wrench className="w-3.5 h-3.5" />
          <span>Used {tools.length} tool{tools.length !== 1 ? 's' : ''}</span>
          {exp ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>
        {onOpenTerminal && hasBash && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenTerminal(terminalSessionId); }}
            className="flex items-center gap-1 text-[10px] text-green-500 hover:text-green-400 transition-colors"
            title="Open Terminal"
          >
            <Terminal className="w-3 h-3" />
            <span>Terminal</span>
          </button>
        )}
      </div>
      {exp && (
        <div className="space-y-1 mt-2 pl-2 border-l-2 border-[var(--border-secondary)]">
          {tools.map((step, idx) => {
            const isBash = step.toolName === 'Bash';
            const bashCommand = isBash && step.args?.command ? String(step.args.command) : null;
            const isResultExpanded = expandedResults[idx] || false;
            const resultText = step.result !== undefined ? formatResult(step.result) : '';

            let toolDescription = step.toolName;
            if (isBash && bashCommand) toolDescription = `$ ${truncateText(bashCommand, 120)}`;
            else if (step.toolName === 'Read' && step.args?.file_path) toolDescription = `Read: ${String(step.args.file_path)}`;
            else if (step.toolName === 'Edit' && step.args?.file_path) toolDescription = `Edit: ${String(step.args.file_path)}`;
            else if (step.toolName === 'Write' && step.args?.file_path) toolDescription = `Write: ${String(step.args.file_path)}`;
            else if (step.toolName === 'Grep' && step.args?.pattern) toolDescription = `Grep: ${String(step.args.pattern)}`;

            return (
              <div key={`tool-${idx}`} className="py-1">
                <div className="flex items-start gap-2 text-xs min-w-0">
                  {isBash ? (
                    <Terminal className="w-3 h-3 mt-0.5 text-green-500 flex-shrink-0" />
                  ) : (
                    <Wrench className="w-3 h-3 mt-0.5 text-[var(--text-tertiary)] flex-shrink-0" />
                  )}
                  <span className={cn("font-mono min-w-0 break-all", isBash ? "text-green-400" : "text-[var(--text-secondary)]")}>
                    {softBreakText(toolDescription)}
                  </span>
                  {step.success ? (
                    <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                  )}
                </div>
                {resultText && (
                  <div className="mt-1 ml-5">
                    <pre
                      className="p-2 rounded bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-all"
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
                        {isResultExpanded ? '← Свернуть' : 'Показать полностью →'}
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

/**
 * AgentStepsBubble - Renders a group of agent step messages as a single visual card.
 *
 * Thinking blocks shown as full text with purple sidebar.
 * Tool calls grouped in collapsible sections with preview + expand.
 */
export const AgentStepsBubble: React.FC<AgentStepsBubbleProps> = ({
  messages,
  agentName,
  isProcessing = false,
  markdownEnabled = true,
  reactions = {},
  quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🙏'],
  currentUserId,
  onReact,
  onCopy,
  onForward,
  onOpenTerminal,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);

  // Separate messages by type
  const steps: Step[] = [];
  let finalText: ChatMessage | null = null;
  let toolCount = 0;
  let terminalSessionId: number | undefined;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const ct = msg.contentType;

    if (ct === 'thinking') {
      steps.push({ kind: 'thinking', content: msg.content });
    } else if (ct === 'tool_call') {
      toolCount++;
      const toolName = parseToolName(msg.content);
      // Args from content or from toolResults (Claude Code stream-json stores args in toolResults)
      const tr = msg.toolResults as unknown as Record<string, unknown> | undefined;
      const args = parseToolArgs(msg.content) ?? (tr?.args as Record<string, unknown> | undefined);
      // Extract terminal_session_id if present
      if (tr?.terminal_session_id && !terminalSessionId) {
        terminalSessionId = Number(tr.terminal_session_id);
      }

      // Look ahead for a matching tool_result
      let result: unknown = undefined;
      let success = true;
      if (i + 1 < messages.length && messages[i + 1].contentType === 'tool_result') {
        const resultMsg = messages[i + 1];
        const parsed = parseToolResult(resultMsg.content);
        result = parsed.result;
        success = parsed.success;
        i++; // Skip the tool_result message since we paired it
      }

      steps.push({ kind: 'tool', toolName, args, result, success });
    } else if (ct === 'tool_result') {
      // Orphaned tool_result without a preceding tool_call
      toolCount++;
      const parsed = parseToolResult(msg.content);
      steps.push({
        kind: 'tool',
        toolName: 'tool',
        result: parsed.result,
        success: parsed.success,
      });
    } else if (ct === 'text' || !ct) {
      // Text message - could be final answer
      finalText = msg;
    }
  }

  // Also count tools from toolResults array on messages (legacy format)
  const legacyToolResults: ToolResult[] = [];
  for (const msg of messages) {
    if (msg.toolResults && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        legacyToolResults.push(tr);
      }
    }
  }

  if (legacyToolResults.length > 0 && toolCount === 0) {
    toolCount = legacyToolResults.length;
    for (const tr of legacyToolResults) {
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

  const totalToolCount = toolCount || legacyToolResults.length;

  const toggle = () => setExpanded(!expanded);

  // Use the final text message ID for reactions, or the last message ID
  const reactableMessage = finalText || messages[messages.length - 1];
  const reactableMessageId = reactableMessage?.id ? Number(reactableMessage.id) : null;

  // Process reactions
  const reactionList: MessageReaction[] = Object.entries(reactions).map(([emoji, users]) => ({
    emoji,
    users,
    hasMyReaction: users.some(u => u.user_id === currentUserId)
  }));

  const handleReact = (emoji: string) => {
    if (onReact && reactableMessageId) {
      onReact(reactableMessageId, emoji);
    }
    setShowReactionPicker(false);
  };

  // Format timestamp
  const messageTime = (reactableMessage as unknown as { created_at?: string })?.created_at || reactableMessage?.timestamp;
  const formatTime = (timestamp: Date | string | undefined) => {
    if (!timestamp) return '';
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isThisYear = date.getFullYear() === now.getFullYear();
    const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    if (isThisYear) return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} ${time}`;
    return `${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
  };

  return (
    <div
      className="flex justify-start group relative"
      onMouseLeave={() => { setShowReactionPicker(false); setShowContextMenu(false); }}
    >
      <div className="flex flex-col gap-1 max-w-[85%]">
        <div className="relative">
          {/* Context Menu Button (three dots) */}
          <button
            onClick={() => setShowContextMenu(!showContextMenu)}
            className={cn(
              'absolute top-1 right-0 translate-x-8 z-10 w-6 h-6 rounded-full flex items-center justify-center',
              'bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
              'opacity-0 group-hover:opacity-100 transition-opacity shadow-sm'
            )}
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          {/* Context Menu Dropdown */}
          {showContextMenu && (
            <div className="absolute top-0 right-0 translate-x-[40px] z-50 min-w-[140px] py-1 rounded-lg bg-[var(--bg-secondary)] shadow-lg border border-[var(--border-primary)]">
              <button
                onClick={() => {
                  if (finalText) onCopy?.(finalText);
                  setShowContextMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Copy className="w-4 h-4" />
                Копировать
              </button>
              <button
                onClick={() => {
                  if (finalText) onForward?.(finalText);
                  setShowContextMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <Forward className="w-4 h-4" />
                Переслать
              </button>
            </div>
          )}

          <div
            className={cn(
              'rounded-2xl px-4 py-3',
              'bg-[var(--bg-secondary)] border border-[var(--border-secondary)]'
            )}
          >
            {/* Agent header */}
            {agentName && (
              <div className="flex items-center gap-2 mb-2 text-xs font-medium text-[var(--text-secondary)]">
                <Brain className="w-3.5 h-3.5" />
                <span>{agentName}</span>
                {isProcessing && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-tertiary)]" />
                )}
              </div>
            )}

            {/* Steps: thinking blocks shown as text, tool calls grouped in accordions */}
            {steps.length > 0 && (() => {
              // Group steps into sections: consecutive tools → ToolGroup, thinking → ThinkingBlock
              type SectionT = { kind: 'thinking'; content: string } | { kind: 'tool_group'; tools: ToolStep[] };
              const sections: SectionT[] = [];
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

              return (
                <div className="mb-2 space-y-2">
                  {sections.map((section, sIdx) => {
                    if (section.kind === 'thinking') {
                      return (
                        <div key={`s-think-${sIdx}`} className="pl-3 border-l-2 border-purple-500/30">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Brain className="w-3.5 h-3.5 text-purple-400" />
                            <span className="text-[10px] font-medium text-purple-400 uppercase tracking-wide">Reasoning</span>
                          </div>
                          <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">
                            {section.content}
                          </div>
                        </div>
                      );
                    }

                    // Tool group
                    const toolGroup = section.tools;
                    const hasBash = toolGroup.some(t => t.toolName === 'Bash');
                    return (
                      <ToolGroupInline
                        key={`s-tools-${sIdx}`}
                        tools={toolGroup}
                        hasBash={hasBash}
                        terminalSessionId={terminalSessionId}
                        onOpenTerminal={onOpenTerminal}
                      />
                    );
                  })}
                </div>
              );
            })()}

            {/* Final text answer (always shown) */}
            {finalText && finalText.content && (
              <div className="text-sm text-[var(--text-primary)]">
                {markdownEnabled ? (
                  <MarkdownPreview content={finalText.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{finalText.content}</p>
                )}
              </div>
            )}

            {/* Processing indicator when no final text yet */}
            {isProcessing && !finalText && (
              <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Processing...</span>
              </div>
            )}
          </div>
        </div>

        {/* Timestamp + Reactions row */}
        <div className="flex items-center gap-2 px-1 text-[10px] text-[var(--text-tertiary)]">
          <span>{formatTime(messageTime)}</span>

          {onReact && reactableMessageId && (
            <div
              className="relative flex items-center gap-1"
              onMouseEnter={() => setShowReactionPicker(true)}
              onMouseLeave={() => setShowReactionPicker(false)}
            >
              {/* Plus button for mobile */}
              <button
                onClick={() => setShowReactionPicker(!showReactionPicker)}
                className="md:hidden w-5 h-5 rounded-full flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Добавить реакцию"
              >
                <Plus className="w-3 h-3" />
              </button>

              {/* Heart reaction button */}
              <button
                onClick={() => handleReact('❤️')}
                className={cn(
                  'flex items-center gap-0.5 transition-colors',
                  reactionList.some(r => r.emoji === '❤️' && r.hasMyReaction)
                    ? 'text-red-500'
                    : 'text-[var(--text-tertiary)] hover:text-red-400'
                )}
                title={reactionList.find(r => r.emoji === '❤️')?.users.map(u => u.user_name).join(', ') || 'Нравится'}
              >
                {reactionList.some(r => r.emoji === '❤️') ? '❤️' : '🤍'}
                {reactionList.find(r => r.emoji === '❤️')?.users.length ? (
                  <span className="text-[10px]">{reactionList.find(r => r.emoji === '❤️')?.users.length}</span>
                ) : null}
              </button>

              {/* Other reactions */}
              {reactionList.filter(r => r.emoji !== '❤️').length > 0 && (
                <div className="flex items-center gap-0.5 ml-1">
                  {reactionList.filter(r => r.emoji !== '❤️').slice(0, 3).map(({ emoji, users, hasMyReaction }) => (
                    <button
                      key={emoji}
                      onClick={() => handleReact(emoji)}
                      className={cn(
                        'flex items-center transition-colors',
                        hasMyReaction ? 'opacity-100' : 'opacity-70 hover:opacity-100'
                      )}
                      title={users.map(u => u.user_name).join(', ')}
                    >
                      <span className="text-xs">{emoji}</span>
                      <span className="text-[10px] text-[var(--text-tertiary)]">{users.length}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Hover picker */}
              {showReactionPicker && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 left-full ml-1 z-50 flex gap-0.5 p-1 rounded-full bg-[var(--bg-secondary)] shadow-lg"
                >
                  {quickEmojis.filter(e => e !== '❤️').map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => handleReact(emoji)}
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center text-sm transition-transform hover:scale-125',
                        reactionList.some(r => r.emoji === emoji && r.hasMyReaction) && 'bg-[var(--bg-tertiary)]'
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

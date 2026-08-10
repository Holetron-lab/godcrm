import React, { useState, useCallback } from 'react';
import {
  Ban,
  Key,
  ExternalLink,
  Wrench,
  Zap,
  Loader2,
  ChevronRight,
} from 'lucide-react';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import type { ChatMessage, ToolResult } from '../../../types';
import { ChatAttachmentRenderer } from '../ChatAttachmentRenderer';
import { HighlightedText } from '../../../../HighlightedText';
import type { ApprovalStatus } from '../ToolApprovalBubble';
import type { PlanTask } from '../PlanWidget';
import type { Step, TurnBodyProps } from './types';
import { parseToolName, parseToolArgs, parseToolResult, formatResult } from './helpers';
import { ToolStepsAccordion } from './ToolStepsAccordion';

export const TurnBody: React.FC<TurnBodyProps> = ({
  messages,
  turnType,
  markdownEnabled,
  isProcessing,
  onCheckboxClick,
  currentUser,
  onOpenTerminal,
  onMentionClick,
  conversationId,
  onToolApprove,
  onToolReject,
  fetchToolSteps,
}) => {
  // --- Human turn: one or more consecutive messages from the same sender ---
  if (turnType === 'human') {
    if (messages.length === 0) return null;

    const renderHumanMessage = (message: ChatMessage, idx: number) => {
      // Deleted placeholder
      if (message.is_deleted) {
        return (
          <div key={message.id || idx} className="flex items-center gap-2 text-sm italic text-[var(--text-tertiary)]">
            <Ban className="w-4 h-4" />
            <span>Сообщение удалено</span>
          </div>
        );
      }

      return (
        <div key={message.id || idx}>
          {/* Text content */}
          {message.content ? (
            message.content.includes('No API key configured') ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 text-red-400">
                  <Key className="w-4 h-4" />
                  <span className="text-sm">API ключ не настроен</span>
                </div>
                <a
                  href="/tables/232"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg text-xs font-medium transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  Открыть таблицу API Keys
                </a>
              </div>
            ) : (
              <div className="text-sm whitespace-pre-wrap text-[var(--text-primary)]">
                <HighlightedText
                  text={message.content}
                  onMentionClick={onMentionClick}
                />
              </div>
            )
          ) : (
            <span className="text-sm opacity-50">—</span>
          )}

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <ChatAttachmentRenderer attachments={message.attachments} className="mt-1" />
          )}
        </div>
      );
    };

    return (
      <div className="space-y-1.5">
        {messages.map((msg, idx) => renderHumanMessage(msg, idx))}
      </div>
    );
  }

  // --- Agent turn: potentially multiple messages with tool steps ---
  // Lazy loading state for hidden tool steps
  const [lazySteps, setLazySteps] = useState<Step[]>([]);
  const [lazyToolCount, setLazyToolCount] = useState(0);
  const [lazyTerminalSessionId, setLazyTerminalSessionId] = useState<number | undefined>();
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [toolsLoaded, setToolsLoaded] = useState(false);

  // Calculate hidden tool step count from message annotations
  const hiddenToolSteps = messages.reduce((sum, m) => sum + (m._tool_steps_before || 0), 0)
    + (messages[messages.length - 1]?._tool_steps_after || 0);

  const handleLoadTools = useCallback(async () => {
    if (!fetchToolSteps || messages.length === 0 || isLoadingTools || toolsLoaded) return;
    setIsLoadingTools(true);
    try {
      // Find the range: from first message ID to last message ID
      const firstId = Number(messages[0].id);
      const lastId = Number(messages[messages.length - 1].id);
      // Fetch tool steps from before the first message to after the last
      const toolMessages = await fetchToolSteps(firstId - 1, lastId + 1);

      // Parse tool messages into steps (same logic as below)
      const loadedSteps: Step[] = [];
      let loadedToolCount = 0;
      let loadedTerminalSession: number | undefined;

      for (let i = 0; i < toolMessages.length; i++) {
        const msg = toolMessages[i];
        const ct = msg.contentType;

        if (ct === 'thinking') {
          loadedSteps.push({ kind: 'thinking', content: msg.content });
        } else if (ct === 'tool_call') {
          loadedToolCount++;
          const toolName = parseToolName(msg.content);
          const tr = msg.toolResults as unknown as Record<string, unknown> | undefined;
          const args = parseToolArgs(msg.content) ?? (tr?.args as Record<string, unknown> | undefined);
          if (tr?.terminal_session_id && !loadedTerminalSession) {
            loadedTerminalSession = Number(tr.terminal_session_id);
          }
          let result: unknown = undefined;
          let success = true;
          if (i + 1 < toolMessages.length && toolMessages[i + 1].contentType === 'tool_result') {
            const resultMsg = toolMessages[i + 1];
            const parsed = parseToolResult(resultMsg.content);
            result = parsed.result;
            success = parsed.success;
            i++;
          }
          loadedSteps.push({ kind: 'tool', toolName, args, result, success });
        } else if (ct === 'tool_result') {
          loadedToolCount++;
          const parsed = parseToolResult(msg.content);
          loadedSteps.push({ kind: 'tool', toolName: 'tool', result: parsed.result, success: parsed.success });
        }
      }

      setLazySteps(loadedSteps);
      setLazyToolCount(loadedToolCount);
      setLazyTerminalSessionId(loadedTerminalSession);
      setToolsLoaded(true);
    } catch (err) {
      console.error('Failed to load tool steps:', err);
    } finally {
      setIsLoadingTools(false);
    }
  }, [fetchToolSteps, messages, isLoadingTools, toolsLoaded]);

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
      const tr = msg.toolResults as unknown as Record<string, unknown> | undefined;
      const args =
        parseToolArgs(msg.content) ??
        (tr?.args as Record<string, unknown> | undefined);

      if (tr?.terminal_session_id && !terminalSessionId) {
        terminalSessionId = Number(tr.terminal_session_id);
      }

      let result: unknown = undefined;
      let success = true;
      if (
        i + 1 < messages.length &&
        messages[i + 1].contentType === 'tool_result'
      ) {
        const resultMsg = messages[i + 1];
        const parsed = parseToolResult(resultMsg.content);
        result = parsed.result;
        success = parsed.success;
        i++; // skip paired tool_result
      }

      steps.push({ kind: 'tool', toolName, args, result, success });
    } else if (ct === 'tool_result') {
      // Orphaned tool_result
      toolCount++;
      const parsed = parseToolResult(msg.content);
      steps.push({
        kind: 'tool',
        toolName: 'tool',
        result: parsed.result,
        success: parsed.success,
      });
    } else if (ct === 'plan') {
      // ADR-113: Plan messages rendered as PlanWidget
      try {
        const planData = JSON.parse(msg.content);
        const planTasks: PlanTask[] = Array.isArray(planData.tasks) ? planData.tasks : [];
        if (planTasks.length > 0) {
          steps.push({ kind: 'plan', tasks: planTasks });
        }
      } catch {
        // Invalid JSON -- skip silently
      }
    } else if (ct === 'tool_approval') {
      // Ticket #74076: Tool approval messages require user action
      const toolData = msg.toolResults
        ? (typeof msg.toolResults === 'string'
            ? JSON.parse(msg.toolResults as unknown as string)
            : msg.toolResults)
        : {} as Record<string, unknown>;
      const metadata = msg.metadata ?? {};
      // toolData may be an array (ToolResult[]) or a single object depending on backend
      const toolObj = Array.isArray(toolData) ? toolData[0] ?? {} : toolData;
      steps.push({
        kind: 'tool_approval' as const,
        toolName: (toolObj as Record<string, unknown>).tool as string || 'unknown',
        args: ((toolObj as Record<string, unknown>).args as Record<string, unknown>) || {},
        messageId: Number(msg.id),
        approvalStatus: (metadata.approval_status as ApprovalStatus) || 'pending',
        timeoutSeconds: (metadata.timeout_seconds as number) || 300,
        approvedBy: metadata.approved_by,
        approvedAt: metadata.approved_at,
      });
    } else if (ct === 'text' || !ct) {
      finalText = msg;
    }
  }

  // Legacy toolResults array
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

  // Check for deleted final text
  if (finalText?.is_deleted) {
    return (
      <>
        {totalToolCount > 0 && (
          <ToolStepsAccordion
            steps={steps}
            totalToolCount={totalToolCount}
            terminalSessionId={terminalSessionId}
            onOpenTerminal={onOpenTerminal}
            conversationId={conversationId}
            onToolApprove={onToolApprove}
            onToolReject={onToolReject}
          />
        )}
        <div className="flex items-center gap-2 text-sm italic text-[var(--text-tertiary)]">
          <Ban className="w-4 h-4" />
          <span>Сообщение удалено</span>
        </div>
      </>
    );
  }

  // Merge inline steps with lazy-loaded steps
  const allSteps = toolsLoaded ? [...lazySteps, ...steps] : steps;
  const allToolCount = toolsLoaded ? lazyToolCount + totalToolCount : totalToolCount;
  const allTerminalSessionId = toolsLoaded ? (lazyTerminalSessionId || terminalSessionId) : terminalSessionId;

  return (
    <>
      {/* Lazy load button for hidden tool steps */}
      {hiddenToolSteps > 0 && !toolsLoaded && (
        <div className="mb-2">
          <button
            onClick={handleLoadTools}
            disabled={isLoadingTools}
            className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          >
            {isLoadingTools ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Wrench className="w-3.5 h-3.5" />
            )}
            <span>
              {isLoadingTools ? 'Loading...' : `Show ${hiddenToolSteps} tool steps`}
            </span>
            {!isLoadingTools && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* Tool steps + thinking + tool_approval + plan sections */}
      {(allToolCount > 0 || allSteps.some(s => s.kind === 'thinking' || s.kind === 'tool_approval' || s.kind === 'plan')) && (
        <ToolStepsAccordion
          steps={allSteps}
          totalToolCount={allToolCount}
          terminalSessionId={allTerminalSessionId}
          onOpenTerminal={onOpenTerminal}
          markdownEnabled={markdownEnabled}
          conversationId={conversationId}
          onToolApprove={onToolApprove}
          onToolReject={onToolReject}
        />
      )}

      {/* Final text answer */}
      {finalText && finalText.content ? (
        <div className="text-sm text-[var(--text-primary)]">
          {finalText.content.includes('No API key configured') ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-red-400">
                <Key className="w-4 h-4" />
                <span className="text-sm">API ключ не настроен</span>
              </div>
              <a
                href="/tables/232"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg text-xs font-medium transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                Открыть таблицу API Keys
              </a>
            </div>
          ) : markdownEnabled ? (
            <MarkdownPreview
              content={finalText.content}
              onCheckboxClick={onCheckboxClick}
              currentUser={currentUser}
            />
          ) : (
            <p className="whitespace-pre-wrap">
              <HighlightedText text={finalText.content} onMentionClick={onMentionClick} />
            </p>
          )}
        </div>
      ) : finalText && !finalText.content && !isProcessing ? (
        /* Bug #74011: Guard against empty agent response -- show placeholder instead of invisible div */
        <div className="text-sm text-[var(--text-tertiary)] italic">
          (No text response)
        </div>
      ) : null}

      {/* Attachments on agent messages (rare but possible) */}
      {finalText?.attachments && finalText.attachments.length > 0 && (
        <ChatAttachmentRenderer attachments={finalText.attachments} />
      )}

      {/* Legacy toolResults on single-message agents (inline, from MessageBubble) */}
      {messages.length === 1 &&
        messages[0].toolResults &&
        messages[0].toolResults.length > 0 &&
        totalToolCount === 0 && (
          <div className="mt-2 pt-2 border-t border-[var(--border-primary)]">
            <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] mb-1">
              <Wrench className="w-3 h-3" />
              <span>
                Использовано {messages[0].toolResults.length} инструментов
              </span>
              {messages[0].iterations && (
                <span className="ml-1">
                  ({messages[0].iterations} итераций)
                </span>
              )}
            </div>
            <div className="space-y-1">
              {messages[0].toolResults.map(
                (
                  tr: { tool: string; args?: unknown; result?: unknown },
                  idx: number
                ) => (
                  <details key={idx} className="text-xs">
                    <summary className="cursor-pointer hover:text-[var(--color-primary-500)] flex items-center gap-1">
                      <Zap className="w-3 h-3 text-orange-500" />
                      <span className="font-medium">{tr.tool}</span>
                    </summary>
                    <div className="ml-4 mt-1 p-2 bg-[var(--bg-primary)] rounded text-[var(--text-tertiary)] overflow-x-auto">
                      <pre className="text-[10px]">
                        {JSON.stringify(tr.result, null, 2).substring(0, 500)}
                      </pre>
                    </div>
                  </details>
                )
              )}
            </div>
          </div>
        )}

      {/* Streaming / processing indicator -- shows current tool + count */}
      {isProcessing && !finalText && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-primary-500)]" />
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

      {/* Streaming dots for empty AI message (only when actually streaming) */}
      {!isProcessing &&
        !finalText &&
        messages.length === 1 &&
        messages[0].role === 'assistant' &&
        !messages[0].content &&
        messages[0].isStreaming && (
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-2 h-2 rounded-full bg-purple-400 animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        )}
    </>
  );
};

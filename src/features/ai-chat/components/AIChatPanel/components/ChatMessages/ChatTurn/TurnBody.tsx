import React, { useCallback } from 'react';
import {
  Ban,
  Key,
  ExternalLink,
  Wrench,
  Zap,
  Loader2,
  ChevronRight,
  ChevronDown,
  Brain,
  Forward,
  AlertTriangle,
  AtSign,
} from 'lucide-react';
import { MarkdownPreview, type CheckboxClickInfo, type CheckboxUser } from '@/shared/components/MarkdownPreview';
import type { ChatMessage, ToolResult, WidgetEmbedAttachment } from '../../../types';
import { isWidgetEmbedAttachment } from '../../../types';
import { ChatAttachmentRenderer } from '../ChatAttachmentRenderer';
import { ChatEmbeddedWidget } from './ChatEmbeddedWidget';
import { HighlightedText } from '../../../../HighlightedText';
import { parseForwardedMessages } from '../../../../../utils/parseForwardedMessage';
import { ForwardedQuoteBlock } from '../ForwardedQuoteBlock';
import type { ApprovalStatus } from '../ToolApprovalBubble';
import { PlanWidget, type PlanTask } from '../PlanWidget';
import type { Step, StepGroup, TurnBodyProps } from './types';
import { parseToolName, parseToolArgs, parseToolResult, formatResult } from './helpers';
import { ToolStepsAccordion } from './ToolStepsAccordion';
import { useStepGroups } from './useStepGroups';
import { StepGroupsPanel } from './StepGroupsPanel';
import { RowMutationBubbleStack } from './RowMutationBubble';
import { CallBubble } from './CallBubble';

// Small wrapper that stabilizes the checkbox-click handler per message so
// the memoized MarkdownPreview does not re-parse markdown on every render
// of the surrounding turn (which re-runs for streaming tool steps, etc.).
const MessageMarkdown = React.memo<{
  content: string;
  message: ChatMessage;
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  onForward?: (message: ChatMessage) => void;
  currentUser?: CheckboxUser;
  className?: string;
}>(({ content, message, onCheckboxClick, onForward, currentUser, className }) => {
  const handle = useCallback((info: CheckboxClickInfo) => {
    onCheckboxClick?.(info);
    onForward?.(message);
  }, [onCheckboxClick, onForward, message]);

  return (
    <MarkdownPreview
      content={content}
      className={className}
      onCheckboxClick={onCheckboxClick ? handle : undefined}
      currentUser={currentUser}
    />
  );
});

// ADR-0031 WP-20+21: collect every widget_embed attachment from a single
// message. Author-agnostic — same code path for human (future Type A) and
// agent messages.
const extractWidgetEmbeds = (
  message: ChatMessage,
): WidgetEmbedAttachment[] => {
  const atts = message.attachments;
  if (!atts || atts.length === 0) return [];
  return atts.filter(isWidgetEmbedAttachment);
};

// ─── Human Turn ───────────────────────────────────────────────────────────────
const HumanTurnBody: React.FC<TurnBodyProps> = ({
  messages,
  markdownEnabled,
  onMentionClick,
  onForward,
  onCheckboxClick,
  currentUser,
  conversationId,
}) => {
  if (messages.length === 0) return null;

  const renderHumanMessage = (message: ChatMessage, idx: number) => {
    // ADR-0031 §Z / WP-24: source-side moved stubs are now rendered by
    // ChatTurn in the bubble's header zone — skip them here.
    if (message.contentType === 'moved') return null;

    if (message.is_deleted) {
      return (
        <div key={message.id || idx} className="flex items-center gap-2 text-sm italic text-[var(--text-tertiary)]">
          <Ban className="w-4 h-4" />
          <span>Сообщение удалено</span>
        </div>
      );
    }

    return (
      <div key={message.id || idx} data-message-id={message.id} className="group/msg relative">
        {idx > 0 && (
          <div className="flex justify-end pr-1 my-1 group/divider cursor-default">
            <div className="w-8 h-px bg-[var(--border-secondary)]" />
            <span className="absolute right-2 text-[9px] text-[var(--text-tertiary)] opacity-0 group-hover/divider:opacity-100 transition-opacity bg-[var(--bg-secondary)] px-1">
              {((message as any).created_at || message.timestamp) ? new Date(((message as any).created_at || message.timestamp)!).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>
          </div>
        )}
        {onForward && (
          <button onClick={() => onForward(message)} className="absolute right-0 top-0 w-5 h-5 rounded flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/10 transition-all opacity-0 group-hover/msg:opacity-100 z-10" title="Переслать">
            <Forward className="w-3 h-3" />
          </button>
        )}
        {message.content ? (
          message.content.includes('No API key configured') ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-red-400">
                <Key className="w-4 h-4" />
                <span className="text-sm">API ключ не настроен</span>
              </div>
              <a href="/tables/232" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg text-xs font-medium transition-colors">
                <ExternalLink className="w-3 h-3" />
                Открыть таблицу API Keys
              </a>
            </div>
          ) : (() => {
            const forwarded = parseForwardedMessages(message.content);
            if (forwarded.length > 0) {
              // Extract user text after forwarded blocks
              const lines = message.content.split('\n');
              let lastQuoteLine = -1;
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('>') || lines[i].trim() === '') {
                  lastQuoteLine = i;
                } else if (lastQuoteLine >= 0) break;
              }
              const userText = lastQuoteLine >= 0 ? lines.slice(lastQuoteLine + 1).join('\n').trim() : '';
              return (
                <div className="space-y-1">
                  {forwarded.map((fw, i) => (
                    <ForwardedQuoteBlock
                      key={i}
                      senderName={fw.senderName}
                      timestamp={fw.timestamp}
                      content={fw.content}
                      chatId={fw.conversationId || undefined}
                      messageId={fw.messageId || undefined}
                      agentColor={fw.agentColor || undefined}
                      currentConversationId={conversationId}
                    />
                  ))}
                  {userText && (
                    markdownEnabled ? (
                      <div className="text-sm text-[var(--text-primary)] prose-sm break-words mt-1">
                        <MessageMarkdown content={userText} message={message} onCheckboxClick={onCheckboxClick} onForward={onForward} currentUser={currentUser} />
                      </div>
                    ) : (
                      <div className="text-sm whitespace-pre-wrap break-words text-[var(--text-primary)] mt-1">
                        <HighlightedText text={userText} onMentionClick={onMentionClick} />
                      </div>
                    )
                  )}
                </div>
              );
            }
            return markdownEnabled ? (
              <div className="text-sm text-[var(--text-primary)] prose-sm break-words">
                <MessageMarkdown content={message.content} message={message} onCheckboxClick={onCheckboxClick} onForward={onForward} currentUser={currentUser} />
              </div>
            ) : (
              <div className="text-sm whitespace-pre-wrap break-words text-[var(--text-primary)]">
                <HighlightedText text={message.content} onMentionClick={onMentionClick} />
              </div>
            );
          })()
        ) : (
          <span className="text-sm opacity-50">—</span>
        )}
        {(() => {
          // ADR-0031 WP-20+21: split attachments → widget embeds (rendered as
          // full-width inline live widgets) vs. everything else (rendered via
          // the standard ChatAttachmentRenderer chip/preview list). Text
          // already rendered above; widgets/files come below.
          const atts = message.attachments;
          if (!atts || atts.length === 0) return null;
          const embeds = extractWidgetEmbeds(message);
          const rest = atts.filter(a => !isWidgetEmbedAttachment(a));
          return (
            <>
              {rest.length > 0 && (
                <ChatAttachmentRenderer attachments={rest} className="mt-1" />
              )}
              {embeds.map((att, i) => (
                <ChatEmbeddedWidget key={`embed-${i}`} widgetEmbed={att.widgetEmbed} />
              ))}
            </>
          );
        })()}
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      {messages.map((msg, idx) => renderHumanMessage(msg, idx))}
    </div>
  );
};

// ─── Agent Turn ───────────────────────────────────────────────────────────────
const AgentTurnBody: React.FC<TurnBodyProps> = ({
  messages,
  turnType,
  markdownEnabled,
  isProcessing,
  hasMoreSegments,
  invokedAgents,
  onCheckboxClick,
  currentUser,
  onOpenTerminal,
  onMentionClick,
  onForward,
  conversationId,
  onToolApprove,
  onToolReject,
  fetchThinkingSteps,
  fetchToolStepsPreview,
  fetchFullMessage,
  fetchToolSteps,
  onContinueAgent,
}) => {
  const sg = useStepGroups(messages, {
    isProcessing: !!isProcessing,
    isLastTurn: !hasMoreSegments,
    fetchThinkingSteps,
    fetchToolStepsPreview,
    fetchToolSteps,
  });

  // ADR-0031 P2: pull row-mutation system events out of the agent step pipeline
  // so they render as their own pill stack above the agent content.
  const mutationMessages = messages.filter(m => m.contentType === 'row_mutation');

  // Parse inline messages into steps
  const steps: Step[] = [];
  let finalText: ChatMessage | null = null;
  let toolCount = 0;
  let terminalSessionId: number | undefined;
  let agentStatusMessage: ChatMessage | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const ct = msg.contentType;

    if (ct === 'row_mutation' || ct === 'moved') {
      continue; // handled separately below
    }

    if (ct === 'thinking') {
      steps.push({ kind: 'thinking', content: msg.content });
    } else if (ct === 'tool_call') {
      toolCount++;
      const toolName = parseToolName(msg.content);
      const tr = msg.toolResults as unknown as Record<string, unknown> | undefined;
      const args = parseToolArgs(msg.content) ?? (tr?.args as Record<string, unknown> | undefined);
      if (tr?.terminal_session_id && !terminalSessionId) terminalSessionId = Number(tr.terminal_session_id);
      let result: unknown = undefined;
      let success = true;
      let resultMessageId: number | undefined;
      if (i + 1 < messages.length && messages[i + 1].contentType === 'tool_result') {
        const resultMsg = messages[i + 1];
        const parsed = parseToolResult(resultMsg.content);
        result = parsed.result;
        success = parsed.success;
        resultMessageId = Number(resultMsg.id);
        i++;
      }
      steps.push({ kind: 'tool', toolName, args, result, success, resultMessageId });
    } else if (ct === 'tool_result') {
      toolCount++;
      const parsed = parseToolResult(msg.content);
      steps.push({ kind: 'tool', toolName: 'tool', result: parsed.result, success: parsed.success, resultMessageId: Number(msg.id) });
    } else if (ct === 'plan') {
      try {
        const planData = JSON.parse(msg.content);
        const planTasks: PlanTask[] = Array.isArray(planData.tasks) ? planData.tasks : [];
        if (planTasks.length > 0) steps.push({ kind: 'plan', tasks: planTasks });
      } catch { /* skip */ }
    } else if (ct === 'tool_approval') {
      const toolData = msg.toolResults
        ? (typeof msg.toolResults === 'string' ? JSON.parse(msg.toolResults as unknown as string) : msg.toolResults)
        : {} as Record<string, unknown>;
      const metadata = msg.metadata ?? {};
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
    } else if (ct === 'agent_status') {
      const meta = msg.metadata || {};
      if (meta.placeholder !== false) agentStatusMessage = msg;
      // Extract terminal_session_id from agent_status metadata (set by backend status.js)
      if ((meta as Record<string, unknown>).terminal_session_id && !terminalSessionId) {
        terminalSessionId = Number((meta as Record<string, unknown>).terminal_session_id);
      }
    } else if (ct === 'text' || !ct || ct === 'widget_embed') {
      // ADR-0031 WP-20+21 (T-141238): treat 'widget_embed' messages as the
      // final text-bearing message of the turn — the embed itself rides on
      // attachments[] (split downstream into <ChatEmbeddedWidget>) while any
      // accompanying prose lives in `content`. Without this branch the
      // message payload would be silently dropped.
      finalText = msg;
    }
  }

  // Legacy toolResults
  const legacyToolResults: ToolResult[] = [];
  for (const msg of messages) {
    if (msg.toolResults && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) legacyToolResults.push(tr);
    }
  }
  if (legacyToolResults.length > 0 && toolCount === 0) {
    toolCount = legacyToolResults.length;
    for (const tr of legacyToolResults) {
      const resultStr = formatResult(tr.result);
      steps.push({ kind: 'tool', toolName: tr.tool, args: tr.args, result: tr.result, success: !resultStr.toLowerCase().includes('error') });
    }
  }

  const totalToolCount = toolCount || legacyToolResults.length;

  if (finalText?.is_deleted) {
    return (
      <>
        {totalToolCount > 0 && (
          <ToolStepsAccordion steps={steps} totalToolCount={totalToolCount} terminalSessionId={terminalSessionId} onOpenTerminal={onOpenTerminal} conversationId={conversationId} onToolApprove={onToolApprove} onToolReject={onToolReject} />
        )}
        <div className="flex items-center gap-2 text-sm italic text-[var(--text-tertiary)]">
          <Ban className="w-4 h-4" /><span>Сообщение удалено</span>
        </div>
      </>
    );
  }

  const inlineSpecialSteps = steps.filter(s => s.kind === 'tool_approval');
  const hasInlineSpecialSteps = inlineSpecialSteps.length > 0;

  // Extract latest plan for always-visible rendering above stop button
  const latestPlanTasks: PlanTask[] = (() => {
    const planSteps = steps.filter(s => s.kind === 'plan' && s.tasks);
    if (planSteps.length === 0) return [];
    return planSteps[planSteps.length - 1].tasks!;
  })();
  const hasInlineToolSteps = totalToolCount > 0;
  const shouldRenderInlineSteps = hasInlineToolSteps;

  const lastThinkingContent = (() => {
    const thinkingSteps = steps.filter(s => s.kind === 'thinking');
    if (thinkingSteps.length > 0) {
      const content = thinkingSteps[thinkingSteps.length - 1].content;
      if (content && content !== 'NaN' && content !== 'undefined' && content !== 'null') return content;
    }
    // Fallback: use last thinking preview from step groups
    const thinkingGroups = sg.allStepGroups.filter(g => g.type === 'thinking' && g.preview);
    if (thinkingGroups.length > 0) {
      const preview = thinkingGroups[thinkingGroups.length - 1].preview;
      if (preview && preview !== 'NaN' && preview !== 'undefined' && preview !== 'null') return preview;
    }
    if (agentStatusMessage?.metadata?.agent_action) {
      const action = String(agentStatusMessage.metadata.agent_action);
      if (action && action !== 'NaN' && action !== 'undefined' && action !== 'null') return action;
    }
    return null;
  })();

  const lastToolName = (() => {
    const toolSteps = steps.filter(s => s.kind === 'tool');
    if (toolSteps.length > 0) return toolSteps[toolSteps.length - 1].toolName;
    return null;
  })();

  const stepCount = totalToolCount || toolCount || sg.allStepGroups.reduce((s, g) => s + g.count, 0) || steps.length;
  const hasAnySteps = stepCount > 0 || sg.allStepGroups.length > 0;
  const isInterrupted = hasMoreSegments && !isProcessing && turnType === 'agent';
  // Detect incomplete turn: agent did work but stopped without final text and no continuation
  const isIncomplete = !hasMoreSegments && !isProcessing && turnType === 'agent' && !finalText && hasAnySteps;

  // Stale detection for processing bubbles: if last message is >10 min old, agent might be stalled
  // (10 min threshold — Claude Code can think/edit for 5-8 min without intermediate messages)
  const [stalledMinutes, setStalledMinutes] = React.useState(0);
  React.useEffect(() => {
    if (!isProcessing || !hasAnySteps) { setStalledMinutes(0); return; }
    const lastMsg = messages[messages.length - 1];
    const lastTime = lastMsg?.createdAt ? new Date(lastMsg.createdAt).getTime() : 0;
    if (!lastTime) { setStalledMinutes(0); return; }
    const check = () => {
      const mins = Math.floor((Date.now() - lastTime) / 60000);
      setStalledMinutes(mins >= 10 ? mins : 0);
    };
    check();
    const interval = setInterval(check, 30000); // re-check every 30s
    return () => clearInterval(interval);
  }, [isProcessing, hasAnySteps, messages]);

  const toolsAfterLastThinking = (() => {
    if (isProcessing || !hasAnySteps) return [] as { toolName: string; success: boolean }[];
    const thinkingIdxs = steps.map((s, i) => s.kind === 'thinking' ? i : -1).filter(i => i >= 0);
    const afterSteps = thinkingIdxs.length === 0
      ? steps.filter(s => s.kind === 'tool')
      : steps.slice(thinkingIdxs[thinkingIdxs.length - 1] + 1).filter(s => s.kind === 'tool');
    return afterSteps.map(s => ({ toolName: (s as ToolStep).toolName, success: (s as ToolStep).success }));
  })();
  const toolStepsAfterLastThinking = toolsAfterLastThinking.length;

  return (
    <>
      {/* ADR-0031 P2: row-mutation system events render above agent content */}
      {mutationMessages.length > 0 && (
        <RowMutationBubbleStack messages={mutationMessages} />
      )}

      {isProcessing && turnType === 'agent' && !hasAnySteps && !finalText && (
        <div className="flex items-center gap-2 py-2 text-xs text-[var(--text-tertiary)]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--color-primary-500)]" />
          <span>Агент запускается...</span>
        </div>
      )}

      {/* Steps header — unified for both processing and completed */}
      {turnType === 'agent' && hasAnySteps && (
        <div className="mb-2">
          {(() => {
            const collapsedPreview = !sg.masterExpanded
              ? sg.allStepGroups.filter(g => g.type === 'thinking' && g.preview).map(g => g.preview!).join(' ').slice(0, 150)
                || (lastThinkingContent ? lastThinkingContent.slice(0, 150) : '')
              : '';
            return (
              <button onClick={() => sg.setMasterExpanded(prev => !prev)} className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer max-w-full">
                {sg.masterExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
                <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                <span className="flex-shrink-0">{stepCount} шагов</span>
                {isProcessing && !stalledMinutes && <Loader2 className="w-3 h-3 animate-spin text-[var(--color-primary-500)] flex-shrink-0" />}
                {isProcessing && stalledMinutes > 0 && <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                {isProcessing && stalledMinutes > 0 && <span className="text-amber-400 flex-shrink-0">без активности {stalledMinutes} мин</span>}
                {collapsedPreview && <span className="truncate opacity-60 text-[11px] ml-1">— {collapsedPreview}</span>}
              </button>
            );
          })()}

        </div>
      )}

      {sg.allStepGroups.length > 0 && sg.masterExpanded && (
        <div className="mb-2">
          <StepGroupsPanel
            allStepGroups={sg.allStepGroups}
            masterExpanded={sg.masterExpanded}
            expandedGroups={sg.expandedGroups}
            loadingGroups={sg.loadingGroups}
            loadedGroupSteps={sg.loadedGroupSteps}
            loadedGroupToolCounts={sg.loadedGroupToolCounts}
            loadedGroupTerminals={sg.loadedGroupTerminals}
            reasoningExpanded={sg.reasoningExpanded}
            collapsedToolGroups={sg.collapsedToolGroups}
            onLoadGroup={sg.handleLoadGroup}
            onToggleReasoning={(idx, expanded) => sg.setReasoningExpanded(prev => ({ ...prev, [idx]: expanded }))}
            onToggleToolGroup={(idx) => sg.setCollapsedToolGroups(prev => ({ ...prev, [idx]: !prev[idx] }))}
            onOpenTerminal={onOpenTerminal}
            markdownEnabled={markdownEnabled}
            conversationId={conversationId}
            onToolApprove={onToolApprove}
            onToolReject={onToolReject}
            fetchFullMessage={fetchFullMessage}
          />
        </div>
      )}

      {hasInlineSpecialSteps && (
        <ToolStepsAccordion steps={inlineSpecialSteps} totalToolCount={0} onOpenTerminal={onOpenTerminal} markdownEnabled={markdownEnabled} conversationId={conversationId} onToolApprove={onToolApprove} onToolReject={onToolReject} fetchFullMessage={fetchFullMessage} />
      )}

      {/* Inline steps — only when NO step groups exist (avoid duplication with StepGroupsPanel) */}
      {(shouldRenderInlineSteps || steps.some(s => s.kind === 'thinking')) && sg.allStepGroups.length === 0 && sg.masterExpanded && (
        <>
          <ToolStepsAccordion steps={steps} totalToolCount={totalToolCount} terminalSessionId={terminalSessionId} onOpenTerminal={onOpenTerminal} markdownEnabled={markdownEnabled} conversationId={conversationId} onToolApprove={onToolApprove} onToolReject={onToolReject} fetchFullMessage={fetchFullMessage} />
          {isProcessing && lastToolName && !steps.some(s => s.kind === 'tool' && s.toolName === lastToolName && s.result !== undefined) && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] mt-1.5 pl-2">
              <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{lastToolName}</span>
              <Loader2 className="w-3 h-3 animate-spin" />
            </div>
          )}
        </>
      )}

      {finalText && finalText.content ? (
        <div data-message-id={finalText.id} className="text-sm text-[var(--text-primary)] break-words">
          {finalText.content.includes('No API key configured') ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-red-400"><Key className="w-4 h-4" /><span className="text-sm">API ключ не настроен</span></div>
              <a href="/tables/232" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 rounded-lg text-xs font-medium transition-colors"><ExternalLink className="w-3 h-3" />Открыть таблицу API Keys</a>
            </div>
          ) : markdownEnabled ? (
            <MessageMarkdown content={finalText.content} message={finalText} onCheckboxClick={onCheckboxClick} onForward={onForward} currentUser={currentUser} />
          ) : (
            <p className="whitespace-pre-wrap break-words"><HighlightedText text={finalText.content} onMentionClick={onMentionClick} /></p>
          )}
        </div>
      ) : finalText && !finalText.content && !isProcessing && !(finalText.attachments?.some(isWidgetEmbedAttachment)) ? (
        // ADR-0031 WP-20+21 (T-141238): suppress "no text response" when the
        // message intentionally carries only a widget_embed attachment.
        <div className="text-sm text-[var(--text-tertiary)] italic">(No text response)</div>
      ) : null}

      {(() => {
        // ADR-0031 WP-20+21: split attachments → widget embeds vs. rest.
        // Agents typically attach the widget to the final text message but we
        // also pick up embeds from sibling messages (e.g. the embed travels
        // as its own message after the text). Order in the bubble: text
        // above, then file/row chips, then live widgets at the bottom.
        const allEmbeds: WidgetEmbedAttachment[] = [];
        for (const m of messages) {
          if (m.contentType === 'row_mutation' || m.contentType === 'moved') continue;
          allEmbeds.push(...extractWidgetEmbeds(m));
        }
        const finalAtts = finalText?.attachments || [];
        const finalRest = finalAtts.filter(a => !isWidgetEmbedAttachment(a));
        return (
          <>
            {finalRest.length > 0 && (
              <ChatAttachmentRenderer attachments={finalRest} />
            )}
            {allEmbeds.map((att, i) => (
              <ChatEmbeddedWidget key={`agent-embed-${i}`} widgetEmbed={att.widgetEmbed} />
            ))}
          </>
        );
      })()}

      {messages.length === 1 && messages[0].toolResults && messages[0].toolResults.length > 0 && totalToolCount === 0 && (
        <div className="mt-2 pt-2 border-t border-[var(--border-primary)]">
          <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] mb-1">
            <Wrench className="w-3 h-3" />
            <span>Использовано {messages[0].toolResults.length} инструментов</span>
            {messages[0].iterations && <span className="ml-1">({messages[0].iterations} итераций)</span>}
          </div>
          <div className="space-y-1">
            {messages[0].toolResults.map((tr: { tool: string; args?: unknown; result?: unknown }, idx: number) => (
              <details key={idx} className="text-xs">
                <summary className="cursor-pointer hover:text-[var(--color-primary-500)] flex items-center gap-1">
                  <Zap className="w-3 h-3 text-orange-500" /><span className="font-medium">{tr.tool}</span>
                </summary>
                <div className="ml-4 mt-1 p-2 bg-[var(--bg-primary)] rounded text-[var(--text-tertiary)] overflow-x-auto">
                  <pre className="text-[10px]">{JSON.stringify(tr.result, null, 2).substring(0, 500)}</pre>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* Plan widget — only show when steps are collapsed (inside accordion when expanded) */}
      {latestPlanTasks.length > 0 && !sg.masterExpanded && (
        <div className="mt-2">
          <PlanWidget tasks={latestPlanTasks} />
        </div>
      )}

      {/* WP-5: Agent invocation banner — shown when thinking contains <<@slug>> */}
      {invokedAgents && invokedAgents.length > 0 && (
        <div className="mt-2 pt-2 border-t border-dashed border-blue-500/30">
          <div className="flex items-center gap-2 text-xs">
            <AtSign className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
            <span className="text-blue-400">
              Вызов: {invokedAgents.map((slug: string) => (
                <span key={slug} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-medium ml-1">
                  @{slug}
                </span>
              ))}
            </span>
          </div>
        </div>
      )}

      {/* Interrupted turn: show last reasoning as plain text + tool count (no Continue button here — it's in TurnFooter) */}
      {isInterrupted && !sg.masterExpanded && !finalText && (lastThinkingContent || toolStepsAfterLastThinking > 0) && (
        <div className="mt-1.5">
          {lastThinkingContent && (
            <div className="mb-1 text-[13px] text-[var(--text-tertiary)] leading-relaxed">
              <p className="whitespace-pre-wrap">{lastThinkingContent.length > 800 ? lastThinkingContent.slice(0, 800) + '...' : lastThinkingContent}</p>
            </div>
          )}
          {toolsAfterLastThinking.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] mt-1">
              <Wrench className="w-3 h-3 opacity-50" />
              <span>+{toolsAfterLastThinking.length} инструментов после reasoning</span>
            </div>
          )}
        </div>
      )}

      {/* Incomplete turn: agent stopped without final response */}
      {isIncomplete && (
        <div className="mt-2 pt-2 border-t border-dashed border-amber-500/30">
          {/* Last reasoning shown as visible text */}
          {lastThinkingContent && (
            <div className="mb-1.5 flex items-start gap-1.5">
              <Brain className="w-3.5 h-3.5 text-purple-400/60 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] leading-relaxed text-[var(--text-tertiary)] whitespace-pre-wrap">{lastThinkingContent.length > 500 ? lastThinkingContent.slice(0, 500) + '...' : lastThinkingContent}</p>
            </div>
          )}
        </div>
      )}

      {!isProcessing && !finalText && messages.length === 1 && messages[0].role === 'assistant' && !messages[0].content && messages[0].isStreaming && (
        <div className="flex items-center gap-1.5">
          {[0, 150, 300].map(d => <span key={d} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
        </div>
      )}
    </>
  );
};

// ─── Main Export ──────────────────────────────────────────────────────────────
export const TurnBody: React.FC<TurnBodyProps> = React.memo((props) => {
  // ADR-0031 P2: turn composed entirely of row-mutation system events renders
  // as a stack of compact pills, no agent chrome around it. Checked BEFORE the
  // turnType branch so that system-event turns (now turnType='human' so the
  // header carries the actor's avatar) still render the pill stack instead of
  // falling through to HumanTurnBody.
  if (
    props.messages.length > 0 &&
    props.messages.every(m => m.contentType === 'row_mutation')
  ) {
    return <RowMutationBubbleStack messages={props.messages} />;
  }
  // ADR-0059 §4.8: a turn composed entirely of call-transcript messages renders
  // as a stack of CallBubble cards, skipping the normal agent chrome.
  if (
    props.messages.length > 0 &&
    props.messages.every(m => m.contentType === 'call')
  ) {
    return (
      <div className="space-y-2">
        {props.messages.map((m, i) => (
          <CallBubble key={m.id || i} message={m} />
        ))}
      </div>
    );
  }
  if (props.turnType === 'human') return <HumanTurnBody {...props} />;
  // ADR-0031 §Z / WP-24: turns composed entirely of moved-stub messages are
  // handled by ChatTurn (cards in header zone, optional preview in body) — no
  // body content for TurnBody to render.
  if (
    props.messages.length > 0 &&
    props.messages.every(m => m.contentType === 'moved')
  ) {
    return null;
  }
  return <AgentTurnBody {...props} />;
});

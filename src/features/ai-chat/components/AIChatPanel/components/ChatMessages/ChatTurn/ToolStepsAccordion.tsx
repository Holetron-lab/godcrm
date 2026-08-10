import React, { useState, useCallback } from 'react';
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  Brain,
  CheckCircle2,
  XCircle,
  Terminal,
  Loader2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ToolApprovalBubble } from '../ToolApprovalBubble';
import { PlanWidget } from '../PlanWidget';
import type {
  ToolGroupAccordionProps,
  ThinkingBlockProps,
  ToolStepsAccordionProps,
} from './types';
import {
  truncateText,
  softBreakText,
  formatResult,
  groupStepsIntoSections,
  TOOL_RESULT_FULL_LENGTH,
} from './helpers';

// ---------------------------------------------------------------------------
// Sub-component: ToolGroupAccordion -- shows a group of consecutive tool calls
// ---------------------------------------------------------------------------

const ToolGroupAccordion: React.FC<ToolGroupAccordionProps> = ({
  tools,
  terminalSessionId,
  onOpenTerminal,
  fetchFullMessage,
  startExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(startExpanded);
  const [expandedResults, setExpandedResults] = useState<Record<number, boolean>>({});
  // L4: full content loaded per tool (keyed by index)
  const [fullResults, setFullResults] = useState<Record<number, string>>({});
  const [loadingFull, setLoadingFull] = useState<Record<number, boolean>>({});

  if (tools.length === 0) return null;

  const toggleResult = (idx: number) => {
    setExpandedResults((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // L4: Load full content for a truncated tool result
  const handleLoadFull = async (idx: number, messageId: number) => {
    if (!fetchFullMessage || loadingFull[idx] || fullResults[idx]) return;
    setLoadingFull(prev => ({ ...prev, [idx]: true }));
    try {
      const result = await fetchFullMessage(messageId);
      if (result?.content) {
        setFullResults(prev => ({ ...prev, [idx]: result.content }));
      }
    } catch (err) {
      console.error('Failed to load full result:', err);
    } finally {
      setLoadingFull(prev => ({ ...prev, [idx]: false }));
    }
  };

  const hasBash = tools.some((t) => t.toolName === 'Bash');

  return (
    <div className="mb-2">
      {/* Summary row — hidden when startExpanded to avoid double nesting with parent toggle */}
      {!startExpanded && (
        <div className="flex items-center gap-2">
          <div
            onClick={() => setExpanded(!expanded)}
            className="cursor-pointer select-none flex items-center gap-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>
              Used {tools.length} tool{tools.length !== 1 ? 's' : ''}
            </span>
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </div>

          {/* Terminal link when agent used Bash (ADR-076) */}
          {onOpenTerminal && hasBash && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenTerminal(terminalSessionId);
              }}
              className="flex items-center gap-1 text-[10px] text-green-500 hover:text-green-400 transition-colors"
              title="Open Terminal"
            >
              <Terminal className="w-3 h-3" />
              <span>Terminal</span>
            </button>
          )}
        </div>
      )}

      {/* Expanded detail list */}
      {expanded && (
        <div className="space-y-1 mt-2 pl-2 border-l-2 border-[var(--border-secondary)]">
          {tools.map((step, idx) => {
            const isBash = step.toolName === 'Bash';
            const bashCommand =
              isBash && step.args?.command ? String(step.args.command) : null;
            const isResultExpanded = expandedResults[idx] || false;
            // Use full result if loaded (L4), otherwise use truncated/original
            const rawResult = fullResults[idx] !== undefined ? fullResults[idx] : (step.result !== undefined ? formatResult(step.result) : '');
            const resultText = typeof rawResult === 'string' ? rawResult : formatResult(rawResult);
            const isTruncated = step._truncated && !fullResults[idx];

            // Build tool description for preview
            let toolDescription = step.toolName;
            if (isBash && bashCommand) {
              toolDescription = `$ ${truncateText(bashCommand, 120)}`;
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
              <div key={`tool-${idx}`} className="py-1">
                {/* Tool header with name/command + status icon */}
                <div className="flex items-start gap-2 text-xs min-w-0">
                  {isBash ? (
                    <Terminal className="w-3 h-3 mt-0.5 text-green-500 flex-shrink-0" />
                  ) : (
                    <Wrench className="w-3 h-3 mt-0.5 text-[var(--text-tertiary)] flex-shrink-0" />
                  )}
                  <span
                    className={cn(
                      'font-mono min-w-0 break-all',
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

                {/* Result preview (truncated) + expand to full */}
                {resultText && (
                  <div className="mt-1 ml-5">
                    <pre className="p-2 rounded bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-all"
                      style={{ maxHeight: isResultExpanded ? '400px' : '60px', overflowY: 'auto' }}
                    >
                      {isResultExpanded
                        ? truncateText(resultText, TOOL_RESULT_FULL_LENGTH)
                        : truncateText(resultText, 200)}
                    </pre>
                    <div className="flex items-center gap-2 mt-1">
                      {/* L4: Load full result button for truncated results (only when fetch is available and content is non-trivial) */}
                      {isTruncated && step.resultMessageId && fetchFullMessage && (step._full_length || 0) > 0 && (
                        <button
                          onClick={() => handleLoadFull(idx, step.resultMessageId!)}
                          disabled={loadingFull[idx]}
                          className="text-[10px] text-amber-400 hover:text-amber-300 cursor-pointer transition-colors flex items-center gap-1"
                        >
                          {loadingFull[idx] ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : null}
                          {loadingFull[idx]
                            ? 'Loading...'
                            : `Load full result (${Math.round((step._full_length || 0) / 1024)}KB)`}
                        </button>
                      )}
                      {/* Expand/collapse for long results */}
                      {resultText.length > 200 && (
                        <button
                          onClick={() => toggleResult(idx)}
                          className="text-[10px] text-[var(--color-primary-500)] hover:text-[var(--color-primary-400)] cursor-pointer transition-colors"
                        >
                          {isResultExpanded ? '\u2190 Свернуть' : 'Показать полностью \u2192'}
                        </button>
                      )}
                    </div>
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
// Sub-component: ThinkingBlock -- renders a thinking step as full visible text
// ---------------------------------------------------------------------------

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(content.length <= 1000);
  const trimmed = content.trim();

  // Skip empty/whitespace-only thinking blocks
  if (!trimmed) return null;

  const displayText = expanded ? trimmed : trimmed.slice(0, 1000) + '...';

  return (
    <div className="mb-2 flex items-start gap-1.5">
      <Brain className="w-3.5 h-3.5 text-purple-400/60 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[13px] leading-relaxed text-[var(--text-tertiary)] whitespace-pre-wrap">
          {displayText}
        </p>
        {trimmed.length > 1000 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-purple-400 hover:text-purple-300 mt-1 cursor-pointer transition-colors"
          >
            {expanded ? 'свернуть' : 'показать ещё'}
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: ToolStepsAccordion (LEGACY COMPAT -- wraps new sections)
// ---------------------------------------------------------------------------

export const ToolStepsAccordion: React.FC<ToolStepsAccordionProps> = ({
  steps,
  totalToolCount,
  terminalSessionId,
  onOpenTerminal,
  markdownEnabled,
  conversationId,
  onToolApprove,
  onToolReject,
  fetchFullMessage,
  startExpanded = false,
}) => {
  if (totalToolCount === 0 && steps.length === 0) return null;

  const sections = groupStepsIntoSections(steps);

  return (
    <div className="mb-2">
      {sections.map((section, idx) => {
        if (section.kind === 'thinking') {
          return (
            <ThinkingBlock
              key={`section-thinking-${idx}`}
              content={section.content}
              markdownEnabled={markdownEnabled}
            />
          );
        }
        if (section.kind === 'tool_approval') {
          return (
            <ToolApprovalBubble
              key={`section-approval-${idx}`}
              toolName={section.step.toolName}
              args={section.step.args}
              messageId={section.step.messageId}
              conversationId={conversationId ?? 0}
              approvalStatus={section.step.approvalStatus}
              timeoutSeconds={section.step.timeoutSeconds}
              approvedBy={section.step.approvedBy}
              approvedAt={section.step.approvedAt}
              onApprove={onToolApprove}
              onReject={onToolReject}
            />
          );
        }
        if (section.kind === 'plan') {
          return (
            <PlanWidget
              key={`section-plan-${idx}`}
              tasks={section.tasks}
            />
          );
        }
        return (
          <ToolGroupAccordion
            key={`section-tools-${idx}`}
            tools={section.tools}
            terminalSessionId={terminalSessionId}
            onOpenTerminal={onOpenTerminal}
            fetchFullMessage={fetchFullMessage}
            startExpanded={startExpanded}
          />
        );
      })}
    </div>
  );
};

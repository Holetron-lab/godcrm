import React, { useState } from 'react';
import {
  Wrench,
  ChevronDown,
  ChevronRight,
  Brain,
  CheckCircle2,
  XCircle,
  Terminal,
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
}) => {
  const [expanded, setExpanded] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Record<number, boolean>>({});

  if (tools.length === 0) return null;

  const toggleResult = (idx: number) => {
    setExpandedResults((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const hasBash = tools.some((t) => t.toolName === 'Bash');

  return (
    <div className="mb-2">
      {/* Summary row */}
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

      {/* Expanded detail list */}
      {expanded && (
        <div className="space-y-1 mt-2 pl-2 border-l-2 border-[var(--border-secondary)]">
          {tools.map((step, idx) => {
            const isBash = step.toolName === 'Bash';
            const bashCommand =
              isBash && step.args?.command ? String(step.args.command) : null;
            const isResultExpanded = expandedResults[idx] || false;
            const resultText = step.result !== undefined ? formatResult(step.result) : '';

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
                    {/* Preview -- always show first 200 chars */}
                    <pre className="p-2 rounded bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap break-all"
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
                        {isResultExpanded ? '\u2190 \u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c' : '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043f\u043e\u043b\u043d\u043e\u0441\u0442\u044c\u044e \u2192'}
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
// Sub-component: ThinkingBlock -- renders a thinking step as full visible text
// ---------------------------------------------------------------------------

const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content }) => {
  const [expanded, setExpanded] = useState(content.length <= 500);

  return (
    <div className="mb-3 pl-3 border-l-2 border-purple-500/30">
      <div className="flex items-center gap-1.5 mb-1">
        <Brain className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-[10px] font-medium text-purple-400 uppercase tracking-wide">Reasoning</span>
      </div>
      <div
        className={cn(
          'text-sm text-[var(--text-secondary)] whitespace-pre-wrap',
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
          {expanded ? '\u2190 \u0421\u0432\u0435\u0440\u043d\u0443\u0442\u044c' : '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043f\u043e\u043b\u043d\u043e\u0441\u0442\u044c\u044e \u2192'}
        </button>
      )}
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
          />
        );
      })}
    </div>
  );
};

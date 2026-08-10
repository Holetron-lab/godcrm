import React from 'react';
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  Brain,
  Wrench,
} from 'lucide-react';
import type { Step } from './types';
import type { StepGroupWithIdx } from './useStepGroups';
import { ToolStepsAccordion } from './ToolStepsAccordion';

interface StepGroupsPanelProps {
  allStepGroups: StepGroupWithIdx[];
  masterExpanded: boolean;
  expandedGroups: Record<number, boolean>;
  loadingGroups: Record<number, boolean>;
  loadedGroupSteps: Record<number, Step[]>;
  loadedGroupToolCounts: Record<number, number>;
  loadedGroupTerminals: Record<number, number | undefined>;
  reasoningExpanded: Record<number, boolean>;
  collapsedToolGroups: Record<number, boolean>;
  onLoadGroup: (group: StepGroupWithIdx) => void;
  onToggleReasoning: (idx: number, expanded: boolean) => void;
  onToggleToolGroup: (idx: number) => void;
  // Pass-through for ToolStepsAccordion
  onOpenTerminal?: (sessionId?: number) => void;
  markdownEnabled?: boolean;
  conversationId?: number;
  onToolApprove?: (messageId: number, alwaysAllow?: boolean) => void;
  onToolReject?: (messageId: number) => void;
  fetchFullMessage?: (messageId: number) => Promise<{ id: number; content: string; content_type: string } | null>;
}

export const StepGroupsPanel: React.FC<StepGroupsPanelProps> = ({
  allStepGroups,
  masterExpanded,
  loadingGroups,
  loadedGroupSteps,
  loadedGroupToolCounts,
  loadedGroupTerminals,
  reasoningExpanded,
  collapsedToolGroups,
  onLoadGroup,
  onToggleReasoning,
  onToggleToolGroup,
  onOpenTerminal,
  markdownEnabled,
  conversationId,
  onToolApprove,
  onToolReject,
  fetchFullMessage,
}) => {
  return (
    <div className="space-y-1.5 pl-2 border-l-2 border-[var(--border-secondary)]">
      {allStepGroups.map((group) => {
        const idx = group._groupIdx;
        const isLoading = loadingGroups[idx];
        const loadedSteps = loadedGroupSteps[idx];

        // When master accordion is collapsed, only show thinking previews inline
        if (!masterExpanded) {
          if (group.type === 'thinking' && group.preview) {
            return (
              <div key={`group-${idx}`} className="flex items-start gap-1.5">
                <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-[var(--text-tertiary)] truncate opacity-70">
                  {group.preview.slice(0, 150)}
                </p>
              </div>
            );
          }
          return null;
        }

        if (group.type === 'thinking') {
          const loadedText = loadedSteps
            ? loadedSteps.filter(s => s.kind === 'thinking').map(s => s.content).join('\n')
            : '';
          // Fallback to preview if loaded steps produced empty text
          const reasoningText = loadedText.trim() ? loadedText : (group.preview || '');

          if (!reasoningText.trim() && !loadedSteps) {
            return (
              <div key={`group-${idx}`}>
                <button
                  onClick={() => onLoadGroup(group)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
                  <span>{isLoading ? 'Loading...' : `${group.count} reasoning step${group.count !== 1 ? 's' : ''}`}</span>
                  {!isLoading && <ChevronRight className="w-3 h-3" />}
                </button>
              </div>
            );
          }

          const hasFullContent = !!loadedSteps && !!loadedText.trim();
          const isLong = hasFullContent ? reasoningText.length > 1000 : reasoningText.length >= 140;
          const isFullyExpanded = reasoningExpanded[idx];
          const displayText = !hasFullContent
            ? reasoningText
            : (isLong && !isFullyExpanded ? reasoningText.slice(0, 1000) + '...' : reasoningText);

          return (
            <div key={`group-${idx}`} className="flex items-start gap-1.5">
              <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[13px] leading-relaxed text-[var(--text-tertiary)] whitespace-pre-wrap">{displayText}</p>
                {!hasFullContent && isLong && (
                  <button onClick={() => onLoadGroup(group)} className="text-xs text-[var(--color-primary-500)] hover:text-[var(--color-primary-400)] mt-1 cursor-pointer">
                    {loadingGroups[idx] ? 'загрузка...' : 'показать ещё'}
                  </button>
                )}
                {hasFullContent && isLong && !isFullyExpanded && (
                  <button onClick={() => onToggleReasoning(idx, true)} className="text-xs text-[var(--color-primary-500)] hover:text-[var(--color-primary-400)] mt-1 cursor-pointer">показать ещё</button>
                )}
                {hasFullContent && isLong && isFullyExpanded && (
                  <button onClick={() => onToggleReasoning(idx, false)} className="text-xs text-[var(--color-primary-500)] hover:text-[var(--color-primary-400)] mt-1 cursor-pointer">свернуть</button>
                )}
              </div>
            </div>
          );
        }

        // Tools group
        const isToolCollapsed = collapsedToolGroups[idx];
        return (
          <div key={`group-${idx}`}>
            {!loadedSteps && (
              <button onClick={() => onLoadGroup(group)} disabled={isLoading} className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer">
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                <span>{isLoading ? 'Loading...' : `Used ${group.count} tool${group.count !== 1 ? 's' : ''}`}</span>
                {!isLoading && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            )}
            {loadedSteps && (
              <>
                <button onClick={() => onToggleToolGroup(idx)} className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer mb-1">
                  {isToolCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <Wrench className="w-3.5 h-3.5" />
                  <span>Used {group.count} tool{group.count !== 1 ? 's' : ''}</span>
                </button>
                {!isToolCollapsed && (
                  <ToolStepsAccordion
                    steps={loadedSteps}
                    totalToolCount={loadedGroupToolCounts[idx] || 0}
                    terminalSessionId={loadedGroupTerminals[idx]}
                    onOpenTerminal={onOpenTerminal}
                    markdownEnabled={markdownEnabled}
                    conversationId={conversationId}
                    onToolApprove={onToolApprove}
                    onToolReject={onToolReject}
                    fetchFullMessage={fetchFullMessage}
                    startExpanded
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};

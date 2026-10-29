import { useLanguage } from '@/shared/i18n/LanguageContext';
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
  expandedGroups: Record<string, boolean>;
  loadingGroups: Record<string, boolean>;
  failedGroups: Record<string, boolean>;
  loadedGroupSteps: Record<string, Step[]>;
  loadedGroupToolCounts: Record<string, number>;
  loadedGroupTerminals: Record<string, number | undefined>;
  reasoningExpanded: Record<string, boolean>;
  collapsedToolGroups: Record<string, boolean>;
  onLoadGroup: (group: StepGroupWithIdx) => void;
  onToggleReasoning: (idx: string, expanded: boolean) => void;
  onToggleToolGroup: (idx: string) => void;
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
  failedGroups,
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
  const { t } = useLanguage();
  return (
    <div className="space-y-1.5 pl-2 border-l-2 border-[var(--border-secondary)]">
      {allStepGroups.map((group) => {
        const idx = group._groupIdx;
        const isLoading = loadingGroups[idx];
        const loadedSteps = loadedGroupSteps[idx];
        if (masterExpanded && failedGroups[idx]) return <div key={`group-${idx}`} className="text-xs text-[var(--text-secondary)]">
          <p role="alert">{t('aiChat.ui.stepsLoadFailed')}</p>
          <button type="button" onClick={() => onLoadGroup(group)} className="underline focus-visible:outline focus-visible:outline-2">{t('aiChat.ui.retry')}</button>
        </div>;

        // When master accordion is collapsed, only show thinking previews inline
        if (!masterExpanded) {
          if (group.type === 'thinking' && group.preview) {
            return (
              <div key={`group-${idx}`} className="flex items-start gap-1.5">
                <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] truncate">
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
                  type="button"
                  onClick={() => onLoadGroup(group)}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2"
                >
                  {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" /> : <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />}
                  <span>{isLoading ? t('aiChat.ui.loading') : t('aiChat.ui.reasoningSteps', { count: group.count })}</span>
                  {!isLoading && <ChevronRight className="w-3 h-3" />}
                </button>
              </div>
            );
          }

          const hasFullContent = !!loadedSteps && !!loadedText.trim();
          const isLong = hasFullContent ? reasoningText.length > 1000 : group.count > 1 || reasoningText.length >= 140;
          const isFullyExpanded = reasoningExpanded[idx];
          const displayText = !hasFullContent
            ? reasoningText
            : (isLong && !isFullyExpanded ? reasoningText.slice(0, 1000) + '...' : reasoningText);

          return (
            <div key={`group-${idx}`} className="flex items-start gap-1.5">
              <Brain className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[13px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap">{displayText}</p>
                {!hasFullContent && isLong && (
                  <button type="button" disabled={isLoading} onClick={() => onLoadGroup(group)} className="text-xs text-[var(--text-secondary)] underline mt-1 cursor-pointer focus-visible:outline focus-visible:outline-2">
                    {loadingGroups[idx] ? t('aiChat.ui.loadingLabel') : t('aiChat.ui.showMore')}
                  </button>
                )}
                {hasFullContent && isLong && !isFullyExpanded && (
                  <button type="button" onClick={() => onToggleReasoning(idx, true)} className="text-xs text-[var(--text-secondary)] underline mt-1 cursor-pointer focus-visible:outline focus-visible:outline-2">{t('aiChat.ui.showMore')}</button>
                )}
                {hasFullContent && isLong && isFullyExpanded && (
                  <button type="button" onClick={() => onToggleReasoning(idx, false)} className="text-xs text-[var(--text-secondary)] underline mt-1 cursor-pointer focus-visible:outline focus-visible:outline-2">{t('aiChat.ui.collapseLabel')}</button>
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
              <button type="button" aria-expanded={false} onClick={() => onLoadGroup(group)} disabled={isLoading} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2">
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                <span>{isLoading ? t('aiChat.ui.loading') : t('aiChat.ui.toolsUsed', { count: group.count })}</span>
                {!isLoading && <ChevronRight className="w-3.5 h-3.5" />}
              </button>
            )}
            {loadedSteps && (
              <>
                <button type="button" aria-expanded={!isToolCollapsed} onClick={() => onToggleToolGroup(idx)} className="flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer mb-1 focus-visible:outline focus-visible:outline-2">
                  {isToolCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <Wrench className="w-3.5 h-3.5" />
                  <span>{t('aiChat.ui.toolsUsedCount', { count: loadedGroupToolCounts[idx] ?? group.count })}</span>
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

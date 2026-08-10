import { useState, useCallback, useEffect } from 'react';
import type { ChatMessage } from '../../../types';
import type { Step, StepGroup } from './types';
import { parseToolName, parseToolArgs, parseToolResult } from './helpers';

export interface StepGroupWithIdx extends StepGroup {
  _groupIdx: number;
}

export interface UseStepGroupsResult {
  allStepGroups: StepGroupWithIdx[];
  totalHiddenSteps: number;
  expandedGroups: Record<number, boolean>;
  loadedGroupSteps: Record<number, Step[]>;
  loadingGroups: Record<number, boolean>;
  loadedGroupToolCounts: Record<number, number>;
  loadedGroupTerminals: Record<number, number | undefined>;
  reasoningExpanded: Record<number, boolean>;
  masterExpanded: boolean;
  collapsedToolGroups: Record<number, boolean>;
  setMasterExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setReasoningExpanded: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  setCollapsedToolGroups: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  handleLoadGroup: (group: StepGroupWithIdx) => Promise<void>;
}

export function useStepGroups(
  messages: ChatMessage[],
  opts: {
    isProcessing: boolean;
    isLastTurn: boolean;
    fetchThinkingSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
    fetchToolStepsPreview?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
    fetchToolSteps?: (afterId: number, beforeId: number) => Promise<ChatMessage[]>;
  },
): UseStepGroupsResult {
  const { isProcessing, isLastTurn, fetchThinkingSteps, fetchToolStepsPreview, fetchToolSteps } = opts;

  // Extract step groups from message annotations
  const allStepGroups: StepGroupWithIdx[] = [];
  let groupIdx = 0;
  for (const msg of messages) {
    const groups = (msg as any)._step_groups_before as StepGroup[] | undefined;
    if (groups) {
      for (const g of groups) {
        allStepGroups.push({ ...g, _groupIdx: groupIdx++ });
      }
    }
  }
  const lastMsg = messages[messages.length - 1];
  const groupsAfter = (lastMsg as any)?._step_groups_after as StepGroup[] | undefined;
  if (groupsAfter) {
    for (const g of groupsAfter) {
      allStepGroups.push({ ...g, _groupIdx: groupIdx++ });
    }
  }

  const totalHiddenSteps = messages.reduce((sum, m) => sum + ((m as any)._total_hidden_before || 0), 0)
    + ((lastMsg as any)?._total_hidden_after || 0);

  // State hooks
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});
  const [loadedGroupSteps, setLoadedGroupSteps] = useState<Record<number, Step[]>>({});
  const [loadingGroups, setLoadingGroups] = useState<Record<number, boolean>>({});
  const [loadedGroupToolCounts, setLoadedGroupToolCounts] = useState<Record<number, number>>({});
  const [loadedGroupTerminals, setLoadedGroupTerminals] = useState<Record<number, number | undefined>>({});
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<number, boolean>>({});
  const [masterExpanded, setMasterExpanded] = useState(isProcessing);
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Record<number, boolean>>({});

  // Expand when processing starts, collapse when it ends
  useEffect(() => {
    setMasterExpanded(isProcessing);
  }, [isProcessing]);

  const handleLoadGroup = useCallback(async (group: StepGroupWithIdx) => {
    const idx = group._groupIdx;
    if (loadingGroups[idx] || loadedGroupSteps[idx]) return;
    setLoadingGroups(prev => ({ ...prev, [idx]: true }));
    try {
      const afterId = group.first_id - 1;
      const beforeId = group.last_id + 1;

      if (group.type === 'thinking') {
        const fetcher = fetchThinkingSteps || fetchToolSteps;
        if (!fetcher) return;
        let thinkingMessages: ChatMessage[];
        if (fetchThinkingSteps) {
          thinkingMessages = await fetchThinkingSteps(afterId, beforeId);
        } else {
          const all = await fetchToolSteps!(afterId, beforeId);
          thinkingMessages = all.filter(m => m.contentType === 'thinking');
        }
        const steps: Step[] = thinkingMessages
          .filter(m => m.contentType === 'thinking')
          .map(m => ({ kind: 'thinking' as const, content: m.content }));
        setLoadedGroupSteps(prev => ({ ...prev, [idx]: steps }));
      } else {
        const fetcher = fetchToolStepsPreview || fetchToolSteps;
        if (!fetcher) return;
        let toolMessages: ChatMessage[];
        if (fetchToolStepsPreview) {
          toolMessages = await fetchToolStepsPreview(afterId, beforeId);
        } else {
          const all = await fetchToolSteps!(afterId, beforeId);
          toolMessages = all.filter(m => m.contentType === 'tool_call' || m.contentType === 'tool_result');
        }
        const steps: Step[] = [];
        let toolCount = 0;
        let termSession: number | undefined;
        for (let i = 0; i < toolMessages.length; i++) {
          const msg = toolMessages[i];
          if (msg.contentType === 'tool_call') {
            toolCount++;
            const toolName = parseToolName(msg.content);
            const tr = msg.toolResults as unknown as Record<string, unknown> | undefined;
            const args = parseToolArgs(msg.content) ?? (tr?.args as Record<string, unknown> | undefined);
            if (tr?.terminal_session_id && !termSession) termSession = Number(tr.terminal_session_id);
            let result: unknown = undefined;
            let success = true;
            let resultMessageId: number | undefined;
            let _truncated = false;
            let _full_length: number | undefined;
            if (i + 1 < toolMessages.length && toolMessages[i + 1].contentType === 'tool_result') {
              const resultMsg = toolMessages[i + 1];
              const parsed = parseToolResult(resultMsg.content);
              result = parsed.result;
              success = parsed.success;
              resultMessageId = Number(resultMsg.id);
              _truncated = !!(resultMsg as any)._truncated;
              _full_length = (resultMsg as any)._full_length;
              i++;
            }
            steps.push({ kind: 'tool', toolName, args, result, success, resultMessageId, _truncated, _full_length });
          } else if (msg.contentType === 'tool_result') {
            toolCount++;
            const parsed = parseToolResult(msg.content);
            steps.push({
              kind: 'tool', toolName: 'tool', result: parsed.result, success: parsed.success,
              resultMessageId: Number(msg.id),
              _truncated: !!(msg as any)._truncated,
              _full_length: (msg as any)._full_length,
            });
          }
        }
        setLoadedGroupSteps(prev => ({ ...prev, [idx]: steps }));
        setLoadedGroupToolCounts(prev => ({ ...prev, [idx]: toolCount }));
        setLoadedGroupTerminals(prev => ({ ...prev, [idx]: termSession }));
      }
      setExpandedGroups(prev => ({ ...prev, [idx]: true }));
    } catch (err) {
      console.error('Failed to load group steps:', err);
    } finally {
      setLoadingGroups(prev => ({ ...prev, [idx]: false }));
    }
  }, [fetchThinkingSteps, fetchToolStepsPreview, fetchToolSteps, loadingGroups, loadedGroupSteps]);

  return {
    allStepGroups,
    totalHiddenSteps,
    expandedGroups,
    loadedGroupSteps,
    loadingGroups,
    loadedGroupToolCounts,
    loadedGroupTerminals,
    reasoningExpanded,
    masterExpanded,
    collapsedToolGroups,
    setMasterExpanded,
    setReasoningExpanded,
    setCollapsedToolGroups,
    handleLoadGroup,
  };
}

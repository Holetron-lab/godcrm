import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChatMessage } from '../../../types';
import type { Step, StepGroup } from './types';
import { parseToolName, parseToolArgs, parseToolResult } from './helpers';

export interface StepGroupWithIdx extends StepGroup {
  _groupIdx: string;
  _ranges: StepGroup[];
}

export interface UseStepGroupsResult {
  allStepGroups: StepGroupWithIdx[];
  totalHiddenSteps: number;
  expandedGroups: Record<string, boolean>;
  loadedGroupSteps: Record<string, Step[]>;
  loadingGroups: Record<string, boolean>;
  failedGroups: Record<string, boolean>;
  loadedGroupToolCounts: Record<string, number>;
  loadedGroupTerminals: Record<string, number | undefined>;
  reasoningExpanded: Record<string, boolean>;
  masterExpanded: boolean;
  collapsedToolGroups: Record<string, boolean>;
  setMasterExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  setReasoningExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setCollapsedToolGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
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
  const { isProcessing, fetchThinkingSteps, fetchToolStepsPreview, fetchToolSteps } = opts;

  // Every carrier can have trailing history, even after polling appends messages.
  const rawGroups: StepGroup[] = [];
  for (const message of messages) {
    const annotated = message as ChatMessage & {
      _step_groups_before?: StepGroup[];
      _step_groups_after?: StepGroup[];
    };
    for (const group of [...(annotated._step_groups_before ?? []), ...(annotated._step_groups_after ?? [])]) {
      rawGroups.push(group);
    }
  }
  const allStepGroups: StepGroupWithIdx[] = [];
  const seen = new Set<string>();
  for (const group of rawGroups.sort((a, b) => Number(a.first_id) - Number(b.first_id))) {
    const key = `${group.type}:${group.first_id}:${group.last_id}:${group.count}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const previous = allStepGroups[allStepGroups.length - 1];
    const sameAgent = previous && (previous.agent_id != null && group.agent_id != null
      ? previous.agent_id === group.agent_id : previous.agent_name === group.agent_name);
    const hasInlineReasoning = previous && messages.some(m => m.contentType === 'thinking'
      && Number(m.id) > previous.last_id && Number(m.id) < group.first_id);
    if (previous?.type === 'tools' && group.type === 'tools' && sameAgent && !hasInlineReasoning) {
      previous.count += group.count;
      previous.last_id = group.last_id;
      previous.last_at = group.last_at;
      previous._ranges.push(group);
      previous._groupIdx += `|${key}`;
    } else {
      allStepGroups.push({ ...group, _groupIdx: key, _ranges: [group] });
    }
  }
  const totalHiddenSteps = allStepGroups.reduce((sum, group) => sum + group.count, 0);

  // State hooks
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadedGroupSteps, setLoadedGroupSteps] = useState<Record<string, Step[]>>({});
  const [loadingGroups, setLoadingGroups] = useState<Record<string, boolean>>({});
  const [failedGroups, setFailedGroups] = useState<Record<string, boolean>>({});
  const inFlight = useRef(new Set<string>());
  const [loadedGroupToolCounts, setLoadedGroupToolCounts] = useState<Record<string, number>>({});
  const [loadedGroupTerminals, setLoadedGroupTerminals] = useState<Record<string, number | undefined>>({});
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});
  const [masterExpanded, setMasterExpanded] = useState(isProcessing);
  const [collapsedToolGroups, setCollapsedToolGroups] = useState<Record<string, boolean>>({});

  // Expand when processing starts, collapse when it ends
  useEffect(() => {
    setMasterExpanded(isProcessing);
  }, [isProcessing]);

  const handleLoadGroup = useCallback(async (group: StepGroupWithIdx) => {
    const idx = group._groupIdx;
    if (inFlight.current.has(idx) || loadedGroupSteps[idx]) return;
    inFlight.current.add(idx);
    setLoadingGroups(prev => ({ ...prev, [idx]: true }));
    setFailedGroups(prev => ({ ...prev, [idx]: false }));
    try {
      const fetcher = (group.type === 'thinking' ? fetchThinkingSteps : fetchToolStepsPreview) || fetchToolSteps;
      if (!fetcher) throw new Error('Step loader unavailable');
      // Fetch source ranges independently: another agent may own the gaps.
      const batches = await Promise.all(group._ranges.map(async range => {
        const rows = await fetcher(Number(range.first_id) - 1, Number(range.last_id) + 1);
        const matching = rows.filter(m => Number(m.id) >= range.first_id && Number(m.id) <= range.last_id
          && (group.type === 'thinking' ? m.contentType === 'thinking' : m.contentType === 'tool_call' || m.contentType === 'tool_result'));
        if (!matching.length) throw new Error('Step range unavailable');
        return matching;
      }));
      const groupMessages = [...new Map(batches.flat().map(m => [m.id, m])).values()]
        .sort((a, b) => Number(a.id) - Number(b.id));

      if (group.type === 'thinking') {
        const steps: Step[] = groupMessages
          .map(m => ({ kind: 'thinking' as const, content: m.content }));
        setLoadedGroupSteps(prev => ({ ...prev, [idx]: steps }));
      } else {
        const toolMessages = groupMessages;
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
              _truncated = !!resultMsg._truncated;
              _full_length = resultMsg._full_length;
              i++;
            }
            steps.push({ kind: 'tool', toolName, args, result, success, resultMessageId, _truncated, _full_length });
          } else if (msg.contentType === 'tool_result') {
            toolCount++;
            const parsed = parseToolResult(msg.content);
            steps.push({
              kind: 'tool', toolName: 'tool', result: parsed.result, success: parsed.success,
              resultMessageId: Number(msg.id),
              _truncated: !!msg._truncated,
              _full_length: msg._full_length,
            });
          }
        }
        setLoadedGroupSteps(prev => ({ ...prev, [idx]: steps }));
        setLoadedGroupToolCounts(prev => ({ ...prev, [idx]: toolCount }));
        setLoadedGroupTerminals(prev => ({ ...prev, [idx]: termSession }));
      }
      setExpandedGroups(prev => ({ ...prev, [idx]: true }));
    } catch {
      setFailedGroups(prev => ({ ...prev, [idx]: true }));
    } finally {
      inFlight.current.delete(idx);
      setLoadingGroups(prev => ({ ...prev, [idx]: false }));
    }
  }, [fetchThinkingSteps, fetchToolStepsPreview, fetchToolSteps, loadedGroupSteps]);

  return {
    allStepGroups,
    totalHiddenSteps,
    expandedGroups,
    loadedGroupSteps,
    loadingGroups,
    failedGroups,
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

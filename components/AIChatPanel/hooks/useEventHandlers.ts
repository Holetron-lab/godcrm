/**
 * useEventHandlers — Event handler callbacks for AIChatPanel.
 * ADR-119: Extracted from AIChatPanel.tsx (handleSubmit, handleFileSelect, handleDrop, handleAgentSelect, handleCheckboxClick).
 */
import { useCallback, useRef } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { validateAndWrapMentions, validateAndWrapCommands } from '../../../utils/invocationTokens';
import type { MentionUser } from '../../MentionInput';
import type { AIAgent, ChatMessage } from '../../../types';
import type { BoundRow } from '../../RowBindingV2';

interface UseEventHandlersParams {
  inputValue: string;
  setInputValue: (v: string | ((prev: string) => string)) => void;
  attachments: File[];
  setAttachments: (v: File[] | ((prev: File[]) => File[])) => void;
  mentionedUsers: MentionUser[];
  setMentionedUsers: (v: MentionUser[] | ((prev: MentionUser[]) => MentionUser[])) => void;
  messageBoundRows: BoundRow[];
  setMessageBoundRows: (v: BoundRow[] | ((prev: BoundRow[]) => BoundRow[])) => void;
  setLocalError: (v: string | null) => void;
  setDragOver: (v: boolean) => void;
  chatPartner: { type: string; id: number; name: string; icon?: string; participants?: Array<{ id: number }> } | null;
  currentAgent: AIAgent | null;
  agentMode: string;
  thinkingEnabled: boolean;
  subAgents: number[];
  userConversationId: number | null;
  setUserConversationId: (id: number | null) => void;
  currentSpaceId: number | undefined;
  effectiveSpaceId: number | undefined;
  availableMentionUsers: MentionUser[];
  availableSlashAgents: MentionUser[];
  // Context actions
  sendMessage: (...args: any[]) => Promise<any>;
  selectAgent: (agent: AIAgent) => void;
  // Mutations
  sendUserMessageMutation: { mutateAsync: (params: any) => Promise<any> };
  // State setters for agent select
  setChatMode: (mode: string) => void;
  setChatPartner: (v: any) => void;
  setChatParticipants: (v: any) => void;
  setBoundRows: (v: any) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  setActivePanel: (v: string) => void;
  setVectorSearchResults: (v: any) => void;
}

export function useEventHandlers(params: UseEventHandlersParams) {
  const {
    inputValue, setInputValue, attachments, setAttachments,
    mentionedUsers, setMentionedUsers, messageBoundRows, setMessageBoundRows,
    setLocalError, setDragOver, chatPartner, currentAgent,
    agentMode, thinkingEnabled, subAgents,
    userConversationId, setUserConversationId, currentSpaceId, effectiveSpaceId,
    availableMentionUsers, availableSlashAgents,
    sendMessage, selectAgent, sendUserMessageMutation,
    setChatMode, setChatPartner, setChatParticipants, setBoundRows,
    setShowBoundRowsBar, setActivePanel, setVectorSearchResults,
  } = params;

  const isSendingRef = useRef(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    let trimmed = inputValue.trim();
    trimmed = validateAndWrapMentions(trimmed, availableMentionUsers);
    trimmed = validateAndWrapCommands(trimmed, availableSlashAgents || []);
    if (!trimmed && attachments.length === 0 && messageBoundRows.length === 0) return;
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    setLocalError(null);
    try {
      if (chatPartner?.type === 'agent' && currentAgent) {
        const files = [...attachments];
        const mentions = mentionedUsers.length > 0 ? mentionedUsers.map(u => ({ id: u.id, name: u.name, type: u.type })) : undefined;
        const rowAtts = messageBoundRows.length > 0 ? messageBoundRows.map(br => ({
          id: `row_${br.table_id}_${br.row_id}`, name: br.row_title || `Row #${br.row_id}`,
          type: 'row_reference', size: 0,
          rowReference: { table_id: br.table_id, row_id: br.row_id, table_name: br.table_name || '', table_icon: br.table_icon, row_title: br.row_title }
        })) : undefined;
        setInputValue(''); setAttachments([]); setMentionedUsers([]); setMessageBoundRows([]);
        await sendMessage(trimmed, files.length > 0 ? files : undefined, undefined, mentions, agentMode === 'agent', undefined, subAgents.length > 0 ? subAgents : undefined, rowAtts);
        return;
      }
      if (chatPartner?.type === 'user' || chatPartner?.type === 'group') {
        const pIds = chatPartner.type === 'group' ? ((chatPartner as any).participants?.map((p: any) => p.id) || []) : [chatPartner.id];
        let convId = userConversationId;
        if (!convId) {
          const resp = await apiClient.post<any>('/chat/conversations', { type: 'chat', participant_ids: pIds, space_id: currentSpaceId });
          convId = resp.data.id;
          setUserConversationId(convId);
        }
        const hasAgentTrigger = /(^|\s)[/@][a-z0-9_-]+/i.test(trimmed);
        const uMentions = mentionedUsers.length > 0 ? mentionedUsers.map(u => ({ user_id: u.id, name: u.name, type: u.type })) : undefined;
        let uploadedAtts: any[] | undefined;
        if (attachments.length > 0) {
          try {
            const res = await filesApi.upload([...attachments], { spaceId: effectiveSpaceId });
            const arr = Array.isArray(res) ? res : [res];
            uploadedAtts = attachments.map((f, i) => ({
              id: arr[i]?.id || `att_${Date.now()}_${f.name}`, name: f.name, type: f.type, size: f.size,
              url: arr[i]?.url || '', preview: f.type.startsWith('image/') ? (arr[i]?.url || URL.createObjectURL(f)) : undefined
            }));
          } catch {
            uploadedAtts = attachments.map(f => ({ id: `att_${Date.now()}_${f.name}`, name: f.name, type: f.type, size: f.size }));
          }
        }
        const rowRefs = messageBoundRows.map(br => ({
          id: `row_${br.table_id}_${br.row_id}`, name: br.row_title || `Row #${br.row_id}`,
          type: 'row_reference', size: 0,
          rowReference: { table_id: br.table_id, row_id: br.row_id, table_name: br.table_name || '', table_icon: br.table_icon, row_title: br.row_title }
        }));
        const allAtts = [...(uploadedAtts || []), ...rowRefs];
        setInputValue(''); setAttachments([]); setMentionedUsers([]); setMessageBoundRows([]);
        await sendUserMessageMutation.mutateAsync({
          conversationId: convId!, content: trimmed,
          ...(hasAgentTrigger && { agentMode, thinking: thinkingEnabled }),
          ...(uMentions && { mentions: uMentions }),
          ...(allAtts.length > 0 && { attachments: allAtts })
        });
        return;
      }
      if (!currentAgent && !chatPartner) setLocalError('Выберите агента или пользователя для чата');
    } finally { isSendingRef.current = false; }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachments(prev => [...prev, ...Array.from(e.target.files || [])]);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    setAttachments(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
  };

  const handleAgentSelect = (agent: AIAgent) => {
    selectAgent(agent); setChatMode('ai');
    setChatPartner({ type: 'agent', id: agent.id, name: agent.name, icon: agent.icon });
    setChatParticipants([]); setBoundRows([]); setShowBoundRowsBar(false); setActivePanel('none');
    setVectorSearchResults(null);
  };

  const handleCheckboxClick = useCallback((info: any) => {
    const prefix = info.heading ? `[${info.heading}] ` : '';
    const status = info.checked ? '[x]' : '[ ]';
    const userTag = info.user ? ` — ${info.user.name} (${info.user.id})` : '';
    setInputValue(prev => prev ? `${prev}\n${prefix}${status} ${info.lineText}${userTag}` : `${prefix}${status} ${info.lineText}${userTag}`);
  }, []);

  return { handleSubmit, handleFileSelect, handleDrop, handleAgentSelect, handleCheckboxClick };
}

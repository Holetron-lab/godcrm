/**
 * useMessageSubmit — Handles message submission logic for AI agents and user/group chats.
 * Extracted from AIChatPanel.tsx handleSubmit (lines 1873-2042).
 */
import { useCallback, useRef, type FormEvent } from 'react';
import { logger } from '@/shared/utils/logger';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { validateAndWrapCommands } from '../../../utils/invocationTokens';
import type { MentionUser } from '../../MentionInput';
import type { BoundRow } from '../../RowBindingV2';
import type { ApiResponse } from '../../AIChatPanel.types';

interface UseMessageSubmitParams {
  inputValue: string;
  setInputValue: (v: string) => void;
  attachments: File[];
  setAttachments: (fn: (prev: File[]) => File[]) => void;
  mentionedUsers: MentionUser[];
  setMentionedUsers: (v: MentionUser[]) => void;
  messageBoundRows: BoundRow[];
  setMessageBoundRows: (v: BoundRow[]) => void;
  chatPartner: { type: string; id: number; name: string; participants?: Array<{ id: number }> } | null;
  currentAgent: { id: number } | null;
  agentMode: string;
  thinkingEnabled: boolean;
  sendMessage: (content: string, files?: File[], extra1?: unknown, mentions?: Array<{ id: number; name: string; type: string }>, useAgent?: boolean, extra2?: unknown, subAgents?: number[], rowAtts?: unknown[]) => Promise<void>;
  userConversationId: number | null;
  setUserConversationId: (id: number | null) => void;
  getOrCreateUserConversation: (participantIds: number[]) => Promise<number>;
  refetchUserMessages: () => void;
  effectiveSpaceId: number | string | undefined;
  setLocalError: (error: string | null) => void;
  availableMentionUsers: MentionUser[];
  availableSlashAgents: MentionUser[];
  currentSpaceId: number | string | undefined;
}

export function useMessageSubmit(params: UseMessageSubmitParams) {
  const {
    inputValue, setInputValue, attachments, setAttachments,
    mentionedUsers, setMentionedUsers, messageBoundRows, setMessageBoundRows,
    chatPartner, currentAgent, agentMode, thinkingEnabled,
    sendMessage, userConversationId, setUserConversationId,
    getOrCreateUserConversation, refetchUserMessages,
    effectiveSpaceId, setLocalError, availableMentionUsers, availableSlashAgents,
  } = params;

  const isSendingRef = useRef(false);

  // Send message in user conversation mutation
  const sendUserMessageMutation = useMutation({
    mutationFn: async ({ conversationId, content, agentMode: mode, thinking, mentions, attachments: msgAttachments }: {
      conversationId: number; content: string;
      agentMode?: 'ask' | 'read' | 'agent'; thinking?: boolean;
      mentions?: Array<{ user_id: number; name?: string; type?: string }>;
      attachments?: Array<{ id: string; name: string; type: string; size: number; url?: string; preview?: string; rowReference?: { table_id: number; row_id: number; table_name: string; table_icon?: string; row_title?: string } }>;
    }) => {
      const response = await apiClient.post<ApiResponse<{ id: number; content: string; sender_id: number }>>(`/chat/conversations/${conversationId}/messages`, {
        content, content_type: 'text',
        ...(mode && { agent_mode: mode }),
        ...(thinking !== undefined && { thinking_enabled: thinking }),
        ...(mentions && mentions.length > 0 && { mentions }),
        ...(msgAttachments && msgAttachments.length > 0 && {
          attachments: msgAttachments.map(a => ({ name: a.name, type: a.type, size: a.size, url: a.url, ...(a.rowReference && { rowReference: a.rowReference }) }))
        }),
      });
      return response?.data;
    },
    onSuccess: () => { refetchUserMessages(); }
  });

  const handleSubmit = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    let trimmedInput = inputValue.trim();
    // ADR-116: Only wrap /commands. Bare @mentions stay as references (not invocations).
    trimmedInput = validateAndWrapCommands(trimmedInput, availableSlashAgents || []);
    if (!trimmedInput && attachments.length === 0 && messageBoundRows.length === 0) return;

    if (isSendingRef.current) {
      logger.debug('[Chat v2] Blocked duplicate send');
      return;
    }
    isSendingRef.current = true;
    setLocalError(null);

    try {
      if (chatPartner?.type === 'agent' && currentAgent) {
        const filesToSend = [...attachments];
        const mentionsToSend = mentionedUsers.length > 0 ? mentionedUsers.map(u => ({ id: u.id, name: u.name, type: u.type })) : undefined;
        const rowAtts = messageBoundRows.length > 0 ? messageBoundRows.map(br => ({
          id: `row_${br.table_id}_${br.row_id}`, name: br.row_title || `Row #${br.row_id}`, type: 'row_reference', size: 0,
          rowReference: { table_id: br.table_id, row_id: br.row_id, table_name: br.table_name || '', table_icon: br.table_icon, row_title: br.row_title }
        })) : undefined;
        setInputValue(''); setAttachments(() => []); setMentionedUsers([]); setMessageBoundRows([]);
        const useAgentMode = agentMode === 'agent';
        await sendMessage(trimmedInput, filesToSend.length > 0 ? filesToSend : undefined, undefined, mentionsToSend, useAgentMode, undefined, undefined, rowAtts);
        return;
      }

      if (chatPartner?.type === 'user' || chatPartner?.type === 'group') {
        try {
          const participantIds = chatPartner.type === 'group'
            ? (chatPartner.participants?.map(p => p.id) || [])
            : [chatPartner.id];
          let convId = userConversationId;
          if (!convId) { convId = await getOrCreateUserConversation(participantIds); setUserConversationId(convId); }

          const hasAgentTrigger = /(?:^|\s|<<)[/@][a-z0-9_-]+/i.test(trimmedInput);
          const userMentions = mentionedUsers.length > 0 ? mentionedUsers.map(u => ({ user_id: u.id, name: u.name, type: u.type })) : undefined;

          let uploadedAttachments: Array<{ id: string; name: string; type: string; size: number; url?: string; preview?: string }> | undefined;
          if (attachments.length > 0) {
            try {
              const uploadResult = await filesApi.upload([...attachments], { spaceId: effectiveSpaceId });
              const uploadedFiles = Array.isArray(uploadResult) ? uploadResult : [uploadResult];
              uploadedAttachments = attachments.map((file, idx) => {
                const uploaded = uploadedFiles[idx];
                return { id: uploaded?.id || `att_${Date.now()}_${file.name}`, name: file.name, type: file.type, size: file.size, url: uploaded?.url || '', preview: file.type.startsWith('image/') ? (uploaded?.url || URL.createObjectURL(file)) : undefined };
              });
            } catch {
              uploadedAttachments = attachments.map(file => ({ id: `att_${Date.now()}_${file.name}`, name: file.name, type: file.type, size: file.size, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined }));
            }
          }

          const rowRefAttachments = messageBoundRows.length > 0 ? messageBoundRows.map(br => ({
            id: `row_${br.table_id}_${br.row_id}`, name: br.row_title || `Row #${br.row_id}`, type: 'row_reference', size: 0,
            rowReference: { table_id: br.table_id, row_id: br.row_id, table_name: br.table_name || '', table_icon: br.table_icon, row_title: br.row_title }
          })) : [];
          const allAttachments = [...(uploadedAttachments || []), ...rowRefAttachments];

          setInputValue(''); setAttachments(() => []); setMentionedUsers([]); setMessageBoundRows([]);
          await sendUserMessageMutation.mutateAsync({
            conversationId: convId, content: trimmedInput,
            ...(hasAgentTrigger && { agentMode: agentMode as 'ask' | 'read' | 'agent', thinking: thinkingEnabled }),
            ...(userMentions && { mentions: userMentions }),
            ...(allAttachments.length > 0 && { attachments: allAttachments }),
          });
        } catch (error) {
          logger.error('[Chat v2] Error sending user message:', error);
          setLocalError('Ошибка отправки сообщения');
        }
        return;
      }

      if (!currentAgent && !chatPartner) {
        setLocalError('Выберите агента или пользователя для чата');
      }
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.message || 'Ошибка отправки сообщения';
      logger.error('[Chat v2] Error sending message:', error);
      setLocalError(typeof msg === 'string' ? msg : 'Ошибка отправки сообщения');
    } finally {
      isSendingRef.current = false;
    }
  }, [inputValue, attachments, messageBoundRows, chatPartner, currentAgent, agentMode, thinkingEnabled, mentionedUsers, availableMentionUsers, availableSlashAgents, userConversationId, effectiveSpaceId, sendMessage, getOrCreateUserConversation, setInputValue, setAttachments, setMentionedUsers, setMessageBoundRows, setUserConversationId, setLocalError, sendUserMessageMutation, refetchUserMessages]);

  return {
    handleSubmit,
    sendUserMessageMutation,
  };
}

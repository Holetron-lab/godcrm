import type { useConversationSpace } from './useConversationSpace';
import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * useEventHandlers — Event handler callbacks for AIChatPanel.
 * ADR-119: Extracted from AIChatPanel.tsx (handleSubmit, handleFileSelect, handleDrop, handleAgentSelect, handleCheckboxClick).
 */
import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { filesApi } from '@/features/files/api/filesApi';
import { validateAndWrapCommands, stripInvocationTokens } from '../../../utils/invocationTokens';
import { generateConversationTitle } from '../../../context/AIChatContext/helpers';
import type { MentionUser } from '../../MentionInput';
import type { AIAgent, ChatMessage } from '../../../types';
import { boundRowToAttachment, type BoundRow } from '../../RowBindingV2';

import type { ChatActions } from '../types';

interface UseEventHandlersParams {
  conversationSpace?: Pick<ReturnType<typeof useConversationSpace>, 'ensureConversation' | 'ensureSpace' | 'assertActive'>;
  inputValue: string;
  setInputValue: (v: string | ((prev: string) => string)) => void;
  bindDraftToConversation?: (id: number) => void;
  attachments: File[];
  setAttachments: (v: File[] | ((prev: File[]) => File[])) => void;
  mentionedUsers: MentionUser[];
  setMentionedUsers: (v: MentionUser[] | ((prev: MentionUser[]) => MentionUser[])) => void;
  messageBoundRows: BoundRow[];
  setMessageBoundRows: (v: BoundRow[] | ((prev: BoundRow[]) => BoundRow[])) => void;
  boundRows: BoundRow[];
  setLocalError: (v: string | null) => void;
  setDragOver: (v: boolean) => void;
  chatPartner: { type: string; id: number; name: string; icon?: string; participants?: Array<{ id: number }> } | null;
  currentAgent: AIAgent | null;
  agentMode: string;
  thinkingEnabled: boolean;
  userConversationId: number | null;
  setUserConversationId: (id: number | null) => void;
  currentSpaceId: number | undefined;
  effectiveSpaceId: number | undefined;
  voiceBusy?: boolean;
  availableMentionUsers: MentionUser[];
  availableSlashAgents: MentionUser[];
  // Context actions
  sendMessage: (...args: any[]) => Promise<any>;
  selectAgent: (agent: AIAgent) => void;
  // Agent send via useConversationMessages (Variant B — optimistic updates in React Query cache)
  aiSendMessage?: (params: any) => Promise<any>;
  // Mutations
  sendUserMessageMutation: { mutateAsync: (params: any) => Promise<any> };
  // State setters for agent select
  setChatMode: ChatActions['setChatMode'];
  setChatPartner: (v: any) => void;
  setChatParticipants: (v: any) => void;
  setBoundRows: (v: any) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  setActivePanel: (v: string) => void;
  setVectorSearchResults: (v: any) => void;
  scrollToBottom?: (behavior?: ScrollBehavior) => void;
  // For Variant B: conversation creation when aiSendMessage is used
  currentConversationId?: number | null;
  setCurrentConversationId?: (id: number | null) => void;
  labId?: string | null;
  setIsAgentProcessing?: (v: boolean) => void;
  loadConversations?: () => Promise<void>;
  // Forwarded messages
  forwardMessages?: ChatMessage[];
  setForwardMessages?: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  // Move queue (mirrors forwardMessages — quoted blocks, but with перенос header)
  moveMessages?: ChatMessage[];
  setMoveMessages?: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  // Quote (continue agent)
  setQuoteMessage?: (v: { text: string; sender: string; agentColor?: string } | null) => void;
  // ADR-0068 WP-C: composer reply-to (server validates fragment/range against source)
  replyTo?: { message_id: number; fragment?: string; range?: [number, number] } | null;
  setReplyTo?: (v: { message_id: number; fragment?: string; range?: [number, number] } | null) => void;
}

export function useEventHandlers(params: UseEventHandlersParams) {
  const { t } = useLanguage();
  // Hold params in a ref so handler identities stay stable across renders.
  // Handlers read latest values from paramsRef.current at invocation time —
  // prevents per-keystroke prop churn that re-renders MessagesArea.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const isSendingRef = useRef(false);
  const uploadedFiles = useRef(new WeakMap<File, Map<number, { id: string; name: string; type: string; size: number; url: string }>>());
  const queryClient = useQueryClient();

  // ADR-0031 P5: physically move queued messages from their source conversations
  // into the active target conversation. Queue groups by source so each batch is
  // a single transaction in messageMoveService. 403 → "Нет прав", others → toast.
  const performMoves = useCallback(async (
    queue: ChatMessage[],
    targetConvId: number,
  ) => {
    const groups = new Map<number, number[]>();
    for (const m of queue) {
      const srcId = Number(m.conversation_id);
      const mid = Number(m.id);
      if (!Number.isFinite(srcId) || srcId <= 0) continue;
      if (!Number.isFinite(mid) || mid <= 0) continue;
      if (srcId === targetConvId) continue;
      const cur = groups.get(srcId) || [];
      cur.push(mid);
      groups.set(srcId, cur);
    }
    if (groups.size === 0) return;

    let movedTotal = 0;
    for (const [srcId, ids] of groups) {
      try {
        const resp: any = await apiClient.post(
          `/chat/conversations/${srcId}/messages/move`,
          { target_conversation_id: targetConvId, message_ids: ids },
        );
        movedTotal += Number(resp?.data?.moved_count ?? ids.length);
        // ADR-0031: source rows are mutated in place (content_type→'moved'),
        // not appended — incremental polling (`?after=lastId`) won't refresh
        // them. resetQueries clears cached pages so the source refetches fresh
        // on next mount (useConversationMessages has refetchOnMount:false).
        queryClient.resetQueries({ queryKey: ['conversation-messages', srcId] });
        queryClient.invalidateQueries({ queryKey: ['conversation', srcId] });
      } catch (err: any) {
        const status = err?.status;
        const msg = err?.data?.error?.message || err?.data?.message || err?.message || t('aiChat.ui.moveFailed');
        logger.error('[Chat v2] move failed:', err);
        if (status === 403) showToast(t('aiChat.ui.moveForbidden'), 'error');
        else showToast(msg, 'error');
      }
    }
    queryClient.invalidateQueries({ queryKey: ['conversation-messages', targetConvId] });
    queryClient.invalidateQueries({ queryKey: ['conversation', targetConvId] });
    queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] });
    if (movedTotal > 0) showToast(t('aiChat.ui.messagesMoved', { count: movedTotal }), 'success');
  }, [queryClient, t]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    const {
      inputValue, setInputValue, bindDraftToConversation, attachments, setAttachments,
      mentionedUsers, setMentionedUsers, messageBoundRows, setMessageBoundRows,
      boundRows,
      setLocalError, chatPartner, currentAgent,
      agentMode, thinkingEnabled,
      userConversationId, setUserConversationId, effectiveSpaceId,
      availableSlashAgents,
      sendMessage, aiSendMessage, sendUserMessageMutation,
      setChatMode, setChatPartner, setChatParticipants, setBoundRows,
      setShowBoundRowsBar, setActivePanel, setVectorSearchResults, scrollToBottom,
      currentConversationId, setCurrentConversationId,
      labId, setIsAgentProcessing, loadConversations,
      forwardMessages = [], setForwardMessages,
      moveMessages = [], setMoveMessages,
      setQuoteMessage,
      replyTo, setReplyTo, conversationSpace,
    } = paramsRef.current;
    e?.preventDefault();
    if (paramsRef.current.voiceBusy) return;
    let trimmed = inputValue.trim();
    // ADR-116: Only wrap /commands automatically. Bare @mentions stay as references.
    // Invocation @mentions (<<@slug>>) are inserted by the MentionInput dropdown.
    trimmed = validateAndWrapCommands(trimmed, availableSlashAgents || []);
    if (!trimmed && attachments.length === 0 && messageBoundRows.length === 0 && forwardMessages.length === 0 && moveMessages.length === 0) return;

    const forwardedAttachments = forwardMessages.flatMap(message => message.attachments ?? []);

    // Build forwarded content block
    if (forwardMessages.length > 0) {
      const fwdBlocks = forwardMessages.map(msg => {
        // ADR-0031: row_mutation = service-authored. sender_name from JOIN is
        // the actor's name, but the message's true author is "system".
        const isSystemEvent = msg.senderType === 'system' || (msg.role === 'system' && msg.contentType === 'row_mutation');
        const sender = isSystemEvent
          ? 'system'
          : (msg.sender_name || msg.agentName || (msg.role === 'user' ? 'User' : 'Agent'));
        const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleString('ru') : '';
        const convId = msg.conversation_id || '';
        const msgId = msg.id || '';
        const color = msg.agent_color || (msg.metadata as Record<string, unknown>)?.agent_color || '';
        const safeContent = stripInvocationTokens(msg.content || '');
        const footerColor = color ? `, цвет ${color}` : '';
        return `> **${sender}** ${ts ? `(${ts})` : ''}\n> ${safeContent.split('\n').join('\n> ')}\n> _чат #${convId}, сообщение #${msgId}${footerColor}_`;
      }).join('\n\n');
      trimmed = fwdBlocks + (trimmed ? '\n\n' + trimmed : '');
    }

    // ADR-0031 P5: snapshot move queue, clear UI immediately. Actual physical
    // move happens via POST /messages/move after the target conv is ensured.
    // No quote-block injection — moved messages physically relocate.
    const moveQueue: ChatMessage[] = moveMessages.length > 0 ? [...moveMessages] : [];
    if (moveQueue.length > 0) setMoveMessages?.([]);
    const hasOtherContent = trimmed.length > 0
      || attachments.length > 0
      || messageBoundRows.length > 0
      || forwardMessages.length > 0;

    // Clear quote card
    setQuoteMessage?.(null);
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    setLocalError(null);
    const clearSentDraft = () => {
      const current = paramsRef.current;
      if (current.chatPartner?.type !== chatPartner?.type || current.chatPartner?.id !== chatPartner?.id) return;
      const originalId = chatPartner?.type === 'agent' ? currentConversationId : userConversationId;
      const nowId = chatPartner?.type === 'agent' ? current.currentConversationId : current.userConversationId;
      if (originalId && originalId !== nowId) return;
      setForwardMessages?.(value => value.filter(message => !forwardMessages.includes(message)));
      setInputValue(value => value === inputValue ? '' : value);
      setAttachments(value => value.filter(file => !attachments.includes(file)));
      setMentionedUsers(value => value.filter(user => !mentionedUsers.includes(user)));
      setMessageBoundRows(value => value.filter(row => !messageBoundRows.includes(row)));
    };
    const uploadAttachments = async (files: File[], conversationId?: number | null) => {
      if (!files.length) return [];
      let spaceId = effectiveSpaceId;
      if (conversationSpace) {
        spaceId = await conversationSpace.ensureSpace();
        conversationSpace.assertActive();
      } else if (conversationId) {
        const response = await apiClient.get<{ data: { space_id: number | null } }>(`/chat/conversations/${conversationId}`);
        spaceId = response.data.space_id ?? undefined;
      }
      if (!spaceId) throw new Error(t('aiChat.ui.attachmentSpaceUnknown'));
      const missing = files.filter(file => !uploadedFiles.current.get(file)?.has(spaceId));
      if (missing.length) {
        const response = await filesApi.upload(missing, { spaceId });
        const uploaded = Array.isArray(response) ? response : [response];
        if (uploaded.length !== missing.length || uploaded.some(file => !file?.url)) {
          throw new Error(t('aiChat.ui.attachmentUploadFailed'));
        }
        missing.forEach((file, index) => {
          const cache = uploadedFiles.current.get(file) ?? new Map();
          cache.set(spaceId, { id: uploaded[index].id, name: file.name, type: file.type, size: file.size, url: uploaded[index].url });
          uploadedFiles.current.set(file, cache);
        });
      }
      return files.map(file => uploadedFiles.current.get(file)!.get(spaceId)!);
    };
    try {
      const ensuredId = await conversationSpace?.ensureConversation();
      conversationSpace?.assertActive();
      if (chatPartner?.type === 'agent' && currentAgent) {
        // Variant B: Use aiSendMessage (useConversationMessages) for optimistic updates in React Query cache.
        // Falls back to context sendMessage if aiSendMessage not available (e.g., no conversation yet).
        const files = [...attachments];
        const mentions = mentionedUsers.length > 0 ? mentionedUsers.map(u => ({ id: u.id, name: u.name, type: u.type })) : undefined;
        const rowAtts = messageBoundRows.length > 0 ? messageBoundRows.map(boundRowToAttachment) : undefined;
        // Trigger scroll-to-bottom BEFORE optimistic update — sets sticky flag
        // so scroll management keeps scrolling through re-renders (optimistic → server replace → polling).
        scrollToBottom?.();

        if (aiSendMessage) {
          // Ensure conversation exists — create if needed (also required when only
          // a move queue is present, so we have a target id for /messages/move).
          let convIdOverride = ensuredId && ensuredId !== currentConversationId ? ensuredId : undefined;
          const existingConvId = ensuredId ?? currentConversationId;
          if (!existingConvId) {
            // Carry over conv-level row binding so backend persists it on creation —
            // BoundRowsStrip can only PATCH after a conv exists; first send is the only chance.
            const convBound = boundRows[0];
            const createResp = await apiClient.post<{ success: boolean; data: { id: number } }>('/chat/conversations', {
              title: generateConversationTitle(trimmed || t('aiChat.ui.move')),
              type: 'chat',
              space_id: effectiveSpaceId,
              sub_agents: [currentAgent.id],
              ...(labId && { lab_id: labId }),
              ...(convBound && {
                bound_table_id: convBound.table_id,
                bound_row_id: convBound.row_id,
              }),
            });
            if (createResp.success && createResp.data) {
              convIdOverride = createResp.data.id;
              bindDraftToConversation?.(convIdOverride);
              setCurrentConversationId?.(convIdOverride);
            }
          }
          const targetConvId = convIdOverride ?? existingConvId ?? null;
          if (!targetConvId) throw new Error(t('aiChat.ui.sendMessageFailed'));
          const uploadedAtts = await uploadAttachments(files, targetConvId);
          conversationSpace?.assertActive();
          const allAtts = [
            ...forwardedAttachments, ...uploadedAtts,
            ...(rowAtts?.map(r => ({ name: r.name, type: r.type, size: r.size, rowReference: r.rowReference })) || []),
          ];

          // Set processing state for fast polling
          if (agentMode === 'agent' && hasOtherContent) setIsAgentProcessing?.(true);

          if (hasOtherContent) {
            await aiSendMessage({
              content: trimmed,
              ...(mentions && { mentions: mentions.map(m => ({ user_id: m.id, name: m.name, type: m.type })) }),
              agentMode: agentMode === 'agent' ? 'agent' : 'ask',
              ...(allAtts.length > 0 && { attachments: allAtts }),
              ...(convIdOverride && { overrideConversationId: convIdOverride }),
              ...(replyTo && { replyTo }),
            });
            clearSentDraft();
            setReplyTo?.(null);
          }

          // ADR-0031 P5: physical move via API (after target conv is ensured).
          if (moveQueue.length > 0 && targetConvId) {
            await performMoves(moveQueue, targetConvId);
          }

          // Refresh conversations list
          loadConversations?.();
        } else {
          // Fallback: use old path. Same reason for forwarding boundRows[0] as Variant B above.
          const convBound = boundRows[0];
          const convBoundPayload = convBound ? { table_id: convBound.table_id, row_id: convBound.row_id } : undefined;
          if (hasOtherContent) {
            const uploaded = await uploadAttachments(files, ensuredId ?? currentConversationId);
            conversationSpace?.assertActive();
            await sendMessage(trimmed, undefined, undefined, mentions, agentMode === 'agent', undefined, undefined, [...forwardedAttachments, ...uploaded, ...(rowAtts ?? [])], convBoundPayload, replyTo || undefined);
            clearSentDraft();
            setReplyTo?.(null);
          }
          if (moveQueue.length > 0 && currentConversationId) {
            await performMoves(moveQueue, currentConversationId);
          }
        }
        return;
      }
      if (chatPartner?.type === 'user' || chatPartner?.type === 'group') {
        const pIds = chatPartner.type === 'group' ? ((chatPartner as any).participants?.map((p: any) => p.id) || []) : [chatPartner.id];
        let convId = ensuredId ?? userConversationId;
        if (!convId) {
          const resp = await apiClient.post<any>('/chat/conversations', { type: 'chat', participant_ids: pIds, space_id: effectiveSpaceId });
          convId = resp.data.id;
          bindDraftToConversation?.(convId!);
          setUserConversationId(convId);
        }
        const hasAgentTrigger = /(^|\s)[/@][a-z0-9_-]+/i.test(trimmed);
        const uMentions = mentionedUsers.length > 0 ? mentionedUsers.map(u => ({ user_id: u.id, name: u.name, type: u.type })) : undefined;
        const uploadedAtts = await uploadAttachments(attachments, convId);
        conversationSpace?.assertActive();
        const rowRefs = messageBoundRows.map(boundRowToAttachment);
        const allAtts = [...forwardedAttachments, ...(uploadedAtts || []), ...rowRefs];
        scrollToBottom?.();
        if (hasOtherContent) {
          await sendUserMessageMutation.mutateAsync({
            conversationId: convId!, content: trimmed,
            ...(hasAgentTrigger && { agentMode, thinking: thinkingEnabled }),
            ...(uMentions && { mentions: uMentions }),
            ...(allAtts.length > 0 && { attachments: allAtts }),
            ...(replyTo && { replyTo })
          });
          clearSentDraft();
          setReplyTo?.(null);
        }
        // ADR-0031 P5: physical move via API.
        if (moveQueue.length > 0 && convId) {
          await performMoves(moveQueue, convId);
        }
        return;
      }
      if (!currentAgent && !chatPartner) setLocalError(t('aiChat.ui.chooseChatPartner'));
    } catch (err: any) {
      try { conversationSpace?.assertActive(); } catch { return; }
      const msg = err?.response?.data?.error || err?.message || t('aiChat.ui.sendMessageFailed');
      logger.error('[Chat v2] Error sending message:', err);
      setLocalError(typeof msg === 'string' ? msg : t('aiChat.ui.sendMessageFailed'));
    } finally { isSendingRef.current = false; }
  }, [t]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const { setAttachments } = paramsRef.current;
    // Snapshot files synchronously: the updater runs in a later microtask, by which
    // point `e.target.value = ''` below has cleared `e.target.files` — causing the
    // "every other attach drops the file" race users have hit.
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;
    setAttachments(prev => [...prev, ...files]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    const { setAttachments, setDragOver } = paramsRef.current;
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setAttachments(prev => [...prev, ...files]);
  }, []);

  const handleAgentSelect = useCallback((agent: AIAgent) => {
    const {
      selectAgent, setChatMode, setChatPartner, setChatParticipants,
      setBoundRows, setShowBoundRowsBar, setActivePanel, setVectorSearchResults,
    } = paramsRef.current;
    selectAgent(agent); setChatMode('ai');
    setChatPartner({ type: 'agent', id: agent.id, name: agent.name, icon: agent.icon });
    setChatParticipants([]); setBoundRows([]); setShowBoundRowsBar(false); setActivePanel('none');
    setVectorSearchResults(null);
  }, []);

  const handleCheckboxClick = useCallback((info: any) => {
    const { setInputValue } = paramsRef.current;
    const prefix = info.heading ? `[${info.heading}] ` : '';
    const status = info.checked ? '[x]' : '[ ]';
    setInputValue(prev => prev ? `${prev}\n${prefix}${status} ${info.lineText}` : `${prefix}${status} ${info.lineText}`);
  }, []);

  return { handleSubmit, handleFileSelect, handleDrop, handleAgentSelect, handleCheckboxClick };
}

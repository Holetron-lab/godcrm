import { useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { filesApi, type FileModel } from '@/features/files/api/filesApi';
import type { AIAgent, ChatMessage, ChatAttachment } from './types';
import type { Mention } from './types';
import { withRetry, generateConversationTitle } from './helpers';

interface UseSendMessageOptions {
  currentAgent: AIAgent | null;
  spaceId?: number;
  messages: ChatMessage[];
  agentMode: boolean;
  labId: string | null;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setIsLoading: (loading: boolean) => void;
  setIsStreaming: (streaming: boolean) => void;
  setError: (error: string | null) => void;
  setIsAgentProcessing: (processing: boolean) => void;
  setCurrentConversationId: (id: number | null) => void;
  currentConversationIdRef: React.MutableRefObject<number | null>;
  loadConversations: () => Promise<void>;
}

export function useSendMessage({
  currentAgent,
  spaceId,
  messages,
  agentMode,
  labId,
  setMessages,
  setIsLoading,
  setIsStreaming,
  setError,
  setIsAgentProcessing,
  setCurrentConversationId,
  currentConversationIdRef,
  loadConversations,
}: UseSendMessageOptions) {
  const sendMessage = useCallback(
    async (content: string, attachments?: File[], modelId?: number, mentions?: Mention[], useAgentMode?: boolean, systemPromptPrefix?: string, subAgentRowIds?: number[], rowAttachments?: Array<{ id: string; name: string; type: string; size: number; rowReference: { table_id: number; row_id: number; table_name: string; table_icon?: string; row_title?: string } }>) => {
      if (!currentAgent || !spaceId) {
        setError('No agent selected or space not found');
        return;
      }

      // Use agentMode state if not explicitly passed
      const runAsAgent = useAgentMode ?? agentMode;

      // -- Upload attachments to server BEFORE building the message --
      // This ensures we have real URLs (not blob: URLs) for file previews
      let uploadedAttachments: { id: string; name: string; type: string; size: number; url?: string; preview?: string }[] | undefined;
      if (attachments && attachments.length > 0) {
        try {
          const uploadResult = await filesApi.upload(attachments, { spaceId });
          const uploadedFiles: FileModel[] = Array.isArray(uploadResult) ? uploadResult : [uploadResult];

          uploadedAttachments = attachments.map((file, idx) => {
            const uploaded = uploadedFiles[idx];
            const fileUrl = uploaded?.url || '';
            return {
              id: uploaded?.id || `att_${Date.now()}_${file.name}`,
              name: file.name,
              type: file.type,
              size: file.size,
              url: fileUrl,
              preview: file.type.startsWith('image/') ? (fileUrl || URL.createObjectURL(file)) : undefined
            };
          });
        } catch (uploadErr) {
          logger.error('[AI Chat] File upload failed, sending without URLs:', uploadErr);
          // Fallback: send attachments without URLs (old behavior)
          uploadedAttachments = attachments.map((file) => ({
            id: `att_${Date.now()}_${file.name}`,
            name: file.name,
            type: file.type,
            size: file.size,
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
          }));
        }
      }

      // Ticket #77794: Merge file attachments + row reference attachments
      const allAttachments: ChatAttachment[] = [
        ...(uploadedAttachments || []),
        ...(rowAttachments || []),
      ];

      const userMessageId = `msg_${Date.now()}_user`;
      // Get current user ID for sender_id — ensures message grouping works correctly
      const authUserId = useAuthStore.getState().user?.id;
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: 'user',
        content,
        timestamp: new Date(),
        ...(authUserId != null && { sender_id: Number(authUserId) }),
        attachments: allAttachments.length > 0 ? allAttachments : undefined
      };

      const newMessages = [...messages, userMessage];
      setMessages(newMessages);
      setIsLoading(true);
      setError(null);

      try {
        // -- ADR-093 / D3: Unified message path --
        // All messages go through POST /chat/conversations/:id/messages
        // Backend handles agent execution asynchronously; polling picks up responses

        // 1. Ensure conversation exists (create via /chat/conversations if needed)
        let convId = currentConversationIdRef.current;
        if (!convId) {
          // Bug fix: Always include current agent in sub_agents when creating conversation.
          // Without this, the selected agent is not a conversation participant and won't
          // auto-respond — the backend falls through to the space's default agent instead.
          const allSubAgents = [...(subAgentRowIds || [])];
          if (currentAgent.id && !allSubAgents.includes(currentAgent.id)) {
            allSubAgents.unshift(currentAgent.id);
          }
          const createResp = await apiClient.post<{
            success: boolean;
            data: { id: number };
          }>('/chat/conversations', {
            title: generateConversationTitle(content),
            type: 'chat',
            space_id: spaceId,
            lab_id: labId || undefined,
            ...(allSubAgents.length > 0 && { sub_agents: allSubAgents }),
          });
          if (createResp.success && createResp.data) {
            convId = createResp.data.id;
            currentConversationIdRef.current = convId;
            setCurrentConversationId(convId);
          }
        }

        if (!convId) {
          throw new Error('Failed to create or find conversation');
        }

        // 2. Set processing state for agent mode before the request
        if (runAsAgent) {
          setIsAgentProcessing(true);
        }

        // 3. Send message via unified endpoint
        //    Backend saves user message, determines responding agents, spawns async agent execution
        //    Returns 201 immediately — agent responses arrive via polling
        // Ticket #77794: Send merged attachments (files + row references) to backend
        const backendAttachments = allAttachments.length > 0
          ? allAttachments.map(a => ({
              name: a.name, type: a.type, size: a.size, url: a.url,
              ...(a.rowReference && { rowReference: a.rowReference }),
            }))
          : undefined;

        await withRetry(
          () => apiClient.post(`/chat/conversations/${convId}/messages`, {
            content,
            content_type: 'text',
            agent_mode: runAsAgent ? 'agent' : 'ask',
            mentions: mentions?.map(m => ({ user_id: m.id, name: m.name, type: m.type })),
            ...(backendAttachments && { attachments: backendAttachments })
          }),
          [3000, 8000, 20000]
        );

        // 4. Post-send cleanup
        setIsLoading(false);

        if (!runAsAgent) {
          // Non-agent mode: response will arrive via polling (useConversationMessages)
          // No streaming placeholder needed — polling handles everything
          setIsStreaming(false);
        }

        // Trigger immediate refresh of conversations list
        loadConversations();

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        setIsLoading(false);
        setIsStreaming(false);
        if (runAsAgent) {
          setIsAgentProcessing(false);
        }
      }
    },
    [currentAgent, spaceId, messages, agentMode, labId, loadConversations, setMessages, setIsLoading, setIsStreaming, setError, setIsAgentProcessing, setCurrentConversationId, currentConversationIdRef]
  );

  return sendMessage;
}

import { generateConversationTitle } from '../../../context/AIChatContext/helpers';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

export interface Conversation {
  id: number;
  created_by: number;
  space_id: number | null;
  type: string;
  bound_table_id?: number | null;
  bound_row_id?: number | null;
  parent_conversation_id?: number | null;
  comment_thread_child_id?: number | null;
}
interface Options {
  conversationId: number | null;
  partnerKey: string;
  userId?: number;
  createConversation: () => Promise<number>;
  onCreated: (id: number) => void;
  onSaved?: () => Promise<void>;
}
interface Selection {
  promise: Promise<number>;
  resolve: (spaceId: number) => void;
  reject: (error: Error) => void;
}
const interrupted = () => new Error('Выбор Space отменён. Черновик сохранён.');
export const spaceBindingRestriction = (conversation: Conversation, userId?: number) => {
  if (!userId || Number(conversation.created_by) !== userId) return 'Владелец чата должен выбрать Space';
  if (conversation.type !== 'chat' || conversation.bound_table_id || conversation.bound_row_id || conversation.parent_conversation_id || conversation.comment_thread_child_id) {
    return 'Space нельзя менять у чата, связанного со строкой или другими чатами.';
  }
  return null;
};

/** One pending selection per chat; every batch reads persisted scope before uploading. */
export function useConversationSpace(options: Options) {
  const client = useQueryClient();
  const latest = useRef(options);
  latest.current = options;
  const sessionRef = useRef({ scopeKey: `${options.partnerKey}:${options.conversationId}`, partnerKey: options.partnerKey, id: options.conversationId, observedId: options.conversationId, alive: true, creation: null as Promise<number> | null, selection: null as Selection | null, resolving: null as Promise<number> | null, saving: false });
  let session = sessionRef.current;
  if (session.partnerKey !== options.partnerKey || (options.conversationId !== session.observedId && options.conversationId !== session.id)) {
    session.alive = false;
    session = { scopeKey: `${options.partnerKey}:${options.conversationId}`, partnerKey: options.partnerKey, id: options.conversationId, observedId: options.conversationId, alive: true, creation: null, selection: null, resolving: null, saving: false };
    sessionRef.current = session;
  }
  session.observedId = options.conversationId;
  const [dialogSession, setDialogSession] = useState<typeof session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const assertActive = () => {
    if (!session.alive || sessionRef.current !== session) throw interrupted();
  };
  useEffect(() => {
    session.alive = true;
    return () => {
      session.alive = false;
      session.selection?.reject(interrupted());
      session.selection = null;
    };
  }, [session]);
  const read = async (id: number) => {
    const response = await apiClient.get<{ data: Conversation }>(`/chat/conversations/${id}`);
    client.setQueryData(['conversation', id], response.data);
    return response.data;
  };
  const metadata = useQuery({ queryKey: ['conversation', options.conversationId], queryFn: () => read(options.conversationId!), enabled: !!options.conversationId });
  const ensureConversation = async () => {
    assertActive();
    if (session.id) return session.id;
    if (!session.creation) {
      const snapshot = latest.current;
      session.creation = snapshot.createConversation().then(id => {
        session.id = id;
        assertActive();
        snapshot.onCreated(id);
        return id;
      }).catch(cause => { session.creation = null; throw cause; });
    }
    const id = await session.creation;
    assertActive();
    return id;
  };
  const select = () => {
    assertActive();
    if (!session.selection) {
      let resolve!: Selection['resolve']; let reject!: Selection['reject'];
      const promise = new Promise<number>((res, rej) => { resolve = res; reject = rej; });
      session.selection = { promise, resolve, reject };
      setError(null);
      setSaving(false);
      setDialogSession(session);
    }
    return session.selection.promise;
  };
  const ensureSpace = (): Promise<number> => {
    // File selection and Send may arrive together while metadata is still loading.
    if (!session.resolving) {
      session.resolving = (async () => {
        const id = await ensureConversation();
        const conversation = await read(id);
        assertActive();
        if (conversation.space_id) return conversation.space_id;
        const restriction = spaceBindingRestriction(conversation, latest.current.userId);
        if (restriction) throw new Error(restriction);
        return select();
      })().finally(() => { session.resolving = null; });
    }
    return session.resolving;
  };
  const openSettings = async () => {
    try {
      const id = await ensureConversation();
      const conversation = await read(id);
      assertActive();
      const restriction = spaceBindingRestriction(conversation, latest.current.userId);
      if (restriction) throw new Error(restriction);
      await select();
    } catch (cause) {
      if (session.alive) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить Space чата.');
    }
  };
  const cancel = () => {
    session.selection?.reject(interrupted());
    session.selection = null;
    setDialogSession(null);
  };
  const save = async (spaceId: number) => {
    const selection = session.selection;
    if (!selection || session.saving || !session.id) return;
    session.saving = true;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.patch<{ success: boolean }>(`/chat/conversations/${session.id}/space`, { space_id: spaceId });
      if (!response.success) throw new Error('Не удалось сохранить Space. Повторите попытку.');
      const conversation = await read(session.id);
      await options.onSaved?.();
      await Promise.all(['conversation', 'conversations', 'inbox-conversations'].map(key => client.invalidateQueries({ queryKey: key === 'conversation' ? [key, session.id] : [key] })));
      assertActive();
      if (!conversation.space_id) throw new Error('Space не сохранён. Повторите попытку.');
      // Cancel or navigation during PATCH must never resurrect an interrupted action.
      if (session.selection === selection) {
        session.selection = null;
        setDialogSession(null);
        selection.resolve(conversation.space_id);
      }
    } catch (cause) {
      if (session.alive && session.selection === selection) {
        setError(cause instanceof Error && cause.message !== 'Conversation space binding refused' ? cause.message : 'Смена Space недоступна. Нужны права владельца чата и администратора Space; чаты со строками и дочерними чатами не поддерживаются.');
      }
    } finally {
      session.saving = false;
      if (session.alive) setSaving(false);
    }
  };
  const resolveTarget = async () => {
    const conversationId = await ensureConversation();
    const spaceId = await ensureSpace();
    assertActive();
    return { conversationId, spaceId };
  };
  return { scopeKey: session.scopeKey, resolveTarget, ensureConversation, ensureSpace, assertActive, openSettings, save, cancel,
    dialogOpen: dialogSession === session && !!session.selection, saving, error,
    conversation: metadata.data, loading: !!options.conversationId && metadata.isPending, loadError: metadata.isError,
    retryMetadata: metadata.refetch,
    restriction: metadata.data ? spaceBindingRestriction(metadata.data, options.userId) : null,
  };
}

interface PanelOptions extends Omit<Options, 'createConversation'> {
  draft: { spaceId?: number; title: string; agentId?: number; participantIds?: number[]; labId?: string | null; boundRow?: { table_id: number; row_id: number } } | null;
  attachments: File[];
  onAttachmentError: (message: string) => void;
}

/** Panel adapter keeps draft creation and all attachment entry paths together. */
export function usePanelConversationSpace({ draft, attachments, onAttachmentError, ...options }: PanelOptions) {
  const binding = useConversationSpace({
    ...options,
    createConversation: async () => {
      if (!draft) throw new Error('Выберите собеседника.');
      const response = await apiClient.post<{ success: boolean; data: { id: number } }>('/chat/conversations', {
        type: 'chat', space_id: draft.spaceId, title: generateConversationTitle(draft.title),
        ...(draft.agentId ? { sub_agents: [draft.agentId] } : { participant_ids: draft.participantIds ?? [] }),
        ...(draft.labId && { lab_id: draft.labId }),
        ...(draft.boundRow && { bound_table_id: draft.boundRow.table_id, bound_row_id: draft.boundRow.row_id }),
      });
      if (!response.success || !response.data?.id) throw new Error('Не удалось создать чат. Черновик сохранён.');
      return response.data.id;
    },
  });
  // Picker, drop and clipboard all append File objects to the same draft.
  const seenAttachments = useRef(new WeakSet<File>());
  useEffect(() => {
    const added = attachments.filter(file => !seenAttachments.current.has(file));
    added.forEach(file => seenAttachments.current.add(file));
    if (!added.length) return;
    void binding.ensureSpace().catch(cause => {
      try { binding.assertActive(); } catch { return; }
      onAttachmentError(cause instanceof Error ? cause.message : 'Не удалось определить Space чата.');
    });
  }, [attachments, binding, onAttachmentError]);
  return binding;
}

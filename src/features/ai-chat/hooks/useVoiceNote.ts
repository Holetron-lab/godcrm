import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { filesApi } from '@/features/files/api/filesApi';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { useVoiceMessage } from './useVoiceMessage';

type Target = { conversationId: number; spaceId: number };
interface Options {
  scopeKey: string;
  resolveTarget: () => Promise<Target>;
  assertTargetActive?: () => void;
  onSent: (conversationId: number) => void;
}
interface Note {
  clientId: string;
  scopeKey: string;
  text: string[];
  file?: File;
  fileId?: string;
  target?: Target;
  resolveTarget: Options['resolveTarget'];
  onSent: Options['onSent'];
  assertTargetActive?: () => void;
}

/** A stopped recording is a system note, separate from the ordinary text draft. */
export function useVoiceNote(options: Options) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const currentScope = useRef(options.scopeKey);
  currentScope.current = options.scopeKey;
  const capture = useRef<Note | null>(null);
  const sending = useRef(false);
  const [pending, setPending] = useState<Note | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const voice = useVoiceMessage({
    scopeKey: options.scopeKey,
    resolveSpaceId: async () => {
      const note = capture.current;
      if (!note) throw new Error(t('aiChat.ui.voiceNoteInterrupted'));
      note.assertTargetActive?.();
      const target = await note.resolveTarget();
      note.assertTargetActive?.();
      return target.spaceId;
    },
    onResult: text => { capture.current?.text.push(text); },
    onRecorded: file => {
      if (!capture.current) return;
      capture.current.file = file;
      setPending(capture.current);
    },
  });

  const { retryTranscription } = voice;
  const send = useCallback(async (note: Note) => {
    if (sending.current || !note.file) return;
    sending.current = true;
    setIsSending(true);
    setSendError(null);
    try {
      note.assertTargetActive?.();
      if (await retryTranscription() === false) throw new Error(t('aiChat.ui.voiceNoteSendFailed'));
      note.assertTargetActive?.();
      if (!note.fileId) {
        note.target = await note.resolveTarget();
        note.assertTargetActive?.();
        const result = await filesApi.upload([note.file], { spaceId: note.target.spaceId });
        const uploaded = Array.isArray(result) ? result[0] : result;
        if (!uploaded?.id) throw new Error(t('aiChat.ui.attachmentUploadFailed'));
        note.fileId = uploaded.id;
      }
      note.assertTargetActive?.();
      if (!note.target) throw new Error(t('aiChat.ui.voiceNoteSendFailed'));
      const response = await apiClient.post<{ success: boolean; error?: { message?: string } }>(`/chat/conversations/${note.target.conversationId}/voice-notes`, {
        client_id: note.clientId, file_id: note.fileId, text: note.text.join(' '),
        duration: (note.file as File & { duration?: number }).duration,
      });
      if (!response.success) throw new Error(response.error?.message || t('aiChat.ui.voiceNoteSendFailed'));
    } catch {
      // Retain both the bytes and the idempotency key: a network error may hide a successful POST.
      setSendError(t('aiChat.ui.voiceNoteSendFailed'));
      return;
    } finally {
      sending.current = false;
      setIsSending(false);
    }
    setPending(null);
    capture.current = null;
    void queryClient.invalidateQueries({ queryKey: ['conversation-messages', note.target.conversationId] });
    if (currentScope.current === note.scopeKey) note.onSent(note.target.conversationId);
  }, [queryClient, t, retryTranscription]);

  useEffect(() => {
    if (!pending || sendError || isSending || voice.isRecording || voice.isProcessing) return;
    if (voice.transcriptionBlocked || pending.scopeKey !== options.scopeKey) {
      setSendError(t('aiChat.ui.voiceNoteInterrupted'));
      return;
    }
    void send(pending);
  }, [pending, sendError, isSending, voice.isRecording, voice.isProcessing, voice.transcriptionBlocked, options.scopeKey, send, t]);

  const startRecording = async () => {
    if (pending || sending.current || voice.isRecording || voice.isProcessing) return;
    capture.current = { clientId: crypto.randomUUID(), scopeKey: options.scopeKey, text: [], resolveTarget: options.resolveTarget, onSent: options.onSent, assertTargetActive: options.assertTargetActive };
    setSendError(null);
    await voice.startRecording();
  };
  const discard = () => {
    if (sending.current) return;
    voice.cancelRecording();
    capture.current = null;
    setPending(null);
    setSendError(null);
  };
  return {
    ...voice, startRecording, cancelRecording: discard,
    isProcessing: voice.isProcessing || isSending,
    isSending, sendError, pendingFile: pending?.file ?? null,
    retry: () => pending && !voice.isProcessing ? send(pending) : Promise.resolve(),
    discard,
  };
}

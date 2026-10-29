import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/shared/utils/apiClient';

interface Options {
  scopeKey: string;
  resolveSpaceId: () => Promise<number>;
  onResult?: (text: string) => void;
  onRecorded?: (file: File) => void;
}

/** Keep one continuous recording; Whisper receives independently decodable segments. */
export function useVoiceMessage(options: Options) {
  const { t } = useLanguage();
  const callbacks = useRef(options);
  callbacks.current = options;
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const session = useRef(0);
  const stop = useRef<() => void>(() => {});
  const dispose = useRef<() => void>(() => {});
  const busy = useRef(false);
  const resumeTranscription = useRef(async () => true);
  const [transcriptionBlocked, setTranscriptionBlocked] = useState(false);
  const [state, setState] = useState({ isRecording: false, isProcessing: false, error: null as string | null, duration: 0 });

  const cancelRecording = useCallback(() => {
    session.current++;
    setRecordingStream(null);
    dispose.current();
    busy.current = false;
    setState({ isRecording: false, isProcessing: false, error: null, duration: 0 });
  }, []);
  useEffect(() => {
    cancelRecording();
    return () => { session.current++; dispose.current(); busy.current = false; };
  }, [options.scopeKey, cancelRecording]);

  const startRecording = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const id = ++session.current;
    const { resolveSpaceId } = callbacks.current;
    setTranscriptionBlocked(false);
    const active = () => session.current === id;
    setState({ isRecording: false, isProcessing: true, error: null, duration: 0 });
    try {
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error(t('aiChat.ui.recordingUnsupported'));
      const format = mimeType === 'audio/mp4' ? 'm4a' : mimeType.split('/')[1];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active()) { stream.getTracks().forEach(track => track.stop()); return; }
      dispose.current = () => stream.getTracks().forEach(track => track.stop());
      setRecordingStream(stream);
      const startedAt = Date.now();
      let recording = true;
      let segment: MediaRecorder | undefined;
      let segmentTimer: ReturnType<typeof setTimeout> | undefined;
      const timers: { duration?: ReturnType<typeof setInterval> } = {};
      let queue = Promise.resolve();
      const pendingSegments: Blob[] = [];
      let blocked = false;
      const fullChunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType });
      const release = () => {
        clearTimeout(segmentTimer);
        clearInterval(timers.duration);
        for (const item of [recorder, segment]) {
          if (!item) continue;
          item.onstop = null; item.ondataavailable = null; item.onerror = null;
          if (item.state !== 'inactive') item.stop();
        }
        stream.getTracks().forEach(track => track.stop());
      };
      dispose.current = release;
      const reportError = (error: unknown) => {
        if (active()) setState(prev => ({ ...prev, error: error instanceof Error ? error.message : t('aiChat.ui.transcriptionAudioSaved') }));
      };
      const transcribe = async (blob: Blob) => {
        if (!active() || !blob.size) return;
        // Binding errors retain this segment; they must not fall through to upload.
        const targetSpaceId = await resolveSpaceId();
        if (!active()) return;
        try {
          if (blob.size > 25 * 1024 * 1024) throw new Error(t('aiChat.ui.segmentTooLarge'));
          const audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(new Error(t('aiChat.ui.recordingReadFailed')));
            reader.readAsDataURL(blob);
          });
          if (!active()) return;
          const response = await apiClient.post<{ success: boolean; data?: { text?: string; data?: { text?: string } }; error?: { message?: string } }>('/ai/transcribe', {
            audio, format, language: 'ru', space_id: targetSpaceId,
          });
          if (!active()) return;
          if (!response.success) throw new Error(response.error?.message || t('aiChat.ui.transcriptionAudioSaved'));
          const text = response.data?.data?.text ?? response.data?.text;
          if (text?.trim()) callbacks.current.onResult?.(text.trim());
        } catch (error) { reportError(error); }
      };
      const drainSegments = async () => {
        while (active() && !blocked && pendingSegments.length) {
          try {
            await transcribe(pendingSegments[0]);
            pendingSegments.shift();
          } catch (error) {
            blocked = true;
            if (active()) setTranscriptionBlocked(true);
            reportError(error);
          }
        }
      };
      resumeTranscription.current = async () => {
        if (!active()) return false;
        if (!blocked) return true;
        blocked = false;
        setTranscriptionBlocked(false);
        setState(prev => ({ ...prev, isProcessing: true, error: null }));
        queue = queue.then(drainSegments);
        await queue;
        if (active()) setState(prev => ({ ...prev, isProcessing: false }));
        return active() && !blocked;
      };
      const startSegment = () => {
        const chunks: Blob[] = [];
        const part = new MediaRecorder(stream, { mimeType });
        segment = part;
        part.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        part.onerror = () => { reportError(new Error(t('aiChat.ui.transcriptionInterrupted'))); };
        part.onstop = () => {
          clearTimeout(segmentTimer);
          if (!active()) return;
          pendingSegments.push(new Blob(chunks, { type: mimeType }));
          queue = queue.then(drainSegments);
          if (recording) startSegment();
          else void queue.finally(() => {
            if (active()) { busy.current = false; setState(prev => ({ ...prev, isProcessing: false })); }
          });
        };
        part.start();
        segmentTimer = setTimeout(() => { if (part.state !== 'inactive') part.stop(); }, 6000);
      };
      stop.current = () => {
        if (!recording) return;
        recording = false;
        setRecordingStream(null);
        clearTimeout(segmentTimer); clearInterval(timers.duration);
        setState(prev => ({ ...prev, isRecording: false, isProcessing: true }));
        if (segment?.state !== 'inactive') segment?.stop();
        if (recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach(track => track.stop());
      };
      recorder.ondataavailable = event => { if (event.data.size) fullChunks.push(event.data); };
      recorder.onstop = () => {
        if (!active()) return;
        const file = Object.assign(new File(fullChunks, `voice-${Date.now()}.${format}`, { type: mimeType }), { duration: (Date.now() - startedAt) / 1000 });
        if (file.size) callbacks.current.onRecorded?.(file);
        else reportError(new Error(t('aiChat.ui.recordingEmpty')));
      };
      recorder.onerror = () => { reportError(new Error(t('aiChat.ui.recordingInterrupted'))); stop.current(); };
      recorder.start();
      startSegment();
      timers.duration = setInterval(() => {
        const duration = Math.floor((Date.now() - startedAt) / 1000);
        setState(prev => ({ ...prev, duration }));
        // Bound memory and queued transcription work; the completed audio remains attachable.
        if (duration >= 600) stop.current();
      }, 250);
      setState({ isRecording: true, isProcessing: false, error: null, duration: 0 });
    } catch (error) {
      if (!active()) return;
      setRecordingStream(null);
      dispose.current(); busy.current = false;
      setState(prev => ({ ...prev, isRecording: false, isProcessing: false, error: error instanceof Error ? error.message : t('aiChat.ui.microphoneStartFailed') }));
    }
  }, [t]);
  const stopRecording = useCallback(() => stop.current(), []);
  const retryTranscription = useCallback(() => resumeTranscription.current(), []);
  return { ...state, transcriptionBlocked, retryTranscription, recordingStream, startRecording, stopRecording, cancelRecording };
}

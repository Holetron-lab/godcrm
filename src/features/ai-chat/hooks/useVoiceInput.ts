/**
 * useVoiceInput - Hook for voice input using Web Speech API and Whisper
 * 
 * Features:
 * - Web Speech API for quick browser-based transcription (free)
 * - Whisper API for high-quality transcription (via backend)
 * - Recording indicator with progress
 * - Automatic language detection
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { apiClient } from '../../../shared/utils/apiClient';

// Web Speech API types (not available in all browsers)
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionInterface extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: ((ev: Event) => void) | null;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInterface;
    webkitSpeechRecognition: new () => SpeechRecognitionInterface;
  }
}

export type VoiceInputMode = 'webSpeech' | 'whisper';

interface VoiceInputOptions {
  mode?: VoiceInputMode;
  language?: string;
  operatorId?: number;
  spaceId?: number;
  onResult?: (text: string) => void;
  onError?: (error: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
}

interface VoiceInputState {
  isRecording: boolean;
  isProcessing: boolean;
  error: string | null;
  transcript: string;
  duration: number;
}

export function useVoiceInput(options: VoiceInputOptions = {}) {
  const {
    mode = 'webSpeech',
    language = 'ru-RU',
    operatorId,
    spaceId,
    onResult,
    onError,
    onStart,
    onEnd,
  } = options;

  const [state, setState] = useState<VoiceInputState>({
    isRecording: false,
    isProcessing: false,
    error: null,
    transcript: '',
    duration: 0,
  });

  // Refs for audio recording (Whisper mode)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Ref for Web Speech API
  const recognitionRef = useRef<SpeechRecognitionInterface | null>(null);

  // Check if Web Speech API is available
  const webSpeechAvailable = typeof window !== 'undefined' && 
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  // Start duration timer
  const startDurationTimer = useCallback(() => {
    startTimeRef.current = Date.now();
    durationIntervalRef.current = window.setInterval(() => {
      setState(prev => ({
        ...prev,
        duration: Math.floor((Date.now() - startTimeRef.current) / 1000)
      }));
    }, 100);
  }, []);

  // Stop duration timer
  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  // Start recording with Web Speech API
  const startWebSpeech = useCallback(() => {
    if (!webSpeechAvailable) {
      setState(prev => ({ ...prev, error: 'Web Speech API не поддерживается в этом браузере' }));
      onError?.('Web Speech API не поддерживается');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setState(prev => ({ ...prev, isRecording: true, error: null, transcript: '' }));
      startDurationTimer();
      onStart?.();
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      const currentTranscript = finalTranscript || interimTranscript;
      setState(prev => ({ ...prev, transcript: currentTranscript }));
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const errorMessage = event.error === 'no-speech' 
        ? 'Речь не обнаружена. Попробуйте снова.'
        : event.error === 'audio-capture'
        ? 'Микрофон не найден. Проверьте настройки.'
        : event.error === 'not-allowed'
        ? 'Доступ к микрофону запрещён.'
        : `Ошибка распознавания: ${event.error}`;
      
      setState(prev => ({ ...prev, error: errorMessage, isRecording: false }));
      stopDurationTimer();
      onError?.(errorMessage);
    };

    recognition.onend = () => {
      setState(prev => {
        if (prev.transcript) {
          onResult?.(prev.transcript);
        }
        onEnd?.();
        return { ...prev, isRecording: false };
      });
      stopDurationTimer();
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [language, webSpeechAvailable, onStart, onResult, onError, onEnd, startDurationTimer, stopDurationTimer]);

  // Start recording with MediaRecorder for Whisper
  const startWhisper = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stopDurationTimer();
        setState(prev => ({ ...prev, isRecording: false, isProcessing: true }));
        
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          // Convert blob to base64
          const reader = new FileReader();
          const base64Promise = new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              resolve(base64);
            };
          });
          reader.readAsDataURL(audioBlob);
          const base64Audio = await base64Promise;

          // Send to backend for transcription
          interface TranscribeResponse {
            success: boolean;
            data?: { text: string };
            error?: string;
          }
          const response = await apiClient.post<{ data: TranscribeResponse }>('/ai/transcribe', {
            audio: base64Audio,
            format: 'webm',
            language: language.split('-')[0], // 'ru-RU' -> 'ru'
            operator_id: operatorId,
            space_id: spaceId
          });

          if (response.data?.success && response.data?.data?.text) {
            const text = response.data.data.text;
            setState(prev => ({ ...prev, transcript: text, isProcessing: false }));
            onResult?.(text);
          } else {
            throw new Error(response.data?.error || 'Transcription failed');
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Ошибка транскрипции';
          setState(prev => ({ ...prev, error: errorMessage, isProcessing: false }));
          onError?.(errorMessage);
        } finally {
          onEnd?.();
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      
      setState(prev => ({ ...prev, isRecording: true, error: null, transcript: '', duration: 0 }));
      startDurationTimer();
      onStart?.();
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? (error.name === 'NotAllowedError' 
          ? 'Доступ к микрофону запрещён.' 
          : error.message)
        : 'Не удалось получить доступ к микрофону';
      setState(prev => ({ ...prev, error: errorMessage }));
      onError?.(errorMessage);
    }
  }, [language, operatorId, spaceId, onStart, onResult, onError, onEnd, startDurationTimer, stopDurationTimer]);

  // Start recording
  const startRecording = useCallback(() => {
    if (mode === 'webSpeech') {
      startWebSpeech();
    } else {
      startWhisper();
    }
  }, [mode, startWebSpeech, startWhisper]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mode === 'webSpeech' && recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    } else if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      
      // Stop all tracks
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    stopDurationTimer();
  }, [mode, stopDurationTimer]);

  // Cancel recording (discard)
  const cancelRecording = useCallback(() => {
    if (mode === 'webSpeech' && recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    } else if (mediaRecorderRef.current) {
      // Don't process the recording
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    stopDurationTimer();
    setState(prev => ({ ...prev, isRecording: false, isProcessing: false, transcript: '', duration: 0 }));
    onEnd?.();
  }, [mode, stopDurationTimer, onEnd]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelRecording();
    };
  }, [cancelRecording]);

  return {
    ...state,
    startRecording,
    stopRecording,
    cancelRecording,
    webSpeechAvailable,
  };
}

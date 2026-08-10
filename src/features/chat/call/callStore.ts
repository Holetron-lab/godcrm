/**
 * callStore — module-level zustand store backing the web voice-call feature.
 * ADR-0059 §4.3.
 *
 * The LiveKit Room and the elapsed-time interval live OUTSIDE the React store
 * (closure-scoped here) so a panel switch or component remount cannot drop
 * the call. Components subscribe to state via the `useCallStore` selector
 * (or the `useCall*` selectors in `./useCall.ts`).
 */

import { create } from 'zustand';
import type { Room, RemoteParticipant, LocalParticipant, Participant } from 'livekit-client';
import { apiClient } from '@/shared/utils/apiClient';

export type CallState = 'idle' | 'connecting' | 'connected' | 'error';

export interface CallParticipant {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isLocal: boolean;
  isMuted: boolean;
}

interface TokenResponse {
  success?: boolean;
  data?: {
    token: string;
    url: string;
    room: string;
    identity: string;
    participants: Array<{ id: number; name: string }>;
  };
  // direct shape (some endpoints don't wrap in `data`)
  token?: string;
  url?: string;
  room?: string;
  identity?: string;
}

interface RecordingStartResponse {
  data?: { egress_id?: string };
  egress_id?: string;
}

interface CallStoreState {
  state: CallState;
  roomName: string | null;
  conversationId: number | null;
  errorMessage: string | null;
  participants: CallParticipant[];
  elapsedSeconds: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
  isRecording: boolean;
  egressId: string | null;

  startCall: (conversationId: number, opts?: { withRecording?: boolean }) => Promise<void>;
  endCall: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  toggleRecording: () => Promise<void>;
}

// ─── Closure-scoped runtime references ────────────────────────────────────────
let room: Room | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let pendingWithRecording = true;

const INITIAL_STATE = {
  state: 'idle' as CallState,
  roomName: null,
  conversationId: null,
  errorMessage: null,
  participants: [] as CallParticipant[],
  elapsedSeconds: 0,
  isMuted: false,
  isSpeakerOn: true,
  isRecording: false,
  egressId: null,
};

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

function buildParticipantList(currentRoom: Room): CallParticipant[] {
  const list: CallParticipant[] = [];
  const local = currentRoom.localParticipant;
  if (local) list.push(toParticipant(local, true));
  for (const remote of currentRoom.remoteParticipants.values()) {
    list.push(toParticipant(remote, false));
  }
  return list;
}

function toParticipant(p: Participant, isLocal: boolean): CallParticipant {
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isSpeaking: p.isSpeaking,
    isLocal,
    isMuted: !(p as LocalParticipant | RemoteParticipant).isMicrophoneEnabled,
  };
}

export const useCallStore = create<CallStoreState>((set, get) => ({
  ...INITIAL_STATE,

  startCall: async (conversationId, opts) => {
    const current = get();
    if (current.state !== 'idle') {
      // Already in a call — no-op rather than double-connect.
      return;
    }
    pendingWithRecording = opts?.withRecording !== false;

    set({
      state: 'connecting',
      conversationId,
      errorMessage: null,
      participants: [],
      elapsedSeconds: 0,
      isMuted: false,
      isSpeakerOn: true,
      isRecording: false,
      egressId: null,
    });

    try {
      const tokenResp = await apiClient.post<TokenResponse>(
        `/chat/conversations/${conversationId}/call/token`,
        {},
      );
      const payload = tokenResp.data ?? tokenResp;
      const token = payload.token;
      const url = payload.url;
      const roomName = payload.room;
      if (!token || !url || !roomName) {
        throw new Error('Token endpoint returned incomplete payload');
      }

      // Lazy-import the LiveKit SDK so non-call routes don't pay the
      // bundle cost up-front.
      const { Room, RoomEvent, AudioPresets } = await import('livekit-client');

      const lkRoom = new Room({
        adaptiveStream: false,
        dynacast: false,
        publishDefaults: { dtx: true, audioPreset: AudioPresets.speech },
      });
      room = lkRoom;

      const refreshParticipants = () => {
        const list = buildParticipantList(lkRoom);
        set({ participants: list });
      };

      lkRoom.on(RoomEvent.ParticipantConnected, refreshParticipants);
      lkRoom.on(RoomEvent.ParticipantDisconnected, refreshParticipants);
      lkRoom.on(RoomEvent.TrackMuted, refreshParticipants);
      lkRoom.on(RoomEvent.TrackUnmuted, refreshParticipants);
      lkRoom.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
        const speakingIds = new Set(speakers.map((s) => s.identity));
        set((s) => ({
          participants: s.participants.map((p) => ({
            ...p,
            isSpeaking: speakingIds.has(p.identity),
          })),
        }));
      });
      lkRoom.on(RoomEvent.Disconnected, () => {
        // Called by both server-initiated and client-initiated disconnects.
        void get().endCall();
      });

      await lkRoom.connect(url, token);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);

      set({
        state: 'connected',
        roomName,
        participants: buildParticipantList(lkRoom),
      });

      stopElapsedTimer();
      elapsedTimer = setInterval(() => {
        set((s) => ({ elapsedSeconds: s.elapsedSeconds + 1 }));
      }, 1000);

      if (pendingWithRecording) {
        try {
          const rec = await apiClient.post<RecordingStartResponse>(
            `/chat/conversations/${conversationId}/call/recording/start`,
            {},
          );
          const egressId = rec.data?.egress_id ?? rec.egress_id ?? null;
          set({ isRecording: !!egressId, egressId });
        } catch {
          // Recording is best-effort; the call continues without it.
          set({ isRecording: false, egressId: null });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly = /permission|denied|NotAllowed/i.test(msg)
        ? 'Нет доступа к микрофону. Разрешите доступ в настройках браузера.'
        : msg;
      set({ state: 'error', errorMessage: friendly });
      if (room) {
        try {
          await room.disconnect();
        } catch {
          /* noop */
        }
        room = null;
      }
      stopElapsedTimer();
    }
  },

  endCall: async () => {
    const { conversationId, egressId } = get();
    stopElapsedTimer();

    if (room) {
      try {
        await room.disconnect();
      } catch {
        /* noop */
      }
      room = null;
    }

    // Recording stop + transcription is fire-and-forget; the bubble
    // appears via polling once the backend inserts it.
    if (conversationId && egressId) {
      apiClient
        .post(`/chat/conversations/${conversationId}/call/recording/stop`, { egress_id: egressId })
        .catch(() => {
          /* swallow — recording was best-effort */
        });
    }

    set({ ...INITIAL_STATE });
  },

  toggleMute: async () => {
    if (!room) return;
    const next = !get().isMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      set({ isMuted: next });
    } catch {
      /* permission revoked mid-call — leave state as-is */
    }
  },

  toggleSpeaker: async () => {
    // Web has no Hardware.setSpeakerphoneOn — keep state in lockstep with
    // mobile so the UI can mirror, but do not actually re-route audio. The
    // device-picker is a v1.1 follow-up (ADR-0059 §4.3 note).
    set((s) => ({ isSpeakerOn: !s.isSpeakerOn }));
  },

  toggleRecording: async () => {
    const { conversationId, isRecording, egressId } = get();
    if (!conversationId) return;
    if (isRecording && egressId) {
      try {
        await apiClient.post(`/chat/conversations/${conversationId}/call/recording/stop`, {
          egress_id: egressId,
        });
      } catch {
        /* noop */
      }
      set({ isRecording: false, egressId: null });
      return;
    }
    try {
      const rec = await apiClient.post<RecordingStartResponse>(
        `/chat/conversations/${conversationId}/call/recording/start`,
        {},
      );
      const newId = rec.data?.egress_id ?? rec.egress_id ?? null;
      set({ isRecording: !!newId, egressId: newId });
    } catch {
      /* noop */
    }
  },
}));

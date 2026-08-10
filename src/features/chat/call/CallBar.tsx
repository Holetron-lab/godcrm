/**
 * CallBar — thin overlay strip rendered above the chat toolbar while a call
 * is active. ADR-0059 §4.4.
 */

import { useRef, useState } from 'react';
import {
  Mic, MicOff, Volume2, VolumeX,
  CircleDot, PhoneOff, Loader2, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useCallStore } from './callStore';
import { ParticipantsDropdown } from './ParticipantsDropdown';

function formatElapsed(seconds: number): string {
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = (seconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

export function CallBar() {
  const state = useCallStore((s) => s.state);
  const participants = useCallStore((s) => s.participants);
  const elapsedSeconds = useCallStore((s) => s.elapsedSeconds);
  const isMuted = useCallStore((s) => s.isMuted);
  const isSpeakerOn = useCallStore((s) => s.isSpeakerOn);
  const isRecording = useCallStore((s) => s.isRecording);
  const errorMessage = useCallStore((s) => s.errorMessage);
  const conversationId = useCallStore((s) => s.conversationId);

  const startCall = useCallStore((s) => s.startCall);
  const endCall = useCallStore((s) => s.endCall);
  const toggleMute = useCallStore((s) => s.toggleMute);
  const toggleSpeaker = useCallStore((s) => s.toggleSpeaker);
  const toggleRecording = useCallStore((s) => s.toggleRecording);

  const [participantsOpen, setParticipantsOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);

  if (state === 'idle') return null;

  const isConnecting = state === 'connecting';
  const isError = state === 'error';
  const isConnected = state === 'connected';

  const participantLabel = (() => {
    if (participants.length === 0) return 'Подключение…';
    const others = participants.filter((p) => !p.isLocal);
    if (others.length === 0) return 'Только вы';
    if (others.length === 1) return others[0].name;
    if (others.length === 2) return `${others[0].name}, ${others[1].name}`;
    return `${others[0].name}, ${others[1].name} +${others.length - 2}`;
  })();

  return (
    <div
      role="region"
      aria-label="Активный звонок"
      className={cn(
        'flex items-center gap-2 px-3 py-1 border-b border-[var(--border-secondary)]',
        'bg-[var(--color-primary-500)]/10',
      )}
    >
      {/* Status pill */}
      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium tabular-nums text-[var(--text-primary)] flex-shrink-0">
        {isConnecting && (
          <Loader2 className="w-3 h-3 animate-spin text-amber-400" aria-hidden="true" />
        )}
        {isConnected && (
          <span
            className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"
            aria-hidden="true"
          />
        )}
        {isError && (
          <AlertTriangle className="w-3 h-3 text-red-400" aria-hidden="true" />
        )}
        <span>
          {isConnecting && 'Подключение'}
          {isConnected && formatElapsed(elapsedSeconds)}
          {isError && 'Ошибка'}
        </span>
      </div>

      {/* Participants chip */}
      {!isError && (
        <div className="relative">
          <button
            ref={chipRef}
            type="button"
            onClick={() => setParticipantsOpen((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)]/70 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-haspopup="dialog"
            aria-expanded={participantsOpen}
          >
            <span className="truncate max-w-[180px]">{participantLabel}</span>
            <ChevronDown className="w-3 h-3 flex-shrink-0" />
          </button>
          <ParticipantsDropdown
            open={participantsOpen}
            participants={participants}
            onClose={() => setParticipantsOpen(false)}
            anchorRef={chipRef}
          />
        </div>
      )}

      {/* Error message + retry */}
      {isError && (
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className="text-[11px] text-red-400 truncate"
            title={errorMessage ?? ''}
          >
            {errorMessage}
          </span>
          {conversationId && (
            <button
              type="button"
              onClick={() => startCall(conversationId)}
              className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-[var(--text-secondary)] transition-colors flex-shrink-0"
            >
              Повторить
            </button>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Right-side controls */}
      {!isError && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <ControlBtn
            label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            active={isMuted}
            activeTone="red"
            disabled={isConnecting}
            onClick={() => void toggleMute()}
            icon={isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          />
          <ControlBtn
            label={isSpeakerOn ? 'Звук вкл.' : 'Звук выкл.'}
            active={!isSpeakerOn}
            disabled={isConnecting}
            onClick={() => void toggleSpeaker()}
            icon={isSpeakerOn ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          />
          <ControlBtn
            label={isRecording ? 'Идёт запись' : 'Включить запись'}
            active={isRecording}
            activeTone="red"
            disabled={isConnecting}
            onClick={() => void toggleRecording()}
            icon={<CircleDot className="w-3.5 h-3.5" />}
            extraLabel={isRecording ? 'Запись' : undefined}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => void endCall()}
        title="Завершить звонок"
        aria-label="Завершить звонок"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-red-100 bg-red-500 hover:bg-red-600 transition-colors flex-shrink-0"
      >
        <PhoneOff className="w-3.5 h-3.5" />
        <span className="text-[11px] hidden sm:inline">Завершить</span>
      </button>
    </div>
  );
}

interface ControlBtnProps {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  activeTone?: 'primary' | 'red';
  disabled?: boolean;
  extraLabel?: string;
}

function ControlBtn({ label, icon, onClick, active, activeTone = 'primary', disabled, extraLabel }: ControlBtnProps) {
  const activeClass =
    activeTone === 'red'
      ? 'bg-red-500/20 text-red-400'
      : 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]';

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1 p-1 rounded transition-colors',
        disabled && 'opacity-40 cursor-not-allowed',
        !disabled && active && activeClass,
        !disabled && !active && 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]',
      )}
    >
      {icon}
      {extraLabel && <span className="text-[10px]">{extraLabel}</span>}
    </button>
  );
}

/**
 * CallBubble — renders a `content_type='call'` message (the diarized
 * transcript inserted by /call/transcribe). ADR-0059 §4.8.
 *
 * The lucide `Phone` icon is used per the AMEND 2026-05-13 in ADR-0059.
 */

import React from 'react';
import { Phone } from 'lucide-react';
import type { ChatMessage } from '../../../types';

interface DialogueLine {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

interface CallMetadata {
  type?: string;
  duration?: number;
  participants?: string[];
  dialogue?: DialogueLine[];
  transcribed_at?: string;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '';
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatTimestamp(seconds: number): string {
  const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
  const ss = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

interface CallBubbleProps {
  message: ChatMessage;
}

export const CallBubble: React.FC<CallBubbleProps> = ({ message }) => {
  const meta = (message.metadata ?? {}) as CallMetadata;
  const dialogue = Array.isArray(meta.dialogue) ? meta.dialogue : [];
  const duration = meta.duration;

  return (
    <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]/40">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary-500)]/15">
          <Phone className="h-4 w-4 text-[var(--color-primary-500)]" aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)]">Звонок</div>
          {duration ? (
            <div className="text-[11px] text-[var(--text-tertiary)] tabular-nums">
              {formatDuration(duration)}
              {meta.participants && meta.participants.length > 0 && (
                <span> · {meta.participants.join(', ')}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {dialogue.length > 0 ? (
        <ul className="divide-y divide-[var(--border-secondary)]">
          {dialogue.map((line, i) => (
            <li key={i} className="px-3 py-2 text-sm">
              <div className="flex items-baseline gap-2">
                <span className="font-medium text-[var(--text-primary)]">{line.speaker}</span>
                <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                  {formatTimestamp(line.start)}
                </span>
              </div>
              <p className="mt-0.5 text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                {line.text}
              </p>
            </li>
          ))}
        </ul>
      ) : message.content ? (
        <pre className="px-3 py-2 text-xs text-[var(--text-secondary)] whitespace-pre-wrap break-words font-sans">
          {message.content}
        </pre>
      ) : (
        <div className="px-3 py-2 text-xs text-[var(--text-tertiary)] italic">
          Расшифровка недоступна.
        </div>
      )}
    </div>
  );
};

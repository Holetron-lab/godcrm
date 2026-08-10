/**
 * QuoteChipStrip — shared chip strip used by both forward (orange) and
 * move (cyan) queues above the chat input. Forward and move have identical
 * UX (accumulate chips → send as quoted blocks), only color and lead-icon
 * differ. Per-chip color falls back to msg.agent_color (matches the bubble).
 */

import React from 'react';
import { X, MessageSquare } from 'lucide-react';
import type { ChatMessage } from '../../../types';

interface QuoteChipStripProps {
  messages: ChatMessage[];
  setMessages?: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  /** Tailwind color name without prefix, e.g. 'orange', 'cyan'. */
  tone: 'orange' | 'cyan';
  leadIcon: React.ReactNode;
  /** Optional content rendered below the strip (e.g. amber warning). */
  footer?: React.ReactNode;
}

const TONES = {
  orange: {
    chipBg: 'bg-orange-500/10',
    chipBorder: 'border-orange-500/20',
    iconColor: 'rgb(251 146 60)',
    textColor: 'rgb(253 186 116)',
    timeText: 'text-orange-400/60',
    closeText: 'text-orange-400/60',
    overflowName: 'text-orange-300',
    overflowCount: 'text-orange-400/80',
  },
  cyan: {
    chipBg: 'bg-cyan-500/10',
    chipBorder: 'border-cyan-500/20',
    iconColor: 'rgb(34 211 238)',
    textColor: 'rgb(103 232 249)',
    timeText: 'text-cyan-400/60',
    closeText: 'text-cyan-400/60',
    overflowName: 'text-cyan-300',
    overflowCount: 'text-cyan-400/80',
  },
} as const;

export function QuoteChipStrip({ messages, setMessages, tone, leadIcon, footer }: QuoteChipStripProps) {
  if (messages.length === 0) return null;
  const t = TONES[tone];
  return (
    <div className="px-1 pb-1">
      <div className="flex items-center gap-1 flex-wrap">
        {leadIcon}
        {messages.length <= 3 ? (
          messages.map((msg, idx) => {
            const chipColor = msg.agent_color || undefined;
            // ADR-0031: row_mutation messages are service-authored. The DB
            // JOIN returns sender_name = actor (e.g. "GERATRON") because the
            // backend stores the actor's user_id in sender_id for audit. Use
            // "system" as the chip author so the preview reads
            // `system: 📝 Status:...` instead of `GERATRON: 📝 Status:...`.
            const isSystemEvent = msg.role === 'system' && msg.contentType === 'row_mutation';
            const chipAuthor = isSystemEvent
              ? 'system'
              : (msg.sender_name || msg.agentName || (msg.role === 'user' ? 'User' : 'Agent'));
            return (
              <div
                key={msg.id || idx}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${t.chipBg} border ${t.chipBorder} text-[11px] max-w-[200px]`}
                style={chipColor ? { background: `${chipColor}15`, borderColor: `${chipColor}30` } : undefined}
              >
                <MessageSquare className="w-2.5 h-2.5 flex-shrink-0" style={{ color: chipColor || t.iconColor }} />
                <span className="truncate" style={{ color: chipColor || t.textColor }}>
                  {chipAuthor}
                  {': '}
                  {(msg.content || '').slice(0, 10)}
                  {(msg.content || '').length > 10 ? '…' : ''}
                </span>
                <span className={`text-[9px] ${t.timeText} flex-shrink-0`}>
                  {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
                <button
                  onClick={() => setMessages?.(prev => prev.filter(m => m.id !== msg.id))}
                  className={`${t.closeText} hover:text-red-400 transition-colors flex-shrink-0`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })
        ) : (
          <>
            {messages.slice(0, 2).map((msg, idx) => {
              // ADR-0031: row_mutation = service-authored, not the actor.
              const isSystemEvent = msg.role === 'system' && msg.contentType === 'row_mutation';
              const overflowName = isSystemEvent
                ? 'system'
                : (msg.sender_name || msg.agentName || 'User');
              return (
                <span key={msg.id || idx} className={`text-[11px] ${t.overflowName}`}>
                  {overflowName}
                </span>
              );
            })}
            <span className={`text-[11px] ${t.overflowCount}`}>
              +{messages.length - 2} ({messages.length} сообщ.)
            </span>
          </>
        )}
        <button
          onClick={() => setMessages?.([])}
          className={`${t.closeText} hover:text-red-400 transition-colors ml-auto flex-shrink-0`}
          title="Убрать все"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      {footer}
    </div>
  );
}

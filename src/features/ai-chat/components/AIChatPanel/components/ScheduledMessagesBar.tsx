/**
 * ScheduledMessagesBar — Scheduled messages displayed like regular chat turns.
 * Divider with count + sender info, then each message as a mini-turn with
 * yellow time badge, Send Now, and Cancel actions in footer.
 * WP-17: Scheduled messages feature.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Clock, X, ChevronLeft, ChevronRight, Send, Play, Pencil, User, Bot } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import type { ScheduledMessage } from '../hooks/useScheduledMessages';

interface ScheduledMessagesBarProps {
  messages: ScheduledMessage[];
  onCancel: (id: number) => void;
  onReschedule?: (id: number, newDate: string) => void;
  onSendNow?: (msg: ScheduledMessage) => void;
  onEdit?: (msg: ScheduledMessage) => void;
}

function formatScheduledTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = d.getTime() - now.getTime();

  if (diff < 60_000) return 'через <1 мин';
  if (diff < 3600_000) return `через ${Math.round(diff / 60_000)} мин`;
  if (diff < 86400_000) {
    const hours = Math.floor(diff / 3600_000);
    const mins = Math.round((diff % 3600_000) / 60_000);
    return `через ${hours}ч ${mins > 0 ? `${mins}м` : ''}`;
  }

  return d.toLocaleString('ru', {
    day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString('ru', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function InlineDatePicker({ currentDate, onSave, onClose }: {
  currentDate: string;
  onSave: (isoDate: string) => void;
  onClose: () => void;
}) {
  const d = new Date(currentDate);
  const [viewYear, setViewYear] = useState(d.getFullYear());
  const [viewMonth, setViewMonth] = useState(d.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date>(d);
  const [hours, setHours] = useState(String(d.getHours()).padStart(2, '0'));
  const [minutes, setMinutes] = useState(String(d.getMinutes()).padStart(2, '0'));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const calendarDays = (() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDay = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
    const days: Array<{ day: number; month: 'prev' | 'current' | 'next'; date: Date }> = [];
    for (let i = startDay - 1; i >= 0; i--) {
      const dd = daysInPrevMonth - i;
      days.push({ day: dd, month: 'prev', date: new Date(viewYear, viewMonth - 1, dd) });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, month: 'current', date: new Date(viewYear, viewMonth, i) });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ day: i, month: 'next', date: new Date(viewYear, viewMonth + 1, i) });
    }
    return days;
  })();

  const goMonth = (delta: number) => {
    const nd = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(nd.getFullYear());
    setViewMonth(nd.getMonth());
  };

  const isToday = (date: Date) => {
    const t = new Date();
    return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear();
  };
  const isSelected = (date: Date) =>
    date.getDate() === selectedDate.getDate() && date.getMonth() === selectedDate.getMonth() && date.getFullYear() === selectedDate.getFullYear();
  const isPast = (date: Date) => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const handleSave = () => {
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    const scheduled = new Date(selectedDate);
    scheduled.setHours(h, m, 0, 0);
    if (scheduled.getTime() <= Date.now()) return;
    onSave(scheduled.toISOString());
  };

  const canSave = (() => {
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    const nd = new Date(selectedDate);
    nd.setHours(h, m, 0, 0);
    return nd.getTime() > Date.now();
  })();

  return (
    <div ref={ref} className="absolute left-4 right-4 bottom-full mb-1 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-xl z-50 overflow-hidden">
      <div className="p-2">
        <div className="flex items-center justify-between mb-1.5">
          <button onClick={() => goMonth(-1)} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-medium text-[var(--text-primary)]">
            {MONTHS_RU[viewMonth]} {viewYear}
          </span>
          <button onClick={() => goMonth(1)} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0">
          {WEEKDAYS.map(w => (
            <div key={w} className="text-center text-[9px] text-[var(--text-tertiary)] py-0.5">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0">
          {calendarDays.map((dd, i) => (
            <button key={i} disabled={isPast(dd.date)} onClick={() => setSelectedDate(dd.date)}
              className={cn(
                "w-6 h-6 text-[10px] rounded transition-colors flex items-center justify-center",
                dd.month !== 'current' && "text-[var(--text-tertiary)]/40",
                dd.month === 'current' && !isPast(dd.date) && "text-[var(--text-primary)]",
                isPast(dd.date) && "text-[var(--text-tertiary)]/20 cursor-not-allowed",
                isToday(dd.date) && "ring-1 ring-[var(--color-primary-500)]/40",
                isSelected(dd.date) && "bg-[var(--color-primary-500)] text-white",
                !isSelected(dd.date) && !isPast(dd.date) && "hover:bg-[var(--bg-tertiary)]",
              )}>
              {dd.day}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-[var(--border-secondary)]">
          <Clock className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
          <input type="text" value={hours} maxLength={2}
            onChange={(e) => setHours(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onBlur={() => setHours(String(Math.min(23, Math.max(0, parseInt(hours) || 0))).padStart(2, '0'))}
            className="w-7 text-center text-[10px] bg-[var(--bg-tertiary)] rounded px-0.5 py-0.5 text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
          />
          <span className="text-[10px] text-[var(--text-tertiary)]">:</span>
          <input type="text" value={minutes} maxLength={2}
            onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onBlur={() => setMinutes(String(Math.min(59, Math.max(0, parseInt(minutes) || 0))).padStart(2, '0'))}
            className="w-7 text-center text-[10px] bg-[var(--bg-tertiary)] rounded px-0.5 py-0.5 text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
          />
          <div className="flex-1" />
          <button onClick={handleSave} disabled={!canSave}
            className={cn("flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors",
              canSave
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-not-allowed"
            )}>
            <Send className="w-2.5 h-2.5" />
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

export function ScheduledMessagesBar({ messages, onCancel, onReschedule, onSendNow, onEdit }: ScheduledMessagesBarProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  // Live countdown — re-render every 30s so the timer ticks
  const [, setTick] = useState(0);
  useEffect(() => {
    if (messages.length === 0) return;
    const iv = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, [messages.length]);

  if (messages.length === 0) return null;

  // Collect unique sender names
  const senderNames = [...new Set(messages.map(m => m.sender_name).filter(Boolean))];
  const senderLabel = senderNames.length > 0
    ? senderNames.length <= 2
      ? senderNames.join(', ')
      : `${senderNames.slice(0, 2).join(', ')} +${senderNames.length - 2}`
    : null;

  return (
    <div className="flex-shrink-0">
      {/* Divider with count and senders */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="flex-1 h-px bg-amber-500/30" />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Clock className="w-3 h-3 text-amber-400" />
          <span className="text-[11px] font-medium text-amber-400">
            {messages.length} отложенн{messages.length === 1 ? 'ое' : 'ых'}
          </span>
          {senderLabel && (
            <span className="text-[10px] text-[var(--text-tertiary)]">
              от {senderLabel}
            </span>
          )}
        </div>
        <div className="flex-1 h-px bg-amber-500/30" />
      </div>

      {/* Messages — unified with regular chat turns */}
      <div className="max-h-64 overflow-y-auto px-4 pb-3 space-y-1.5">
        {messages.map((msg) => {
          // Determine sender type for badge
          const senderType: 'human' | 'agent' = (msg.metadata as any)?.sender_type === 'agent' ? 'agent' : 'human';

          return (
          <div
            key={msg.id}
            className="relative group/scheduled rounded-xl bg-[var(--bg-secondary)] border-b border-[var(--border-secondary)]"
            style={{ boxShadow: 'inset 4px 0 0 0 rgb(245, 158, 11)' }}
          >
            <div className="px-4 pt-3 pb-3">
              {/* Header: avatar + name + badge + time (same as TurnHeader) */}
              <div className="flex items-center gap-2 mb-2">
                {msg.sender_avatar ? (
                  <img src={msg.sender_avatar} alt="" className="w-7 h-7 rounded-full flex-shrink-0" />
                ) : (
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                    senderType === 'human' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
                  )}>
                    {senderType === 'human'
                      ? <User className="w-3.5 h-3.5" />
                      : <Bot className="w-3.5 h-3.5" />}
                  </div>
                )}
                <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {msg.sender_name || 'Вы'}
                </span>

                {/* Type badge — same as TurnHeader */}
                <span className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
                  senderType === 'human' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'
                )}>
                  {senderType === 'human' ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                </span>

                <span className="flex-1" />
                <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                  создано {formatAbsoluteTime(msg.created_at)}
                </span>
              </div>

              {/* Separator — same as ChatTurn */}
              <div className="border-b border-[var(--border-secondary)] mb-3" />

              {/* Message content */}
              <div className="text-sm text-[var(--text-primary)] break-words prose-sm">
                <MarkdownPreview content={msg.content} />
              </div>

              {/* Attachments */}
              {Array.isArray(msg.attachments) && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {(msg.attachments as Array<{ name?: string; type?: string; url?: string; preview?: string }>).map((att, i) => (
                    att.preview || (att.type && att.type.startsWith('image/')) ? (
                      <img key={i} src={att.preview || att.url} alt={att.name || ''} className="max-w-[120px] max-h-[80px] rounded-md object-cover border border-[var(--border-secondary)]" />
                    ) : (
                      <div key={i} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-secondary)]">
                        <span>📎</span>
                        <span className="truncate max-w-[100px]">{att.name || 'File'}</span>
                      </div>
                    )
                  ))}
                </div>
              )}

              {/* Footer: time badge + actions (same 10px style as TurnFooter) */}
              <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-tertiary)]">
                {/* Yellow time badge — clickable to reschedule */}
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingId(editingId === msg.id ? null : msg.id); }}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors cursor-pointer"
                  title="Изменить время"
                >
                  <Clock className="w-3 h-3" />
                  <span className="text-[10px] font-medium">
                    {formatScheduledTime(msg.scheduled_at)}
                  </span>
                  <span className="text-[10px] opacity-60">
                    — {formatAbsoluteTime(msg.scheduled_at)}
                  </span>
                </button>

                <span className="flex-1" />

                {/* Edit — load into input */}
                {onEdit && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(msg); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                    title="Редактировать"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}

                {/* Send now */}
                {onSendNow && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onSendNow(msg); }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--text-tertiary)] hover:text-green-400 hover:bg-green-500/10 transition-colors"
                    title="Отправить сейчас"
                  >
                    <Play className="w-3 h-3 fill-current" />
                  </button>
                )}

                {/* Cancel */}
                <button
                  onClick={(e) => { e.stopPropagation(); onCancel(msg.id); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Отменить"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Inline date picker for rescheduling */}
            {editingId === msg.id && onReschedule && (
              <InlineDatePicker
                currentDate={msg.scheduled_at}
                onSave={(newDate) => {
                  onReschedule(msg.id, newDate);
                  setEditingId(null);
                }}
                onClose={() => setEditingId(null)}
              />
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

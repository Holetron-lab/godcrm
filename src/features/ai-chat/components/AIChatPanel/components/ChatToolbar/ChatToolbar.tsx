/**
 * ChatToolbar — Horizontal toolbar between header and messages area.
 * ADR-129 WP-1: Consolidates action buttons.
 * ADR-0059 §4.1: Settings + Delete moved into ⋮ overflow; 📞 Call slot added.
 * Layout: MD, Terminal | Search [gap] Summary | AttachRow, Scheduled, 📞 Call, ⋮
 */

import React, { useRef, useEffect } from 'react';
import {
  Terminal, Search, Clock, Pin,
  Link2, FileText, Phone, X, ChevronUp, ChevronDown
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ChatToolbarOverflowMenu } from '../ChatToolbarOverflowMenu';

interface ChatToolbarProps {
  // Mode toggles
  chatPartnerType: string | null;
  hasSlashCommand: boolean;
  markdownEnabled: boolean;
  setMarkdownEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  showTerminal: boolean;
  setShowTerminal: (v: boolean | ((prev: boolean) => boolean)) => void;
  // Summary
  onSummaryOpen: () => void;
  // Row binding (conversation-level)
  showRowBinding: boolean;
  setShowRowBinding: (v: boolean | ((prev: boolean) => boolean)) => void;
  boundRowsCount: number;
  // Chat ID
  currentConversationId: number | null | undefined;
  // Search
  onSearchToggle?: () => void;
  searchActive?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  searchMatchCount?: number;
  searchCurrentMatch?: number;
  onSearchNext?: () => void;
  onSearchPrev?: () => void;
  // Scheduled messages
  onScheduledToggle?: () => void;
  scheduledActive?: boolean;
  scheduledCount?: number;
  // ADR-0068 WP-E follow-up — PinnedBanner toggle button (mirrors Scheduled).
  // pinnedCount === 0 → button visible, no badge.
  onPinnedToggle?: () => void;
  pinnedListActive?: boolean;
  pinnedCount?: number;
  // Delete (now lives in ⋮ overflow — opens DeleteChatModal in parent)
  onDeleteChat?: () => void;
  // ADR-0064 §Per-chat: tabbed inline settings panel — notifications + participants
  onNotificationsOpen?: () => void;
  onParticipantsOpen?: () => void;
  // ADR-0059 §4.1: voice call
  onCallClick?: () => void;
  /** True while the LiveKit room is non-idle — paints Call button as active. */
  callActive?: boolean;
  // Legacy props (kept for compat, unused in toolbar now)
  thinkingEnabled?: boolean;
  setThinkingEnabled?: (v: boolean | ((prev: boolean) => boolean)) => void;
  agentMode?: 'ask' | 'read' | 'agent';
  setAgentMode?: (v: ((prev: 'ask' | 'read' | 'agent') => 'ask' | 'read' | 'agent')) => void;
  onExport?: () => void;
  onAttachFile?: () => void;
  onAttachRow?: () => void;
  onSelectModeToggle?: () => void;
  selectModeActive?: boolean;
}

function ToolbarBtn({ icon, label, active, onClick, className: extraClass }: {
  icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void; className?: string;
}) {
  return (
    <button onClick={onClick} title={label}
      className={cn(
        "p-1 rounded transition-colors flex-shrink-0",
        active ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
               : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]",
        extraClass
      )}>
      {icon}
    </button>
  );
}

export function ChatToolbar(props: ChatToolbarProps) {
  const {
    markdownEnabled, setMarkdownEnabled,
    showTerminal, setShowTerminal,
    onSummaryOpen,
    showRowBinding, setShowRowBinding, boundRowsCount,
    currentConversationId,
    onSearchToggle, searchActive, searchQuery, onSearchQueryChange,
    searchMatchCount, searchCurrentMatch, onSearchNext, onSearchPrev,
    onScheduledToggle, scheduledActive, scheduledCount,
    onPinnedToggle, pinnedListActive, pinnedCount,
    onDeleteChat,
    onNotificationsOpen,
    onParticipantsOpen,
    onCallClick,
    callActive,
  } = props;

  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchActive && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchActive]);

  return (
    <div className="flex items-center gap-0.5 px-3 py-0.5 border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)]/50 flex-shrink-0 overflow-x-auto scrollbar-none" data-chat-toolbar>
      {/* Markdown toggle */}
      <button type="button"
        onClick={() => setMarkdownEnabled(prev => !prev)}
        className={cn("text-[10px] font-semibold uppercase tracking-wide transition-colors px-1 py-0.5 rounded flex-shrink-0",
          markdownEnabled ? "text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")}
        title={markdownEnabled ? "Markdown: ON" : "Markdown: OFF"}>
        MD
      </button>

      {/* Terminal toggle */}
      <ToolbarBtn
        icon={<Terminal className="w-3.5 h-3.5" />}
        label={showTerminal ? "Скрыть терминал" : "Показать терминал"}
        active={showTerminal}
        onClick={() => setShowTerminal(prev => !prev)}
      />

      <div className="w-px h-4 bg-[var(--border-secondary)] mx-0.5 flex-shrink-0" />

      {/* Search */}
      {searchActive ? (
        <div className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded px-1.5 py-0.5">
          <Search className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery || ''}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.shiftKey ? onSearchPrev?.() : onSearchNext?.(); }
              if (e.key === 'Escape') { onSearchQueryChange?.(''); onSearchToggle?.(); }
            }}
            placeholder="Поиск..."
            className="bg-transparent text-xs text-[var(--text-primary)] outline-none w-24 min-w-0 placeholder:text-[var(--text-tertiary)]"
          />
          {searchQuery && (searchMatchCount ?? 0) > 0 && (
            <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
              {(searchCurrentMatch ?? 0) + 1}/{searchMatchCount}
            </span>
          )}
          {searchQuery && (searchMatchCount ?? 0) === 0 && (
            <span className="text-[10px] text-red-400 flex-shrink-0">0</span>
          )}
          <button onClick={onSearchPrev} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title="Предыдущий">
            <ChevronUp className="w-3 h-3" />
          </button>
          <button onClick={onSearchNext} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" title="Следующий">
            <ChevronDown className="w-3 h-3" />
          </button>
          <button onClick={() => { onSearchQueryChange?.(''); onSearchToggle?.(); }} className="p-0.5 text-[var(--text-tertiary)] hover:text-red-400" title="Закрыть">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <ToolbarBtn
          icon={<Search className="w-3.5 h-3.5" />}
          label="Поиск по чату"
          active={searchActive}
          onClick={onSearchToggle}
        />
      )}

      <div className="flex-1" />

      {/* Summary */}
      <ToolbarBtn
        icon={<FileText className="w-3.5 h-3.5" />}
        label="Сводка чата"
        onClick={onSummaryOpen}
      />

      <div className="w-px h-4 bg-[var(--border-secondary)] mx-0.5 flex-shrink-0" />

      {/* Attach row (conversation-level binding) */}
      <ToolbarBtn
        icon={
          <span className="relative">
            <Link2 className="w-3.5 h-3.5" />
            {boundRowsCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 text-[7px] min-w-[10px] h-[10px] flex items-center justify-center rounded-full bg-[var(--color-primary-500)] text-white font-medium">
                {boundRowsCount}
              </span>
            )}
          </span>
        }
        label="Привязать строку к чату"
        active={showRowBinding || boundRowsCount > 0}
        onClick={() => setShowRowBinding(prev => !prev)}
      />

      {/* Scheduled messages */}
      <ToolbarBtn
        icon={
          <span className="relative">
            <Clock className="w-3.5 h-3.5" />
            {(scheduledCount ?? 0) > 0 && (
              <span className="absolute -top-1.5 -right-1.5 text-[7px] min-w-[10px] h-[10px] flex items-center justify-center rounded-full bg-amber-400 text-white font-medium">
                {scheduledCount}
              </span>
            )}
          </span>
        }
        label="Отложенные сообщения"
        active={scheduledActive}
        onClick={onScheduledToggle}
      />

      {/* ADR-0068 WP-E follow-up — toggles PinnedBanner expanded list above
          MessagesArea. Badge mirrors the Scheduled pattern. */}
      <ToolbarBtn
        icon={
          <span className="relative">
            <Pin className="w-3.5 h-3.5" />
            {(pinnedCount ?? 0) > 0 && (
              <span className="absolute -top-1.5 -right-1.5 text-[7px] min-w-[10px] h-[10px] flex items-center justify-center rounded-full bg-[var(--color-primary-500)] text-white font-medium">
                {pinnedCount}
              </span>
            )}
          </span>
        }
        label="Закреплённые сообщения"
        active={pinnedListActive}
        onClick={onPinnedToggle}
      />

      {/* ADR-0059 §4.1 — voice call. Disabled until a conversation is selected. */}
      <ToolbarBtn
        icon={<Phone className="w-3.5 h-3.5" />}
        label="Звонок"
        active={callActive}
        onClick={currentConversationId ? onCallClick : undefined}
        className={!currentConversationId ? "opacity-30 cursor-not-allowed" : undefined}
      />

      {/* ADR-0059 §4.1 — overflow menu: Delete moved here.
          ADR-0064 §Per-chat — Notifications + Participants open the tabbed
          inline settings panel below BoundRowsStrip. */}
      <ChatToolbarOverflowMenu
        onNotifications={onNotificationsOpen}
        notificationsDisabled={!currentConversationId}
        onParticipants={onParticipantsOpen}
        participantsDisabled={!currentConversationId}
        onDelete={onDeleteChat}
        deleteDisabled={!currentConversationId}
      />
    </div>
  );
}

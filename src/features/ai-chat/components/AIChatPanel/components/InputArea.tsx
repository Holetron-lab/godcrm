/**
 * InputArea — Chat input with expandable toolbar.
 * ADR-119: Extracted from AIChatPanel.tsx JSX.
 * WP-18: Expandable toolbar with format, emoji, attach, schedule.
 *
 * Bottom bar layout (right-side 2×2 grid):
 *   [Paperclip] [+/Tools]
 *   [Send]      [Mic]
 *
 * Toolbar (above input): Format | Emoji | File, Row [gap] [scheduleTime] Schedule
 * Schedule flow: pick date → date shows in toolbar → Send sends as scheduled.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  X, Send, Paperclip, Loader2, Plus, Search, Link2, FolderOpen, Mic, Square,
  ImageIcon, FileText, File, Forward, Clock, Bold, Italic,
  Strikethrough, Code, Smile, Type, ListTodo, Table as TableIcon, ArrowRightLeft,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/utils/cn';
import { MentionInput, MentionUser } from '../../MentionInput';
import { RowBindingV2, BoundRow } from '../../RowBindingV2';
import { FilesSourceInlineSelector } from '../../FilesSourceInlineSelector';
import { filesApi, formatFileSize } from '@/features/files/api/filesApi';
import type { TasksSourceConfig, FilesSourceConfig } from '../../AIChatPanel.types';
import type { FavoritesConfig, AttachTabId } from '../types';
import type { ChatMessage } from '../../../types';
import { ScheduleDatePicker } from './ScheduleDatePicker';
import { QuoteChipStrip } from './QuoteChipStrip';

/* ── Emoji data (Telegram-style categories) ───────────────── */
const EMOJI_CATEGORIES = [
  { label: 'Часто', icon: '🕐', emojis: ['👍', '❤️', '😂', '🔥', '👀', '✅', '🎉', '💯', '🤔', '😊', '👋', '🙏', '💪', '⭐', '🚀', '💡', '👏', '🤝', '💫', '✨'] },
  { label: 'Лица', icon: '😀', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥴', '😵', '🤯', '🤠', '🥳', '🥸', '😎', '🤓', '🧐', '😤', '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'] },
  { label: 'Жесты', icon: '👋', emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '👶', '👧', '🧑', '👱'] },
  { label: 'Животные', icon: '🐶', emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🐢', '🐍', '🦎', '🦂', '🐠', '🐟', '🐡', '🐬', '🐳', '🐋', '🦈', '🐙', '🐚'] },
  { label: 'Еда', icon: '🍔', emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🫔', '🌮', '🌯', '🫕', '🥗', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🍙', '🍘'] },
  { label: 'Символы', icon: '❤️', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '⭐', '🌟', '✨', '💫', '🔥', '💥', '💢', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭', '❗', '❓', '❕', '❔', '‼️', '⁉️', '💤', '🎵', '🎶', '🔔', '📢', '📣', '💹', '🏷️'] },
  { label: 'Путешествия', icon: '✈️', emojis: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🛵', '🏍️', '🚲', '🛴', '🛹', '🚁', '✈️', '🛩️', '🚀', '🛸', '🚢', '⛵', '🚤', '🛥️', '⛴️', '🏠', '🏡', '🏢', '🏣', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼', '🗽', '⛪', '🕌', '🛕', '🕍', '🗾', '🎑', '🏞️', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆'] },
  { label: 'Предметы', icon: '💻', emojis: ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽', '💾', '💿', '📀', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️', '⌛', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '🔑', '🗝️', '🔒', '🔓', '🔏', '🔐'] },
];

/* ── Format helpers ────────────────────────────────────────── */
type FormatAction = 'bold' | 'italic' | 'strike' | 'spoiler' | 'code' | 'codeblock';

const FORMAT_WRAPPERS: Record<FormatAction, { prefix: string; suffix: string; placeholder: string; block?: boolean }> = {
  bold:      { prefix: '**', suffix: '**', placeholder: 'Bold' },
  italic:    { prefix: '*', suffix: '*', placeholder: 'Italic' },
  strike:    { prefix: '~~', suffix: '~~', placeholder: 'Strike' },
  spoiler:   { prefix: '||', suffix: '||', placeholder: 'Spoiler' },
  code:      { prefix: '`', suffix: '`', placeholder: 'Code' },
  codeblock: { prefix: '```\n', suffix: '\n```', placeholder: 'Code block', block: true },
};

interface InputAreaProps {
  // Input state
  inputValue: string;
  setInputValue: (v: string | ((prev: string) => string)) => void;
  attachments: File[];
  setAttachments: (v: File[] | ((prev: File[]) => File[])) => void;
  mentionedUsers: MentionUser[];
  setMentionedUsers: (v: MentionUser[] | ((prev: MentionUser[]) => MentionUser[])) => void;
  messageBoundRows: BoundRow[];
  setMessageBoundRows: (v: BoundRow[] | ((prev: BoundRow[]) => BoundRow[])) => void;
  // File picker
  showFilePicker: boolean;
  setShowFilePicker: (v: boolean | ((prev: boolean) => boolean)) => void;
  attachTab: AttachTabId;
  setAttachTab: (v: AttachTabId) => void;
  filesSource: FilesSourceConfig | undefined;
  updateFilesSource: (v: FilesSourceConfig | undefined) => void;
  projectFiles: any[];
  isLoadingFiles: boolean;
  filesSearch: string;
  setFilesSearch: (v: string) => void;
  effectiveSpaceId: number | undefined;
  tasksSource: TasksSourceConfig | undefined;
  favoritesConfig?: FavoritesConfig;
  // Mode toggles
  chatPartner: { type: string; name?: string } | null;
  hasSlashCommand: boolean;
  thinkingEnabled: boolean;
  setThinkingEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  agentMode: 'ask' | 'read' | 'agent';
  setAgentMode: (v: ((prev: 'ask' | 'read' | 'agent') => 'ask' | 'read' | 'agent')) => void;
  markdownEnabled: boolean;
  setMarkdownEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  showTerminal: boolean;
  setShowTerminal: (v: boolean | ((prev: boolean) => boolean)) => void;
  // Voice
  isRecording: boolean;
  isTranscribing: boolean;
  voiceError: string | null | undefined;
  recordingDuration: number;
  startRecording: () => void;
  stopRecording: () => void;
  cancelRecording: () => void;
  voiceMode: string;
  // Submit
  isLoading: boolean;
  isAgentProcessing: boolean;
  stopAgent: () => void;
  handleSubmit: (e?: React.FormEvent) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
  // Mentions
  availableMentionUsers: MentionUser[];
  availableSlashAgents: MentionUser[];
  // Panel mode
  panelMode: string;
  // Paste files from clipboard
  onPasteFiles?: (files: File[]) => void;
  // Forwarded messages
  forwardMessages?: ChatMessage[];
  setForwardMessages?: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  // ADR-0031 WP-24 FE follow-up: Move queue.
  // - Source bubbles get a cyan ring (in ChatTurn).
  // - When messages are queued, Send becomes a cyan ⇄ button.
  // - Click cyan ⇄ → amber strip appears + inbox opens for target pick.
  moveMessages?: ChatMessage[];
  setMoveMessages?: (v: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  onMoveAttempt?: () => void;
  currentConversationId?: number;
  // WP-17: Scheduled messages
  scheduledActive?: boolean;
  setScheduledActive?: (v: boolean | ((prev: boolean) => boolean)) => void;
  scheduledCount?: number;
  onScheduleMessage?: (isoDate: string) => Promise<void>;
  isScheduling?: boolean;
  initialScheduleDate?: string | null;
}

export function InputArea(props: InputAreaProps) {
  const {
    inputValue, setInputValue, attachments, setAttachments, mentionedUsers, setMentionedUsers,
    messageBoundRows, setMessageBoundRows,
    showFilePicker, setShowFilePicker, attachTab, setAttachTab,
    filesSource, updateFilesSource, projectFiles, isLoadingFiles, filesSearch, setFilesSearch,
    effectiveSpaceId, tasksSource, favoritesConfig,
    chatPartner, hasSlashCommand, thinkingEnabled, setThinkingEnabled,
    agentMode, setAgentMode, markdownEnabled, setMarkdownEnabled,
    showTerminal, setShowTerminal,
    isRecording, isTranscribing, voiceError, recordingDuration,
    startRecording, stopRecording, cancelRecording,
    isLoading, isAgentProcessing, stopAgent, handleSubmit, handleFileSelect, fileInputRef,
    availableMentionUsers, availableSlashAgents,
    panelMode, onPasteFiles,
    forwardMessages = [], setForwardMessages,
    moveMessages = [], setMoveMessages, onMoveAttempt,
    currentConversationId,
    scheduledActive, setScheduledActive, scheduledCount,
    onScheduleMessage, isScheduling, initialScheduleDate,
  } = props;

  const [showToolbar, setShowToolbar] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [showMoveWarning, setShowMoveWarning] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(0);
  const [isUploadingToSource, setIsUploadingToSource] = useState(false);
  // Pending schedule: when set, Send becomes "Schedule Send"
  const [pendingScheduleDate, setPendingScheduleDate] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sourceUploadInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  /* ── Upload picked file directly into the active filesSource ── */
  const handleSourceUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !filesSource) return;
    setIsUploadingToSource(true);
    try {
      await filesApi.upload(files, {
        spaceId: effectiveSpaceId,
        projectId: filesSource.projectId,
        tableId: filesSource.tableId,
      });
      await queryClient.invalidateQueries({ queryKey: ['project-files'] });
    } catch (err) {
      console.error('[InputArea] upload to filesSource failed', err);
    } finally {
      setIsUploadingToSource(false);
    }
  }, [filesSource, effectiveSpaceId, queryClient]);

  // Pick up initialScheduleDate from parent (e.g. when editing a scheduled message)
  useEffect(() => {
    if (initialScheduleDate) setPendingScheduleDate(initialScheduleDate);
  }, [initialScheduleDate]);

  // Hide the move-warning strip whenever the queue empties
  useEffect(() => {
    if (moveMessages.length === 0 && showMoveWarning) setShowMoveWarning(false);
  }, [moveMessages.length, showMoveWarning]);

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
    if (type.includes('pdf') || type.includes('document')) return <FileText className="w-4 h-4" />;
    return <File className="w-4 h-4" />;
  };

  /* ── Format text in textarea ─────────────────────────────── */
  const applyFormat = useCallback((action: FormatAction) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { prefix, suffix, placeholder } = FORMAT_WRAPPERS[action];
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = inputValue.slice(start, end);
    const fill = selected || placeholder;
    const wrapped = `${prefix}${fill}${suffix}`;
    const newValue = inputValue.slice(0, start) + wrapped + inputValue.slice(end);
    setInputValue(newValue);
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = selected ? start + wrapped.length : start + prefix.length;
      const cursorEnd = selected ? start + wrapped.length : start + prefix.length + fill.length;
      ta.setSelectionRange(cursorPos, cursorEnd);
    });
  }, [inputValue, setInputValue]);

  /* ── Insert emoji at cursor ──────────────────────────────── */
  const insertEmoji = useCallback((emoji: string) => {
    const ta = textareaRef.current;
    const pos = ta ? ta.selectionStart : inputValue.length;
    const newValue = inputValue.slice(0, pos) + emoji + inputValue.slice(pos);
    setInputValue(newValue);
    // keep picker open after inserting emoji
    requestAnimationFrame(() => {
      ta?.focus();
      const newPos = pos + emoji.length;
      ta?.setSelectionRange(newPos, newPos);
    });
  }, [inputValue, setInputValue]);

  /* ── Submit: schedule > move-source-guard > normal send.
       If the user has queued moves AND is still in the source chat, refuse
       to send: show amber warning + open the inbox so they pick another
       chat. Once they navigate to a different conv, normal Send works and
       useEventHandlers prepends the move-quote block (like forward). ── */
  const handleActualSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (pendingScheduleDate && onScheduleMessage) {
      onScheduleMessage(pendingScheduleDate).then(() => {
        setPendingScheduleDate(null);
      });
      return;
    }
    if (moveMessages.length > 0) {
      const sourceConvId = moveMessages[0]?.conversation_id;
      if (sourceConvId && currentConversationId && Number(sourceConvId) === Number(currentConversationId)) {
        setShowMoveWarning(true);
        onMoveAttempt?.();
        return;
      }
    }
    handleSubmit(e);
  }, [pendingScheduleDate, onScheduleMessage, handleSubmit, moveMessages, currentConversationId, onMoveAttempt]);

  if (panelMode === 'fullscreen') return null;

  /* ── Toolbar button helper ───────────────────────────────── */
  const TBtn = ({ icon, label, active, badge, onClick, className: cls }: {
    icon: React.ReactNode; label: string; active?: boolean; badge?: number;
    onClick: () => void; className?: string;
  }) => (
    <button type="button" onClick={onClick} title={label}
      className={cn(
        "relative p-1.5 rounded-lg transition-all duration-150 text-[var(--text-tertiary)]",
        "hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]",
        active && "!text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10",
        cls
      )}>
      {icon}
      {badge != null && badge > 0 && (
        <span className="absolute -top-1 -right-1 text-[7px] min-w-[13px] h-[13px] flex items-center justify-center rounded-full bg-[var(--color-primary-500)] text-white font-bold">
          {badge}
        </span>
      )}
    </button>
  );

  const FmtBtn = ({ icon, label, action }: { icon: React.ReactNode; label: string; action: FormatAction }) => (
    <button type="button" onClick={() => applyFormat(action)} title={label}
      className="p-1 rounded transition-colors text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]">
      {icon}
    </button>
  );

  /* ── Format pending schedule time for display ── */
  const formatPendingDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();
    const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Сегодня ${time}`;
    if (isTomorrow) return `Завтра ${time}`;
    return d.toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  const hasContent = inputValue.trim() || attachments.length > 0;

  return (
    <div className="flex-shrink-0 px-2 pb-2 bg-[var(--bg-primary)]"
      data-chat-input-area
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}>

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="px-1 pb-1">
          <div className="flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div key={index} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-xs">
                {getFileIcon(file.type)}
                <span className="max-w-[100px] truncate text-[var(--text-primary)]">{file.name}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))}
                  className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unified Attach Panel */}
      {showFilePicker && (
        <div className="mb-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="flex items-stretch border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
            {/* ── Scrollable tabs (browser-tab style) ── */}
            <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
              <button onClick={() => setAttachTab('files')}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2',
                  attachTab === 'files' ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]')}>
                <FolderOpen className="w-3.5 h-3.5" />
                Файлы
              </button>
              {tasksSource && (
                <button onClick={() => setAttachTab('tickets')}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2',
                    attachTab === 'tickets' ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]')}>
                  <ListTodo className="w-3.5 h-3.5" />{tasksSource.tableName || 'Тикеты'}
                </button>
              )}
              {favoritesConfig?.documents && (
                <button onClick={() => setAttachTab('documents')}
                  className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2',
                    attachTab === 'documents' ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]')}>
                  <FileText className="w-3.5 h-3.5" />{favoritesConfig.documents.tableName || 'Documents'}
                </button>
              )}
              {(favoritesConfig?.custom || []).map(c => {
                const tabId: AttachTabId = `favorite:${c.tableId}`;
                return (
                  <button key={c.tableId} onClick={() => setAttachTab(tabId)}
                    className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2',
                      attachTab === tabId ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]')}>
                    <TableIcon className="w-3.5 h-3.5" />{c.tableName}
                  </button>
                );
              })}
            </div>
            {/* ── Right-pinned: Другая таблица + Close (never scroll) ── */}
            <div className="flex items-center flex-shrink-0 border-l border-[var(--border-secondary)]">
              <button onClick={() => setAttachTab('other')} title="Другая таблица"
                className={cn('flex items-center px-2 py-1.5 whitespace-nowrap transition-colors border-b-2 self-stretch',
                  attachTab === 'other' ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]')}>
                <TableIcon className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setShowFilePicker(false); setFilesSearch(''); }}
                title="Закрыть"
                className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Stable-height body — prevents popup from jumping when switching tabs */}
          <div className="min-h-[260px]">

          {attachTab === 'files' && (
            filesSource ? (
              <>
                <input
                  ref={sourceUploadInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleSourceUpload}
                />
                <div className="p-1">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                      <input type="text" value={filesSearch} onChange={(e) => setFilesSearch(e.target.value)} placeholder="Поиск файлов..."
                        className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30" />
                      {filesSearch && (
                        <button type="button" onClick={() => setFilesSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"><X className="w-3 h-3" /></button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => sourceUploadInputRef.current?.click()}
                      disabled={isUploadingToSource}
                      title={`Загрузить файл в «${filesSource.tableName}»`}
                      className="p-2 rounded-lg transition-colors flex-shrink-0 border bg-[var(--bg-tertiary)] text-[var(--color-primary-500)] border-[var(--border-primary)] hover:bg-[var(--color-primary-500)]/10 disabled:opacity-50"
                    >
                      {isUploadingToSource
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Plus className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {isLoadingFiles ? (
                    <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" /></div>
                  ) : projectFiles.length === 0 ? (
                    <div className="py-4 text-center text-xs text-[var(--text-tertiary)]">Нет файлов</div>
                  ) : (
                    projectFiles.filter(file => {
                      if (!filesSearch.trim()) return true;
                      return (file.name || file.originalName || file.original_name || '').toLowerCase().includes(filesSearch.toLowerCase());
                    }).map(file => (
                      <button key={file.id} onClick={() => {
                        if (filesSource.tableId) {
                          setMessageBoundRows(prev => [...prev, {
                            table_id: filesSource.tableId, row_id: parseInt(file.id) || 0,
                            table_name: filesSource.tableName, table_icon: filesSource.tableIcon || '📁',
                            row_title: file.name || file.originalName || file.original_name || 'File'
                          }]);
                        }
                        setShowFilePicker(false); setFilesSearch('');
                      }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-secondary)] last:border-0 transition-colors">
                        <span className="text-base flex-shrink-0">{getFileIcon(file.mimeType || file.mime_type || '')}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-[var(--text-primary)] truncate">{file.name || file.originalName || file.original_name}</div>
                          <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                            <span>{formatFileSize(file.size)}</span><span>·</span>
                            <span>{(file.mimeType || file.mime_type || 'unknown').split('/').pop()}</span>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-tertiary)]">
                  <FolderOpen className="w-3.5 h-3.5" /><span>Выберите источник</span>
                </div>
                <FilesSourceInlineSelector defaultSpaceId={effectiveSpaceId}
                  onSelect={(config) => updateFilesSource(config)}
                  onCancel={() => setShowFilePicker(false)} />
              </div>
            )
          )}

          {attachTab === 'tickets' && (
            <RowBindingV2 defaultSpaceId={effectiveSpaceId} boundRows={messageBoundRows} maxBindings={5}
              compact={true} hideHeader={true} hideTabBar={true} forceExpanded={true} tasksSource={tasksSource} allowOtherTables={false}
              onClose={() => setShowFilePicker(false)}
              onBind={(binding) => setMessageBoundRows(prev => [...prev, binding])}
              onUnbind={(tableId, rowId) => setMessageBoundRows(prev => prev.filter(br => !(br.table_id === tableId && br.row_id === rowId)))} />
          )}

          {attachTab === 'documents' && favoritesConfig?.documents && (
            <RowBindingV2 defaultSpaceId={effectiveSpaceId} boundRows={messageBoundRows} maxBindings={5}
              compact={true} hideHeader={true} hideTabBar={true} forceExpanded={true} documentsSource={favoritesConfig.documents} allowOtherTables={false}
              onClose={() => setShowFilePicker(false)}
              onBind={(binding) => setMessageBoundRows(prev => [...prev, binding])}
              onUnbind={(tableId, rowId) => setMessageBoundRows(prev => prev.filter(br => !(br.table_id === tableId && br.row_id === rowId)))} />
          )}

          {typeof attachTab === 'string' && attachTab.startsWith('favorite:') && (() => {
            const id = Number(attachTab.slice('favorite:'.length));
            const fav = (favoritesConfig?.custom || []).find(c => c.tableId === id);
            if (!fav) return null;
            return (
              <RowBindingV2 defaultSpaceId={effectiveSpaceId} boundRows={messageBoundRows} maxBindings={5}
                compact={true} hideHeader={true} hideTabBar={true} forceExpanded={true} customSources={[fav]} allowOtherTables={false}
                onClose={() => setShowFilePicker(false)}
                onBind={(binding) => setMessageBoundRows(prev => [...prev, binding])}
                onUnbind={(tableId, rowId) => setMessageBoundRows(prev => prev.filter(br => !(br.table_id === tableId && br.row_id === rowId)))} />
            );
          })()}

          {attachTab === 'other' && (
            <RowBindingV2 defaultSpaceId={effectiveSpaceId} boundRows={messageBoundRows} maxBindings={5}
              compact={true} hideHeader={true} hideTabBar={true} forceExpanded={true} allowOtherTables={true}
              onClose={() => setShowFilePicker(false)}
              onBind={(binding) => setMessageBoundRows(prev => [...prev, binding])}
              onUnbind={(tableId, rowId) => setMessageBoundRows(prev => prev.filter(br => !(br.table_id === tableId && br.row_id === rowId)))} />
          )}
          </div>
        </div>
      )}

      {/* Message-level bound rows chips */}
      {messageBoundRows.length > 0 && (
        <div className="px-1 pb-1 flex flex-wrap items-center gap-1">
          <Link2 className="w-3 h-3 flex-shrink-0 text-[var(--color-primary-500)]" />
          {messageBoundRows.map((br, idx) => (
            <div key={`${br.table_id}-${br.row_id}-${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-[11px]">
              {br.table_icon && <span className="text-xs">{br.table_icon}</span>}
              <span className="text-blue-300 truncate max-w-[150px]">{br.row_title || `#${br.row_id}`}</span>
              <button onClick={() => setMessageBoundRows(prev => prev.filter((_, i) => i !== idx))}
                className="text-blue-400/60 hover:text-red-400 transition-colors"><X className="w-2.5 h-2.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Forward (orange) and move (cyan) chip strips share UX 1:1 — see
          QuoteChipStrip. Move strip has an amber warning footer that fires
          only when user tries to send while still in the source chat. */}
      <QuoteChipStrip
        messages={forwardMessages}
        setMessages={setForwardMessages}
        tone="orange"
        leadIcon={<Forward className="w-3 h-3 flex-shrink-0 text-orange-400" />}
      />
      <QuoteChipStrip
        messages={moveMessages}
        setMessages={setMoveMessages}
        tone="cyan"
        leadIcon={<ArrowRightLeft className="w-3 h-3 flex-shrink-0 text-cyan-400" />}
        footer={showMoveWarning ? (
          <div className="mt-1 px-2 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-300 flex items-center gap-2">
            <ArrowRightLeft className="w-3 h-3 flex-shrink-0" />
            <span className="flex-1 truncate">
              Перенос {moveMessages.length} сообщ. — выберите другой чат во входящих
            </span>
          </div>
        ) : null}
      />

      {/* ── Schedule date picker (appears above toolbar) ── */}
      {showSchedulePicker && onScheduleMessage && (
        <div className="relative mb-1">
          <ScheduleDatePicker
            isScheduling={isScheduling}
            onSchedule={(isoDate) => {
              setPendingScheduleDate(isoDate);
              setShowSchedulePicker(false);
            }}
            onCancel={() => setShowSchedulePicker(false)}
          />
        </div>
      )}

      {/* ═══ Input Box ═══ */}
      <div className="bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
        <form onSubmit={handleActualSubmit}>
          <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple className="hidden" accept="image/*,.pdf,.txt,.md,.json,.csv" />

          {/* ── Expandable Toolbar (ABOVE input) ── */}
          {showToolbar && (
            <div className="px-1.5 pt-1.5 animate-in slide-in-from-top-1 duration-150">
              <div className="flex items-center gap-0.5 flex-wrap rounded-lg bg-[var(--bg-secondary)]/60 px-1 py-0.5">

                {/* ── Format group ── */}
                <FmtBtn icon={<Bold className="w-3.5 h-3.5" />} label="Жирный **" action="bold" />
                <FmtBtn icon={<Italic className="w-3.5 h-3.5" />} label="Курсив *" action="italic" />
                <FmtBtn icon={<Strikethrough className="w-3.5 h-3.5" />} label="Зачёркнутый ~~" action="strike" />
                <FmtBtn icon={<span className="text-[10px] font-bold leading-none">||</span>} label="Спойлер ||" action="spoiler" />
                <FmtBtn icon={<Code className="w-3.5 h-3.5" />} label="Код `" action="code" />
                <FmtBtn icon={<Type className="w-3.5 h-3.5" />} label="Блок кода ```" action="codeblock" />

                {/* Divider */}
                <div className="w-px h-4 bg-[var(--border-primary)] mx-0.5" />

                {/* ── Emoji ── */}
                <TBtn icon={<Smile className="w-3.5 h-3.5" />} label="Эмодзи"
                  active={showEmojiPicker}
                  onClick={() => { setShowEmojiPicker(prev => !prev); setShowFilePicker(false); }} />

                {/* Divider */}
                <div className="w-px h-4 bg-[var(--border-primary)] mx-0.5" />

                {/* ── Files ── */}
                <TBtn icon={<Paperclip className="w-3.5 h-3.5" />} label="Прикрепить файл"
                  active={showFilePicker && attachTab === 'files'}
                  onClick={() => { setShowFilePicker(prev => attachTab === 'files' ? !prev : true); setAttachTab('files'); setShowEmojiPicker(false); }} />

                {/* ── Rows (Tickets / Documents / Custom / Other) ── */}
                <TBtn icon={<Link2 className="w-3.5 h-3.5" />} label="Прикрепить строку"
                  active={showFilePicker && attachTab !== 'files'} badge={messageBoundRows.length}
                  onClick={() => {
                    const isRowsTab = attachTab !== 'files';
                    setShowFilePicker(prev => isRowsTab ? !prev : true);
                    if (!isRowsTab) {
                      const firstFav = (favoritesConfig?.custom || [])[0];
                      const next: AttachTabId = tasksSource ? 'tickets'
                        : favoritesConfig?.documents ? 'documents'
                        : firstFav ? `favorite:${firstFav.tableId}`
                        : 'other';
                      setAttachTab(next);
                    }
                    setShowEmojiPicker(false);
                  }} />

                {/* Spacer */}
                <div className="flex-1" />

                {/* ── Pending schedule date display ── */}
                {pendingScheduleDate && (
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-[11px] font-medium">
                    <Clock className="w-3 h-3" />
                    <span>{formatPendingDate(pendingScheduleDate)}</span>
                    <button type="button" onClick={() => setPendingScheduleDate(null)}
                      className="text-amber-400/60 hover:text-red-400 transition-colors">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                )}

                {/* ── Schedule ── */}
                <TBtn icon={<Clock className="w-3.5 h-3.5" />} label="Отложить сообщение"
                  active={showSchedulePicker || !!pendingScheduleDate}
                  onClick={() => { setShowSchedulePicker(prev => !prev); setShowEmojiPicker(false); }} />
              </div>
            </div>
          )}

          {/* ── Emoji Picker Panel ── */}
          {showEmojiPicker && (
            <div className="mx-1.5 mt-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden animate-in slide-in-from-top-1 duration-150">
              <div className="flex items-center border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)] overflow-x-auto scrollbar-none">
                {EMOJI_CATEGORIES.map((cat, idx) => (
                  <button key={cat.label} type="button" onClick={() => setEmojiCategory(idx)}
                    className={cn('flex items-center gap-1 px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors border-b-2 flex-shrink-0',
                      emojiCategory === idx
                        ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]'
                        : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]')}>
                    <span className="text-sm">{cat.icon}</span>
                    <span className="text-[11px]">{cat.label}</span>
                  </button>
                ))}
                <div className="flex-1" />
                <button type="button" onClick={() => setShowEmojiPicker(false)}
                  className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="h-[144px] overflow-y-auto p-2">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(32px,1fr))] gap-0.5">
                  {EMOJI_CATEGORIES[emojiCategory].emojis.map((emoji, i) => (
                    <button key={`${emoji}-${i}`} type="button" onClick={() => insertEmoji(emoji)}
                      className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-[var(--bg-tertiary)] transition-colors text-lg">
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── Input row: textarea left + buttons right ── */}
          <div className="flex items-end gap-1 px-1.5 pb-1.5 pt-1">
            {/* Left: textarea (flex-1) */}
            <div className="flex-1 min-w-0">
              <MentionInput ref={textareaRef} value={inputValue} onChange={setInputValue}
                onMention={(user) => { setMentionedUsers(prev => prev.some(u => u.id === user.id && u.type === user.type) ? prev : [...prev, user]); }}
                onSubmit={() => handleActualSubmit()}
                onPasteFiles={onPasteFiles}
                availableUsers={availableMentionUsers} availableAgents={availableSlashAgents}
                placeholder={chatPartner?.type === 'agent' ? `Спросить ${chatPartner.name}...` : "Сообщение... (/ вызвать агента)"}
                disabled={isLoading} className="w-full"
                inputClassName="px-2 py-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none resize-none disabled:opacity-50 text-sm leading-5"
                maxRows={4} />

              {/* Pending schedule indicator (below textarea) */}
              {pendingScheduleDate && !showToolbar && (
                <div className="flex items-center gap-1.5 px-2 pb-0.5">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span className="text-[11px] text-amber-400 font-medium">{formatPendingDate(pendingScheduleDate)}</span>
                  <button type="button" onClick={() => setPendingScheduleDate(null)}
                    className="text-amber-400/60 hover:text-red-400 transition-colors">
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Right: 2×2 grid — [Paperclip][+] / [Send][Mic] */}
            <div className="grid grid-cols-2 gap-0.5 flex-shrink-0">
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                title="Прикрепить файл">
                <Paperclip className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => { setShowToolbar(prev => !prev); setShowEmojiPicker(false); }}
                className={cn(
                  "p-1 rounded-lg transition-all duration-200",
                  showToolbar
                    ? "text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 rotate-45"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                )} title={showToolbar ? "Скрыть панель" : "Инструменты"}>
                <Plus className="w-4 h-4 transition-transform duration-200" />
              </button>

              {isAgentProcessing ? (
                <button type="button" onClick={stopAgent} className="p-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors" title="Стоп агент">
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button type="submit" disabled={isLoading || (!hasContent && !pendingScheduleDate && moveMessages.length === 0)}
                  className={cn('p-1 rounded-lg transition-colors',
                    isLoading || (!hasContent && !pendingScheduleDate && moveMessages.length === 0)
                      ? 'text-[var(--text-tertiary)] cursor-not-allowed'
                      : pendingScheduleDate
                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : 'bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]')}>
                  {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : pendingScheduleDate ? <Clock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
                </button>
              )}
              {isRecording ? (
                <div className="flex items-center gap-0.5">
                  <span className="text-[9px] text-red-400 tabular-nums">
                    {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                  </span>
                  <button type="button" onClick={stopRecording} className="p-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors animate-pulse" title="Стоп">
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                </div>
              ) : isTranscribing ? (
                <button type="button" disabled className="p-1 rounded-lg text-[var(--text-tertiary)] cursor-wait" title="Транскрибирую...">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : (
                <button type="button" onClick={startRecording}
                  className={cn("p-1 rounded-lg transition-colors", voiceError ? "text-red-400 hover:bg-red-500/10" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]")}
                  title={voiceError || "Голосовой ввод"}>
                  <Mic className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

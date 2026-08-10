import React, { useCallback } from 'react';
import { 
  Link2, 
  Eye, 
  EyeOff, 
  Brain, 
  Zap, 
  Plus, 
  Paperclip, 
  Mic, 
  Send, 
  Loader2, 
  X, 
  Square,
  FolderOpen,
  Search,
  Settings
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { getFileIcon, formatFileSize } from '@/shared/utils/fileHelpers';
import { logger } from '@/shared/utils/logger';
import { RowBindingV2 } from '@/features/ai-chat/components/RowBindingV2';
import { FilesSourceInlineSelector } from '@/features/ai-chat/components/FilesSourceInlineSelector';
import { MentionInput } from '@/features/ai-chat/components/MentionInput';
import type { 
  ChatPartner, 
  BoundRow, 
  FilesSource, 
  Space,
  ProjectFile,
  MentionUser
} from '../../types';

interface ChatInputProps {
  chatPartner: ChatPartner | null;
  inputValue: string;
  isLoading: boolean;
  showRowBinding: boolean;
  showFilePicker: boolean;
  showBoundRowsBar: boolean;
  boundRows: BoundRow[];
  filesSource: FilesSource | undefined;
  filesSearch: string;
  isLoadingFiles: boolean;
  projectFiles: ProjectFile[];
  thinkingEnabled: boolean;
  agentMode: 'ask' | 'read' | 'agent';
  markdownEnabled: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  recordingDuration: number;
  voiceMode: 'webSpeech' | 'whisper';
  voiceError: string | null;
  attachments: Array<{ name: string; type: string; size?: number }>;
  availableMentionUsers: MentionUser[];
  availableSlashAgents?: MentionUser[];
  mentionedUsers: MentionUser[];
  currentSpace: Space | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  setInputValue: (value: string) => void;
  setShowRowBinding: (show: boolean | ((prev: boolean) => boolean)) => void;
  setShowFilePicker: (show: boolean | ((prev: boolean) => boolean)) => void;
  setShowBoundRowsBar: (show: boolean | ((prev: boolean) => boolean)) => void;
  setBoundRows: (rows: BoundRow[] | ((prev: BoundRow[]) => BoundRow[])) => void;
  setFilesSource: (source: FilesSource | undefined) => void;
  setFilesSearch: (search: string) => void;
  setThinkingEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  setAgentMode: (mode: 'ask' | 'read' | 'agent' | ((prev: 'ask' | 'read' | 'agent') => 'ask' | 'read' | 'agent')) => void;
  setMarkdownEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
  setMentionedUsers: (users: MentionUser[] | ((prev: MentionUser[]) => MentionUser[])) => void;
  handleSubmit: (e?: React.FormEvent) => void;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  startRecording: () => void;
  stopRecording: () => void;
  cancelRecording: () => void;
  isAgentProcessing?: boolean;
  onStopAgent?: () => void;
}

/**
 * ADR-116 Task #11: Wrap bare @mentions with structured invocation tokens.
 *
 * Converts `@slug` to `<<@slug>>` when the slug matches a known user,
 * but only if the mention is not already wrapped (negative lookbehind for `<<`).
 */
function validateAndWrapMentions(content: string, availableUsers: MentionUser[]): string {
  const slugSet = new Set(availableUsers.map(u => u.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')));
  return content.replace(/(?<!<<)@([a-z0-9_-]+)/gi, (match, slug) => {
    return slugSet.has(slug.toLowerCase()) ? `<<@${slug.toLowerCase()}>>` : match;
  });
}

export const ChatInput: React.FC<ChatInputProps> = ({
  chatPartner,
  inputValue,
  isLoading,
  showRowBinding,
  showFilePicker,
  showBoundRowsBar,
  boundRows,
  filesSource,
  filesSearch,
  isLoadingFiles,
  projectFiles,
  thinkingEnabled,
  agentMode,
  markdownEnabled,
  isRecording,
  isTranscribing,
  recordingDuration,
  voiceMode,
  voiceError,
  attachments,
  availableMentionUsers,
  availableSlashAgents,
  mentionedUsers,
  currentSpace,
  fileInputRef,
  setInputValue,
  setShowRowBinding,
  setShowFilePicker,
  setShowBoundRowsBar,
  setBoundRows,
  setFilesSource,
  setFilesSearch,
  setThinkingEnabled,
  setAgentMode,
  setMarkdownEnabled,
  setMentionedUsers,
  handleSubmit,
  handleFileSelect,
  startRecording,
  stopRecording,
  cancelRecording,
  isAgentProcessing = false,
  onStopAgent
}) => {
  // ADR-116 Task #11: Pre-process content on submit — wrap bare @mentions before handing off to parent.
  // The parent's handleSubmit also validates, but doing it here gives the ChatInput component ownership
  // of mention formatting and allows the negative-lookbehind regex to skip already-wrapped tokens.
  const handleSubmitWithValidation = useCallback((e?: React.FormEvent) => {
    const processed = validateAndWrapMentions(inputValue, availableMentionUsers);
    if (processed !== inputValue) {
      setInputValue(processed);
    }
    handleSubmit(e);
  }, [inputValue, availableMentionUsers, setInputValue, handleSubmit]);

  const filteredProjectFiles = projectFiles.filter(file => {
    if (!filesSearch.trim()) return true;
    const name = (file.name || file.originalName || file.original_name || '').toLowerCase();
    return name.includes(filesSearch.toLowerCase());
  });

  return (
    <div className="flex-shrink-0 p-3 bg-[var(--bg-primary)] border-t border-[var(--border-primary)]">
      {/* Row Binding Panel - conditionally shown */}
      {showRowBinding && (
        <div className="mb-2">
          <RowBindingV2
            defaultSpaceId={currentSpace?.id}
            boundRows={boundRows}
            maxBindings={5}
            compact={false}
            hideHeader={true}
            forceExpanded={true}
            tasksSource={undefined}
            allowOtherTables={true}
            onClose={() => setShowRowBinding(false)}
            onBind={(binding) => {
              setBoundRows(prev => [...prev, binding]);
            }}
            onUnbind={(tableId, rowId) => {
              setBoundRows(prev => prev.filter(
                br => !(br.table_id === tableId && br.row_id === rowId)
              ));
            }}
          />
        </div>
      )}

      {/* File Picker Panel - conditionally shown */}
      {showFilePicker && (
        <div className="mb-2 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden">
          {filesSource ? (
            <>
              {/* Header with icon, search, and close */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] flex-shrink-0">
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>{filesSource.tableIcon || '📁'} {filesSource.tableName}</span>
                </div>
                <div className="flex-1 relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-tertiary)]" />
                  <input
                    type="text"
                    value={filesSearch}
                    onChange={(e) => setFilesSearch(e.target.value)}
                    placeholder="Поиск..."
                    className="w-full pl-7 pr-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                  />
                </div>
                <button
                  onClick={() => setFilesSource(undefined)}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-shrink-0 mr-1"
                  title="Сменить источник"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => {
                    setShowFilePicker(false);
                    setFilesSearch('');
                  }}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {isLoadingFiles ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                  </div>
                ) : filteredProjectFiles.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[var(--text-tertiary)]">
                    Нет файлов в проекте
                  </div>
                ) : (
                  filteredProjectFiles.map(file => (
                    <button
                      key={file.id}
                      onClick={() => {
                        // Add file to bound rows as table binding
                        if (filesSource.tableId) {
                          const binding: BoundRow = {
                            table_id: filesSource.tableId,
                            row_id: Number(file.id) || 0,
                            table_name: filesSource.tableName,
                            table_icon: filesSource.tableIcon || '📁',
                            row_title: file.name || file.originalName || file.original_name || 'Файл'
                          };
                          setBoundRows(prev => [...prev, binding]);
                        }
                        setShowFilePicker(false);
                        setFilesSearch('');
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-secondary)] last:border-0 transition-colors"
                    >
                      <span className="text-lg flex-shrink-0">
                        {getFileIcon(file.mimeType || file.mime_type || '')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-[var(--text-primary)] truncate">
                          {file.name || file.originalName || file.original_name}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                          <span>{formatFileSize(file.size)}</span>
                          <span>•</span>
                          <span>{(file.mimeType || file.mime_type || 'unknown').split('/').pop()}</span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            /* No filesSource configured - show source selector */
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <FolderOpen className="w-4 h-4" />
                  <span>Выберите источник файлов</span>
                </div>
                <button
                  onClick={() => {
                    setShowFilePicker(false);
                  }}
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <FilesSourceInlineSelector
                defaultSpaceId={currentSpace?.id}
                onSelect={(config) => {
                  setFilesSource(config);
                  setShowFilePicker(false);
                }}
                onCancel={() => setShowFilePicker(false)}
              />
            </div>
          )}
        </div>
      )}

      {/* Bound Rows Bar - simple text line above input when eye is toggled */}
      {showBoundRowsBar && boundRows.length > 0 && (
        <div className="px-1 pb-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Link2 className="w-3 h-3 flex-shrink-0 text-[var(--color-primary-500)]" />
          <span className="truncate">
            {boundRows.map((br, idx) => (
              <span key={`${br.table_id}-${br.row_id}`}>
                {idx > 0 && ', '}
                <span className="text-[var(--text-primary)]">{br.row_title || `#${br.row_id}`}</span>
                {br.table_name && <span className="text-[var(--text-tertiary)]"> ({br.table_name})</span>}
              </span>
            ))}
          </span>
        </div>
      )}
      
      {/* Input Box */}
      <div className="bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
        {/* Links row: Bind to record | Eye | MD */}
        <div className="flex items-center justify-between px-3 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowRowBinding(prev => !prev)}
              className={cn(
                "relative flex items-center gap-1 p-1 rounded transition-colors",
                showRowBinding || boundRows.length > 0
                  ? "text-[var(--color-primary-500)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              )}
              title="Привязать строку"
            >
              <Link2 className="w-3.5 h-3.5" />
              {boundRows.length > 0 && (
                <span className="text-[9px] min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[var(--color-primary-500)] text-white font-medium">
                  {boundRows.length}
                </span>
              )}
            </button>
            {boundRows.length > 0 && (
              <button
                type="button"
                onClick={() => setShowBoundRowsBar(prev => !prev)}
                className={cn(
                  "p-1 rounded transition-colors",
                  showBoundRowsBar
                    ? "text-[var(--color-primary-500)]"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                )}
                title={showBoundRowsBar ? "Скрыть привязки" : "Показать привязки"}
              >
                {showBoundRowsBar ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Thinking Toggle + Agent Mode Toggle - only for agent chats */}
            {chatPartner?.type === 'agent' && (
              <>
                {/* Thinking / Chain of Thought Toggle */}
                <button
                  type="button"
                  onClick={() => setThinkingEnabled(prev => !prev)}
                  className={cn(
                    "p-1 rounded transition-colors",
                    thinkingEnabled
                      ? "bg-pink-500/20 text-pink-400"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                  )}
                  title={thinkingEnabled ? "Цепочка рассуждений: ВКЛ" : "Цепочка рассуждений: ВЫКЛ"}
                >
                  <Brain className="w-3.5 h-3.5" />
                </button>
                {/* Agent Mode Toggle */}
                <button
                  type="button"
                  onClick={() => setAgentMode(prev => {
                    if (prev === 'ask') return 'read';
                    if (prev === 'read') return 'agent';
                    return 'ask';
                  })}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase transition-colors",
                    agentMode === 'agent' && "bg-orange-500/20 text-orange-400",
                    agentMode === 'ask' && "bg-blue-500/20 text-blue-400",
                    agentMode === 'read' && "bg-green-500/20 text-green-400"
                  )}
                  title={`Режим: ${agentMode === 'agent' ? 'Agent (выполняет задачи)' : agentMode === 'ask' ? 'Ask (отвечает на вопросы)' : 'Read (только чтение)'}`}
                >
                  <Zap className="w-3 h-3" />
                  {agentMode}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setMarkdownEnabled(prev => !prev)}
              className={cn(
                "text-[11px] font-semibold uppercase tracking-wide transition-colors",
                markdownEnabled
                  ? "text-[var(--color-primary-500)]"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              )}
              title={markdownEnabled ? "Markdown: ON" : "Markdown: OFF"}
            >
              MD
            </button>
          </div>
        </div>
        
        <form onSubmit={handleSubmitWithValidation} className="flex flex-col gap-1 p-2 pt-1">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            multiple
            className="hidden"
            accept="image/*,.pdf,.txt,.md,.json,.csv"
            data-testid="file-input"
          />

          <MentionInput
            value={inputValue}
            onChange={setInputValue}
            onMention={(user) => {
              // Add to mentioned users list
              setMentionedUsers(prev => {
                if (prev.some(u => u.id === user.id && u.type === user.type)) return prev;
                return [...prev, user];
              });
            }}
            onSubmit={() => handleSubmitWithValidation()}
            onPasteFiles={(files) => {
              // Ctrl+V paste: add clipboard files/images to attachments
              const fakeEvent = {
                target: { files, value: '' },
              } as unknown as React.ChangeEvent<HTMLInputElement>;
              handleFileSelect(fakeEvent);
            }}
            availableUsers={availableMentionUsers}
            availableAgents={availableSlashAgents}
            placeholder={chatPartner?.type === 'agent' ? `Спросить ${chatPartner.name}... (@ для вызова агента)` : "Введите сообщение... (@ для вызова агента)"}
            disabled={isLoading}
            className="flex-1"
            inputClassName="px-3 py-2 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none resize-none disabled:opacity-50"
            maxRows={3}
          />

          {/* Action buttons row: [+] [📎] ... [🎤] [➤] */}
          <div className="flex items-center justify-between px-1">
            {/* Left: Plus + Attach file */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  logger.debug('[Chat v2] Plus button clicked, filesSource:', filesSource, 'chatPartner:', chatPartner);
                  setShowFilePicker(prev => !prev);
                }}
                className={cn(
                  "p-1.5 rounded-lg transition-colors",
                  showFilePicker
                    ? "text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                )}
                title="Выбрать файл из библиотеки"
              >
                <Plus className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                title="Прикрепить файл"
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>

            {/* Right: Voice + Send */}
            <div className="flex items-center gap-1">
              {/* Voice input button */}
              {isRecording ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-red-400 min-w-[2rem] text-center tabular-nums">
                    {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    onClick={cancelRecording}
                    className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Отменить запись"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="p-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors animate-pulse"
                    title="Остановить запись"
                  >
                    <Square className="w-4 h-4 fill-current" />
                  </button>
                </div>
              ) : isTranscribing ? (
                <button
                  type="button"
                  disabled
                  className="p-1.5 rounded-lg text-[var(--text-tertiary)] cursor-wait"
                  title="Транскрибирую..."
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  className={cn(
                    "p-1.5 rounded-lg transition-colors",
                    voiceError
                      ? "text-red-400 hover:bg-red-500/10"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                  )}
                  title={voiceError || (voiceMode === 'webSpeech' ? "Голосовой ввод (Web Speech)" : "Голосовой ввод (Whisper)")}
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}

              {isAgentProcessing ? (
                <button
                  type="button"
                  onClick={onStopAgent}
                  className="p-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                  title="Остановить агента"
                >
                  <Square className="w-4 h-4 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isLoading || (!inputValue.trim() && attachments.length === 0)}
                  className={cn(
                    'p-1.5 rounded-lg transition-colors',
                    isLoading || (!inputValue.trim() && attachments.length === 0)
                      ? 'text-[var(--text-tertiary)] cursor-not-allowed'
                      : 'bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]'
                  )}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
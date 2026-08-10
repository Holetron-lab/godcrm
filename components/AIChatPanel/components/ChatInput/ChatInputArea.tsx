/**
 * ChatInputArea — Input area with file picker, bound rows, voice, and submit.
 * Extracted from AIChatPanel.tsx JSX return (lines 4603-5054).
 */
import React, { type ChangeEvent, type FormEvent, type RefObject } from 'react';
import {
  X, Send, Paperclip, Loader2, Plus, Settings, FolderOpen, Link2,
  Mic, Square, Zap, Brain, Terminal, Search, ImageIcon, FileText, File
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MentionInput, type MentionUser } from '../../../MentionInput';
import { RowBindingV2, type BoundRow } from '../../../RowBindingV2';
import { formatFileSize } from '@/features/files/api/filesApi';
import { TerminalPanel } from '@/features/terminal';
import type { TasksSourceConfig, FilesSourceConfig } from '../../../AIChatPanel.types';

export interface ChatInputAreaProps {
  panelMode: string;
  inputValue: string;
  setInputValue: (v: string | ((prev: string) => string)) => void;
  attachments: File[];
  setAttachments: (fn: (prev: File[]) => File[]) => void;
  mentionedUsers: MentionUser[];
  setMentionedUsers: (fn: (prev: MentionUser[]) => MentionUser[]) => void;
  messageBoundRows: BoundRow[];
  setMessageBoundRows: (fn: (prev: BoundRow[]) => BoundRow[]) => void;
  showFilePicker: boolean;
  setShowFilePicker: (fn: (prev: boolean) => boolean) => void;
  attachTab: 'files' | 'rows';
  setAttachTab: (tab: 'files' | 'rows') => void;
  filesSource: FilesSourceConfig | undefined;
  updateFilesSource: (config: FilesSourceConfig | undefined) => void;
  filesSearch: string;
  setFilesSearch: (v: string) => void;
  projectFiles: Array<{ id: string; name?: string; originalName?: string; original_name?: string; mimeType?: string; mime_type?: string; size: number }>;
  isLoadingFiles: boolean;
  tasksSource: TasksSourceConfig | undefined;
  effectiveSpaceId: number | string | undefined;
  availableMentionUsers: MentionUser[];
  availableSlashAgents: MentionUser[];
  chatPartner: { type: string; name: string } | null;
  isLoading: boolean;
  isAgentProcessing: boolean;
  stopAgent: () => void;
  handleSubmit: (e?: FormEvent) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  // Toggles
  hasSlashCommand: boolean;
  thinkingEnabled: boolean;
  setThinkingEnabled: (fn: (prev: boolean) => boolean) => void;
  agentMode: string;
  setAgentMode: (fn: (prev: string) => string) => void;
  markdownEnabled: boolean;
  setMarkdownEnabled: (fn: (prev: boolean) => boolean) => void;
  showTerminal: boolean;
  setShowTerminal: (fn: (prev: boolean) => boolean) => void;
  terminalFocusSessionId: string | null;
  // Voice
  isRecording: boolean;
  isTranscribing: boolean;
  voiceError: string | null;
  recordingDuration: number;
  startRecording: () => void;
  stopRecording: () => void;
  cancelRecording: () => void;
  // Inline selectors
  FilesSourceInlineSelector: React.ComponentType<{ defaultSpaceId?: number | string; onSelect: (config: FilesSourceConfig) => void; onCancel: () => void }>;
}

const getFileIcon = (type: string) => {
  if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
  if (type.includes('pdf') || type.includes('document')) return <FileText className="w-4 h-4" />;
  return <File className="w-4 h-4" />;
};

export function ChatInputArea(props: ChatInputAreaProps) {
  const {
    panelMode, inputValue, setInputValue, attachments, setAttachments,
    mentionedUsers, setMentionedUsers, messageBoundRows, setMessageBoundRows,
    showFilePicker, setShowFilePicker, attachTab, setAttachTab,
    filesSource, updateFilesSource, filesSearch, setFilesSearch,
    projectFiles, isLoadingFiles, tasksSource, effectiveSpaceId,
    availableMentionUsers, availableSlashAgents, chatPartner, isLoading,
    isAgentProcessing, stopAgent, handleSubmit, fileInputRef, handleFileSelect,
    hasSlashCommand, thinkingEnabled, setThinkingEnabled, agentMode, setAgentMode,
    markdownEnabled, setMarkdownEnabled, showTerminal, setShowTerminal, terminalFocusSessionId,
    isRecording, isTranscribing, voiceError, recordingDuration,
    startRecording, stopRecording, cancelRecording, FilesSourceInlineSelector,
  } = props;

  if (panelMode === 'fullscreen') return null;

  return (
    <>
      {/* Attachments Preview */}
      {attachments.length > 0 && (
        <div className="px-3 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          <div className="flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div key={index} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-xs">
                {getFileIcon(file.type)}
                <span className="max-w-[100px] truncate text-[var(--text-primary)]">{file.name}</span>
                <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== index))} className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-shrink-0 px-2 pt-1 pb-2 bg-[var(--bg-primary)] border-t border-[var(--border-primary)]"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom, 0px))' }}>
        {/* File/Row picker */}
        {showFilePicker && (
          <div className="mb-1 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="flex items-center border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
              <div className="flex items-center flex-1">
                <button onClick={() => setAttachTab('files')} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2', attachTab === 'files' ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] border-transparent')}>
                  <FolderOpen className="w-3 h-3" /> Files
                </button>
                <button onClick={() => setAttachTab('rows')} className={cn('flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-b-2', attachTab === 'rows' ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)] border-transparent')}>
                  <Link2 className="w-3 h-3" /> Rows
                </button>
              </div>
              <button onClick={() => { setShowFilePicker(prev => false as unknown as boolean); setFilesSearch(''); }} className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {attachTab === 'files' && (
              filesSource ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
                    <span className="text-[10px] text-[var(--text-tertiary)]">{filesSource.tableIcon || '📁'} {filesSource.tableName}</span>
                    <div className="flex-1 relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-tertiary)]" />
                      <input type="text" value={filesSearch} onChange={(e) => setFilesSearch(e.target.value)} placeholder="Search..."
                        className="w-full pl-7 pr-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none" />
                    </div>
                    <button onClick={() => updateFilesSource(undefined)} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><Settings className="w-3 h-3" /></button>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {isLoadingFiles ? <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" /></div>
                    : projectFiles.length === 0 ? <div className="py-4 text-center text-xs text-[var(--text-tertiary)]">No files</div>
                    : projectFiles.filter(f => !filesSearch.trim() || (f.name || f.originalName || f.original_name || '').toLowerCase().includes(filesSearch.toLowerCase())).map(file => (
                      <button key={file.id} onClick={() => {
                        if (filesSource.tableId) {
                          setMessageBoundRows(prev => [...prev, { table_id: filesSource.tableId, row_id: parseInt(file.id) || 0, table_name: filesSource.tableName, table_icon: filesSource.tableIcon || '📁', row_title: file.name || file.originalName || file.original_name || 'File' }]);
                        }
                        setShowFilePicker(() => false as unknown as boolean); setFilesSearch('');
                      }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-secondary)] last:border-0">
                        <span className="text-base flex-shrink-0">{getFileIcon(file.mimeType || file.mime_type || '')}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-[var(--text-primary)] truncate">{file.name || file.originalName || file.original_name}</div>
                          <div className="text-[10px] text-[var(--text-tertiary)]">{formatFileSize(file.size)} · {(file.mimeType || file.mime_type || 'unknown').split('/').pop()}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="p-3">
                  <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-tertiary)]"><FolderOpen className="w-3.5 h-3.5" /><span>Select file source</span></div>
                  <FilesSourceInlineSelector defaultSpaceId={effectiveSpaceId} onSelect={(config) => updateFilesSource(config)} onCancel={() => setShowFilePicker(() => false as unknown as boolean)} />
                </div>
              )
            )}
            {attachTab === 'rows' && (
              <div className="p-2">
                <RowBindingV2 defaultSpaceId={effectiveSpaceId} boundRows={messageBoundRows} maxBindings={5} compact hideHeader forceExpanded tasksSource={tasksSource} allowOtherTables
                  onClose={() => setShowFilePicker(() => false as unknown as boolean)} onBind={(b) => setMessageBoundRows(prev => [...prev, b])} onUnbind={(tid, rid) => setMessageBoundRows(prev => prev.filter(br => !(br.table_id === tid && br.row_id === rid)))} />
              </div>
            )}
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
                <button onClick={() => setMessageBoundRows(prev => prev.filter((_, i) => i !== idx))} className="text-blue-400/60 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
              </div>
            ))}
          </div>
        )}

        {/* Input box */}
        <div className="bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
          <div className="flex items-center justify-end px-2 pt-0.5 pb-0">
            <div className="flex items-center gap-2">
              {(chatPartner?.type === 'agent' || hasSlashCommand) && (
                <>
                  <button type="button" onClick={() => setThinkingEnabled(prev => !prev)}
                    className={cn("p-1 rounded transition-colors", thinkingEnabled ? "bg-pink-500/20 text-pink-400" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")}
                    title={thinkingEnabled ? "Цепочка рассуждений: ВКЛ" : "Цепочка рассуждений: ВЫКЛ"}>
                    <Brain className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => setAgentMode(prev => prev === 'ask' ? 'read' : prev === 'read' ? 'agent' : 'ask')}
                    className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase transition-colors",
                      agentMode === 'agent' && "bg-orange-500/20 text-orange-400", agentMode === 'ask' && "bg-blue-500/20 text-blue-400", agentMode === 'read' && "bg-green-500/20 text-green-400")}>
                    <Zap className="w-3 h-3" />{agentMode}
                  </button>
                </>
              )}
              <button type="button" onClick={() => setMarkdownEnabled(prev => !prev)}
                className={cn("text-[11px] font-semibold uppercase tracking-wide transition-colors", markdownEnabled ? "text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")}
                title={markdownEnabled ? "Markdown: ON" : "Markdown: OFF"}>MD</button>
              <button type="button" onClick={() => setShowTerminal(prev => !prev)}
                className={cn("p-1 rounded transition-colors", showTerminal ? "text-green-400 bg-green-500/10" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")}>
                <Terminal className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="flex items-start p-2 pt-0">
            <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple className="hidden" accept="image/*,.pdf,.txt,.md,.json,.csv" />
            <MentionInput value={inputValue} onChange={setInputValue}
              onMention={(user) => { setMentionedUsers(prev => prev.some(u => u.id === user.id && u.type === user.type) ? prev : [...prev, user]); }}
              onSubmit={() => handleSubmit()} availableUsers={availableMentionUsers} availableAgents={availableSlashAgents}
              placeholder={chatPartner?.type === 'agent' ? `Спросить ${chatPartner.name}...` : "Сообщение... (/ вызвать агента)"}
              disabled={isLoading} className="flex-1 min-w-0"
              inputClassName="px-2 py-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none resize-none disabled:opacity-50 text-sm leading-5" maxRows={4} />
            <div className="flex flex-col items-center pt-1">
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => setShowFilePicker(prev => !prev)}
                  className={cn("relative p-1 rounded-lg transition-colors", showFilePicker ? "text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10" : messageBoundRows.length > 0 ? "text-[var(--color-primary-500)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")}>
                  <Plus className="w-4 h-4" />
                  {messageBoundRows.length > 0 && <span className="absolute -top-1 -right-1 text-[8px] min-w-[12px] h-[12px] flex items-center justify-center rounded-full bg-[var(--color-primary-500)] text-white font-medium">{messageBoundRows.length}</span>}
                </button>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"><Paperclip className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-0.5">
                {isRecording ? (
                  <div className="flex items-center gap-0.5">
                    <span className="text-xs text-red-400 min-w-[2rem] text-center tabular-nums">{Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, '0')}</span>
                    <button type="button" onClick={cancelRecording} className="p-1 rounded-lg text-[var(--text-tertiary)] hover:text-red-400"><X className="w-4 h-4" /></button>
                    <button type="button" onClick={stopRecording} className="p-1 rounded-lg bg-red-500 text-white animate-pulse"><Square className="w-4 h-4 fill-current" /></button>
                  </div>
                ) : isTranscribing ? (
                  <button type="button" disabled className="p-1 rounded-lg text-[var(--text-tertiary)] cursor-wait"><Loader2 className="w-4 h-4 animate-spin" /></button>
                ) : (
                  <button type="button" onClick={startRecording}
                    className={cn("p-1 rounded-lg transition-colors", voiceError ? "text-red-400" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]")}><Mic className="w-4 h-4" /></button>
                )}
                {isAgentProcessing ? (
                  <button type="button" onClick={stopAgent} className="p-1 rounded-lg bg-red-500 text-white hover:bg-red-600"><Square className="w-4 h-4 fill-current" /></button>
                ) : (
                  <button type="submit" disabled={isLoading || (!inputValue.trim() && attachments.length === 0)}
                    className={cn('p-1 rounded-lg transition-colors', isLoading || (!inputValue.trim() && attachments.length === 0) ? 'text-[var(--text-tertiary)] cursor-not-allowed' : 'bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]')}>
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Terminal */}
      {showTerminal && (
        <div className="flex-shrink-0 border-t border-[var(--border-primary)]" style={{ height: 260 }}>
          <TerminalPanel className="h-full rounded-none border-0" compact={false} focusSessionId={terminalFocusSessionId} onCollapse={() => setShowTerminal(() => false as unknown as boolean)} />
        </div>
      )}
    </>
  );
}

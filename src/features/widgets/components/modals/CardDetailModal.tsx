import { useState, useEffect, useRef, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { X, Check, Clock, MessageCircle, MessageCirclePlus, Paperclip } from 'lucide-react';
import { Input } from '@/shared/components/ui';
import { Modal } from '@/shared/components/ui/Modal';
import { filesApi } from '@/features/files/api/filesApi';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { cn } from '@/shared/utils/cn';
import type { ColumnModel, ColumnOption } from '@/features/tables/types/table.types';
import { useRowChat } from '@/shared/hooks/useRowChat';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import type { CardDetailModalProps, AttachedFile } from './card-detail-types';
import { FilePreviewModal } from './FilePreviewModal';
import { CardFilesPanel } from './CardFilesPanel';

// Color options for select fields
const getOptionColor = (value: string, column: ColumnModel): string | undefined => {
  const option = column.config?.options?.find((opt: ColumnOption) => opt.value === value);
  return option?.color;
};

/** Universal helper: is this a "text" column type that benefits from large editing area? */
const isTextColumnType = (type: string) => type === 'text' || type === 'rich_text';

export function CardDetailModal({
  isOpen,
  onClose,
  card,
  columns,
  visibleFields,
  onSave,
  titleField = 'title',
  groupByField,
  tableId,
  relationData,
  onOpenChat,
  onAttachToChat,
  onAttachToMessage,
}: CardDetailModalProps) {
  // ADR-0060 P5c — read-only when rendered inside a public surface. Inline-edit
  // affordances and double-click handlers are short-circuited via `startEdit`.
  const isPublicReadOnly = useIsPublicReadOnly();
  const editTitle = isPublicReadOnly ? undefined : 'Двойной клик для редактирования';

  const [editingField, setEditingField] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const startEdit = (field: string, val: unknown) => {
    if (isPublicReadOnly) return;
    setEditingField(field);
    setFormData((prev) => ({ ...prev, [field]: val }));
  };
  const [saving, setSaving] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [previewFile, setPreviewFile] = useState<AttachedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Chat integration via backend API (useRowChat)
  const chatRowId = card ? Number(card.id) : 0;
  const {
    messages: chatMessages,
    isLoading: chatLoading,
    sendMessage,
    isSending,
  } = useRowChat({
    tableId: tableId ?? 0,
    rowId: chatRowId,
    autoCreate: true,
  });

  // Find file column for this table
  const fileColumn = (Array.isArray(columns) ? columns : []).find(col => col.type === 'file');

  // Save files to database - must be before any conditional returns
  const saveFilesToDb = useCallback(async (newFiles: AttachedFile[]) => {
    if (!onSave || !fileColumn || !card) return;

    const urls = newFiles.map(f => f.url || '').filter(Boolean);
    const relativeUrls = urls.map(url => {
      try {
        const u = new URL(url);
        return u.pathname;
      } catch {
        return url;
      }
    });

    await onSave(String(card.id), {
      ...card.data,
      [fileColumn.name]: relativeUrls.join(',')
    });
  }, [onSave, fileColumn, card]);

  // Handle file removal - must be before any conditional returns
  const handleFileRemove = useCallback(async (fileId: string) => {
    const newFiles = attachedFiles.filter(f => f.id !== fileId);
    setAttachedFiles(newFiles);
    await saveFilesToDb(newFiles);
  }, [attachedFiles, saveFilesToDb]);

  // Initialize form data when card changes
  useEffect(() => {
    if (card) {
      setFormData(card.data || {});
      setEditingField(null);

      // Load files from card data
      const fc = (Array.isArray(columns) ? columns : []).find(col => col.type === 'file');
      if (fc && card.data?.[fc.name]) {
        const fileUrls = String(card.data[fc.name])
          .split(',')
          .map(url => url.trim())
          .filter(Boolean);

        const loadedFiles: AttachedFile[] = fileUrls.map((url, idx) => {
          const fileName = decodeURIComponent(url.split('/').pop() || 'file');
          const ext = fileName.split('.').pop()?.toLowerCase() || '';
          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
          return {
            id: `file-${idx}`,
            name: fileName,
            size: 0,
            type: isImage ? `image/${ext}` : 'application/octet-stream',
            url: url.startsWith('http') ? url : `https://crm.hltrn.cc${url}`,
            uploadedAt: new Date()
          };
        });
        setAttachedFiles(loadedFiles);
      } else {
        setAttachedFiles([]);
      }
    }
  }, [card, columns]);

  // Early return AFTER all hooks — Modal handles visibility via open prop
  if (!card) return null;

  const cols = Array.isArray(columns) ? columns : [];

  // === Smart title detection ===
  // If titleField exists in columns and has data, use it.
  // Otherwise, auto-detect: first text column that has a value.
  const hasTitleFieldData = card.data?.[titleField] !== undefined && card.data?.[titleField] !== null && card.data?.[titleField] !== '';
  const firstTextCol = cols.find(c => isTextColumnType(c.type));
  const effectiveTitleField = hasTitleFieldData
    ? titleField
    : firstTextCol?.name || titleField;

  // === Universal layout: split columns by type ===
  const allDisplayColumns = visibleFields
    ? cols.filter(col => visibleFields.includes(col.name) && col.type !== 'file')
    : cols.filter(col => col.type !== 'file');

  // Text columns (excluding title) → RIGHT panel for spacious editing
  const textColumns = allDisplayColumns.filter(col =>
    isTextColumnType(col.type) && col.name !== effectiveTitleField
  );

  // Structured columns (select, date, checkbox, url, number, etc.) → LEFT panel
  const structuredColumns = allDisplayColumns.filter(col =>
    !isTextColumnType(col.type) && col.name !== effectiveTitleField
  );

  // Debug: log columns
  if (cols.length > 0 && allDisplayColumns.length === 0) {
    logger.debug('[CardDetailModal] No display columns! cols:', cols.map(c => ({ name: c.name, type: c.type })));
  }

  // Send chat message via backend API
  const handleSendMessage = () => {
    const trimmed = newMessage.trim();
    if (!trimmed || !tableId || !card) return;
    sendMessage(trimmed);
    setNewMessage('');
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(String(card.id), formData);
      setEditingField(null);
    } catch (error) {
      logger.error('Failed to save card:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleFieldChange = (fieldName: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }));
  };

  // Save single field inline
  const handleInlineSave = async (fieldName: string) => {
    if (!onSave) return;
    setSaving(true);
    try {
      const newData = { ...card.data, [fieldName]: formData[fieldName] };
      await onSave(String(card.id), newData);
      setEditingField(null);
    } catch (error) {
      logger.error('Failed to save field:', error);
    } finally {
      setSaving(false);
    }
  };

  // Cancel inline edit
  const handleInlineCancel = (fieldName: string) => {
    setFormData(prev => ({ ...prev, [fieldName]: card.data?.[fieldName] }));
    setEditingField(null);
  };

  const renderDisplayField = (column: ColumnModel, value: unknown) => {
    if (value === null || value === undefined || value === '') {
      return <span className="text-[var(--text-tertiary)] italic text-sm">—</span>;
    }

    switch (column.type) {
      case 'select': {
        // Check if this is a relation column and use relationData for label
        const relationConfig = column.config?.relation;
        const relationTableId = relationConfig?.table_id || relationConfig?.tableId;
        let displayValue = String(value);
        let color = getOptionColor(displayValue, column);

        if (relationTableId && relationData) {
          const tableMap = relationData.get(String(relationTableId)) || relationData.get(Number(relationTableId));
          if (tableMap) {
            const relationInfo = tableMap.get(String(value));
            if (relationInfo) {
              displayValue = relationInfo.label;
              if (relationInfo.color) color = relationInfo.color;
            }
          }
        }

        return (
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium"
            style={color ? { backgroundColor: `${color}20`, color } : { backgroundColor: 'var(--bg-tertiary)' }}
          >
            {displayValue}
          </span>
        );
      }
      case 'multi-select': {
        const values = Array.isArray(value) ? value : [value];
        return (
          <div className="flex flex-wrap gap-1">
            {values.map((v, i) => {
              const color = getOptionColor(String(v), column);
              return (
                <span
                  key={i}
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={color ? { backgroundColor: `${color}20`, color } : {}}
                >
                  {String(v)}
                </span>
              );
            })}
          </div>
        );
      }
      case 'checkbox':
        return <span className={value ? 'text-green-500 text-sm' : 'text-[var(--text-tertiary)] text-sm'}>{value ? '✓ Да' : '✗ Нет'}</span>;
      case 'date':
        return <span className="text-sm">{value ? new Date(String(value)).toLocaleDateString('ru-RU') : ''}</span>;
      case 'datetime':
      case 'time':
        return <span className="text-sm">{value ? new Date(String(value)).toLocaleString('ru-RU') : ''}</span>;
      case 'url':
        return (
          <a href={String(value)} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary-500)] hover:underline text-sm truncate block">
            {String(value)}
          </a>
        );
      case 'rich_text':
        return <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap line-clamp-3">{String(value)}</div>;
      default:
        return <span className="text-sm text-[var(--text-primary)]">{String(value)}</span>;
    }
  };

  const renderEditField = (column: ColumnModel, value: unknown) => {
    const currentValue = formData[column.name] ?? value;

    switch (column.type) {
      case 'select': {
        // Check if this is a relation column
        const relationConfig = column.config?.relation;
        const relationTableId = relationConfig?.table_id || relationConfig?.tableId;

        if (relationTableId && relationData) {
          const tableMap = relationData.get(String(relationTableId)) || relationData.get(Number(relationTableId));
          if (tableMap) {
            const relationOptions = Array.from(tableMap.entries()).map(([val, info]) => ({
              value: val,
              label: info.label,
              color: info.color
            }));
            return (
              <select
                value={String(currentValue || '')}
                onChange={(e) => handleFieldChange(column.name, e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
              >
                <option value="">—</option>
                {relationOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            );
          }
        }

        // Regular select with static options
        const options = column.config?.options || [];
        return (
          <select
            value={String(currentValue || '')}
            onChange={(e) => handleFieldChange(column.name, e.target.value)}
            className="w-full px-2 py-1.5 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
          >
            <option value="">—</option>
            {options.map((opt: ColumnOption) => (
              <option key={opt.value} value={opt.value}>{opt.label || opt.value}</option>
            ))}
          </select>
        );
      }
      case 'checkbox':
        return (
          <input
            type="checkbox"
            checked={Boolean(currentValue)}
            onChange={(e) => handleFieldChange(column.name, e.target.checked)}
            className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)]"
          />
        );
      case 'date':
      case 'datetime':
      case 'time': {
        const formatDate = (val: unknown): string => {
          if (!val) return '';
          const str = String(val);
          if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
          if (str.includes('T')) return str.split('T')[0];
          const d = new Date(str);
          return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
        };
        return (
          <Input
            type="date"
            value={formatDate(currentValue)}
            onChange={(e) => handleFieldChange(column.name, e.target.value)}
            className="text-sm"
          />
        );
      }
      case 'rich_text':
        return (
          <textarea
            value={String(currentValue || '')}
            onChange={(e) => handleFieldChange(column.name, e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] resize-none"
          />
        );
      default:
        return (
          <Input
            type="text"
            value={String(currentValue || '')}
            onChange={(e) => handleFieldChange(column.name, e.target.value)}
            className="text-sm"
          />
        );
    }
  };

  // Render always-active relation select that saves on change
  const renderRelationSelect = (column: ColumnModel, value: unknown) => {
    const relationConfig = column.config?.relation;
    const relationTableId = relationConfig?.table_id || relationConfig?.tableId;

    if (!relationTableId || !relationData) return null;

    const tableMap = relationData.get(String(relationTableId)) || relationData.get(Number(relationTableId));
    if (!tableMap) return null;

    const relationOptions = Array.from(tableMap.entries()).map(([val, info]) => ({
      value: val,
      label: info.label,
      color: info.color
    }));

    const handleRelationChange = async (newValue: string) => {
      if (!onSave) return;
      setSaving(true);
      try {
        const newData = { ...card.data, [column.name]: newValue };
        await onSave(String(card.id), newData);
      } catch (error) {
        logger.error('Failed to save relation field:', error);
      } finally {
        setSaving(false);
      }
    };

    return (
      <select
        value={String(value || '')}
        onChange={(e) => handleRelationChange(e.target.value)}
        disabled={saving || isPublicReadOnly}
        className="w-full px-2 py-1.5 text-sm rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <option value="">—</option>
        {relationOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  };

  const cardTitle = card?.data?.[effectiveTitleField] || 'Без названия';
  const cardStatus = groupByField ? card?.data?.[groupByField] : null;
  const statusColumn = groupByField ? cols.find(c => c.name === groupByField) : null;
  const statusColor = statusColumn && cardStatus ? getOptionColor(cardStatus, statusColumn) : undefined;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const result = await filesApi.upload(Array.from(files), {});
      const uploaded = Array.isArray(result) ? result : [result];

      const newFiles: AttachedFile[] = uploaded.map((f, idx) => ({
        id: `file-${Date.now()}-${idx}`,
        name: f.originalName || f.original_name || f.name,
        size: f.size,
        type: f.mimeType || f.mime_type || 'application/octet-stream',
        url: f.url.startsWith('http') ? f.url : `https://crm.hltrn.cc${f.url}`,
        uploadedAt: new Date()
      }));

      const allFiles = [...attachedFiles, ...newFiles];
      setAttachedFiles(allFiles);

      // Save to database
      await saveFilesToDb(allFiles);
    } catch (error) {
      logger.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };


  // --- Render helper: inline editable structured field (left panel) ---
  const renderStructuredField = (column: ColumnModel) => {
    const value = card.data?.[column.name];
    if (column.name === groupByField && !editingField) return null;

    const isFieldEditing = editingField === column.name;
    const relationConfig = column.config?.relation;
    const relationTableId = relationConfig?.table_id || relationConfig?.tableId;
    const isRelationSelect = column.type === 'select' && relationTableId && relationData;

    return (
      <div key={column.id} className="group">
        <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
          {column.displayName || column.name}
        </label>
        {isRelationSelect ? (
          <div>{renderRelationSelect(column, value)}</div>
        ) : isFieldEditing ? (
          <div className="space-y-1.5">
            {renderEditField(column, value)}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleInlineSave(column.name)}
                disabled={saving}
                className="px-2 py-0.5 text-xs bg-[var(--color-primary-500)] text-white rounded hover:bg-[var(--color-primary-600)] disabled:opacity-50"
              >
                {saving ? '...' : 'OK'}
              </button>
              <button
                onClick={() => handleInlineCancel(column.name)}
                className="px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`rounded px-1 -mx-1 py-0.5 transition${isPublicReadOnly ? '' : ' cursor-pointer hover:bg-[var(--bg-tertiary)] group-hover:ring-1 group-hover:ring-[var(--border-secondary)]'}`}
            onDoubleClick={() => startEdit(column.name, value)}
            title={editTitle}
          >
            {renderDisplayField(column, value)}
          </div>
        )}
      </div>
    );
  };

  // --- Render helper: inline editable text field (right panel) ---
  const renderTextField = (column: ColumnModel) => {
    const value = card.data?.[column.name];
    if (column.name === groupByField && !editingField) return null;

    const isFieldEditing = editingField === column.name;

    return (
      <div key={column.id} className="mb-4">
        <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-2 uppercase tracking-wide">
          {column.displayName || column.name}
        </label>
        {isFieldEditing ? (
          <div className="space-y-2">
            <textarea
              value={String(formData[column.name] ?? value ?? '')}
              onChange={(e) => handleFieldChange(column.name, e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] resize-y"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleInlineCancel(column.name);
              }}
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleInlineSave(column.name)}
                disabled={saving}
                className="px-2 py-0.5 text-xs bg-[var(--color-primary-500)] text-white rounded hover:bg-[var(--color-primary-600)] disabled:opacity-50"
              >
                {saving ? '...' : 'OK'}
              </button>
              <button
                onClick={() => handleInlineCancel(column.name)}
                className="px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`rounded-lg p-3 bg-[var(--bg-secondary)] transition min-h-[80px]${isPublicReadOnly ? '' : ' cursor-pointer hover:bg-[var(--bg-tertiary)]'}`}
            onDoubleClick={() => startEdit(column.name, value)}
            title={editTitle}
          >
            {value ? (
              <MarkdownPreview content={String(value)} className="text-sm" />
            ) : (
              <p className="text-sm text-[var(--text-tertiary)] italic">—</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const hasTextColumns = textColumns.length > 0;
  const hasChatSection = !!tableId && !!card;

  return (
    <>
      <Modal
        open={isOpen}
        onOpenChange={(v) => !v && onClose()}
        size="2xl"
        fixedHeight
        heightOffset={100}
        className="!p-0"
      >
        <div className="flex flex-col h-full min-h-0 -mt-4 -mr-2">
          {/* Custom Header */}
          <div className="flex-shrink-0 px-5 py-3 pr-12 border-b border-[var(--border-primary)]">
            <div className="flex items-center gap-3 min-w-0">
              {cardStatus && (
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold flex-shrink-0${isPublicReadOnly ? '' : ' cursor-pointer hover:opacity-80'}`}
                  style={statusColor ? { backgroundColor: `${statusColor}20`, color: statusColor } : {}}
                  onDoubleClick={() => !isPublicReadOnly && groupByField && setEditingField(groupByField)}
                  title={isPublicReadOnly ? undefined : 'Двойной клик для редактирования статуса'}
                >
                  {cardStatus}
                </span>
              )}
              <span className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-secondary)] px-2 py-0.5 rounded flex-shrink-0">
                #{card.id}
              </span>
              {!isPublicReadOnly && editingField === effectiveTitleField ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <input
                    type="text"
                    value={String(formData[effectiveTitleField] || '')}
                    onChange={(e) => handleFieldChange(effectiveTitleField, e.target.value)}
                    className="flex-1 text-lg font-semibold px-2 py-1 rounded border border-[var(--color-primary-500)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleInlineSave(effectiveTitleField);
                      if (e.key === 'Escape') handleInlineCancel(effectiveTitleField);
                    }}
                  />
                  <button onClick={() => handleInlineSave(effectiveTitleField)} className="p-1 text-green-500 hover:bg-green-500/10 rounded">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleInlineCancel(effectiveTitleField)} className="p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <h2
                  className={`text-lg font-semibold text-[var(--text-primary)] truncate rounded px-2 py-1 -mx-2 transition${isPublicReadOnly ? '' : ' cursor-pointer hover:bg-[var(--bg-secondary)]'}`}
                  onDoubleClick={() => startEdit(effectiveTitleField, cardTitle)}
                  title={editTitle}
                >
                  {cardTitle}
                </h2>
              )}
              {/* Chat action buttons */}
              <div className="flex items-center gap-0.5 flex-shrink-0 ml-auto">
                {onOpenChat && card && (
                  <button
                    onClick={() => onOpenChat(String(card.id))}
                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] transition"
                    title="Open chat"
                  >
                    <MessageCircle className="w-4 h-4" />
                  </button>
                )}
                {onAttachToChat && card && (
                  <button
                    onClick={() => onAttachToChat(String(card.id))}
                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] transition"
                    title="Attach to chat"
                  >
                    <MessageCirclePlus className="w-4 h-4" />
                  </button>
                )}
                {onAttachToMessage && card && (
                  <button
                    onClick={() => onAttachToMessage(String(card.id))}
                    className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] transition"
                    title="Attach to message"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Content - Two columns: structured (left) + text (right) */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Column - Structured fields + Files */}
            <div className={cn(
              'flex-shrink-0 flex flex-col overflow-hidden',
              hasTextColumns ? 'w-[360px] border-r border-[var(--border-primary)]' : 'flex-1'
            )}>
              {/* Structured Fields */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-3">
                  {structuredColumns.map(renderStructuredField)}
                </div>

                <CardFilesPanel
                  files={attachedFiles}
                  uploading={uploading}
                  isPublicReadOnly={isPublicReadOnly}
                  onUpload={handleFileUpload}
                  onRemove={handleFileRemove}
                  onPreview={setPreviewFile}
                />
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 px-4 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-3 text-[10px] text-[var(--text-tertiary)]">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {card.created_at ? new Date(card.created_at).toLocaleString('ru-RU') : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column - Text columns (universal) */}
            {hasTextColumns && (
              <div className="flex-1 flex flex-col bg-[var(--bg-primary)] overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4">
                  {textColumns.map(renderTextField)}
                </div>
              </div>
            )}
          </div>

          {/* Bottom close button */}
          <div className="flex-shrink-0 px-5 py-3 border-t border-[var(--border-primary)] flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Закрыть
            </button>
          </div>
        </div>
      </Modal>

      {/* File Preview Modal — rendered outside Modal for z-index stacking */}
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </>
  );
}

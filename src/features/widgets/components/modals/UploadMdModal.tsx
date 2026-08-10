/**
 * Upload Markdown Modal
 * 
 * Modal for uploading markdown files and parsing them into atomic sections
 * for the Documents module.
 * 
 * @see ADR-006-DOCUMENTS-MODULE.md
 */

import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  FileText,
  Check,
  X,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Link2,
  BookOpen,
  Code,
  Hash,
  Box,
  Workflow,
  Database,
  FileCode,
  Trash2,
  Edit2,
  Save
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Modal, Button, Input } from '@/shared/components/ui';
import { apiClient } from '@/shared/utils/apiClient';
import { useQueryClient } from '@tanstack/react-query';
import {
  parseMarkdownToAtoms,
  parseMarkdownPreview,
  validateAtoms,
  type ParsedAtom,
  type ParseOptions
} from '../../utils/parseMarkdownToAtoms';

// === INTERFACES ===

interface UploadMdModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (atomIds: number[], documentId?: number) => void;
  sectionsTableId?: number;
  documentsTableId?: number;
}

interface AtomPreview {
  // From ParsedAtom - includes heading and subheading
  type: 'reference' | 'endpoint' | 'concept' | 'howto' | 'code' | 'column-type' | 'component' | 'hook' | 'store' | 'heading' | 'subheading';
  key: string;
  title: string;
  content: string;
  order_index: number;
  parent?: string;
  http_method?: string;
  http_path?: string;
  code?: string;
  tags?: string[];
  source_file?: string;
  // Extra fields
  selected: boolean;
  editing?: boolean;
}

// === CONSTANTS ===

const SECTIONS_TABLE_ID = 1657;
const DOCUMENTS_TABLE_ID = 1658;

const TYPE_ICONS: Record<string, typeof FileText> = {
  endpoint: Link2,
  'column-type': Database,
  concept: BookOpen,
  howto: FileCode,
  code: Code,
  reference: Hash,
  component: Box,
  hook: Workflow,
  store: Database,
  heading: Hash,
  subheading: Hash,
};

const TYPE_OPTIONS: Array<{ value: ParsedAtom['type']; label: string }> = [
  { value: 'heading', label: 'Heading' },
  { value: 'subheading', label: 'Subheading' },
  { value: 'reference', label: 'Reference' },
  { value: 'endpoint', label: 'Endpoint' },
  { value: 'concept', label: 'Concept' },
  { value: 'howto', label: 'How-to' },
  { value: 'code', label: 'Code' },
  { value: 'column-type', label: 'Column Type' },
  { value: 'component', label: 'Component' },
  { value: 'hook', label: 'Hook' },
  { value: 'store', label: 'Store' },
];

// === COMPONENT ===

export function UploadMdModal({
  isOpen,
  onClose,
  onSuccess,
  sectionsTableId = SECTIONS_TABLE_ID,
  documentsTableId = DOCUMENTS_TABLE_ID
}: UploadMdModalProps) {
  // State
  const [step, setStep] = useState<'upload' | 'preview' | 'saving' | 'done'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [rawContent, setRawContent] = useState('');
  const [atoms, setAtoms] = useState<AtomPreview[]>([]);
  const [documentTitle, setDocumentTitle] = useState('');
  const [documentDescription, setDocumentDescription] = useState('');
  const [createDocument, setCreateDocument] = useState(true);
  const [parseOptions, setParseOptions] = useState<ParseOptions>({
    splitLevel: 2,
    detectEndpoints: true
  });
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expandedAtoms, setExpandedAtoms] = useState<Set<number>>(new Set());
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Reset state
  const reset = useCallback(() => {
    setStep('upload');
    setFile(null);
    setRawContent('');
    setAtoms([]);
    setDocumentTitle('');
    setDocumentDescription('');
    setValidation({ errors: [], warnings: [] });
    setError(null);
    setSaving(false);
    setSavedCount(0);
    setExpandedAtoms(new Set());
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.md') && selectedFile.type !== 'text/markdown') {
      setError('Please select a Markdown (.md) file');
      return;
    }

    setFile(selectedFile);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRawContent(content);
      
      // Parse and preview
      const parsedAtoms = parseMarkdownToAtoms(content, {
        ...parseOptions,
        sourceFile: selectedFile.name
      });
      
      const preview = parseMarkdownPreview(content, selectedFile.name);
      const validationResult = validateAtoms(parsedAtoms);
      
      setAtoms(parsedAtoms.map((a: ParsedAtom): AtomPreview => ({ ...a, selected: true })));
      setDocumentTitle(preview.title);
      setValidation({ errors: validationResult.errors, warnings: validationResult.warnings });
      setStep('preview');
    };
    
    reader.onerror = () => {
      setError('Failed to read file');
    };
    
    reader.readAsText(selectedFile);
  }, [parseOptions]);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      // Simulate file input change
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(droppedFile);
      if (fileInputRef.current) {
        fileInputRef.current.files = dataTransfer.files;
        handleFileSelect({ target: fileInputRef.current } as React.ChangeEvent<HTMLInputElement>);
      }
    }
  }, [handleFileSelect]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  // Toggle atom selection
  const toggleAtom = (index: number) => {
    setAtoms(prev => prev.map((a, i) => 
      i === index ? { ...a, selected: !a.selected } : a
    ));
  };

  // Toggle all atoms
  const toggleAllAtoms = (selected: boolean) => {
    setAtoms(prev => prev.map(a => ({ ...a, selected })));
  };

  // Update atom field
  const updateAtom = (index: number, field: keyof ParsedAtom, value: unknown) => {
    setAtoms(prev => prev.map((a, i) => 
      i === index ? { ...a, [field]: value } : a
    ));
  };

  // Delete atom
  const deleteAtom = (index: number) => {
    setAtoms(prev => prev.filter((_, i) => i !== index));
  };

  // Toggle atom expansion
  const toggleExpand = (index: number) => {
    setExpandedAtoms(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Re-parse with new options
  const reparse = () => {
    if (!rawContent) return;
    
    const parsedAtoms = parseMarkdownToAtoms(rawContent, {
      ...parseOptions,
      sourceFile: file?.name
    });
    
    const validationResult = validateAtoms(parsedAtoms);
    
    setAtoms(parsedAtoms.map((a: ParsedAtom): AtomPreview => ({ ...a, selected: true })));
    setValidation({ errors: validationResult.errors, warnings: validationResult.warnings });
  };

  // Save atoms to database
  const saveAtoms = async () => {
    setSaving(true);
    setStep('saving');
    setError(null);
    setSavedCount(0);

    const selectedAtoms = atoms.filter(a => a.selected);
    if (selectedAtoms.length === 0) {
      setError('No atoms selected');
      setSaving(false);
      setStep('preview');
      return;
    }

    try {
      const savedIds: number[] = [];

      // Save each atom
      for (let i = 0; i < selectedAtoms.length; i++) {
        const atom = selectedAtoms[i];
        
        // Prepare data for API
        const atomData: Record<string, unknown> = {
          type: atom.type,
          key: atom.key,
          title: atom.title,
          content: atom.content,
          order_index: atom.order_index
        };

        if (atom.http_method) atomData.http_method = atom.http_method;
        if (atom.http_path) atomData.http_path = atom.http_path;
        if (atom.code) atomData.code = atom.code;
        if (atom.tags?.length) atomData.tags = atom.tags;
        if (atom.source_file) atomData.source_file = atom.source_file;
        if (atom.parent) atomData.parent = atom.parent;

        const response = await apiClient.post<{ success: boolean; data: { id: number } }>(
          `/tables/${sectionsTableId}/rows`,
          { data: atomData }
        );

        if (response.success && response.data?.id) {
          savedIds.push(response.data.id);
        }

        setSavedCount(i + 1);
      }

      // Create document if requested
      let docId: number | undefined;
      if (createDocument && savedIds.length > 0) {
        const docData = {
          name: documentTitle,
          description: documentDescription || `Imported from ${file?.name || 'markdown file'}`,
          sections: savedIds,
          category: 'Guide',
          status: 'draft',
          icon: '📄'
        };

        const docResponse = await apiClient.post<{ success: boolean; data: { id: number } }>(
          `/tables/${documentsTableId}/rows`,
          { data: docData }
        );

        if (docResponse.success && docResponse.data?.id) {
          docId = docResponse.data.id;
        }
      }

      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: ['document-sections-widget', sectionsTableId] });
      queryClient.invalidateQueries({ queryKey: ['documents-widget', documentsTableId] });

      setStep('done');
      onSuccess?.(savedIds, docId);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save atoms');
      setStep('preview');
    } finally {
      setSaving(false);
    }
  };

  // Handle modal close
  const handleClose = () => {
    reset();
    onClose();
  };

  const selectedCount = atoms.filter(a => a.selected).length;

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={
        step === 'upload' ? 'Загрузить Markdown' :
        step === 'preview' ? 'Предпросмотр атомов' :
        step === 'saving' ? 'Сохранение...' :
        'Готово!'
      }
      size="xl"
    >
      <div className="min-h-[400px]">
        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 1: Upload */}
        {step === 'upload' && (
          <div className="space-y-4">
            <p className="text-sm text-[var(--text-secondary)]">
              Загрузите Markdown файл для автоматического разбиения на атомарные секции.
              Каждый заголовок H2 станет отдельным атомом.
            </p>

            {/* Drag & Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="border-2 border-dashed border-[var(--border-primary)] rounded-lg p-8 text-center hover:border-[var(--color-primary-500)] transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,text/markdown"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Upload className="w-12 h-12 mx-auto mb-4 text-[var(--text-tertiary)]" />
              <p className="text-lg font-medium text-[var(--text-primary)] mb-2">
                Перетащите .md файл сюда
              </p>
              <p className="text-sm text-[var(--text-tertiary)]">
                или нажмите для выбора файла
              </p>
            </div>

            {/* Parse options */}
            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] space-y-3">
              <h4 className="text-sm font-medium text-[var(--text-primary)]">Настройки парсинга</h4>
              
              <label className="flex items-center gap-3">
                <select
                  value={parseOptions.splitLevel}
                  onChange={(e) => setParseOptions((p: ParseOptions) => ({ ...p, splitLevel: Number(e.target.value) as 2 | 3 }))}
                  className="px-3 py-1.5 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                >
                  <option value={2}>Разбивать по H2</option>
                  <option value={3}>Разбивать по H2 и H3</option>
                </select>
                <span className="text-sm text-[var(--text-secondary)]">Уровень разбиения</span>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={parseOptions.detectEndpoints}
                  onChange={(e) => setParseOptions((p: ParseOptions) => ({ ...p, detectEndpoints: e.target.checked }))}
                  className="w-4 h-4 rounded border-[var(--border-primary)]"
                />
                <span className="text-sm text-[var(--text-secondary)]">
                  Авто-определение API endpoints
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && (
          <div className="space-y-4">
            {/* File info */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)]">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-[var(--color-primary-500)]" />
                <div>
                  <p className="font-medium text-[var(--text-primary)]">{file?.name}</p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {atoms.length} атомов найдено · {selectedCount} выбрано
                  </p>
                </div>
              </div>
              <button
                onClick={() => setStep('upload')}
                className="text-sm text-[var(--color-primary-500)] hover:underline"
              >
                Другой файл
              </button>
            </div>

            {/* Document settings */}
            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={createDocument}
                  onChange={(e) => setCreateDocument(e.target.checked)}
                  className="w-4 h-4 rounded border-[var(--border-primary)]"
                />
                <span className="text-sm text-[var(--text-primary)]">
                  Создать документ из атомов
                </span>
              </label>

              {createDocument && (
                <div className="space-y-2 pl-7">
                  <Input
                    value={documentTitle}
                    onChange={(e) => setDocumentTitle(e.target.value)}
                    placeholder="Название документа"
                  />
                  <Input
                    value={documentDescription}
                    onChange={(e) => setDocumentDescription(e.target.value)}
                    placeholder="Описание (опционально)"
                  />
                </div>
              )}
            </div>

            {/* Validation warnings */}
            {validation.warnings.length > 0 && (
              <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                <p className="text-sm font-medium text-yellow-600 mb-1">Предупреждения:</p>
                <ul className="text-xs text-yellow-600 space-y-1">
                  {validation.warnings.slice(0, 5).map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                  {validation.warnings.length > 5 && (
                    <li>...и ещё {validation.warnings.length - 5}</li>
                  )}
                </ul>
              </div>
            )}

            {/* Atoms list */}
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-[var(--text-primary)]">Атомы</h4>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleAllAtoms(true)}
                  className="text-xs text-[var(--color-primary-500)] hover:underline"
                >
                  Выбрать все
                </button>
                <button
                  onClick={() => toggleAllAtoms(false)}
                  className="text-xs text-[var(--text-tertiary)] hover:underline"
                >
                  Снять все
                </button>
                <button
                  onClick={reparse}
                  className="text-xs text-[var(--text-tertiary)] hover:underline"
                >
                  Перепарсить
                </button>
              </div>
            </div>

            <div className="max-h-[300px] overflow-y-auto space-y-1 pr-2">
              {atoms.map((atom, index) => {
                const Icon = TYPE_ICONS[atom.type] || FileText;
                const isExpanded = expandedAtoms.has(index);

                return (
                  <div
                    key={index}
                    className={cn(
                      'border rounded-lg overflow-hidden transition-colors',
                      atom.selected
                        ? 'border-[var(--color-primary-500)]/30 bg-[var(--color-primary-500)]/5'
                        : 'border-[var(--border-secondary)] bg-[var(--bg-primary)]'
                    )}
                  >
                    {/* Atom header */}
                    <div className="flex items-center gap-2 p-2">
                      <input
                        type="checkbox"
                        checked={atom.selected}
                        onChange={() => toggleAtom(index)}
                        className="w-4 h-4 rounded shrink-0"
                      />
                      <button
                        onClick={() => toggleExpand(index)}
                        className="shrink-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                        )}
                      </button>
                      <Icon className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                      <span className="flex-1 text-sm text-[var(--text-primary)] truncate">
                        {atom.title}
                      </span>
                      <span className={cn(
                        'px-2 py-0.5 rounded text-[10px] font-medium shrink-0',
                        atom.type === 'endpoint' ? 'bg-primary-500/20 text-primary-500' : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
                      )}>
                        {atom.type}
                      </span>
                      <button
                        onClick={() => deleteAtom(index)}
                        className="p-1 hover:bg-red-500/10 rounded text-red-500 shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Atom details (expanded) */}
                    {isExpanded && (
                      <div className="px-4 pb-3 pt-1 border-t border-[var(--border-secondary)] space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-[var(--text-tertiary)]">Key</label>
                            <Input
                              value={atom.key}
                              onChange={(e) => updateAtom(index, 'key', e.target.value)}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-[var(--text-tertiary)]">Type</label>
                            <select
                              value={atom.type}
                              onChange={(e) => updateAtom(index, 'type', e.target.value)}
                              className="w-full h-7 px-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)]"
                            >
                              {TYPE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        
                        {atom.type === 'endpoint' && (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="text-xs text-[var(--text-tertiary)]">Method</label>
                              <select
                                value={atom.http_method || ''}
                                onChange={(e) => updateAtom(index, 'http_method', e.target.value)}
                                className="w-full h-7 px-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-xs text-[var(--text-primary)]"
                              >
                                <option value="">-</option>
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="PATCH">PATCH</option>
                                <option value="DELETE">DELETE</option>
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="text-xs text-[var(--text-tertiary)]">Path</label>
                              <Input
                                value={atom.http_path || ''}
                                onChange={(e) => updateAtom(index, 'http_path', e.target.value)}
                                className="h-7 text-xs"
                                placeholder="/api/..."
                              />
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="text-xs text-[var(--text-tertiary)]">
                            Content ({atom.content.length} chars)
                          </label>
                          <pre className="mt-1 p-2 rounded bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] max-h-24 overflow-auto whitespace-pre-wrap">
                            {atom.content.slice(0, 500)}
                            {atom.content.length > 500 && '...'}
                          </pre>
                        </div>

                        {atom.code && (
                          <div>
                            <label className="text-xs text-[var(--text-tertiary)]">Code block</label>
                            <pre className="mt-1 p-2 rounded bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] max-h-16 overflow-auto">
                              {atom.code.slice(0, 200)}
                              {atom.code.length > 200 && '...'}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border-primary)]">
              <Button variant="secondary" onClick={handleClose}>
                Отмена
              </Button>
              <Button
                onClick={saveAtoms}
                disabled={selectedCount === 0 || (createDocument && !documentTitle.trim())}
              >
                <Save className="w-4 h-4 mr-2" />
                Сохранить {selectedCount} атомов
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Saving */}
        {step === 'saving' && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-[var(--color-primary-500)] mb-4" />
            <p className="text-lg font-medium text-[var(--text-primary)] mb-2">
              Сохранение атомов...
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              {savedCount} / {selectedCount}
            </p>
            <div className="w-64 h-2 bg-[var(--bg-tertiary)] rounded-full mt-4 overflow-hidden">
              <div
                className="h-full bg-[var(--color-primary-500)] transition-all"
                style={{ width: `${(savedCount / selectedCount) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {step === 'done' && (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
              <Check className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-lg font-medium text-[var(--text-primary)] mb-2">
              Успешно сохранено!
            </p>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              {savedCount} атомов добавлено в базу
              {createDocument && documentTitle && ` · Документ "${documentTitle}" создан`}
            </p>
            <Button onClick={handleClose}>
              Закрыть
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

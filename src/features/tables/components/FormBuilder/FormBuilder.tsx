import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import * as Dialog from '@radix-ui/react-dialog';
import {
  X,
  Save,
  Eye,
  EyeOff,
  ChevronRight,
  Pencil,
} from 'lucide-react';
import { Button } from '@/shared/components/ui';
import type {
  FormConfig,
  FormField,
  FormElement,
  FormDivider,
  FormTextBlock,
  FormPageBreak,
  ModalSize,
} from '../../types/form-config.types';
import { FieldPreviewEditor } from './FieldPreviewEditor';
import { RelationFieldWrapper } from './FieldPreviewReadonly';
import { FieldSettingsPanel } from './FieldSettingsPanel';
import { DividerPreview } from './DividerPreview';
import { PageBreakSettingsPanel } from './PageBreakSettingsPanel';
import { TextBlockPreview, TextBlockSettingsPanel } from './TextBlockComponents';
import { FormBuilderToolbar } from './FormBuilderToolbar';
import {
  MODAL_SIZE_OPTIONS,
  isField,
  isDivider,
  isTextBlock,
  isPageBreak,
  type ViewMode,
  type FormItem,
  type FormTypeValue,
  type FormBuilderProps,
} from './types';
import { generateDefaultFormConfig, generateId, getColSpan } from './utils';

// Re-export for backwards compatibility with existing imports
export type { FormTypeValue } from './types';

export function FormBuilder({
  isOpen,
  onClose,
  onSave,
  columns,
  initialConfig,
  initialFormType,
  initialFormTypes,
  tableName,
  tableId,
  sampleData,
}: FormBuilderProps) {
  // State
  const [mode, setMode] = useState<'editor' | 'preview'>('editor');
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialConfig?.settings?.viewMode || 'standard'
  );
  const [modalSize, setModalSize] = useState<ModalSize>(
    initialConfig?.settings?.modalSize || 'lg'
  );
  const [, setPages] = useState(initialConfig?.pages || 1);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [, setEditingTextId] = useState<string | null>(null);

  // Form type state (multi-select checkboxes)
  const [formTypes, setFormTypes] = useState<FormTypeValue[]>(
    initialFormTypes || (initialFormType ? [initialFormType] : ['edit_row'])
  );

  // Handle form type toggle (multi-select)
  const handleFormTypeToggle = (type: FormTypeValue) => {
    setFormTypes(prev => {
      if (prev.includes(type)) {
        // Remove - but keep at least one selected
        const newTypes = prev.filter(t => t !== type);
        return newTypes.length > 0 ? newTypes : prev;
      }
      return [...prev, type];
    });
  };

  // Generate form URL and embed code (only when custom is selected)
  const formUrl = useMemo(() => {
    if (!formTypes.includes('custom') || !tableId) return null;
    return `${window.location.origin}/forms/${tableId}`;
  }, [formTypes, tableId]);

  const embedCode = useMemo(() => {
    if (!formUrl) return null;
    return `<iframe src="${formUrl}/embed" width="100%" height="600" frameborder="0"></iframe>`;
  }, [formUrl]);

  // Initialize form items
  const [items, setItems] = useState<FormItem[]>(() => {
    if (initialConfig?.fields && initialConfig.fields.length > 0) {
      const fields: FormItem[] = initialConfig.fields.map(f => ({
        ...f,
        type: 'field' as const,
      }));
      const elements: FormItem[] = (initialConfig.elements || []) as FormItem[];
      return [...fields, ...elements].sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return generateDefaultFormConfig(columns).fields.map(f => ({
      ...f,
      type: 'field' as const,
    }));
  });

  // Sync items when initialConfig changes (e.g., loaded from server)
  useEffect(() => {
    if (initialConfig?.fields && initialConfig.fields.length > 0) {
      logger.debug('🔄 FormBuilder: Syncing items from initialConfig', initialConfig);
      const fields: FormItem[] = initialConfig.fields.map(f => ({
        ...f,
        type: 'field' as const,
      }));
      const elements: FormItem[] = (initialConfig.elements || []) as FormItem[];
      setItems([...fields, ...elements].sort((a, b) => (a.order || 0) - (b.order || 0)));
      setViewMode(initialConfig.settings?.viewMode || 'standard');
      setModalSize(initialConfig.settings?.modalSize || 'lg');
      setPages(initialConfig.pages || 1);
    }
  }, [initialConfig]);

  // Get column by id
  const getColumn = useCallback(
    (columnId: string) => columns.find(c => c.id === columnId),
    [columns]
  );

  // Separate visible and hidden fields
  const { visibleItems, hiddenFields } = useMemo(() => {
    const visible: FormItem[] = [];
    const hidden: FormField[] = [];

    items.forEach(item => {
      if (isField(item) && item.hidden) {
        hidden.push(item);
      } else {
        visible.push(item);
      }
    });

    return { visibleItems: visible, hiddenFields: hidden };
  }, [items]);

  // Count stats
  const stats = useMemo(() => {
    const fields = items.filter(isField);
    const visible = fields.filter(f => !f.hidden).length;
    const hidden = fields.filter(f => f.hidden).length;
    const elements = items.filter(i => isDivider(i) || isTextBlock(i)).length;
    const pageBreaks = items.filter(isPageBreak).length;

    return {
      visible,
      hidden,
      elements,
      pages: pageBreaks + 1,
    };
  }, [items]);

  // Get items for current page (for preview mode)
  const currentPageItems = useMemo(() => {
    if (mode !== 'preview') return visibleItems;

    const pageItems: FormItem[] = [];
    let page = 1;

    for (const item of visibleItems) {
      if (isPageBreak(item)) {
        page++;
        continue;
      }
      if (page === currentPage) {
        pageItems.push(item);
      }
    }

    return pageItems;
  }, [mode, visibleItems, currentPage]);

  // Move item up
  const moveItemUp = (index: number) => {
    if (index <= 0) return;
    setItems(currentItems => {
      const newItems = [...currentItems];
      [newItems[index - 1], newItems[index]] = [newItems[index], newItems[index - 1]];
      return newItems.map((item, idx) => ({ ...item, order: idx }));
    });
  };

  // Move item down
  const moveItemDown = (index: number) => {
    if (index >= items.length - 1) return;
    setItems(currentItems => {
      const newItems = [...currentItems];
      [newItems[index], newItems[index + 1]] = [newItems[index + 1], newItems[index]];
      return newItems.map((item, idx) => ({ ...item, order: idx }));
    });
  };

  // Add new elements
  const addDivider = () => {
    const newDivider: FormDivider = {
      id: generateId('divider'),
      type: 'divider',
      order: items.length,
      page: currentPage,
    };
    setItems(prev => [...prev, newDivider]);
    setSelectedItemId(newDivider.id);
  };

  const addTextBlock = () => {
    const newTextBlock: FormTextBlock = {
      id: generateId('text'),
      type: 'text',
      content: '',
      order: items.length,
      page: currentPage,
      width: 'full',
    };
    setItems(prev => [...prev, newTextBlock]);
    setSelectedItemId(newTextBlock.id);
    setEditingTextId(newTextBlock.id);
  };

  const addPageBreak = () => {
    const newPageBreak: FormPageBreak = {
      id: generateId('page'),
      type: 'page-break',
      order: items.length,
    };
    setItems(prev => [...prev, newPageBreak]);
    setPages(p => p + 1);
    setSelectedItemId(newPageBreak.id);
  };

  // Update item
  const updateItem = (id: string, updates: Partial<FormItem>) => {
    setItems(prev => {
      const updated = prev.map(item =>
        item.id === id ? ({ ...item, ...updates } as FormItem) : item
      );
      // If order was changed, re-sort items
      if ('order' in updates) {
        return [...updated].sort((a, b) => (a.order || 0) - (b.order || 0));
      }
      return updated;
    });
  };

  // Delete item
  const deleteItem = (id: string) => {
    const item = items.find(i => i.id === id);
    if (item && isPageBreak(item)) {
      setPages(p => Math.max(1, p - 1));
    }
    setItems(prev => prev.filter(i => i.id !== id));
    setSelectedItemId(null);
  };

  // Toggle field visibility
  const toggleFieldVisibility = (id: string) => {
    setItems(prev =>
      prev.map(item =>
        item.id === id && isField(item) ? { ...item, hidden: !item.hidden } : item
      )
    );
  };

  // Reset to default
  const resetToDefault = () => {
    const defaultConfig = generateDefaultFormConfig(columns);
    setItems(
      defaultConfig.fields.map(f => ({ ...f, type: 'field' as const }))
    );
    setPages(1);
    setCurrentPage(1);
    setSelectedItemId(null);
  };

  // Save config
  const handleSave = () => {
    const fields = items.filter(isField);
    const elements = items.filter(i => !isField(i)) as FormElement[];

    const config: FormConfig = {
      version: 1,
      layout: 'grid',
      columns: 2,
      pages: stats.pages,
      fields,
      elements,
      settings: {
        showLabels: true,
        viewMode,
        modalSize,
        labelPosition: 'top',
        spacing: 'normal',
      },
    };

    onSave(config, formTypes);
    onClose();
  };

  // Render editor items
  const renderEditorItems = () => {
    const result: React.ReactNode[] = [];

    visibleItems.forEach((item, index) => {
      const canMoveUp = index > 0;
      const canMoveDown = index < visibleItems.length - 1;
      const isSelected = selectedItemId === item.id;
      const globalIndex = items.findIndex(i => i.id === item.id);

      if (isField(item)) {
        const column = getColumn(item.columnId);
        const colSpan = getColSpan(item.width);

        result.push(
          <div key={item.id} className={colSpan}>
            <FieldPreviewEditor
              field={{ ...item, width: 'full' }}
              column={column}
              viewMode={viewMode}
              isSelected={isSelected}
              onClick={() => setSelectedItemId(isSelected ? null : item.id)}
              sampleValue={sampleData?.[item.columnId] ?? sampleData?.[column?.name || '']}
            />
          </div>
        );

        // Settings panel on full width (after the field)
        if (isSelected) {
          result.push(
            <div key={`${item.id}_settings`} className="col-span-12 px-1.5 pb-1.5">
              <FieldSettingsPanel
                field={item}
                column={column}
                totalFields={items.length}
                currentIndex={globalIndex}
                onUpdate={(updates) => updateItem(item.id, updates)}
                onMoveUp={() => moveItemUp(globalIndex)}
                onMoveDown={() => moveItemDown(globalIndex)}
                onToggleVisibility={() => toggleFieldVisibility(item.id)}
                onClose={() => setSelectedItemId(null)}
              />
            </div>
          );
        }
      } else if (isDivider(item)) {
        result.push(
          <div key={item.id} className="col-span-12">
            <DividerPreview
              isSelected={isSelected}
              onClick={() => setSelectedItemId(isSelected ? null : item.id)}
              onMoveUp={() => moveItemUp(globalIndex)}
              onMoveDown={() => moveItemDown(globalIndex)}
              onDelete={() => deleteItem(item.id)}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              order={item.order}
              onOrderChange={(order) => updateItem(item.id, { order })}
            />
          </div>
        );
      } else if (isPageBreak(item)) {
        result.push(
          <div key={item.id} className="col-span-12">
            <DividerPreview
              isSelected={isSelected}
              onClick={() => setSelectedItemId(isSelected ? null : item.id)}
              isPageBreak
              onMoveUp={() => moveItemUp(globalIndex)}
              onMoveDown={() => moveItemDown(globalIndex)}
              onDelete={() => deleteItem(item.id)}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              order={item.order}
              onOrderChange={(order) => updateItem(item.id, { order })}
            />
          </div>
        );

        // Page break settings panel
        if (isSelected) {
          result.push(
            <div key={`${item.id}_settings`} className="col-span-12 px-1.5 pb-1.5">
              <PageBreakSettingsPanel
                pageBreak={item}
                onUpdate={(updates) => updateItem(item.id, updates)}
                onClose={() => setSelectedItemId(null)}
              />
            </div>
          );
        }
      } else if (isTextBlock(item)) {
        const textColSpan = getColSpan(item.width);

        result.push(
          <div key={item.id} className={textColSpan}>
            <TextBlockPreview
              block={item}
              isSelected={isSelected}
              onClick={() => setSelectedItemId(isSelected ? null : item.id)}
            />
          </div>
        );

        // Text block settings panel
        if (isSelected) {
          result.push(
            <div key={`${item.id}_settings`} className="col-span-12 px-1.5 pb-1.5">
              <TextBlockSettingsPanel
                block={item}
                onUpdate={(updates) => updateItem(item.id, updates)}
                onDelete={() => deleteItem(item.id)}
                onMoveUp={() => moveItemUp(globalIndex)}
                onMoveDown={() => moveItemDown(globalIndex)}
                canMoveUp={canMoveUp}
                canMoveDown={canMoveDown}
                onClose={() => setSelectedItemId(null)}
              />
            </div>
          );
        }
      }
    });

    return result;
  };

  // Render preview items
  const renderPreviewItems = () => {
    return currentPageItems.map(item => {
      if (isField(item)) {
        const column = getColumn(item.columnId);
        const colSpan = getColSpan(item.width);
        // Use wrapper for relation fields to load options
        return (
          <div key={item.id} className={colSpan}>
            <RelationFieldWrapper
              field={item}
              column={column}
              viewMode={viewMode}
              sampleValue={sampleData?.[item.columnId] ?? sampleData?.[column?.name || '']}
            />
          </div>
        );
      }
      if (isDivider(item)) {
        return (
          <div key={item.id} className="col-span-12">
            <DividerPreview
              isSelected={false}
              onClick={() => {}}
              onMoveUp={() => {}}
              onMoveDown={() => {}}
              onDelete={() => {}}
              canMoveUp={false}
              canMoveDown={false}
              isPreviewMode
            />
          </div>
        );
      }
      if (isTextBlock(item)) {
        const textColSpan = getColSpan(item.width);
        return (
          <div key={item.id} className={textColSpan}>
            <TextBlockPreview
              block={item}
              isSelected={false}
              onClick={() => {}}
              isPreviewMode
            />
          </div>
        );
      }
      return null;
    });
  };

  // Render hidden fields section
  const renderHiddenFields = () => {
    if (hiddenFields.length === 0) return null;

    return (
      <>
        {/* Divider */}
        <div className="col-span-12 py-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[var(--border-primary)]" />
            <span className="text-xs text-[var(--text-tertiary)] flex items-center gap-1.5">
              <EyeOff className="w-3.5 h-3.5" />
              Скрытые поля ({hiddenFields.length})
            </span>
            <div className="flex-1 h-px bg-[var(--border-primary)]" />
          </div>
        </div>

        {/* Hidden fields */}
        <div className="col-span-12 grid grid-cols-12 gap-0 opacity-50">
          {hiddenFields.map((field) => {
            const column = getColumn(field.columnId);
            const isSelected = selectedItemId === field.id;
            const globalIndex = items.findIndex(i => i.id === field.id);
            const colSpan = getColSpan(field.width);

            return (
              <React.Fragment key={field.id}>
                <div className={colSpan}>
                  <FieldPreviewEditor
                    field={{ ...field, width: 'full' }}
                    column={column}
                    viewMode={viewMode}
                    isSelected={isSelected}
                    onClick={() => setSelectedItemId(isSelected ? null : field.id)}
                    sampleValue={sampleData?.[field.columnId] ?? sampleData?.[column?.name || '']}
                  />
                </div>
                {isSelected && (
                  <div className="col-span-12 px-1.5 pb-1.5">
                    <FieldSettingsPanel
                      field={field}
                      column={column}
                      totalFields={items.length}
                      currentIndex={globalIndex}
                      onUpdate={(updates) => updateItem(field.id, updates)}
                      onMoveUp={() => moveItemUp(globalIndex)}
                      onMoveDown={() => moveItemDown(globalIndex)}
                      onToggleVisibility={() => toggleFieldVisibility(field.id)}
                      onClose={() => setSelectedItemId(null)}
                    />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 z-[70] w-[95vw] ${MODAL_SIZE_OPTIONS.find(o => o.value === modalSize)?.width || 'max-w-3xl'} -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl focus:outline-none overflow-hidden`}>
          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <Dialog.Title className="text-2xl font-semibold text-[var(--text-primary)]">
              Конструктор формы{tableName ? `: ${tableName}` : ''}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Form builder modal content
            </Dialog.Description>
          </div>

          {/* Toolbar - only in editor mode */}
          {mode === 'editor' && (
            <FormBuilderToolbar
              formTypes={formTypes}
              onFormTypeToggle={handleFormTypeToggle}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              modalSize={modalSize}
              onModalSizeChange={setModalSize}
              stats={{ pages: stats.pages }}
              currentPage={currentPage}
              onPageChange={setCurrentPage}
              onAddDivider={addDivider}
              onAddPageBreak={addPageBreak}
              onAddTextBlock={addTextBlock}
              onResetToDefault={resetToDefault}
              tableId={tableId}
              formUrl={formUrl}
              embedCode={embedCode}
            />
          )}

          {/* Form area */}
          <div className="px-6 py-4 max-h-[55vh] overflow-y-auto">
            <div className="grid grid-cols-12 gap-0">
              {mode === 'editor' ? renderEditorItems() : renderPreviewItems()}
            </div>

            {/* Hidden fields - only in editor mode */}
            {mode === 'editor' && renderHiddenFields()}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)]/50">
            <div className="text-sm text-[var(--text-tertiary)]">
              {mode === 'editor' ? (
                `${stats.visible} видимых · ${stats.hidden} скрытых · ${stats.elements} элементов · ${stats.pages} страниц`
              ) : (
                stats.pages > 1 ? `Страница ${currentPage} из ${stats.pages}` : ''
              )}
            </div>
            <div className="flex gap-2">
              {mode === 'preview' ? (
                <>
                  {/* Preview mode footer */}
                  {stats.pages > 1 && currentPage < stats.pages && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setCurrentPage(p => p + 1)}
                    >
                      Далее
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setMode('editor')}
                  >
                    <Pencil className="w-4 h-4 mr-1" />
                    Редактор
                  </Button>
                </>
              ) : (
                <>
                  {/* Editor mode footer */}
                  <Button variant="secondary" size="sm" onClick={onClose}>
                    <X className="w-4 h-4 mr-1" />
                    Отмена
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setMode('preview');
                      setCurrentPage(1);
                      setSelectedItemId(null);
                    }}
                  >
                    <Eye className="w-4 h-4 mr-1" />
                    Просмотр
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSave}>
                    <Save className="w-4 h-4 mr-1" />
                    Сохранить
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Close button */}
          <button
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full p-2 text-[var(--text-tertiary)] transition hover:bg-[var(--bg-secondary)]"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default FormBuilder;

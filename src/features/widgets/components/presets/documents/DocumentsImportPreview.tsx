/**
 * Documents Import Preview - Document preview with inline editing during import
 */

import { useMemo, useCallback } from 'react';
import {
  Upload,
  FileUp,
  Edit3,
  Trash2,
  Check,
  Atom,
  X,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useDocumentsContext } from './DocumentsContext';
import { type SectionTreeNodeV4, type ParsedSectionV4 } from '../../../utils/parseMarkdownToAtoms';

// Utility to flatten tree for preview
function flattenSectionTreeV4(nodes: SectionTreeNodeV4[]): ParsedSectionV4[] {
  const result: ParsedSectionV4[] = [];
  
  function traverse(node: SectionTreeNodeV4) {
    result.push(node.section);
    if (node.children) {
      node.children.forEach(traverse);
    }
  }
  
  nodes.forEach(traverse);
  return result;
}

// Generate atom key from title
function generateAtomKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

export function DocumentsImportPreview() {
  const ctx = useDocumentsContext();
  
  // Flatten tree for rendering
  const flatSections = useMemo(() => flattenSectionTreeV4(ctx.importTree), [ctx.importTree]);
  
  // Filter sections by search query
  const filteredSections = useMemo(() => {
    if (!ctx.contentSearchQuery.trim()) return flatSections;
    const q = ctx.contentSearchQuery.toLowerCase();
    return flatSections.filter(section => 
      section.content?.toLowerCase().includes(q)
    );
  }, [flatSections, ctx.contentSearchQuery]);
  
  // === HANDLERS ===
  
  const handleEditSection = (order: number, content?: string) => {
    ctx.setEditingImportOrder(order);
    ctx.setEditingImportData({ content });
  };
  
  const handleSaveEdit = () => {
    ctx.setEditingImportOrder(null);
    ctx.setEditingImportData({});
  };
  
  const toggleAtomFields = (order: number, idx: number, allSections: ImportSection[]) => {
    const wasEnabled = ctx.atomSections[order]?.enabled;
    
    if (!wasEnabled) {
      // Generate title and key when enabling
      const { title, key } = getContextHeading(idx, allSections);
      ctx.setAtomSections(prev => ({
        ...prev,
        [order]: { enabled: true, key, title }
      }));
    } else {
      // Just disable
      ctx.setAtomSections(prev => ({
        ...prev,
        [order]: { ...prev[order], enabled: false }
      }));
    }
  };
  
  const updateAtomData = (order: number, field: 'key' | 'title', value: string) => {
    ctx.setAtomSections(prev => ({
      ...prev,
      [order]: {
        ...prev[order],
        enabled: prev[order]?.enabled || false,
        [field]: value
      }
    }));
  };
  
  const getContextHeading = (idx: number, allSections: ParsedSectionV4[]): { title: string; key: string } => {
    let h1Title = '';
    let h2Title = '';
    let h3Title = '';
    
    for (let i = idx - 1; i >= 0; i--) {
      const prevSection = allSections[i];
      if (prevSection.level === 'h3' && !h3Title) {
        h3Title = prevSection.content || '';
      } else if (prevSection.level === 'h2' && !h2Title) {
        h2Title = prevSection.content || '';
      } else if (prevSection.level === 'h1' && !h1Title) {
        h1Title = prevSection.content || '';
        break;
      }
    }
    
    const title = h3Title || h2Title || h1Title || 'Без заголовка';
    const baseKey = generateAtomKey(title);
    const key = `${baseKey}-${allSections[idx].order}`;
    
    return { title, key };
  };

  // === RENDER SECTION ===
  
  const renderSection = (section: ParsedSectionV4, idx: number, allSections: ParsedSectionV4[]) => {
    const isActive = ctx.activePreviewOrder === section.order;
    const isEditing = ctx.editingImportOrder === section.order;
    const atomState = ctx.atomSections[section.order] || { enabled: false, key: '', title: '' };
    const showAtomFields = atomState.enabled;
    
    // Divider special handling
    if (section.level === 'divider') {
      return (
        <div 
          key={idx} 
          id={`preview-${section.order}`}
          className={cn(
            "group relative flex items-center py-4 hover:bg-[var(--bg-tertiary)] cursor-pointer",
            ctx.previewMode !== 'none' ? 'px-12' : 'px-8'
          )}
          onClick={() => ctx.setActivePreviewOrder(section.order)}
        >
          <div className="flex-1 border-t border-dashed border-[var(--border-secondary)]" />
          <span className="px-3 text-xs text-[var(--text-tertiary)]">• • •</span>
          <div className="flex-1 border-t border-dashed border-[var(--border-secondary)]" />
          <button className="absolute right-4 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-red-500">
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      );
    }
    
    const basePadding = ctx.previewMode !== 'none' ? 'px-12' : 'px-8';
    const indent = section.level === 'h2' ? '' : section.level === 'h3' ? 'ml-6' : '';
    const textSize = section.level === 'h2' ? 'text-xl font-bold' : section.level === 'h3' ? 'text-lg font-semibold' : 'text-base leading-relaxed';

    return (
      <div 
        key={idx}
        id={`preview-${section.order}`}
        className={cn(
          "group relative py-4 pr-6 transition-colors",
          basePadding,
          isActive || isEditing ? 'bg-[var(--bg-tertiary)]/50' : ''
        )}
      >
        <div className={indent}>
          {/* Floating controls */}
          <div className="absolute top-2 right-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Atom badge */}
            {section.level === 'text' && showAtomFields && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400 flex items-center gap-1">
                <Atom className="w-3 h-3" />
                атом
              </span>
            )}
            
            {/* Level badge */}
            <span className={cn(
              "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase",
              section.level === 'h2' ? 'bg-blue-500/20 text-blue-400' :
              section.level === 'h3' ? 'bg-green-500/20 text-green-400' :
              'bg-gray-500/20 text-gray-400'
            )}>
              {section.level}
            </span>
            
            {/* Edit button - also opens right panel */}
            {isEditing ? (
              <button 
                onClick={handleSaveEdit}
                className="px-2 py-0.5 rounded text-[10px] bg-green-500 text-white"
              >
                ✓
              </button>
            ) : (
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditSection(section.order, section.content);
                  ctx.setActivePreviewOrder(section.order);
                  ctx.setRightPanelOpen(true);
                }}
                className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-tertiary)]"
                title="Редактировать"
              >
                <Edit3 className="w-3 h-3" />
              </button>
            )}
            
            {/* Delete button */}
            <button 
              onClick={(e) => e.stopPropagation()}
              className="p-1 rounded hover:bg-red-500/20 text-red-500"
              title="Удалить"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          
          {/* Content area */}
          {isEditing ? (
            <div className="space-y-3 pr-24">
              {/* Headers (h1, h2, h3) - single line input */}
              {(section.level === 'h1' || section.level === 'h2' || section.level === 'h3') ? (
                <input
                  type="text"
                  value={ctx.editingImportData.content || ''}
                  onChange={(e) => ctx.setEditingImportData(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="Заголовок..."
                  className={cn(textSize, "w-full bg-transparent border-b-2 border-[var(--color-primary-500)] focus:border-blue-500 outline-none text-[var(--text-primary)]")}
                  autoFocus
                />
              ) : (
                /* Text - multiline textarea */
                <textarea
                  value={ctx.editingImportData.content || ''}
                  onChange={(e) => ctx.setEditingImportData(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="Контент..."
                  className="w-full text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-3 focus:border-[var(--color-primary-500)] outline-none resize-none font-mono"
                  rows={Math.min(15, (ctx.editingImportData.content?.split('\n').length || 3) + 2)}
                  autoFocus
                />
              )}
            </div>
          ) : (
            <div className="pr-24">
              {/* All levels use content field */}
              {section.content ? (
                (section.level === 'h1' || section.level === 'h2' || section.level === 'h3') ? (
                  /* Headers - display as heading */
                  <div 
                    className={cn(textSize, "text-[var(--text-primary)] cursor-text leading-relaxed")}
                    onClick={() => handleEditSection(section.order, section.content)}
                  >
                    {section.content}
                  </div>
                ) : (
                  /* Text - render as markdown */
                  <div 
                    className="text-[var(--text-secondary)] prose prose-sm dark:prose-invert max-w-none cursor-text leading-relaxed"
                    onClick={() => handleEditSection(section.order, section.content)}
                  >
                    <MarkdownPreview content={section.content} />
                  </div>
                )
              ) : (
                <div 
                  className="text-[var(--text-tertiary)] italic text-sm cursor-text"
                  onClick={() => handleEditSection(section.order, '')}
                >
                  Нажмите чтобы редактировать...
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // === MAIN RENDER ===

  return (
    <div 
      ref={ctx.previewRef} 
      className={cn(
        "flex-1 overflow-y-auto flex justify-center",
        ctx.previewMode === 'strip' ? 'p-6 bg-[var(--bg-tertiary)]/30' : 'p-6'
      )}
    >
      {ctx.importTree.length > 0 ? (
        <div className={cn(
          ctx.previewMode === 'strip'
            ? "bg-[var(--bg-primary)] border border-[var(--border-primary)] shadow-xl w-[850px] rounded-lg"
            : "w-full max-w-4xl"
        )}>
          {/* Document title */}
          <div 
            id="preview-title"
            className={cn(
              "group relative py-6 pr-6 transition-colors",
              ctx.previewMode === 'strip' ? 'px-12' : 'px-8',
              ctx.activePreviewOrder === -1 || ctx.editingImportOrder === -1 ? 'bg-[var(--bg-tertiary)]/50' : ''
            )}
          >
            {/* Floating controls */}
            <div className="absolute top-3 right-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-purple-500/20 text-purple-400">H1</span>
              {ctx.editingImportOrder === -1 ? (
                <button 
                  onClick={() => ctx.setEditingImportOrder(null)}
                  className="px-2 py-0.5 rounded text-[10px] bg-green-500 text-white"
                >
                  ✓
                </button>
              ) : (
                <button 
                  onClick={() => { 
                    ctx.setEditingImportOrder(-1); 
                    ctx.setEditingImportData({ title: ctx.newDocName }); 
                  }}
                  className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-tertiary)]"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
              )}
            </div>
            
            {ctx.editingImportOrder === -1 ? (
              <input
                type="text"
                value={ctx.editingImportData.title || ''}
                onChange={(e) => { 
                  ctx.setEditingImportData({ title: e.target.value }); 
                  ctx.setNewDocName(e.target.value); 
                }}
                className="w-full text-2xl font-bold bg-transparent border-b-2 border-[var(--color-primary-500)] focus:border-purple-500 outline-none"
                autoFocus
              />
            ) : (
              <h1 
                className="text-2xl font-bold text-[var(--text-primary)] cursor-text leading-relaxed"
                onClick={() => { 
                  ctx.setActivePreviewOrder(-1); 
                  ctx.setEditingImportOrder(-1); 
                  ctx.setEditingImportData({ title: ctx.newDocName }); 
                }}
              >
                {ctx.newDocName || 'Нажмите чтобы ввести название...'}
              </h1>
            )}
          </div>
          
          {/* Description */}
          <div 
            id="preview-description"
            className={cn(
              "group relative py-4 pr-6 transition-colors",
              ctx.previewMode !== 'none' ? 'px-12' : 'px-8',
              ctx.activePreviewOrder === -2 || ctx.editingImportOrder === -2 ? 'bg-[var(--bg-tertiary)]/50' : ''
            )}
          >
            {/* Floating controls */}
            <div className="absolute top-2 right-4 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-gray-500/20 text-gray-400">DESC</span>
              {ctx.editingImportOrder === -2 ? (
                <button 
                  onClick={() => ctx.setEditingImportOrder(null)}
                  className="px-2 py-0.5 rounded text-[10px] bg-green-500 text-white"
                >
                  ✓
                </button>
              ) : (
                <button 
                  onClick={() => { 
                    ctx.setEditingImportOrder(-2); 
                    ctx.setEditingImportData({ content: ctx.newDocDescription }); 
                  }}
                  className="p-1 rounded hover:bg-[var(--bg-primary)] text-[var(--text-tertiary)]"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
              )}
            </div>
            
            {ctx.editingImportOrder === -2 ? (
              <textarea
                value={ctx.editingImportData.content || ''}
                onChange={(e) => { 
                  ctx.setEditingImportData({ content: e.target.value }); 
                  ctx.setNewDocDescription(e.target.value); 
                }}
                className="w-full text-base bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-3 focus:border-gray-400 outline-none resize-none"
                rows={3}
                autoFocus
              />
            ) : (
              <p 
                className="text-base text-[var(--text-secondary)] cursor-text leading-relaxed"
                onClick={() => { 
                  ctx.setActivePreviewOrder(-2); 
                  ctx.setEditingImportOrder(-2); 
                  ctx.setEditingImportData({ content: ctx.newDocDescription }); 
                }}
              >
                {ctx.newDocDescription || 'Нажмите чтобы добавить описание...'}
              </p>
            )}
          </div>
          
          {/* Divider after header */}
          <div className={cn("border-t border-[var(--border-primary)] my-4", ctx.previewMode !== 'none' ? 'mx-12' : 'mx-8')} />
          
          {/* Render document content */}
          <div>
            {filteredSections.map((section, idx) => renderSection(section, idx, flatSections))}
          </div>
        </div>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center h-full p-8 text-center text-[var(--text-secondary)]">
          <Upload className="w-12 h-12 text-[var(--text-tertiary)] mb-4 opacity-50" />
          <p>Загрузите MD файл для предпросмотра</p>
          <button
            onClick={() => ctx.setShowFileUploadModal(true)}
            className="mt-4 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm hover:border-[var(--color-primary-500)]"
          >
            <Upload className="w-4 h-4 inline mr-2" />
            Загрузить MD
          </button>
        </div>
      )}
    </div>
  );
}

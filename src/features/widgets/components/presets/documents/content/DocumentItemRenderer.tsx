import { MoreVertical, Atom, Ticket, Check, Scissors } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { type DocumentLevel, type DocumentItem } from '../../../../types/documents.types';
import { useDocumentsContext } from '../DocumentsContext';
import { ItemMenu } from './ItemMenu';
import { EditableMarkdownPreview } from './EditableMarkdownPreview';
import { DocumentWidgetItem } from './DocumentWidgetItem';
import { TicketRefAtom, useAtomRow, isTicketRefAtomPayload } from '../atoms/TicketRefAtom';

export interface DocumentItemRendererProps {
  item: DocumentItem;
  index: number;
  itemsCount: number;
  openMenu: { id: number; position: { top: number; left: number } } | null;
  openMenuAt: (itemId: number, buttonElement: HTMLElement) => void;
  closeMenu: () => void;
  onStartEditing: (item: DocumentItem) => void;
  onCancelEditing: () => void;
  onSaveEditing: () => void | Promise<void>;
  onAddBefore: (item: DocumentItem, level: DocumentLevel) => void;
  onAddAfter: (item: DocumentItem, level: DocumentLevel) => void;
  onDelete: (itemId: number) => void;
  onCopy: (item: DocumentItem) => void;
  onMoveUp: (item: DocumentItem) => void;
  onMoveDown: (item: DocumentItem) => void;
  variables?: Record<string, string | number>;
}

export function DocumentItemRenderer({
  item,
  index,
  itemsCount,
  openMenu,
  openMenuAt,
  closeMenu,
  onStartEditing,
  onCancelEditing,
  onSaveEditing,
  onAddBefore,
  onAddAfter,
  onDelete,
  onCopy,
  onMoveUp,
  onMoveDown,
  variables,
}: DocumentItemRendererProps) {
  const ctx = useDocumentsContext();

  const isEditing = ctx.editingItemId === item.id;
  const isSelected = ctx.selectedItemId === item.id;

  // ADR-0012 Phase 5 / M4: probe atoms_v2 for ticket_ref atoms. The probe is
  // a normal hook (no conditional) — useAtomRow is a no-op when atomId is
  // null/undefined, so it's safe to call for every doc item. The probe is
  // intentionally a separate hook so the rest of the renderer stays linear.
  const atomProbeQuery = useAtomRow(
    item.level === 'atom' && typeof item.atom_ref === 'number' ? item.atom_ref : null,
  );
  const atomIsTicketRef = atomProbeQuery.data
    ? isTicketRefAtomPayload(atomProbeQuery.data.data)
    : false;

  const headingStyle: React.CSSProperties =
    item.level === 'h1' ? { fontSize: '1.75em', fontWeight: 700 } :
    item.level === 'h2' ? { fontSize: '1.5em', fontWeight: 700 } :
    item.level === 'h3' ? { fontSize: '1.25em', fontWeight: 600 } : {};

  const levelBadgeClass =
    item.level === 'h1' ? 'bg-purple-500/20 text-purple-400' :
    item.level === 'h2' ? 'bg-blue-500/20 text-blue-400' :
    item.level === 'h3' ? 'bg-green-500/20 text-green-400' :
    'bg-gray-500/20 text-gray-400';

  if (item.level === 'divider') {
    return (
      <div
        key={item.id}
        id={`item-${item.id}`}
        className="group relative py-4 cursor-pointer"
        onClick={() => {
          ctx.setSelectedItemId(item.id);
          ctx.setRightPanelMode('settings');
          ctx.setRightPanelOpen(true);
        }}
      >
        <div className="flex items-center gap-2">
          <div className="flex-1 border-t border-dashed border-[var(--border-secondary)]" />
          <span className="px-3 text-xs text-[var(--text-tertiary)]">• • •</span>
          <div className="flex-1 border-t border-dashed border-[var(--border-secondary)]" />
        </div>

        {!ctx.isReadOnly && (
          <div className={cn(
            "absolute top-2 -right-12 flex items-center gap-1.5 transition-opacity z-10",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openMenu?.id === item.id ? closeMenu() : openMenuAt(item.id, e.currentTarget);
              }}
              className={cn(
                "p-1 rounded text-[var(--text-tertiary)]",
                (isSelected || isEditing) ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "hover:bg-[var(--bg-tertiary)]"
              )}
              title="Меню"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            <ItemMenu
              item={item}
              position={openMenu?.position || { top: 0, left: 0 }}
              isOpen={openMenu?.id === item.id}
              onClose={closeMenu}
              onAddBefore={onAddBefore}
              onAddAfter={onAddAfter}
              onDelete={onDelete}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              isFirst={index === 0}
              isLast={index === itemsCount - 1}
            />
          </div>
        )}
      </div>
    );
  }

  if (item.level === 'page_break') {
    return (
      <div
        key={item.id}
        id={`item-${item.id}`}
        className="group relative py-3 cursor-pointer"
        onClick={() => {
          ctx.setSelectedItemId(item.id);
          ctx.setRightPanelMode('settings');
          ctx.setRightPanelOpen(true);
        }}
      >
        <div className="flex items-center gap-2">
          <div className="flex-1 border-t border-dashed border-gray-400 dark:border-gray-500" />
          <Scissors className="w-4 h-4 text-gray-400 dark:text-gray-500 rotate-90" />
          <div className="flex-1 border-t border-dashed border-gray-400 dark:border-gray-500" />
        </div>

        {!ctx.isReadOnly && (
          <div className={cn(
            "absolute top-2 -right-12 flex items-center gap-1.5 transition-opacity z-10",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openMenu?.id === item.id ? closeMenu() : openMenuAt(item.id, e.currentTarget);
              }}
              className={cn(
                "p-1 rounded text-[var(--text-tertiary)]",
                (isSelected || isEditing) ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "hover:bg-[var(--bg-tertiary)]"
              )}
              title="Меню"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            <ItemMenu
              item={item}
              position={openMenu?.position || { top: 0, left: 0 }}
              isOpen={openMenu?.id === item.id}
              onClose={closeMenu}
              onAddBefore={onAddBefore}
              onAddAfter={onAddAfter}
              onDelete={onDelete}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              isFirst={index === 0}
              isLast={index === itemsCount - 1}
            />
          </div>
        )}
      </div>
    );
  }

  if (item.level === 'image') {
    const imageUrl = item.image_url || item.content;
    const maxHeight = item.image_max_height || 300;

    return (
      <div
        key={item.id}
        id={`item-${item.id}`}
        className={cn(
          "group relative py-4 transition-colors",
          isSelected && 'bg-[var(--color-primary-500)]/10'
        )}
        onClick={() => {
          ctx.setSelectedItemId(item.id);
          ctx.setRightPanelMode('settings');
          ctx.setRightPanelOpen(true);
        }}
      >
        {!ctx.isReadOnly && (
          <div className={cn(
            "absolute top-2 -right-12 flex items-center gap-1.5 transition-opacity z-10",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-pink-500/20 text-pink-400">
              img
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                openMenu?.id === item.id ? closeMenu() : openMenuAt(item.id, e.currentTarget);
              }}
              className={cn(
                "p-1 rounded text-[var(--text-tertiary)]",
                (isSelected || isEditing) ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "hover:bg-[var(--bg-tertiary)]"
              )}
              title="Меню"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            <ItemMenu
              item={item}
              position={openMenu?.position || { top: 0, left: 0 }}
              isOpen={openMenu?.id === item.id}
              onClose={closeMenu}
              onAddBefore={onAddBefore}
              onAddAfter={onAddAfter}
              onDelete={onDelete}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              isFirst={index === 0}
              isLast={index === itemsCount - 1}
            />
          </div>
        )}

        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Document image"
            className="rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
            style={{
              maxHeight: `${maxHeight}px`,
              maxWidth: '100%',
              objectFit: 'contain',
            }}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const parent = img.parentElement;
              if (parent) {
                const errorDiv = document.createElement('div');
                errorDiv.className = 'flex items-center gap-2 p-4 bg-red-500/10 rounded-lg text-red-500 text-sm';
                errorDiv.textContent = '🖼️ Ошибка загрузки изображения';
                parent.appendChild(errorDiv);
              }
            }}
          />
        ) : (
          <div
            className="cursor-pointer flex items-center justify-center gap-2 p-8 bg-[var(--bg-tertiary)] rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors"
            style={{ minHeight: '120px' }}
          >
            <svg className="w-8 h-8 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <span className="text-sm">Нажмите чтобы добавить изображение</span>
          </div>
        )}
      </div>
    );
  }

  if (item.level === 'widget') {
    return (
      <DocumentWidgetItem
        item={item}
        index={index}
        itemsCount={itemsCount}
        openMenu={openMenu}
        openMenuAt={openMenuAt}
        closeMenu={closeMenu}
        onAddBefore={onAddBefore}
        onAddAfter={onAddAfter}
        onDelete={onDelete}
        onCopy={onCopy}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        isSelected={isSelected}
      />
    );
  }

  // ADR-0012 Phase 5 / M4: ticket-as-atom rendering. Doc items with
  // level === 'atom' may reference a row in atoms_v2 (table 3574) whose
  // payload `type === 'ticket_ref'`. We probe the atom row and dispatch.
  // Non-ticket_ref atoms fall through to the legacy default text branch.
  if (item.level === 'atom' && typeof item.atom_ref === 'number' && atomIsTicketRef) {
    return (
      <DocumentTicketAtomItem
        item={item}
        index={index}
        itemsCount={itemsCount}
        openMenu={openMenu}
        openMenuAt={openMenuAt}
        closeMenu={closeMenu}
        onAddBefore={onAddBefore}
        onAddAfter={onAddAfter}
        onDelete={onDelete}
        onCopy={onCopy}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        isSelected={isSelected}
      />
    );
  }

  const indent = item.level === 'h2' ? '' : item.level === 'h3' ? 'ml-6' : '';

  return (
    <div
      key={item.id}
      id={`item-${item.id}`}
      className={cn(
        "group relative py-4 transition-colors",
        isSelected && 'bg-[var(--color-primary-500)]/10',
        isEditing && 'bg-[var(--bg-tertiary)]/50'
      )}
    >
      <div className={indent}>
        {!ctx.isReadOnly && (
          <div className={cn(
            "absolute top-2 -right-12 flex items-center gap-1.5 transition-opacity z-10",
            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}>
            {item.level === 'text' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.setConvertToTicketItem(item);
                  ctx.setShowConvertToTicketModal(true);
                }}
                className={cn(
                  "p-1 rounded flex items-center gap-1",
                  item.ticket_ref
                    ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                    : "bg-gray-500/20 text-gray-400 hover:bg-gray-500/30"
                )}
                title={item.ticket_ref ? "Открыть тикет" : "Создать тикет"}
              >
                <Ticket className="w-3.5 h-3.5" />
              </button>
            )}

            {item.level === 'text' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.setConvertToAtomItem(item);
                  ctx.setShowConvertToAtomModal(true);
                }}
                className={cn(
                  "p-1 rounded flex items-center gap-1",
                  item.atom_ref
                    ? "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                    : "bg-gray-500/20 text-gray-400 hover:bg-gray-500/30"
                )}
                title={item.atom_ref ? "Редактировать атом" : "Конвертировать в атом"}
              >
                <Atom className="w-3.5 h-3.5" />
              </button>
            )}

            {(item.level === 'h2' || item.level === 'h3') && (
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-mono uppercase",
                levelBadgeClass
              )}>
                {item.level}
              </span>
            )}

            {isEditing && (
              <button
                onClick={onSaveEditing}
                className="px-2 py-0.5 rounded text-[10px] bg-green-500 text-white flex items-center gap-1"
                title="Сохранить"
              >
                <Check className="w-3 h-3" />
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                openMenu?.id === item.id ? closeMenu() : openMenuAt(item.id, e.currentTarget);
              }}
              className={cn(
                "p-1 rounded text-[var(--text-tertiary)]",
                (isSelected || isEditing) ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]" : "hover:bg-[var(--bg-tertiary)]"
              )}
              title="Меню"
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            <ItemMenu
              item={item}
              position={openMenu?.position || { top: 0, left: 0 }}
              isOpen={openMenu?.id === item.id}
              onClose={closeMenu}
              onAddBefore={onAddBefore}
              onAddAfter={onAddAfter}
              onDelete={onDelete}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onEdit={(item) => {
                ctx.setSelectedItemId(item.id);
                ctx.setRightPanelMode('settings');
                ctx.setRightPanelOpen(true);
                onStartEditing(item);
              }}
              onCopy={onCopy}
              isFirst={index === 0}
              isLast={index === itemsCount - 1}
              showEditCopy
            />
          </div>
        )}

        {isEditing ? (
          <div>
            {(item.level === 'h1' || item.level === 'h2' || item.level === 'h3') ? (
              <input
                type="text"
                value={ctx.editingData.content || ''}
                onChange={(e) => ctx.setEditingData({ ...ctx.editingData, content: e.target.value })}
                placeholder="Заголовок..."
                className="w-full bg-transparent border-none outline-none text-[var(--text-primary)] focus:ring-2 focus:ring-[var(--color-primary-500)]/50 rounded px-1 -ml-1"
                style={headingStyle}
                autoFocus
                onBlur={onSaveEditing}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveEditing();
                  if (e.key === 'Escape') onCancelEditing();
                }}
              />
            ) : (
              <textarea
                value={ctx.editingData.content || ''}
                onChange={(e) => ctx.setEditingData({ ...ctx.editingData, content: e.target.value })}
                placeholder="Введите текст в формате Markdown..."
                className="w-full text-sm bg-[var(--bg-primary)] border border-[var(--color-primary-500)]/50 rounded-lg p-3 focus:border-[var(--color-primary-500)] outline-none resize-none font-mono leading-relaxed"
                rows={Math.max(5, (ctx.editingData.content?.split('\n').length || 1) + 1)}
                autoFocus
                onBlur={onSaveEditing}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onCancelEditing();
                  if (e.key === 'Enter' && e.ctrlKey) onSaveEditing();
                }}
              />
            )}
          </div>
        ) : (
          <div>
            {(item.level === 'h1' || item.level === 'h2' || item.level === 'h3') ? (
              <div
                className={ctx.isReadOnly ? "cursor-default" : "cursor-text"}
                onClick={() => onStartEditing(item)}
              >
                {item.content ? (
                  <div className="text-[var(--text-primary)] leading-relaxed" style={headingStyle}>{item.content}</div>
                ) : (
                  !ctx.isReadOnly && (
                    <div className="text-[var(--text-tertiary)] italic text-sm">
                      Нажмите чтобы редактировать...
                    </div>
                  )
                )}
              </div>
            ) : (
              item.content ? (
                <div className="prose dark:prose-invert max-w-none" style={{ fontSize: '1em' }}>
                  <EditableMarkdownPreview
                    content={item.content}
                    onContentChange={ctx.isReadOnly ? undefined : async (newContent) => {
                      if (!ctx.selectedDocument?.content_table_id) return;
                      const contentField = `content_${ctx.currentLanguage}` as const;
                      await ctx.updateItem({
                        documentId: ctx.selectedDocumentId!,
                        itemId: item.id,
                        tableId: ctx.selectedDocument.content_table_id,
                        data: { [contentField]: newContent }
                      });
                    }}
                    onEditRaw={ctx.isReadOnly ? undefined : () => onStartEditing(item)}
                    variables={variables}
                  />
                </div>
              ) : (
                !ctx.isReadOnly && (
                  <div
                    className="text-[var(--text-tertiary)] italic cursor-text"
                    style={{ fontSize: '0.875em' }}
                    onClick={() => onStartEditing(item)}
                  >
                    Нажмите чтобы редактировать...
                  </div>
                )
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ADR-0012 Phase 5 / M4 — wrapper for `level === 'atom'` items that may be
// ticket_ref atoms (atoms_v2 row with `type === 'ticket_ref'`). Resolves the
// atom row, then either renders TicketRefAtom or falls through to the legacy
// atom UX (which today simply selects the item and surfaces the right panel).
interface DocumentTicketAtomItemProps {
  item: DocumentItem;
  index: number;
  itemsCount: number;
  openMenu: { id: number; position: { top: number; left: number } } | null;
  openMenuAt: (itemId: number, buttonElement: HTMLElement) => void;
  closeMenu: () => void;
  onAddBefore: (item: DocumentItem, level: DocumentLevel) => void;
  onAddAfter: (item: DocumentItem, level: DocumentLevel) => void;
  onDelete: (itemId: number) => void;
  onCopy: (item: DocumentItem) => void;
  onMoveUp: (item: DocumentItem) => void;
  onMoveDown: (item: DocumentItem) => void;
  isSelected: boolean;
}

function DocumentTicketAtomItem({
  item,
  index,
  itemsCount,
  openMenu,
  openMenuAt,
  closeMenu,
  onAddBefore,
  onAddAfter,
  onDelete,
  onCopy,
  onMoveUp,
  onMoveDown,
  isSelected,
}: DocumentTicketAtomItemProps) {
  const ctx = useDocumentsContext();
  const atomId = typeof item.atom_ref === 'number' ? item.atom_ref : null;

  // Parent renderer already verified this is a ticket_ref atom via the
  // cached probe query, so TicketRefAtom can render off the same cache
  // entry without a second fetch.

  return (
    <div
      key={item.id}
      id={`item-${item.id}`}
      className={cn(
        'group relative py-3 transition-colors',
        isSelected && 'bg-[var(--color-primary-500)]/10',
      )}
      onClick={() => {
        ctx.setSelectedItemId(item.id);
        ctx.setRightPanelMode('settings');
        ctx.setRightPanelOpen(true);
      }}
    >
      {!ctx.isReadOnly && (
        <div
          className={cn(
            'absolute top-2 -right-12 flex items-center gap-1.5 transition-opacity z-10',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono uppercase bg-blue-500/20 text-blue-400">
            ticket
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openMenu?.id === item.id ? closeMenu() : openMenuAt(item.id, e.currentTarget);
            }}
            className={cn(
              'p-1 rounded text-[var(--text-tertiary)]',
              isSelected ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]' : 'hover:bg-[var(--bg-tertiary)]',
            )}
            title="Меню"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          <ItemMenu
            item={item}
            position={openMenu?.position || { top: 0, left: 0 }}
            isOpen={openMenu?.id === item.id}
            onClose={closeMenu}
            onAddBefore={onAddBefore}
            onAddAfter={onAddAfter}
            onDelete={onDelete}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onCopy={onCopy}
            isFirst={index === 0}
            isLast={index === itemsCount - 1}
          />
        </div>
      )}
      <TicketRefAtom atomId={atomId as number} />
    </div>
  );
}

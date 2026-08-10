import React from 'react';
import { useDocumentsContext } from '../DocumentsContext';
import { flattenSectionTreeV4 } from '../../../../utils/parseMarkdownToAtoms';
import { ImportTreeNode } from './ImportTreeNode';

export function SidebarImportView() {
  const ctx = useDocumentsContext();

  return (
    <div>
      {ctx.newDocName && (
        <div
          className={
            'px-3 py-2 border-b border-[var(--border-secondary)] cursor-pointer ' +
            (ctx.activePreviewOrder === -1
              ? 'bg-[var(--color-primary-500)]/20'
              : 'hover:bg-[var(--bg-tertiary)]')
          }
          onClick={() => {
            ctx.setActivePreviewOrder(-1);
            ctx.setEditingImportOrder(-1);
            ctx.setEditingImportData({ title: ctx.newDocName });
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-purple-400 text-sm">📌</span>
            <span className="font-medium text-[var(--text-primary)] truncate">{ctx.newDocName}</span>
            <span className="text-[10px] text-purple-400 uppercase ml-auto">H1</span>
          </div>
        </div>
      )}

      <div className="px-3 py-2 text-xs font-semibold text-[var(--text-tertiary)] uppercase border-b border-[var(--border-secondary)]">
        Структура ({flattenSectionTreeV4(ctx.importTree).length})
      </div>
      {ctx.importTree.length > 0 ? (
        <div className="p-2">
          {ctx.importTree.map(node => (
            <ImportTreeNode key={node.section.order} node={node} />
          ))}
        </div>
      ) : (
        <div className="p-4 text-center text-sm text-[var(--text-tertiary)]">
          Загрузите MD файл
        </div>
      )}
    </div>
  );
}

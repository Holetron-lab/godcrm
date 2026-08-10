import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from '../DocumentsContext';
import type { SectionTreeNodeV4 } from '../../../../utils/parseMarkdownToAtoms';
import { stripMarkdown } from './utils/stripMarkdown';

export function ImportTreeNode({
  node,
  depth = 0,
}: {
  node: SectionTreeNodeV4;
  depth?: number;
}) {
  const ctx = useDocumentsContext();
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = ctx.expandedNodes.has(node.section.order);
  const atomState = ctx.atomSections[node.section.order];

  const toggleExpand = () => {
    ctx.setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(node.section.order)) {
        next.delete(node.section.order);
      } else {
        next.add(node.section.order);
      }
      return next;
    });
  };

  return (
    <div style={{ marginLeft: depth * 12 + (node.section.level === 'text' || node.section.level === 'divider' ? 16 : 0) }}>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-2 rounded cursor-pointer text-sm',
          ctx.activePreviewOrder === node.section.order
            ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-400)]'
            : 'hover:bg-[var(--bg-tertiary)]',
          !node.section.selected && 'opacity-50'
        )}
        onClick={() => {
          ctx.setActivePreviewOrder(node.section.order);
          const element = document.getElementById(`preview-${node.section.order}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }}
      >
        {hasChildren ? (
          <button onClick={(e) => { e.stopPropagation(); toggleExpand(); }} className="p-0.5">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        ) : (
          <span className="w-4" />
        )}

        <input
          type="checkbox"
          checked={node.section.selected}
          onChange={() => {
            ctx.setImportTree(prev => {
              const toggle = (nodes: SectionTreeNodeV4[]): SectionTreeNodeV4[] => {
                return nodes.map(n => {
                  if (n.section.order === node.section.order) {
                    return { ...n, section: { ...n.section, selected: !n.section.selected } };
                  }
                  if (n.children) {
                    return { ...n, children: toggle(n.children) };
                  }
                  return n;
                });
              };
              return toggle(prev);
            });
          }}
          className="w-3.5 h-3.5 rounded accent-[var(--color-primary-500)]"
          onClick={(e) => e.stopPropagation()}
        />

        {node.section.level === 'divider' ? (
          <span className="flex-1 flex items-center gap-2">
            <span className="flex-1 border-t-2 border-dashed border-[var(--text-tertiary)]" />
          </span>
        ) : (
          <span className="truncate flex-1">
            {node.section.content
              ? (node.section.level === 'text'
                  ? stripMarkdown(node.section.content).substring(0, 40) || 'Текст'
                  : node.section.content)
              : 'Без названия'}
          </span>
        )}

        {atomState?.enabled && (
          <span className="px-1 py-0.5 rounded text-[10px] font-medium bg-purple-500/20 text-purple-400 flex items-center gap-0.5">
            ⚛
          </span>
        )}

        <span className={cn(
          'px-1 py-0.5 rounded text-[10px] uppercase',
          node.section.level === 'h1' ? 'bg-purple-500/20 text-purple-400' :
          node.section.level === 'h2' ? 'bg-blue-500/20 text-blue-400' :
          node.section.level === 'h3' ? 'bg-green-500/20 text-green-400' :
          node.section.level === 'divider' ? 'bg-gray-500/20 text-gray-400' :
          'bg-gray-500/20 text-gray-400'
        )}>
          {node.section.level === 'divider' ? 'DIV' : node.section.level}
        </span>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {node.children!.map(child => (
            <ImportTreeNode
              key={child.section.order}
              node={child}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

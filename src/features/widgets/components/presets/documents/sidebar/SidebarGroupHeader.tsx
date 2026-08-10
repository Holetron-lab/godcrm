import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CATEGORY_ICONS } from '../../../../types/documents.types';

interface SidebarGroupHeaderProps {
  category: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}

export function SidebarGroupHeader({ category, count, collapsed, onToggle }: SidebarGroupHeaderProps) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-[var(--text-tertiary)] uppercase hover:bg-[var(--bg-tertiary)] rounded"
    >
      {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      <span>{CATEGORY_ICONS[category] || '📁'}</span>
      <span>{category}</span>
      <span className="ml-auto text-[10px] font-normal">{count}</span>
    </button>
  );
}

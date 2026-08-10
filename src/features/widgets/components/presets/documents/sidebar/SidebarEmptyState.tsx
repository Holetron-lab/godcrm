import React from 'react';
import { FileText, FolderOpen } from 'lucide-react';

interface SidebarEmptyStateProps {
  icon: 'folder' | 'file';
  message: string;
}

export function SidebarEmptyState({ icon, message }: SidebarEmptyStateProps) {
  const Icon = icon === 'folder' ? FolderOpen : FileText;
  return (
    <div className="text-center py-8 text-[var(--text-tertiary)]">
      <Icon className="w-8 h-8 mx-auto mb-2 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

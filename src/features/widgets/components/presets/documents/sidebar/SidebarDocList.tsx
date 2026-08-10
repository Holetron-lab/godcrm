import React, { useState } from 'react';
import type { DocumentRegistryItem } from '../../../../types/documents.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { SidebarDocRow } from './SidebarDocRow';
import { SidebarEmptyState } from './SidebarEmptyState';
import { SidebarGroupHeader } from './SidebarGroupHeader';
import { useSidebarGrouping } from './hooks/useSidebarGrouping';

interface SidebarDocListProps {
  documents: DocumentRegistryItem[];
  showCategories: boolean;
}

export function SidebarDocList({ documents, showCategories }: SidebarDocListProps) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const grouped = useSidebarGrouping(documents);
  const { t } = useLanguage();

  const toggleCategory = (cat: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div className="p-2 space-y-1">
      {showCategories ? (
        grouped.length === 0 ? (
          <SidebarEmptyState icon="folder" message={t('documents.noDocsFound')} />
        ) : (
          grouped.map(({ category, docs }) => {
            const isCollapsed = collapsedCategories.has(category);
            return (
              <div key={category}>
                <SidebarGroupHeader
                  category={category}
                  count={docs.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggleCategory(category)}
                />
                {!isCollapsed && docs.map(doc => (
                  <SidebarDocRow key={doc.id} doc={doc} indented />
                ))}
              </div>
            );
          })
        )
      ) : (
        <>
          {documents.map(doc => (
            <SidebarDocRow key={doc.id} doc={doc} />
          ))}
          {documents.length === 0 && (
            <SidebarEmptyState icon="folder" message={t('documents.noDocsFound')} />
          )}
        </>
      )}
    </div>
  );
}

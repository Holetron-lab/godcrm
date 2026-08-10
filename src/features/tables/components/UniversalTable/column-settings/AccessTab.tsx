/**
 * AccessTab — Access control tab for column configuration
 * Extracted from ColumnSettingsDrawer for modularity
 */
import React from 'react';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { UserAccessPanel } from '@/shared/components/access/UserAccessPanel';
import type { TFunction } from './shared';

interface AccessTabProps {
  column: ColumnModel | null;
  t: TFunction;
  spaceId?: number;
  spaceName?: string;
  projectId?: number;
  projectName?: string;
  tableId?: number;
  tableName?: string;
}

export const AccessTab = ({
  column,
  t,
  spaceId,
  spaceName,
  projectId,
  projectName,
  tableId,
  tableName,
}: AccessTabProps) => {
  return (
    <div className="space-y-4">
      {!spaceId ? (
        <div className="p-6 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] space-y-4">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🔐</div>
            <div>
              <h4 className="font-medium text-[var(--text-primary)]">
                {t('columnSettings.access.unavailable')}
              </h4>
              <p className="text-xs text-[var(--text-tertiary)]">
                {t('columnSettings.access.linkToProject')}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <UserAccessPanel
          entityType="column"
          entityId={column?.id ? parseInt(column.id) : 0}
          spaceId={spaceId}
          currentUserLevel="owner"
          ownerOwnerId={undefined}
          onPermissionsChange={() => {}}
          spaceName={spaceName}
          projectId={projectId}
          projectName={projectName}
          tableId={tableId}
          tableName={tableName}
          columnName={column?.displayName || column?.name}
        />
      )}
    </div>
  );
};

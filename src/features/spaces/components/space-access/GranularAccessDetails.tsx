/**
 * Expandable row showing granular access overrides for a user.
 */

import React from 'react';
import { Layers } from 'lucide-react';
import type { PermissionEntityType } from '@/shared/types/user-access.types';
import type { SpaceUserRow } from './types';
import { LEVEL_COLORS, LEVEL_ICONS } from './constants';
import { getGranularCounts } from './utils';

const renderAccessGrid = (
  label: string,
  entityType: PermissionEntityType,
  ownerArr: string[],
  adminArr: string[],
  editorArr: string[],
  viewerArr: string[],
  deniedArr: string[]
) => {
  const total = ownerArr.length + adminArr.length + editorArr.length + viewerArr.length + deniedArr.length;
  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className={`${LEVEL_COLORS[entityType].split(' ')[0]}`}>
          {LEVEL_ICONS[entityType]}
        </span>
        <h6 className={`text-xs font-medium ${LEVEL_COLORS[entityType].split(' ')[0]}`}>
          {label}
        </h6>
        <span className="text-[10px] text-[var(--text-tertiary)]">({total})</span>
      </div>
      <div className="grid grid-cols-5 gap-1 text-[10px]">
        {[
          { label: 'Owner', arr: ownerArr, color: 'bg-yellow-500/10 text-yellow-400' },
          { label: 'Admin', arr: adminArr, color: 'bg-purple-500/10 text-purple-400' },
          { label: 'Editor', arr: editorArr, color: 'bg-blue-500/10 text-blue-400' },
          { label: 'Viewer', arr: viewerArr, color: 'bg-green-500/10 text-green-400' },
          { label: 'Denied', arr: deniedArr, color: 'bg-red-500/10 text-red-400' },
        ].map(({ label: lbl, arr, color }) => (
          <div key={lbl} className={`p-1 rounded ${color}`}>
            <div className="font-medium">{lbl}</div>
            <div className="text-[9px] break-all">{arr.length > 0 ? arr.join(', ') : '--'}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const GranularAccessDetails = ({ user }: { user: SpaceUserRow }) => {
  const counts = getGranularCounts(user);

  return (
    <div className="px-4 py-3 bg-[var(--bg-tertiary)] border-t border-[var(--accent-primary)]/20 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4 text-[var(--accent-primary)]" />
        <span className="text-xs font-medium text-[var(--text-secondary)]">
          Гранулярные переопределения для {user.name}
        </span>
      </div>

      {renderAccessGrid(
        'Проекты',
        'project',
        user.project_owner ?? [],
        user.project_admin ?? [],
        user.project_editor ?? [],
        user.project_viewer ?? [],
        user.project_denied ?? []
      )}

      {renderAccessGrid(
        'Таблицы',
        'table',
        user.table_owner ?? [],
        user.table_admin ?? [],
        user.table_editor ?? [],
        user.table_viewer ?? [],
        user.table_denied ?? []
      )}

      {renderAccessGrid(
        'Колонки',
        'column',
        user.column_owner ?? [],
        user.column_admin ?? [],
        user.column_editor ?? [],
        user.column_viewer ?? [],
        user.column_denied ?? []
      )}

      {counts.total === 0 && (
        <p className="text-xs text-[var(--text-tertiary)] italic">
          Нет гранулярных переопределений. Используется только базовая роль на уровне Space.
        </p>
      )}
    </div>
  );
};

/**
 * Badge components for permission level and inheritance display
 */

import React from 'react';
import { Edit3, ArrowDown } from 'lucide-react';
import type { PermissionEntityType } from '@/shared/types/user-access.types';
import { ENTITY_LEVEL_COLORS, ENTITY_LEVEL_ICONS, ENTITY_LEVEL_LABELS, ENTITY_LEVEL_LABELS_RU } from './types';

/** Badge showing at which level a permission applies */
export const PermissionLevelBadge = ({ level, inherited }: { level: PermissionEntityType; inherited?: boolean }) => (
  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${ENTITY_LEVEL_COLORS[level]} ${inherited ? 'opacity-60' : ''}`}>
    {ENTITY_LEVEL_ICONS[level]}
    {ENTITY_LEVEL_LABELS[level]}
    {inherited && (
      <ArrowDown className="w-2.5 h-2.5 ml-0.5" />
    )}
  </span>
);

/** Badge for inherited vs direct permissions */
export const InheritanceBadge = ({ inherited, inheritedFrom }: { inherited: boolean; inheritedFrom?: PermissionEntityType }) => {
  if (!inherited) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
        <Edit3 className="w-2.5 h-2.5" />
        Прямой
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-500/10 text-gray-400 border border-gray-500/30">
      <ArrowDown className="w-2.5 h-2.5" />
      Наследуется {inheritedFrom ? `от ${ENTITY_LEVEL_LABELS_RU[inheritedFrom]}` : ''}
    </span>
  );
};

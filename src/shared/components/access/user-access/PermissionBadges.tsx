/**
 * Small badges that label a permission's source level and inheritance.
 * Extracted from UserAccessPanel.tsx.
 */

import React from 'react';
import { ArrowDown, Edit3 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { PermissionEntityType } from '@/shared/types/user-access.types';
import {
  ENTITY_LEVEL_COLORS,
  ENTITY_LEVEL_ICONS,
} from './constants';

/** Badge showing at which level a permission applies */
export const PermissionLevelBadge = ({
  level,
  inherited,
}: {
  level: PermissionEntityType;
  inherited?: boolean;
}) => {
  const { t } = useLanguage();
  return (
    <span
      style={{ color: 'var(--text-primary)' }}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${ENTITY_LEVEL_COLORS[level]}`}
    >
      {ENTITY_LEVEL_ICONS[level]}
      {t(`userAccess.panel.levels.${level}`)}
      {inherited && <ArrowDown className="w-2.5 h-2.5 ml-0.5" />}
    </span>
  );
};

/** Badge for inherited vs direct permissions */
export const InheritanceBadge = ({
  inherited,
  inheritedFrom,
}: {
  inherited: boolean;
  inheritedFrom?: PermissionEntityType;
}) => {
  const { t } = useLanguage();
  if (!inherited) {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/10 text-[var(--text-primary)] border border-emerald-500/30">
        <Edit3 className="w-2.5 h-2.5" />
        {t('userAccess.panel.direct')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-500/10 text-[var(--text-primary)] border border-gray-500/30">
      <ArrowDown className="w-2.5 h-2.5" />
      {inheritedFrom
        ? t(`userAccess.panel.inheritedFrom.${inheritedFrom}`)
        : t('userAccess.panel.inherited')}
    </span>
  );
};

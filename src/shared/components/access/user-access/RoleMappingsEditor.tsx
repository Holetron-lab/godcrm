/**
 * Editor for the role column -> access level mapping list.
 * Extracted from UserAccessPanel.tsx.
 */

import React, { useId } from 'react';
import { Shield, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_COLORS,
} from '@/shared/types/user-access.types';
import type { RoleMapping } from './types';
import { getLevelIcon } from './helpers';

interface RoleMappingsEditorProps {
  roleMappings: RoleMapping[];
  setRoleMappings: React.Dispatch<React.SetStateAction<RoleMapping[]>>;
  customMappingValue: string;
  setCustomMappingValue: (v: string) => void;
  customMappingLevel: UserAccessLevel;
  setCustomMappingLevel: (v: UserAccessLevel) => void;
  availableLevels: { value: UserAccessLevel; label: string }[];
}

export const RoleMappingsEditor = ({
  roleMappings,
  setRoleMappings,
  customMappingValue,
  setCustomMappingValue,
  customMappingLevel,
  setCustomMappingLevel,
  availableLevels,
}: RoleMappingsEditorProps) => {
  const fieldId = useId();
  const { t } = useLanguage();
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-4 h-4 text-[var(--accent-primary)]" />
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {t('userAccess.panel.rolesMapping')}
        </span>
      </div>

      {/* Current mappings */}
      <div className="space-y-2 mb-3">
        {roleMappings.map((mapping, index) => (
          <div
            key={index}
            className="flex items-center gap-2 p-2 rounded-md bg-[var(--bg-primary)]"
          >
            <code className="flex-1 px-2 py-1 text-sm bg-[var(--bg-tertiary)] rounded text-[var(--text-secondary)]">
              &quot;{mapping.columnValue}&quot;
            </code>
            <span className="text-[var(--text-tertiary)]">→</span>
            <div
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm"
              style={{
                backgroundColor: `${ACCESS_LEVEL_COLORS[mapping.accessLevel]}20`,
                color: ACCESS_LEVEL_COLORS[mapping.accessLevel],
              }}
            >
              {getLevelIcon(mapping.accessLevel)}
              <span>{t(`userAccess.roles.${mapping.accessLevel}`)}</span>
            </div>
            <button
              type="button"
              aria-label={t('userAccess.panel.removeMapping', { value: mapping.columnValue })}
              onClick={() => {
                setRoleMappings((prev) => prev.filter((_, i) => i !== index));
              }}
              className="p-1 text-red-400 hover:bg-red-500/10 rounded transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add new mapping */}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor={`${fieldId}-0`} className="block text-xs text-[var(--text-tertiary)] mb-1">{t('userAccess.panel.columnValue')}</label>
          <input
            id={`${fieldId}-0`}
            type="text"
            value={customMappingValue}
            onChange={(e) => setCustomMappingValue(e.target.value)}
            placeholder={t('userAccess.panel.columnValuePlaceholder')}
            className="w-full px-2 py-1.5 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
          />
        </div>
        <div className="flex-1">
          <label htmlFor={`${fieldId}-access-level`} className="block text-xs text-[var(--text-tertiary)] mb-1">{t('userAccess.panel.accessLevel')}</label>
          <select id={`${fieldId}-access-level`}
            value={customMappingLevel}
            onChange={(e) => setCustomMappingLevel(e.target.value as UserAccessLevel)}
            className="w-full px-2 py-1.5 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
          >
            {availableLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          aria-label={t('userAccess.panel.addMapping')}
          variant="ghost"
          size="sm"
          onClick={() => {
            if (customMappingValue.trim()) {
              setRoleMappings((prev) => [
                ...prev.filter((m) => m.columnValue !== customMappingValue.trim()),
                { columnValue: customMappingValue.trim(), accessLevel: customMappingLevel },
              ]);
              setCustomMappingValue('');
            }
          }}
          disabled={!customMappingValue.trim()}
        >
          <UserPlus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

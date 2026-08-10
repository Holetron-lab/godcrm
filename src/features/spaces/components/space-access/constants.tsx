/**
 * Constants for SpaceAccessManager.
 */

import React from 'react';
import {
  Layers,
  Database,
  Table,
  GitBranch
} from 'lucide-react';
import type { UserAccessLevel, PermissionEntityType } from '@/shared/types/user-access.types';
import { ACCESS_LEVEL_LABELS } from '@/shared/types/user-access.types';

export const SELECTABLE_ACCESS_LEVELS: { value: UserAccessLevel; label: string }[] = [
  { value: 'owner', label: ACCESS_LEVEL_LABELS.owner },
  { value: 'admin', label: ACCESS_LEVEL_LABELS.admin },
  { value: 'editor', label: ACCESS_LEVEL_LABELS.editor },
  { value: 'viewer', label: ACCESS_LEVEL_LABELS.viewer },
  { value: 'denied', label: ACCESS_LEVEL_LABELS.denied },
];

export const LEVEL_LABELS: Record<PermissionEntityType, string> = {
  space: 'Space',
  project: 'Project',
  table: 'Table',
  column: 'Column'
};

export const LEVEL_COLORS: Record<PermissionEntityType, string> = {
  space: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  project: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
  table: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  column: 'text-amber-400 bg-amber-500/10 border-amber-500/30'
};

export const LEVEL_ICONS: Record<PermissionEntityType, React.ReactNode> = {
  space: <Layers className="w-3 h-3" />,
  project: <Database className="w-3 h-3" />,
  table: <Table className="w-3 h-3" />,
  column: <GitBranch className="w-3 h-3" />
};

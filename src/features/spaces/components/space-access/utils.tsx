/**
 * Utility/helper functions for SpaceAccessManager.
 */

import React from 'react';
import {
  Crown,
  Star,
  Settings,
  Edit3,
  Eye,
  Ban,
  Shield
} from 'lucide-react';
import type { UserAccessLevel, PermissionEntityType } from '@/shared/types/user-access.types';
import { ACCESS_LEVEL_VALUES } from '@/shared/types/user-access.types';
import type { SpaceUserRow } from './types';

export const getLevelIcon = (level: UserAccessLevel) => {
  switch (level) {
    case 'owner_owner': return <Crown className="w-3.5 h-3.5" />;
    case 'owner': return <Star className="w-3.5 h-3.5" />;
    case 'admin': return <Settings className="w-3.5 h-3.5" />;
    case 'editor': return <Edit3 className="w-3.5 h-3.5" />;
    case 'viewer': return <Eye className="w-3.5 h-3.5" />;
    case 'denied': return <Ban className="w-3.5 h-3.5" />;
    default: return <Shield className="w-3.5 h-3.5" />;
  }
};

/** Get the granular override count per level for a user */
export const getGranularCounts = (user: SpaceUserRow) => {
  const projects = (user.project_owner?.length || 0) + (user.project_admin?.length || 0) +
    (user.project_editor?.length || 0) + (user.project_viewer?.length || 0);
  const tables = (user.table_owner?.length || 0) + (user.table_admin?.length || 0) +
    (user.table_editor?.length || 0) + (user.table_viewer?.length || 0);
  const columns = (user.column_owner?.length || 0) + (user.column_admin?.length || 0) +
    (user.column_editor?.length || 0) + (user.column_viewer?.length || 0);
  const denied = (user.project_denied?.length || 0) + (user.table_denied?.length || 0) +
    (user.column_denied?.length || 0) + (user.space_denied?.length || 0);
  return { projects, tables, columns, denied, total: projects + tables + columns };
};

/** Determine what "level" the user's permission effectively comes from */
export const getPermissionLevel = (user: SpaceUserRow): { level: PermissionEntityType; isDirect: boolean } => {
  // If user has a direct role column value, it's a space-level direct permission
  if (user.role && ACCESS_LEVEL_VALUES[user.role as UserAccessLevel] !== undefined) {
    return { level: 'space', isDirect: true };
  }
  return { level: 'space', isDirect: false };
};

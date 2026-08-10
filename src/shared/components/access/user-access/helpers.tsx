/**
 * Pure helpers shared by UserAccessPanel subcomponents.
 * Extracted from UserAccessPanel.tsx.
 */

import React from 'react';
import { Crown, Star, Settings, Edit3, Eye, Ban, Shield } from 'lucide-react';
import type {
  UserAccessLevel,
  PermissionEntityType,
} from '@/shared/types/user-access.types';
import { ACCESS_LEVEL_VALUES } from '@/shared/types/user-access.types';
import type { EffectiveRole } from './types';

// Get icon for access level
export const getLevelIcon = (level: UserAccessLevel) => {
  switch (level) {
    case 'owner_owner':
      return <Crown className="w-4 h-4" />;
    case 'owner':
      return <Star className="w-4 h-4" />;
    case 'admin':
      return <Settings className="w-4 h-4" />;
    case 'editor':
      return <Edit3 className="w-4 h-4" />;
    case 'viewer':
      return <Eye className="w-4 h-4" />;
    case 'denied':
      return <Ban className="w-4 h-4" />;
    default:
      return <Shield className="w-4 h-4" />;
  }
};

/** Compute the effective role for a user at a given entity, considering hierarchy */
export const computeEffectiveRoles = (
  user: {
    role?: string | null;
    space_owner?: string[];
    space_admin?: string[];
    space_editor?: string[];
    space_viewer?: string[];
    space_denied?: string[];
    project_owner?: string[];
    project_admin?: string[];
    project_editor?: string[];
    project_viewer?: string[];
    project_denied?: string[];
    table_owner?: string[];
    table_admin?: string[];
    table_editor?: string[];
    table_viewer?: string[];
    table_denied?: string[];
    column_owner?: string[];
    column_admin?: string[];
    column_editor?: string[];
    column_viewer?: string[];
    column_denied?: string[];
  },
  entityType: PermissionEntityType,
  entityId: number,
  spaceId?: number,
  projectId?: number
): EffectiveRole[] => {
  void spaceId; // reserved for future space-level granular overrides
  const roles: EffectiveRole[] = [];
  const eid = String(entityId);

  // Check space-level role (from the "role" column - the base role)
  if (user.role && user.role !== '') {
    const spaceRole = user.role as UserAccessLevel;
    if (ACCESS_LEVEL_VALUES[spaceRole] !== undefined) {
      roles.push({ level: spaceRole, source: 'space', isDirect: entityType === 'space' });
    }
  }

  // Check project-level granular overrides
  if (entityType === 'project' || entityType === 'table' || entityType === 'column') {
    const pid = entityType === 'project' ? eid : projectId ? String(projectId) : '';
    if (pid) {
      const projectLevels: UserAccessLevel[] = ['owner', 'admin', 'editor', 'viewer', 'denied'];
      for (const lvl of projectLevels) {
        const arr = user[`project_${lvl}` as keyof typeof user] as string[] | undefined;
        if (arr?.includes(pid)) {
          roles.push({ level: lvl, source: 'project', isDirect: entityType === 'project' });
          break;
        }
      }
    }
  }

  // Check table-level granular overrides
  if (entityType === 'table' || entityType === 'column') {
    const tid = entityType === 'table' ? eid : '';
    if (tid) {
      const tableLevels: UserAccessLevel[] = ['owner', 'admin', 'editor', 'viewer', 'denied'];
      for (const lvl of tableLevels) {
        const arr = user[`table_${lvl}` as keyof typeof user] as string[] | undefined;
        if (arr?.includes(tid)) {
          roles.push({ level: lvl, source: 'table', isDirect: entityType === 'table' });
          break;
        }
      }
    }
  }

  // Check column-level granular overrides
  if (entityType === 'column') {
    const cid = eid;
    const columnLevels: UserAccessLevel[] = ['owner', 'admin', 'editor', 'viewer', 'denied'];
    for (const lvl of columnLevels) {
      const arr = user[`column_${lvl}` as keyof typeof user] as string[] | undefined;
      if (arr?.includes(cid)) {
        roles.push({ level: lvl, source: 'column', isDirect: true });
        break;
      }
    }
  }

  return roles;
};

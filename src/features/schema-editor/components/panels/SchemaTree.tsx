/**
 * SchemaTree - presentational navigation tree of the schema editor (ADR-207 §2.6).
 * Projects, folders, tables, columns and apps come in as nodes; expansion, visibility, column data and
 * every change go through `model`. No store behind it: the schema-editor feeds it from useSchemaTreeStore,
 * the install-plan screen can feed it from a dry-run.
 */

import type { NavTreeNode } from '../../types/schema-editor.types';
import { NavTreeItem, type NavTreeItemProps } from './NavTreeItem';

export interface SchemaTreeProps extends Omit<NavTreeItemProps, 'node' | 'depth'> {
  nodes: NavTreeNode[];
}

export const SchemaTree = ({ nodes, ...row }: SchemaTreeProps) => (
  <>
    {nodes.map((node) => (
      <NavTreeItem key={node.id} node={node} depth={0} {...row} />
    ))}
  </>
);

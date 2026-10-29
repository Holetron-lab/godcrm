import { logger } from '@/shared/utils/logger';
import type {
  TableNode,
  WidgetNode,
  SchemaNode,
  SchemaConnection,
  ColumnData,
  NavTreeNode,
  TableVisibilityState,
} from '../types/schema-editor.types';
import { schemaApi } from '../api/schemaApi';
import { apiClient } from '@/shared/utils/apiClient';
import {
  moveSystemDataToBottom,
  isFormsFolder,
  transformApiNodeToNavNode,
  type TreeApiNode,
} from './navTreeHelpers';

// Grid layout for nodes without saved positions - wider horizontal spread
const GRID_COLS = 5;
const NODE_SPACING_X = 450;
const NODE_SPACING_Y = 400;

const getDefaultPosition = (index: number) => ({
  x: (index % GRID_COLS) * NODE_SPACING_X + 50,
  y: Math.floor(index / GRID_COLS) * NODE_SPACING_Y + 50,
});

export interface LoadSchemaResult {
  nodes: SchemaNode[];
  edges: SchemaConnection[];
  navTree: NavTreeNode[];
  expandedProjects: Set<number>;
  expandedFolders: Set<string>;
  folderVisibility: Record<string, TableVisibilityState>;
  projectColors: Record<number, string>;
}

export const loadSchemaData = async (spaceId: number): Promise<LoadSchemaResult> => {
  const schema = await schemaApi.getSpaceSchema(spaceId);

  // Transform tables to nodes
  const nodes: TableNode[] = schema.tables.map((table, index) => {
    // Find layout position or use default grid
    const savedPosition = schema.layout?.find((l) => l.tableId === table.id);
    const position = savedPosition
      ? { x: savedPosition.x, y: savedPosition.y }
      : getDefaultPosition(index);
    const isPinned = savedPosition?.locked === true;

    // Map columns with icons from config
    const columns: ColumnData[] = table.columns.map((col) => {
      const config = col.config as any;
      // Get icon from config.appearance.indicator.value or config.icon
      const icon = config?.appearance?.indicator?.value || config?.icon || '';

      return {
        id: String(col.id),
        name: col.name,
        displayName: col.display_name,
        type: col.type,
        icon,
        isPrimaryKey: col.name === 'id', // Convention
        isForeignKey: col.type === 'relation',
        isRequired: col.is_required,
        orderIndex: col.order_index ?? undefined,
        isVisible: col.is_visible == null ? true : Boolean(col.is_visible),
        isReadonly: Boolean(col.is_readonly),
        isLocked: Boolean(col.is_locked),
        isFromSource: Boolean(col.is_from_source),
        config: config,
      };
    });
    const rowCount = table.row_count == null ? undefined : Number(table.row_count);

    return {
      id: `table-${table.id}`,
      type: 'tableNode',
      position,
      draggable: !isPinned,
      data: {
        tableId: table.id,
        name: table.name,
        displayName: table.display_name,
        key: table.name, // slug
        icon: table.icon || '📋',
        color: table.color,
        description: table.description,
        projectId: table.project_id,
        projectName: table.project_name,
        projectIcon: table.project_icon || '📊',
        isExternal: false,
        isSystem: Boolean(table.is_system),
        syncTarget: table.sync_target,
        columns,
        rowCount,
        isPinned,
      },
    };
  });

  // Build edges from relations
  const edges: SchemaConnection[] = [];
  logger.debug('[Schema Editor] Building edges from', schema.tables.length, 'tables');

  for (const table of schema.tables) {
    for (const col of table.columns) {
      const config = col.config as any;

      // Check if column has relation or backlink enabled (regardless of column type)
      const hasRelation = config?.relation?.enabled === true;
      const hasBacklink = config?.backlink?.enabled === true;

      if (hasRelation || hasBacklink) {
        logger.debug(`[Schema Editor] Found relation/backlink column: ${table.name}.${col.name}`, {
          hasRelation,
          hasBacklink,
          config,
        });

        let targetTableId: number | undefined;
        let targetColumn = 'id';
        let isBacklink = false;

        // Parse relation config
        if (hasRelation && config.relation?.tableId) {
          targetTableId = parseInt(config.relation.tableId);
          targetColumn = config.relation.valueColumn || 'id';
          logger.debug(`[Schema Editor] Relation: tableId=${targetTableId}, column=${targetColumn}`);
        }
        // Parse backlink config
        else if (hasBacklink && config.backlink?.sourceTableId) {
          targetTableId = parseInt(config.backlink.sourceTableId);
          targetColumn = config.backlink.sourceColumn || 'id';
          isBacklink = true;
          logger.debug(
            `[Schema Editor] Backlink: sourceTableId=${targetTableId}, sourceColumn=${targetColumn}`
          );
        }
        // Old format fallback
        else if (config.relatedTableId) {
          targetTableId = config.relatedTableId;
          targetColumn = config.relatedColumn || 'id';
          logger.debug(`[Schema Editor] Old format: tableId=${targetTableId}, column=${targetColumn}`);
        }

        if (targetTableId) {
          // Find target table to verify target column exists
          const targetTable = schema.tables.find((t) => t.id === targetTableId);
          const targetColExists = targetTable?.columns.some((c) => c.name === targetColumn);

          // Use center of table if target column doesn't exist
          const finalTargetHandle = targetColExists
            ? `target-col-${targetColumn}`
            : 'target-table-center';

          // For backlink, swap source and target
          const edgeSource = isBacklink ? `table-${targetTableId}` : `table-${table.id}`;
          const edgeTarget = isBacklink ? `table-${table.id}` : `table-${targetTableId}`;
          const edgeSourceHandle = isBacklink
            ? `source-col-${targetColumn}`
            : `source-col-${col.name}`;
          const edgeTargetHandle = isBacklink ? `target-col-${col.name}` : finalTargetHandle;

          const edge: SchemaConnection = {
            id: `edge-${table.id}-${col.name}-${targetTableId}`,
            source: edgeSource,
            target: edgeTarget,
            sourceHandle: edgeSourceHandle,
            targetHandle: edgeTargetHandle,
            type: 'glowEdge',
            animated: false,
            style: {
              stroke: isBacklink ? '#f59e0b' : '#22c55e', // Orange for backlink, green for relation
              strokeWidth: 2,
              strokeDasharray: isBacklink ? '5,5' : undefined, // Dashed for backlink
            },
            data: {
              sourceColumn: isBacklink ? targetColumn : col.name,
              targetColumn: isBacklink ? col.name : targetColumn,
              sourceTableName: isBacklink ? targetTable?.name || '' : table.name,
              targetTableName: isBacklink ? table.name : targetTable?.name || '',
              sourceTableId: isBacklink ? targetTableId : table.id,
              targetTableId: isBacklink ? table.id : targetTableId,
              relationType: isBacklink ? 'backlink' : 'one-to-many',
              isReversed: false,
            },
          };
          logger.debug('[Schema Editor] Created edge:', edge);
          edges.push(edge);
        } else {
          logger.warn('[Schema Editor] No targetTableId found for', table.name, col.name);
        }
      }
    }
  }

  // Add edges for form tables (form_XXX -> table XXX)
  for (const table of schema.tables) {
    if (table.is_system && table.name.startsWith('form_')) {
      const parentTableId = parseInt(table.name.replace('form_', ''));
      if (!isNaN(parentTableId)) {
        const parentExists = schema.tables.some((t) => t.id === parentTableId);
        if (parentExists) {
          const formEdge: SchemaConnection = {
            id: `form-edge-${table.id}-${parentTableId}`,
            source: `table-${parentTableId}`,
            target: `table-${table.id}`,
            sourceHandle: 'form-source',
            targetHandle: 'form-target',
            type: 'glowEdge',
            animated: false,
            style: { stroke: '#f97316', strokeWidth: 2 },
            data: {
              sourceColumn: null,
              targetColumn: null,
              relationType: 'form',
              isReversed: false,
            },
          };
          logger.debug('[Schema Editor] Created form edge:', formEdge);
          edges.push(formEdge);
        }
      }
    }
  }

  logger.debug(`[Schema Editor] Loaded ${nodes.length} nodes and ${edges.length} edges`);

  // Position form tables below their parent tables
  for (const node of nodes) {
    const tableData = node.data as any;
    if (tableData.isSystem && tableData.name?.startsWith('form_') && !tableData.isPinned) {
      const parentTableId = parseInt(tableData.name.replace('form_', ''));
      if (!isNaN(parentTableId)) {
        const parentNode = nodes.find((n) => (n.data as any).tableId === parentTableId);
        if (parentNode) {
          // Position form below parent table (same X, Y + 200)
          node.position = {
            x: parentNode.position.x,
            y: parentNode.position.y + 350,
          };
        }
      }
    }
  }

  // Load nav tree from API (includes folders, widgets, proper structure)
  let navTree: NavTreeNode[] = [];
  try {
    // Use apiClient to get proper auth headers
    const treeData = await apiClient.request<{ success: boolean; data: TreeApiNode[] }>(
      `/spaces/${spaceId}/tree`
    );
    logger.debug(
      '[Schema Editor] Tree API data:',
      treeData.success,
      'projects:',
      treeData.data?.length
    );
    if (treeData.success && treeData.data) {
      navTree = treeData.data.map((node) => transformApiNodeToNavNode(node, null));
      logger.debug('[Schema Editor] Loaded nav tree from API with', navTree.length, 'projects');
    }
  } catch (treeError) {
    logger.error('Failed to load nav tree from API:', treeError);
  }

  // Fallback: build from tables if navTree is empty
  if (navTree.length === 0) {
    logger.debug('[Schema Editor] Using fallback - building tree from tables');
    const projectsMap = new Map<
      number,
      {
        id: number;
        name: string;
        icon: string;
        tables: typeof schema.tables;
      }
    >();

    for (const table of schema.tables) {
      if (!projectsMap.has(table.project_id)) {
        projectsMap.set(table.project_id, {
          id: table.project_id,
          name: table.project_name || `Project ${table.project_id}`,
          icon: table.project_icon || '📊',
          tables: [],
        });
      }
      projectsMap.get(table.project_id)!.tables.push(table);
    }

    navTree = Array.from(projectsMap.values()).map((project) => ({
      id: `project:${project.id}`,
      type: 'project' as const,
      numericId: project.id,
      parentId: null,
      name: project.name,
      displayName: project.name,
      icon: project.icon,
      tableCount: project.tables.length,
      children: project.tables.map((table) => ({
        id: `table:${table.id}`,
        type: 'table' as const,
        numericId: table.id,
        name: table.name,
        displayName: table.display_name || table.name,
        icon: table.icon || '📋',
        color: table.color,
        parentId: `project:${project.id}`,
        children: [],
      })),
    }));
  }

  navTree = moveSystemDataToBottom(navTree);

  // Auto-expand all projects and folders, collect widgets and project colors
  const expandedProjects = new Set<number>();
  const expandedFolders = new Set<string>();
  const folderVisibility: Record<string, TableVisibilityState> = {};
  const projectColors: Record<number, string> = {};
  const widgetNodes: WidgetNode[] = [];

  const collectExpandedIds = (treeNodes: NavTreeNode[]) => {
    for (const node of treeNodes) {
      if (node.type === 'project') {
        expandedProjects.add(node.numericId);
        // Collect project color
        if (node.color) {
          projectColors[node.numericId] = node.color;
        }
      } else if (node.type === 'folder') {
        if (!isFormsFolder(node)) {
          expandedFolders.add(node.id); // Use node.id for virtual folders like "virtual:internal:123"
        }
        // Hide Forms folders by default
        if (node.id.includes('virtual:forms')) {
          folderVisibility[node.id] = 'hidden';
        }
      } else if (node.type === 'widget') {
        // Create widget node for canvas - position will be set below after collecting all
        widgetNodes.push({
          id: `widget-${node.numericId}`,
          type: 'widgetNode',
          position: { x: 0, y: 0 }, // Temporary, will be set after
          data: {
            widgetId: node.numericId,
            name: node.name,
            displayName: node.displayName || node.name,
            icon: node.icon,
            widgetType: node.widgetType || 'widget',
            presetName: node.presetName,
            widgetConfig: node.widgetConfig,
            mainTableId: node.mainTableId,
            projectId: node.parentId ? parseInt(node.parentId.split(':')[1]) || 0 : 0,
          },
        });
      }
      if (node.children.length > 0) {
        collectExpandedIds(node.children);
      }
    }
  };
  collectExpandedIds(navTree);

  // A module with a main table on the canvas is glued to that table: the TableNode draws it as a
  // strip above its card (full card width, stacked, moves with the table). Only modules without a
  // resolvable table stay standalone cards, laid out in a row above the canvas.
  const standaloneWidgets: WidgetNode[] = [];
  for (const widgetNode of widgetNodes) {
    const tableNode = nodes.find((n) => n.data.tableId === widgetNode.data.mainTableId);
    if (tableNode) {
      tableNode.data.widgets = [
        ...(tableNode.data.widgets ?? []),
        {
          widgetId: widgetNode.data.widgetId,
          name: widgetNode.data.displayName,
          icon: widgetNode.data.icon,
          presetName: widgetNode.data.presetName,
          widgetConfig: widgetNode.data.widgetConfig,
        },
      ];
    } else {
      widgetNode.position = { x: 50 + (standaloneWidgets.length % 4) * 300, y: -150 };
      standaloneWidgets.push(widgetNode);
    }
  }

  const allNodes = [...nodes, ...standaloneWidgets];
  logger.debug(
    '[Schema Editor] Modules:',
    widgetNodes.length - standaloneWidgets.length,
    'glued to tables,',
    standaloneWidgets.length,
    'standalone'
  );

  return {
    nodes: allNodes,
    edges,
    navTree,
    expandedProjects,
    expandedFolders,
    folderVisibility,
    projectColors,
  };
};

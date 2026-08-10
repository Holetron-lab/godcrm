import { useCallback } from 'react';
import type { Node, ReactFlowInstance } from '@xyflow/react';

import type { TableNodeData } from '../types/schema-editor.types';
import type { LayoutSettings } from './modals/LayoutSettingsModal';

interface UseApplyLayoutArgs {
  nodes: Node[];
  storeEdges: Array<{ source: string; target: string }>;
  setLocalNodes: (nodes: any) => void;
  setNodes: (nodes: any) => void;
  saveLayout: () => void;
  reactFlowInstance: ReactFlowInstance;
}

// Calculate card height based on number of columns (37px per row + header/footer)
const getCardHeight = (node: Node): number => {
  const data = node.data as TableNodeData;
  const columns = data.columns || [];
  const ROW_HEIGHT = 37;
  const HEADER_HEIGHT = 56; // Title + description
  const FOOTER_HEIGHT = 40; // Actions bar
  return HEADER_HEIGHT + columns.length * ROW_HEIGHT + FOOTER_HEIGHT;
};

/**
 * Smart layout handler for the schema editor canvas.
 *
 * Extracted from SchemaEditorPage to keep that file under the 800-line guard.
 * Supports multiple strategies: project grouping, relation-aware ordering,
 * grid layout with dynamic row heights, and hierarchy (widgets above /
 * forms below their linked tables).
 */
export const useApplyLayout = ({
  nodes,
  storeEdges,
  setLocalNodes,
  setNodes,
  saveLayout,
  reactFlowInstance,
}: UseApplyLayoutArgs) => {
  return useCallback(
    (settings: LayoutSettings) => {
      // Fixed dimensions
      const CARD_WIDTH = 340;
      const WIDGET_WIDTH = 200;
      const WIDGET_HEIGHT = 80;
      const FORM_HEIGHT = 400;

      // Gaps between nodes
      const MIN_GAP_X = settings.gapX || 100;
      const MIN_GAP_Y = settings.gapY || 80;
      const WIDGET_GAP = 200;
      const FORM_GAP = 150;

      // Separate nodes by type
      const widgetNodes = nodes.filter((n) => n.type === 'widgetNode');
      const formNodes = nodes.filter(
        (n) =>
          n.type === 'tableNode' &&
          (n.data as any).isSystem &&
          (n.data as any).name?.startsWith('form_')
      );
      const tableNodes = nodes.filter(
        (n) =>
          n.type === 'tableNode' &&
          !((n.data as any).isSystem && (n.data as any).name?.startsWith('form_'))
      );

      // Spacing calculations
      const SPACING_X = CARD_WIDTH + MIN_GAP_X;

      // Get edges for relation analysis
      const edgeSet = new Set<string>();
      storeEdges.forEach((edge) => {
        edgeSet.add(edge.source);
        edgeSet.add(edge.target);
      });

      let newNodes = [...nodes];
      let sortedTables = [...tableNodes];

      // 1. Project Grouping - sort tables by project first
      if (settings.projectGroupEnabled) {
        sortedTables.sort((a, b) => {
          const projA = (a.data as any).projectId || 0;
          const projB = (b.data as any).projectId || 0;
          return projA - projB;
        });
      }

      // 2. Relations - separate connected vs isolated
      if (settings.relationsEnabled) {
        const connectedTables = sortedTables.filter((n) => edgeSet.has(n.id));
        const isolatedTables = sortedTables.filter((n) => !edgeSet.has(n.id));

        if (settings.connectedLeft) {
          sortedTables = [...connectedTables, ...isolatedTables];
        } else {
          sortedTables = [...isolatedTables, ...connectedTables];
        }
      }

      // 3. Grid layout
      if (settings.gridEnabled) {
        const COLS = settings.gridCols || 5;
        const ROWS = settings.gridRows || 5;
        const isHorizontal = settings.gridDirection === 'horizontal';

        // Calculate starting Y for tables (leave room for widgets if hierarchy enabled)
        const startY =
          settings.hierarchyEnabled && settings.widgetsAbove
            ? WIDGET_HEIGHT + WIDGET_GAP + 50
            : 50;

        // Calculate row heights based on tallest element in each row
        const rowHeights: number[] = [];

        if (isHorizontal) {
          // Group by rows and find max height per row
          const numRows = Math.ceil(sortedTables.length / COLS);
          for (let r = 0; r < numRows; r++) {
            let maxH = 200; // minimum height
            for (let c = 0; c < COLS; c++) {
              const idx = r * COLS + c;
              if (idx < sortedTables.length) {
                maxH = Math.max(maxH, getCardHeight(sortedTables[idx]));
              }
            }
            rowHeights.push(maxH);
          }
        } else {
          // Vertical: group by columns, but we need row heights
          // In vertical mode, each column has ROWS items
          const numCols = Math.ceil(sortedTables.length / ROWS);
          for (let r = 0; r < ROWS; r++) {
            let maxH = 200;
            for (let c = 0; c < numCols; c++) {
              const idx = c * ROWS + r;
              if (idx < sortedTables.length) {
                maxH = Math.max(maxH, getCardHeight(sortedTables[idx]));
              }
            }
            rowHeights.push(maxH);
          }
        }

        // Position tables in grid with dynamic row heights
        sortedTables.forEach((node, i) => {
          const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
          if (nodeIndex >= 0) {
            let col, row;
            if (isHorizontal) {
              col = i % COLS;
              row = Math.floor(i / COLS);
            } else {
              col = Math.floor(i / ROWS);
              row = i % ROWS;
            }

            // Calculate Y position by summing previous row heights
            let yPos = startY;
            for (let r = 0; r < row; r++) {
              yPos += rowHeights[r] + MIN_GAP_Y;
            }

            newNodes[nodeIndex] = {
              ...newNodes[nodeIndex],
              position: {
                x: col * SPACING_X + 50,
                y: yPos,
              },
            };
          }
        });

        // Get bounds for table area - sum all row heights
        const totalRowsHeight = rowHeights.reduce((sum, h) => sum + h + MIN_GAP_Y, 0);
        const tableMaxY = startY + totalRowsHeight;

        // 4. Hierarchy - position widgets and forms relative to tables
        if (settings.hierarchyEnabled) {
          // Widgets
          if (settings.widgetsAbove) {
            // Position widgets above their linked tables
            widgetNodes.forEach((node, i) => {
              const mainTableId = (node.data as any).mainTableId;
              const linkedTable = sortedTables.find(
                (t) => (t.data as any).tableId === mainTableId
              );
              const nodeIndex = newNodes.findIndex((n) => n.id === node.id);

              if (nodeIndex >= 0) {
                if (linkedTable) {
                  const tableNodeIndex = newNodes.findIndex((n) => n.id === linkedTable.id);
                  newNodes[nodeIndex] = {
                    ...newNodes[nodeIndex],
                    position: {
                      x: newNodes[tableNodeIndex].position.x + (CARD_WIDTH - WIDGET_WIDTH) / 2,
                      y: 50,
                    },
                  };
                } else {
                  // Unlinked widgets in a row
                  newNodes[nodeIndex] = {
                    ...newNodes[nodeIndex],
                    position: {
                      x: i * (WIDGET_WIDTH + MIN_GAP_X) + 50,
                      y: 50,
                    },
                  };
                }
              }
            });
          } else {
            // Widgets in a row at top
            widgetNodes.forEach((node, i) => {
              const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
              if (nodeIndex >= 0) {
                newNodes[nodeIndex] = {
                  ...newNodes[nodeIndex],
                  position: { x: i * (WIDGET_WIDTH + MIN_GAP_X) + 50, y: 50 },
                };
              }
            });
          }

          // Forms
          if (settings.formsBelow) {
            // Position forms below their linked tables
            formNodes.forEach((node, i) => {
              const formName = (node.data as any).name || '';
              const parentTableId = parseInt(formName.replace('form_', ''));
              const linkedTable = sortedTables.find(
                (t) => (t.data as any).tableId === parentTableId
              );
              const nodeIndex = newNodes.findIndex((n) => n.id === node.id);

              if (nodeIndex >= 0) {
                if (linkedTable) {
                  const tableNodeIndex = newNodes.findIndex((n) => n.id === linkedTable.id);
                  const tableHeight = getCardHeight(linkedTable);
                  newNodes[nodeIndex] = {
                    ...newNodes[nodeIndex],
                    position: {
                      x: newNodes[tableNodeIndex].position.x + 20,
                      y: newNodes[tableNodeIndex].position.y + tableHeight + FORM_GAP,
                    },
                  };
                } else {
                  // Unlinked forms at bottom
                  newNodes[nodeIndex] = {
                    ...newNodes[nodeIndex],
                    position: {
                      x: i * SPACING_X + 50,
                      y: tableMaxY + FORM_GAP,
                    },
                  };
                }
              }
            });
          } else {
            // Forms in a row at bottom
            formNodes.forEach((node, i) => {
              const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
              if (nodeIndex >= 0) {
                newNodes[nodeIndex] = {
                  ...newNodes[nodeIndex],
                  position: { x: i * SPACING_X + 50, y: tableMaxY + FORM_GAP },
                };
              }
            });
          }
        } else {
          // No hierarchy - just put widgets and forms in rows
          widgetNodes.forEach((node, i) => {
            const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
            if (nodeIndex >= 0) {
              newNodes[nodeIndex] = {
                ...newNodes[nodeIndex],
                position: {
                  x: i * (WIDGET_WIDTH + MIN_GAP_X) + 50,
                  y: -WIDGET_HEIGHT - WIDGET_GAP,
                },
              };
            }
          });

          formNodes.forEach((node, i) => {
            const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
            if (nodeIndex >= 0) {
              newNodes[nodeIndex] = {
                ...newNodes[nodeIndex],
                position: { x: i * SPACING_X + 50, y: tableMaxY + FORM_GAP },
              };
            }
          });
        }
      } else {
        // No grid - simple list layout
        sortedTables.forEach((node, i) => {
          const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
          if (nodeIndex >= 0) {
            newNodes[nodeIndex] = {
              ...newNodes[nodeIndex],
              position: { x: 50, y: i * SPACING_Y + 50 },
            };
          }
        });

        widgetNodes.forEach((node, i) => {
          const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
          if (nodeIndex >= 0) {
            newNodes[nodeIndex] = {
              ...newNodes[nodeIndex],
              position: { x: SPACING_X + 50, y: i * (WIDGET_HEIGHT + MIN_GAP_Y) + 50 },
            };
          }
        });

        formNodes.forEach((node, i) => {
          const nodeIndex = newNodes.findIndex((n) => n.id === node.id);
          if (nodeIndex >= 0) {
            newNodes[nodeIndex] = {
              ...newNodes[nodeIndex],
              position: { x: SPACING_X * 2 + 50, y: i * (FORM_HEIGHT + MIN_GAP_Y) + 50 },
            };
          }
        });
      }

      setLocalNodes(newNodes);
      setNodes(newNodes as any);
      saveLayout();

      setTimeout(() => {
        reactFlowInstance.fitView({ duration: 300, padding: 0.2 });
      }, 100);
    },
    [nodes, storeEdges, setLocalNodes, setNodes, saveLayout, reactFlowInstance]
  );
};

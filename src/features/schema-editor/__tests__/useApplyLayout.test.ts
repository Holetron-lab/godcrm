import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import { useApplyLayout } from '../components/useApplyLayout';
import type { LayoutSettings } from '../components/modals/LayoutSettingsModal';

const settings: LayoutSettings = {
  gridEnabled: true, gridCols: 5, gridRows: 5, gridDirection: 'horizontal',
  hierarchyEnabled: false, widgetsAbove: true, formsBelow: true,
  relationsEnabled: false, connectedLeft: true, isolatedRight: true,
  projectGroupEnabled: false, projectGap: 200, gapX: 100, gapY: 80,
};

const tableNode = (tableId: number, x: number, y: number, isPinned = false): Node => ({
  id: `table-${tableId}`, type: 'tableNode', position: { x, y },
  data: { tableId, name: `t${tableId}`, columns: [], isPinned },
});

describe('useApplyLayout', () => {
  it('keeps pinned tables where they are and gives their grid slot to the next table', () => {
    const nodes = [tableNode(1, 5000, 7000, true), tableNode(2, 900, 900), tableNode(3, 1200, 1200)];
    const setLocalNodes = vi.fn();
    const setNodes = vi.fn();
    const saveLayout = vi.fn();
    const reactFlowInstance = { fitView: vi.fn() } as unknown as ReactFlowInstance;

    const { result } = renderHook(() =>
      useApplyLayout({ nodes, storeEdges: [], setLocalNodes, setNodes, saveLayout, reactFlowInstance })
    );
    result.current(settings);

    const laidOut = setLocalNodes.mock.calls[0][0] as Node[];
    const byId = Object.fromEntries(laidOut.map((n) => [n.id, n.position]));
    expect(byId['table-1']).toEqual({ x: 5000, y: 7000 });
    // Movable tables fill the grid from the first slot: pinned node took none.
    expect(byId['table-2']).toEqual({ x: 50, y: 50 });
    expect(byId['table-3']).toEqual({ x: 50 + 440, y: 50 });
    expect(setNodes).toHaveBeenCalledWith(laidOut);
    expect(saveLayout).toHaveBeenCalledTimes(1);
  });
});

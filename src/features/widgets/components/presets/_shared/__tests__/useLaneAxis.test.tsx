import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLaneAxis, type LaneAxisColumn, type RelationDataMap } from '../useLaneAxis';

describe('useLaneAxis', () => {
  describe('select column', () => {
    const column: LaneAxisColumn = {
      name: 'status',
      type: 'select',
      config: {
        options: [
          { value: 'todo', label: 'To do', color: '#aaa' },
          { value: 'doing', label: 'In progress', color: '#bbb' },
          { value: 'done', label: 'Done', color: '#ccc' },
        ],
      },
    };
    const rows = [
      { id: 1, data: { status: 'todo' } },
      { id: 2, data: { status: 'doing' } },
      { id: 3, data: { status: 'todo' } },
      { id: 4, data: { status: 'unknown' } }, // unmatched
    ];

    it('seeds lanes from option order and buckets matching rows', () => {
      const { result } = renderHook(() =>
        useLaneAxis({ groupByColumn: column, rows, unmatchedRowMode: 'drop' }),
      );
      expect(result.current.kind).toBe('select');
      expect(result.current.lanes.map((l) => l.key)).toEqual(['todo', 'doing', 'done']);
      expect(result.current.lanes[0].label).toBe('To do');
      expect(result.current.rowsByLane.get('todo')?.map((r) => r.id)).toEqual([1, 3]);
      expect(result.current.rowsByLane.get('doing')?.map((r) => r.id)).toEqual([2]);
      expect(result.current.rowsByLane.has('unknown')).toBe(false);
    });

    it('routes unmatched rows to Unassigned by default', () => {
      const { result } = renderHook(() => useLaneAxis({ groupByColumn: column, rows }));
      const unassigned = result.current.lanes.find((l) => l.label === 'Unassigned');
      expect(unassigned).toBeDefined();
      expect(result.current.rowsByLane.get(unassigned!.key)?.map((r) => r.id)).toEqual([4]);
    });
  });

  describe('multi-select column', () => {
    const column: LaneAxisColumn = {
      name: 'tags',
      type: 'multi-select',
      config: {
        options: [
          { value: 'red', label: 'Red' },
          { value: 'green', label: 'Green' },
        ],
      },
    };
    const rows = [
      { id: 1, data: { tags: ['red', 'green'] } },
      { id: 2, data: { tags: ['red'] } },
      { id: 3, data: { tags: [] } },
    ];

    it('places multi-valued rows into every matching lane', () => {
      const { result } = renderHook(() =>
        useLaneAxis({ groupByColumn: column, rows, unmatchedRowMode: 'drop' }),
      );
      expect(result.current.kind).toBe('multi-select');
      expect(result.current.rowsByLane.get('red')?.map((r) => r.id)).toEqual([1, 2]);
      expect(result.current.rowsByLane.get('green')?.map((r) => r.id)).toEqual([1]);
    });
  });

  describe('relation column', () => {
    const column: LaneAxisColumn = {
      name: 'assignee',
      type: 'relation',
      config: {
        relation: { enabled: true, tableId: 7, labelColumn: 'name' },
      },
    };
    const relationData: RelationDataMap = new Map([
      [
        '7',
        new Map([
          ['100', { label: 'Alice', color: '#a0', order: 1 }],
          ['200', { label: 'Bob', color: '#b0', order: 0 }],
        ]),
      ],
    ]);
    const rows = [
      { id: 1, data: { assignee: '100' } },
      { id: 2, data: { assignee: '200' } },
      { id: 3, data: { assignee: null } },
    ];

    it('uses related-row title as lane label and respects relation order', () => {
      const { result } = renderHook(() =>
        useLaneAxis({ groupByColumn: column, rows, relationData }),
      );
      expect(result.current.kind).toBe('relation');
      // Bob has order=0, Alice order=1 → Bob first.
      expect(result.current.lanes.map((l) => l.label).slice(0, 2)).toEqual(['Bob', 'Alice']);
      expect(result.current.rowsByLane.get('100')?.map((r) => r.id)).toEqual([1]);
      expect(result.current.rowsByLane.get('200')?.map((r) => r.id)).toEqual([2]);
    });

    it('routes null-relation rows to Unassigned lane', () => {
      const { result } = renderHook(() =>
        useLaneAxis({ groupByColumn: column, rows, relationData, unassignedLabel: 'Без назначения' }),
      );
      const unassigned = result.current.lanes.find((l) => l.label === 'Без назначения');
      expect(unassigned).toBeDefined();
      expect(result.current.rowsByLane.get(unassigned!.key)?.map((r) => r.id)).toEqual([3]);
    });

    it('falls back to relatedTableId when relation.tableId missing', () => {
      const altColumn: LaneAxisColumn = {
        name: 'assignee',
        config: { relatedTableId: 7 },
      };
      const { result } = renderHook(() =>
        useLaneAxis({ groupByColumn: altColumn, rows: [rows[0]], relationData }),
      );
      expect(result.current.kind).toBe('relation');
      expect(result.current.lanes.find((l) => l.key === '100')?.label).toBe('Alice');
    });
  });

  describe('text column', () => {
    const rows = [
      { id: 1, data: { phase: 'A' } },
      { id: 2, data: { phase: 'C' } },
      { id: 3, data: { phase: 'B' } },
      { id: 4, data: { phase: 'A' } },
    ];

    it('derives lanes from observed values, sorted alphabetically', () => {
      const { result } = renderHook(() =>
        useLaneAxis({
          groupByColumn: { name: 'phase', type: 'text' },
          rows,
        }),
      );
      expect(result.current.kind).toBe('text');
      expect(result.current.lanes.map((l) => l.label)).toEqual(['A', 'B', 'C']);
      expect(result.current.rowsByLane.get('A')?.map((r) => r.id)).toEqual([1, 4]);
    });
  });

  describe('laneOrderColumn', () => {
    const column: LaneAxisColumn = {
      name: 'status',
      type: 'select',
      config: {
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ],
      },
    };
    const rows = [
      { id: 1, data: { status: 'a', rank: 30 } },
      { id: 2, data: { status: 'b', rank: 10 } },
      { id: 3, data: { status: 'c', rank: 20 } },
    ];

    it('reorders lanes by min numeric value of laneOrderColumn', () => {
      const { result } = renderHook(() =>
        useLaneAxis({
          groupByColumn: column,
          rows,
          laneOrderColumn: 'rank',
        }),
      );
      expect(result.current.lanes.map((l) => l.key)).toEqual(['b', 'c', 'a']);
      result.current.lanes.forEach((lane, i) => expect(lane.order).toBe(i));
    });
  });

  describe('column resolution by name', () => {
    it('looks up the column by name when groupByColumn is a string', () => {
      const columnsInfo: LaneAxisColumn[] = [
        { name: 'phase', type: 'text' },
        {
          name: 'status',
          type: 'select',
          config: { options: [{ value: 'x', label: 'X' }] },
        },
      ];
      const { result } = renderHook(() =>
        useLaneAxis({
          groupByColumn: 'status',
          columnsInfo,
          rows: [{ id: 1, data: { status: 'x' } }],
        }),
      );
      expect(result.current.kind).toBe('select');
      expect(result.current.lanes[0].key).toBe('x');
    });
  });

  describe('null/empty inputs', () => {
    it('returns a single Unassigned lane when no groupBy is given', () => {
      const { result } = renderHook(() =>
        useLaneAxis({
          groupByColumn: null,
          rows: [
            { id: 1, data: {} },
            { id: 2, data: {} },
          ],
        }),
      );
      expect(result.current.kind).toBe('unknown');
      expect(result.current.lanes).toHaveLength(1);
      expect(result.current.rowsByLane.get(result.current.lanes[0].key)).toHaveLength(2);
    });

    it('handles empty rows array', () => {
      const { result } = renderHook(() =>
        useLaneAxis({
          groupByColumn: { name: 'status', type: 'select', config: { options: [{ value: 'a', label: 'A' }] } },
          rows: [],
        }),
      );
      expect(result.current.lanes.map((l) => l.key)).toEqual(['a']);
      expect(result.current.rowsByLane.size).toBe(0);
    });
  });
});

/**
 * @file TableSummaryBar.test.tsx
 * @description Tests for TableSummaryBar component with column.config.summary support
 * @created 2025-01-14
 * @context ADR-026 - Formulas, Variables, Aggregations & Charts
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableSummaryBar } from '../TableSummaryBar';
import type { ColumnModel, RowModel } from '../../../types/table.types';

// Mock table from TanStack
const createMockTable = (columns: ColumnModel[]) => ({
  getHeaderGroups: () => [{
    id: 'header-group-1',
    headers: columns.map((col, i) => ({
      id: col.id,
      column: {
        id: col.id,
        getSize: () => 150,
      },
      getSize: () => 150,
      isPlaceholder: false,
      placeholderId: undefined,
      depth: 0,
      subHeaders: [],
      colSpan: 1,
      rowSpan: 1,
      getLeafHeaders: () => [],
      getContext: () => ({}),
      getResizeHandler: () => () => {},
    })),
  }],
});

describe('TableSummaryBar', () => {
  describe('Number columns with config.summary', () => {
    const numberColumn: ColumnModel = {
      id: 'col-1',
      name: 'Amount',
      type: 'number',
      tableId: 'table-1',
      position: 0,
      config: {
        summary: {
          sum: true,
          avg: true,
          min: false,
          max: false,
        },
      },
    };

    const rows: RowModel[] = [
      { id: '1', tableId: 'table-1', data: { Amount: 100 }, position: 0 },
      { id: '2', tableId: 'table-1', data: { Amount: 200 }, position: 1 },
      { id: '3', tableId: 'table-1', data: { Amount: 300 }, position: 2 },
    ];

    it('renders sum when sum=true', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[numberColumn]}
          table={createMockTable([numberColumn]) as any}
          hasActions={false}
        />
      );
      
      // Sum of 100+200+300 = 600
      expect(screen.getByText('600')).toBeInTheDocument();
    });

    it('renders avg when avg=true', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[numberColumn]}
          table={createMockTable([numberColumn]) as any}
          hasActions={false}
        />
      );
      
      // Avg of 600/3 = 200
      expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('does not render min/max when they are false', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[numberColumn]}
          table={createMockTable([numberColumn]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.queryByText(/min:/)).not.toBeInTheDocument();
      expect(screen.queryByText(/max:/)).not.toBeInTheDocument();
    });

    it('renders min when min=true', () => {
      const columnWithMin: ColumnModel = {
        ...numberColumn,
        config: {
          summary: { sum: false, avg: false, min: true, max: false },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[columnWithMin]}
          table={createMockTable([columnWithMin]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.getByText('min: 100')).toBeInTheDocument();
    });

    it('renders max when max=true', () => {
      const columnWithMax: ColumnModel = {
        ...numberColumn,
        config: {
          summary: { sum: false, avg: false, min: false, max: true },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[columnWithMax]}
          table={createMockTable([columnWithMax]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.getByText('max: 300')).toBeInTheDocument();
    });

    it('shows default sum+avg when no config', () => {
      const columnNoConfig: ColumnModel = {
        id: 'col-1',
        name: 'Amount',
        type: 'number',
        tableId: 'table-1',
        position: 0,
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[columnNoConfig]}
          table={createMockTable([columnNoConfig]) as any}
          hasActions={false}
        />
      );
      
      // Default: shows both sum and avg
      expect(screen.getByText('Σ')).toBeInTheDocument();
      expect(screen.getByText('avg:')).toBeInTheDocument();
    });
  });

  describe('Checkbox columns with config.summary', () => {
    const checkboxColumn: ColumnModel = {
      id: 'col-2',
      name: 'Done',
      type: 'checkbox',
      tableId: 'table-1',
      position: 0,
      config: {
        summary: {
          checked: true,
          unchecked: true,
          percentChecked: true,
        },
      },
    };

    const rows: RowModel[] = [
      { id: '1', tableId: 'table-1', data: { Done: true }, position: 0 },
      { id: '2', tableId: 'table-1', data: { Done: true }, position: 1 },
      { id: '3', tableId: 'table-1', data: { Done: false }, position: 2 },
      { id: '4', tableId: 'table-1', data: { Done: false }, position: 3 },
    ];

    it('renders checked count', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[checkboxColumn]}
          table={createMockTable([checkboxColumn]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.getByText('✓ 2')).toBeInTheDocument();
    });

    it('renders unchecked count', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[checkboxColumn]}
          table={createMockTable([checkboxColumn]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.getByText('✗ 2')).toBeInTheDocument();
    });

    it('renders percentChecked when enabled', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[checkboxColumn]}
          table={createMockTable([checkboxColumn]) as any}
          hasActions={false}
        />
      );
      
      // 2 of 4 checked = 50%
      expect(screen.getByText('50%')).toBeInTheDocument();
    });

    it('hides unchecked when unchecked=false', () => {
      const columnHideUnchecked: ColumnModel = {
        ...checkboxColumn,
        config: {
          summary: { checked: true, unchecked: false, percentChecked: false },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[columnHideUnchecked]}
          table={createMockTable([columnHideUnchecked]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.getByText('✓ 2')).toBeInTheDocument();
      expect(screen.queryByText('✗ 2')).not.toBeInTheDocument();
    });
  });

  describe('Text columns with config.summary', () => {
    const textColumn: ColumnModel = {
      id: 'col-3',
      name: 'Name',
      type: 'text',
      tableId: 'table-1',
      position: 0,
      config: {
        summary: {
          countUnique: true,
          countFilled: true,
          countEmpty: true,
        },
      },
    };

    const rows: RowModel[] = [
      { id: '1', tableId: 'table-1', data: { Name: 'Alice' }, position: 0 },
      { id: '2', tableId: 'table-1', data: { Name: 'Bob' }, position: 1 },
      { id: '3', tableId: 'table-1', data: { Name: 'Alice' }, position: 2 },
      { id: '4', tableId: 'table-1', data: { Name: null }, position: 3 },
    ];

    it('renders unique count', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[textColumn]}
          table={createMockTable([textColumn]) as any}
          hasActions={false}
        />
      );
      
      // Alice, Bob = 2 unique
      expect(screen.getByText('2 уник.')).toBeInTheDocument();
    });

    it('renders filled count', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[textColumn]}
          table={createMockTable([textColumn]) as any}
          hasActions={false}
        />
      );
      
      // 3 filled
      expect(screen.getByText('3 заполн.')).toBeInTheDocument();
    });

    it('renders empty count', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[textColumn]}
          table={createMockTable([textColumn]) as any}
          hasActions={false}
        />
      );
      
      // 1 empty
      expect(screen.getByText('1 пуст.')).toBeInTheDocument();
    });
  });

  describe('Date columns with config.summary', () => {
    const dateColumn: ColumnModel = {
      id: 'col-4',
      name: 'CreatedAt',
      type: 'date',
      tableId: 'table-1',
      position: 0,
      config: {
        summary: {
          dateRange: true,
        },
      },
    };

    const rows: RowModel[] = [
      { id: '1', tableId: 'table-1', data: { CreatedAt: '2024-01-01' }, position: 0 },
      { id: '2', tableId: 'table-1', data: { CreatedAt: '2024-06-15' }, position: 1 },
      { id: '3', tableId: 'table-1', data: { CreatedAt: '2024-12-31' }, position: 2 },
    ];

    it('renders date range when dateRange=true', () => {
      render(
        <TableSummaryBar
          rows={rows}
          columns={[dateColumn]}
          table={createMockTable([dateColumn]) as any}
          hasActions={false}
        />
      );
      
      // Should show arrow between dates
      expect(screen.getByText('→')).toBeInTheDocument();
    });

    it('renders earliest only when earliest=true and dateRange=false', () => {
      const columnEarliest: ColumnModel = {
        ...dateColumn,
        config: {
          summary: { dateRange: false, earliest: true, latest: false },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[columnEarliest]}
          table={createMockTable([columnEarliest]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.getByText(/от:/)).toBeInTheDocument();
      expect(screen.queryByText(/до:/)).not.toBeInTheDocument();
    });

    it('renders latest only when latest=true and dateRange=false', () => {
      const columnLatest: ColumnModel = {
        ...dateColumn,
        config: {
          summary: { dateRange: false, earliest: false, latest: true },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[columnLatest]}
          table={createMockTable([columnLatest]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.queryByText(/от:/)).not.toBeInTheDocument();
      expect(screen.getByText(/до:/)).toBeInTheDocument();
    });
  });

  describe('Empty data handling', () => {
    it('returns null when no rows', () => {
      const column: ColumnModel = {
        id: 'col-1',
        name: 'Test',
        type: 'text',
        tableId: 'table-1',
        position: 0,
      };

      const { container } = render(
        <TableSummaryBar
          rows={[]}
          columns={[column]}
          table={createMockTable([column]) as any}
          hasActions={false}
        />
      );
      
      expect(container.firstChild).toBeNull();
    });

    it('shows dash for empty number column', () => {
      const column: ColumnModel = {
        id: 'col-1',
        name: 'Amount',
        type: 'number',
        tableId: 'table-1',
        position: 0,
      };

      const rows: RowModel[] = [
        { id: '1', tableId: 'table-1', data: { Amount: null }, position: 0 },
        { id: '2', tableId: 'table-1', data: { Amount: undefined }, position: 1 },
      ];

      render(
        <TableSummaryBar
          rows={rows}
          columns={[column]}
          table={createMockTable([column]) as any}
          hasActions={false}
        />
      );
      
      expect(screen.getByText('—')).toBeInTheDocument();
    });
  });

  describe('Multiple columns', () => {
    it('renders summary for each column', () => {
      const columns: ColumnModel[] = [
        {
          id: 'col-1',
          name: 'Amount',
          type: 'number',
          tableId: 'table-1',
          position: 0,
          config: { summary: { sum: true, avg: false } },
        },
        {
          id: 'col-2',
          name: 'Name',
          type: 'text',
          tableId: 'table-1',
          position: 1,
          config: { summary: { countUnique: true } },
        },
      ];

      const rows: RowModel[] = [
        { id: '1', tableId: 'table-1', data: { Amount: 100, Name: 'Alice' }, position: 0 },
        { id: '2', tableId: 'table-1', data: { Amount: 200, Name: 'Bob' }, position: 1 },
      ];

      render(
        <TableSummaryBar
          rows={rows}
          columns={columns}
          table={createMockTable(columns) as any}
          hasActions={false}
        />
      );
      
      // Number sum
      expect(screen.getByText('300')).toBeInTheDocument();
      // Text unique count
      expect(screen.getByText('2 уник.')).toBeInTheDocument();
    });
  });

  // ADR-026: Tests for linked Variables
  describe('Linked Variables (ADR-026)', () => {
    const rows: RowModel[] = [
      { id: '1', tableId: 'table-1', data: { Amount: 100 }, position: 0 },
      { id: '2', tableId: 'table-1', data: { Amount: 200 }, position: 1 },
    ];

    it('displays Variable badge when sum is linked', () => {
      const column: ColumnModel = {
        id: 'col-1',
        name: 'Amount',
        type: 'number',
        tableId: 'table-1',
        position: 0,
        config: {
          summary: {
            sum: true,
            avg: false,
            linkedVariables: {
              sum: { variableId: 1, variableName: '$revenue_sum' },
            },
          },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[column]}
          table={createMockTable([column]) as any}
          hasActions={false}
          variables={{ '$revenue_sum': 500 }}
        />
      );

      // Should show variable name
      expect(screen.getByText('$revenue_sum')).toBeInTheDocument();
      // Should show value from variables prop
      expect(screen.getByText('500')).toBeInTheDocument();
    });

    it('uses local calculation as fallback when variable value is null', () => {
      const column: ColumnModel = {
        id: 'col-1',
        name: 'Amount',
        type: 'number',
        tableId: 'table-1',
        position: 0,
        config: {
          summary: {
            sum: true,
            avg: false,
            linkedVariables: {
              sum: { variableId: 1, variableName: '$revenue_sum' },
            },
          },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[column]}
          table={createMockTable([column]) as any}
          hasActions={false}
          variables={{ '$revenue_sum': null }}
        />
      );

      // Should show variable name
      expect(screen.getByText('$revenue_sum')).toBeInTheDocument();
      // Should fallback to local calculation (100 + 200 = 300)
      expect(screen.getByText('300')).toBeInTheDocument();
    });

    it('shows both linked and local aggregations', () => {
      const column: ColumnModel = {
        id: 'col-1',
        name: 'Amount',
        type: 'number',
        tableId: 'table-1',
        position: 0,
        config: {
          summary: {
            sum: true,  // linked
            avg: true,  // local
            linkedVariables: {
              sum: { variableId: 1, variableName: '$sum' },
              // avg is not linked
            },
          },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[column]}
          table={createMockTable([column]) as any}
          hasActions={false}
          variables={{ '$sum': 1000 }}
        />
      );

      // Sum should be from variable
      expect(screen.getByText('$sum')).toBeInTheDocument();
      expect(screen.getByText(/1[\s ]?000/)).toBeInTheDocument(); // 1000 with locale
      // Avg should be local
      expect(screen.getByText('avg:')).toBeInTheDocument();
      expect(screen.getByText('150')).toBeInTheDocument(); // (100+200)/2
    });

    it('displays local sum when not linked', () => {
      const column: ColumnModel = {
        id: 'col-1',
        name: 'Amount',
        type: 'number',
        tableId: 'table-1',
        position: 0,
        config: {
          summary: {
            sum: true,
            avg: false,
            // No linkedVariables
          },
        },
      };

      render(
        <TableSummaryBar
          rows={rows}
          columns={[column]}
          table={createMockTable([column]) as any}
          hasActions={false}
        />
      );

      // Should show Σ symbol (local calculation)
      expect(screen.getByText('Σ')).toBeInTheDocument();
      expect(screen.getByText('300')).toBeInTheDocument();
    });
  });
});

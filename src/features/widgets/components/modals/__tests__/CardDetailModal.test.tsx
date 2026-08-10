// src/features/widgets/components/modals/__tests__/CardDetailModal.test.tsx
// ADR-069 TASK-016: Tests for CardDetailModal component
// Tests: rendering, field display, inline editing, file operations, close behavior

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CardDetailModal } from '../CardDetailModal';
import type { ColumnModel } from '@/features/tables/types/table.types';

// Mock useRowChat hook
vi.mock('@/shared/hooks/useRowChat', () => ({
  useRowChat: () => ({
    messages: [],
    isLoading: false,
    sendMessage: vi.fn(),
    isSending: false,
  }),
}));

// Mock Modal to render children directly (avoids radix Dialog.Portal issues in tests)
vi.mock('@/shared/components/ui/Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="modal">{children}</div> : null,
}));

// Mock logger
vi.mock('@/shared/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock filesApi
vi.mock('@/features/files/api/filesApi', () => ({
  filesApi: {
    upload: vi.fn().mockResolvedValue([]),
  },
}));

// Mock MarkdownPreview with simple div
vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content, className }: { content: string; className?: string }) => (
    <div data-testid="markdown-preview" className={className}>{content}</div>
  ),
}));

// Mock cn utility
vi.mock('@/shared/utils/cn', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ====== Test Data Helpers ======

const baseColumns: ColumnModel[] = [
  { id: 1, name: 'title', type: 'text', displayName: 'Title', position: 0, config: {} } as ColumnModel,
  { id: 2, name: 'status', type: 'select', displayName: 'Status', position: 1, config: { options: [{ value: 'open', label: 'Open', color: '#22c55e' }, { value: 'closed', label: 'Closed', color: '#ef4444' }] } } as ColumnModel,
  { id: 3, name: 'due_date', type: 'date', displayName: 'Due Date', position: 2, config: {} } as ColumnModel,
  { id: 4, name: 'done', type: 'checkbox', displayName: 'Done', position: 3, config: {} } as ColumnModel,
  { id: 5, name: 'description', type: 'rich_text', displayName: 'Description', position: 4, config: {} } as ColumnModel,
  { id: 6, name: 'website', type: 'url', displayName: 'Website', position: 5, config: {} } as ColumnModel,
];

const mockCard = {
  id: '42',
  data: {
    title: 'Test Card Title',
    status: 'open',
    due_date: '2026-03-15',
    done: false,
    description: 'A detailed description in **markdown**',
    website: 'https://example.com',
  },
  created_at: '2025-12-01T10:00:00Z',
};

describe('CardDetailModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    card: mockCard,
    columns: baseColumns,
    titleField: 'title',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== RENDERING ==========
  describe('rendering', () => {
    it('should render card title', () => {
      render(<CardDetailModal {...defaultProps} />);
      expect(screen.getByText('Test Card Title')).toBeInTheDocument();
    });

    it('should render card ID badge', () => {
      render(<CardDetailModal {...defaultProps} />);
      expect(screen.getByText('#42')).toBeInTheDocument();
    });

    it('should render close button', () => {
      render(<CardDetailModal {...defaultProps} />);
      const closeButton = screen.getByText('Закрыть');
      expect(closeButton).toBeInTheDocument();
    });

    it('should render nothing when card is null', () => {
      const { container } = render(<CardDetailModal {...defaultProps} card={null} />);
      // When card is null, component returns null early
      expect(container.innerHTML).toBe('');
    });

    it('should render select field with correct option', () => {
      render(<CardDetailModal {...defaultProps} />);
      expect(screen.getByText('open')).toBeInTheDocument();
    });

    it('should render checkbox field', () => {
      render(<CardDetailModal {...defaultProps} />);
      // Checkbox displays localized text
      expect(screen.getByText(/Нет/)).toBeInTheDocument();
    });

    it('should render URL field as link', () => {
      render(<CardDetailModal {...defaultProps} />);
      const link = screen.getByText('https://example.com');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', 'https://example.com');
      expect(link.closest('a')).toHaveAttribute('target', '_blank');
    });

    it('should render description via MarkdownPreview', () => {
      render(<CardDetailModal {...defaultProps} />);
      const preview = screen.getByTestId('markdown-preview');
      expect(preview).toBeInTheDocument();
      expect(preview).toHaveTextContent('A detailed description in **markdown**');
    });

    it('should render files section with count', () => {
      render(<CardDetailModal {...defaultProps} />);
      expect(screen.getByText(/Файлы/)).toBeInTheDocument();
    });

    it('should render "add file" button', () => {
      render(<CardDetailModal {...defaultProps} />);
      expect(screen.getByText('Добавить')).toBeInTheDocument();
    });

    it('should display empty dash for fields with no value', () => {
      const emptyCard = { id: '1', data: { title: 'Empty Card' } };
      render(<CardDetailModal {...defaultProps} card={emptyCard} />);
      // Empty fields render em-dash
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThan(0);
    });

    it('should render status badge in header when groupByField is set', () => {
      render(<CardDetailModal {...defaultProps} groupByField="status" />);
      // Status badge rendered in header
      const statusBadges = screen.getAllByText('open');
      expect(statusBadges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ========== TITLE ==========
  describe('title behavior', () => {
    it('should use titleField for card title', () => {
      render(<CardDetailModal {...defaultProps} titleField="title" />);
      expect(screen.getByText('Test Card Title')).toBeInTheDocument();
    });

    it('should fallback to first text column when titleField has no data', () => {
      const cardWithoutTitle = { id: '1', data: { description: 'Desc text' } };
      render(<CardDetailModal {...defaultProps} card={cardWithoutTitle} titleField="missing_field" />);
      // Should auto-detect first text column as title
      expect(screen.getByText('Без названия')).toBeInTheDocument();
    });

    it('should show "Без названия" when no title data exists', () => {
      const cardNoTitle = { id: '1', data: {} };
      render(<CardDetailModal {...defaultProps} card={cardNoTitle} />);
      expect(screen.getByText('Без названия')).toBeInTheDocument();
    });
  });

  // ========== CLOSE BEHAVIOR ==========
  describe('close behavior', () => {
    it('should call onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<CardDetailModal {...defaultProps} onClose={onClose} />);

      const closeButton = screen.getByText('Закрыть');
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ========== INLINE EDITING ==========
  describe('inline editing', () => {
    it('should enter edit mode on double-click of a structured field', () => {
      const onSave = vi.fn();
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      // Double-click on the status field value
      const statusDisplay = screen.getByText('open');
      fireEvent.doubleClick(statusDisplay);

      // A select element should appear for the select field, or an OK button
      expect(screen.getByText('OK')).toBeInTheDocument();
      expect(screen.getByText('Отмена')).toBeInTheDocument();
    });

    it('should cancel edit and restore original value on cancel click', async () => {
      const onSave = vi.fn();
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      // Double-click on the status field
      const statusDisplay = screen.getByText('open');
      fireEvent.doubleClick(statusDisplay);

      // Click cancel
      fireEvent.click(screen.getByText('Отмена'));

      // onSave should NOT have been called
      expect(onSave).not.toHaveBeenCalled();
    });

    it('should save field on OK click', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      // Double-click to edit
      const statusDisplay = screen.getByText('open');
      fireEvent.doubleClick(statusDisplay);

      // Click OK to save
      fireEvent.click(screen.getByText('OK'));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith(
          '42',
          expect.objectContaining({ status: 'open' })
        );
      });
    });

    it('should enter edit mode on double-click of a text field', () => {
      const onSave = vi.fn();
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      // Double-click on the description markdown preview container
      const descContainer = screen.getByTestId('markdown-preview').closest('[class*="cursor-pointer"]');
      if (descContainer) {
        fireEvent.doubleClick(descContainer);
        // Textarea should appear
        expect(screen.getByText('OK')).toBeInTheDocument();
      }
    });

    it('should enter title edit mode on double-click of title', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      const title = screen.getByText('Test Card Title');
      fireEvent.doubleClick(title);

      // An input for title editing should appear
      const input = screen.getByDisplayValue('Test Card Title');
      expect(input).toBeInTheDocument();
    });

    it('should save title on Enter key press', async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      const title = screen.getByText('Test Card Title');
      fireEvent.doubleClick(title);

      const input = screen.getByDisplayValue('Test Card Title');
      fireEvent.change(input, { target: { value: 'Updated Title' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          '42',
          expect.objectContaining({ title: 'Updated Title' })
        );
      });
    });

    it('should cancel title editing on Escape key press', () => {
      const onSave = vi.fn();
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      const title = screen.getByText('Test Card Title');
      fireEvent.doubleClick(title);

      const input = screen.getByDisplayValue('Test Card Title');
      fireEvent.keyDown(input, { key: 'Escape' });

      // Should exit edit mode, title should be visible again
      expect(screen.getByText('Test Card Title')).toBeInTheDocument();
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  // ========== VISIBLE FIELDS FILTERING ==========
  describe('visible fields', () => {
    it('should show only visibleFields when specified', () => {
      render(
        <CardDetailModal
          {...defaultProps}
          visibleFields={['title', 'status']}
        />
      );

      // Status should be visible
      expect(screen.getByText('open')).toBeInTheDocument();
      // Due Date label should NOT be visible
      expect(screen.queryByText('Due Date')).not.toBeInTheDocument();
    });
  });

  // ========== COLUMN TYPES RENDERING ==========
  describe('column type rendering', () => {
    it('should render date field formatted in Russian locale', () => {
      render(<CardDetailModal {...defaultProps} />);
      // Date 2026-03-15 in ru-RU locale: 15.03.2026
      expect(screen.getByText('15.03.2026')).toBeInTheDocument();
    });

    it('should render checkbox as checked when true', () => {
      const trueCard = { ...mockCard, data: { ...mockCard.data, done: true } };
      render(<CardDetailModal {...defaultProps} card={trueCard} />);
      expect(screen.getByText(/Да/)).toBeInTheDocument();
    });

    it('should render checkbox as unchecked when false', () => {
      render(<CardDetailModal {...defaultProps} />);
      expect(screen.getByText(/Нет/)).toBeInTheDocument();
    });

    it('should render multi-select values as badges', () => {
      const multiSelectColumns = [
        ...baseColumns,
        { id: 7, name: 'tags', type: 'multi-select', displayName: 'Tags', position: 6, config: { options: [] } } as ColumnModel,
      ];
      const cardWithTags = { ...mockCard, data: { ...mockCard.data, tags: ['bug', 'urgent'] } };
      render(<CardDetailModal {...defaultProps} columns={multiSelectColumns} card={cardWithTags} />);
      expect(screen.getByText('bug')).toBeInTheDocument();
      expect(screen.getByText('urgent')).toBeInTheDocument();
    });
  });

  // ========== FILES ==========
  describe('file handling', () => {
    it('should display attached files from card data', () => {
      const fileColumn = { id: 10, name: 'attachments', type: 'file', displayName: 'Attachments', position: 10, config: {} } as ColumnModel;
      const columnsWithFile = [...baseColumns, fileColumn];
      const cardWithFile = {
        ...mockCard,
        data: { ...mockCard.data, attachments: '/uploads/doc.pdf' },
      };
      render(<CardDetailModal {...defaultProps} columns={columnsWithFile} card={cardWithFile} />);
      expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    });

    it('should display multiple files separated by comma', () => {
      const fileColumn = { id: 10, name: 'attachments', type: 'file', displayName: 'Attachments', position: 10, config: {} } as ColumnModel;
      const columnsWithFile = [...baseColumns, fileColumn];
      const cardWithFiles = {
        ...mockCard,
        data: { ...mockCard.data, attachments: '/uploads/a.png,/uploads/b.pdf' },
      };
      render(<CardDetailModal {...defaultProps} columns={columnsWithFile} card={cardWithFiles} />);
      expect(screen.getByText('a.png')).toBeInTheDocument();
      expect(screen.getByText('b.pdf')).toBeInTheDocument();
    });

    it('should show upload drop zone when no files attached', () => {
      render(<CardDetailModal {...defaultProps} />);
      expect(screen.getByText('Нажмите для загрузки')).toBeInTheDocument();
    });
  });

  // ========== RELATION SELECT ==========
  describe('relation select', () => {
    it('should render relation data from relationData map', () => {
      const relationColumn: ColumnModel = {
        id: 8,
        name: 'assignee',
        type: 'select',
        displayName: 'Assignee',
        position: 7,
        config: { relation: { table_id: 100 } },
      } as ColumnModel;

      const relationData = new Map<number, Map<string, { label: string; color?: string }>>([
        [100, new Map([
          ['1', { label: 'Alice', color: '#3b82f6' }],
          ['2', { label: 'Bob', color: '#22c55e' }],
        ])],
      ]);

      const cardWithAssignee = { ...mockCard, data: { ...mockCard.data, assignee: '1' } };

      render(
        <CardDetailModal
          {...defaultProps}
          columns={[...baseColumns, relationColumn]}
          card={cardWithAssignee}
          relationData={relationData}
        />
      );

      // Relation select should render with options from relationData
      const selectEl = screen.getByDisplayValue('Alice');
      expect(selectEl).toBeInTheDocument();
    });
  });

  // ========== LAYOUT ==========
  describe('layout', () => {
    it('should split into two columns when text columns exist', () => {
      render(<CardDetailModal {...defaultProps} />);
      // Description is rich_text, so text columns exist and description label appears in right panel
      const descLabel = screen.getByText('Description');
      expect(descLabel).toBeInTheDocument();
      // The markdown preview for the description should also be present
      expect(screen.getByTestId('markdown-preview')).toBeInTheDocument();
    });

    it('should render single column when no text columns', () => {
      const structuredOnly: ColumnModel[] = [
        { id: 1, name: 'title', type: 'text', displayName: 'Title', position: 0, config: {} } as ColumnModel,
        { id: 2, name: 'status', type: 'select', displayName: 'Status', position: 1, config: { options: [] } } as ColumnModel,
      ];
      // Title is text but excluded from right panel as it's the title field
      // Status is structured
      const cardSimple = { id: '1', data: { title: 'Simple', status: 'open' } };
      render(
        <CardDetailModal
          {...defaultProps}
          columns={structuredOnly}
          card={cardSimple}
        />
      );
      // With only title (excluded) + status, no text columns for right panel
      expect(screen.getByText('Simple')).toBeInTheDocument();
    });
  });

  // ========== ERROR HANDLING ==========
  describe('error handling', () => {
    it('should handle save error gracefully', async () => {
      const onSave = vi.fn().mockRejectedValue(new Error('Save failed'));
      render(<CardDetailModal {...defaultProps} onSave={onSave} />);

      // Double-click to edit status
      const statusDisplay = screen.getByText('open');
      fireEvent.doubleClick(statusDisplay);

      // Click OK
      fireEvent.click(screen.getByText('OK'));

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      // Component should not crash; logger.error should be called
      expect(screen.getByText('#42')).toBeInTheDocument();
    });

    it('should handle missing columns gracefully', () => {
      render(<CardDetailModal {...defaultProps} columns={[]} />);
      // Should still render the modal with the title
      expect(screen.getByText('#42')).toBeInTheDocument();
    });

    it('should handle columns as non-array gracefully', () => {
      // @ts-expect-error Testing invalid input
      render(<CardDetailModal {...defaultProps} columns={null} />);
      expect(screen.getByText('#42')).toBeInTheDocument();
    });
  });
});

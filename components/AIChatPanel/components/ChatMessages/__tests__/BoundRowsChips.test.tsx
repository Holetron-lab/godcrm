import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoundRowsChips } from '../BoundRowsChips';
import type { BoundRow } from '../BoundRowsChips';

// Mock icons
vi.mock('lucide-react', () => ({
  Link2: ({ className, ...props }: { className?: string; [key: string]: unknown }) => <div className={className} data-testid="link2-icon" {...props} />
}));

// Mock cn utility
vi.mock('@/shared/utils/cn', () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(' ')
}));

describe('BoundRowsChips', () => {
  const mockRow1: BoundRow = {
    table_id: 1,
    row_id: 100,
    table_name: 'Contacts',
    table_icon: '👤',
    row_title: 'John Doe',
    project_id: 10,
    project_name: 'CRM'
  };

  const mockRow2: BoundRow = {
    table_id: 2,
    row_id: 200,
    table_name: 'Deals',
    row_title: 'Big Deal'
  };

  const mockRowNoTitle: BoundRow = {
    table_id: 3,
    row_id: 300,
    table_name: 'Tasks'
  };

  const mockRowNoIcon: BoundRow = {
    table_id: 4,
    row_id: 400,
    table_name: 'Notes',
    row_title: 'Meeting notes'
  };

  const mockInheritedRow: BoundRow = {
    table_id: 5,
    row_id: 500,
    table_name: 'Projects',
    table_icon: '📁',
    row_title: 'Alpha Project'
  };

  const defaultProps = {
    boundRows: [mockRow1],
    onRowClick: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering nothing', () => {
    it('should render nothing when boundRows is empty and no inheritedBoundRows', () => {
      const { container } = render(<BoundRowsChips boundRows={[]} />);

      expect(container.innerHTML).toBe('');
    });

    it('should render nothing when boundRows is empty and inheritedBoundRows is empty', () => {
      const { container } = render(<BoundRowsChips boundRows={[]} inheritedBoundRows={[]} />);

      expect(container.innerHTML).toBe('');
    });

    it('should render nothing when boundRows is empty and inheritedBoundRows is undefined', () => {
      const { container } = render(<BoundRowsChips boundRows={[]} inheritedBoundRows={undefined} />);

      expect(container.innerHTML).toBe('');
    });
  });

  describe('Rendering chips for bound rows', () => {
    it('should render a chip for each bound row', () => {
      render(<BoundRowsChips boundRows={[mockRow1, mockRow2]} />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Big Deal')).toBeInTheDocument();
    });

    it('should render the container wrapper with a leading Link2 icon', () => {
      render(<BoundRowsChips {...defaultProps} />);

      // The container itself has a Link2 icon as a prefix
      const link2Icons = screen.getAllByTestId('link2-icon');
      expect(link2Icons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Row title display', () => {
    it('should display row_title when available', () => {
      render(<BoundRowsChips boundRows={[mockRow1]} />);

      expect(screen.getByText('John Doe')).toBeInTheDocument();
    });

    it('should fall back to "#row_id" when no row_title is provided', () => {
      render(<BoundRowsChips boundRows={[mockRowNoTitle]} />);

      expect(screen.getByText('#300')).toBeInTheDocument();
    });
  });

  describe('Icons', () => {
    it('should show table_icon when provided', () => {
      render(<BoundRowsChips boundRows={[mockRow1]} />);

      expect(screen.getByText('👤')).toBeInTheDocument();
    });

    it('should show Link2 icon when no table_icon is provided', () => {
      render(<BoundRowsChips boundRows={[mockRowNoIcon]} />);

      // There is a leading Link2 icon in the container, plus one per chip without table_icon
      const link2Icons = screen.getAllByTestId('link2-icon');
      // At least 2: one for the container prefix + one inside the chip
      expect(link2Icons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Click handling', () => {
    it('should call onRowClick when a chip is clicked', () => {
      const onRowClick = vi.fn();
      render(<BoundRowsChips boundRows={[mockRow1]} onRowClick={onRowClick} />);

      fireEvent.click(screen.getByText('John Doe'));

      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick).toHaveBeenCalledWith(mockRow1);
    });

    it('should call onRowClick with the correct row when multiple chips exist', () => {
      const onRowClick = vi.fn();
      render(<BoundRowsChips boundRows={[mockRow1, mockRow2]} onRowClick={onRowClick} />);

      fireEvent.click(screen.getByText('Big Deal'));

      expect(onRowClick).toHaveBeenCalledTimes(1);
      expect(onRowClick).toHaveBeenCalledWith(mockRow2);
    });

    it('should not throw when onRowClick is not provided', () => {
      render(<BoundRowsChips boundRows={[mockRow1]} />);

      expect(() => {
        fireEvent.click(screen.getByText('John Doe'));
      }).not.toThrow();
    });
  });

  describe('Inherited rows styling', () => {
    it('should render inherited rows with different styling classes', () => {
      const { container } = render(
        <BoundRowsChips boundRows={[]} inheritedBoundRows={[mockInheritedRow]} />
      );

      const button = container.querySelector('button');
      expect(button).toBeInTheDocument();
      // Inherited rows use bg-[var(--bg-tertiary)] styling
      expect(button!.className).toContain('bg-[var(--bg-tertiary)]');
    });

    it('should render own rows with primary styling classes', () => {
      const { container } = render(
        <BoundRowsChips boundRows={[mockRow1]} />
      );

      const button = container.querySelector('button');
      expect(button).toBeInTheDocument();
      // Own rows use primary color styling
      expect(button!.className).toContain('bg-[var(--color-primary-50,rgba(59,130,246,0.05))]');
    });

    it('should include "(inherited)" in title attribute for inherited rows', () => {
      render(
        <BoundRowsChips boundRows={[]} inheritedBoundRows={[mockInheritedRow]} />
      );

      const button = screen.getByTitle('Projects → #500 (inherited)');
      expect(button).toBeInTheDocument();
    });

    it('should not include "(inherited)" in title attribute for own rows', () => {
      render(
        <BoundRowsChips boundRows={[mockRow1]} />
      );

      const button = screen.getByTitle('Contacts → #100');
      expect(button).toBeInTheDocument();
    });
  });

  describe('Compact mode', () => {
    it('should apply max-w-[150px] to label when compact is false or not set', () => {
      const { container } = render(<BoundRowsChips boundRows={[mockRow1]} />);

      const labelSpan = container.querySelector('button span.truncate');
      expect(labelSpan).toBeInTheDocument();
      expect(labelSpan!.className).toContain('max-w-[150px]');
    });

    it('should apply max-w-[100px] to label when compact is true', () => {
      const { container } = render(<BoundRowsChips boundRows={[mockRow1]} compact />);

      const labelSpan = container.querySelector('button span.truncate');
      expect(labelSpan).toBeInTheDocument();
      expect(labelSpan!.className).toContain('max-w-[100px]');
    });
  });

  describe('Mixed boundRows and inheritedBoundRows', () => {
    it('should render both own and inherited rows', () => {
      render(
        <BoundRowsChips
          boundRows={[mockRow1, mockRow2]}
          inheritedBoundRows={[mockInheritedRow]}
        />
      );

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.getByText('Big Deal')).toBeInTheDocument();
      expect(screen.getByText('Alpha Project')).toBeInTheDocument();
    });

    it('should render own rows before inherited rows', () => {
      const { container } = render(
        <BoundRowsChips
          boundRows={[mockRow1]}
          inheritedBoundRows={[mockInheritedRow]}
        />
      );

      const buttons = container.querySelectorAll('button');
      expect(buttons).toHaveLength(2);

      // First button is the own row (primary styling)
      expect(buttons[0].className).toContain('bg-[var(--color-primary-50,rgba(59,130,246,0.05))]');
      // Second button is the inherited row (tertiary styling)
      expect(buttons[1].className).toContain('bg-[var(--bg-tertiary)]');
    });

    it('should apply correct keys to distinguish own vs inherited rows with same ids', () => {
      const ownRow: BoundRow = { table_id: 1, row_id: 100, row_title: 'Own Row' };
      const inheritedRow: BoundRow = { table_id: 1, row_id: 100, row_title: 'Inherited Row' };

      render(
        <BoundRowsChips
          boundRows={[ownRow]}
          inheritedBoundRows={[inheritedRow]}
        />
      );

      // Both should render without key conflicts
      expect(screen.getByText('Own Row')).toBeInTheDocument();
      expect(screen.getByText('Inherited Row')).toBeInTheDocument();
    });

    it('should call onRowClick with inherited row when inherited chip is clicked', () => {
      const onRowClick = vi.fn();
      render(
        <BoundRowsChips
          boundRows={[mockRow1]}
          inheritedBoundRows={[mockInheritedRow]}
          onRowClick={onRowClick}
        />
      );

      fireEvent.click(screen.getByText('Alpha Project'));

      expect(onRowClick).toHaveBeenCalledWith(mockInheritedRow);
    });
  });

  describe('Title attribute', () => {
    it('should use table_name in title when available', () => {
      render(<BoundRowsChips boundRows={[mockRow1]} />);

      const button = screen.getByTitle('Contacts → #100');
      expect(button).toBeInTheDocument();
    });

    it('should fall back to "Table" in title when no table_name', () => {
      const rowNoTableName: BoundRow = { table_id: 1, row_id: 42 };
      render(<BoundRowsChips boundRows={[rowNoTableName]} />);

      const button = screen.getByTitle('Table → #42');
      expect(button).toBeInTheDocument();
    });
  });

  describe('className prop', () => {
    it('should apply custom className to the container', () => {
      const { container } = render(
        <BoundRowsChips boundRows={[mockRow1]} className="my-custom-class" />
      );

      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.className).toContain('my-custom-class');
    });
  });
});

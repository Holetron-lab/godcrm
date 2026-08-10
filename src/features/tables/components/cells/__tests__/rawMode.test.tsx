import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { TextCell } from '../TextCell';
import { NumberCell } from '../NumberCell';
import { DateCell } from '../DateCell';
import { SelectCell } from '../SelectCell';
import { CheckboxCell } from '../CheckboxCell';

// Test wrapper with QueryClientProvider and LanguageProvider
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      {children}
    </LanguageProvider>
  </QueryClientProvider>
);

const renderWithProviders = (ui: React.ReactElement) => {
  return render(ui, { wrapper: TestWrapper });
};

/**
 * Tests for RAW Mode in Cell Components
 * RAW mode displays data as-is without formatting
 * 
 * TDD Approach:
 * 1. RED: These tests will fail initially (rawMode not implemented)
 * 2. GREEN: Implement rawMode in each cell
 * 3. REFACTOR: Clean up code
 */

describe('Cell Components - RAW Mode', () => {
  describe('TextCell', () => {
    it('should display text value as-is in RAW mode', () => {
      renderWithProviders(<TextCell value="Hello World" rawMode />);
      const element = screen.getByText('Hello World');
      expect(element).toHaveClass('font-mono');
    });

    it('should show NULL for null values in RAW mode', () => {
      renderWithProviders(<TextCell value={null} rawMode />);
      expect(screen.getByText('NULL')).toBeInTheDocument();
    });

    it('should show NULL for undefined values in RAW mode', () => {
      renderWithProviders(<TextCell value={undefined} rawMode />);
      expect(screen.getByText('NULL')).toBeInTheDocument();
    });
  });

  describe('NumberCell', () => {
    it('should display raw number without formatting in RAW mode', () => {
      render(<NumberCell value={12345.67} rawMode />);
      expect(screen.getByText('12345.67')).toBeInTheDocument();
    });

    it('should show NULL for null values in RAW mode', () => {
      render(<NumberCell value={null} rawMode />);
      expect(screen.getByText('NULL')).toBeInTheDocument();
    });
  });

  describe('DateCell', () => {
    it('should display raw ISO string in RAW mode', () => {
      renderWithProviders(<DateCell value="2023-01-15T10:30:00Z" rawMode />);
      expect(screen.getByText('2023-01-15T10:30:00Z')).toBeInTheDocument();
    });

    it('should show NULL for null values in RAW mode', () => {
      renderWithProviders(<DateCell value={null} rawMode />);
      expect(screen.getByText('NULL')).toBeInTheDocument();
    });
  });

  describe('SelectCell', () => {
    const options = [
      { value: 'active', label: 'Активен', color: '#22c55e' },
      { value: 'inactive', label: 'Неактивен', color: '#ef4444' }
    ];

    it('should display raw value without badge in RAW mode', () => {
      renderWithProviders(<SelectCell value="active" options={options} rawMode />);
      const element = screen.getByText('active');
      // Should NOT have badge styling
      expect(element).not.toHaveClass('rounded-full');
      expect(element).toHaveClass('font-mono');
    });

    it('should show NULL for null values in RAW mode', () => {
      renderWithProviders(<SelectCell value={null} options={options} rawMode />);
      expect(screen.getByText('NULL')).toBeInTheDocument();
    });
  });

  describe('CheckboxCell', () => {
    it('should display 1 for true in RAW mode', () => {
      render(<CheckboxCell value={true} rawMode />);
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('should display 0 for false in RAW mode', () => {
      render(<CheckboxCell value={false} rawMode />);
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should show NULL for null values in RAW mode', () => {
      render(<CheckboxCell value={null} rawMode />);
      expect(screen.getByText('NULL')).toBeInTheDocument();
    });
  });
});

describe('Cell Components - Formatted Mode (Default)', () => {
  describe('TextCell', () => {
    it('should display text normally without rawMode', () => {
      renderWithProviders(<TextCell value="Hello World" />);
      const element = screen.getByText('Hello World');
      expect(element).not.toHaveClass('font-mono');
    });

    it('should show Empty for null values without rawMode', () => {
      renderWithProviders(<TextCell value={null} />);
      expect(screen.getByText('Empty')).toBeInTheDocument();
    });
  });

  describe('SelectCell', () => {
    const options = [
      { value: 'active', label: 'Активен', color: '#22c55e' }
    ];

    it('should display badge with label without rawMode', () => {
      renderWithProviders(<SelectCell value="active" options={options} />);
      const element = screen.getByText('Активен');
      expect(element).toHaveClass('rounded-full');
    });
  });
});

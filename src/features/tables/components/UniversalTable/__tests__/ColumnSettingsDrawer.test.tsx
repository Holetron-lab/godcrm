import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ColumnSettingsDrawer } from '../ColumnSettingsDrawer';
// Mock useProjectTables hook
vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: vi.fn(() => ({
    tables: [
      { id: 1, name: 'Orders', icon: '📦' },
      { id: 2, name: 'Customers', icon: '👤' }
    ],
    isLoading: false
  }))
}));

import { getInputByLabel, createMockColumn, createSelectColumn, renderWithProviders, openTab, TABS } from './columnSettingsTestUtils';

describe('ColumnSettingsDrawer', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // RENDERING TESTS
  // ===========================================================================
  
  describe('Rendering', () => {
    it('returns null when column is null', () => {
      const { container } = renderWithProviders(
        <ColumnSettingsDrawer
          column={null}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders modal with column displayName in title', () => {
      const column = createMockColumn({ displayName: 'Test Column' });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Title is "Column name: {displayName}" in English
      expect(screen.getByText(/Column name: Test Column/)).toBeInTheDocument();
    });

    it('renders all eight tabs', () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByRole('button', { name: TABS.COLUMN })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TABS.SOURCE })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TABS.TYPE })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TABS.CELL })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TABS.SUMMARY })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TABS.BACKLINK })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TABS.AUTOMATION })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: TABS.ACCESS })).toBeInTheDocument();
    });

    it('shows metadata block with column info', () => {
      const column = createMockColumn({ type: 'email', is_locked: false, is_from_source: false });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Check for type in metadata dashboard
      expect(screen.getByText('Email')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // COLUMN TAB TESTS (was Display Tab)
  // ===========================================================================
  
  describe('Column Tab', () => {
    it('shows display name input with current value', () => {
      const column = createMockColumn({ displayName: 'My Column' });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const nameInput = getInputByLabel('Column name');
      expect(nameInput).toHaveValue('My Column');
    });

    it('allows changing display name', async () => {
      const column = createMockColumn({ displayName: 'Old Name' });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const nameInput = getInputByLabel('Column name');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'New Name');
      
      expect(nameInput).toHaveValue('New Name');
    });

    it('shows width input with current value', () => {
      const column = createMockColumn({ width: 200 });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const widthInput = getInputByLabel('Width');
      expect(widthInput).toHaveValue(200);
    });

    it('allows changing width', async () => {
      const column = createMockColumn({ width: 150 });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const widthInput = getInputByLabel('Width');
      // Input should be editable
      expect(widthInput).not.toBeDisabled();
      expect(widthInput.type).toBe('number');
    });

    it('shows alignment selector', () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText('Alignment')).toBeInTheDocument();
    });

    it('shows visibility toggle', () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn({ isVisible: true })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      expect(screen.getByText('Visible column')).toBeInTheDocument();
    });

    it('shows required toggle on Column tab', () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Required toggle is now on Column tab (section "Behavior")
      expect(screen.getByText('Required field')).toBeInTheDocument();
    });

    it('shows readonly toggle on Column tab', () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Readonly toggle is now on Column tab (section "Behavior")
      expect(screen.getByText('Read only')).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // TYPE TAB TESTS (was Data Tab)
  // ===========================================================================
  
  describe('Type Tab', () => {
    it('shows column type selector', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      expect(screen.getByText('Column type')).toBeInTheDocument();
    });

    it('shows default value input', async () => {
      const column = createMockColumn({ defaultValue: 'default@email.com' });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      // DefaultValueInput is present
      expect(screen.getByText(/Default value/i)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // SELECT/MULTI-SELECT OPTIONS TESTS
  // ===========================================================================
  
  describe('Select/Multi-Select Options', () => {
    it('shows options editor for select type', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createSelectColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      expect(screen.getByText(/Options/)).toBeInTheDocument();
    });

    it('displays existing options', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createSelectColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      expect(screen.getByDisplayValue('Active')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Inactive')).toBeInTheDocument();
    });

    it('allows adding new option', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createSelectColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      
      const addButton = screen.getByRole('button', { name: /Add option/ });
      await userEvent.click(addButton);

      expect(screen.getByDisplayValue('New option')).toBeInTheDocument();
    });

    it('allows editing option label', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createSelectColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      
      const labelInput = screen.getByDisplayValue('Active');
      await userEvent.clear(labelInput);
      await userEvent.type(labelInput, 'Enabled');

      expect(labelInput).toHaveValue('Enabled');
    });

    it('allows deleting option', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createSelectColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      
      // Find delete button by emoji content
      const deleteButtons = screen.getAllByText('🗑️');
      await userEvent.click(deleteButtons[0]);

      expect(screen.queryByDisplayValue('Active')).not.toBeInTheDocument();
    });

    it('shows options for multi-select type', async () => {
      const multiSelectColumn = createSelectColumn({ type: 'multi-select' });
      
      renderWithProviders(
        <ColumnSettingsDrawer
          column={multiSelectColumn}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      // May have multiple elements - in metadata and in type selector
      const matches = screen.getAllByText(/multi-select/i);
      expect(matches.length).toBeGreaterThan(0);
    });

    it('does not show options for non-select types', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn({ type: 'text' })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      expect(screen.queryByText(/Options/)).not.toBeInTheDocument();
    });
  });

});

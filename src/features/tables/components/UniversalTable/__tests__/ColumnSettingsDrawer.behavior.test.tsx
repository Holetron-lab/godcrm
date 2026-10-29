import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
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

import { getInputByLabel, getSwitchByLabel, createMockColumn, createExternalColumn, createLockedColumn, createSelectColumn, renderWithProviders, openTab, TABS } from './columnSettingsTestUtils';

describe('ColumnSettingsDrawer', () => {
  const mockOnSave = vi.fn();
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // SOURCE TAB TESTS (relation/source)
  // ===========================================================================

  describe('Source Tab', () => {
    it('shows relation settings', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.SOURCE);
      expect(screen.getByText('🔗 Table relation')).toBeInTheDocument();
    });

    it('shows relation toggle', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.SOURCE);
      expect(screen.getByText(/Relation (enabled|disabled)/)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // BACKLINK TAB TESTS (was Mapping Tab)
  // ===========================================================================

  describe('BackLink Tab', () => {
    it('shows backlink tab is active when clicked', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.BACKLINK);
      // BackLink tab should have active styling
      const backlinkButton = screen.getByRole('button', { name: TABS.BACKLINK });
      expect(backlinkButton.className).toContain('bg-');
    });
  });

  // ===========================================================================
  // AUTOMATION TAB TESTS
  // ===========================================================================

  describe('Automation Tab', () => {
    it('shows automation placeholder when no automations', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.AUTOMATION);
      // New automations interface shows placeholder
      expect(screen.getByText('Нет автоматизаций для этой колонки')).toBeInTheDocument();
    });

    it('shows new automation button', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.AUTOMATION);
      // Should have button for creating new automation
      expect(screen.getByRole('button', { name: /Новая автоматизация/i })).toBeInTheDocument();
    });

    it('shows automation help text', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.AUTOMATION);
      expect(screen.getByText(/Как работают автоматизации/)).toBeInTheDocument();
    });
  });

  // ===========================================================================
  // EXTERNAL COLUMN TESTS
  // ===========================================================================

  describe('External Columns', () => {
    it('allows display name change for external columns', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createExternalColumn({ displayName: 'External Field' })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const nameInput = getInputByLabel('Column name');
      expect(nameInput).not.toBeDisabled();

      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'New External Name');
      expect(nameInput).toHaveValue('New External Name');
    });

    it('allows width change for external columns', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createExternalColumn({ width: 180 })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const widthInput = getInputByLabel('Width');
      expect(widthInput).not.toBeDisabled();
      expect(widthInput.type).toBe('number');
    });

    it('allows type change for external columns (UI only)', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createExternalColumn({ type: 'text' })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);
      // Type selector should be present and not disabled
      expect(screen.getByText('Column type')).toBeInTheDocument();
    });

    it('allows adding select options for external columns', async () => {
      const externalSelectColumn = createExternalColumn({
        type: 'select',
        config: { options: [] }
      });

      renderWithProviders(
        <ColumnSettingsDrawer
          column={externalSelectColumn}
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
  });

  // ===========================================================================
  // LOCKED COLUMN TESTS
  // ===========================================================================

  describe('Locked Columns', () => {
    it('still allows display name change for locked columns', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createLockedColumn({ displayName: 'Locked Field' })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const nameInput = getInputByLabel('Column name');
      expect(nameInput).not.toBeDisabled();
    });
  });

  // ===========================================================================
  // SAVE FUNCTIONALITY TESTS
  // ===========================================================================

  describe('Save Functionality', () => {
    it('calls onSave with correct data when saving', async () => {
      const column = createMockColumn({
        id: 'col-123',
        displayName: 'Original Name',
        width: 150
      });

      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Change display name
      const nameInput = getInputByLabel('Column name');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Updated Name');

      // Click save
      const saveButton = screen.getByRole('button', { name: /Save/i });
      await userEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledWith('col-123', expect.objectContaining({
        displayName: 'Updated Name'
      }));
    });

    it('includes all modified fields in save payload', async () => {
      const column = createMockColumn({
        id: 'col-456',
        width: 150,
        isRequired: false
      });

      renderWithProviders(
        <ColumnSettingsDrawer
          column={column}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Toggle required (now on Column tab, not Type tab)
      const requiredSwitch = getSwitchByLabel('Required field');
      await userEvent.click(requiredSwitch);

      // Save
      const saveButton = screen.getByRole('button', { name: /Save/i });
      await userEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledWith('col-456', expect.objectContaining({
        isRequired: true
      }));
    });

    it('shows "Saving..." when saving prop is true', () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
          saving={true}
        />
      );

      expect(screen.getByRole('button', { name: /Saving/i })).toBeInTheDocument();
    });

    it('does not call onSave when saving prop is true', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
          saving={true}
        />
      );

      const saveButton = screen.getByRole('button', { name: /Saving/i });
      await userEvent.click(saveButton);

      expect(mockOnSave).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // CLOSE FUNCTIONALITY TESTS
  // ===========================================================================

  describe('Close Functionality', () => {
    it('calls onOpenChange(false) when clicking close button', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Modal has Dialog.Close button with aria-label="Close" (× button)
      // and also secondary action button with label "Close"
      const closeButtons = screen.getAllByRole('button', { name: 'Close' });
      // Click the last one (Dialog.Close × button)
      await userEvent.click(closeButtons[closeButtons.length - 1]);

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });
  });

  // ===========================================================================
  // TAB SWITCHING TESTS
  // ===========================================================================

  describe('Tab Switching', () => {
    it('shows column tab content by default', () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      expect(getInputByLabel('Column name')).toBeInTheDocument();
      expect(getInputByLabel('Width')).toBeInTheDocument();
    });

    it('switches to Type tab correctly', async () => {
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

    it('switches to Source tab correctly', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.SOURCE);

      expect(screen.getByText('🔗 Table relation')).toBeInTheDocument();
    });

    it('switches to Automation tab correctly', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn()}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.AUTOMATION);

      // New interface shows automation info
      expect(screen.getByText(/Как работают автоматизации/)).toBeInTheDocument();
    });

    it('preserves draft state when switching tabs', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn({ displayName: 'Test' })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Change name
      const nameInput = getInputByLabel('Column name');
      await userEvent.clear(nameInput);
      await userEvent.type(nameInput, 'Changed Name');

      // Switch to Type tab
      await openTab(TABS.TYPE);

      // Switch back to Column tab
      await openTab(TABS.COLUMN);

      // Name should still be changed
      expect(getInputByLabel('Column name')).toHaveValue('Changed Name');
    });
  });

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('handles column with no config gracefully', () => {
      const columnWithoutConfig = createMockColumn({
        config: undefined as unknown as ColumnModel['config']
      });

      renderWithProviders(
        <ColumnSettingsDrawer
          column={columnWithoutConfig}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Should render without crashing
      expect(screen.getByText(/Column name:/)).toBeInTheDocument();
    });

    it('handles empty options array for select', async () => {
      const selectWithNoOptions = createSelectColumn({
        config: { options: [] }
      });

      renderWithProviders(
        <ColumnSettingsDrawer
          column={selectWithNoOptions}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      await openTab(TABS.TYPE);

      // Should show add button but no options
      expect(screen.getByRole('button', { name: /Add option/ })).toBeInTheDocument();
    });

    it('resets to column tab when column changes', async () => {
      const { rerender } = renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn({ id: 'col-1' })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      // Switch to Type tab
      await openTab(TABS.TYPE);
      expect(screen.getByText('Column type')).toBeInTheDocument();

      // Change column
      rerender(
        <QueryClientProvider client={new QueryClient()}>
          <LanguageProvider>
            <ColumnSettingsDrawer
              column={createMockColumn({ id: 'col-2' })}
              open={true}
              onOpenChange={mockOnOpenChange}
              onSave={mockOnSave}
            />
          </LanguageProvider>
        </QueryClientProvider>
      );

      // Should reset to Column tab
      expect(getInputByLabel('Column name')).toBeInTheDocument();
    });

    it('handles width input when cleared', async () => {
      renderWithProviders(
        <ColumnSettingsDrawer
          column={createMockColumn({ width: 150 })}
          open={true}
          onOpenChange={mockOnOpenChange}
          onSave={mockOnSave}
        />
      );

      const widthInput = getInputByLabel('Width');
      await userEvent.tripleClick(widthInput);
      await userEvent.keyboard('{backspace}');

      // Input should be empty or keep the old value
      // Checking that it doesn't crash
      expect(widthInput).toBeInTheDocument();
    });
  });
});

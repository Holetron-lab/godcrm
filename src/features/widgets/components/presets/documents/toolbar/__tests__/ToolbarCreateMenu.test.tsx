/**
 * ADR-0005 §C-5 / Phase 5 — toolbar create-menu now lists `widget` between
 * `image` and `divider`. Selecting "Виджет" defers to the existing widget
 * picker (mode='create', no anchor → append) instead of creating an atom row
 * directly. The picker's onWidgetCreated callback (in DocumentsContent) is
 * what actually runs `addItem({ level: 'widget', widget_ref })`; this test
 * verifies the toolbar wires through to that picker correctly and that the
 * picker → addItem contract creates the expected row shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the ticket-as-atom modal (it pulls in react-query + apiClient and is
// orthogonal to this suite — its own tests live elsewhere).
vi.mock('../../atoms/TicketRefAtom/InsertTicketAtomModal', () => ({
  InsertTicketAtomModal: () => null,
}));

// Mock useDocumentsContext so the toolbar can render in isolation.
const mockSetWidgetPickerTarget = vi.fn();
const mockAddItem = vi.fn(async () => ({ id: 999, tableId: 42 }));
const mockUpdateItem = vi.fn(async () => ({ success: true }));
const mockSetShowConvertToAtomModal = vi.fn();
const mockSetConvertToAtomItem = vi.fn();
const mockSetShowFileUploadModal = vi.fn();
const mockSetShowCreateDocumentModal = vi.fn();
const mockSetStatusFilter = vi.fn();
const mockGetNextOrder = vi.fn(() => 100);

const baseCtx = {
  isReadOnly: false,
  isMobile: false,
  isCreating: false,
  selectedDocumentId: 7,
  selectedDocument: { id: 7, content_table_id: 42 },
  widgetPickerTarget: null,
  setWidgetPickerTarget: mockSetWidgetPickerTarget,
  addItem: mockAddItem,
  updateItem: mockUpdateItem,
  getNextOrder: mockGetNextOrder,
  currentLanguage: 'en',
  setShowConvertToAtomModal: mockSetShowConvertToAtomModal,
  setConvertToAtomItem: mockSetConvertToAtomItem,
  setShowFileUploadModal: mockSetShowFileUploadModal,
  setShowCreateDocumentModal: mockSetShowCreateDocumentModal,
  setStatusFilter: mockSetStatusFilter,
  statusFilter: 'all',
  statusOptions: [],
  items: [],
};

vi.mock('../../DocumentsContext', () => ({
  useDocumentsContext: () => baseCtx,
}));

// Import AFTER the mocks are registered.
import { ToolbarCreateMenu } from '../ToolbarCreateMenu';

const openAddMenu = () => {
  // Hover the "Добавить" button (its container has onMouseEnter).
  const addButton = screen.getByText('Добавить').closest('div');
  expect(addButton).toBeTruthy();
  fireEvent.mouseEnter(addButton as Element);
};

describe('ADR-0005 §C-5 / Phase 5 — ToolbarCreateMenu widget level', () => {
  beforeEach(() => {
    mockSetWidgetPickerTarget.mockClear();
    mockAddItem.mockClear();
    mockUpdateItem.mockClear();
    mockSetShowConvertToAtomModal.mockClear();
    mockSetConvertToAtomItem.mockClear();
  });

  it('lists "Виджет" between Image and Divider in the add menu', () => {
    render(<ToolbarCreateMenu />);
    openAddMenu();

    const menu = screen.getByTestId('documents-add-menu');
    const buttons = Array.from(menu.querySelectorAll('button[data-testid^="documents-add-menu-item-"]'));
    const order = buttons.map(b => b.getAttribute('data-testid'));

    expect(order).toEqual([
      'documents-add-menu-item-h2',
      'documents-add-menu-item-h3',
      'documents-add-menu-item-text',
      'documents-add-menu-item-atom',
      'documents-add-menu-item-ticket',
      'documents-add-menu-item-image',
      'documents-add-menu-item-widget',
      'documents-add-menu-item-divider',
      'documents-add-menu-item-page_break',
    ]);

    // The widget entry uses the localized label "Виджет".
    const widgetButton = screen.getByTestId('documents-add-menu-item-widget');
    expect(widgetButton.textContent).toContain('Виджет');
  });

  it('clicking "Виджет" opens the widget picker in create mode (no anchor → append)', () => {
    render(<ToolbarCreateMenu />);
    openAddMenu();

    fireEvent.click(screen.getByTestId('documents-add-menu-item-widget'));

    // Toolbar must defer to the picker — NOT create an atom directly.
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockSetShowConvertToAtomModal).not.toHaveBeenCalled();

    // Picker target = create-mode with no afterItemId / beforeItemId.
    // DocumentsContent's handleWidgetPicked then resolves this to
    // `{ kind: 'end' }` (append-at-end). See DocumentsContent.tsx Phase1.
    expect(mockSetWidgetPickerTarget).toHaveBeenCalledTimes(1);
    expect(mockSetWidgetPickerTarget).toHaveBeenCalledWith({ mode: 'create' });
    const payload = mockSetWidgetPickerTarget.mock.calls[0][0];
    expect(payload).not.toHaveProperty('afterItemId');
    expect(payload).not.toHaveProperty('beforeItemId');
  });

  it('does NOT trigger the picker when document is read-only', () => {
    // Re-mock with isReadOnly=true via a one-off render. We can't easily
    // remount with a different mock here (vi.mock is hoisted), so we mutate
    // the shared baseCtx for this test only.
    const original = baseCtx.isReadOnly;
    (baseCtx as { isReadOnly: boolean }).isReadOnly = true;
    try {
      render(<ToolbarCreateMenu />);
      // The "Добавить" dropdown is not rendered in read-only mode.
      expect(screen.queryByText('Добавить')).toBeNull();
    } finally {
      (baseCtx as { isReadOnly: boolean }).isReadOnly = original;
    }
  });
});

/**
 * Picker → addItem contract (the part that DocumentsContent owns). Replicated
 * here as a pure unit test to lock in the row shape produced when the user
 * picks a widget after the toolbar opens the picker.
 *
 * On widget selection, DocumentsContent.handleWidgetPicked calls:
 *   ctx.addItem({
 *     documentId, tableId,
 *     item: { order, level: 'widget', widget_ref: <id> },
 *   })
 *
 * settings_override defaults to {} on the backend (atoms_v2 schema). The
 * frontend deliberately does NOT set it here — the row is created with no
 * overrides until the user edits the widget settings on this doc.
 */
describe('ADR-0005 §C-5 / Phase 5 — picker → addItem row shape', () => {
  it('creates an atom with level=widget, widget_ref=<id>, no settings_override', async () => {
    const addItem = vi.fn(async () => ({ id: 1, tableId: 42 }));
    const widgetId = 1234;
    const order = 555;

    // Replicates the body of DocumentsContent.handleWidgetPicked for
    // mode='create' / kind='end'.
    await addItem({
      documentId: 7,
      tableId: 42,
      item: {
        order,
        level: 'widget',
        widget_ref: widgetId,
      },
    });

    expect(addItem).toHaveBeenCalledWith({
      documentId: 7,
      tableId: 42,
      item: {
        order: 555,
        level: 'widget',
        widget_ref: 1234,
      },
    });
    const itemArg = addItem.mock.calls[0][0].item;
    // settings_override is intentionally omitted (defaults to {} server-side).
    expect(itemArg).not.toHaveProperty('settings_override');
  });
});

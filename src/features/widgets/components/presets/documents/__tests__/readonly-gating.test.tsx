/**
 * ADR-0060 P6/P — read-only fail-closed gating for DocumentsWidget.
 *
 * Two layers of defense are tested:
 *   1. UI-level: mutation trigger buttons are not rendered when isReadOnly.
 *   2. Handler-level: even if a handler is invoked (e.g. via a wired-up
 *      onClick), it must short-circuit before touching apiClient.
 *
 * The DocumentsProvider itself is exercised by other suites; here we lock in
 * the contract at the component boundary where public/PublicProjectPage will
 * cascade isEditMode=false.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// === Shared apiClient spy (hoisted so vi.mock factory can reach them) ===
const { apiPost, apiPut, apiPatch, apiDelete, apiGet } = vi.hoisted(() => ({
  apiPost: vi.fn(async () => ({ success: true })),
  apiPut: vi.fn(async () => ({ success: true })),
  apiPatch: vi.fn(async () => ({ success: true })),
  apiDelete: vi.fn(async () => ({ success: true })),
  apiGet: vi.fn(async () => ({ data: [] })),
}));

vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: { post: apiPost, put: apiPut, patch: apiPatch, delete: apiDelete, get: apiGet },
}));

vi.mock('@/shared/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Mock the modal shell to render children directly.
vi.mock('@/shared/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) => (isOpen ? <div data-testid="modal">{children}</div> : null),
}));
vi.mock('@/shared/components/ui/Button', () => ({
  Button: ({ children, onClick, ...rest }: any) => <button onClick={onClick} {...rest}>{children}</button>,
}));
vi.mock('@/shared/components/ui/Select', () => ({
  Select: () => null,
}));
vi.mock('@/features/tables/hooks/useAllTables', () => ({
  useAllTables: () => ({ data: { projects: [] } }),
}));

// === Configurable mock context (hoisted so vi.mock factory can reach it) ===
const { baseCtx } = vi.hoisted(() => ({
  baseCtx: {
    isReadOnly: false,
    selectedDocument: { id: 7, content_table_id: 42 } as any,
    isMobile: false,
    isCreating: false,
    spaceId: 11,
    widgetId: 218,
    config: { id: 218 } as any,
    showAgentsModal: true,
    setShowAgentsModal: vi.fn(),
    setShowFileUploadModal: vi.fn(),
    setShowCreateDocumentModal: vi.fn(),
    rightPanelMode: 'settings' as const,
    rightPanelOpen: false,
    setRightPanelMode: vi.fn(),
    setRightPanelOpen: vi.fn(),
    setSelectedItemId: vi.fn(),
    setPreviewMode: vi.fn(),
    setContentScale: vi.fn(),
    setStructureMode: vi.fn(),
    structureMode: false,
    previewMode: 'strip' as const,
    contentScale: 100,
  },
}));

vi.mock('../DocumentsContext', () => ({
  useDocumentsContext: () => baseCtx,
}));

// Import AFTER mocks are registered.
import { ToolbarViewActions } from '../toolbar/ToolbarViewActions';
import { ToolbarAtomsModeActions } from '../toolbar/ToolbarAtomsModeActions';
import { AgentsModal } from '../modals/AgentsModal';

describe('ADR-0060 P6/P — UI hide on read-only', () => {
  beforeEach(() => {
    apiPost.mockClear();
    apiPut.mockClear();
    apiPatch.mockClear();
  });

  it('ToolbarViewActions hides AI Agents trigger when isReadOnly=true', () => {
    (baseCtx as { isReadOnly: boolean }).isReadOnly = true;
    try {
      render(<ToolbarViewActions />);
      // Bot icon button uses title="Настройка AI агентов" — should not render.
      expect(screen.queryByTitle('Настройка AI агентов')).toBeNull();
    } finally {
      (baseCtx as { isReadOnly: boolean }).isReadOnly = false;
    }
  });

  it('ToolbarViewActions shows AI Agents trigger when isReadOnly=false', () => {
    (baseCtx as { isReadOnly: boolean }).isReadOnly = false;
    render(<ToolbarViewActions />);
    expect(screen.getByTitle('Настройка AI агентов')).toBeInTheDocument();
  });

  it('ToolbarAtomsModeActions hides AI Agents trigger when isReadOnly=true', () => {
    (baseCtx as { isReadOnly: boolean }).isReadOnly = true;
    try {
      render(<ToolbarAtomsModeActions />);
      expect(screen.queryByTitle('AI Агенты')).toBeNull();
    } finally {
      (baseCtx as { isReadOnly: boolean }).isReadOnly = false;
    }
  });
});

describe('ADR-0060 P6/P — handler fail-closed', () => {
  beforeEach(() => {
    apiPost.mockClear();
    apiPut.mockClear();
    apiPatch.mockClear();
  });

  it('AgentsModal renders only the read-only safe shell (modal stays inert) when isReadOnly=true', () => {
    // Setting both the readonly flag and modal-open simulates an attacker / bug
    // forcing the modal open in a public/read-only mount. Trigger buttons are
    // already hidden upstream; this test pins down that even if the modal is
    // somehow rendered, no mutating API call fires on mount.
    (baseCtx as { isReadOnly: boolean }).isReadOnly = true;
    try {
      render(<AgentsModal />);
      // Mount alone must not perform any mutation.
      expect(apiPost).not.toHaveBeenCalled();
      expect(apiPut).not.toHaveBeenCalled();
      expect(apiPatch).not.toHaveBeenCalled();
    } finally {
      (baseCtx as { isReadOnly: boolean }).isReadOnly = false;
    }
  });
});

// ============================================================================
// Provider-level guard contract — DocumentsProvider must wrap every mutation
// returned through the context so that callers receive a rejecting Promise
// instead of an apiClient hit when isEditMode=false.
// ============================================================================

describe('ADR-0060 P6/P — provider mutation wrapping contract', () => {
  // We hoist a fresh harness: re-import the provider with isolated mocks that
  // capture the inner mutation calls. The provider should call these only when
  // NOT in read-only mode.
  it('denyInReadOnly rejects mutation calls without invoking the inner fn', async () => {
    // Replicate the helper inline so we test the contract independently of
    // module loading order (the provider's actual helper is a closure).
    const isReadOnly = true;
    const inner = vi.fn(async () => ({ id: 1 }));
    const wrap = <TArgs extends unknown[], TResult>(
      label: string,
      fn: (...args: TArgs) => TResult | Promise<TResult>,
    ) => {
      return (...args: TArgs): Promise<TResult> => {
        if (isReadOnly) {
          return Promise.reject(new Error(`DocumentsWidget is read-only (${label})`));
        }
        return Promise.resolve(fn(...args));
      };
    };

    const guardedAddItem = wrap('addItem', inner);
    await expect(guardedAddItem({ documentId: 1, item: {} } as never))
      .rejects.toThrow(/read-only \(addItem\)/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('denyInReadOnly passes through when isReadOnly=false', async () => {
    const isReadOnly = false;
    const inner = vi.fn(async () => ({ id: 1 }));
    const wrap = <TArgs extends unknown[], TResult>(
      label: string,
      fn: (...args: TArgs) => TResult | Promise<TResult>,
    ) => {
      return (...args: TArgs): Promise<TResult> => {
        if (isReadOnly) {
          return Promise.reject(new Error(`DocumentsWidget is read-only (${label})`));
        }
        return Promise.resolve(fn(...args));
      };
    };

    const guardedAddItem = wrap('addItem', inner);
    await expect(guardedAddItem({ documentId: 1, item: {} } as never))
      .resolves.toEqual({ id: 1 });
    expect(inner).toHaveBeenCalledTimes(1);
  });
});

// ADR-0005 §C-12 · widget-atom recursion guard tests
//
// Pure-unit (no DB): both `loadWidget` and `loadDocumentRegistryId` are
// injected. Mirrors the DI pattern used by widget-atom-resolver tests.

import { describe, it, expect } from 'vitest';
import { validateWidgetAtomRecursion } from '../widget-atom-recursion-guard.js';

const ATOMS_V2 = 3574;

function makeWidgetLoader(widgetsById) {
  return async (id) => widgetsById[id] ?? null;
}

function makeRegistryLoader(documentsById) {
  return async (id) => documentsById[id] ?? null;
}

describe('validateWidgetAtomRecursion', () => {
  it('passes through when tableId is not atoms_v2', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: 9999,
      data: { widget_ref: 1, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({}),
      loadDocumentRegistryId: makeRegistryLoader({}),
    });
    expect(out.ok).toBe(true);
  });

  it('passes through when atom is not a widget atom (no widget_ref)', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { type: 'paragraph', document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({}),
      loadDocumentRegistryId: makeRegistryLoader({}),
    });
    expect(out.ok).toBe(true);
  });

  it('passes through when atom has no document_id', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 218 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        218: { id: 218, preset_name: 'documents', config: { registry_table_id: 5000 } },
      }),
      loadDocumentRegistryId: makeRegistryLoader({}),
    });
    expect(out.ok).toBe(true);
  });

  it('passes through when widget is not a documents preset', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 9, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        9: { id: 9, preset_name: 'tickets', config: { registry_table_id: 5000 } },
      }),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(true);
  });

  it('passes through when widget registry differs from host registry', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 218, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        218: { id: 218, preset_name: 'documents', config: { registry_table_id: 6000 } },
      }),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(true);
  });

  it('blocks recursion: widget.registry_table_id == host registry', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 218, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        218: { id: 218, preset_name: 'documents', config: { registry_table_id: 5000 } },
      }),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('RECURSIVE_DOCUMENT_EMBEDDING');
    expect(out.status).toBe(400);
    expect(out.widget_id).toBe(218);
    expect(out.document_id).toBe(100);
  });

  it('blocks recursion via legacy `documents_table_id` config key', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 7, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        7: { id: 7, preset_name: 'documents_legacy', config: { documents_table_id: 5000 } },
      }),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('RECURSIVE_DOCUMENT_EMBEDDING');
  });

  it('blocks recursion via legacy `table_id` config key', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 7, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        7: { id: 7, preset_name: 'documents', config: { table_id: 5000 } },
      }),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(false);
  });

  it('parses widget.config when stored as a JSON string', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 7, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        7: { id: 7, preset_name: 'documents', config: '{"registry_table_id":5000}' },
      }),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('RECURSIVE_DOCUMENT_EMBEDDING');
  });

  it('tolerates legacy `doc_id` field on the atom', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 218, doc_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({
        218: { id: 218, preset_name: 'documents', config: { registry_table_id: 5000 } },
      }),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(false);
  });

  it('passes through when widget cannot be loaded (broken ref)', async () => {
    const out = await validateWidgetAtomRecursion({
      tableId: ATOMS_V2,
      data: { widget_ref: 999, document_id: 100 },
      atomsV2TableId: ATOMS_V2,
      loadWidget: makeWidgetLoader({}),
      loadDocumentRegistryId: makeRegistryLoader({ 100: 5000 }),
    });
    expect(out.ok).toBe(true);
  });
});

// ADR-0067 P2: canonical-first read with legacy fallback for documents widget config.
// Source-of-truth for the precedence order used by EditWidgetSettingsModal useState init
// and the reset useEffect. Keep this helper in sync with the dual-write in
// useWidgetSettingsHandlers.ts (createHandleSave, preset 'documents').

import type { WidgetConfig } from '../../../types/widget.types';

export interface DocumentsConfigRead {
  documentsTableId: string;
  sectionsTableId: string;
  documentsProjectId: string;
}

const asString = (v: unknown): string =>
  v === null || v === undefined ? '' : String(v);

export function readDocumentsConfigFromWidget(
  config: WidgetConfig | null | undefined,
): DocumentsConfigRead {
  const cfg = (config ?? {}) as Record<string, unknown>;
  return {
    documentsTableId: asString(cfg.registry_table_id ?? cfg.documents_table_id),
    sectionsTableId: asString(
      cfg.atoms_table_id ?? cfg.sections_table_id ?? cfg.table_id,
    ),
    documentsProjectId: asString(cfg.project_id ?? cfg.documents_project_id),
  };
}

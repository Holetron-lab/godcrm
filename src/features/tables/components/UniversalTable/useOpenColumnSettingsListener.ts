import { useEffect } from 'react';

export const useOpenColumnSettingsListener = (
  tableId: number | string | undefined,
  onOpen: (columnId: string) => void
) => {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tableId?: string | number; columnId?: string }>).detail;
      if (!detail?.columnId) return;
      if (tableId == null) return;
      if (String(detail.tableId ?? '') !== String(tableId)) return;
      onOpen(detail.columnId);
    };
    window.addEventListener('crm:open-column-settings', handler);
    return () => window.removeEventListener('crm:open-column-settings', handler);
  }, [onOpen, tableId]);
};

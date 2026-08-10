import React, { createContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from '../DocumentsContext';
import { useTicketConfig, type TicketRow } from '../content/ticketUtils';

export const TicketsDataContext = createContext<TicketRow[]>([]);

export function DocumentTicketsProvider({
  enabled,
  projectId,
  children,
}: {
  enabled: boolean;
  projectId: number;
  children: React.ReactNode;
}) {
  const ctx = useDocumentsContext();
  const { config: ticketConfig } = useTicketConfig(ctx.config);
  const { data: ticketsData } = useQuery({
    queryKey: ['tickets', projectId, ticketConfig?.table_id],
    queryFn: async () => {
      const response = await apiClient.get(`/tables/${ticketConfig!.table_id}/rows?limit=5000`);
      return response.data;
    },
    enabled: enabled && !!ticketConfig?.table_id,
    staleTime: 30_000,
  });
  const tickets: TicketRow[] = ticketsData?.rows || [];
  return (
    <TicketsDataContext.Provider value={tickets}>
      {children}
    </TicketsDataContext.Provider>
  );
}

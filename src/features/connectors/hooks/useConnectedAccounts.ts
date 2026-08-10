import { useQuery } from '@tanstack/react-query';
import { connectorsApi, SpaceConnector } from '../api/connectorsApi';

/**
 * ADR-159 — connected accounts in a space compatible with a module type.
 * Shared by the module shell (to default the active account) and the
 * AccountSwitcher (to render). React Query dedupes the request by key.
 */
export function useConnectedAccounts(spaceId: number | undefined, compatibleWith: string) {
  return useQuery<SpaceConnector[]>({
    queryKey: ['connectors', 'compatible', spaceId, compatibleWith],
    queryFn: () => connectorsApi.listCompatible(spaceId!, compatibleWith),
    enabled: Number.isFinite(spaceId),
    staleTime: 60_000,
  });
}

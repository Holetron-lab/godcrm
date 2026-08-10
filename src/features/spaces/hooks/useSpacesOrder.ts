/**
 * Hook for managing spaces order
 * Uses user_settings to persist order per user
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { userSettingsApi, SpacesOrder } from '../api/userSettingsApi';

export const spacesOrderKeys = {
  all: ['spacesOrder'] as const,
};

export const useSpacesOrder = () => {
  const queryClient = useQueryClient();

  const { data: spacesOrder = {}, isLoading } = useQuery({
    queryKey: spacesOrderKeys.all,
    queryFn: userSettingsApi.getSpacesOrder,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const updateOrderMutation = useMutation({
    mutationFn: ({ spaceId, order }: { spaceId: number; order: number }) =>
      userSettingsApi.updateSpaceOrder(spaceId, order),
    onSuccess: (newOrder) => {
      queryClient.setQueryData(spacesOrderKeys.all, newOrder);
    },
  });

  const updateAllOrdersMutation = useMutation({
    mutationFn: (spacesOrder: SpacesOrder) =>
      userSettingsApi.updateSpacesOrder(spacesOrder),
    onSuccess: (newOrder) => {
      queryClient.setQueryData(spacesOrderKeys.all, newOrder);
    },
  });

  const resetOrderMutation = useMutation({
    mutationFn: userSettingsApi.resetSpacesOrder,
    onSuccess: () => {
      queryClient.setQueryData(spacesOrderKeys.all, {});
    },
  });

  /**
   * Get order for a specific space
   * Default: Personal Space = 1, Admin Space = 99, others = 50
   */
  const getSpaceOrder = (spaceId: number, spaceType?: string): number => {
    if (spacesOrder[spaceId] !== undefined) {
      return spacesOrder[spaceId];
    }
    // Defaults based on type
    if (spaceType === 'personal') return 1;
    if (spaceType === 'admin') return 99;
    return 50;
  };

  /**
   * Update order for a single space
   */
  const updateSpaceOrder = (spaceId: number, order: number) => {
    return updateOrderMutation.mutateAsync({ spaceId, order });
  };

  return {
    spacesOrder,
    isLoading,
    getSpaceOrder,
    updateSpaceOrder,
    updateAllOrders: updateAllOrdersMutation.mutateAsync,
    resetOrder: resetOrderMutation.mutateAsync,
    isUpdating: updateOrderMutation.isPending || updateAllOrdersMutation.isPending,
  };
};

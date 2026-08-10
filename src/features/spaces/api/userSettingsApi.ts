/**
 * User Settings API
 * Handles user preferences like spaces order
 */
import { apiClient } from '@/shared/utils/apiClient';

export interface SpacesOrder {
  [spaceId: number]: number;
}

interface SpacesOrderResponse {
  success: boolean;
  data: {
    spacesOrder: SpacesOrder;
  };
}

export const userSettingsApi = {
  /**
   * Get spaces order for current user
   */
  getSpacesOrder: async (): Promise<SpacesOrder> => {
    const response = await apiClient.get<SpacesOrderResponse>('/user-settings/spaces-order');
    return response.data.spacesOrder;
  },

  /**
   * Update spaces order for current user
   */
  updateSpacesOrder: async (spacesOrder: SpacesOrder): Promise<SpacesOrder> => {
    const response = await apiClient.put<SpacesOrderResponse>('/user-settings/spaces-order', {
      spacesOrder
    });
    return response.data.spacesOrder;
  },

  /**
   * Update order for a single space
   */
  updateSpaceOrder: async (spaceId: number, order: number): Promise<SpacesOrder> => {
    const response = await apiClient.patch<SpacesOrderResponse>(
      `/user-settings/spaces-order/${spaceId}`,
      { order }
    );
    return response.data.spacesOrder;
  },

  /**
   * Reset spaces order to default
   */
  resetSpacesOrder: async (): Promise<void> => {
    await apiClient.delete('/user-settings/spaces-order');
  }
};

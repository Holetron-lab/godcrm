/**
 * @file widgetsApi.test.ts
 * @description Tests for widgets API functions
 * @see ADR-034: Feature Tests Coverage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as widgetsApi from '../api/widgetsApi';
import { apiClient } from '@/shared/utils/apiClient';

// Mock the apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

const mockApiClient = apiClient as unknown as { request: ReturnType<typeof vi.fn> };

describe('widgetsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWidgetsByDashboard', () => {
    it('should fetch widgets for a dashboard', async () => {
      const mockWidgets = [
        { id: 1, title: 'Widget 1', type: 'kanban_board' },
        { id: 2, title: 'Widget 2', type: 'table_view' },
      ];
      mockApiClient.request.mockResolvedValue({ data: mockWidgets });

      const result = await widgetsApi.getWidgetsByDashboard(123);

      expect(mockApiClient.request).toHaveBeenCalledWith('/dashboards/123/widgets');
      expect(result).toEqual(mockWidgets);
    });

    it.todo('should handle empty dashboard');
    it.todo('should handle network error');
    it.todo('should handle unauthorized access');
  });

  describe('getWidgetById', () => {
    it('should fetch single widget by ID', async () => {
      const mockWidget = { id: 42, title: 'Test Widget', type: 'kanban_board' };
      mockApiClient.request.mockResolvedValue({ data: mockWidget });

      const result = await widgetsApi.getWidgetById(42);

      expect(mockApiClient.request).toHaveBeenCalledWith('/widgets/42');
      expect(result).toEqual(mockWidget);
    });

    it.todo('should handle widget not found');
  });

  describe('createWidget', () => {
    it('should create widget with valid config', async () => {
      const newWidget = {
        dashboard_id: 1,
        type: 'kanban_board' as const,
        title: 'New Kanban',
        settings: { statusColumn: 'status' },
        layout: { x: 0, y: 0, w: 4, h: 4 },
      };
      const createdWidget = { id: 1, ...newWidget };
      mockApiClient.request.mockResolvedValue({ data: createdWidget });

      const result = await widgetsApi.createWidget(newWidget);

      expect(mockApiClient.request).toHaveBeenCalledWith('/dashboards/1/widgets', {
        method: 'POST',
        body: JSON.stringify({
          type: 'kanban_board',
          title: 'New Kanban',
          settings: { statusColumn: 'status' },
          layout: { x: 0, y: 0, w: 4, h: 4 },
        }),
      });
      expect(result).toEqual(createdWidget);
    });

    it.todo('should validate widget type');
    it.todo('should validate required settings per type');
    it.todo('should handle permission denied');
  });

  describe('updateWidget', () => {
    it('should update widget settings', async () => {
      const updates = { title: 'Updated Title', settings: { newSetting: true } };
      const updatedWidget = { id: 1, ...updates };
      mockApiClient.request.mockResolvedValue({ data: updatedWidget });

      const result = await widgetsApi.updateWidget(1, updates);

      expect(mockApiClient.request).toHaveBeenCalledWith('/widgets/1', {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      expect(result).toEqual(updatedWidget);
    });

    it.todo('should handle concurrent updates');
    it.todo('should validate settings schema');
  });

  describe('updateWidgetCode', () => {
    it('should update custom widget code', async () => {
      const codeUpdate = { code: 'console.log("hello")' };
      mockApiClient.request.mockResolvedValue({ data: { id: 1, ...codeUpdate } });

      await widgetsApi.updateWidgetCode(1, codeUpdate);

      expect(mockApiClient.request).toHaveBeenCalledWith('/widgets/1/code', {
        method: 'PATCH',
        body: JSON.stringify(codeUpdate),
      });
    });

    it.todo('should validate code syntax');
    it.todo('should sanitize dangerous code');
  });

  describe('deleteWidget', () => {
    it('should delete widget', async () => {
      mockApiClient.request.mockResolvedValue(undefined);

      await widgetsApi.deleteWidget(42);

      expect(mockApiClient.request).toHaveBeenCalledWith('/widgets/42', {
        method: 'DELETE',
      });
    });

    it.todo('should handle already deleted widget');
    it.todo('should check delete permissions');
  });

  describe('getWidgetData', () => {
    it('should fetch widget data', async () => {
      const mockData = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ];
      mockApiClient.request.mockResolvedValue({ data: mockData });

      const result = await widgetsApi.getWidgetData(1);

      expect(mockApiClient.request).toHaveBeenCalledWith('/widgets/1/data');
      expect(result).toEqual(mockData);
    });

    it.todo('should handle empty data');
    it.todo('should handle data fetch error');
  });

  describe('getWidgetPresets', () => {
    it('should return static widget presets', async () => {
      const presets = await widgetsApi.getWidgetPresets();

      expect(presets).toBeInstanceOf(Array);
      expect(presets.length).toBeGreaterThan(0);
      expect(presets[0]).toHaveProperty('id');
      expect(presets[0]).toHaveProperty('name');
      expect(presets[0]).toHaveProperty('type');
    });

    it('should include kanban_board preset', async () => {
      const presets = await widgetsApi.getWidgetPresets();
      
      const kanban = presets.find(p => p.type === 'kanban_board');
      expect(kanban).toBeDefined();
    });

    it('should include calendar_widget preset', async () => {
      const presets = await widgetsApi.getWidgetPresets();
      
      const calendar = presets.find(p => p.type === 'calendar_widget');
      expect(calendar).toBeDefined();
    });
  });
});

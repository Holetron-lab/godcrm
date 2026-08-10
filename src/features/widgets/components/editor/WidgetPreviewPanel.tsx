import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CustomWidgetSandbox } from '../custom/CustomWidgetSandbox';
import type { Widget, WidgetConfig } from '../../types/widget.types';

interface WidgetPreviewPanelProps {
  code: string;
  config: WidgetConfig;
  data: Record<string, unknown>[];
  errors: string[];
}

// Sample test data sets
const TEST_DATA_SETS = {
  none: { label: 'No Data', data: [] },
  small: {
    label: 'Sample Data (5 items)',
    data: [
      { id: 1, label: 'Item 1', value: 10, category: 'A' },
      { id: 2, label: 'Item 2', value: 25, category: 'B' },
      { id: 3, label: 'Item 3', value: 15, category: 'A' },
      { id: 4, label: 'Item 4', value: 30, category: 'C' },
      { id: 5, label: 'Item 5', value: 20, category: 'B' },
    ],
  },
  medium: {
    label: 'Medium Data (20 items)',
    data: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      label: `Item ${i + 1}`,
      value: Math.floor(Math.random() * 100),
      category: ['A', 'B', 'C'][Math.floor(Math.random() * 3)],
    })),
  },
  large: {
    label: 'Large Data (100 items)',
    data: Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      label: `Item ${i + 1}`,
      value: Math.floor(Math.random() * 100),
      category: ['A', 'B', 'C', 'D', 'E'][Math.floor(Math.random() * 5)],
    })),
  },
};

export function WidgetPreviewPanel({
  code,
  config,
  data: initialData,
  errors,
}: WidgetPreviewPanelProps) {
  const [selectedDataSet, setSelectedDataSet] = useState<keyof typeof TEST_DATA_SETS>('small');
  const [refreshKey, setRefreshKey] = useState(0);

  const data = initialData.length > 0 ? initialData : TEST_DATA_SETS[selectedDataSet].data;

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  // Mock widget object for preview
  const previewWidget: Widget = {
    id: 0,
    dashboard_id: 0,
    source_widget_id: null,
    widget_type: 'custom',
    preset_name: null,
    code,
    code_version: 1,
    title: 'Preview',
    description: null,
    icon: '🧩',
    config,
    position: { x: 0, y: 0, w: 6, h: 4 },
    is_visible: true,
    order_index: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    created_by: 0,
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="px-4 py-2 border-b bg-white flex items-center justify-between">
        <h3 className="font-medium text-gray-700">Preview</h3>
        
        <div className="flex items-center gap-2">
          {/* Test Data Selector */}
          <select
            value={selectedDataSet}
            onChange={(e) => setSelectedDataSet(e.target.value as keyof typeof TEST_DATA_SETS)}
            className="text-sm border rounded px-2 py-1"
          >
            {Object.entries(TEST_DATA_SETS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            className="p-1 hover:bg-gray-100 rounded transition"
            title="Refresh preview"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 p-4 overflow-auto">
        {errors.length > 0 ? (
          <div className="bg-red-50 border border-red-200 rounded p-4">
            <h4 className="text-red-800 font-medium mb-2">❌ Code Errors:</h4>
            <ul className="space-y-1">
              {errors.map((error, i) => (
                <li key={i} className="text-sm text-red-700">
                  {error}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div key={refreshKey} className="bg-white rounded shadow-sm border h-full">
            <CustomWidgetSandbox widget={previewWidget} data={data} />
          </div>
        )}
      </div>
    </div>
  );
}

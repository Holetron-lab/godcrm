import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { MonacoCodeEditor } from './editor/MonacoCodeEditor';
import { WidgetPreviewPanel } from './editor/WidgetPreviewPanel';
import { WidgetEditorHeader } from './editor/WidgetEditorHeader';
import { ConsolePanel } from './editor/ConsolePanel';
import { WIDGET_TEMPLATE } from '../constants/widgetTemplates';
import { useCreateWidget, useUpdateWidget, useUpdateWidgetCode } from '../hooks/useWidgets';
import type { Widget, CreateWidgetRequest } from '../types/widget.types';

interface WidgetEditorProps {
  widget?: Widget | null;
  dashboardId: number;
  onSave?: (widget: Widget) => void;
  onCancel: () => void;
}

export function WidgetEditor({
  widget,
  dashboardId,
  onSave,
  onCancel,
}: WidgetEditorProps) {
  // State
  const [code, setCode] = useState(widget?.code || WIDGET_TEMPLATE);
  const [title, setTitle] = useState(widget?.title || 'Untitled Widget');
  const [icon, setIcon] = useState(widget?.icon || '🧩');
  const [config, setConfig] = useState(widget?.config || {});
  const [errors, setErrors] = useState<string[]>([]);
  const [previewData] = useState([]);

  // Mutations
  const createWidgetMutation = useCreateWidget();
  const updateWidgetMutation = useUpdateWidget();
  const updateCodeMutation = useUpdateWidgetCode();

  const isSaving = createWidgetMutation.isPending || updateWidgetMutation.isPending || updateCodeMutation.isPending;

  // Debounce code changes for live preview
  useEffect(() => {
    const timer = setTimeout(() => {
      // Code is ready for preview
      // Errors will be detected by Monaco
    }, 500);

    return () => clearTimeout(timer);
  }, [code]);

  const handleSave = async () => {
    if (!code || !title) {
      setErrors(['Title and code are required']);
      return;
    }

    try {
      if (widget) {
        // Update existing widget - need to update metadata AND code separately
        await updateWidgetMutation.mutateAsync({
          widgetId: widget.id,
          updates: {
            title,
            icon,
            config,
          },
        });

        // Update code separately
        if (code !== widget.code) {
          await updateCodeMutation.mutateAsync({
            widgetId: widget.id,
            data: { code },
          });
        }
      } else {
        // Create new widget
        const widgetData: CreateWidgetRequest = {
          dashboard_id: dashboardId,
          widget_type: 'custom',
          code,
          title,
          icon,
          config,
          position: { x: 0, y: 0, w: 6, h: 4 },
        };

        const newWidget = await createWidgetMutation.mutateAsync(widgetData);
        if (onSave) {
          onSave(newWidget);
        }
      }

      onCancel(); // Close editor
    } catch (error) {
      logger.error('Failed to save widget:', error);
      setErrors([`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <WidgetEditorHeader
        title={title}
        icon={icon}
        onTitleChange={setTitle}
        onIconChange={setIcon}
        onSave={handleSave}
        onCancel={onCancel}
        isSaving={isSaving}
      />

      {/* Main Editor Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Monaco Editor (left 50%) */}
        <div className="flex-1 border-r">
          <MonacoCodeEditor
            code={code}
            onChange={setCode}
            onError={setErrors}
            language="javascript"
          />
        </div>

        {/* Live Preview (right 50%) */}
        <div className="flex-1">
          <WidgetPreviewPanel
            code={code}
            config={config}
            data={previewData}
            errors={errors}
          />
        </div>
      </div>

      {/* Console/Errors */}
      <ConsolePanel errors={errors} />
    </div>
  );
}

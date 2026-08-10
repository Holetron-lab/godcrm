import { useParams, Navigate } from 'react-router-dom';
import { WidgetEditor } from '@/features/widgets/components/WidgetEditor';
import { useWidget } from '@/features/widgets/hooks/useWidgets';

export function WidgetManagePage() {
  const { widgetId } = useParams<{ widgetId: string }>();
  const { data: widget, isLoading } = useWidget(widgetId ? parseInt(widgetId) : 0);

  if (!widgetId) {
    return <Navigate to="/spaces" replace />;
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-[var(--text-secondary)]">Loading module...</p>
      </div>
    );
  }

  if (!widget) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-[var(--text-secondary)]">Module not found</p>
      </div>
    );
  }

  return (
    <WidgetEditor
      widget={widget}
      dashboardId={widget.dashboard_id}
      onSave={() => window.history.back()}
      onCancel={() => window.history.back()}
    />
  );
}

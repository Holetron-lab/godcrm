import { AutopilotDashboardWidget } from '@/features/widgets/components/presets/AutopilotDashboardWidget';

export function AutopilotDashboardPage() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Autopilot Dashboard</h1>
      <AutopilotDashboardWidget />
    </div>
  );
}

export default AutopilotDashboardPage;

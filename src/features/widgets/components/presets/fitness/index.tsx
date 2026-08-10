/**
 * Wellness Widget - Complete health & fitness tracker
 * 
 * This widget wraps the existing fitness module components
 * and integrates them with the widget system.
 * Now includes wellness features: vitals, profile, gamification.
 * 
 * @see ADR-025: Fitness Module - LiftShift Clone
 * @see ADR-027: Wellness Ecosystem
 */

import { cn } from '@/shared/utils/cn';
import type { FitnessWidgetConfig, FitnessTab } from '../../../types/fitness.types';
import { FitnessProvider, useFitnessContext } from './FitnessContext';

// Fitness components
import { ExerciseList } from '@/features/fitness/components/ExerciseList';
import { WorkoutHistory } from '@/features/fitness/components/WorkoutHistory';
import { CSVImport } from '@/features/fitness/components/CSVImport';

// Integrated Wellness Dashboard (combines fitness + wellness)
import { IntegratedDashboard } from '@/features/wellness/components/IntegratedDashboard';
import { WellnessWidget as WellnessPanel } from '@/features/wellness/components/WellnessWidget';

const tabs: { id: FitnessTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Главная', icon: '📊' },
  { id: 'wellness', label: 'Здоровье', icon: '❤️' },
  { id: 'exercises', label: 'Упражнения', icon: '💪' },
  { id: 'history', label: 'История', icon: '📅' },
  { id: 'import', label: 'Импорт', icon: '📥' },
];

/**
 * Internal component that uses context
 */
function FitnessInternal() {
  const { activeTab, setActiveTab, spaceId } = useFitnessContext();
  
  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      {/* Header with tabs */}
      <div className="flex-shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">💪</span>
            <span className="font-semibold text-[var(--text-primary)]">Wellness</span>
          </div>
          <div className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors',
                  activeTab === tab.id
                    ? 'bg-[var(--color-primary-500)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                )}
              >
                <span>{tab.icon}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'dashboard' && (
          <IntegratedDashboard spaceId={spaceId} />
        )}
        {activeTab === 'wellness' && (
          <WellnessPanel spaceId={spaceId} />
        )}
        {activeTab === 'exercises' && (
          <ExerciseList spaceId={spaceId} />
        )}
        {activeTab === 'history' && (
          <WorkoutHistory spaceId={spaceId} />
        )}
        {activeTab === 'import' && (
          <div className="max-w-xl">
            <CSVImport 
              spaceId={spaceId} 
              onSuccess={() => {
                // Switch to dashboard to see imported data
                setActiveTab('dashboard');
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export interface FitnessWidgetProps {
  config: FitnessWidgetConfig;
  spaceId: number;
  isEditMode?: boolean;
}

/**
 * Main FitnessWidget component
 * Wraps everything in the context provider
 */
export function FitnessWidget({ config, spaceId, isEditMode }: FitnessWidgetProps) {
  return (
    <FitnessProvider config={config || {}} spaceId={spaceId} isEditMode={isEditMode}>
      <FitnessInternal />
    </FitnessProvider>
  );
}

export default FitnessWidget;

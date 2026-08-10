/**
 * ADR-025: Fitness Page
 * Main page with tabs: Dashboard, Exercises, History, Import
 */

import { logger } from '@/shared/utils/logger';
import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { FitnessDashboard } from '../components/FitnessDashboard';
import { ExerciseList } from '../components/ExerciseList';
import { WorkoutHistory } from '../components/WorkoutHistory';
import { CSVImport } from '../components/CSVImport';
import type { FitnessTab } from '../types';

export interface FitnessPageProps {
  spaceId: number;
}

const tabs: { id: FitnessTab; label: string; icon: string }[] = [
  { id: 'dashboard', label: 'Главная', icon: '📊' },
  { id: 'exercises', label: 'Упражнения', icon: '💪' },
  { id: 'history', label: 'История', icon: '📅' },
  { id: 'import', label: 'Импорт', icon: '📥' },
];

export function FitnessPage({ spaceId }: FitnessPageProps) {
  const [activeTab, setActiveTab] = useState<FitnessTab>('dashboard');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] px-6 py-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">🏋️ Фитнес</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Трекер тренировок и аналитика
        </p>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]">
        <div className="flex gap-1 px-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                activeTab === tab.id
                  ? 'border-[var(--color-primary-500)] text-[var(--color-primary-500)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'dashboard' && (
          <FitnessDashboard spaceId={spaceId} />
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
              onSuccess={(result) => {
                logger.debug('Import success:', result);
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

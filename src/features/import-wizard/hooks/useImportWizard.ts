import { useState } from 'react';
import { ImportTableConfig, SyncConfig } from '../types/importWizard.types';

const defaultSyncConfig: SyncConfig = {
  enabled: true,
  interval_minutes: 60,
  auto_archive_deleted: true
};

export function useImportWizard() {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<Partial<ImportTableConfig>>({
    syncConfig: defaultSyncConfig,
    customColumns: []
  });

  const updateConfig = (updates: Partial<ImportTableConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const nextStep = () => {
    setStep(prev => Math.min(prev + 1, 6));
  };

  const prevStep = () => {
    setStep(prev => Math.max(prev - 1, 1));
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 1: // Select Data Source
        return !!config.dataSourceId;
      case 2: // Choose Table
        return !!config.tableName;
      case 3: // Select ID Column
        return !!config.idColumn && config.idColumnValid !== false;
      case 4: // Configure Sync
        return !!config.syncConfig;
      case 5: // Add Custom Columns (optional)
        return true; // Always can proceed
      case 6: // Preview
        return true;
      default:
        return false;
    }
  };

  const reset = () => {
    setStep(1);
    setConfig({
      syncConfig: defaultSyncConfig,
      customColumns: []
    });
  };

  return {
    step,
    config,
    nextStep,
    prevStep,
    updateConfig,
    canProceed,
    reset,
    totalSteps: 6
  };
}

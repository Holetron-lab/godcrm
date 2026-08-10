import { useState } from 'react';
import { logger } from '@/shared/utils/logger';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useImportWizard } from '../hooks/useImportWizard';
import { SelectDataSourceStep } from './steps/SelectDataSourceStep';
import { ChooseTableStep } from './steps/ChooseTableStep';
import { SelectIdColumnStep } from './steps/SelectIdColumnStep';
import { ConfigureSyncStep } from './steps/ConfigureSyncStep';
import { AddCustomColumnsStep } from './steps/AddCustomColumnsStep';
import { PreviewStep } from './steps/PreviewStep';

interface ImportTableWizardProps {
  workspaceId: string;
  projectId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportTableWizard({ 
  workspaceId, 
  projectId,
  onClose, 
  onSuccess 
}: ImportTableWizardProps) {
  const { t, language } = useLanguage();
  const { step, config, nextStep, prevStep, updateConfig, canProceed, totalSteps } = useImportWizard();
  const [isImporting, setIsImporting] = useState(false);

  const stepTitles = {
    en: [
      'Select Data Source',
      'Choose Table',
      'Select ID Column',
      'Configure Sync',
      'Add Custom Columns (Optional)',
      'Preview & Confirm'
    ],
    ru: [
      'Выбор источника данных',
      'Выбор таблицы',
      'Выбор ID колонки',
      'Настройка синхронизации',
      'Добавить кастомные поля (опционально)',
      'Просмотр и подтверждение'
    ]
  };

  const handleImport = async () => {
    setIsImporting(true);
    
    try {
      // TODO: Call API to import table
      const payload = {
        workspace_id: workspaceId,
        project_id: projectId,
        data_source_id: config.dataSourceId!,
        source_table_name: config.tableName!,
        source_id_column: config.idColumn!,
        display_name: config.displayName || config.tableName!,
        description: config.description,
        icon: config.icon || '📊',
        table_type: (config.customColumns && config.customColumns.length > 0) ? 'hybrid' : 'external',
        sync_enabled: config.syncConfig!.enabled,
        sync_interval_minutes: config.syncConfig!.interval_minutes,
        custom_columns: config.customColumns
      };

      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      onSuccess();
      onClose();
    } catch (error) {
      logger.error('Import failed:', error);
    } finally {
      setIsImporting(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <SelectDataSourceStep
            workspaceId={workspaceId}
            selectedId={config.dataSourceId}
            onSelect={(id) => updateConfig({ dataSourceId: id })}
          />
        );
      case 2:
        return (
          <ChooseTableStep
            dataSourceId={config.dataSourceId!}
            selectedTable={config.tableName}
            onSelect={(name, info) => updateConfig({ tableName: name, tableInfo: info })}
          />
        );
      case 3:
        return (
          <SelectIdColumnStep
            tableInfo={config.tableInfo!}
            selectedColumn={config.idColumn}
            onSelect={(col, isValid) => updateConfig({ idColumn: col, idColumnValid: isValid })}
          />
        );
      case 4:
        return (
          <ConfigureSyncStep
            config={config.syncConfig!}
            onChange={(syncConfig) => updateConfig({ syncConfig })}
          />
        );
      case 5:
        return (
          <AddCustomColumnsStep
            columns={config.customColumns || []}
            onChange={(customColumns) => updateConfig({ customColumns })}
          />
        );
      case 6:
        return (
          <PreviewStep
            config={config}
            onUpdateMeta={(meta) => updateConfig(meta)}
          />
        );
      default:
        return null;
    }
  };

  return (
    <Modal
      open={true}
      onOpenChange={onClose}
      title={`${stepTitles[language][step - 1]} (${step}/${totalSteps})`}
      size="xl"
    >
      <div className="space-y-6">
        {/* Progress Bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className="bg-primary-500 dark:bg-primary-400 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>

        {/* Step Content */}
        <div className="min-h-[400px]">
          {renderStep()}
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="secondary"
            onClick={onClose}
          >
            {language === 'ru' ? 'Отмена' : 'Cancel'}
          </Button>

          <div className="flex gap-2">
            {step > 1 && (
              <Button
                variant="secondary"
                onClick={prevStep}
              >
                ← {language === 'ru' ? 'Назад' : 'Back'}
              </Button>
            )}

            {step < totalSteps && (
              <Button
                variant="primary"
                onClick={nextStep}
                disabled={!canProceed()}
              >
                {language === 'ru' ? 'Далее' : 'Next'} →
              </Button>
            )}

            {step === totalSteps && (
              <Button
                variant="primary"
                onClick={handleImport}
                disabled={!canProceed() || isImporting}
              >
                {isImporting 
                  ? (language === 'ru' ? 'Импорт...' : 'Importing...') 
                  : (language === 'ru' ? 'Импортировать таблицу' : 'Import Table')
                }
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { useWidgetCreate } from './useWidgetCreate';
import { ProgressHeader } from './ProgressHeader';
import { PresetStep } from './PresetStep';
import { TableStep } from './TableStep';
import { MappingStep } from './MappingStep';
import { ConfigStep } from './ConfigStep';

export function WidgetCreatePage() {
  const {
    navigate,
    projectId,
    step,
    setStep,
    selectedPreset,
    setSelectedPreset,
    widgetPresets,
    handlePresetSelect,
    presetRequiresTable,
    selectedTable,
    tableMappings,
    setTableMappings,
    isTableMappingComplete,
    columns,
    columnsLoading,
    columnMapping,
    setColumnMapping,
    allRequiredMapped,
    visibleColumns,
    setVisibleColumns,
    widgetTitle,
    setWidgetTitle,
    widgetIcon,
    setWidgetIcon,
    effectiveProjectId,
    dashboard,
    dashboardLoading,
    dashboardError,
    createWidget,
    handleCreateWidget,
    getSteps,
  } = useWidgetCreate();

  return (
    <div className="h-full -m-6 flex flex-col bg-[var(--bg-primary)]">
      <ProgressHeader
        selectedTable={selectedTable}
        step={step}
        getSteps={getSteps}
        onBack={() => navigate(-1)}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-8">
          {step === 'preset' && (
            <PresetStep
              widgetPresets={widgetPresets}
              onPresetSelect={handlePresetSelect}
              setSelectedPreset={setSelectedPreset}
              setWidgetTitle={setWidgetTitle}
              setStep={setStep}
            />
          )}

          {step === 'table' && selectedPreset && (
            <TableStep
              selectedPreset={selectedPreset}
              tableMappings={tableMappings}
              onMappingsChange={setTableMappings}
              isTableMappingComplete={isTableMappingComplete}
              defaultProjectId={projectId ? Number(projectId) : undefined}
              setStep={setStep}
            />
          )}

          {step === 'mapping' && selectedPreset && (
            <MappingStep
              selectedPreset={selectedPreset}
              columns={columns}
              columnsLoading={columnsLoading}
              columnMapping={columnMapping}
              setColumnMapping={setColumnMapping}
              allRequiredMapped={allRequiredMapped}
              setStep={setStep}
            />
          )}

          {step === 'config' && selectedPreset && (
            <ConfigStep
              selectedPreset={selectedPreset}
              selectedTable={selectedTable}
              columns={columns}
              columnMapping={columnMapping}
              visibleColumns={visibleColumns}
              setVisibleColumns={setVisibleColumns}
              widgetTitle={widgetTitle}
              setWidgetTitle={setWidgetTitle}
              widgetIcon={widgetIcon}
              setWidgetIcon={setWidgetIcon}
              presetRequiresTable={presetRequiresTable}
              effectiveProjectId={effectiveProjectId}
              dashboard={dashboard}
              dashboardLoading={dashboardLoading}
              dashboardError={dashboardError as Error | null}
              createWidget={createWidget}
              handleCreateWidget={handleCreateWidget}
              setStep={setStep}
              onCancel={() => navigate(-1)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { Checkbox } from '@/shared/components/ui/Checkbox';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import {
  LayoutGrid,
  Rows3,
  Columns3,
  GitBranch,
  FolderTree,
  Layers,
  Minus,
  Plus,
  Move,
  Pin
} from 'lucide-react';

export interface LayoutSettings {
  // Grid settings
  gridEnabled: boolean;
  gridCols: number;
  gridRows: number;
  gridDirection: 'horizontal' | 'vertical'; // horizontal = fill rows first, vertical = fill cols first

  // Hierarchy settings
  hierarchyEnabled: boolean;
  widgetsAbove: boolean;    // Widgets above their linked tables
  formsBelow: boolean;      // Forms below their linked tables

  // Relations settings
  relationsEnabled: boolean;
  connectedLeft: boolean;   // Connected tables on left
  isolatedRight: boolean;   // Isolated tables on right

  // Project grouping
  projectGroupEnabled: boolean;
  projectGap: number;       // Gap between project groups

  // Spacing settings
  gapX: number;             // Horizontal gap between nodes
  gapY: number;             // Vertical gap between nodes
}

const defaultSettings: LayoutSettings = {
  gridEnabled: true,
  gridCols: 5,
  gridRows: 5,
  gridDirection: 'horizontal',

  hierarchyEnabled: true,
  widgetsAbove: true,
  formsBelow: true,

  relationsEnabled: false,
  connectedLeft: true,
  isolatedRight: true,

  projectGroupEnabled: false,
  projectGap: 200,

  gapX: 100,
  gapY: 80,
};

interface LayoutSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (settings: LayoutSettings) => void;
  /** Number of position-locked tables; shown as a hint because auto-layout leaves them in place. */
  pinnedCount?: number;
}

export const LayoutSettingsModal = ({
  open,
  onOpenChange,
  onApply,
  pinnedCount = 0,
}: LayoutSettingsModalProps) => {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<LayoutSettings>(defaultSettings);

  const handleApply = () => {
    onApply(settings);
    onOpenChange(false);
  };

  const updateSetting = <K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const NumberInput = ({
    value,
    onChange,
    min = 1,
    max = 20,
    label
  }: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    label: string;
  }) => (
    <div className="flex items-center gap-2">
      <span className="text-sm text-[var(--text-secondary)] w-36">{label}</span>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
        aria-label={`${label} −`}
      >
        <Minus className="w-4 h-4" />
      </button>
      <span className="w-8 text-center font-medium">{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
        aria-label={`${label} +`}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );

  const summary = [
    settings.gridEnabled && (settings.gridDirection === 'horizontal'
      ? t('schemaEditor.layout.summaryGridRows', { count: settings.gridRows })
      : t('schemaEditor.layout.summaryGridColumns', { count: settings.gridCols })),
    settings.hierarchyEnabled && t('schemaEditor.layout.summaryHierarchy'),
    settings.relationsEnabled && t('schemaEditor.layout.summaryRelations'),
    settings.projectGroupEnabled && t('schemaEditor.layout.summaryProjects'),
  ].filter(Boolean).join(' → ') || t('schemaEditor.layout.summaryEmpty');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('schemaEditor.layout.title')}
      className="max-w-lg"
    >
      <div className="space-y-6">
        {/* Grid Settings */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={settings.gridEnabled}
              onCheckedChange={(checked) => updateSetting('gridEnabled', !!checked)}
            />
            <LayoutGrid className="w-5 h-5 text-[var(--accent-primary)]" />
            <span className="font-medium">{t('schemaEditor.layout.grid')}</span>
          </div>

          {settings.gridEnabled && (
            <div className="ml-8 space-y-2 p-3 bg-[var(--bg-tertiary)] rounded-lg">
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="gridDirection"
                    checked={settings.gridDirection === 'horizontal'}
                    onChange={() => updateSetting('gridDirection', 'horizontal')}
                    className="accent-[var(--accent-primary)]"
                  />
                  <Rows3 className="w-4 h-4" />
                  <span className="text-sm">{t('schemaEditor.layout.byRows')}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="gridDirection"
                    checked={settings.gridDirection === 'vertical'}
                    onChange={() => updateSetting('gridDirection', 'vertical')}
                    className="accent-[var(--accent-primary)]"
                  />
                  <Columns3 className="w-4 h-4" />
                  <span className="text-sm">{t('schemaEditor.layout.byColumns')}</span>
                </label>
              </div>

              {settings.gridDirection === 'horizontal' ? (
                <NumberInput
                  label={t('schemaEditor.layout.rows')}
                  value={settings.gridRows}
                  onChange={(v) => updateSetting('gridRows', v)}
                  min={2}
                  max={15}
                />
              ) : (
                <NumberInput
                  label={t('schemaEditor.layout.columns')}
                  value={settings.gridCols}
                  onChange={(v) => updateSetting('gridCols', v)}
                  min={2}
                  max={10}
                />
              )}
            </div>
          )}
        </div>

        {/* Hierarchy Settings */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={settings.hierarchyEnabled}
              onCheckedChange={(checked) => updateSetting('hierarchyEnabled', !!checked)}
            />
            <Layers className="w-5 h-5 text-purple-500" />
            <span className="font-medium">{t('schemaEditor.layout.hierarchy')}</span>
          </div>

          {settings.hierarchyEnabled && (
            <div className="ml-8 space-y-2 p-3 bg-[var(--bg-tertiary)] rounded-lg">
              <Checkbox
                label={t('schemaEditor.layout.widgetsAbove')}
                checked={settings.widgetsAbove}
                onCheckedChange={(checked) => updateSetting('widgetsAbove', !!checked)}
              />
              <Checkbox
                label={t('schemaEditor.layout.formsBelow')}
                checked={settings.formsBelow}
                onCheckedChange={(checked) => updateSetting('formsBelow', !!checked)}
              />
            </div>
          )}
        </div>

        {/* Relations Settings */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={settings.relationsEnabled}
              onCheckedChange={(checked) => updateSetting('relationsEnabled', !!checked)}
            />
            <GitBranch className="w-5 h-5 text-green-500" />
            <span className="font-medium">{t('schemaEditor.layout.relations')}</span>
          </div>

          {settings.relationsEnabled && (
            <div className="ml-8 space-y-2 p-3 bg-[var(--bg-tertiary)] rounded-lg">
              <Checkbox
                label={t('schemaEditor.layout.connectedLeft')}
                checked={settings.connectedLeft}
                onCheckedChange={(checked) => updateSetting('connectedLeft', !!checked)}
              />
              <Checkbox
                label={t('schemaEditor.layout.isolatedRight')}
                checked={settings.isolatedRight}
                onCheckedChange={(checked) => updateSetting('isolatedRight', !!checked)}
              />
            </div>
          )}
        </div>

        {/* Project Grouping */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={settings.projectGroupEnabled}
              onCheckedChange={(checked) => updateSetting('projectGroupEnabled', !!checked)}
            />
            <FolderTree className="w-5 h-5 text-orange-500" />
            <span className="font-medium">{t('schemaEditor.layout.projectGroup')}</span>
          </div>

          {settings.projectGroupEnabled && (
            <div className="ml-8 space-y-2 p-3 bg-[var(--bg-tertiary)] rounded-lg">
              <NumberInput
                label={t('schemaEditor.layout.projectGap')}
                value={settings.projectGap}
                onChange={(v) => updateSetting('projectGap', v)}
                min={50}
                max={500}
              />
            </div>
          )}
        </div>

        {/* Spacing Settings */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Move className="w-5 h-5 text-cyan-500" />
            <span className="font-medium">{t('schemaEditor.layout.spacing')}</span>
          </div>

          <div className="ml-8 space-y-2 p-3 bg-[var(--bg-tertiary)] rounded-lg">
            <NumberInput
              label={t('schemaEditor.layout.gapX')}
              value={settings.gapX}
              onChange={(v) => updateSetting('gapX', v)}
              min={20}
              max={300}
            />
            <NumberInput
              label={t('schemaEditor.layout.gapY')}
              value={settings.gapY}
              onChange={(v) => updateSetting('gapY', v)}
              min={20}
              max={300}
            />
          </div>
        </div>

        {/* Summary */}
        <div className="px-3 py-2 bg-[var(--bg-secondary)] rounded-lg text-sm text-[var(--text-muted)]">
          {summary}
        </div>

        {pinnedCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Pin className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
            <span>{t('schemaEditor.layout.pinnedHint')} ({pinnedCount})</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-[var(--border-primary)]">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          {t('common.cancel')}
        </Button>
        <Button onClick={handleApply}>
          {t('schemaEditor.layout.apply')}
        </Button>
      </div>
    </Modal>
  );
};

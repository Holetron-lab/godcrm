/**
 * RelationAccordions - Relation (data source) and BackLink accordion sections
 */
import { useId } from 'react';
import { ChevronRight, Database, Link2 } from 'lucide-react';
import { Switch } from '@/shared/components/ui';
import { useTableColumns } from '../../hooks/useTableColumns';
import type { ProjectWithTables } from './types';

type SettingsSection = 'layout' | 'behavior' | 'type' | 'display' | 'relation' | 'backlink' | null;

interface RelationAccordionsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any;
  onUpdate: (field: string, value: unknown) => void;
  projects: ProjectWithTables[];
  settingsSection: SettingsSection;
  onSetSection: (section: SettingsSection) => void;
}

export const RelationAccordions = ({
  config,
  onUpdate,
  projects,
  settingsSection,
  onSetSection
}: RelationAccordionsProps) => {
  const id = useId();

  // Relation config
  const relationConfig = (config.relation as Record<string, unknown>) || {};
  const relationEnabled = (relationConfig.enabled as boolean) || false;
  const relationTableId = (relationConfig.tableId as string) || '';
  const relationLabelColumn = (relationConfig.labelColumn as string) || '';

  // BackLink config
  const backLinkConfig = (config.backLink as Record<string, unknown>) || {};
  const backLinkEnabled = (backLinkConfig.enabled as boolean) || false;
  const backLinkTableId = (backLinkConfig.targetTableId as string) || '';
  const backLinkColumnId = (backLinkConfig.targetColumnId as string) || '';
  const backLinkDisplayColumn = (backLinkConfig.displayColumn as string) || '';

  // Selected relation table columns
  const { data: relationColumns = [] } = useTableColumns(
    relationEnabled && relationTableId ? relationTableId : undefined,
    true
  );

  // BackLink table columns
  const { data: backLinkColumns = [] } = useTableColumns(
    backLinkEnabled && backLinkTableId ? backLinkTableId : undefined,
    true
  );

  return (
    <>
      {/* Relation accordion */}
      <div className="rounded-lg border border-[var(--border-secondary)]">
        <div className="w-full flex items-center gap-2 p-2 rounded-t-lg">
          <Switch
            aria-label="Источник данных"
            checked={relationEnabled}
            onCheckedChange={(v) => {
              onUpdate('config.relation.enabled', v);
              if (!v) {
                onUpdate('config.relation.tableId', '');
                onUpdate('config.relation.valueColumn', '');
                onUpdate('config.relation.labelColumn', '');
              }
            }}
          />
          <button
            type="button"
            onClick={() => onSetSection(settingsSection === 'relation' ? null : 'relation')}
            aria-expanded={settingsSection === 'relation'}
            aria-controls={settingsSection === 'relation' ? `${id}-relation-panel` : undefined}
            className="flex flex-1 items-center gap-2 text-left hover:bg-[var(--bg-tertiary)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'relation' ? 'rotate-90' : ''}`} />
            <Database className="w-3 h-3 text-primary-400" />
            <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Источник данных</span>
          </button>
        </div>
        {settingsSection === 'relation' && (
          <div id={`${id}-relation-panel`} className="px-3 pb-3 space-y-2">
            {relationEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`${id}-relationTableId`} className="text-xs text-[var(--text-tertiary)] mb-1 block">Связанная таблица</label>
                    <select
                      id={`${id}-relationTableId`}
                      value={relationTableId}
                      onChange={(e) => {
                        onUpdate('config.relation.tableId', e.target.value);
                        onUpdate('config.relation.valueColumn', '');
                        onUpdate('config.relation.labelColumn', '');
                      }}
                      className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-primary-500/30 text-sm text-[var(--text-primary)]"
                    >
                      <option value="">{'\u2014'} Выберите таблицу {'\u2014'}</option>
                      {projects.map(p => (
                        <optgroup key={p.id} label={`${p.icon || '\uD83D\uDCC2'} ${p.name}`}>
                          {p.tables.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.icon || '\uD83D\uDCCB'} {t.displayName} ({t.id})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  {relationTableId && relationColumns.length > 0 && (
                    <div>
                      <label htmlFor={`${id}-relationLabelColumn`} className="text-xs text-[var(--text-tertiary)] mb-1 block">Колонка отображения</label>
                      <select
                        id={`${id}-relationLabelColumn`}
                        value={relationLabelColumn}
                        onChange={(e) => onUpdate('config.relation.labelColumn', e.target.value)}
                        className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                      >
                        <option value="">{'\u2014'} Выберите {'\u2014'}</option>
                        {relationColumns.map(c => (
                          <option key={c.name} value={c.name}>
                            {c.displayName || c.name} ({c.type})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                {relationTableId && (
                  <p className="text-xs text-primary-400/70">
                    Значения связываются по row_id с таблицей
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-tertiary)]">
                Включите переключатель чтобы настроить источник данных
              </p>
            )}
          </div>
        )}
      </div>

      {/* BackLink accordion */}
      <div className="rounded-lg border border-[var(--border-secondary)]">
        <div className="w-full flex items-center gap-2 p-2 rounded-t-lg">
          <Switch
            aria-label="Обратная связь"
            checked={backLinkEnabled}
            onCheckedChange={(v) => {
              onUpdate('config.backLink.enabled', v);
              if (!v) {
                onUpdate('config.backLink.targetTableId', '');
                onUpdate('config.backLink.targetColumnId', '');
                onUpdate('config.backLink.displayColumn', '');
              }
            }}
          />
          <button
            type="button"
            onClick={() => onSetSection(settingsSection === 'backlink' ? null : 'backlink')}
            aria-expanded={settingsSection === 'backlink'}
            aria-controls={settingsSection === 'backlink' ? `${id}-backlink-panel` : undefined}
            className="flex flex-1 items-center gap-2 text-left hover:bg-[var(--bg-tertiary)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'backlink' ? 'rotate-90' : ''}`} />
            <Link2 className="w-3 h-3 text-purple-400" />
            <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Обратная связь</span>
          </button>
        </div>
        {settingsSection === 'backlink' && (
          <div id={`${id}-backlink-panel`} className="px-3 pb-3 space-y-2">
            {backLinkEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor={`${id}-backLinkTableId`} className="text-xs text-[var(--text-tertiary)] mb-1 block">Целевая таблица</label>
                    <select
                      id={`${id}-backLinkTableId`}
                      value={backLinkTableId}
                      onChange={(e) => {
                        onUpdate('config.backLink.targetTableId', e.target.value);
                        onUpdate('config.backLink.targetColumnId', '');
                        onUpdate('config.backLink.displayColumn', '');
                      }}
                      className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-purple-500/30 text-sm text-[var(--text-primary)]"
                    >
                      <option value="">{'\u2014'} Выберите таблицу {'\u2014'}</option>
                      {projects.map(p => (
                        <optgroup key={p.id} label={`${p.icon || '\uD83D\uDCC2'} ${p.name}`}>
                          {p.tables.map(t => (
                            <option key={t.id} value={t.id}>
                              {t.icon || '\uD83D\uDCCB'} {t.displayName} ({t.id})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  {backLinkTableId && backLinkColumns.length > 0 && (
                    <>
                      <div>
                        <label htmlFor={`${id}-backLinkColumnId`} className="text-xs text-[var(--text-tertiary)] mb-1 block">Целевая колонка</label>
                        <select
                          id={`${id}-backLinkColumnId`}
                          value={backLinkColumnId}
                          onChange={(e) => onUpdate('config.backLink.targetColumnId', e.target.value)}
                          className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                        >
                          <option value="">{'\u2014'} Выберите {'\u2014'}</option>
                          {backLinkColumns.map(c => (
                            <option key={c.name} value={c.name}>
                              {c.displayName || c.name} ({c.type})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor={`${id}-backLinkDisplayColumn`} className="text-xs text-[var(--text-tertiary)] mb-1 block">Колонка отображения</label>
                        <select
                          id={`${id}-backLinkDisplayColumn`}
                          value={backLinkDisplayColumn}
                          onChange={(e) => onUpdate('config.backLink.displayColumn', e.target.value)}
                          className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                        >
                          <option value="">{'\u2014'} Выберите {'\u2014'}</option>
                          {backLinkColumns.map(c => (
                            <option key={c.name} value={c.name}>
                              {c.displayName || c.name} ({c.type})
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
                {backLinkTableId && (
                  <p className="text-xs text-purple-400/70">
                    Показывает записи из целевой таблицы, ссылающиеся на эту строку
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-[var(--text-tertiary)]">
                Включите переключатель чтобы настроить обратную связь
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
};

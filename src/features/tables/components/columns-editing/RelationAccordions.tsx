/**
 * RelationAccordions - Relation (data source) and BackLink accordion sections
 */
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
        <div
          onClick={() => onSetSection(settingsSection === 'relation' ? null : 'relation')}
          className="w-full flex items-center gap-2 p-2 hover:bg-[var(--bg-tertiary)] rounded-t-lg cursor-pointer"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'relation' ? 'rotate-90' : ''}`} />
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
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
          </div>
          <Database className="w-3 h-3 text-primary-400" />
          <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Источник данных</span>
        </div>
        {settingsSection === 'relation' && (
          <div className="px-3 pb-3 space-y-2">
            {relationEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Связанная таблица</label>
                    <select
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
                      <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Колонка отображения</label>
                      <select
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
        <div
          onClick={() => onSetSection(settingsSection === 'backlink' ? null : 'backlink')}
          className="w-full flex items-center gap-2 p-2 hover:bg-[var(--bg-tertiary)] rounded-t-lg cursor-pointer"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'backlink' ? 'rotate-90' : ''}`} />
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
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
          </div>
          <Link2 className="w-3 h-3 text-purple-400" />
          <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Обратная связь</span>
        </div>
        {settingsSection === 'backlink' && (
          <div className="px-3 pb-3 space-y-2">
            {backLinkEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Целевая таблица</label>
                    <select
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
                        <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Целевая колонка</label>
                        <select
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
                        <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Колонка отображения</label>
                        <select
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

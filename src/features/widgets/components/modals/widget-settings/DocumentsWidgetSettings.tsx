import type { DocumentsSettingsProps } from './types';

export function DocumentsWidgetSettings({
  spaces,
  documentsSpaceId,
  setDocumentsSpaceId,
  documentsProjectId,
  setDocumentsProjectId,
  documentsTableId,
  setDocumentsTableId,
  sectionsTableId,
  setSectionsTableId,
  documentsSpaceProjects,
  documentsProjectTables,
  creatingDocumentsTables,
  handleCreateDocumentsTables,
  ticketsTableId,
  setTicketsTableId,
  ticketsColTitle,
  setTicketsColTitle,
  ticketsColDesc,
  setTicketsColDesc,
  ticketsColType,
  setTicketsColType,
  ticketsColState,
  setTicketsColState,
  ticketsColPriority,
  setTicketsColPriority,
  creatingTicketsTable,
  handleCreateTicketsTable,
  handleTicketsTableChange,
}: DocumentsSettingsProps) {
  return (
    <>
      <div className="bg-[var(--bg-tertiary)] rounded-lg p-3 mb-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Documents использует 2 таблицы: Documents и Document Sections.
        </p>
      </div>

      {/* Space Selection */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          Пространство
        </label>
        <select
          value={documentsSpaceId}
          onChange={(e) => {
            setDocumentsSpaceId(e.target.value);
            setDocumentsProjectId('');
            setDocumentsTableId('');
            setSectionsTableId('');
          }}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
        >
          <option value="">Выберите пространство</option>
          {spaces.map((space) => (
            <option key={String(space.id)} value={String(space.id)}>
              {space.icon || '🏢'} {space.name}
            </option>
          ))}
        </select>
      </div>

      {/* Project Selection */}
      {documentsSpaceId && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Проект
          </label>
          <select
            value={documentsProjectId}
            onChange={(e) => {
              setDocumentsProjectId(e.target.value);
              setDocumentsTableId('');
              setSectionsTableId('');
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          >
            <option value="">Выберите проект</option>
            {documentsSpaceProjects.map((project) => (
              <option key={String(project.id)} value={String(project.id)}>
                {project.icon || '📁'} {project.name} {project.type === 'system_data' ? '(System)' : ''} &bull; ID: {String(project.id)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Documents Table */}
      {documentsProjectId && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Таблица документов
          </label>
          <select
            value={documentsTableId}
            onChange={(e) => {
              if (e.target.value === '__create_documents__') {
                handleCreateDocumentsTables();
              } else {
                setDocumentsTableId(e.target.value);
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            disabled={creatingDocumentsTables}
          >
            <option value="">Выберите таблицу</option>
            {documentsProjectTables.map((table) => (
              <option key={String(table.id)} value={String(table.id)}>
                {table.icon} {table.displayName || table.name} &bull; ID: {String(table.id)} {table.key ? `\u2022 ${table.key}` : ''}
              </option>
            ))}
            <option value="__create_documents__">
              {creatingDocumentsTables ? 'Создание...' : 'Создать таблицы Documents'}
            </option>
          </select>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Список документов с категориями и статусами
          </p>
        </div>
      )}

      {/* Sections Table */}
      {documentsProjectId && (
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Таблица секций (атомов)
          </label>
          <select
            value={sectionsTableId}
            onChange={(e) => setSectionsTableId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
          >
            <option value="">Выберите таблицу</option>
            {documentsProjectTables.map((table) => (
              <option key={String(table.id)} value={String(table.id)}>
                {table.icon} {table.displayName || table.name} &bull; ID: {String(table.id)} {table.key ? `\u2022 ${table.key}` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Атомарные секции контента (endpoints, концепты, how-to)
          </p>
        </div>
      )}

      {/* Tickets Table */}
      {documentsProjectId && (
        <div className="border-t border-[var(--border-primary)] pt-4 mt-4">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
            Таблица тикетов
          </label>
          <select
            value={ticketsTableId}
            onChange={(e) => {
              if (e.target.value === '__create_tickets__') {
                handleCreateTicketsTable();
              } else {
                handleTicketsTableChange(e.target.value);
              }
            }}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            disabled={creatingTicketsTable}
          >
            <option value="">Авто-определение (Tickets/Tasks)</option>
            {documentsProjectTables.map((table) => (
              <option key={String(table.id)} value={String(table.id)}>
                {table.icon} {table.displayName || table.name} &bull; ID: {String(table.id)}
              </option>
            ))}
            <option value="__create_tickets__">
              {creatingTicketsTable ? 'Создание...' : 'Создать таблицу Tickets'}
            </option>
          </select>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            Пусто = авто-поиск таблицы &quot;Tickets&quot; или &quot;Tasks&quot; в проекте
          </p>

          {/* Column mapping (shown when table selected) */}
          {ticketsTableId && (
            <div className="mt-3 space-y-2 bg-[var(--bg-tertiary)] rounded-lg p-3">
              <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Маппинг колонок:</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[var(--text-tertiary)]">Заголовок *</label>
                  <input
                    type="text"
                    value={ticketsColTitle}
                    onChange={(e) => setTicketsColTitle(e.target.value)}
                    placeholder="what / title / name"
                    className="w-full px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-tertiary)]">Описание</label>
                  <input
                    type="text"
                    value={ticketsColDesc}
                    onChange={(e) => setTicketsColDesc(e.target.value)}
                    placeholder="why / description"
                    className="w-full px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-tertiary)]">Тип</label>
                  <input
                    type="text"
                    value={ticketsColType}
                    onChange={(e) => setTicketsColType(e.target.value)}
                    placeholder="type / task_type"
                    className="w-full px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-tertiary)]">Статус</label>
                  <input
                    type="text"
                    value={ticketsColState}
                    onChange={(e) => setTicketsColState(e.target.value)}
                    placeholder="state / status"
                    className="w-full px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[var(--text-tertiary)]">Приоритет</label>
                  <input
                    type="text"
                    value={ticketsColPriority}
                    onChange={(e) => setTicketsColPriority(e.target.value)}
                    placeholder="priority"
                    className="w-full px-2 py-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      {(documentsTableId || sectionsTableId || ticketsTableId) && (() => {
        const registryName = documentsProjectTables.find(t => String(t.id) === documentsTableId);
        const atomsName = documentsProjectTables.find(t => String(t.id) === sectionsTableId);
        const registryLabel = registryName?.displayName || registryName?.name;
        const atomsLabel = atomsName?.displayName || atomsName?.name;
        return (
          <div className="bg-[var(--bg-tertiary)] rounded-lg p-3 mt-2">
            <p className="text-xs font-medium text-[var(--text-secondary)] mb-1">Настроено:</p>
            <div className="text-xs text-[var(--text-tertiary)] space-y-0.5">
              {documentsTableId && (
                <p>
                  Stored on: <span className="font-mono text-[var(--text-secondary)]">{registryLabel || `ID ${documentsTableId}`}</span>
                  {sectionsTableId && (
                    <>
                      {' '}
                      (atoms: <span className="font-mono text-[var(--text-secondary)]">{atomsLabel || `ID ${sectionsTableId}`}</span>)
                    </>
                  )}
                </p>
              )}
              {!documentsTableId && sectionsTableId && (
                <p>Atoms: <span className="font-mono text-[var(--text-secondary)]">{atomsLabel || `ID ${sectionsTableId}`}</span></p>
              )}
              {ticketsTableId && <p>Tickets: ID {ticketsTableId} ({ticketsColTitle})</p>}
              {!ticketsTableId && <p>Tickets: авто-определение</p>}
            </div>
          </div>
        );
      })()}
    </>
  );
}

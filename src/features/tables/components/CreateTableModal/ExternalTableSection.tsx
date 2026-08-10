import React from 'react';
import { Select } from '@/shared/components/ui';

interface ExternalTableSectionProps {
  selectedDataSource: string;
  setSelectedDataSource: (value: string) => void;
  selectedExternalTable: string;
  setSelectedExternalTable: (value: string) => void;
  dataSources: Array<{ id: string; name: string; type: string }>;
  externalTables: string[];
  t: (key: string) => string;
}

export const ExternalTableSection = ({
  selectedDataSource,
  setSelectedDataSource,
  selectedExternalTable,
  setSelectedExternalTable,
  dataSources,
  externalTables,
  t,
}: ExternalTableSectionProps) => {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        {t('tables.create.dataSource')}
      </h3>
      <Select
        label={t('tables.create.database')}
        value={selectedDataSource}
        onChange={setSelectedDataSource}
        options={dataSources.map((ds) => ({
          label: `${ds.name} (${ds.type})`,
          value: ds.id
        }))}
        placeholder={t('tables.create.selectDataSource')}
      />
      {selectedDataSource && (
        <Select
          label={t('tables.create.table')}
          value={selectedExternalTable}
          onChange={setSelectedExternalTable}
          options={externalTables.map((table) => ({
            label: table,
            value: table
          }))}
          placeholder={t('tables.create.selectTable')}
        />
      )}
    </section>
  );
};

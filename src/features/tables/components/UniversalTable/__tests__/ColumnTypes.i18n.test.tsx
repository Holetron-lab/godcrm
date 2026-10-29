import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ColumnSettingsDrawer } from '../ColumnSettingsDrawer';
import { TableMenuWidgetToggle } from '../../TableMenuWidgetToggle';
import { createMockColumn, renderWithProviders } from './columnSettingsTestUtils';

vi.mock('@/features/projects/hooks/useProjectTables', () => ({
  useProjectTables: () => ({ tables: [], isLoading: false })
}));

afterEach(() => {
  cleanup();
  localStorage.removeItem('god-crm-language');
});

const LanguageSwitch = () => {
  const { setLanguage } = useLanguage();
  return <button onClick={() => setLanguage('ru')}>Русский</button>;
};

describe('table and column language', () => {
  it('translates the widget toggle and its accessible name when language changes', async () => {
    localStorage.setItem('god-crm-language', 'en');
    const onChange = vi.fn();
    renderWithProviders(<><TableMenuWidgetToggle checked={false} onCheckedChange={onChange} /><LanguageSwitch /></>);
    await userEvent.click(screen.getByRole('switch', { name: 'Add table widget' }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Show this table as a widget in the left menu')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Русский' }));
    expect(screen.getByRole('switch', { name: 'Добавить виджет-таблицу' })).toBeInTheDocument();
    expect(screen.getByText('Отображать таблицу в левом меню как виджет')).toBeInTheDocument();
  });

  for (const language of ['en', 'ru'] as const) {
    it(`localizes column settings and hides obsolete choices in ${language}`, async () => {
      localStorage.setItem('god-crm-language', language);
      renderWithProviders(<ColumnSettingsDrawer column={createMockColumn()} open onOpenChange={vi.fn()} onSave={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Type' : 'Тип' }));
      await userEvent.click(screen.getByRole('combobox', { name: language === 'en' ? 'Column type' : 'Тип столбца' }));
      expect(screen.getByRole('option', { name: language === 'en' ? 'Text' : 'Текст' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: language === 'en' ? 'Date & Time' : 'Дата и время' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: language === 'en' ? 'Time (cron)' : 'Время (крон)' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /^(Date|Дата|Rollup|Сводка)$/ })).not.toBeInTheDocument();
    });
  }

  it('keeps an existing legacy column selected without changing its type', async () => {
    localStorage.setItem('god-crm-language', 'en');
    const onSave = vi.fn();
    renderWithProviders(<ColumnSettingsDrawer column={createMockColumn({ type: 'date' })} open onOpenChange={vi.fn()} onSave={onSave} />);
    await userEvent.click(screen.getByRole('button', { name: 'Type' }));
    expect(screen.getByRole('combobox', { name: 'Column type' })).toHaveTextContent('Date');
    expect(onSave).not.toHaveBeenCalled();
  });
});

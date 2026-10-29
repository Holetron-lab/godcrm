import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { CellFormatSettings } from '../CellFormatSettings';
import { TypographySettings } from '../TypographySettings';
import { SummaryTab } from '../SummaryTab';

const base: ColumnModel = {
  id: 'why', tableId: '1', name: 'why', displayName: 'why', type: 'text', config: {},
  isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true,
};

function CellFixture({ config = {} }: { config?: ColumnModel['config'] }) {
  const [draft, setDraft] = useState<ColumnModel>({ ...base, config });
  return <>
    <CellFormatSettings draft={draft} setDraft={setDraft} />
    <TypographySettings draft={draft} setDraft={setDraft} />
    <output aria-label="Configuration">{JSON.stringify(draft.config)}</output>
  </>;
}

function SummaryFixture({ type }: { type: ColumnModel['type'] }) {
  const [draft, setDraft] = useState<ColumnModel>({ ...base, type });
  return <>
    <SummaryTab draft={draft} setDraft={setDraft} />
    <output aria-label="Configuration">{JSON.stringify(draft.config)}</output>
  </>;
}

const noCyrillic = () => expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/);
const noRawKeys = () => expect(screen.queryByText(/columnSettings\./)).not.toBeInTheDocument();

describe('Cell tab localization', () => {
  it.each([
    ['ru', 'Формат содержимого', 'Режим отображения', 'Типографика', 'Шрифт', 'Размер', 'Цвет', 'Жирный', 'Формула / Скрипт'],
    ['en', 'Content format', 'Display mode', 'Typography', 'Font', 'Size', 'Color', 'Bold', 'Formula / Script'],
  ])('renders every label in %s', async (language, format, mode, typography, font, size, color, bold, formula) => {
    localStorage.setItem('god-crm-language', language);
    render(<LanguageProvider><CellFixture config={{ cellFormat: { mode: 'formula' } }} /></LanguageProvider>);
    const user = userEvent.setup();

    for (const text of [format, mode, typography, font, size]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByLabelText(color, { exact: true })).toHaveAttribute('type', 'color');
    expect(screen.getByLabelText(formula)).toHaveRole('textbox');

    await user.click(screen.getByRole('button', { name: bold }));
    expect(JSON.parse(screen.getByLabelText('Configuration').textContent || '{}').appearance.fontWeight).toBe('bold');
    expect(screen.getByRole('button', { name: bold })).toHaveAttribute('aria-pressed', 'true');

    if (language === 'en') noCyrillic();
    noRawKeys();
  });
});

describe('Summary tab localization', () => {
  it.each([
    ['ru', 'Суммарная строка', 'Σ Сумма', 'Среднее', 'Количество', 'Уникальных', 'Вычисляемые переменные', 'Формула колонки', 'Быстрые формулы'],
    ['en', 'Summary row', 'Σ Sum', 'Average', 'Count', 'Unique', 'Computed variables', 'Column formula', 'Quick formulas'],
  ])('renders every label in %s', async (language, title, sum, avg, count, unique, variables, formula, quick) => {
    localStorage.setItem('god-crm-language', language);
    render(<LanguageProvider><SummaryFixture type="number" /></LanguageProvider>);
    const user = userEvent.setup();

    for (const text of [title, variables]) expect(screen.getByText(text)).toBeVisible();
    expect(screen.getByText(new RegExp(quick))).toBeVisible();
    for (const name of [sum, avg, count, unique]) expect(screen.getByRole('checkbox', { name })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: formula })).toBeVisible();
    for (const name of ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']) expect(screen.getByRole('button', { name })).toBeVisible();

    await user.click(screen.getByRole('checkbox', { name: avg }));
    expect(JSON.parse(screen.getByLabelText('Configuration').textContent || '{}').summary.avg).toBe(false);

    if (language === 'en') noCyrillic();
    noRawKeys();
  });

  it('shows the fill percentage for text columns in English', () => {
    localStorage.setItem('god-crm-language', 'en');
    render(<LanguageProvider><SummaryFixture type="text" /></LanguageProvider>);
    expect(screen.getByRole('checkbox', { name: '% Filled' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Σ Sum' })).not.toBeInTheDocument();
    noCyrillic();
  });

  it('uses the themed border token instead of the undefined --border-color', () => {
    localStorage.setItem('god-crm-language', 'en');
    render(<LanguageProvider><SummaryFixture type="number" /></LanguageProvider>);
    const formula = screen.getByRole('textbox', { name: 'Column formula' });
    expect(formula.className).toContain('var(--border-primary)');
    expect(formula.className).not.toContain('var(--border-color)');
    expect(screen.getByRole('button', { name: 'SUM' }).className).not.toContain('var(--border-color)');
  });
});

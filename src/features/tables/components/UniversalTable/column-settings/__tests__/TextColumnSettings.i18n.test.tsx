import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { TextColumnSettings } from '../TextColumnSettings';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

function Fixture() {
  const [draft, setDraft] = useState<ColumnModel>({
    id: 'why', tableId: '1', name: 'why', displayName: 'why', type: 'text', config: {},
    isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true,
  });
  return <>
    <TextColumnSettings draft={draft} setDraft={setDraft} />
    <output aria-label="Configuration">{JSON.stringify(draft.config)}</output>
  </>;
}

describe('Text column settings localization', () => {
  it.each([
    ['ru', 'Настройки текста', 'Формула (необязательно)', 'Префикс', 'Суффикс', /для подстановки значений/, /вычисляется по формуле/, 'Превью'],
    ['en', 'Text settings', 'Formula (optional)', 'Prefix', 'Suffix', /to substitute values/, /the formula is evaluated/, 'Preview'],
  ])('renders every label in %s', async (language, title, formula, prefix, suffix, hint, formulaHint, preview) => {
    localStorage.setItem('god-crm-language', language);
    render(<LanguageProvider><Fixture /></LanguageProvider>);
    const user = userEvent.setup();

    expect(screen.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
    expect(screen.getByText(hint)).toBeVisible();
    expect(screen.getByText(formulaHint)).toBeVisible();
    for (const label of [formula, prefix, suffix]) expect(screen.getByRole('textbox', { name: label })).toBeVisible();

    await user.click(screen.getByRole('textbox', { name: prefix }));
    await user.paste('№ ');
    expect(JSON.parse(screen.getByLabelText('Configuration').textContent || '{}').text.prefix).toBe('№ ');
    expect(screen.getByText(new RegExp(preview))).toBeVisible();

    if (language === 'en') expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/);
    expect(screen.queryByText(/columnSettings\./)).not.toBeInTheDocument();
  });

  it('keeps the template hint readable in dark mode', () => {
    localStorage.setItem('god-crm-language', 'en');
    render(<LanguageProvider><Fixture /></LanguageProvider>);
    const hint = screen.getByText(/to substitute values/).closest('div');
    expect(hint?.className).toContain('dark:bg-primary-900');
    expect(hint?.className).not.toContain('dark:bg-primary-100');
  });
});

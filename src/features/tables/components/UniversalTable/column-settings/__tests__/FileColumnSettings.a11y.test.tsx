import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { FileColumnSettings } from '../FileColumnSettings';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

function Fixture({ name }: { name: string }) {
  const [draft, setDraft] = useState<ColumnModel>({
    id: name, tableId: '1', name, displayName: name, type: 'image',
    config: { visibility: 'private', image: { fit: 'contain' } },
    isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true,
  });
  return <section aria-label={name}>
    <FileColumnSettings draft={draft} setDraft={setDraft} />
    <output aria-label="Configuration">{JSON.stringify(draft.config)}</output>
  </section>;
}

describe('File source field labels', () => {
  it.each(['ru', 'en'])('names and focuses isolated fields in %s', async (language) => {
    localStorage.setItem('god-crm-language', language);
    render(<LanguageProvider><Fixture name="first" /><Fixture name="second" /></LanguageProvider>);
    const user = userEvent.setup();
    const first = within(screen.getByRole('region', { name: 'first' }));
    const second = within(screen.getByRole('region', { name: 'second' }));

    for (const [label, key, value] of [
      [language === 'ru' ? 'Формула (необязательно)' : 'Formula (optional)', 'formula', '{{source}}'],
      [language === 'ru' ? 'Префикс' : 'Prefix', 'prefix', 'https://images.example/'],
      [language === 'ru' ? 'Суффикс' : 'Suffix', 'suffix', '?version=2'],
    ]) {
      const input = second.getByRole('textbox', { name: label });
      await user.click(second.getByText(label, { exact: true }));
      expect(input).toHaveFocus();
      await user.paste(value);
      const config = JSON.parse(second.getByLabelText('Configuration').textContent || '{}');
      expect(config.file[key]).toBe(value);
      expect(config.visibility).toBe('private');
      expect(config.image.fit).toBe('contain');
      expect(first.getByRole('textbox', { name: label })).toHaveValue('');
    }
    if (language === 'en') expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/);
    expect(screen.queryByText(/columnSettings\./)).not.toBeInTheDocument();
    const visibility = second.getByRole('combobox', { name: language === 'ru' ? 'Кто видит файлы' : 'Who can see files' });
    for (const [value, label, hint] of [
      ['internal', 'Internal', language === 'ru' ? /требуется JWT/ : /requires JWT/],
      ['public', 'Public', language === 'ru' ? /без авторизации/ : /without authentication/],
      ['private', 'Private', language === 'ru' ? /По умолчанию/ : /Default/],
    ] as const) {
      await user.click(visibility);
      await user.click(screen.getByRole('option', { name: new RegExp(label) }));
      expect(JSON.parse(second.getByLabelText('Configuration').textContent || '{}').visibility).toBe(value);
      expect(second.getByText(hint)).toBeVisible();
      expect(JSON.parse(first.getByLabelText('Configuration').textContent || '{}').visibility).toBe('private');
    }
  });
});

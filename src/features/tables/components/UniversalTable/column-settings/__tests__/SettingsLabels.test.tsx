import { describe, it, expect, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { render, screen } from '@testing-library/react';
import { CellFormatSettings } from '../CellFormatSettings';
import { SummaryTab } from '../SummaryTab';
import { TypographySettings } from '../TypographySettings';
import { ValidationRulesSettings } from '../ValidationRulesSettings';
import { PhoneColumnSettings } from '../PhoneColumnSettings';
import { TimeColumnSettings } from '../TimeColumnSettings';
import { UrlColumnSettings } from '../UrlColumnSettings';
import { TextWrapSettings } from '../TextWrapSettings';
import type { ColumnModel } from '@/features/tables/types/table.types';

const draft: ColumnModel = {
  id: 'value', tableId: '1', name: 'value', displayName: 'Value', type: 'text',
  config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 150, isVisible: true,
};

describe('Column settings labels', () => {
  it('labels formula fields and text colour across simultaneous editors', () => {
    localStorage.setItem('god-crm-language', 'ru');
    const { container } = render(<LanguageProvider>
      <CellFormatSettings draft={{ ...draft, config: { cellFormat: { mode: 'formula' } } }} setDraft={vi.fn()} />
      <SummaryTab draft={draft} setDraft={vi.fn()} />
      <TypographySettings draft={draft} setDraft={vi.fn()} />
    </LanguageProvider>);
    expect(screen.getByLabelText('Формула / Скрипт')).toHaveRole('textbox');
    expect(screen.getByLabelText('Формула колонки')).toHaveRole('textbox');
    expect(screen.getByLabelText('Цвет', { exact: true })).toHaveAttribute('type', 'color');
    const ids = [...container.querySelectorAll('[id]')].map(el => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('labels each custom validation rule independently', () => {
    localStorage.setItem('god-crm-language', 'ru');
    render(<LanguageProvider><ValidationRulesSettings draft={{ ...draft, config: { validation: { rules: [
      { id: 'one', name: 'One', type: 'custom', enabled: true, config: {}, errorMessage: 'Invalid' },
      { id: 'two', name: 'Two', type: 'custom', enabled: true, config: {}, errorMessage: 'Invalid' },
    ] } } }} setDraft={vi.fn()} /></LanguageProvider>);
    const fields = screen.getAllByLabelText('Код JavaScript (return true/false)');
    expect(fields).toHaveLength(2);
    expect(fields[0].id).not.toBe(fields[1].id);
  });

  it('names groups of display and colour choices', () => {
    render(<LanguageProvider>
      <PhoneColumnSettings draft={draft} setDraft={vi.fn()} />
      <TimeColumnSettings draft={draft} setDraft={vi.fn()} />
      <UrlColumnSettings draft={{ ...draft, config: { url: { style: 'badge' } } }} setDraft={vi.fn()} />
    </LanguageProvider>);
    expect(screen.getAllByRole('group', { name: 'Формат отображения' })).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Цвет' })).toBeInTheDocument();
  });

  it('keeps radio groups independent between column editors', () => {
    render(<><TextWrapSettings draft={draft} setDraft={vi.fn()} /><TextWrapSettings draft={draft} setDraft={vi.fn()} /></>);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(6);
    const names = radios.map(el => el.getAttribute('name'));
    expect(new Set(names).size).toBe(2);
    expect(new Set(radios.map(el => el.id)).size).toBe(6);
    for (const radio of radios) expect(radio).toHaveAccessibleName();
  });
});

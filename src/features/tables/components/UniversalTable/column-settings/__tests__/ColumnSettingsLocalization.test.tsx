import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { createSelectColumn } from '../../__tests__/columnSettingsTestUtils';
import { MappingSection } from '../MappingSection';
import { ValidationRulesSettings } from '../ValidationRulesSettings';

const setDraft = vi.fn();
const draft = createSelectColumn();
function Fixture() {
  const { t } = useLanguage();
  return <>
    <h1>{t('columnSettings.title', { name: 'Тип' })}</h1>
    <ValidationRulesSettings draft={draft} setDraft={setDraft} />
    <MappingSection draft={draft} t={t} allColumns={[draft]} currentMappingRow={{ id: '51', status: 'Товар' }}
      mappingRowIndex={0} mappingRows={[{ id: '51', data: {} }]} goToPrevMappingRow={() => {}} goToNextMappingRow={() => {}} />
    <button>{t('columnSettings.modal.close')}</button>
    <button>{t('columnSettings.modal.save')}</button>
    <button>{t('columnSettings.modal.deleteColumn')}</button>
  </>;
}

describe('column settings language', () => {
  it.each([
    ['ru', 'Правила валидации', '+ Добавить правило', 'Маппинг колонок', 'ID строки', 'Закрыть', 'Сохранить', 'Удалить', 'Новое правило'],
    ['en', 'Validation rules', '+ Add rule', 'Column mapping', 'Row ID', 'Close', 'Save', 'Delete', 'New rule'],
  ])('localizes validation, mapping and actions in %s', async (language, title, add, mapping, id, close, save, remove, newRule) => {
    localStorage.setItem('god-crm-language', language);
    render(<LanguageProvider><Fixture /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
    expect(screen.getByText(new RegExp(mapping))).toBeVisible();
    expect(screen.getByText(new RegExp(id))).toBeVisible();
    for (const name of [close, save, remove]) expect(screen.getByRole('button', { name })).toBeVisible();
    expect(screen.queryByText(/columnSettings\./)).not.toBeInTheDocument();
    expect(screen.getByText(language === 'ru' ? /Правил валидации пока нет/ : /No validation rules yet/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: add }));
    const update = setDraft.mock.lastCall?.[0];
    expect(update(draft).config.validation.rules[0].name).toBe(newRule);
  });
});

import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { ImageColumnSettings } from '../ImageColumnSettings';

function Fixture() {
  const [draft, setDraft] = useState<ColumnModel>({ id: 'images', tableId: '1', name: 'images', displayName: 'Images', type: 'image', config: { file: { prefix: '/uploads/' }, image: { displayMode: 'single' } }, isRequired: false, isReadonly: false, orderIndex: 0, width: 150, isVisible: true });
  return <ImageColumnSettings draft={draft} setDraft={setDraft} firstRow={{ images: 'wide.png' }} />;
}

describe('Image settings preview and localization', () => {
  it.each([['en', 'Image fit', 'Stretch — ignore aspect ratio', 'Image height: 48px', 'Grid'], ['ru', 'Заполнение', 'Растянуть — без сохранения пропорций', 'Высота изображений: 48px', 'Сетка']])('updates the actual preview in %s', async (language, fit, stretch, height, grid) => {
    localStorage.setItem('god-crm-language', language);
    render(<LanguageProvider><Fixture /></LanguageProvider>);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/wide.png');
    await userEvent.click(screen.getByRole('combobox', { name: fit }));
    await userEvent.click(screen.getByRole('option', { name: stretch }));
    expect(screen.getByRole('img')).toHaveStyle({ objectFit: 'fill' });
    fireEvent.change(screen.getByRole('slider', { name: height }), { target: { value: '96' } });
    expect(screen.getByRole('img')).toHaveStyle({ height: '96px' });
    await userEvent.click(screen.getByRole('button', { name: new RegExp(grid) }));
    expect(screen.getByRole('img')).toHaveStyle({ height: '32px' });
    expect(screen.queryByText(/columnSettings\./)).not.toBeInTheDocument();
    if (language === 'en') expect(document.body.textContent).not.toMatch(/[А-Яа-яЁё]/);
    for (const group of screen.getAllByRole('group')) {
      for (const button of within(group).queryAllByRole('button')) expect(button).toHaveAccessibleName();
    }
  });
});

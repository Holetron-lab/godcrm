import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { ItemMenu } from '../ItemMenu';

it('renders element actions in English', () => {
  localStorage.setItem('god-crm-language', 'en');
  render(
    <LanguageProvider>
      <ItemMenu
        item={{ id: 1, level: 'text', order: 1 }}
        position={{ top: 0, left: 0 }}
        isOpen
        onClose={vi.fn()}
        onAddBefore={vi.fn()}
        onAddAfter={vi.fn()}
        onDelete={vi.fn()}
        onMoveUp={vi.fn()}
        onMoveDown={vi.fn()}
        onEdit={vi.fn()}
        onCopy={vi.fn()}
        isFirst={false}
        isLast={false}
        showEditCopy
      />
    </LanguageProvider>,
  );

  for (const name of ['Edit', 'Copy', 'Move up', 'Move down', 'Add above', 'Add below', 'Delete']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
});

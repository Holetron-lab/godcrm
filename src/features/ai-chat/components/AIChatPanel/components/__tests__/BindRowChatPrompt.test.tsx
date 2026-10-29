import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BindRowChatPrompt } from '../BindRowChatPrompt';
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
it('provides a named dialog, focuses an action, and closes with Escape', () => {
  const onClose = vi.fn();
  const onBindCurrent = vi.fn();
  render(<BindRowChatPrompt rowTitle="Task 42" onBindCurrent={onBindCurrent} onCreateNew={vi.fn()} onClose={onClose} />);
  expect(screen.getByRole('dialog', { name: 'aiChat.ui.thisRowHasNoChat' })).toBeInTheDocument();
  const bind = screen.getByRole('button', { name: 'aiChat.ui.linkThisChatToTheRow' });
  expect(bind).toHaveFocus();
  fireEvent.click(bind);
  expect(onBindCurrent).toHaveBeenCalledOnce();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledOnce();
});

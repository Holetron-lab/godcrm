import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { MentionInput } from '@/features/ai-chat/components/MentionInput';
import { ChatSendSettings } from '../ChatSendSettings';

beforeEach(() => { localStorage.clear(); window.innerWidth = 1024; });

function Composer({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('');
  return <><ChatSendSettings /><MentionInput value={value} onChange={setValue} onSubmit={onSubmit} availableUsers={[{ id: 1, name: 'Human', type: 'human' }]} /></>;
}

it('changes desktop sending immediately, preserves newline, IME and mention selection', async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<Composer onSubmit={onSubmit} />);
  await user.selectOptions(screen.getByLabelText('Десктопная версия'), 'enter');
  const input = screen.getByRole('textbox');
  await user.type(input, 'First{Shift>}{Enter}{/Shift}Second');
  expect(input).toHaveValue('First\nSecond');
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(onSubmit).not.toHaveBeenCalled();
  await user.keyboard('{Enter}');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await user.clear(input);
  await user.type(input, '@Hu');
  await user.keyboard('{Enter}');
  expect(input).toHaveValue('<<@human>> ');
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

it('uses the mobile choice after resizing, without losing the current draft', async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<Composer onSubmit={onSubmit} />);
  await user.selectOptions(screen.getByLabelText('Мобильная версия'), 'enter');
  const input = screen.getByRole('textbox');
  await user.type(input, 'Draft{Enter}');
  expect(input).toHaveValue('Draft\n');
  expect(onSubmit).not.toHaveBeenCalled();
  window.innerWidth = 390;
  await user.keyboard('{Enter}');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(input).toHaveValue('Draft\n');
});

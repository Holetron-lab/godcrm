import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ChatInput } from './ChatInput';

afterEach(cleanup);
it('inserts a newline with Enter and sends multiline text with Shift+Enter', async () => {
  const onSend = vi.fn();
  const user = userEvent.setup();
  render(<ChatInput onSend={onSend} />);
  const input = screen.getByRole('textbox');
  await user.type(input, 'First{enter}Second');
  expect(input).toHaveValue('First\nSecond');
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, isComposing: true });
  expect(onSend).not.toHaveBeenCalled();
  await user.keyboard('{Shift>}{Enter}{/Shift}');
  expect(onSend).toHaveBeenCalledWith('First\nSecond');
  expect(input).toHaveValue('');
});

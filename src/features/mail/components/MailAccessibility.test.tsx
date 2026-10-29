import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext/AIChatProvider';
import { MailPage } from '../MailPage';
import { MailComposer } from './MailComposer';
import { RecipientInput } from './RecipientInput';

vi.mock('react-quill-new', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="body" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

describe('Mail keyboard accessibility', () => {
  it('resizes the composer with arrows and Home/End within its bounds', () => {
    const { getByRole } = render(<MailComposer value="" onChange={vi.fn()} onSend={vi.fn()} />);
    const handle = getByRole('slider', { name: 'Изменить высоту' });
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAttribute('aria-valuenow', '180');
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(handle).toHaveAttribute('aria-valuenow', '180');
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(handle).toHaveAttribute('aria-valuenow', '120');
    fireEvent.keyDown(handle, { key: 'End' });
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(handle.getAttribute('aria-valuenow')).toBe(handle.getAttribute('aria-valuemax'));
  });

  it('resizes the mail list with arrows and Home/End within its bounds', () => {
    // MailPage reads the chat context for "Прикрепить к сообщению" — the no-op stub is enough here.
    const { getByRole } = render(
      <MemoryRouter>
        <AIChatStubProvider>
          <MailPage />
        </AIChatStubProvider>
      </MemoryRouter>
    );
    const handle = getByRole('slider', { name: 'Изменить ширину списка' });
    expect(handle).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '308');
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '288');
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(handle).toHaveAttribute('aria-valuenow', '220');
    fireEvent.keyDown(handle, { key: 'End' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '560');
  });

  it('keeps Ctrl+Enter sending and the disabled guard', () => {
    const send = vi.fn();
    const { getByRole, rerender } = render(<MailComposer value="Hello" onChange={vi.fn()} onSend={send} />);
    fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(send).toHaveBeenCalledOnce();
    rerender(<MailComposer value="Hello" onChange={vi.fn()} onSend={send} disabled />);
    fireEvent.keyDown(getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it('lets the keyboard edit and remove recipients without losing the draft', async () => {
    function Recipients() {
      const [value, setValue] = useState(['first@example.com']);
      return <RecipientInput value={value} onChange={setValue} ariaLabel="Кому" />;
    }
    const user = userEvent.setup();
    const { getByRole, queryByRole } = render(<Recipients />);
    const input = getByRole('textbox', { name: 'Кому' });
    await user.type(input, 'next@example.com');
    act(() => getByRole('button', { name: 'first@example.com' }).focus());
    await user.keyboard('{Enter}');
    expect(input).toHaveFocus();
    expect(input).toHaveValue('first@example.com');
    expect(getByRole('button', { name: 'next@example.com' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    act(() => getByRole('button', { name: 'Убрать next@example.com' }).focus());
    await user.keyboard(' ');
    expect(input).toHaveFocus();
    expect(queryByRole('button', { name: 'next@example.com' })).toBeNull();
    expect(getByRole('button', { name: 'first@example.com' })).toBeInTheDocument();
  });
});

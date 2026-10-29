import { fireEvent } from '@testing-library/react';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { describe, expect, it, vi } from 'vitest';
import { MailComposer } from './MailComposer';

// react-quill-new owns a contenteditable + Quill instance that is brittle under
// jsdom; we test the composer *shell* (actions, disabled logic, format toggle),
// not Quill itself. A textarea stand-in preserves the value/onChange contract.
vi.mock('react-quill-new', () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label="body" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('react-quill-new/dist/quill.snow.css', () => ({}));

const noop = () => {};

describe('MailComposer (ADR-158 P4)', () => {
  it('renders the action bar: attach, send, voice', () => {
    const { getByLabelText } = render(<MailComposer value="" onChange={noop} onSend={noop} />);
    expect(getByLabelText('Прикрепить файл')).toBeTruthy();
    expect(getByLabelText('Отправить')).toBeTruthy();
    expect(getByLabelText('Голосовой ввод')).toBeTruthy();
  });

  it('disables Send while the body is empty and enables it once there is content', () => {
    const { getByLabelText, rerender } = render(<MailComposer value="" onChange={noop} onSend={noop} />);
    expect(getByLabelText('Отправить')).toBeDisabled();
    rerender(<MailComposer value="<p>hi</p>" onChange={noop} onSend={noop} />);
    expect(getByLabelText('Отправить')).not.toBeDisabled();
  });

  it('treats an empty Quill doc (<p><br></p>) as empty', () => {
    const { getByLabelText } = render(<MailComposer value="<p><br></p>" onChange={noop} onSend={noop} />);
    expect(getByLabelText('Отправить')).toBeDisabled();
  });

  it('fires onSend when the send button is clicked with content', () => {
    const onSend = vi.fn();
    const { getByLabelText } = render(<MailComposer value="<p>hi</p>" onChange={noop} onSend={onSend} />);
    fireEvent.click(getByLabelText('Отправить'));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('shows the format strip permanently (no toggle)', () => {
    const { queryByLabelText } = render(<MailComposer value="" onChange={noop} onSend={noop} />);
    expect(queryByLabelText('Форматирование')).toBeNull();
    expect(queryByLabelText('Жирный')).toBeTruthy();
    expect(queryByLabelText('Курсив')).toBeTruthy();
    expect(queryByLabelText('Цитата')).toBeTruthy();
  });

  it('hard-disables Send when the composer is disabled (no mailbox)', () => {
    const { getByLabelText } = render(<MailComposer value="<p>hi</p>" onChange={noop} onSend={noop} disabled />);
    expect(getByLabelText('Отправить')).toBeDisabled();
  });

  describe('collapsible reply bar', () => {
    const header = <div data-testid="header">To / Subject</div>;

    it('starts as a one-line bar: input + actions, no header or format strip', () => {
      const { getByLabelText, queryByLabelText, queryByTestId } = render(
        <MailComposer value="" onChange={noop} onSend={noop} collapsible header={header} />
      );
      expect(getByLabelText('body')).toBeTruthy();
      expect(getByLabelText('Прикрепить файл')).toBeTruthy();
      expect(getByLabelText('Отправить')).toBeTruthy();
      expect(queryByLabelText('Жирный')).toBeNull();
      expect(queryByTestId('header')).toBeNull();
      expect(getByLabelText('Развернуть окно ответа')).toBeTruthy();
    });

    it('expands to the full composer and collapses back', () => {
      const { getByLabelText, queryByLabelText, getByTestId, queryByTestId } = render(
        <MailComposer value="" onChange={noop} onSend={noop} collapsible header={header} />
      );
      fireEvent.click(getByLabelText('Развернуть окно ответа'));
      expect(getByLabelText('Жирный')).toBeTruthy();
      expect(getByTestId('header')).toBeTruthy();
      fireEvent.click(getByLabelText('Свернуть окно ответа'));
      expect(queryByLabelText('Жирный')).toBeNull();
      expect(queryByTestId('header')).toBeNull();
    });

    it('opens from the resize slider with the keyboard and reports 0 while collapsed', () => {
      const { getByRole, getByLabelText } = render(
        <MailComposer value="" onChange={noop} onSend={noop} collapsible header={header} />
      );
      const handle = getByRole('slider', { name: 'Изменить высоту' });
      expect(handle).toHaveAttribute('aria-valuemin', '0');
      expect(handle).toHaveAttribute('aria-valuenow', '0');
      fireEvent.keyDown(handle, { key: 'ArrowUp' });
      expect(handle).toHaveAttribute('aria-valuenow', '180');
      expect(getByLabelText('Жирный')).toBeTruthy();
      fireEvent.keyDown(handle, { key: 'Home' });
      expect(handle).toHaveAttribute('aria-valuenow', '0');
    });

    it('is ignored for the non-collapsible (new message) composer', () => {
      const { getByLabelText, queryByLabelText } = render(
        <MailComposer value="" onChange={noop} onSend={noop} header={header} />
      );
      expect(getByLabelText('Жирный')).toBeTruthy();
      expect(queryByLabelText('Развернуть окно ответа')).toBeNull();
      expect(queryByLabelText('Свернуть окно ответа')).toBeNull();
    });
  });
});

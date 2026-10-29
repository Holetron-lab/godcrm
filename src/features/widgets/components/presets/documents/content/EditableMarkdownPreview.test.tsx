import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditableMarkdownPreview } from './EditableMarkdownPreview';

vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (select: (state: { user: null }) => unknown) => select({ user: null }),
}));
vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

const longText = 'Длинный текст ячейки, который должен переноситься и полностью помещаться в поле редактирования.';
const content = `| Задача | Статус |\n| --- | --- |\n| ${longText} | Открыта |`;

describe('EditableMarkdownPreview table editing', () => {
  it('opens a named multiline field with the entire cell value', () => {
    render(<EditableMarkdownPreview content={content} />);
    fireEvent.click(screen.getByText(longText));
    const field = screen.getByRole('textbox', { name: 'Задача, строка 1' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).toHaveValue(longText);
    expect(field).toHaveFocus();
  });

  it('saves on Enter and flattens pasted line breaks to preserve the Markdown row', async () => {
    const onContentChange = vi.fn().mockResolvedValue(undefined);
    render(<EditableMarkdownPreview content={content} onContentChange={onContentChange} />);
    fireEvent.click(screen.getByText(longText));
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Первая строка\nВторая строка' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onContentChange).toHaveBeenCalledTimes(1);
    const saved = onContentChange.mock.calls[0][0] as string;
    expect(saved.split('\n')).toHaveLength(3);
    expect(saved).toContain('Первая строка Вторая строка');
    expect(saved).toContain('Открыта');
  });

  it('cancels with Escape without saving', () => {
    const onContentChange = vi.fn();
    render(<EditableMarkdownPreview content={content} onContentChange={onContentChange} />);
    fireEvent.click(screen.getByText(longText));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Изменено' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText(longText)).toBeInTheDocument();
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it('saves on blur and supports an empty cell', async () => {
    const onContentChange = vi.fn().mockResolvedValue(undefined);
    render(<EditableMarkdownPreview content={content} onContentChange={onContentChange} />);
    fireEvent.click(screen.getByText(longText));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    fireEvent.blur(screen.getByRole('textbox'));
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(onContentChange.mock.calls[0][0]).not.toContain(longText);
  });
});

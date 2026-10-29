import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormEvent } from 'react';
import { TextBlockPreview } from './TextBlockComponents';
import type { FormTextBlock } from '../../types/form-config.types';

afterEach(cleanup);
const block: FormTextBlock = { id: 'text-1', type: 'text', content: 'Инструкция', order: 1 };

describe('TextBlockPreview accessibility', () => {
  it('selects with Enter, Space and click without submitting its form', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const { rerender } = render(<form onSubmit={onSubmit}>
      <TextBlockPreview block={block} isSelected={false} onClick={onClick} />
    </form>);
    const edit = screen.getByRole('button', { name: 'Редактировать текстовый блок', pressed: false });
    await user.tab();
    expect(edit).toHaveFocus();
    await user.keyboard('{Enter} ');
    await user.click(edit);
    expect(onClick).toHaveBeenCalledTimes(3);
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<TextBlockPreview block={block} isSelected onClick={onClick} />);
    expect(screen.getByRole('button', { pressed: true })).toBeInTheDocument();
  });

  it('keeps sanitized HTML and its links outside the edit button', () => {
    const { container } = render(<TextBlockPreview block={{ ...block, contentType: 'html',
      content: '<p>Инструкция <a href="#help">Справка</a></p><img src="x" onerror="alert(1)"><script>alert(1)</script>',
    }} isSelected={false} onClick={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Справка' }).closest('button')).toBeNull();
    expect(container.querySelector('script, [onerror]')).toBeNull();
    expect(container.querySelector('button div, button p')).toBeNull();
  });

  it('keeps preview mode non-interactive and hides empty preview content', () => {
    const { rerender, container } = render(<TextBlockPreview block={block} isSelected={false} onClick={vi.fn()} isPreviewMode />);
    expect(screen.getByText('Инструкция')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<TextBlockPreview block={{ ...block, content: '' }} isSelected={false} onClick={vi.fn()} isPreviewMode />);
    expect(container).toBeEmptyDOMElement();
  });
});

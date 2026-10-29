import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { CardAnalysisBlock } from './CardAnalysisBlock';

vi.mock('@/shared/components/MarkdownPreview', () => ({
  MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div>,
}));

afterEach(cleanup);

const props: ComponentProps<typeof CardAnalysisBlock> = {
  column: {
    id: 'analysis', tableId: 'fixture', name: 'analysis', displayName: 'Анализ',
    type: 'text', config: {}, isRequired: false, isReadonly: false,
    orderIndex: 0, width: 200, isVisible: true,
  },
  content: '## 📊 Итог\nСводка\n## 12.09.2026 Новое\nНовая запись\n## 10.09.2026 Старое\nСтарая запись',
  editable: true, editing: false, draft: 'Черновик', saving: false,
  onDraftChange: vi.fn(), onStartEdit: vi.fn(), onSubmit: vi.fn(), onCancel: vi.fn(),
};

describe('CardAnalysisBlock', () => {
  it.each(['1️⃣', '#️⃣', '*️⃣', '1\u20e3', '📊', '👩🏽‍🌾', '🇷🇺'])('removes decorative %s without damaging heading text', (emoji) => {
    render(<CardAnalysisBlock {...props} content={`## ${emoji} Итог\nСводка`} />);
    expect(screen.getByText('Итог', { exact: true })).toBeInTheDocument();
  });

  it('preserves ordinary leading digits and emoji within text', () => {
    render(<CardAnalysisBlock {...props} content={'## 1 этап 📊\nСводка'} />);
    expect(screen.getByText('1 этап 📊', { exact: true })).toBeInTheDocument();
  });

  it('names each editor uniquely and preserves draft/cancel callbacks', () => {
    const onDraftChange = vi.fn();
    const onCancel = vi.fn();
    render(<><CardAnalysisBlock {...props} editing onDraftChange={onDraftChange} onCancel={onCancel} /><CardAnalysisBlock {...props} editing /></>);
    const editors = screen.getAllByRole('textbox', { name: 'Анализ' });
    expect(editors[0].id).not.toBe(editors[1].id);
    fireEvent.change(editors[0], { target: { value: 'Новый черновик' } });
    expect(onDraftChange).toHaveBeenCalledWith('Новый черновик');
    fireEvent.keyDown(editors[0], { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('exposes disclosure state through keyboard toggles and keeps focus', async () => {
    const user = userEvent.setup();
    render(<CardAnalysisBlock {...props} />);
    const newest = screen.getByRole('button', { name: /12\.09\.2026\s*Новое/, expanded: true });
    const older = screen.getByRole('button', { name: /10\.09\.2026\s*Старое/, expanded: false });
    newest.focus();
    await user.keyboard('{Enter}');
    expect(newest).toHaveAttribute('aria-expanded', 'false');
    expect(newest).toHaveFocus();
    expect(screen.queryByText('Новая запись')).not.toBeInTheDocument();
    await user.tab();
    expect(older).toHaveFocus();
    await user.keyboard(' ');
    expect(older).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Старая запись')).toBeInTheDocument();
  });
});

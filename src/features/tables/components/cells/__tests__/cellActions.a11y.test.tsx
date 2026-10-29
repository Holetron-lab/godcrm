import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ImageCell } from '../ImageCell';
import { VectorCell } from '../VectorCell';
import { VerificationCell } from '../VerificationCell';
import { tablesApi } from '../../../api/tablesApi';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'en' }) }));
vi.mock('../../../api/tablesApi', () => ({ tablesApi: { generateVectorCell: vi.fn() } }));

describe('Cell actions accessibility', () => {
  it('offers a native image upload button and disables it in read-only mode', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<ImageCell value="" config={{ file: { prefix: '/uploads/' } }} />);
    const input = container.querySelector('input')!;
    const choose = vi.spyOn(input, 'click');
    screen.getByRole('button', { name: 'Add images' }).focus();
    await user.keyboard('{Enter}');
    expect(choose).toHaveBeenCalledTimes(1);
    rerender(<ImageCell value="" config={{ file: { prefix: '/uploads/' } }} readOnly />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('removes only the selected image without submitting its containing form', async () => {
    const update = vi.fn();
    const submit = vi.fn(e => e.preventDefault());
    render(<form onSubmit={submit}><ImageCell value="a.png,b.png" config={{ file: { prefix: '/uploads/' } }} onUpdate={update} /></form>);
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Remove image' })[0]);
    expect(update).toHaveBeenCalledWith('b.png');
    expect(submit).not.toHaveBeenCalled();
  });

  it('generates with the keyboard, prevents repeats while pending and exposes regenerate without hover', async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    let finish!: (value: Awaited<ReturnType<typeof tablesApi.generateVectorCell>>) => void;
    vi.mocked(tablesApi.generateVectorCell).mockImplementationOnce(() => new Promise<Awaited<ReturnType<typeof tablesApi.generateVectorCell>>>(resolve => { finish = resolve; }));
    render(<VectorCell value="" tableId={1} rowId={2} columnId="vector" onUpdate={update} />);
    const generate = screen.getByRole('button', { name: 'Generate vector' });
    generate.focus();
    await user.keyboard(' ');
    expect(generate).toBeDisabled();
    fireEvent.click(generate);
    expect(tablesApi.generateVectorCell).toHaveBeenCalledTimes(1);
    finish({ success: true, result: { text: 'Generated text', text_length: 14, embedding_dimension: 0, generated_at: '2026-09-22' } });
    await waitFor(() => expect(update).toHaveBeenCalledWith({ text: 'Generated text', embedding: [] }));
    expect(screen.getByRole('button', { name: 'Regenerate vector' })).toBeInTheDocument();
  });

  it('disables vector generation without row identifiers', () => {
    render(<VectorCell value="" />);
    expect(screen.getByRole('button', { name: 'Generate vector' })).toBeDisabled();
  });

  it('opens verification history by keyboard and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(<VerificationCell value={{ verified: true, audit_log: [{ at: '2026-09-01', actor: 1, event: 'verified', reason: 'Checked' }] }} />);
    const trigger = screen.getByRole('button', { name: /^Verified/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Verification history' })).toHaveTextContent('Checked');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

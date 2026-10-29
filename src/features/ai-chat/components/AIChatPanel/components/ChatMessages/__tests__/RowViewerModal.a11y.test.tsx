import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RowViewerModal from '../RowViewerModal';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/widgets/hooks/useTicketData', () => ({
  useTicketData: () => ({ tableColumns: [], isLoadingColumns: false }),
}));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn().mockRejectedValue(new Error('Row unavailable')) } }));
vi.mock('@/features/tables/components/modals/EditRowModal', () => ({ EditRowModal: () => null }));
vi.mock('@/features/widgets/components/modals/CardDetailModal', () => ({ CardDetailModal: () => null }));

function Harness() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Open row</button>
    <RowViewerModal isOpen={open} onClose={() => setOpen(false)} tableId={1} rowId={2} />
  </>;
}

afterEach(cleanup);

describe('RowViewerModal loading error', () => {
  it('announces the error, contains focus and restores the trigger after Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open row' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Row unavailable' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Row unavailable');
    const close = screen.getByRole('button', { name: 'aiChat.ui.close' });
    expect(close).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes from the keyboard using the visible close action', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open row' });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard(' ');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

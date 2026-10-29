import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Modal } from '../Modal';

function Harness() {
  const [open, setOpen] = useState(false);
  const [nested, setNested] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>View</button>
    <Modal open={open} onOpenChange={setOpen} restoreFocus title="Parent">
      <button onClick={() => setNested(true)}>Details</button>
      <Modal open={nested} onOpenChange={setNested} restoreFocus title="Child"><button>Inside</button></Modal>
    </Modal>
  </>;
}
it('restores each opener after nested dialogs close and on reopening', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const view = screen.getByRole('button', { name: 'View' });
  for (let attempt = 0; attempt < 2; attempt++) {
    await user.click(view);
    const details = screen.getByRole('button', { name: 'Details' });
    await user.click(details);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(details).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(view).toHaveFocus());
  }
});

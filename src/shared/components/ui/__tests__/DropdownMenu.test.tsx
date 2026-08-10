import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DropdownMenu } from '../DropdownMenu';
import { Button } from '../Button';

describe('DropdownMenu', () => {
  it('executes item action', async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu
        trigger={<Button>Open</Button>}
        items={[
          { label: 'Rename', value: 'rename', onSelect },
          { label: 'Archive', value: 'archive' }
        ]}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByText('Rename'));
    expect(onSelect).toHaveBeenCalled();
  });
});

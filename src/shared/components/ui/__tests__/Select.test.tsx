import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '../Select';

describe('Select', () => {
  it('allows selecting option', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <Select
        label="View"
        placeholder="Choose"
        value={undefined}
        onChange={handleChange}
        options={[
          { label: 'Table', value: 'table' },
          { label: 'Board', value: 'board' }
        ]}
      />
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('Board'));
    expect(handleChange).toHaveBeenCalledWith('board');
  });
});

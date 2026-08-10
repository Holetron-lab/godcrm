import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from '../MultiSelect';

describe('MultiSelect', () => {
  it('toggles values', async () => {
    const handleChange = vi.fn();
    render(
      <MultiSelect
        label="Columns"
        value={[]}
        options={[
          { label: 'Name', value: 'name' },
          { label: 'Status', value: 'status' }
        ]}
        onChange={handleChange}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /select options/i }));
    await user.click(screen.getByText('Name'));
    expect(handleChange).toHaveBeenCalledWith(['name']);
  });
});

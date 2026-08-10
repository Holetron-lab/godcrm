import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Switch } from '../Switch';

describe('Switch', () => {
  it('toggles state', () => {
    render(<Switch label="Dark mode" defaultChecked={false} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
  });
});

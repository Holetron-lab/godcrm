import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BodyMap } from './BodyMap';

describe('BodyMap keyboard controls', () => {
  it('exposes each muscle and activates it with Enter, Space and pointer', () => {
    const select = vi.fn();
    const hover = vi.fn();
    render(<BodyMap muscleVolumes={new Map()} onPartClick={select} onPartHover={hover} />);
    const muscle = screen.getAllByRole('button')[0];
    expect(muscle).toHaveAttribute('tabindex', '0');
    expect(muscle).toHaveAccessibleName();
    fireEvent.focus(muscle);
    expect(hover).toHaveBeenCalled();
    fireEvent.keyDown(muscle, { key: 'Enter' });
    fireEvent.keyDown(muscle, { key: ' ' });
    fireEvent.click(muscle);
    expect(select).toHaveBeenCalledTimes(3);
    expect(select.mock.calls[0]).toEqual(select.mock.calls[2]);
    fireEvent.blur(muscle);
    expect(hover).toHaveBeenLastCalledWith(null);
  });

  it('does not expose inert buttons without a selection callback', () => {
    render(<BodyMap muscleVolumes={new Map()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from '../Modal';

describe('Modal', () => {
  it('renders title and description when open', () => {
    render(
      <Modal open onOpenChange={() => {}} title="Dialog" description="Details">
        <p>Body</p>
      </Modal>
    );
    expect(screen.getByText('Dialog')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('emits close event when overlay close button clicked', () => {
    const handleChange = vi.fn();
    render(
      <Modal open onOpenChange={handleChange} title="Close Test">
        <p>content</p>
      </Modal>
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(handleChange).toHaveBeenCalledWith(false);
  });
});

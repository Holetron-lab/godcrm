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

  it('applies caller layout classes to the dialog and its scroll container', () => {
    render(
      <Modal open onOpenChange={() => {}} className="max-sm:!w-screen" contentClassName="mt-0 pr-0">
        <p>Custom layout</p>
      </Modal>
    );
    expect(screen.getByRole('dialog')).toHaveClass('max-sm:!w-screen');
    expect(screen.getByText('Custom layout').parentElement).toHaveClass('mt-0', 'pr-0');
  });

  it('blocks disabled actions and enables them when the operation settles', () => {
    const primary = vi.fn();
    const secondary = vi.fn();
    const { rerender } = render(
      <Modal open onOpenChange={() => {}}
        primaryAction={{ label: 'Save', onClick: primary, disabled: true }}
        secondaryAction={{ label: 'Cancel', onClick: secondary, disabled: true }}>
        <p>Saving</p>
      </Modal>
    );
    for (const name of ['Save', 'Cancel']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(primary).not.toHaveBeenCalled();
    expect(secondary).not.toHaveBeenCalled();
    rerender(
      <Modal open onOpenChange={() => {}}
        primaryAction={{ label: 'Save', onClick: primary, disabled: false }}
        secondaryAction={{ label: 'Cancel', onClick: secondary }}>
        <p>Ready</p>
      </Modal>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(primary).toHaveBeenCalledOnce();
    expect(secondary).toHaveBeenCalledOnce();
  });

});

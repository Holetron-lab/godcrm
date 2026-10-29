import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRequestedFocus } from '../useRequestedFocus';

function Editor({ request }: { request: string | null }) {
  const ref = useRequestedFocus<HTMLInputElement>(request);
  return <><input aria-label="Other" /><input aria-label="Editor" ref={ref} /></>;
}

describe('requested editor focus', () => {
  it('focuses on an explicit edit transition without stealing focus on subsequent renders', () => {
    const { rerender } = render(<Editor request={null} />);
    const other = screen.getByLabelText('Other');
    const editor = screen.getByLabelText('Editor');
    expect(editor).not.toHaveFocus();
    other.focus();
    rerender(<Editor request="title" />);
    expect(editor).toHaveFocus();
    other.focus();
    rerender(<Editor request="title" />);
    expect(other).toHaveFocus();
    rerender(<Editor request="description" />);
    expect(editor).toHaveFocus();
    other.focus();
    rerender(<Editor request={null} />);
    expect(other).toHaveFocus();
  });
});

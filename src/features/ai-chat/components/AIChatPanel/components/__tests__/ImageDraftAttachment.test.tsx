import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ImageDraftAttachment } from '../ImageDraftAttachment';

afterEach(() => vi.unstubAllGlobals());
it('releases previews when a draft is replaced or removed', () => {
  const create = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const first = new File(['first'], 'first.png', { type: 'image/png' });
  const second = new File(['second'], 'second.png', { type: 'image/png' });
  const { rerender, unmount } = render(<ImageDraftAttachment file={first} />);
  expect(screen.getByRole('button', { name: 'first.png' }).querySelector('img')).toHaveAttribute('src', 'blob:first');
  rerender(<ImageDraftAttachment file={second} />);
  expect(revoke).toHaveBeenCalledWith('blob:first');
  expect(screen.getByRole('button', { name: 'second.png' }).querySelector('img')).toHaveAttribute('src', 'blob:second');
  unmount();
  expect(revoke).toHaveBeenCalledWith('blob:second');
});
it('keeps a labelled trigger if the image cannot decode', () => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:broken'; static revokeObjectURL = vi.fn(); });
  render(<ImageDraftAttachment file={new File(['bad'], 'broken.png', { type: 'image/png' })} />);
  const trigger = screen.getByRole('button', { name: 'broken.png' });
  fireEvent.error(trigger.querySelector('img')!);
  expect(trigger.querySelector('img')).toBeNull();
  expect(trigger).toHaveAccessibleName('broken.png');
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptionedMedia } from './CaptionedMedia';

afterEach(() => vi.restoreAllMocks());
describe('local media captions', () => {
  it('attaches real VTT content and releases its URL on unmount', async () => {
    const create = vi.fn(() => 'blob:captions');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const { container, unmount } = render(<CaptionedMedia src="/clip.mp4" kind="video" />);
    fireEvent.change(screen.getByLabelText('Выбрать локальный файл .vtt'), {
      target: { files: [{ name: 'captions.vtt', text: async () => 'WEBVTT\n\n00:00.000 --> 00:02.000\nПривет' }] },
    });
    await waitFor(() => expect(container.querySelector('track')).toHaveAttribute('src', 'blob:captions'));
    expect(screen.getByText(/00:00.000/)).toHaveTextContent('Привет');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:captions');
    vi.unstubAllGlobals();
  });
  it('reports invalid content instead of attaching a fake track', async () => {
    const { container } = render(<CaptionedMedia src="/clip.ogg" kind="audio" />);
    fireEvent.change(screen.getByLabelText('Выбрать локальный файл .vtt'), {
      target: { files: [{ name: 'wrong.vtt', text: async () => '<script>bad</script>' }] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('WebVTT');
    expect(container.querySelector('track')).not.toHaveAttribute('src');
    expect(container.querySelector('script')).toBeNull();
  });
});

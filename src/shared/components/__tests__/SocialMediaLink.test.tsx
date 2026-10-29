import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ProvidersWrapper } from '@/tests/renderWithProviders';
import { HighlightedText } from '@/features/ai-chat/components/HighlightedText';
import { MarkdownPreview } from '../MarkdownPreview';
import { parseSocialMediaUrl } from '../../utils/socialMediaUrl';
import { SocialMediaLink } from '../SocialMediaLink';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ProvidersWrapper><MemoryRouter>{children}</MemoryRouter></ProvidersWrapper>
);

describe('social links in chat', () => {
  it.each([
    'javascript:alert(1)', 'data:text/html,test', 'ftp://youtube.com/watch?v=M7lc1UVf-VE',
    'https://user@youtube.com/watch?v=M7lc1UVf-VE', 'https://youtube.com:8080/watch?v=M7lc1UVf-VE',
    'https://instagram.com.evil.test/', 'https://pinterest.com.evil.test/', 'not a URL',
  ])('never generates a card for unsafe provider URLs: %s', url => {
    expect(parseSocialMediaUrl(url)).toBeNull();
  });

  it('discards arbitrary player parameters and invalid times', () => {
    expect(parseSocialMediaUrl('https://youtube.com/watch?v=M7lc1UVf-VE&autoplay=1&origin=https://evil.test&t=bad'))
      .toEqual({ provider: 'YouTube', embedUrl: 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE' });
  });

  it('shows the player immediately, preserves it on rerender and updates an edited URL', () => {
    const { container, rerender } = render(<SocialMediaLink href="https://youtu.be/M7lc1UVf-VE">Video</SocialMediaLink>, { wrapper });
    const frame = container.querySelector('iframe');
    rerender(<SocialMediaLink href="https://youtu.be/M7lc1UVf-VE">New label</SocialMediaLink>);
    expect(container.querySelector('iframe')).toBe(frame);
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    rerender(<SocialMediaLink href="https://youtu.be/abcdefghijk">Another video</SocialMediaLink>);
    expect(container.querySelector('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdefghijk');
    expect(screen.queryByRole('button', { name: /YouTube/ })).toBeNull();
  });

  it.each([
    'https://www.youtube.com/watch?v=M7lc1UVf-VE&t=1m30s',
    'https://youtu.be/M7lc1UVf-VE?t=90',
    'https://m.youtube.com/shorts/M7lc1UVf-VE?start=90',
    'https://www.youtube.com/live/M7lc1UVf-VE#t=90',
  ])('shows a safe YouTube player without an extra click: %s', url => {
    const { container } = render(<HighlightedText text={url} />, { wrapper });
    expect(screen.queryByRole('button', { name: /YouTube/ })).toBeNull();
    expect(container.querySelector('iframe')).toHaveAttribute('src',
      'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=90');
    expect(container.querySelector('iframe')).toHaveAttribute('title', 'YouTube');
    expect(screen.getByRole('link')).toHaveAttribute('href', url);
  });

  it.each([
    ['https://www.pinterest.com/pin/1618549855956067/', 'Pinterest'],
    ['https://ru.pinterest.com/designer/ideas/', 'Pinterest'],
    ['https://pin.it/abcDEF12', 'Pinterest'],
    ['https://www.instagram.com/reel/ABC_123/?igsh=abc', 'Instagram'],
    ['https://www.instagram.com/p/ABC-123/', 'Instagram'],
    ['https://instagram.com/designer/', 'Instagram'],
  ])('renders an external card without fetching metadata: %s', (url, provider) => {
    const { container } = render(<HighlightedText text={url} />, { wrapper });
    expect(screen.getByRole('link')).toHaveTextContent(provider);
    expect(screen.getByRole('link')).toHaveAttribute('href', url);
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelector('iframe, img, script')).toBeNull();
  });

  it('enables cards only for chat Markdown and leaves code literal', () => {
    const url = 'https://youtu.be/M7lc1UVf-VE';
    const { rerender } = render(<MarkdownPreview content={url} />, { wrapper });
    expect(screen.queryByTitle('YouTube')).toBeNull();
    rerender(<MarkdownPreview mediaLinks content={`[Watch](${url})\n\n\`${url}\``} />);
    expect(screen.getAllByTitle('YouTube')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveTextContent('Watch');
    expect(screen.getByText(url).tagName).toBe('CODE');
  });

  it.each([
    'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE',
    'https://youtube.com@evil.test/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com/watch?v=invalid',
    'https://www.youtube.com/channel/example',
    'https://evilpinterest.com/pin/123/',
    'https://instagram.com.evil.test/p/test/',
  ])('leaves unsupported URLs as ordinary links: %s', url => {
    const { container } = render(<HighlightedText text={url} />, { wrapper });
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-social-provider]')).toBeNull();
    expect(screen.getByRole('link')).toHaveTextContent(url);
  });
});

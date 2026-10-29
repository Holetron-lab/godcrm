import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForwardedQuoteBlock } from '../ChatMessages/ForwardedQuoteBlock';
import { ForwardedMessageBlock } from '../../../ChatForwardedBlock';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <article>{content}</article> }));

it.each([ForwardedQuoteBlock, ForwardedMessageBlock])('expands and collapses forwarded content using the keyboard', async Component => {
  const user = userEvent.setup();
  render(<Component senderName="Alice" timestamp={null} content="Forwarded content" defaultCollapsed />);
  const toggle = screen.getByRole('button', { name: /Alice/ });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('article')).toHaveTextContent('Forwarded content');
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
});

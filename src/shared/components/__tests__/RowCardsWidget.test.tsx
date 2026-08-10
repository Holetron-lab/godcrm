import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RowCardsWidget } from '../RowCardsWidget';

type Post = { id: number; title: string; excerpt: string; tag: string; slug: string };

const POSTS: Post[] = [
  { id: 1, title: 'MCP in 160 lines', excerpt: 'How thin the server got.', tag: 'BUILD', slug: 'mcp-160' },
  { id: 2, title: 'Open source', excerpt: 'GOD CRM goes open-core.', tag: 'NEWS', slug: 'oss' },
];

function renderWidget(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const common = {
  getKey: (p: Post) => p.id,
  primary: (p: Post) => p.title,
  secondary: (p: Post) => p.excerpt,
  meta: (p: Post) => [p.tag],
  linkTo: (p: Post) => `/s/help/docs/${p.slug}`,
};

describe('RowCardsWidget', () => {
  it('renders a card per row with primary, secondary and meta', () => {
    renderWidget(<RowCardsWidget<Post> rows={POSTS} {...common} />);

    expect(screen.getByText('MCP in 160 lines')).toBeInTheDocument();
    expect(screen.getByText('How thin the server got.')).toBeInTheDocument();
    expect(screen.getByText('BUILD')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('links each card to its linkTo target', () => {
    renderWidget(<RowCardsWidget<Post> rows={POSTS} {...common} />);

    const link = screen.getByRole('link', { name: /MCP in 160 lines/i });
    expect(link).toHaveAttribute('href', '/s/help/docs/mcp-160');
  });

  it('renders nothing when there are no rows (section collapses)', () => {
    const { container } = renderWidget(<RowCardsWidget<Post> rows={[]} {...common} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows skeleton placeholders while loading', () => {
    renderWidget(
      <RowCardsWidget<Post>
        rows={[]}
        {...common}
        isLoading
        skeletonCount={4}
        ariaLabel="Loading posts"
      />,
    );
    const busy = screen.getByLabelText('Loading posts');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelectorAll('.animate-pulse')).toHaveLength(4);
  });

  it('renders plain (non-link) cards when linkTo is omitted', () => {
    renderWidget(
      <RowCardsWidget<Post>
        rows={POSTS}
        getKey={common.getKey}
        primary={common.primary}
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('applies the requested corner radius token', () => {
    renderWidget(
      <RowCardsWidget<Post> rows={[POSTS[0]]} {...common} borderRadius="lg" />,
    );
    const link = screen.getByRole('link', { name: /MCP in 160 lines/i });
    expect(link).toHaveStyle({ borderRadius: 'var(--radius-lg)' });
  });
});

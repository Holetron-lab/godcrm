/**
 * BlogPostPage — public "Building in Public" single post (`/blog/:slug`).
 *
 * Renders one published post from the public mirror table (100245) using the
 * shared MarkdownPreview for the `body`. No bespoke markdown renderer — the
 * CRM's own preview component (GFM, code, tables, CRM tokens) is reused.
 *
 * The post is resolved from the cached feed query, so navigating from the
 * index or landing is instant (no second fetch).
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useBlogSeo, buildPostSeo } from '@/features/public/useBlogSeo';
import { useBuildingInPublicPost, formatPostDate } from '@/features/public/useBuildingInPublic';

export function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const { post, isLoading } = useBuildingInPublicPost(slug);

  // AC-C2/C3: on a hard-load the SSR-lite backend already rendered the <head>
  // + JSON-LD — the hook detects that and leaves it untouched; on a soft-nav
  // it emits the frozen shape (buildPostSeo) that matches the server exactly.
  useBlogSeo(post ? buildPostSeo(post) : null);

  // AC-A9: createRoot replaces the server-rendered #root — fade the client
  // paint in so the swap from server body → React body isn't a hard cut.
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(true); }, []);

  const chips = post
    ? [formatPostDate(post.date), post.tag].filter((c): c is string => !!c && c.trim() !== '')
    : [];

  return (
    <main
      className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]"
      style={{ opacity: shown ? 1 : 0, transition: 'opacity 180ms ease-out' }}
    >
      <header className="sticky top-0 z-30 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-6">
          <Link to="/" className="text-sm font-semibold tracking-tight hover:text-[var(--color-primary-500)]">
            GOD CRM
          </Link>
          <Link
            to="/blog"
            className="font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            ← ALL POSTS
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        {isLoading ? (
          <div className="animate-pulse space-y-4" aria-busy="true">
            <div className="h-3 w-32 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-8 w-3/4 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-4 w-full rounded bg-[var(--bg-tertiary)]" />
            <div className="h-4 w-5/6 rounded bg-[var(--bg-tertiary)]" />
          </div>
        ) : !post ? (
          <div className="py-16 text-center">
            <p className="mb-4 text-sm text-[var(--text-tertiary)]">Post not found.</p>
            <Link
              to="/blog"
              className="font-mono text-xs uppercase tracking-widest text-[var(--color-primary-500)] hover:underline"
            >
              ← Back to all posts
            </Link>
          </div>
        ) : (
          <>
            {chips.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]">
                {chips.map((chip, i) => (
                  <span key={i} className="inline-flex items-center gap-2">
                    {i > 0 && <span aria-hidden>·</span>}
                    {chip}
                  </span>
                ))}
              </div>
            )}
            <h1 className="mb-6 text-3xl font-black uppercase leading-[1.05] tracking-tighter md:text-4xl">
              {post.title}
            </h1>
            {post.coverUrl && (
              <img
                src={post.coverUrl}
                alt=""
                loading="lazy"
                className="mb-8 aspect-video w-full rounded-[var(--radius-md)] object-cover"
              />
            )}
            {post.body ? (
              <MarkdownPreview content={post.body} />
            ) : (
              post.excerpt && <p className="leading-relaxed text-[var(--text-secondary)]">{post.excerpt}</p>
            )}
            {post.ctaUrl && (
              <div className="mt-10 border-t border-[var(--border-primary)] pt-6">
                <a
                  href={post.ctaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 font-mono text-sm font-black uppercase tracking-widest text-[var(--color-primary-500)] hover:underline"
                >
                  Learn more →
                </a>
              </div>
            )}
          </>
        )}
      </article>
    </main>
  );
}

export default BlogPostPage;

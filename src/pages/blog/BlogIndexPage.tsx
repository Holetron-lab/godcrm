/**
 * BlogIndexPage — public "Building in Public" index.
 *
 * Lists every published Building-in-Public post as neutral CRM cards. Each
 * card links to the in-app post page (`/blog/<slug>`), which renders the
 * post body via the shared MarkdownPreview.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import { RowCardsWidget } from '@/shared/components/RowCardsWidget';
import { useBlogSeo, buildIndexSeo } from '@/features/public/useBlogSeo';
import { useTheme } from '@/shared/hooks/useTheme';
import {
  useBuildingInPublic,
  formatPostDate,
  type BuildingInPublicPost,
} from '@/features/public/useBuildingInPublic';

const BlogThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="border-2 p-2 transition-colors hover:bg-[var(--text-primary)] hover:text-[var(--bg-primary)]"
      style={{ borderColor: 'var(--text-primary)' }}
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
};

export function BlogIndexPage() {
  const { data: posts = [], isLoading, isError } = useBuildingInPublic();

  // AC-C2/C3: skip when the SSR-lite backend already rendered the index head;
  // otherwise emit the frozen ItemList shape matching the server.
  useBlogSeo(buildIndexSeo(posts));

  // AC-A9: fade the client paint in over the server-rendered #root.
  const [shown, setShown] = useState(false);
  useEffect(() => { setShown(true); }, []);

  const showEmpty = !isLoading && (isError || posts.length === 0);

  return (
    <main
      className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]"
      style={{ opacity: shown ? 1 : 0, transition: 'opacity 180ms ease-out' }}
    >
      <header
        className="sticky top-0 z-40 flex h-14 items-center justify-between border-b-2 bg-[var(--bg-primary)] px-4 md:px-6"
        style={{ borderColor: 'var(--text-primary)' }}
      >
        <Link
          to="/"
          className="flex items-center gap-2 font-mono text-sm font-black uppercase tracking-widest transition-opacity hover:opacity-80"
        >
          <span>GOD CRM</span>
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full bg-red-500"
            style={{ animation: 'pulse 2s ease-in-out infinite' }}
          />
        </Link>
        <div className="flex items-center gap-2 md:gap-3">
          <BlogThemeToggle />
          <Link
            to="/"
            className="inline-flex items-center justify-center border-2 px-3 py-2 font-mono text-xs font-black uppercase tracking-widest text-white transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5"
            style={{ background: 'var(--color-primary-500)', borderColor: 'var(--color-primary-500)' }}
          >
            ← BACK
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        <h1 className="mb-2 text-3xl font-black uppercase tracking-tighter md:text-5xl">
          Building in Public
        </h1>
        <p className="mb-10 max-w-2xl text-base leading-relaxed text-[var(--text-secondary)]">
          Notes from building GOD CRM in the open — architecture, decisions, and releases.
        </p>

        {showEmpty ? (
          <p className="text-sm text-[var(--text-tertiary)]">No posts yet. Check back soon.</p>
        ) : (
          <RowCardsWidget<BuildingInPublicPost>
            rows={posts}
            isLoading={isLoading}
            columns={3}
            borderRadius="md"
            ariaLabel="Building in Public posts"
            getKey={(p) => p.id}
            primary={(p) => p.title}
            secondary={(p) => p.excerpt || null}
            meta={(p) => [formatPostDate(p.date), p.tag]}
            linkTo={(p) => p.href}
          />
        )}
      </div>
    </main>
  );
}

export default BlogIndexPage;

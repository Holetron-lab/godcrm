/**
 * LandingNewsSection — "Building in Public" feed on the marketing landing.
 *
 * Reads published posts from the public blog mirror table and renders them
 * with the neutral, reusable RowCardsWidget. Mirrors the KB-preview rule on
 * this page: while there is nothing to show (loading, empty, or error) the
 * whole section renders `null` so the landing never shows an empty shell.
 */

import { Link } from 'react-router-dom';
import { RowCardsWidget } from '@/shared/components/RowCardsWidget';
import {
  useBuildingInPublic,
  formatPostDate,
  type BuildingInPublicPost,
} from '@/features/public/useBuildingInPublic';
import copy from '../../../shared/landing-copy.json';

export function LandingNewsSection() {
  // One clean row on the landing: 3 columns × 1 row. Overflow lives under "ALL POSTS →".
  const { data: posts = [] } = useBuildingInPublic({ limit: 3 });

  // Empty / error / still-loading → no section (same as the hero KB preview).
  if (posts.length === 0) return null;

  // Same top rule as every other block: the section used to sit right under the
  // hero (whose version line was the divider); since v3.3 it follows "What's broken".
  return (
    <section className="brutal-edge relative overflow-hidden border-t-2 px-6 pt-16 pb-16 md:pb-24">
      <div className="brutal-grid" aria-hidden />
      <div className="relative mx-auto max-w-6xl">
        <div className="mb-8 flex items-baseline justify-between gap-4">
          <h2 className="font-mono text-xs font-black uppercase tracking-widest text-[var(--text-secondary)]">
            BUILDING IN PUBLIC
          </h2>
          <div className="flex items-baseline gap-3">
            {/* Doc 255025 §B.4: counted from release notes, grows with every model change
                (shared/landing-copy.json → story.modelSwapsCount). */}
            <span className="shrink-0 border-2 border-[var(--text-primary)] px-2 py-1 font-mono text-[10px] font-black uppercase tracking-widest text-[var(--text-secondary)]">
              MODELS SWAPPED: {copy.story.modelSwapsCount}
            </span>
            <Link
              to="/blog"
              className="font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)] underline decoration-dotted underline-offset-4 transition-colors hover:text-[var(--text-primary)]"
            >
              ALL POSTS →
            </Link>
          </div>
        </div>

        <RowCardsWidget<BuildingInPublicPost>
          rows={posts}
          columns={3}
          borderRadius="md"
          ariaLabel="Building in Public posts"
          getKey={(p) => p.id}
          primary={(p) => p.title}
          secondary={(p) => p.excerpt || null}
          meta={(p) => [formatPostDate(p.date), p.tag]}
          linkTo={(p) => p.href}
        />
      </div>
    </section>
  );
}

export default LandingNewsSection;

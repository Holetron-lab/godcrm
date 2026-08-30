/**
 * useBuildingInPublic — public read of the "Building in Public" blog feed.
 *
 * Source: the public mirror table `100245` in the `s/help` space. Posts are
 * pushed there by the CRM automation engine when a draft's Status flips to
 * `published` (see automation row 3720/177443), re-keyed to the lowercase
 * launch contract: `{ title, slug, date, excerpt, body, tag, cover, cta_url }`.
 * The table only ever holds published posts, so no client-side status filter
 * is needed.
 *
 * Each post renders in-app at `/blog/<slug>` from its `body` markdown — no
 * documents-widget, no per-doc viewer (that branch was dropped).
 *
 * Fails soft: any error resolves to an empty list (callers render nothing).
 */

import { useQuery } from '@tanstack/react-query';
import { publicApi } from './publicApi';

/** Public `s/help` space slug + the blog mirror table (table 100245). */
export const HELP_SLUG = 'help';
export const BLOG_TABLE_ID = 100245;

export interface BuildingInPublicPost {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  /** Full post markdown — rendered on the /blog/<slug> page. */
  body: string;
  /** ISO timestamp used for ordering + the date chip. */
  date: string | null;
  tag: string | null;
  coverUrl: string | null;
  /** Optional call-to-action link rendered at the foot of the post. */
  ctaUrl: string | null;
  /** In-app post route. */
  href: string;
}

function toPost(row: { id: number; data: Record<string, unknown>; updated_at?: string; created_at?: string }): BuildingInPublicPost | null {
  const d = row.data ?? {};
  const slug = typeof d.slug === 'string' ? d.slug : '';
  if (!slug) return null;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    id: row.id,
    slug,
    title: str(d.title) || slug,
    excerpt: str(d.excerpt),
    body: str(d.body),
    date: strOrNull(d.date) ?? row.updated_at ?? row.created_at ?? null,
    tag: strOrNull(d.tag),
    coverUrl: strOrNull(d.cover),
    ctaUrl: strOrNull(d.cta_url),
    href: `/blog/${slug}`,
  };
}

export function useBuildingInPublic(opts: { limit?: number } = {}) {
  const { limit } = opts;

  return useQuery({
    queryKey: ['building-in-public', limit ?? 'all'],
    queryFn: async (): Promise<BuildingInPublicPost[]> => {
      const res = await publicApi.getTableRows(HELP_SLUG, BLOG_TABLE_ID, { limit: limit ?? 500 });
      const rows = res.data?.rows ?? [];

      const posts = rows
        .map(toPost)
        .filter((p): p is BuildingInPublicPost => p !== null)
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

      return limit ? posts.slice(0, limit) : posts;
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Single published post by slug — reuses the cached feed query. */
export function useBuildingInPublicPost(slug: string | undefined) {
  const query = useBuildingInPublic();
  const post = slug ? query.data?.find((p) => p.slug === slug) ?? null : null;
  return { ...query, post };
}

/** Short, locale-stable date chip (e.g. "JUN 19, 2026"). */
export function formatPostDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    .toUpperCase();
}

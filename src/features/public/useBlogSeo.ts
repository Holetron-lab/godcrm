/**
 * useBlogSeo — ADR-190 Zone C: client-side <head>/JSON-LD management for the
 * public blog (`/blog`, `/blog/:slug`) that does NOT fight the request-time
 * SSR-lite backend (Zone A, backend/services/blogSeo.js).
 *
 * Two regimes:
 *
 *  1. Crawler / hard-load. nginx routes `/blog/*` to the Express SSR-lite
 *     handler, which renders a per-post <head> (title/description/canonical/
 *     OG/twitter) + JSON-LD + article body into index.html. React then boots
 *     over it. In this regime the server ALREADY emitted a correct head, so
 *     the client must not re-inject (would duplicate JSON-LD) or clean up
 *     (would strip the server tags). → AC-C2: detect + bail.
 *
 *  2. Soft-nav inside the SPA (e.g. index → post, or landing → post). No
 *     server head was rendered for this route, so the client owns the head
 *     and emits the exact shape Ralph froze. → AC-C3.
 *
 * Server-ownership detection: the static dist/index.html shell ships NO
 * `<link rel="canonical">` (verified) — the ONLY way an *unmanaged* canonical
 * exists on a `/blog/*` document is that the SSR-lite backend put it there.
 * We compare its path (not origin — staging uses a different host) against the
 * current path to distinguish "server rendered THIS page" from a stale server
 * canonical left over after a soft-nav between posts.
 *
 * Client-managed tags are marked with `data-blog-seo` so the guard can tell
 * them apart from server tags, StrictMode double-invokes are idempotent, and
 * cleanup only removes what the client added.
 */

import { useEffect, useRef } from 'react';
import type { BuildingInPublicPost } from './useBuildingInPublic';

/**
 * Frozen production origin for canonical/OG URLs (AC-C3). Marketing host, not
 * the app host: on a hard load `serverOwnsCurrentPage()` bails and the server
 * canonical stands, so this constant is what a reader copies after a soft-nav
 * — it has to match the canonical the crawler was given (ADR-190-A D5).
 */
const SITE_ORIGIN = 'https://godcrm.ai';
const SITE_NAME = 'GOD CRM';
/** Marks tags this hook created or adopted, so it never touches server tags. */
const MANAGED = 'data-blog-seo';

interface MetaSpec {
  attr: 'name' | 'property';
  key: string;
  content: string;
}

export interface BlogSeoSpec {
  title: string;
  canonical: string;
  metas: MetaSpec[];
  jsonLd: Record<string, unknown>;
}

/** http(s)/root-relative only — mirrors backend safeUrl (blogSeo.js). */
function safeUrl(value: string | null | undefined): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) || s.startsWith('/') ? s : '';
}

/** W3C YYYY-MM-DD or undefined — mirrors backend isoDate (blogSeo.js). */
function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

/**
 * AC-C2 — true when the SSR-lite backend already rendered a correct <head> for
 * the current path (an unmanaged canonical whose path matches location).
 */
function serverOwnsCurrentPage(): boolean {
  const link = document.head.querySelector<HTMLLinkElement>(
    `link[rel="canonical"]:not([${MANAGED}])`,
  );
  if (!link) return false;
  try {
    const url = new URL(link.getAttribute('href') || '', window.location.origin);
    return url.pathname === window.location.pathname;
  } catch {
    return false;
  }
}

function upsertMeta({ attr, key, content }: MetaSpec) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  el.setAttribute(MANAGED, '');
}

function upsertCanonical(href: string) {
  // Reuse (adopt) a leftover server canonical from a prior soft-nav rather than
  // stacking a second one; mark it managed so we own it from here.
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
  el.setAttribute(MANAGED, '');
}

function upsertJsonLd(obj: Record<string, unknown>) {
  // Drop any stale server (unmanaged) JSON-LD left over from a server-rendered
  // page we bailed on, so we never end up with two BlogPosting scripts.
  document.head
    .querySelectorAll(`script[type="application/ld+json"]:not([${MANAGED}])`)
    .forEach((n) => n.remove());
  let el = document.head.querySelector<HTMLScriptElement>(
    `script[type="application/ld+json"][${MANAGED}]`,
  );
  if (!el) {
    el = document.createElement('script');
    el.setAttribute('type', 'application/ld+json');
    el.setAttribute(MANAGED, '');
    document.head.appendChild(el);
  }
  // textContent (not innerHTML) → inert; no escaping/breakout concern client-side.
  el.textContent = JSON.stringify(obj);
}

function cleanupManaged(restoreTitle: string) {
  document.title = restoreTitle;
  document.head.querySelectorAll(`[${MANAGED}]`).forEach((n) => n.remove());
}

export function useBlogSeo(spec: BlogSeoSpec | null) {
  const prevTitle = useRef<string>(document.title);
  const specKey = spec ? JSON.stringify(spec) : null;

  useEffect(() => {
    // AC-C2: the backend owns this head — do not inject, do not clean up.
    if (serverOwnsCurrentPage()) return;
    if (!spec) return;

    prevTitle.current = document.title;
    document.title = spec.title;
    spec.metas.forEach(upsertMeta);
    upsertCanonical(spec.canonical);
    upsertJsonLd(spec.jsonLd);

    return () => cleanupManaged(prevTitle.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey]);
}

// ── Frozen shapes (single source of truth, mirrors backend blogSeo.js) ───────

/** Per-post SEO (AC-C3) — identical field-for-field to the SSR-lite output. */
export function buildPostSeo(post: BuildingInPublicPost): BlogSeoSpec {
  const canonical = `${SITE_ORIGIN}/blog/${post.slug}`;
  const desc = post.excerpt || `A post from the ${SITE_NAME} blog.`;
  const image = safeUrl(post.coverUrl);
  const published = isoDate(post.date);

  const metas: MetaSpec[] = [
    { attr: 'name', key: 'description', content: desc },
    { attr: 'property', key: 'og:type', content: 'article' },
    { attr: 'property', key: 'og:title', content: post.title },
    { attr: 'property', key: 'og:description', content: desc },
    { attr: 'property', key: 'og:url', content: canonical },
    ...(image ? [{ attr: 'property' as const, key: 'og:image', content: image }] : []),
    { attr: 'name', key: 'twitter:card', content: 'summary_large_image' },
    { attr: 'name', key: 'twitter:title', content: post.title },
    { attr: 'name', key: 'twitter:description', content: desc },
  ];

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    ...(post.excerpt ? { description: post.excerpt } : {}),
    ...(published ? { datePublished: published } : {}),
    ...(image ? { image } : {}),
    url: canonical,
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    publisher: { '@type': 'Organization', name: SITE_NAME },
  };

  return { title: `${post.title} — ${SITE_NAME} Blog`, canonical, metas, jsonLd };
}

/** Blog index SEO — mirrors the SSR-lite ItemList head. */
export function buildIndexSeo(posts: BuildingInPublicPost[]): BlogSeoSpec {
  const canonical = `${SITE_ORIGIN}/blog`;
  const title = `Blog — ${SITE_NAME}`;
  const desc = `Notes from building ${SITE_NAME} in the open.`;

  const metas: MetaSpec[] = [
    { attr: 'name', key: 'description', content: desc },
    { attr: 'property', key: 'og:type', content: 'website' },
    { attr: 'property', key: 'og:title', content: title },
    { attr: 'property', key: 'og:description', content: desc },
    { attr: 'property', key: 'og:url', content: canonical },
    { attr: 'name', key: 'twitter:card', content: 'summary_large_image' },
  ];

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: posts.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_ORIGIN}/blog/${p.slug}`,
      name: p.title,
    })),
  };

  return { title, canonical, metas, jsonLd };
}

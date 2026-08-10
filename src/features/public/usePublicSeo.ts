/**
 * usePublicSeo - Manages document.title and <meta> tags for public pages.
 *
 * Since the project doesn't use react-helmet-async, we manage meta tags
 * manually via DOM manipulation and clean up on unmount.
 *
 * ADR-105: AC12 (SEO meta tags)
 */

import { useEffect, useRef } from 'react';

interface SeoOptions {
  title?: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  ogImage?: string;
  ogUrl?: string;
  canonicalUrl?: string;
}

function setMetaTag(property: string, content: string, isOg: boolean): HTMLMetaElement {
  const attr = isOg ? 'property' : 'name';
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return el;
}

function removeMetaTag(property: string, isOg: boolean) {
  const attr = isOg ? 'property' : 'name';
  const el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${property}"]`);
  if (el) el.remove();
}

/**
 * Set or update the <link rel="canonical"> tag.
 */
function setCanonicalLink(url: string): HTMLLinkElement {
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', url);
  return el;
}

function removeCanonicalLink() {
  const el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (el) el.remove();
}

export function usePublicSeo(options: SeoOptions) {
  const prevTitleRef = useRef<string>(document.title);

  useEffect(() => {
    // Store the original title on first mount so we can restore it
    prevTitleRef.current = document.title;
  }, []);

  useEffect(() => {
    const { title, description, ogTitle, ogDescription, ogType, ogImage, ogUrl, canonicalUrl } = options;

    // Title
    if (title) {
      document.title = title;
    }

    // Meta description
    if (description) {
      setMetaTag('description', description, false);
    }

    // Open Graph
    if (ogTitle) {
      setMetaTag('og:title', ogTitle, true);
    }
    if (ogDescription) {
      setMetaTag('og:description', ogDescription, true);
    }
    if (ogType) {
      setMetaTag('og:type', ogType, true);
    }
    if (ogImage) {
      setMetaTag('og:image', ogImage, true);
    }
    if (ogUrl) {
      setMetaTag('og:url', ogUrl, true);
    }

    // Canonical URL
    const effectiveCanonical = canonicalUrl || ogUrl;
    if (effectiveCanonical) {
      setCanonicalLink(effectiveCanonical);
    }

    return () => {
      // Restore original title
      document.title = prevTitleRef.current;

      // Remove meta tags we added
      removeMetaTag('description', false);
      removeMetaTag('og:title', true);
      removeMetaTag('og:description', true);
      removeMetaTag('og:type', true);
      removeMetaTag('og:image', true);
      removeMetaTag('og:url', true);
      removeCanonicalLink();
    };
  }, [
    options.title, options.description, options.ogTitle, options.ogDescription,
    options.ogType, options.ogImage, options.ogUrl, options.canonicalUrl,
  ]);
}

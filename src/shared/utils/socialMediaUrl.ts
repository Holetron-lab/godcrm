export interface SocialMediaUrl {
  provider: 'YouTube' | 'Pinterest' | 'Instagram';
  embedUrl?: string;
}

/** Only exact provider hosts may create cards; user URLs never become iframe URLs. */
export function parseSocialMediaUrl(href: string): SocialMediaUrl | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(host)) {
    return { provider: 'Instagram' };
  }
  if (/^(?:(?:www|ru|m)\.)?pinterest\.(?:com|ru|co\.uk|de|fr|es|it|ca|com\.au)$/.test(host)
      || host === 'pin.it') {
    return { provider: 'Pinterest' };
  }
  let id: string | undefined;
  if (host === 'youtu.be') {
    id = /^\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
    'www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') ?? undefined
      : /^\/(?:shorts|live|embed)\/([\w-]{11})\/?$/.exec(url.pathname)?.[1];
  }
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const time = url.searchParams.get('t') ?? url.searchParams.get('start')
    ?? new URLSearchParams(url.hash.slice(1)).get('t') ?? '';
  const units = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(time);
  const seconds = /^\d+$/.test(time) ? Number(time)
    : units ? Number(units[1] || 0) * 3600 + Number(units[2] || 0) * 60 + Number(units[3] || 0) : 0;
  const start = Number.isSafeInteger(seconds) && seconds > 0 ? `?start=${seconds}` : '';
  return { provider: 'YouTube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}${start}` };
}

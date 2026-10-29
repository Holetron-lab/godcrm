import { type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { parseSocialMediaUrl } from '../utils/socialMediaUrl';

/** Phrasing-only markup: safe inside Markdown paragraphs and plain-text spans. */
export function SocialMediaLink({ href, children }: { href: string; children: ReactNode }) {
  const { language } = useLanguage();
  const media = parseSocialMediaUrl(href);
  const ru = language === 'ru';
  const link = <a href={href} target="_blank" rel="noopener noreferrer"
    onClick={event => event.stopPropagation()}
    className="text-[var(--text-primary)] underline break-all focus-visible:outline focus-visible:outline-2">
    {children}
  </a>;
  if (!media) return link;
  const openLabel = `${ru ? 'Открыть в' : 'Open in'} ${media.provider}`;
  if (!media.embedUrl) return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-social-provider={media.provider}
      onClick={event => event.stopPropagation()}
      className="my-2 flex w-full max-w-sm flex-col gap-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 whitespace-normal">
      <span className="flex items-center justify-between gap-2 font-semibold">
        {media.provider}<ExternalLink size={16} aria-hidden="true" />
      </span>
      <span className="break-all text-sm text-[var(--text-secondary)]">{children}</span>
      <span className="text-sm underline">{openLabel}</span>
    </a>
  );
  return (
    <span data-social-provider={media.provider} className="my-2 block w-full max-w-lg whitespace-normal">
      {link}
      <iframe src={media.embedUrl} title="YouTube" className="mt-2 aspect-video w-full rounded-lg border-0"
        referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      <span className="mt-1 block text-xs text-[var(--text-secondary)]">
        {ru ? 'Если видео недоступно, откройте ссылку на YouTube.' : 'If the video is unavailable, open the YouTube link.'}
      </span>
    </span>
  );
}

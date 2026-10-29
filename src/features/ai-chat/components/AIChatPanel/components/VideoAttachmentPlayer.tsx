import { useEffect, useState } from 'react';
import { CaptionedMedia } from '@/shared/components/CaptionedMedia';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';

/** The renderer keys this component by source, releasing media when it changes. */
export function VideoAttachmentPlayer({ src, name }: { src: string; name: string }) {
  const { t } = useLanguage();
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  let protectedUrl: string | undefined;
  try {
    const url = new URL(src, window.location.href);
    if (url.origin === window.location.origin && /^\/(uploads|downloads)\//.test(url.pathname)) protectedUrl = url.href;
  } catch { /* Native media reports invalid sources through onError. */ }
  const playbackSrc = protectedUrl ? resolved : src;

  useEffect(() => {
    if (!protectedUrl || !attempt) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setLoading(true); setFailed(false); setResolved(undefined);
    const token = apiClient.getAccessToken();
    // Native media cannot send the API bearer header. Fetch only on request,
    // and never forward credentials outside the same-origin file mounts.
    void fetch(protectedUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      credentials: 'same-origin', redirect: 'error', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error('Video fetch failed');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setResolved(objectUrl);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [protectedUrl, attempt]);

  return (
    <div className="w-full min-w-0 max-w-[480px] space-y-2 rounded-lg bg-[var(--bg-tertiary)] p-2 text-sm text-[var(--text-primary)]">
      {playbackSrc && <CaptionedMedia key={`${playbackSrc}:${attempt}`} kind="video" src={playbackSrc}
        controls playsInline ariaLabel={name} preload="metadata" className="max-h-80 w-full rounded bg-black"
        onError={() => setFailed(true)} />}
      {(!playbackSrc || failed) && <button type="button" disabled={loading}
        className="min-h-11 max-w-full rounded px-3 py-2 text-left break-words hover:bg-[var(--bg-secondary)] focus-visible:outline focus-visible:outline-2 disabled:opacity-60"
        onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>
        {t('aiChat.ui.loadVideo', { name })}
      </button>}
      {loading && <p role="status">{t('aiChat.ui.loading')}</p>}
      {failed && <p role="alert">{t('aiChat.ui.videoLoadFailed')}</p>}
      {playbackSrc ? <a href={playbackSrc} download={name} target="_blank" rel="noopener noreferrer"
        className="block break-words underline">{name}</a> : <p className="break-words">{name}</p>}
    </div>
  );
}

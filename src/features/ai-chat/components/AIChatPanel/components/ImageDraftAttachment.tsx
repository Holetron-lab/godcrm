import { useEffect, useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { ImageOff } from 'lucide-react';

/** Own the local preview URL so removing/replacing a draft releases the file. */
export function ImageDraftAttachment({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    setFailed(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" aria-label={file.name}
            className="w-4 h-4 shrink-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]">
            {failed ? <ImageOff className="w-4 h-4" aria-hidden="true" /> : url && (
              <img src={url} alt="" className="w-4 h-4 rounded-sm object-cover" onError={() => setFailed(true)} />
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={8} collisionPadding={8}
            className="z-[9999] max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1 shadow-lg text-xs text-[var(--text-primary)]">
            {failed ? <span>{file.name}</span> : url && (
              <img src={url} alt={file.name} onError={() => setFailed(true)}
                className="max-w-[min(320px,calc(100vw-2rem))] max-h-[min(240px,50vh)] rounded object-contain" />
            )}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

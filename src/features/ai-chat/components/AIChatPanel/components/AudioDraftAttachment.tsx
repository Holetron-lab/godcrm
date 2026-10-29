import { useEffect, useState } from 'react';
import { AudioAttachmentPlayer } from './AudioAttachmentPlayer';

export function AudioDraftAttachment({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <AudioAttachmentPlayer src={url} name={file.name}
    recordedDuration={(file as File & { duration?: number }).duration} onRemove={onRemove} />;
}

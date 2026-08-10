/**
 * File type detection helpers
 * Extracted from AIChatPanel.tsx (lines 132-153)
 */

/** Get file extension from URL or filename */
export const getFileExtension = (urlOrName: string): string => {
  const parts = urlOrName.split('/').pop()?.split('.') || [];
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
};

/** Check if file is an image */
export const isImageFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
};

/** Check if file is a video */
export const isVideoFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext);
};

/** Check if file is audio */
export const isAudioFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext);
};

/** Check if file is a 3D model */
export const is3DFile = (urlOrName: string): boolean => {
  const ext = getFileExtension(urlOrName);
  return ['glb', 'gltf'].includes(ext);
};

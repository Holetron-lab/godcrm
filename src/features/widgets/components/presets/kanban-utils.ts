// Kanban utility functions extracted from KanbanWidget

// Default lane colors for columns without custom colors
export const DEFAULT_LANE_COLORS = [
  '#3b82f6', // blue
  '#a855f7', // purple
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#ef4444', // red
  '#84cc16', // lime
];

// Helper to convert hex to rgba for transparency
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Helper: get file name from URL
export function getFileNameFromUrl(url: string): string {
  const parts = url.split('/');
  return decodeURIComponent(parts[parts.length - 1]);
}

// Helper: get file extension
export function getFileExtension(url: string): string {
  const fileName = getFileNameFromUrl(url);
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

// Helper: get file icon emoji by extension
export function getFileIcon(url: string): string {
  const ext = getFileExtension(url);
  const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
  if (imgExts.includes(ext)) return '🖼️';
  if (ext === 'pdf') return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx'].includes(ext)) return '📊';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
  if (['mp3', 'wav', 'ogg'].includes(ext)) return '🎵';
  if (['mp4', 'avi', 'mov', 'webm'].includes(ext)) return '🎥';
  return '📎';
}

// Helper to format short date (e.g., "5 дек" or "12 янв")
export function formatShortDate(value: unknown): string {
  if (!value) return '';
  try {
    const date = new Date(value as string | number | Date);
    if (isNaN(date.getTime())) return '';
    const day = date.getDate();
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${day} ${months[date.getMonth()]}`;
  } catch {
    return '';
  }
}

// Helper to check if date is overdue
export function isOverdue(value: unknown): boolean {
  if (!value) return false;
  try {
    const date = new Date(value as string | number | Date);
    if (isNaN(date.getTime())) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  } catch {
    return false;
  }
}

// Helper to format date for input[type="date"] or input[type="datetime-local"]
export function formatDateForInput(value: unknown, colType: string): string {
  if (!value) return '';
  try {
    const date = new Date(value as string | number | Date);
    if (isNaN(date.getTime())) return '';
    if (colType === 'datetime') {
      // Format: YYYY-MM-DDTHH:mm
      return date.toISOString().slice(0, 16);
    }
    // Format: YYYY-MM-DD
    return date.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

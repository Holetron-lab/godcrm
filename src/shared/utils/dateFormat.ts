/**
 * Date formatting utilities
 * Supports EU (DD.MM.YYYY) and US (MM/DD/YYYY) formats
 */

export type DateFormatStyle = 'short' | 'medium' | 'long' | 'iso';

// Detect user locale preference (EU uses DD.MM, US uses MM/DD)
function isEUFormat(): boolean {
  // Check browser locale
  const locale = navigator.language || 'en-US';
  const euLocales = ['ru', 'de', 'fr', 'es', 'it', 'pl', 'nl', 'pt', 'cs', 'uk', 'bg', 'ro', 'hu', 'sv', 'da', 'fi', 'no'];
  return euLocales.some(l => locale.startsWith(l));
}

/**
 * Format a date string or Date object
 * @param date - Date to format (string or Date)
 * @param style - Formatting style
 * @returns Formatted date string
 */
export function formatDate(date: string | Date | undefined | null, style: DateFormatStyle = 'short'): string {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  
  const eu = isEUFormat();
  
  switch (style) {
    case 'short':
      // DD.MM.YYYY or MM/DD/YYYY
      return eu ? `${day}.${month}.${year}` : `${month}/${day}/${year}`;
    
    case 'medium':
      // DD.MM.YYYY HH:MM or MM/DD/YYYY HH:MM
      return eu 
        ? `${day}.${month}.${year} ${hours}:${minutes}`
        : `${month}/${day}/${year} ${hours}:${minutes}`;
    
    case 'long': {
      // "2 февраля 2026" or "February 2, 2026"
      const monthNames = eu
        ? ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
        : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      return eu
        ? `${d.getDate()} ${monthNames[d.getMonth()]} ${year}`
        : `${monthNames[d.getMonth()]} ${d.getDate()}, ${year}`;
    }
    
    case 'iso':
      // YYYY-MM-DD
      return `${year}-${month}-${day}`;
    
    default:
      return eu ? `${day}.${month}.${year}` : `${month}/${day}/${year}`;
  }
}

/**
 * Format relative time (e.g., "2 дня назад", "через 3 часа")
 */
export function formatRelativeTime(date: string | Date | undefined | null): string {
  if (!date) return '';
  
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffSecs = Math.round(diffMs / 1000);
  const diffMins = Math.round(diffSecs / 60);
  const diffHours = Math.round(diffMins / 60);
  const diffDays = Math.round(diffHours / 24);
  
  const eu = isEUFormat();
  
  if (diffDays > 0) {
    return eu ? `через ${diffDays} дн.` : `in ${diffDays}d`;
  } else if (diffDays < 0) {
    return eu ? `${Math.abs(diffDays)} дн. назад` : `${Math.abs(diffDays)}d ago`;
  } else if (diffHours > 0) {
    return eu ? `через ${diffHours} ч.` : `in ${diffHours}h`;
  } else if (diffHours < 0) {
    return eu ? `${Math.abs(diffHours)} ч. назад` : `${Math.abs(diffHours)}h ago`;
  } else if (diffMins !== 0) {
    return diffMins > 0 
      ? (eu ? `через ${diffMins} мин.` : `in ${diffMins}m`)
      : (eu ? `${Math.abs(diffMins)} мин. назад` : `${Math.abs(diffMins)}m ago`);
  } else {
    return eu ? 'сейчас' : 'now';
  }
}

export default { formatDate, formatRelativeTime };

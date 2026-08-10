import { Clock, CalendarDays, Calendar } from 'lucide-react';
import { createElement } from 'react';
import type { TimeScale } from './types';

export const TIME_SCALE_OPTIONS: { value: TimeScale; label: string; icon: React.ReactNode }[] = [
  { value: 'minute', label: '1 мин', icon: createElement(Clock, { className: 'w-4 h-4' }) },
  { value: 'hour', label: '1 час', icon: createElement(Clock, { className: 'w-4 h-4' }) },
  { value: 'day', label: '1 день', icon: createElement(CalendarDays, { className: 'w-4 h-4' }) },
  { value: 'week', label: '1 неделя', icon: createElement(Calendar, { className: 'w-4 h-4' }) },
  { value: 'month', label: '1 месяц', icon: createElement(Calendar, { className: 'w-4 h-4' }) },
];

// Default colors for events
export const DEFAULT_EVENT_COLORS = [
  '#3b82f6', '#a855f7', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#84cc16',
];

export const getDefaultColor = (index: number) => DEFAULT_EVENT_COLORS[index % DEFAULT_EVENT_COLORS.length];

export const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

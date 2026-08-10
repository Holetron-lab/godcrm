/**
 * NumberPreview - Preview section for number column display styles
 */

import React from 'react';
import type { ColumnSettingsProps } from './types';

export const NumberPreview: React.FC<Pick<ColumnSettingsProps, 'draft'>> = ({ draft }) => {
  const nc = draft.config?.number;
  const displayStyle = nc?.displayStyle;
  const prefix = nc?.prefix || '';
  const suffix = nc?.suffix || '';
  const progressColor = nc?.progressColor || '#22c55e';
  const badgeColor = nc?.badgeColor || '#6366f1';

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg bg-[var(--bg-tertiary)]">
      <span className="text-sm text-[var(--text-secondary)]">Превью:</span>
      <div className="flex flex-wrap gap-4 items-center">
        {/* Default */}
        {(!displayStyle || displayStyle === 'default') && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-mono">
              {prefix}{nc?.thousandsSeparator ? '1 234' : '1234'}{suffix}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">Обычный</span>
          </div>
        )}
        {/* Badge */}
        {displayStyle === 'badge' && (
          <div className="flex flex-col items-center gap-1">
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: `${badgeColor}20`,
                color: badgeColor,
                border: `1px solid ${badgeColor}40`
              }}
            >
              {prefix}42{suffix}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">Бейдж</span>
          </div>
        )}
        {/* Progress */}
        {displayStyle === 'progress' && (
          <div className="flex flex-col items-center gap-1 w-32">
            <div className="flex items-center gap-2 w-full">
              <div className="flex-1 h-2 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: '75%', backgroundColor: progressColor }}
                />
              </div>
              <span className="text-xs font-mono">{prefix}75{suffix}</span>
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">Прогресс</span>
          </div>
        )}
        {/* Currency */}
        {displayStyle === 'currency' && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-mono tabular-nums">
              {prefix || '$'}1 234.00{suffix}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">Валюта</span>
          </div>
        )}
        {/* Percent */}
        {displayStyle === 'percent' && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-1.5">
              <div className="w-12 h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-green-500" style={{ width: '85%' }} />
              </div>
              <span className="text-xs font-mono">{prefix}85%</span>
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">Процент</span>
          </div>
        )}
        {/* Compact */}
        {displayStyle === 'compact' && (
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-medium">
              {prefix}1.2M{suffix}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">Компактный</span>
          </div>
        )}
        {/* Vertical Progress */}
        {displayStyle === 'progress-vertical' && (
          <div className="flex flex-col items-center gap-1">
            <div className="h-12 w-3 bg-[var(--bg-primary)] rounded-full overflow-hidden flex flex-col-reverse">
              <div
                className="w-full rounded-full"
                style={{ height: '75%', backgroundColor: progressColor }}
              />
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">Верт.</span>
          </div>
        )}
        {/* Ring Progress */}
        {displayStyle === 'progress-ring' && (
          <div className="flex flex-col items-center gap-1">
            <svg width="32" height="32" className="transform -rotate-90">
              <circle cx="16" cy="16" r="12" fill="none" stroke="var(--bg-primary)" strokeWidth="3" />
              <circle
                cx="16" cy="16" r="12" fill="none"
                stroke={progressColor}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 12}
                strokeDashoffset={2 * Math.PI * 12 * 0.25}
              />
            </svg>
            <span className="text-xs text-[var(--text-tertiary)]">Кольцо</span>
          </div>
        )}
        {/* Rating */}
        {displayStyle === 'rating' && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-0.5">
              {[1,2,3].map(i => (
                <svg key={i} className="w-4 h-4" viewBox="0 0 20 20" fill={nc?.progressColor || '#fbbf24'}>
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
              {[4,5].map(i => (
                <svg key={i} className="w-4 h-4" viewBox="0 0 20 20" fill="var(--bg-primary)">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
              ))}
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">Рейтинг</span>
          </div>
        )}
        {/* Slider */}
        {displayStyle === 'slider' && (
          <div className="flex flex-col items-center gap-1 w-24">
            <div className="w-full h-1.5 bg-[var(--bg-primary)] rounded-full relative">
              <div
                className="h-full rounded-full"
                style={{ width: '65%', backgroundColor: nc?.progressColor || '#6366f1' }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full shadow-md border-2 border-white"
                style={{
                  left: 'calc(65% - 6px)',
                  backgroundColor: nc?.progressColor || '#6366f1'
                }}
              />
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">Слайдер</span>
          </div>
        )}
        {/* Stepper preview */}
        {nc?.style === 'stepper' && (
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-0.5">
              <div className="flex items-center justify-center w-6 h-6 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                <span className="text-xs">−</span>
              </div>
              <span className="min-w-[3rem] text-center text-sm font-mono px-1">
                {prefix}42{suffix}
              </span>
              <div className="flex items-center justify-center w-6 h-6 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                <span className="text-xs">+</span>
              </div>
            </div>
            <span className="text-xs text-[var(--text-tertiary)]">Счётчик</span>
          </div>
        )}
      </div>
    </div>
  );
};

import { ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// 100 популярных emoji для таблиц и бизнеса (без дубликатов)
const POPULAR_EMOJIS = [
  // Объекты и документы
  '📊', '📈', '📉', '📋', '📁', '📂', '📄', '📝', '📌', '📎',
  '🔖', '🏷️', '📦', '🗂️', '🗃️', '💼', '🎯', '🔑', '🔒', '🔓',
  // Статусы
  '✅', '❌', '⭐', '🌟', '💡', '⚡', '🔥', '💎', '🏆', '🎉',
  '✨', '💫', '🚀', '🎁', '💪', '👍', '👎', '👀', '💬', '📢',
  // Люди и работа
  '👤', '👥', '🧑‍💼', '👨‍💻', '👩‍💻', '🤝', '💰', '💵', '💳', '🏦',
  // Время и календарь
  '📅', '🗓️', '⏰', '⏱️', '🕐', '📆', '🔔', '🔕', '⌛', '⏳',
  // Категории
  '🏠', '🏢', '🏭', '🚗', '✈️', '🚢', '📱', '💻', '🖥️', '🖨️',
  // Природа и погода
  '🌍', '🌎', '🌏', '☀️', '🌙', '🌤️', '🌈', '🌊', '🌲', '🌸',
  // Еда (для продуктов)
  '🍎', '🍕', '🍔', '☕', '🍷', '🎂', '🍫', '🥗', '🥤', '🍿',
  // Символы
  '➡️', '⬅️', '⬆️', '⬇️', '🔄', '♻️', '🔗', '📧', '🌐', '💠'
];

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  compact?: boolean;
  label?: string;
  /** Size variant: 'sm' (30px), 'md' (40px - default), 'lg' (48px) */
  size?: 'sm' | 'md' | 'lg';
  portal?: boolean;
  /** Show only the dropdown arrow button (no input) — for use when emoji is displayed separately */
  buttonOnly?: boolean;
  /** Position of the dropdown arrow button: 'right' (default) or 'bottom' */
  buttonPosition?: 'right' | 'bottom';
}

export const EmojiPicker = ({
  value,
  onChange,
  compact = false,
  label,
  size = 'md',
  portal = false,
  buttonOnly = false,
  buttonPosition = 'right'
}: EmojiPickerProps) => {
  const { t } = useLanguage();
  const effectiveLabel = label ?? t('emojiPicker.defaultLabel');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [portalStyle, setPortalStyle] = useState<{ top: number; left: number } | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!portal || !isOpen) return;
    const updatePosition = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPortalStyle({
        top: rect.bottom + 4,
        left: rect.left
      });
    };
    const target =
      containerRef.current?.closest<HTMLElement>('[data-radix-dialog-content]') ?? document.body;
    setPortalTarget(target);
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [portal, isOpen]);

  // Size classes based on variant
  const sizeClasses = {
    sm: {
      input: 'h-[38px] w-10 text-lg',
      button: 'h-[38px] w-[26px]',
      grid: 'grid-cols-8 gap-0.5',
      cell: 'w-6 h-6 text-sm',
      dropdown: 'w-[180px]'
    },
    md: {
      input: 'h-10 w-12 text-xl',
      button: 'h-10 w-8',
      grid: 'grid-cols-8 gap-0.5',
      cell: 'w-7 h-7 text-base',
      dropdown: 'w-[250px]'
    },
    lg: {
      input: 'h-12 w-14 text-2xl',
      button: 'h-12 w-10',
      grid: 'grid-cols-8 gap-1',
      cell: 'w-8 h-8 text-lg',
      dropdown: 'w-[280px]'
    }
  };

  const s = sizeClasses[size];

  const handleSelectEmoji = (emoji: string) => {
    onChange(emoji);
    setIsOpen(false);
  };

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className={`bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-2 ${s.dropdown}`}
    >
      <div className={`grid ${s.grid} max-h-[200px] overflow-y-auto overflow-x-hidden`}>
        {POPULAR_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => handleSelectEmoji(emoji)}
            className={`${s.cell} flex items-center justify-center rounded transition-colors ${
              value === emoji 
                ? 'bg-[var(--color-primary-500)]/20 ring-1 ring-[var(--color-primary-500)]' 
                : 'hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      
      <div className="mt-2 pt-2 border-t border-[var(--border-secondary)]">
        <button
          type="button"
          onClick={() => handleSelectEmoji('')}
          className="w-full text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] py-1 hover:bg-[var(--bg-tertiary)] rounded"
        >
          Убрать иконку
        </button>
      </div>
    </div>
  );

  const dropdown = isOpen ? (
    portal ? (
      portalStyle && portalTarget
        ? createPortal(
            <div
              className="fixed z-[9999] pointer-events-auto"
              style={{ top: portalStyle.top, left: portalStyle.left }}
            >
              {dropdownContent}
            </div>,
            portalTarget
          )
        : null
    ) : (
      <div className="absolute top-full left-0 mt-1 z-[9999]">
        {dropdownContent}
      </div>
    )
  ) : null;

  // Button-only version — just a small arrow button, emoji shown externally
  if (buttonOnly) {
    return (
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-10 h-4 rounded-b-md border border-t-0 border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center opacity-60 hover:opacity-100"
          title={t('emojiPicker.changeEmoji')}
        >
          <ChevronDown className={`w-3 h-3 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {dropdown}
      </div>
    );
  }

  // Compact version for inline use (e.g., in CSV import rows)
  if (compact) {
    if (buttonPosition === 'bottom') {
      return (
        <div ref={containerRef} className={`relative flex flex-col ${size === 'sm' ? 'w-[38px]' : size === 'md' ? 'w-12' : 'w-14'}`}>
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const val = e.target.value;
              if ([...val].length <= 2) onChange(val);
            }}
            placeholder="🎫"
            className={`${s.input} !w-full text-center rounded-t-md border border-b-0 border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] placeholder:opacity-50`}
          />
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="w-full h-[8px] rounded-b-md border border-t-0 border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center flex-shrink-0 opacity-60 hover:opacity-100"
          >
            <ChevronDown className={`w-2.5 h-2.5 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
          {dropdown}
        </div>
      );
    }
    return (
      <div ref={containerRef} className="relative">
        <div className="flex">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              const val = e.target.value;
              // Allow emoji input (can be 1-2 characters for combined emoji)
              if ([...val].length <= 2) onChange(val);
            }}
            placeholder="🎫"
            className={`${s.input} text-center rounded-l-md border border-r-0 border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] placeholder:opacity-50`}
          />
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className={`${s.button} rounded-r-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center flex-shrink-0`}
          >
            <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {dropdown}
      </div>
    );
  }

  // Full version with label and input field
  return (
    <div ref={containerRef} className="relative">
      {/* Label styled to match Input component */}
      {effectiveLabel && (
        <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1">
          {effectiveLabel}
        </label>
      )}
      <div className="flex">
        {/* Emoji input - user can type/paste their own emoji */}
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const val = e.target.value;
            // Allow emoji input (can be 1-2 characters for combined emoji)
            if ([...val].length <= 2) onChange(val);
          }}
          placeholder="🎫"
          className={`${s.input} text-center rounded-l-lg border border-r-0 border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] placeholder:opacity-50`}
        />
        {/* Dropdown button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`${s.button} rounded-r-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center`}
        >
          <ChevronDown className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      
      {dropdown}
    </div>
  );
};

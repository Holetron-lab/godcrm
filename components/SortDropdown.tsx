/**
 * SortDropdown - TASK-043
 * 
 * Dropdown for selecting sort order in lists.
 * Supports: space, alphabet, participants, date
 */

import { useState, useRef, useEffect } from 'react';
import { 
  ArrowUpDown, 
  Folder, 
  SortAsc, 
  Users, 
  Calendar,
  Check,
  ChevronDown
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export type SortOption = 'date' | 'space' | 'alphabet' | 'participants';

interface SortConfig {
  value: SortOption;
  label: string;
  icon: React.ReactNode;
}

const SORT_OPTIONS: SortConfig[] = [
  { value: 'date', label: 'По дате', icon: <Calendar className="w-3.5 h-3.5" /> },
  { value: 'space', label: 'По спейсу', icon: <Folder className="w-3.5 h-3.5" /> },
  { value: 'alphabet', label: 'По алфавиту', icon: <SortAsc className="w-3.5 h-3.5" /> },
  { value: 'participants', label: 'По участникам', icon: <Users className="w-3.5 h-3.5" /> },
];

interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
  options?: SortOption[];
  className?: string;
}

export function SortDropdown({
  value,
  onChange,
  options,
  className,
}: SortDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter available options
  const availableOptions = options 
    ? SORT_OPTIONS.filter(opt => options.includes(opt.value))
    : SORT_OPTIONS;

  const currentOption = SORT_OPTIONS.find(opt => opt.value === value) || SORT_OPTIONS[0];

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors",
          isOpen 
            ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
            : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        )}
        title="Сортировка"
      >
        {currentOption.icon}
        <span className="hidden sm:inline">{currentOption.label}</span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform",
          isOpen && "rotate-180"
        )} />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[140px] py-1 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg">
          {availableOptions.map(option => (
            <button
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors",
                value === option.value
                  ? "text-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              )}
            >
              {option.icon}
              <span className="flex-1">{option.label}</span>
              {value === option.value && <Check className="w-3.5 h-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default SortDropdown;

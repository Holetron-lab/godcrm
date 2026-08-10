import { useLanguage, availableLanguages } from '@/shared/i18n/LanguageContext';
import { Languages } from 'lucide-react';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Language</span>
      <Languages
        className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[var(--text-secondary)]"
        aria-hidden="true"
      />
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as typeof language)}
        className="appearance-none rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] py-1 pl-7 pr-6 text-xs text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
        aria-label="Switch language"
      >
        {availableLanguages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 8 5"
        className="pointer-events-none absolute right-1.5 h-2 w-2 text-[var(--text-secondary)]"
      >
        <path d="M0 0 L4 5 L8 0 Z" fill="currentColor" />
      </svg>
    </label>
  );
}

import { availableLanguages, useLanguage } from '@/shared/i18n/LanguageContext';
import { ChevronDown } from 'lucide-react';

export const LanguageSwitcher = () => {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="relative">
      <select
        aria-label="Language selector"
        className="w-full appearance-none rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 pr-10 text-sm text-[var(--text-primary)] focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
        value={language}
        onChange={(event) => setLanguage(event.target.value as typeof language)}
      >
        {availableLanguages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
        <ChevronDown className="h-4 w-4 text-[var(--text-tertiary)]" />
      </div>
    </div>
  );
};

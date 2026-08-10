import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { translations, SupportedLanguage } from './translations';

type TranslationKey = string;

export type TranslationParams = Record<string, unknown>;

export interface LanguageContextValue {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const STORAGE_KEY = 'god-crm-language';

const fallbackLanguage: SupportedLanguage = 'en';

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const getInitialLanguage = (): SupportedLanguage => {
  if (typeof window === 'undefined') {
    return fallbackLanguage;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY) as SupportedLanguage | null;
  if (stored && stored in translations) {
    return stored;
  }
  const browser = window.navigator.language.slice(0, 2) as SupportedLanguage;
  return browser in translations ? browser : fallbackLanguage;
};

const getNestedTranslation = (dictionary: Record<string, unknown>, parts: string[]): unknown => {
  return parts.reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dictionary);
};

const interpolate = (template: string, params?: TranslationParams): string => {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
};

const resolveTranslation = (language: SupportedLanguage, key: string, params?: TranslationParams) => {
  const parts = key.split('.');
  const value = getNestedTranslation(translations[language] as Record<string, unknown>, parts);
  if (typeof value === 'string') {
    return interpolate(value, params);
  }
  const fallbackValue = getNestedTranslation(translations[fallbackLanguage] as Record<string, unknown>, parts);
  return typeof fallbackValue === 'string' ? interpolate(fallbackValue, params) : key;
};

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {
  const [language, setLanguage] = useState<SupportedLanguage>(getInitialLanguage);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, language);
    }
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage,
    t: (key: string, params?: TranslationParams) => resolveTranslation(language, key, params)
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider');
  }
  return context;
};

export const availableLanguages: Array<{ code: SupportedLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' }
];

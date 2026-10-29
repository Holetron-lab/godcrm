// renderWithProviders — render a component under the contexts the app gives it.
//
// A large block of the recorded test failures was one error repeated:
//
//   Error: useLanguage must be used within LanguageProvider
//
// These suites were written before the component (or something it renders) was
// migrated to i18n, so they call bare `render()`. `useLanguage` throws by design
// when the provider is missing — that invariant is worth keeping, so the fix
// belongs on the test side.
//
// Language defaults to 'ru' on purpose: the suites assert the Russian UI copy
// they were written against, while jsdom's navigator.language is 'en-US', so a
// bare LanguageProvider would render English and turn one error into twenty
// "unable to find the text" errors. Pass `{ language: 'en' }` for a suite that
// actually asserts English.

import * as React from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import type { SupportedLanguage } from '@/shared/i18n/translations';

const LANGUAGE_STORAGE_KEY = 'god-crm-language';

export interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  /** UI language for this render. Default 'ru' — see the note above. */
  language?: SupportedLanguage;
  /** Supply your own client to assert on the cache; one is created otherwise. */
  queryClient?: QueryClient;
}

/** Retries off: a failing query should surface in the test, not be retried into a timeout. */
export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false }
    }
  });

export function ProvidersWrapper({
  children,
  language = 'ru',
  queryClient
}: {
  children: React.ReactNode;
  language?: SupportedLanguage;
  queryClient?: QueryClient;
}) {
  // LanguageProvider reads this in a useState initializer, so it must be set
  // before the first render — not in an effect.
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  const client = React.useMemo(() => queryClient ?? createTestQueryClient(), [queryClient]);

  return (
    <QueryClientProvider client={client}>
      <LanguageProvider>{children}</LanguageProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: React.ReactElement,
  { language = 'ru', queryClient, ...options }: ProviderOptions = {}
): RenderResult {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  return render(ui, {
    wrapper: ({ children }) => (
      <ProvidersWrapper language={language} queryClient={queryClient}>
        {children}
      </ProvidersWrapper>
    ),
    ...options
  });
}

export default renderWithProviders;

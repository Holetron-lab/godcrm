import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useEffect, useState } from 'react';
import { ThemeProvider } from '@/shared/hooks/useTheme';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { StatusBarProvider } from '@/shared/components/desktop/StatusBarContext';

interface AppProvidersProps {
  children: ReactNode;
}

export const AppProviders = ({ children }: AppProvidersProps) => {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60,
            retry: 1,
            refetchOnWindowFocus: false
          }
        }
      })
  );
  const initializeAuth = useAuthStore((state) => state.initialize);

  useEffect(() => {
    void initializeAuth();
  }, [initializeAuth]);

  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <ThemeProvider>
          <StatusBarProvider>{children}</StatusBarProvider>
        </ThemeProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
};

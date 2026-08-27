'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useEffect, useState } from 'react';

// Sonner's richColors palette is fixed per `theme` prop — it doesn't read
// our CSS custom properties, so without this the error/success toasts stay
// light-mode pink/green even when the app is in dark mode. Theme here is
// toggled manually (see theme-toggle.tsx), not via next-themes, so we watch
// the `.dark` class directly instead of relying on prefers-color-scheme.
function useIsDark() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    setIsDark(root.classList.contains('dark'));
    const observer = new MutationObserver(() =>
      setIsDark(root.classList.contains('dark')),
    );
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
      }),
  );
  const isDark = useIsDark();

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="top-right" richColors theme={isDark ? 'dark' : 'light'} />
    </QueryClientProvider>
  );
}

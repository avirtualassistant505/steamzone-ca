import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type SiteLanguage = 'en' | 'es';

const STORAGE_KEY = 'steamzone_site_language';

type SiteLanguageContextValue = {
  language: SiteLanguage;
  setLanguage: (next: SiteLanguage) => void;
  toggleLanguage: () => void;
};

const SiteLanguageContext = createContext<SiteLanguageContextValue | null>(null);

function normalizeLanguage(raw: unknown): SiteLanguage {
  return raw === 'es' ? 'es' : 'en';
}

export function SiteLanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<SiteLanguage>(() => {
    if (typeof window === 'undefined') return 'en';
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return normalizeLanguage(stored);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<SiteLanguageContextValue>(() => {
    return {
      language,
      setLanguage: (next) => setLanguageState(normalizeLanguage(next)),
      toggleLanguage: () => setLanguageState((prev) => (prev === 'en' ? 'es' : 'en')),
    };
  }, [language]);

  return <SiteLanguageContext.Provider value={value}>{children}</SiteLanguageContext.Provider>;
}

export function useSiteLanguage(): SiteLanguageContextValue {
  const context = useContext(SiteLanguageContext);
  if (!context) {
    throw new Error('useSiteLanguage must be used within SiteLanguageProvider');
  }
  return context;
}

export function langText<T>(language: SiteLanguage, values: { en: T; es: T }): T {
  return language === 'es' ? values.es : values.en;
}


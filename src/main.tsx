import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { SiteLanguageProvider } from './i18n/siteLanguage.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteLanguageProvider>
      <App />
    </SiteLanguageProvider>
  </StrictMode>
);

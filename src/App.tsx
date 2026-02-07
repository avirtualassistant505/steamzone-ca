import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import Hero from './components/Hero';
import Services from './components/Services';
import About from './components/About';
import ServiceAreas from './components/ServiceAreas';
import Contact from './components/Contact';
import Footer from './components/Footer';
import BrandLogo from './components/BrandLogo';
import GetEstimatePage from './pages/GetEstimatePage';
import AdminPricingPage from './pages/AdminPricingPage';
import {
  loadPricingConfig,
  resetPricingConfig,
  savePricingConfig,
  type PricingConfig,
} from './lib/estimateEngine';

type AppRoute = '/' | '/estimate' | '/admin' | 'notFound';

function normalizeRoute(pathname: string): AppRoute {
  const trimmed = pathname.replace(/\/+$/, '') || '/';

  if (trimmed === '/') {
    return '/';
  }

  if (trimmed === '/estimate') {
    return '/estimate';
  }

  if (trimmed === '/admin') {
    return '/admin';
  }

  return 'notFound';
}

function navLinkClass(active: boolean): string {
  return active
    ? 'font-semibold text-blue-600'
    : 'text-gray-700 transition hover:text-blue-600';
}

function NotFound() {
  return (
    <main className="bg-slate-50 pb-20 pt-28">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
        <h1 className="text-5xl font-bold text-gray-900">404</h1>
        <p className="mt-3 text-lg text-gray-600">That page was not found.</p>
        <a
          href="/"
          className="mt-6 inline-block rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
        >
          Return Home
        </a>
      </div>
    </main>
  );
}

function App() {
  const [route, setRoute] = useState<AppRoute>(() => normalizeRoute(window.location.pathname));
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>(() => loadPricingConfig());

  useEffect(() => {
    const onPopState = () => {
      setRoute(normalizeRoute(window.location.pathname));
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function navigate(next: Exclude<AppRoute, 'notFound'>): void {
    if (window.location.pathname !== next) {
      window.history.pushState({}, '', next);
    }
    setRoute(next);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function handleSavePricing(next: PricingConfig): void {
    const saved = savePricingConfig(next);
    setPricingConfig(saved);
  }

  function handleResetPricing(): void {
    const defaults = resetPricingConfig();
    setPricingConfig(defaults);
  }

  let content: JSX.Element;
  if (route === '/') {
    content = (
      <>
        <Hero />
        <Services />
        <About />
        <ServiceAreas />
        <Contact />
      </>
    );
  } else if (route === '/estimate') {
    content = <GetEstimatePage pricingConfig={pricingConfig} />;
  } else if (route === '/admin') {
    content = (
      <AdminPricingPage
        pricingConfig={pricingConfig}
        onSavePricingConfig={handleSavePricing}
        onResetPricingConfig={handleResetPricing}
      />
    );
  } else {
    content = <NotFound />;
  }

  return (
    <div className="min-h-screen bg-white">
      <nav className="bg-white shadow-md fixed w-full z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-24">
            <BrandLogo href="/" />
            <div className="hidden md:flex items-center space-x-8">
              <a href="/#services" className={navLinkClass(false)}>Services</a>
              <a href="/#about" className={navLinkClass(false)}>About</a>
              <a href="/#areas" className={navLinkClass(false)}>Service Areas</a>
              <a href="/#contact" className={navLinkClass(false)}>Contact</a>
              <button type="button" onClick={() => navigate('/estimate')} className={navLinkClass(route === '/estimate')}>
                Get Estimate
              </button>
              <button type="button" onClick={() => navigate('/admin')} className={navLinkClass(route === '/admin')}>
                Admin
              </button>
              <a href="tel:4312053909" className="flex items-center text-blue-600 font-semibold">
                <Phone className="h-4 w-4 mr-2" />
                (431) 205-3909
              </a>
            </div>
          </div>
        </div>
      </nav>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 px-3 py-2 shadow-[0_-4px_18px_rgba(0,0,0,0.05)] md:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 text-sm">
          <a href="/" className="rounded-md px-3 py-2 font-semibold text-gray-700">Home</a>
          <button type="button" onClick={() => navigate('/estimate')} className="rounded-md px-3 py-2 font-semibold text-blue-700">
            Estimate
          </button>
          <a href="/#contact" className="rounded-md px-3 py-2 font-semibold text-gray-700">Contact</a>
          <button type="button" onClick={() => navigate('/admin')} className="rounded-md px-3 py-2 font-semibold text-gray-700">
            Admin
          </button>
        </div>
      </div>

      {content}
      <Footer />
    </div>
  );
}

export default App;

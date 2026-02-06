import { Phone } from 'lucide-react';
import Hero from './components/Hero';
import Services from './components/Services';
import About from './components/About';
import ServiceAreas from './components/ServiceAreas';
import Contact from './components/Contact';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="bg-white shadow-md fixed w-full z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <div className="flex items-center gap-3">
              <img src="/brand/logo.png" alt="Steam Zone" className="h-9 w-auto" />
              <span className="text-2xl font-bold text-gray-900">Steam Zone</span>
            </div>
            <div className="hidden md:flex items-center space-x-8">
              <a href="#services" className="text-gray-700 hover:text-blue-600 transition">Services</a>
              <a href="#about" className="text-gray-700 hover:text-blue-600 transition">About</a>
              <a href="#areas" className="text-gray-700 hover:text-blue-600 transition">Service Areas</a>
              <a href="#contact" className="text-gray-700 hover:text-blue-600 transition">Contact</a>
              <a href="tel:4312053909" className="flex items-center text-blue-600 font-semibold">
                <Phone className="h-4 w-4 mr-2" />
                (431) 205-3909
              </a>
            </div>
          </div>
        </div>
      </nav>

      <Hero />
      <Services />
      <About />
      <ServiceAreas />
      <Contact />
      <Footer />
    </div>
  );
}

export default App;

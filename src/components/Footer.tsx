import { Phone, Mail, MapPin } from 'lucide-react';
import BrandLogo from './BrandLogo';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          <div className="md:col-span-2">
            <BrandLogo variant="dark" size="footer" className="mb-4" href="/" />
            <p className="text-gray-400 mb-4">
              Your trusted local partner in Manitoba for professional carpet cleaning, window cleaning,
              and post-construction cleanup services.
            </p>
            <div className="flex space-x-4">
              <a href="tel:12365066570" className="text-gray-400 hover:text-white transition">
                <Phone className="h-5 w-5" />
              </a>
              <a href="mailto:info@steamzone.ca" className="text-gray-400 hover:text-white transition">
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-4">Services</h4>
            <ul className="space-y-2">
              <li><a href="/#services" className="text-gray-400 hover:text-white transition">Carpet Cleaning</a></li>
              <li><a href="/#services" className="text-gray-400 hover:text-white transition">Window Cleaning</a></li>
              <li><a href="/#services" className="text-gray-400 hover:text-white transition">Post-Construction</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-lg font-semibold mb-4">Quick Links</h4>
            <ul className="space-y-2">
              <li><a href="/#about" className="text-gray-400 hover:text-white transition">About Us</a></li>
              <li><a href="/#areas" className="text-gray-400 hover:text-white transition">Service Areas</a></li>
              <li><a href="/#contact" className="text-gray-400 hover:text-white transition">Contact</a></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8">
          <div className="grid md:grid-cols-2 gap-4 items-center">
            <div className="text-gray-400 text-sm">
              © {new Date().getFullYear()} Steam Zone. All rights reserved.
            </div>
            <div className="flex items-center justify-end text-gray-400 text-sm">
              <MapPin className="h-4 w-4 mr-2" />
              120 Parkside Crescent, Mitchell, MB R5G 2X3
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

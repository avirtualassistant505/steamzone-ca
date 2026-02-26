import { Phone, Mail, MapPin, Clock } from 'lucide-react';
import { langText, useSiteLanguage } from '../i18n/siteLanguage';

export default function Contact() {
  const { language } = useSiteLanguage();

  return (
    <section id="contact" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
            {langText(language, { en: 'Get In Touch', es: 'Póngase en Contacto' })}
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            {langText(language, {
              en: 'Ready to experience professional cleaning services? Contact us today for a free quote',
              es: '¿Listo para servicios profesionales de limpieza? Contáctenos hoy para una cotización gratis',
            })}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h3 className="text-2xl font-bold text-gray-900 mb-6">
              {langText(language, { en: 'Contact Information', es: 'Información de Contacto' })}
            </h3>

            <div className="space-y-6">
              <div className="flex items-start">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
                  <Phone className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">{langText(language, { en: 'Phone', es: 'Teléfono' })}</h4>
                  <a href="tel:12365066570" className="text-lg text-blue-600 hover:text-blue-700">
                    (236) 506-6570
                  </a>
                </div>
              </div>

              <div className="flex items-start">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
                  <Mail className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">{langText(language, { en: 'Email', es: 'Correo' })}</h4>
                  <a href="mailto:info@steamzone.ca" className="text-lg text-blue-600 hover:text-blue-700">
                    info@steamzone.ca
                  </a>
                </div>
              </div>

              <div className="flex items-start">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
                  <MapPin className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">{langText(language, { en: 'Address', es: 'Dirección' })}</h4>
                  <p className="text-gray-600">
                    120 Parkside Crescent<br />
                    Mitchell, MB R5G 2X3<br />
                    Canada
                  </p>
                </div>
              </div>

              <div className="flex items-start">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4 flex-shrink-0">
                  <Clock className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 mb-1">
                    {langText(language, { en: 'Business Hours', es: 'Horario de Atención' })}
                  </h4>
                  <p className="text-gray-600">
                    {langText(language, {
                      en: 'Monday - Friday: 8:00 AM - 6:00 PM',
                      es: 'Lunes a Viernes: 8:00 AM - 6:00 PM',
                    })}
                    <br />
                    {langText(language, {
                      en: 'Saturday: 9:00 AM - 4:00 PM',
                      es: 'Sábado: 9:00 AM - 4:00 PM',
                    })}
                    <br />
                    {langText(language, {
                      en: 'Sunday: Closed',
                      es: 'Domingo: Cerrado',
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-8 rounded-2xl shadow-lg">
            <h3 className="text-2xl font-bold text-gray-900 mb-6">
              {langText(language, { en: 'Request a Free Quote', es: 'Solicitar una Cotización Gratis' })}
            </h3>
            <form className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  {langText(language, { en: 'Full Name', es: 'Nombre Completo' })}
                </label>
                <input
                  type="text"
                  id="name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition"
                  placeholder={langText(language, { en: 'John Doe', es: 'Juan Pérez' })}
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  {langText(language, { en: 'Email Address', es: 'Correo Electrónico' })}
                </label>
                <input
                  type="email"
                  id="email"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  {langText(language, { en: 'Phone Number', es: 'Número de Teléfono' })}
                </label>
                <input
                  type="tel"
                  id="phone"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition"
                  placeholder="(236) 506-6570"
                />
              </div>

              <div>
                <label htmlFor="service" className="block text-sm font-medium text-gray-700 mb-1">
                  {langText(language, { en: 'Service Needed', es: 'Servicio Necesario' })}
                </label>
                <select
                  id="service"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition"
                >
                  <option>{langText(language, { en: 'Carpet Cleaning', es: 'Limpieza de Alfombras' })}</option>
                  <option>{langText(language, { en: 'Window Cleaning', es: 'Limpieza de Ventanas' })}</option>
                  <option>{langText(language, { en: 'Post-Construction Cleaning', es: 'Limpieza Post-Construcción' })}</option>
                  <option>{langText(language, { en: 'Multiple Services', es: 'Múltiples Servicios' })}</option>
                </select>
              </div>

              <div>
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                  {langText(language, { en: 'Message', es: 'Mensaje' })}
                </label>
                <textarea
                  id="message"
                  rows={4}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-600 focus:border-transparent outline-none transition"
                  placeholder={langText(language, {
                    en: 'Tell us about your cleaning needs...',
                    es: 'Cuéntenos sobre sus necesidades de limpieza...',
                  })}
                ></textarea>
              </div>

              <button
                type="submit"
                className="w-full px-6 py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition transform hover:scale-105"
              >
                {langText(language, { en: 'Send Message', es: 'Enviar Mensaje' })}
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}

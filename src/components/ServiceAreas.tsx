import { MapPin } from 'lucide-react';
import { langText, useSiteLanguage } from '../i18n/siteLanguage';

const areas = [
  {
    region: 'Winnipeg',
    communities: ['Downtown', 'St. Vital', 'Transcona', 'St. Boniface', 'Charleswood', 'River Heights']
  },
  {
    region: 'Steinbach',
    communities: ['Niverville', 'Ste. Anne', 'Kleefeld', 'Blumenort', 'Île-des-Chênes']
  }
];

export default function ServiceAreas() {
  const { language } = useSiteLanguage();
  return (
    <section id="areas" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">{langText(language, { en: 'Service Areas', es: 'Zonas de Servicio' })}</h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            {langText(language, {
              en: 'Proudly serving Winnipeg, Steinbach, and surrounding communities throughout Manitoba',
              es: 'Atendemos con orgullo Winnipeg, Steinbach y comunidades cercanas en Manitoba',
            })}
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12 max-w-5xl mx-auto">
          {areas.map((area) => (
            <div key={area.region} className="bg-gradient-to-br from-blue-50 to-white p-8 rounded-2xl shadow-lg">
              <div className="flex items-center mb-6">
                <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center mr-4">
                  <MapPin className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900">{area.region}</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {area.communities.map((community) => (
                  <div key={community} className="flex items-center text-gray-700">
                    <div className="w-1.5 h-1.5 bg-blue-600 rounded-full mr-2"></div>
                    {community}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-lg text-gray-600 mb-6">
            {langText(language, {
              en: "Don't see your area listed? Contact us to find out if we service your location!",
              es: '¿No ve su zona en la lista? Contáctenos para confirmar si atendemos su ubicación.',
            })}
          </p>
          <a
            href="#contact"
            className="inline-block px-8 py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            {langText(language, { en: 'Contact Us', es: 'Contáctenos' })}
          </a>
        </div>
      </div>
    </section>
  );
}

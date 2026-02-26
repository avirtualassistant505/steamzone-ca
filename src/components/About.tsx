import { CheckCircle, Award, Users, Clock } from 'lucide-react';
import { langText, useSiteLanguage } from '../i18n/siteLanguage';

export default function About() {
  const { language } = useSiteLanguage();
  const values = [
    {
      icon: Award,
      title: langText(language, { en: 'Quality Service', es: 'Servicio de Calidad' }),
      description: langText(language, {
        en: 'We deliver exceptional cleaning services that exceed expectations',
        es: 'Brindamos servicios de limpieza excepcionales que superan expectativas',
      }),
    },
    {
      icon: Users,
      title: langText(language, { en: 'Customer Satisfaction', es: 'Satisfacción del Cliente' }),
      description: langText(language, {
        en: 'Your satisfaction is our top priority, guaranteed every time',
        es: 'Su satisfacción es nuestra máxima prioridad, garantizada siempre',
      }),
    },
    {
      icon: Clock,
      title: langText(language, { en: 'Reliable & Punctual', es: 'Confiables y Puntuales' }),
      description: langText(language, {
        en: 'We respect your time and always arrive when scheduled',
        es: 'Respetamos su tiempo y siempre llegamos según lo programado',
      }),
    },
  ];

  return (
    <section id="about" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
          <div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              {langText(language, {
                en: 'Your Trusted Cleaning Partner in Manitoba',
                es: 'Su Socio de Limpieza de Confianza en Manitoba',
              })}
            </h2>
            <p className="text-lg text-gray-600 mb-6 leading-relaxed">
              {langText(language, {
                en: 'Steam Zone is your trusted local partner in Manitoba for professional cleaning services. With years of experience and a commitment to excellence, we specialize in carpet cleaning, window cleaning, and post-construction cleanup.',
                es: 'Steam Zone es su socio local de confianza en Manitoba para servicios profesionales de limpieza. Con años de experiencia y compromiso con la excelencia, nos especializamos en limpieza de alfombras, ventanas y limpieza post-construcción.',
              })}
            </p>
            <p className="text-lg text-gray-600 mb-8 leading-relaxed">
              {langText(language, {
                en: 'Our team of experienced professionals uses advanced cleaning technology and eco-friendly products to deliver outstanding results. We take pride in our work and are dedicated to ensuring complete customer satisfaction with every job.',
                es: 'Nuestro equipo de profesionales utiliza tecnología avanzada y productos ecológicos para brindar resultados sobresalientes. Nos enorgullece nuestro trabajo y estamos dedicados a lograr satisfacción total en cada servicio.',
              })}
            </p>
            <div className="flex items-start space-x-3 mb-4">
              <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">{langText(language, { en: 'Licensed & Insured', es: 'Licenciados y Asegurados' })}</h4>
                <p className="text-gray-600">{langText(language, { en: 'Fully certified and insured for your peace of mind', es: 'Totalmente certificados y asegurados para su tranquilidad' })}</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 mb-4">
              <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">{langText(language, { en: 'Eco-Friendly Products', es: 'Productos Ecológicos' })}</h4>
                <p className="text-gray-600">{langText(language, { en: 'Safe for your family, pets, and the environment', es: 'Seguros para su familia, mascotas y el medio ambiente' })}</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">{langText(language, { en: 'Satisfaction Guaranteed', es: 'Satisfacción Garantizada' })}</h4>
                <p className="text-gray-600">{langText(language, { en: 'We stand behind our work with a 100% satisfaction guarantee', es: 'Respaldamos nuestro trabajo con garantía de satisfacción del 100%' })}</p>
              </div>
            </div>
          </div>
          <div>
            <img
              src="https://images.pexels.com/photos/4107278/pexels-photo-4107278.jpeg?auto=compress&cs=tinysrgb&w=1200"
              alt="Professional cleaning team"
              className="rounded-2xl shadow-xl"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {values.map((value) => (
            <div key={value.title} className="bg-white p-8 rounded-xl shadow-md hover:shadow-xl transition">
              <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-100 rounded-lg mb-4">
                <value.icon className="h-7 w-7 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">{value.title}</h3>
              <p className="text-gray-600">{value.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

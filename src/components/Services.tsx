import { Droplets, Sparkles, HardHat } from 'lucide-react';

const services = [
  {
    icon: Droplets,
    title: 'Carpet Cleaning',
    description: 'Professional carpet cleaning services that deep-clean your carpets to remove dirt, dust, allergens, and bacteria. Our advanced steam cleaning technology improves indoor air quality and extends the life of your carpets.',
    features: ['Residential & Commercial', 'Deep Steam Cleaning', 'Stain Removal', 'Pet Odor Treatment'],
    image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=1600&q=80'
  },
  {
    icon: Sparkles,
    title: 'Window Cleaning',
    description: 'Professional window cleaning services that remove dirt, streaks, and buildup from both residential and commercial properties. Crystal clear windows enhance your property\'s appearance and let in natural light.',
    features: ['Streak-Free Results', 'Interior & Exterior', 'High-Rise Available', 'Screen Cleaning'],
    image: 'https://images.pexels.com/photos/713297/pexels-photo-713297.jpeg?auto=compress&cs=tinysrgb&w=1200'
  },
  {
    icon: HardHat,
    title: 'Post-Construction Cleaning',
    description: 'Post-construction cleaning services that remove dust, debris, and leftover materials after construction or renovation. We ensure your newly built or renovated space is spotless and ready for use.',
    features: ['Dust & Debris Removal', 'Detail Cleaning', 'Final Touch-ups', 'Move-in Ready'],
    image: 'https://images.pexels.com/photos/6196299/pexels-photo-6196299.jpeg?auto=compress&cs=tinysrgb&w=1200'
  }
];

export default function Services() {
  return (
    <section id="services" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">Our Services</h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Comprehensive cleaning solutions tailored to meet your residential and commercial needs
          </p>
        </div>

        <div className="space-y-24">
          {services.map((service, index) => (
            <div
              key={service.title}
              className={`grid md:grid-cols-2 gap-12 items-center ${index % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
            >
              <div className={index % 2 === 1 ? 'md:order-2' : ''}>
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-xl mb-6">
                  <service.icon className="h-8 w-8 text-blue-600" />
                </div>
                <h3 className="text-3xl font-bold text-gray-900 mb-4">{service.title}</h3>
                <p className="text-lg text-gray-600 mb-6 leading-relaxed">{service.description}</p>
                <ul className="space-y-3">
                  {service.features.map((feature) => (
                    <li key={feature} className="flex items-center text-gray-700">
                      <div className="w-2 h-2 bg-blue-600 rounded-full mr-3"></div>
                      {feature}
                    </li>
                  ))}
                </ul>
                <a
                  href="#contact"
                  className="inline-block mt-8 px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
                >
                  Request Service
                </a>
              </div>
              <div className={index % 2 === 1 ? 'md:order-1' : ''}>
                <img
                  src={service.image}
                  alt={service.title}
                  className="rounded-2xl shadow-xl w-full h-[400px] object-cover"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

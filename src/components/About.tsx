import { CheckCircle, Award, Users, Clock } from 'lucide-react';

const values = [
  {
    icon: Award,
    title: 'Quality Service',
    description: 'We deliver exceptional cleaning services that exceed expectations'
  },
  {
    icon: Users,
    title: 'Customer Satisfaction',
    description: 'Your satisfaction is our top priority, guaranteed every time'
  },
  {
    icon: Clock,
    title: 'Reliable & Punctual',
    description: 'We respect your time and always arrive when scheduled'
  }
];

export default function About() {
  return (
    <section id="about" className="py-24 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
          <div>
            <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
              Your Trusted Cleaning Partner in Manitoba
            </h2>
            <p className="text-lg text-gray-600 mb-6 leading-relaxed">
              Steam Zone is your trusted local partner in Manitoba for professional cleaning services.
              With years of experience and a commitment to excellence, we specialize in carpet cleaning,
              window cleaning, and post-construction cleanup.
            </p>
            <p className="text-lg text-gray-600 mb-8 leading-relaxed">
              Our team of experienced professionals uses advanced cleaning technology and eco-friendly
              products to deliver outstanding results. We take pride in our work and are dedicated to
              ensuring complete customer satisfaction with every job.
            </p>
            <div className="flex items-start space-x-3 mb-4">
              <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">Licensed & Insured</h4>
                <p className="text-gray-600">Fully certified and insured for your peace of mind</p>
              </div>
            </div>
            <div className="flex items-start space-x-3 mb-4">
              <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">Eco-Friendly Products</h4>
                <p className="text-gray-600">Safe for your family, pets, and the environment</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0 mt-1" />
              <div>
                <h4 className="font-semibold text-gray-900 mb-1">Satisfaction Guaranteed</h4>
                <p className="text-gray-600">We stand behind our work with a 100% satisfaction guarantee</p>
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

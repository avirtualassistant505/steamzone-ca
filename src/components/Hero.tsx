import { ArrowRight } from 'lucide-react';

export default function Hero() {
  return (
    <div className="relative pt-24 md:pt-28 bg-gradient-to-br from-blue-50 to-blue-100 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight mb-6">
              Professional Cleaning Services
              <span className="block text-blue-600">You Can Trust</span>
            </h1>
            <p className="text-xl text-gray-600 mb-8 leading-relaxed">
              Your trusted local partner in Manitoba for carpet cleaning, window cleaning, and post-construction cleanup.
              Quality service and customer satisfaction guaranteed.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <a
                href="/estimate"
                className="inline-flex items-center justify-center px-8 py-4 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition transform hover:scale-105 shadow-lg"
              >
                Free Estimate
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
              <a
                href="tel:7828217802"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-blue-600 font-semibold rounded-lg hover:bg-gray-50 transition border-2 border-blue-600"
              >
                Call Now
              </a>
            </div>
          </div>
          <div className="relative">
            <img
              src="https://images.pexels.com/photos/4108715/pexels-photo-4108715.jpeg?auto=compress&cs=tinysrgb&w=1200"
              alt="Professional cleaning service"
              className="rounded-2xl shadow-2xl"
            />
            <div className="absolute -bottom-6 -left-6 bg-white p-6 rounded-xl shadow-xl">
              <div className="text-4xl font-bold text-blue-600">15+</div>
              <div className="text-gray-600 font-medium">Years of Experience</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

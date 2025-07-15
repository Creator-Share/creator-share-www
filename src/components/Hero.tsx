import React from 'react'
import Image from 'next/image'

export const Hero = () => {
  return (
    <section className="relative min-h-screen overflow-hidden">
      {/* Background Image */}
      <div className="absolute">
        <Image
          src="/bg.png"
          alt="Background"
          fill
          className="object-cover"
          priority
        />
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 pt-32 pb-20 flex flex-col items-center min-h-screen">
        {/* Badge */}
        <div className="inline-flex items-center bg-white rounded-full px-4 py-2 shadow-sm mb-12">
          <div className="bg-[#4B84F7] rounded-full p-1 mr-2">
            <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-gray-600 text-sm">Charity funding platform</span>
        </div>

        {/* Heading Content */}
        <div className="max-w-4xl mx-auto text-center mb-20">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">
            Be the Reason Someone{' '}
            <span className="font-['Dancing_Script'] italic">Smiles</span>{' '}
            Today
          </h1>
          <p className="text-gray-600 text-lg mb-8">
            Partner with us to bring relief, support, and opportunity to the vulnerable.
          </p>
          <button className="bg-[#4B84F7] text-white px-8 py-3 rounded-lg hover:bg-blue-600 transition-colors font-medium">
            Make a Difference
          </button>
        </div>

        {/* Bottom Images */}
        <div className="flex justify-center gap-8 mt-auto w-full max-w-6xl mx-auto">
          {[
            'Child receiving medical care',
            'Elderly woman smiling',
            'Senior man having meal'
          ].map((alt, index) => (
            <div
              key={index}
              className="relative w-[360px] h-[240px] rounded-xl overflow-hidden"
              style={{
                padding: '6px',
                background: 'white',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
              }}
            >
              <div className="relative w-full h-full rounded-lg overflow-hidden">
                <Image
                  src={'/john.png'}
                  alt={alt}
                  fill
                  className="object-cover"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Diagonal Blue Section */}
      <div 
        className="absolute bottom-0 right-0 w-full h-[30%] bg-[#4B84F7]/10"
        style={{
          clipPath: 'polygon(100% 0, 0% 100%, 100% 100%)'
        }}
      />
    </section>
  )
}

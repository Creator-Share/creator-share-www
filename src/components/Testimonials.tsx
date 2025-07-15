import React from 'react'
import Image from 'next/image'
import { FiArrowRight } from 'react-icons/fi'

export const Testimonials = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="flex flex-col">
            <div className="text-gray-200 text-8xl font-serif">&quot;</div>
            <h2 className="text-3xl md:text-4xl font-medium mb-8">
              &quot;Highly recommended for anyone looking to fund their creative journey.&quot;
            </h2>
            <p className="text-gray-600 mb-8 text-base md:text-xl">
              &quot;Creator Share has been a game-changer for me. It gave me a simple, transparent way to raise funds and connect directly with supporters who believe in my work. The platform is easy to use, and the support team genuinely cares about helping creators succeed. Highly recommended for anyone looking to fund their creative journey.&quot;
            </p>
            <a
              href="#"
              className="inline-flex items-center text-blue-600 hover:text-blue-700"
            >
              Read Success Story
              <FiArrowRight className="ml-2" />
            </a>
          </div>
          <div className="rounded-2xl flex flex-col items-center justify-center">
            <div className="relative w-full h-full mb-6">
              <Image
                src="/john.png"
                alt="Albert Flores"
                fill
                className="rounded-2xl object-cover"
                priority
              />
              <div className="absolute bottom-0 left-0 w-full p-6 bg-gradient-to-t from-black/70 to-transparent rounded-b-2xl">
                <h3 className="text-white text-xl font-semibold mb-1">Albert Flores</h3>
                <p className="text-gray-200 text-sm">Product Manager at Jamanar</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

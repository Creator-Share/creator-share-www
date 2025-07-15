import React from 'react'
import Image from 'next/image'
import { FiArrowRight } from 'react-icons/fi'

export const Story = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
          {/* Left Column - Image */}
          <div className="relative aspect-[4/3] rounded-lg overflow-hidden">
            <Image
              src="/john.png"
              alt="Founder interacting with children"
              fill
              className="object-cover"
              priority
            />
          </div>

          {/* Right Column - Content */}
          <div className="flex flex-col">
            <span className="text-gray-600 mb-2">About Us</span>
            <h2 className="text-4xl font-bold mb-6">
              The Creator Share Foundation
            </h2>
            <p className="text-gray-700 mb-8">
              We are dedicated to bringing hope and support to special needs children in developing countries, often referred to as the "invisible children." These children endure unimaginable suffering in environments devoid of basic necessities such as water, electricity, and adequate shelter.
            </p>
            <div className="mt-auto">
              <div className="mb-4">
                <span className="font-medium">John St. Julien</span>
                <span className="text-gray-600 ml-2">Founder</span>
              </div>
              <a 
                href="#" 
                className="inline-flex items-center text-blue-600 hover:text-blue-700"
              >
                Read Full Case Study
                <FiArrowRight className="ml-2" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

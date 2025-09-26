import {
  CleanWaterIcon,
  EducationIcon,
  FoodSecurityIcon,
  HealthcareIcon,
  MentalHealthIcon,
  ShelterIcon,
} from "@/utils/icons"
import React from "react"

const CategoryIcon = ({ children }: { children: React.ReactNode }) => (
  <div className="w-16 h-16 mb-6">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="w-full h-full"
    >
      {children}
    </svg>
  </div>
)

const categories = [
  {
    icon: EducationIcon,
    title: "Education",
    description: "Support educational programs for children in need.",
  },
  {
    icon: HealthcareIcon,
    title: "Healthcare",
    description:
      "Provide medical care and supplies to underserved communities.",
  },
  {
    icon: CleanWaterIcon,
    title: "Clean Water",
    description: "Help build wells and water purification systems.",
  },
  {
    icon: FoodSecurityIcon,
    title: "Food Security",
    description: "Ensure access to nutritious food for families.",
  },
  {
    icon: ShelterIcon,
    title: "Shelter",
    description: "Build safe and secure homes for those without.",
  },
  {
    icon: MentalHealthIcon,
    title: "Mental Health",
    description: "Support mental health services and counseling.",
  },
]

export const Categories = () => {
  return (
    <section className="py-20">
      <div className="container mx-auto px-4">
        <h2 className="text-4xl font-bold text-center mb-4">
          Core Funding categories
        </h2>
        <p className="text-gray-600 text-center mb-16">
          Lorem ipsum dolor sit amet, consectetur adipis elit
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3">
          {categories.map((category, index) => (
            <div
              key={index}
              className={`
                flex flex-col items-center text-center p-12 relative
                ${index % 3 !== 2 ? "md:border-r" : ""} 
                ${index < 3 ? "border-b md:border-b" : ""} 
                border-gray-200
              `}
            >
              <CategoryIcon>{category.icon}</CategoryIcon>
              <h3 className="text-xl font-semibold mb-4">{category.title}</h3>
              <p className="text-gray-600 max-w-xs">{category.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

"use client"
import React, { useEffect, useState } from "react"
import { FaFacebook, FaInstagram } from "react-icons/fa"
import NextLink from "next/link"
import { useAuthStore } from "@/store/authStore"

export const Footer = () => {
  const [mounted, setMounted] = useState(false)
  const user = useAuthStore((state) => state.user)
  const fetchUser = useAuthStore((state) => state.fetchUser)

  useEffect(() => {
    setMounted(true)
    fetchUser()
  }, [fetchUser])

  return (
    <footer className="bg-[#1C3C8C] text-white py-16">
      <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 px-4">
        {/* Left Column */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">
            The Creator Share Foundation
          </h2>
          <p className="mb-2">UK reg Charity 1169474</p>
          <p className="mb-6">enquiries@sharetanzania.com</p>
          <div className="flex gap-6">
            <a
              href="https://www.facebook.com/sharetanzania"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaFacebook className="w-6 h-6 cursor-pointer hover:opacity-80" />
            </a>
            <a
              href="https://www.instagram.com/creatorshare_tanzania?igsh=ajJoYmhiNGtpYXlq"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaInstagram className="w-6 h-6 cursor-pointer hover:opacity-80" />
            </a>
          </div>
        </div>

        {/* Middle Column */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">Our Address</h2>
          <address className="not-italic">
            <p className="mb-2">The Creator Share Foundation</p>
            <p className="mb-2">86-90 Paul Street</p>
            <p className="mb-2">London</p>
            <p className="mb-2">EC2A 4NE</p>
            <p>United Kingdom</p>
          </address>
        </div>

        {/* Right Column */}
        <div>
          <h2 className="text-2xl font-semibold mb-4">Our Centers</h2>
          <ul className="space-y-2 mb-6">
            <li>
              <a
                href="https://tanzania.creatorshare.com/invisiblechildren"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                Invisible Children Special Needs Children's Village
              </a>
            </li>
            <li>
              <a
                href="https://tanzania.creatorshare.com/invisiblechildren/street-involved-children"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                Angels Gate Rehabilitation Centre For Street Involved Children
              </a>
            </li>
            <li>
              <a
                href="https://tanzania.creatorshare.com/invisiblechildren/kilimanjaro-animal-rescue"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                Kilimanjaro Animal Rescue
              </a>
            </li>
            <li>
              <a
                href="https://tanzania.creatorshare.com/invisiblechildren/our-addiction-rehabilitation-center"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                Addiction Rehabilitation Center
              </a>
            </li>
            <li>
              <a
                href="https://tanzania.creatorshare.com/invisiblechildren/rainbow-tree"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                Rainbow Tree Early Childhood Education Center
              </a>
            </li>
          </ul>
          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-2">Manage Subscriptions</h3>
            <a
              href="https://stripe.creatorshare.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              Manage Subscriptions
            </a>
          </div>
        </div>
      </div>

      {/* Login Button */}
      {mounted && !user && (
        <div className="container mx-auto px-4 mt-8 text-center">
          <NextLink
            href="/login"
            className="inline-block bg-white text-[#1C3C8C] px-6 py-2 rounded-md font-semibold hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Sign In
          </NextLink>
        </div>
      )}
    </footer>
  )
}

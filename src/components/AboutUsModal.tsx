"use client"
import React, { useEffect, useState, useCallback } from "react"
import { Box, Flex, Text, Tabs, Image } from "@chakra-ui/react"
import { FaFacebook, FaInstagram, FaExternalLinkAlt } from "react-icons/fa"
import NextLink from "next/link"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuthStore } from "@/store/authStore"

// Valid tab anchors that can open the modal
const TAB_ANCHORS = ["about", "centers", "contact"] as const
type TabAnchor = typeof TAB_ANCHORS[number]

interface AboutUsModalProps {
  open: boolean
  onClose: () => void
  defaultTab?: TabAnchor
}

export const AboutUsModal: React.FC<AboutUsModalProps> = ({ open, onClose, defaultTab = "about" }) => {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<TabAnchor>(defaultTab)
  const user = useAuthStore((state) => state.user)
  const fetchUser = useAuthStore((state) => state.fetchUser)

  // Handle tab changes - update URL hash
  const handleTabChange = useCallback((value: string) => {
    const tab = value as TabAnchor
    setActiveTab(tab)
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${tab}`)
    }
  }, [])

  // Clear hash when modal closes
  const handleClose = useCallback(() => {
    if (typeof window !== "undefined" && window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    }
    onClose()
  }, [onClose])

  useEffect(() => {
    setMounted(true)
    fetchUser()
  }, [fetchUser])

  // Sync active tab with defaultTab prop when modal opens
  useEffect(() => {
    if (open && defaultTab) {
      setActiveTab(defaultTab)
    }
  }, [open, defaultTab])

  const centers = [
    {
      name: "Invisible Children Special Needs Children's Village",
      href: "https://tanzania.creatorshare.com/invisiblechildren",
    },
    {
      name: "Angels Gate Rehabilitation Centre For Street Involved Children",
      href: "https://tanzania.creatorshare.com/invisiblechildren/street-involved-children",
    },
    {
      name: "Kilimanjaro Animal Rescue",
      href: "https://tanzania.creatorshare.com/invisiblechildren/kilimanjaro-animal-rescue",
    },
    {
      name: "Addiction Rehabilitation Center",
      href: "https://tanzania.creatorshare.com/invisiblechildren/our-addiction-rehabilitation-center",
    },
    {
      name: "Rainbow Tree Early Childhood Education Center",
      href: "https://tanzania.creatorshare.com/invisiblechildren/rainbow-tree",
    },
  ]

  return (
    <DialogRoot 
      open={open} 
      onOpenChange={(e) => !e.open && handleClose()}
      size="xl"
      scrollBehavior="inside"
    >
      <DialogContent 
        className="max-w-4xl mx-4 max-h-[90vh] rounded-3xl overflow-hidden"
        style={{
          boxShadow: "0 4px 24px -4px rgba(0, 0, 0, 0.08), 0 2px 8px -2px rgba(0, 0, 0, 0.04)",
          borderRadius: "24px"
        }}
      >
        <DialogHeader className="bg-[#1C3C8C] text-white px-10 py-6">
          <Flex align="center" gap={4}>
            <Image
              src="/logo_text.svg"
              alt="Creator Share"
              height="40px"
              filter="brightness(0) invert(1)"
            />
            <DialogTitle fontSize="xl" fontWeight="bold">
              About Us
            </DialogTitle>
          </Flex>
          <DialogCloseTrigger className="text-white hover:bg-white/20" />
        </DialogHeader>
        
        <DialogBody p={0} className="overflow-y-auto">
          <Tabs.Root 
            value={activeTab} 
            onValueChange={(e) => handleTabChange(e.value)}
            variant="line"
          >
            <Tabs.List className="bg-gray-50 px-8 border-b">
              <Tabs.Trigger 
                value="about"
                className="px-4 py-3 text-sm font-medium data-[selected]:text-[#1C3C8C] data-[selected]:border-b-2 data-[selected]:border-[#1C3C8C]"
              >
                About
              </Tabs.Trigger>
              <Tabs.Trigger 
                value="centers"
                className="px-4 py-3 text-sm font-medium data-[selected]:text-[#1C3C8C] data-[selected]:border-b-2 data-[selected]:border-[#1C3C8C]"
              >
                Our Centers
              </Tabs.Trigger>
              <Tabs.Trigger 
                value="contact"
                className="px-4 py-3 text-sm font-medium data-[selected]:text-[#1C3C8C] data-[selected]:border-b-2 data-[selected]:border-[#1C3C8C]"
              >
                Contact
              </Tabs.Trigger>
            </Tabs.List>

            {/* About Tab */}
            <Tabs.Content value="about" className="p-10">
              <Box>
                <Text fontSize="2xl" fontWeight="bold" color="gray.800" mb={4}>
                  The Creator Share Foundation
                </Text>
                <Text color="gray.600" mb={4}>
                  UK Registered Charity 1169474
                </Text>
                <Text color="gray.700" lineHeight="1.8" mb={6}>
                  Creator Share connects sponsors with children in need, providing education, 
                  medical care, adequate nutrition, and the opportunity to pursue their hopes 
                  and dreams. One child at a time, love is changing thousands of lives.
                </Text>

                {/* Social Links */}
                <Box mb={6}>
                  <Text fontWeight="semibold" color="gray.800" mb={3}>
                    Follow Us
                  </Text>
                  <Flex gap={4}>
                    <a
                      href="https://www.facebook.com/sharetanzania"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[#1C3C8C] hover:text-[#1C2B7A] transition-colors"
                    >
                      <FaFacebook className="w-6 h-6" />
                      <Text fontSize="sm">Facebook</Text>
                    </a>
                    <a
                      href="https://www.instagram.com/creatorshare_tanzania?igsh=ajJoYmhiNGtpYXlq"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-[#1C3C8C] hover:text-[#1C2B7A] transition-colors"
                    >
                      <FaInstagram className="w-6 h-6" />
                      <Text fontSize="sm">Instagram</Text>
                    </a>
                  </Flex>
                </Box>

                {/* Manage Subscriptions Link */}
                <Box
                  className="bg-gray-50 rounded-lg p-4 border border-gray-200"
                >
                  <Text fontWeight="semibold" color="gray.800" mb={2}>
                    Manage Your Sponsorship
                  </Text>
                  <a
                    href="https://stripe.creatorshare.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[#1C3C8C] hover:underline text-sm"
                  >
                    <FaExternalLinkAlt className="w-3 h-3" />
                    Manage Subscriptions via Stripe
                  </a>
                </Box>

                {/* Sign In - only show if not logged in */}
                {mounted && !user && (
                  <Box mt={6} textAlign="center">
                    <NextLink
                      href="/login"
                      onClick={onClose}
                      className="inline-block bg-[#1C3C8C] text-white px-8 py-3 rounded-lg font-semibold hover:bg-[#1C2B7A] transition-colors"
                    >
                      Sign In
                    </NextLink>
                  </Box>
                )}
              </Box>
            </Tabs.Content>

            {/* Centers Tab */}
            <Tabs.Content value="centers" className="p-10">
              <Text fontSize="xl" fontWeight="bold" color="gray.800" mb={4}>
                Our Centers
              </Text>
              <Text color="gray.600" mb={6}>
                We operate multiple centers in Tanzania, each dedicated to supporting 
                vulnerable populations in different ways.
              </Text>
              <Box className="space-y-3">
                {centers.map((center, index) => (
                  <a
                    key={index}
                    href={center.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200 group"
                  >
                    <Box className="flex-1">
                      <Text fontWeight="medium" color="gray.800" className="group-hover:text-[#1C3C8C]">
                        {center.name}
                      </Text>
                    </Box>
                    <FaExternalLinkAlt className="w-4 h-4 text-gray-400 group-hover:text-[#1C3C8C]" />
                  </a>
                ))}
              </Box>
            </Tabs.Content>

            {/* Contact Tab */}
            <Tabs.Content value="contact" className="p-10">
              <Text fontSize="xl" fontWeight="bold" color="gray.800" mb={4}>
                Contact Us
              </Text>
              
              <Box className="grid md:grid-cols-2 gap-6">
                {/* Email */}
                <Box className="bg-gray-50 rounded-lg p-5 border border-gray-200">
                  <Text fontWeight="semibold" color="gray-800" mb={2}>
                    Email
                  </Text>
                  <a
                    href="mailto:enquiries@sharetanzania.com"
                    className="text-[#1C3C8C] hover:underline"
                  >
                    enquiries@sharetanzania.com
                  </a>
                </Box>

                {/* Address */}
                <Box className="bg-gray-50 rounded-lg p-5 border border-gray-200">
                  <Text fontWeight="semibold" color="gray.800" mb={2}>
                    Our Address
                  </Text>
                  <address className="not-italic text-gray-600 text-sm leading-relaxed">
                    The Creator Share Foundation<br />
                    86-90 Paul Street<br />
                    London<br />
                    EC2A 4NE<br />
                    United Kingdom
                  </address>
                </Box>
              </Box>

              {/* Map placeholder or additional contact info could go here */}
              <Box mt-={6} className="text-center text-gray-500 text-sm mt-6">
                <Text>
                  We&apos;d love to hear from you. Reach out with any questions about 
                  sponsorships, donations, or volunteering opportunities.
                </Text>
              </Box>
            </Tabs.Content>
          </Tabs.Root>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

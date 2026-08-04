"use client"
import React, { useEffect, useState, useCallback } from "react"
import NextImage from "next/image"
import { Box, Flex, Image, Text, Tabs } from "@chakra-ui/react"
import { FaFacebook, FaInstagram, FaExternalLinkAlt } from "react-icons/fa"
import { usePublicSite } from "@/components/advocates/PublicSiteProvider"
import { createPublicSiteCssVariables } from "@/lib/advocates/publicSiteTheme"
import { notifyPublicPathChange } from "@/lib/advocates/publicPathChanges"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
  DialogTitle,
} from "@/components/ui/dialog"
import { getPublicPortalLinks } from "@/lib/payments/portals"

// Valid tab anchors that can open the modal
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TAB_ANCHORS = ["about", "centers", "contact"] as const
type TabAnchor = (typeof TAB_ANCHORS)[number]

interface AboutUsModalProps {
  open: boolean
  onClose: () => void
  defaultTab?: TabAnchor
  prevPath?: string
}

export const AboutUsModal: React.FC<AboutUsModalProps> = ({
  open,
  onClose,
  defaultTab = "about",
  prevPath,
}) => {
  const [activeTab, setActiveTab] = useState<TabAnchor>(defaultTab)
  const portalLinks = getPublicPortalLinks()
  const publicSite = usePublicSite()
  const isAdvocateSite = publicSite.kind === "advocate"
  const tabTriggerClassName = isAdvocateSite
    ? "px-4 py-4 md:px-6 md:py-6 text-sm font-medium whitespace-nowrap data-[selected]:text-[var(--public-site-primary-ink)] data-[selected]:border-b-2 data-[selected]:border-[var(--public-site-primary)]"
    : "px-6 py-6 text-sm font-medium data-[selected]:text-[#2b7ff9] data-[selected]:border-b-2 data-[selected]:border-[#2b7ff9]"
  const interactiveLinkClassName = isAdvocateSite
    ? "text-[var(--public-site-primary-ink)] hover:opacity-80 transition-opacity"
    : "text-[#2b7ff9] hover:text-[#1a6fe0] transition-colors"
  const dialogTitle =
    !isAdvocateSite || activeTab === "about"
      ? isAdvocateSite
        ? `About ${publicSite.displayName}`
        : "About Us"
      : activeTab === "centers"
        ? "Creator Share Centers"
        : "Creator Share Support"

  // Handle tab changes - update URL path
  const handleTabChange = useCallback((value: string) => {
    const tab = value as TabAnchor
    setActiveTab(tab)
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `/${tab}`)
      notifyPublicPathChange()
    }
  }, [])

  // Restore previous path when modal closes
  const handleClose = useCallback(() => {
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", prevPath ?? "/")
      notifyPublicPathChange()
    }
    onClose()
  }, [onClose, prevPath])

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
      scrollBehavior="outside"
    >
      <DialogContent
        className="max-w-4xl mx-4 rounded-3xl overflow-hidden"
        style={{
          ...(isAdvocateSite ? createPublicSiteCssVariables(publicSite) : {}),
          boxShadow:
            "0 60px 120px -20px rgba(0, 0, 0, 0.6), 0 24px 48px -8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.06)",
          borderRadius: "24px",
        }}
      >
        <DialogHeader
          className={
            isAdvocateSite ? "px-10 py-6" : "bg-[#2b7ff9] text-white px-10 py-6"
          }
          style={
            isAdvocateSite
              ? {
                  backgroundColor: "var(--public-site-primary)",
                  color: "var(--public-site-primary-foreground)",
                }
              : undefined
          }
        >
          <DialogTitle fontSize="xl" fontWeight="bold">
            {dialogTitle}
          </DialogTitle>
          <DialogCloseTrigger
            className={
              isAdvocateSite
                ? "hover:opacity-80"
                : "text-white hover:bg-white/20"
            }
          />
        </DialogHeader>

        <DialogBody p={0}>
          <Tabs.Root
            value={activeTab}
            onValueChange={(e) => handleTabChange(e.value)}
            variant="line"
          >
            <Tabs.List
              className={
                isAdvocateSite
                  ? "w-full bg-gray-50 px-0 md:px-12 border-b justify-start overflow-x-auto"
                  : "bg-gray-50 px-0 md:px-12 border-b justify-center md:justify-start"
              }
            >
              <Tabs.Trigger
                value="about"
                className={tabTriggerClassName}
                flex={isAdvocateSite ? "0 0 auto" : undefined}
              >
                About
              </Tabs.Trigger>
              <Tabs.Trigger
                value="centers"
                className={tabTriggerClassName}
                flex={isAdvocateSite ? "0 0 auto" : undefined}
              >
                {isAdvocateSite ? "Creator Share Centers" : "Our Centers"}
              </Tabs.Trigger>
              <Tabs.Trigger
                value="contact"
                className={tabTriggerClassName}
                flex={isAdvocateSite ? "0 0 auto" : undefined}
              >
                {isAdvocateSite ? "Creator Share Support" : "Contact"}
              </Tabs.Trigger>
            </Tabs.List>

            {/* About Tab */}
            <Tabs.Content value="about" className="p-6 md:p-12">
              <Box>
                {isAdvocateSite ? (
                  <>
                    <Flex
                      alignItems={{ base: "flex-start", sm: "center" }}
                      flexDirection={{ base: "column", sm: "row" }}
                      gap={5}
                      mb={7}
                    >
                      {publicSite.logoUrl ? (
                        <Image
                          src={publicSite.logoUrl}
                          alt={publicSite.logoAltText || publicSite.displayName}
                          maxH="88px"
                          maxW={{ base: "220px", sm: "260px" }}
                          objectFit="contain"
                        />
                      ) : null}
                      <Text
                        as="p"
                        color="var(--public-site-primary-ink)"
                        fontSize="2xl"
                        fontWeight="bold"
                        lineHeight="1.2"
                      >
                        {publicSite.displayName}
                      </Text>
                    </Flex>

                    {publicSite.aboutBiographyHtml ? (
                      <Box
                        data-advocate-about-biography="true"
                        color="gray.700"
                        lineHeight="1.8"
                        mb={8}
                        borderInlineStart="4px solid var(--public-site-accent)"
                        paddingInlineStart={5}
                        css={{
                          "& h3": {
                            color: "var(--public-site-primary-ink)",
                            fontSize: "1.125rem",
                            fontWeight: 700,
                            lineHeight: "1.3",
                            margin: 0,
                          },
                          "& p, & ul, & ol, & blockquote": { margin: 0 },
                          "& > * + *": { marginTop: "0.85rem" },
                          "& ul, & ol": { paddingInlineStart: "1.4rem" },
                          "& blockquote": {
                            color: "gray.600",
                            fontStyle: "italic",
                            paddingInlineStart: "0.75rem",
                          },
                        }}
                        // The public site DTO contains field-normalized
                        // canonical HTML sanitized by the server-only boundary.
                        dangerouslySetInnerHTML={{
                          __html: publicSite.aboutBiographyHtml,
                        }}
                      />
                    ) : null}

                    <Flex
                      alignItems="center"
                      gap={4}
                      borderTop="1px solid"
                      borderColor="gray.200"
                      pt={6}
                      mb={8}
                    >
                      <NextImage
                        src="/logo_text.svg"
                        alt="Creator Share"
                        width={112}
                        height={32}
                        style={{ objectFit: "contain" }}
                      />
                      <Box>
                        <Flex alignItems="center" gap={2} mb={1}>
                          <Box
                            aria-hidden="true"
                            width="8px"
                            height="8px"
                            borderRadius="full"
                            background="var(--public-site-accent)"
                          />
                          <Text
                            color="gray.800"
                            fontSize="sm"
                            fontWeight="semibold"
                          >
                            Trusted sponsorship platform
                          </Text>
                        </Flex>
                        <Text color="gray.600" fontSize="xs" lineHeight="1.5">
                          Sponsorships on this site are administered by Creator
                          Share.
                        </Text>
                      </Box>
                    </Flex>

                    <Box className="bg-gray-50 rounded-lg p-5 border border-gray-200 space-y-2">
                      <Text fontWeight="semibold" color="gray.800" mb={2}>
                        Existing Sponsor?
                      </Text>
                      {portalLinks.map((link) => (
                        <a
                          key={`${link.provider}-${link.region ?? "default"}`}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`flex items-center gap-2 hover:underline text-sm ${interactiveLinkClassName}`}
                        >
                          <FaExternalLinkAlt className="w-3 h-3" />
                          {link.label}
                        </a>
                      ))}
                    </Box>
                  </>
                ) : (
                  <>
                    {/* Logo */}
                    <Box mb={6}>
                      <NextImage
                        src="/logo_text.svg"
                        alt="Creator Share"
                        width={200}
                        height={56}
                        style={{ objectFit: "contain" }}
                      />
                    </Box>

                    <Text
                      fontSize="2xl"
                      fontWeight="bold"
                      color="gray.800"
                      mb={4}
                    >
                      The Creator Share Foundation
                    </Text>
                    <Text color="gray.600" mb={4}>
                      UK Registered Charity 1169474
                    </Text>
                    <Text color="gray.700" lineHeight="1.8" mb={8}>
                      Creator Share connects sponsors with children in need,
                      providing education, medical care, adequate nutrition, and
                      the opportunity to pursue their hopes and dreams. One
                      child at a time, love is changing thousands of lives.
                    </Text>

                    {/* Tanzania website CTA */}
                    <a
                      href="https://tanzania.creatorshare.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between w-full bg-[#2b7ff9] hover:bg-[#1a6fe0] transition-colors text-white rounded-2xl px-6 py-4 mb-8 group"
                    >
                      <Box>
                        <Text fontWeight="bold" fontSize="md" color="white">
                          Visit Our Tanzania Website
                        </Text>
                        <Text fontSize="sm" color="white" opacity={0.85}>
                          tanzania.creatorshare.com
                        </Text>
                      </Box>
                      <FaExternalLinkAlt className="w-4 h-4 opacity-80 group-hover:opacity-100 flex-shrink-0" />
                    </a>

                    {/* Social Links */}
                    <Box mb={8}>
                      <Text fontWeight="semibold" color="gray.800" mb={3}>
                        Follow Us
                      </Text>
                      <Flex gap={4}>
                        <a
                          href="https://www.facebook.com/sharetanzania"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-[#2b7ff9] hover:text-[#1a6fe0] transition-colors"
                        >
                          <FaFacebook className="w-6 h-6" />
                          <Text fontSize="sm">Facebook</Text>
                        </a>
                        <a
                          href="https://www.instagram.com/creatorshare_tanzania?igsh=ajJoYmhiNGtpYXlq"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-[#2b7ff9] hover:text-[#1a6fe0] transition-colors"
                        >
                          <FaInstagram className="w-6 h-6" />
                          <Text fontSize="sm">Instagram</Text>
                        </a>
                      </Flex>
                    </Box>

                    {/* Manage Subscriptions Link */}
                    <Box className="bg-gray-50 rounded-lg p-5 border border-gray-200 space-y-2">
                      <Text fontWeight="semibold" color="gray.800" mb={2}>
                        Existing Sponsor?
                      </Text>
                      {portalLinks.map((link) => (
                        <a
                          key={`${link.provider}-${link.region ?? "default"}`}
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-[#2b7ff9] hover:underline text-sm"
                        >
                          <FaExternalLinkAlt className="w-3 h-3" />
                          {link.label}
                        </a>
                      ))}
                    </Box>
                  </>
                )}
              </Box>
            </Tabs.Content>

            {/* Centers Tab */}
            <Tabs.Content value="centers" className="p-6 md:p-12">
              <Text fontSize="xl" fontWeight="bold" color="gray.800" mb={4}>
                {isAdvocateSite ? "Creator Share Centers" : "Our Centers"}
              </Text>
              <Text color="gray.600" mb={8}>
                {isAdvocateSite
                  ? "Creator Share operates these centers in Tanzania, each dedicated to supporting vulnerable populations in different ways."
                  : "We operate multiple centers in Tanzania, each dedicated to supporting vulnerable populations in different ways."}
              </Text>
              <Box className="space-y-4">
                {centers.map((center, index) => (
                  <a
                    key={index}
                    href={center.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200 group"
                  >
                    <Box className="flex-1">
                      <Text
                        fontWeight="medium"
                        color="gray.800"
                        className={
                          isAdvocateSite
                            ? "group-hover:text-[var(--public-site-primary-ink)]"
                            : "group-hover:text-[#2b7ff9]"
                        }
                      >
                        {center.name}
                      </Text>
                    </Box>
                    <FaExternalLinkAlt
                      className={
                        isAdvocateSite
                          ? "w-4 h-4 text-gray-400 group-hover:text-[var(--public-site-primary-ink)]"
                          : "w-4 h-4 text-gray-400 group-hover:text-[#2b7ff9]"
                      }
                    />
                  </a>
                ))}
              </Box>
            </Tabs.Content>

            {/* Contact Tab */}
            <Tabs.Content value="contact" className="p-6 md:p-12">
              <Text fontSize="xl" fontWeight="bold" color="gray.800" mb={6}>
                {isAdvocateSite ? "Creator Share Support" : "Contact Us"}
              </Text>

              <Box className="grid md:grid-cols-2 gap-6">
                {/* Email */}
                <Box className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                  <Text fontWeight="semibold" color="gray-800" mb={2}>
                    {isAdvocateSite ? "Creator Share Email" : "Email"}
                  </Text>
                  <a
                    href="mailto:enquiries@sharetanzania.com"
                    className={
                      isAdvocateSite
                        ? `${interactiveLinkClassName} hover:underline`
                        : "text-[#2b7ff9] hover:underline"
                    }
                  >
                    enquiries@sharetanzania.com
                  </a>
                </Box>

                {/* Address */}
                <Box className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                  <Text fontWeight="semibold" color="gray.800" mb={2}>
                    {isAdvocateSite ? "Creator Share Address" : "Our Address"}
                  </Text>
                  <address className="not-italic text-gray-600 text-sm leading-relaxed">
                    The Creator Share Foundation
                    <br />
                    86-90 Paul Street
                    <br />
                    London
                    <br />
                    EC2A 4NE
                    <br />
                    United Kingdom
                  </address>
                </Box>
              </Box>

              {/* Map placeholder or additional contact info could go here */}
              <Box className="text-center text-gray-500 text-sm mt-8">
                <Text>
                  {isAdvocateSite ? (
                    <>
                      Creator Share would love to hear from you. Reach out with
                      questions about sponsorships, donations, or volunteering
                      opportunities.
                    </>
                  ) : (
                    <>
                      We&apos;d love to hear from you. Reach out with any
                      questions about sponsorships, donations, or volunteering
                      opportunities.
                    </>
                  )}
                </Text>
              </Box>
            </Tabs.Content>
          </Tabs.Root>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

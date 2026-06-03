"use client"
import { useState, useEffect } from "react"
import { Box, Text, Flex, Badge, Button } from "@chakra-ui/react"
import { FaCalendar, FaLocationDot, FaPerson, FaHeart } from "react-icons/fa6"
import { MdCancelPresentation } from "react-icons/md"
import { calculateAge } from "@/utils/ageCalculator"
import { getImageSrc, getThumbnailSrc } from "@/utils/supabase/media"
import { PERSON_PLACEHOLDER_PATH } from "@/utils/placeholders"
import { ImageCarousel } from "@/components/common/ImageCarousel"
import { BeneficiaryMedia } from "@/types/admin.types"
import { RIM_OVERLAY, CARD_SHADOW } from "@/app/sponsorships/components/SponsorshipCard/cardStyles"
import {
  DialogRoot, DialogContent, DialogHeader, DialogBody, DialogCloseTrigger, DialogFooter,
} from "@/components/ui/dialog"

interface SubscriptionInfo {
  id: string; amount: number; interval: string; status: string
  current_period_end: string; created_at: string; stripe_subscription_id: string | null
}

interface Props {
  beneficiary: {
    id: string; name: string; username: string; birth_date?: string | null
    gender?: string | null; country?: string | null; biography?: string | null
    beneficiary_type?: string | null; metadata?: Record<string, unknown> | null
  }
  subscription: SubscriptionInfo
  onViewProfile?: () => void
  onCancel?: () => void
}

/** Friendly relative-duration label like "3 months" or "since Apr 2025" */
function sinceLabel(start: string, now = Date.now()) {
  const months = Math.round((now - new Date(start).getTime()) / (30 * 24 * 60 * 60 * 1000))
  if (months < 1) return "just started"
  if (months < 2) return "1 month"
  return `${months} months`
}

const SponsoredBeneficiaryCard: React.FC<Props> = ({ beneficiary, subscription, onViewProfile, onCancel }) => {
  const [images, setImages] = useState<BeneficiaryMedia[]>([])
  const [cancelOpen, setCancelOpen] = useState(false)
  const placeholderImage = PERSON_PLACEHOLDER_PATH

  useEffect(() => {
    fetch(`/api/beneficiaries/images/${beneficiary.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setImages(
          (data as BeneficiaryMedia[]).filter((m: BeneficiaryMedia) => m.type === "IMAGE")
            .sort((a: BeneficiaryMedia, b: BeneficiaryMedia) => (a.weight || 0) - (b.weight || 0)),
        )
      }).catch((err) => { console.error("Failed to load beneficiary images:", err) })
  }, [beneficiary.id])

  const age = beneficiary.birth_date ? calculateAge(new Date(beneficiary.birth_date).toISOString()) : null
  const amountStr = `$${(subscription.amount / 100).toFixed(2)}/${subscription.interval}`

  // Single now() reference so journey duration and lifetime total stay in sync
  const now = Date.now()
  const journey = sinceLabel(subscription.created_at, now)
  const monthsSince = Math.max(1,
    Math.round((now - new Date(subscription.created_at).getTime()) / (30 * 24 * 60 * 60 * 1000)))
  const totalContrib = `$${((subscription.amount * monthsSince) / 100).toFixed(0)}`

  return (
    <>
      <Box
        className="group rounded-[20px] overflow-hidden bg-white transition-all duration-300"
        style={{ boxShadow: CARD_SHADOW }}
        maxW="100%" mx="auto" height="100%" display="flex" flexDirection="column"
        _hover={{ transform: "translateY(-3px)", boxShadow: "0 8px 30px rgba(0,0,0,0.1)" }}
      >
        {/* ── Photo ── */}
        <Box position="relative" flexShrink={0} height={{ base: "200px", md: "240px" }} w="100%" overflow="hidden">
          <ImageCarousel
            images={images} getImageSrc={getImageSrc} getThumbnailSrc={getThumbnailSrc}
            fallbackSrc={placeholderImage} alt={beneficiary.name?.split(" ")[0] ?? ""}
            className="w-full h-full rounded-t-[20px]" showArrowsOnHover={true}
          />
          <div style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none", background: RIM_OVERLAY }} />

          <Badge
            position="absolute" top={3} right={3} zIndex={10}
            bg="rgba(255,255,255,0.9)" color={subscription.status === "cancelled" ? "gray.500" : "#2b7ff9"}
            fontSize="xs" px={3} py={1.5} borderRadius="full" fontWeight="600" backdropFilter="blur(4px)"
          >
            <FaHeart style={{ display: "inline", marginRight: 4, opacity: 0.7 }} />
            {subscription.status === "cancelled" ? "Previously sponsored" : "Sponsoring now"}
          </Badge>
        </Box>

        {/* ── Content ── */}
        <Box px={4} pt={3} pb={4} display="flex" flexDirection="column" flex={1}>
          {/* Name + amount */}
          <Box mb={1.5}>
            <Text fontSize={{ base: "md", md: "lg" }} fontWeight="bold" color="gray.800" lineHeight="1.2">
              {beneficiary.name || "Sponsorship"}
            </Text>
            <Text fontSize="sm" fontWeight="600" color="#2b7ff9">{amountStr}</Text>
          </Box>

          {/* Journey line */}
          <Flex align="center" gap={1.5} mb={2}>
            <Box w="6px" h="6px" borderRadius="full" bg="#2b7ff9" opacity={0.4} />
            <Text fontSize="xs" color="gray.500">
              Part of their journey for <strong>{journey}</strong> · <strong>{totalContrib}</strong> contributed
            </Text>
          </Flex>

          {/* Quick info */}
          <Flex gap={3} flexWrap="wrap" className="text-[#666666]" mb={2}>
            {age !== null && (
              <Flex align="center" gap={1}>
                <FaCalendar size={11} /><Text fontSize="xs">{age} years</Text>
              </Flex>
            )}
            <Flex align="center" gap={1}>
              <FaPerson size={11} /><Text fontSize="xs">{beneficiary.gender || "N/A"}</Text>
            </Flex>
            <Flex align="center" gap={1}>
              <FaLocationDot size={11} /><Text fontSize="xs">{beneficiary.country || "N/A"}</Text>
            </Flex>
          </Flex>

          {/* Biography — gentle clamp */}
          {beneficiary.biography && (
            <Text fontSize="xs" color="#666" mb={2} lineHeight="1.5"
              css={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {beneficiary.biography}
            </Text>
          )}

          <Box flex={1} />

          {/* Actions */}
          <Flex gap={2} mt="auto">
            <Button size="sm" variant="outline" flex={1} borderRadius="12px" onClick={onViewProfile}>
              See their story
            </Button>
            {subscription.status !== "cancelled" && (
              <Button size="sm" variant="ghost" flexShrink={0}
                borderRadius="12px" color="gray.400" _hover={{ color: "red.500", bg: "red.50" }}
                onClick={() => setCancelOpen(true)}>
                <MdCancelPresentation className="mr-1" /> End
              </Button>
            )}
          </Flex>
        </Box>
      </Box>

      {/* ── Kind cancel dialog ── */}
      <DialogRoot open={cancelOpen} onOpenChange={(d) => { if (!d.open) setCancelOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <Text className="text-lg font-semibold">Leaving so soon?</Text>
            <DialogCloseTrigger />
          </DialogHeader>
          <DialogBody>
            <Flex direction="column" gap={4}>
              <Text>
                If you end your sponsorship, <strong>{beneficiary.name}</strong> will lose
                the support you&apos;ve been providing.
              </Text>
              <Text fontSize="sm" color="gray.600">
                Your recurring payment of <strong>{amountStr}</strong> will stop immediately.
                You can always start a new sponsorship later.
              </Text>
            </Flex>
          </DialogBody>
          <DialogFooter>
            <Flex gap={3} w="full" justify="flex-end">
              <Button variant="outline" borderRadius="12px"
                onClick={() => setCancelOpen(false)}>
                Keep sponsoring
              </Button>
              <Button borderRadius="12px"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={() => { setCancelOpen(false); onCancel?.() }}>
                End sponsorship
              </Button>
            </Flex>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </>
  )
}

export default SponsoredBeneficiaryCard

"use client"
import React, { useState } from "react"
import Image from "next/image"
import { Box, Text, Flex } from "@chakra-ui/react"
import { Activity } from "@/types"

/** Relative time label, absolute time on hover via title attribute. */
function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return "just now"
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months === 1 ? "" : "s"} ago`
}

function formatAbsoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

// ---------------------------------------------------------------------------
// ActivityItem -- a single flat update, no card chrome
// ---------------------------------------------------------------------------

interface ActivityItemProps {
  activity: Activity
}

const ActivityItem: React.FC<ActivityItemProps> = ({ activity }) => {
  const [expanded, setExpanded] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const images = activity.images_url ?? []
  const videos = activity.videos_url ?? []
  const hasMedia = images.length > 0 || videos.length > 0

  // Description is long enough to warrant clamping when collapsed
  const longDescription = (activity.description?.length ?? 0) > 200

  return (
    <>
      {/* Lightbox */}
      {lightboxSrc && (
        <Box
          position="fixed"
          inset={0}
          zIndex={9999}
          bg="blackAlpha.900"
          display="flex"
          alignItems="center"
          justifyContent="center"
          cursor="zoom-out"
          onClick={() => setLightboxSrc(null)}
        >
          <Box position="relative" maxW="90vw" maxH="90vh">
            <Image
              src={lightboxSrc}
              alt="Full size"
              width={1200}
              height={900}
              className="object-contain max-h-[90vh]"
              unoptimized
            />
          </Box>
        </Box>
      )}

      <Box>
        {/* Optional title */}
        {activity.title && (
          <Text className="text-gray-700 leading-relaxed text-sm font-semibold mb-1">
            {activity.title}
          </Text>
        )}

        {/* Description -- clamp to 3 lines when collapsed */}
        <Text
          className="text-gray-700 leading-relaxed text-sm md:text-base"
          style={
            !expanded && longDescription
              ? {
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }
              : undefined
          }
        >
          {activity.description}
        </Text>

        {/* Show more / Show less toggle */}
        {longDescription && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-[#0654C6] font-medium mt-1 hover:underline focus:outline-none"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}

        {/* Media tiles -- images */}
        {images.length > 0 && (
          <Flex gap={2} flexWrap="wrap" mt={3}>
            {images.map((url, i) => (
              <Box
                key={i}
                position="relative"
                w="90px"
                h="68px"
                borderRadius="md"
                overflow="hidden"
                cursor="zoom-in"
                flexShrink={0}
                onClick={() => setLightboxSrc(url)}
              >
                <Image
                  src={url}
                  alt={`Update image ${i + 1}`}
                  fill
                  sizes="90px"
                  className="object-cover"
                  unoptimized
                />
              </Box>
            ))}
          </Flex>
        )}

        {/* Media tiles -- videos */}
        {videos.length > 0 && (
          <Flex direction="column" gap={2} mt={3}>
            {videos.map((url, i) => (
              <video
                key={i}
                src={url}
                controls
                preload="metadata"
                className="rounded-lg max-w-full max-h-48 object-contain"
                onError={(e) => { e.currentTarget.style.display = "none" }}
              />
            ))}
          </Flex>
        )}

        {/* Timestamp */}
        <Text
          fontSize="xs"
          color="gray.400"
          mt={hasMedia ? 2 : 1}
          title={formatAbsoluteTime(activity.created_at)}
          style={{ cursor: "default" }}
        >
          {formatRelativeTime(activity.created_at)}
        </Text>
      </Box>
    </>
  )
}

// ---------------------------------------------------------------------------
// BeneficiaryActivity -- the section exported to the modal
// ---------------------------------------------------------------------------

interface BeneficiaryActivityProps {
  activities: Activity[]
}

const BeneficiaryActivity: React.FC<BeneficiaryActivityProps> = ({ activities }) => {
  if (activities.length === 0) return null

  return (
    <Box>
      {activities.map((activity, i) => (
        <React.Fragment key={activity.id}>
          <ActivityItem activity={activity} />
          {i < activities.length - 1 && (
            <Box h="1px" bg="gray.200" my={4} />
          )}
        </React.Fragment>
      ))}
    </Box>
  )
}

export default BeneficiaryActivity

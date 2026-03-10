"use client"
import React, { useState } from "react"
import Image from "next/image"
import { Box, Text, Flex } from "@chakra-ui/react"
import { Activity } from "@/types"

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

/** Returns a short, bold-friendly label like "4d" or "2mo" and a subtitle like "ago". */
function formatRelativeTimeParts(dateStr: string): { main: string; sub: string } {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return { main: "now", sub: "" }
  if (minutes < 60) return { main: `${minutes}m`, sub: "ago" }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { main: `${hours}h`, sub: "ago" }
  const days = Math.floor(hours / 24)
  if (days < 30) return { main: `${days}d`, sub: "ago" }
  const months = Math.floor(days / 30)
  return { main: `${months}mo`, sub: "ago" }
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
// MediaColumn -- stacked thumbnails shown in the third column
// ---------------------------------------------------------------------------

interface MediaColumnProps {
  images: string[]
  videos: string[]
  onLightbox: (src: string) => void
}

const MediaColumn: React.FC<MediaColumnProps> = ({ images, videos, onLightbox }) => {
  if (images.length === 0 && videos.length === 0) return null

  return (
    <Flex direction="column" gap={1.5} flexShrink={0} w="84px" pt="2px">
      {images.map((url, i) => (
        <Box
          key={`img-${i}`}
          position="relative"
          w="84px"
          h="64px"
          borderRadius="md"
          overflow="hidden"
          cursor="zoom-in"
          flexShrink={0}
          onClick={() => onLightbox(url)}
        >
          <Image
            src={url}
            alt={`Update image ${i + 1}`}
            fill
            sizes="84px"
            className="object-cover"
            unoptimized
          />
        </Box>
      ))}
      {videos.map((url, i) => (
        <Box
          key={`vid-${i}`}
          w="84px"
          borderRadius="md"
          overflow="hidden"
          flexShrink={0}
        >
          <video
            src={url}
            controls
            preload="metadata"
            className="w-full rounded-md"
            style={{ maxHeight: "64px", objectFit: "cover" }}
            onError={(e) => { e.currentTarget.style.display = "none" }}
          />
        </Box>
      ))}
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// ActivityRow -- a single timeline entry
// ---------------------------------------------------------------------------

const DESCRIPTION_CLAMP = 180

interface ActivityRowProps {
  activity: Activity
  isLast: boolean
  onLightbox: (src: string) => void
}

const ActivityRow: React.FC<ActivityRowProps> = ({ activity, isLast, onLightbox }) => {
  const [descExpanded, setDescExpanded] = useState(false)

  const images = activity.images_url ?? []
  const videos = activity.videos_url ?? []
  const hasMedia = images.length > 0 || videos.length > 0
  const longDesc = (activity.description?.length ?? 0) > DESCRIPTION_CLAMP
  const { main, sub } = formatRelativeTimeParts(activity.created_at)

  return (
    <Flex gap={0} align="flex-start">
      {/* Column 1: date label + timeline spine */}
      <Box
        w="56px"
        flexShrink={0}
        display="flex"
        flexDirection="column"
        alignItems="center"
        pt="2px"
      >
        {/* Bold relative date */}
        <Box
          textAlign="center"
          mb={2}
          title={formatAbsoluteTime(activity.created_at)}
          style={{ cursor: "default" }}
        >
          <Text
            fontSize="16px"
            fontWeight="800"
            color="gray.700"
            lineHeight={1}
          >
            {main}
          </Text>
          {sub && (
            <Text fontSize="9px" fontWeight="600" color="gray.400" lineHeight={1} mt="2px">
              {sub}
            </Text>
          )}
        </Box>

        {/* Circle node */}
        <Box
          w="10px"
          h="10px"
          borderRadius="full"
          bg="blue.400"
          border="2px solid white"
          flexShrink={0}
          style={{ boxShadow: "0 0 0 2px #93c5fd" }}
        />

        {/* Spine line down to next entry */}
        {!isLast && (
          <Box flex={1} w="2px" bg="gray.200" mt={1} minH="20px" />
        )}
      </Box>

      {/* Column 2: title + description */}
      <Box flex={1} minW={0} px={3} pb={isLast ? 0 : 5}>
        {activity.title && (
          <Text className="text-gray-700 text-sm font-semibold mb-1 leading-snug">
            {activity.title}
          </Text>
        )}

        {activity.description && (
          <>
            <Text
              className="text-gray-700 text-sm leading-relaxed"
              style={
                !descExpanded && longDesc
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
            {longDesc && (
              <button
                onClick={() => setDescExpanded((v) => !v)}
                className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-[#0654C6] bg-blue-50 hover:bg-blue-100 transition-colors focus:outline-none"
              >
                {descExpanded ? "Show less" : "Show more"}
              </button>
            )}
          </>
        )}
      </Box>

      {/* Column 3: media thumbnails */}
      {hasMedia && (
        <MediaColumn images={images} videos={videos} onLightbox={onLightbox} />
      )}
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// BeneficiaryActivity -- exported component; manages list expansion + lightbox
// ---------------------------------------------------------------------------

const COLLAPSED_COUNT = 2

interface BeneficiaryActivityProps {
  activities: Activity[]
}

const BeneficiaryActivity: React.FC<BeneficiaryActivityProps> = ({ activities }) => {
  const [listExpanded, setListExpanded] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (activities.length === 0) return null

  const visible = listExpanded ? activities : activities.slice(0, COLLAPSED_COUNT)
  const hasMore = activities.length > COLLAPSED_COUNT
  const hiddenCount = activities.length - COLLAPSED_COUNT

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

      {/* Timeline entries */}
      <Box>
        {visible.map((activity, i) => (
          <ActivityRow
            key={activity.id}
            activity={activity}
            isLast={i === visible.length - 1}
            onLightbox={setLightboxSrc}
          />
        ))}
      </Box>

      {/* List-level show more / show less */}
      {hasMore && (
        <button
          onClick={() => setListExpanded((v) => !v)}
          className="mt-3 w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold text-[#0654C6] bg-blue-50 hover:bg-blue-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <span>
            {listExpanded
              ? "Show less"
              : `Show ${hiddenCount} more update${hiddenCount === 1 ? "" : "s"}`}
          </span>
          <span style={{ fontSize: "10px" }}>{listExpanded ? "▲" : "▼"}</span>
        </button>
      )}
    </>
  )
}

export default BeneficiaryActivity

"use client"
import React, { useState } from "react"
import Image from "next/image"
import { Box, Text, Flex } from "@chakra-ui/react"
import { Activity } from "@/types"

// ---------------------------------------------------------------------------
// Shared "Show more / Show less" button — exported so the modal's About
// section can use an identical style.
// ---------------------------------------------------------------------------

// Block-level, auto-width ghost pill. flex + w-fit keeps it as wide as its
// content and forces it flush to the left edge of its container.
export const SHOW_MORE_CLASS =
  "mt-2 flex w-fit items-center gap-1.5 text-sm font-semibold text-[#0654C6] px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"

// ---------------------------------------------------------------------------
// Time formatting
// ---------------------------------------------------------------------------

function formatRelativeTimeParts(dateStr: string): { main: string; sub: string } {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 2) return { main: "just now", sub: "" }
  if (minutes < 60) return { main: `${minutes} min`, sub: "ago" }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { main: `${hours} ${hours === 1 ? "hour" : "hours"}`, sub: "ago" }
  const days = Math.floor(hours / 24)
  if (days < 30) return { main: `${days} ${days === 1 ? "day" : "days"}`, sub: "ago" }
  const months = Math.floor(days / 30)
  return { main: `${months} ${months === 1 ? "month" : "months"}`, sub: "ago" }
}

function formatAbsoluteTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

// ---------------------------------------------------------------------------
// DateTooltip — relative date with absolute tooltip on hover
// ---------------------------------------------------------------------------

const DateTooltip: React.FC<{ dateStr: string }> = ({ dateStr }) => {
  const [visible, setVisible] = useState(false)
  const { main, sub } = formatRelativeTimeParts(dateStr)
  const absolute = formatAbsoluteTime(dateStr)

  return (
    <Box
      position="relative"
      display="inline-block"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      style={{ cursor: "default" }}
    >
      <Box textAlign="center">
        <Text fontSize="15px" fontWeight="800" color="gray.700" lineHeight={1.1}>
          {main}
        </Text>
        {sub && (
          <Text fontSize="9px" fontWeight="600" color="gray.400" lineHeight={1} mt="2px">
            {sub}
          </Text>
        )}
      </Box>

      {visible && (
        <Box
          position="absolute"
          bottom="calc(100% + 8px)"
          left="50%"
          style={{ transform: "translateX(-50%)" }}
          px={3}
          py={1.5}
          bg="gray.800"
          color="white"
          borderRadius="lg"
          fontSize="11px"
          fontWeight="500"
          whiteSpace="nowrap"
          zIndex={50}
          pointerEvents="none"
          boxShadow="md"
        >
          {absolute}
          <Box
            position="absolute"
            top="100%"
            left="50%"
            style={{
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid #1a202c",
            }}
          />
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// ActivityRow — two-column layout:
//   Left  (120px): date label → circle node → spine → media thumbnails
//   Right (flex):  title → description → show more
// ---------------------------------------------------------------------------

const LEFT_COL_W = "120px"
const LEFT_COL_PX = 120  // numeric mirror for arithmetic — must stay in sync with LEFT_COL_W
const RIGHT_COL_PL = 12  // pl={3} in Chakra = 3 × 4px = 12px
const DESCRIPTION_CLAMP = 180
const THUMB_W = "100px"
const THUMB_H = "80px"

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

  return (
    // align="stretch" so both columns fill the same height; spacing between
    // entries is the left column's bottom padding via the spine area.
    <Flex gap={0} align="stretch" pb={isLast ? 0 : 0}>
      {/* ── Left column ── */}
      <Box
        w={LEFT_COL_W}
        flexShrink={0}
        display="flex"
        flexDirection="column"
        alignItems="center"
        pt="2px"
      >
        {/* Date label */}
        <DateTooltip dateStr={activity.created_at} />

        {/* Circle node */}
        <Box
          w="10px"
          h="10px"
          borderRadius="full"
          bg="blue.400"
          border="2px solid white"
          flexShrink={0}
          mt={2}
          style={{ boxShadow: "0 0 0 2px #93c5fd" }}
        />

        {/* Area below circle: spine + media thumbnails */}
        <Box
          flex={1}
          w="full"
          position="relative"
          pt={hasMedia ? 2 : 0}
          pb={isLast ? 0 : 5}
          minH={isLast && !hasMedia ? 0 : "20px"}
        >
          {/* Spine line running the full height of this area */}
          {!isLast && (
            <Box
              position="absolute"
              left="50%"
              top={0}
              bottom={0}
              w="2px"
              bg="gray.200"
              style={{ transform: "translateX(-50%)" }}
            />
          )}

          {/* Thumbnails sit above the spine */}
          {hasMedia && (
            <Flex
              direction="column"
              gap={1.5}
              align="center"
              position="relative"
              zIndex={1}
            >
              {images.map((url, i) => (
                <Box
                  key={`img-${i}`}
                  position="relative"
                  w={THUMB_W}
                  h={THUMB_H}
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
                    sizes={THUMB_W}
                    className="object-cover"
                    unoptimized
                  />
                </Box>
              ))}
              {videos.map((url, i) => (
                <Box
                  key={`vid-${i}`}
                  w={THUMB_W}
                  borderRadius="md"
                  overflow="hidden"
                  flexShrink={0}
                >
                  <video
                    src={url}
                    controls
                    preload="metadata"
                    className="w-full rounded-md"
                    style={{ maxHeight: THUMB_H, objectFit: "cover" }}
                    onError={(e) => { e.currentTarget.style.display = "none" }}
                  />
                </Box>
              ))}
            </Flex>
          )}
        </Box>
      </Box>

      {/* ── Right column ── */}
      <Box flex={1} minW={0} pl={3} pb={isLast ? 0 : 5} display="flex" flexDirection="column" alignItems="flex-start">
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
                      WebkitLineClamp: 6,
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
                className={SHOW_MORE_CLASS}
              >
                {descExpanded ? "Show less" : "Show more"}
                <span aria-hidden>{descExpanded ? "▲" : "▼"}</span>
              </button>
            )}
          </>
        )}
      </Box>
    </Flex>
  )
}

// ---------------------------------------------------------------------------
// BeneficiaryActivity — manages list expansion + lightbox
// ---------------------------------------------------------------------------

const COLLAPSED_COUNT = 2

interface BeneficiaryActivityProps {
  activities: Activity[]
}

const BeneficiaryActivity: React.FC<BeneficiaryActivityProps> = ({ activities }) => {
  const [listExpanded, setListExpanded] = useState(true)
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

      {/* Indent to align with the right-column text */}
      {hasMore && (
        <Box pl={`${LEFT_COL_PX + RIGHT_COL_PL}px`}>
          <button
            onClick={() => setListExpanded((v) => !v)}
            className={SHOW_MORE_CLASS}
          >
            {listExpanded
              ? "Show less"
              : `Show ${hiddenCount} more update${hiddenCount === 1 ? "" : "s"}`}
            <span aria-hidden>{listExpanded ? "▲" : "▼"}</span>
          </button>
        </Box>
      )}
    </>
  )
}

export default BeneficiaryActivity

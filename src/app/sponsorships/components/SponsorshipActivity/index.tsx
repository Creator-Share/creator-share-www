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
  "mt-2 flex w-fit items-center gap-1.5 text-sm font-semibold text-[#2b7ff9] px-3 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"

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
      <Box textAlign="left">
        <Text fontSize="15px" fontWeight="800" color="gray.700" lineHeight={1.1} display="inline">
          {main}
        </Text>
        {sub && (
          <Text fontSize="13px" fontWeight="600" color="gray.400" lineHeight={1} display="inline" ml="4px">
            {sub}
          </Text>
        )}
      </Box>

      {visible && (
        <Box
          position="absolute"
          bottom="calc(100% + 8px)"
          left="0"
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
            left="12px"
            style={{
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
// ActivityRow — timeline layout:
//   Spine (24px): dashed blue line + dot on far left edge
//   Content (flex): date inline with dot → title → description → thumbnails
// ---------------------------------------------------------------------------

const SPINE_W = "24px"
const DESCRIPTION_CLAMP = 180
/** Width/height for image thumbnails; cells use `repeat(3, 1fr)` so three fill the row. */
const THUMB_ASPECT = 140 / 110
/** Full-width video rows below the image grid (typical wide video framing). */
const VIDEO_ROW_ASPECT = 16 / 9

// Height of the "incoming" line segment above the dot — matches one line of
// date text so the dot vertically aligns with the label beside it.
const DOT_OFFSET_H = "14px"

interface ActivityRowProps {
  activity: Activity
  isFirst: boolean
  isLast: boolean
  onLightbox: (src: string) => void
}

const ActivityRow: React.FC<ActivityRowProps> = ({ activity, isFirst, isLast, onLightbox }) => {
  const [expanded, setExpanded] = useState(true)

  const images = activity.images_url ?? []
  const videos = activity.videos_url ?? []
  const hasMedia = images.length > 0 || videos.length > 0
  const longDesc = (activity.description?.length ?? 0) > DESCRIPTION_CLAMP
  /** Collapsed state hides media and may clamp text; toggle when either applies. */
  const needsToggle = longDesc || hasMedia

  return (
    // Fragment wraps the timeline row + the flush-left show more/less button.
    <>
      <Flex gap={0} align="stretch">
        {/* ── Spine column — dot + dashed blue vertical line ── */}
        <Box
          w={SPINE_W}
          flexShrink={0}
          display="flex"
          flexDirection="column"
          alignItems="center"
        >
          {/* Incoming segment: connects from previous entry's dot to this dot */}
          <Box
            w="2px"
            h={DOT_OFFSET_H}
            flexShrink={0}
            style={{
              borderLeft: isFirst ? "none" : "2px dashed #93c5fd",
            }}
          />

          {/* Dot */}
          <Box
            w="12px"
            h="12px"
            borderRadius="full"
            bg="blue.400"
            border="2px solid white"
            flexShrink={0}
            style={{ boxShadow: "0 0 0 2px #93c5fd" }}
          />

          {/* Outgoing segment: fills remaining height, connects down to next entry */}
          <Box
            flex={1}
            w="2px"
            mt="2px"
            style={{
              borderLeft: isLast ? "none" : "2px dashed #93c5fd",
            }}
          />
        </Box>

        {/* ── Content column ── */}
        <Box
          flex={1}
          minW={0}
          pl={3}
          pb={isLast ? 0 : 6}
          display="flex"
          flexDirection="column"
          alignItems="flex-start"
        >
          {/* Date label — inline with the dot (same vertical band as DOT_OFFSET_H) */}
          <Box h={DOT_OFFSET_H} display="flex" alignItems="center" mb={1}>
            <DateTooltip dateStr={activity.created_at} />
          </Box>

          {activity.title && (
            <Text className="text-gray-700 text-sm font-semibold mb-1 leading-snug">
              {activity.title}
            </Text>
          )}

          {activity.description && (
            <Text
              className="text-gray-700 text-sm leading-relaxed"
              style={
                !expanded && longDesc
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
          )}

          {/* Images: 3-column grid. Videos: full-width rows below. Hidden while collapsed. */}
          {hasMedia && expanded && (
            <Box w="100%" mt={3}>
              {images.length > 0 && (
                <Box
                  display="grid"
                  gridTemplateColumns="repeat(3, minmax(0, 1fr))"
                  gap={2}
                  w="100%"
                >
                  {images.map((url, i) => (
                    <Box
                      key={`img-${i}`}
                      position="relative"
                      w="100%"
                      minW={0}
                      aspectRatio={THUMB_ASPECT}
                      borderRadius="md"
                      overflow="hidden"
                      cursor="zoom-in"
                      onClick={() => onLightbox(url)}
                    >
                      <Image
                        src={url}
                        alt={`Update image ${i + 1}`}
                        fill
                        sizes="(max-width: 768px) 33vw, 200px"
                        className="object-cover"
                        unoptimized
                      />
                    </Box>
                  ))}
                </Box>
              )}
              {videos.length > 0 && (
                <Flex
                  direction="column"
                  gap={2}
                  w="100%"
                  mt={images.length > 0 ? 2 : 0}
                >
                  {videos.map((url, i) => (
                    <Box
                      key={`vid-${i}`}
                      w="100%"
                      minW={0}
                      aspectRatio={VIDEO_ROW_ASPECT}
                      borderRadius="md"
                      overflow="hidden"
                      bg="blackAlpha.100"
                    >
                      <video
                        src={url}
                        controls
                        preload="metadata"
                        className="h-full w-full rounded-md object-contain"
                        onError={(e) => { e.currentTarget.style.display = "none" }}
                      />
                    </Box>
                  ))}
                </Flex>
              )}
            </Box>
          )}
        </Box>
      </Flex>

      {/* Show more/less sits BELOW the timeline row, flush with the card's left edge */}
      {needsToggle && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={SHOW_MORE_CLASS}
        >
          {expanded ? "Show less" : "Show more"}
          <span aria-hidden>{expanded ? "▲" : "▼"}</span>
        </button>
      )}
    </>
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
            isFirst={i === 0}
            isLast={i === visible.length - 1}
            onLightbox={setLightboxSrc}
          />
        ))}
      </Box>

      {hasMore && (
        <button
          onClick={() => setListExpanded((v) => !v)}
          className={SHOW_MORE_CLASS}
        >
          {listExpanded
            ? "Show less"
            : `Show ${hiddenCount} more update${hiddenCount === 1 ? "" : "s"}`}
          <span aria-hidden>{listExpanded ? "▲" : "▼"}</span>
        </button>
      )}
    </>
  )
}

export default BeneficiaryActivity

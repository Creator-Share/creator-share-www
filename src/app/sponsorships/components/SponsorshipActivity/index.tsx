"use client"
import React, { useState, useCallback } from "react"
import Image from "next/image"
import { Box, Text, Flex, Spinner } from "@chakra-ui/react"
import { Activity } from "@/types"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { createClient } from "@/utils/supabase/client"
import { FaChevronDown, FaChevronUp } from "react-icons/fa6"

/** Format as relative time with absolute fallback on hover. */
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

interface MediaItem {
  id: string
  url: string
  type: "image" | "video"
}

interface ActivityCardProps {
  activity: Activity
}

const ActivityCard: React.FC<ActivityCardProps> = ({ activity }) => {
  const [expanded, setExpanded] = useState(false)
  const [media, setMedia] = useState<MediaItem[]>([])
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaLoaded, setMediaLoaded] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const imageIds = activity.metadata?.media?.images || []
  const videoIds = activity.metadata?.media?.videos || []
  const hasMedia = imageIds.length > 0 || videoIds.length > 0

  const loadMedia = useCallback(async () => {
    if (mediaLoaded || (!imageIds.length && !videoIds.length)) return
    setMediaLoading(true)
    try {
      const supabase = createClient()
      const allIds = [...imageIds, ...videoIds]
      const { data, error } = await supabase
        .from("media")
        .select("*")
        .in("id", allIds)

      if (error || !data) return

      const items: MediaItem[] = []
      for (const row of data) {
        try {
          const url = generatePublicUrl(row as MediaRow)
          items.push({
            id: row.id,
            url,
            type: row.type === "VIDEO" ? "video" : "image",
          })
        } catch {
          // skip unresolvable media
        }
      }
      setMedia(items)
      setMediaLoaded(true)
    } finally {
      setMediaLoading(false)
    }
  }, [imageIds, videoIds, mediaLoaded])

  const toggle = () => {
    if (!expanded && !mediaLoaded) loadMedia()
    setExpanded((v) => !v)
  }

  const images = media.filter((m) => m.type === "image")
  const videos = media.filter((m) => m.type === "video")

  // For the collapsed state, show a video thumbnail if there are videos but no images
  const firstVideoId = !imageIds.length && videoIds.length ? videoIds[0] : null

  return (
    <>
      {/* Lightbox overlay */}
      {lightboxSrc && (
        <Box
          position="fixed"
          inset={0}
          zIndex={9999}
          bg="blackAlpha.900"
          display="flex"
          alignItems="center"
          justifyContent="center"
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

      <Box
        borderWidth="1px"
        borderRadius="xl"
        overflow="hidden"
        mb={3}
        bg="white"
        className="transition-shadow duration-200 hover:shadow-md"
      >
        {/* Collapsed header -- always visible */}
        <Flex
          align="center"
          justify="space-between"
          p={4}
          cursor="pointer"
          onClick={toggle}
          _hover={{ bg: "gray.50" }}
        >
          <Box flex="1" pr={4} minW={0}>
            {activity.title && (
              <Text fontWeight="semibold" fontSize="sm" color="gray.800" mb={0.5}>
                {activity.title}
              </Text>
            )}
            <Text
              fontSize="sm"
              color="gray.600"
              style={
                expanded
                  ? undefined
                  : {
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }
              }
            >
              {activity.description}
            </Text>

            {/* Collapsed video thumbnail when no images */}
            {!expanded && firstVideoId && !mediaLoaded && (
              <Box mt={2} borderRadius="md" overflow="hidden" maxW="120px" h="68px" bg="gray.100" position="relative">
                <Text fontSize="xs" color="gray.400" position="absolute" inset={0} display="flex" alignItems="center" justifyContent="center">
                  ▶ Video
                </Text>
              </Box>
            )}

            <Text
              fontSize="xs"
              color="gray.400"
              mt={1}
              title={formatAbsoluteTime(activity.created_at)}
              style={{ cursor: "default" }}
            >
              {formatRelativeTime(activity.created_at)}
            </Text>
          </Box>

          <Box color="gray.400" flexShrink={0}>
            {expanded ? <FaChevronUp size={12} /> : <FaChevronDown size={12} />}
          </Box>
        </Flex>

        {/* Expanded content */}
        {expanded && (
          <Box px={4} pb={4} borderTopWidth="1px" borderColor="gray.100">
            {mediaLoading && (
              <Flex justify="center" py={4}>
                <Spinner size="sm" color="gray.400" />
              </Flex>
            )}

            {!mediaLoading && images.length > 0 && (
              <Flex gap={2} flexWrap="wrap" mt={3}>
                {images.map((img) => (
                  <Box
                    key={img.id}
                    position="relative"
                    w="120px"
                    h="90px"
                    borderRadius="md"
                    overflow="hidden"
                    cursor="zoom-in"
                    flexShrink={0}
                    onClick={() => setLightboxSrc(img.url)}
                  >
                    <Image
                      src={img.url}
                      alt="Activity image"
                      fill
                      sizes="120px"
                      className="object-cover"
                      unoptimized
                    />
                  </Box>
                ))}
              </Flex>
            )}

            {!mediaLoading && videos.length > 0 && (
              <Flex direction="column" gap={2} mt={3}>
                {videos.map((vid) => (
                  <video
                    key={vid.id}
                    src={vid.url}
                    controls
                    preload="metadata"
                    className="rounded-lg max-w-full max-h-64 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = "none"
                    }}
                  />
                ))}
              </Flex>
            )}

            {!mediaLoading && hasMedia && media.length === 0 && (
              <Text fontSize="xs" color="gray.400" mt={3}>
                Media unavailable
              </Text>
            )}
          </Box>
        )}
      </Box>
    </>
  )
}

interface BeneficiaryActivityProps {
  activities: Activity[]
}

const BeneficiaryActivity: React.FC<BeneficiaryActivityProps> = ({ activities }) => {
  if (activities.length === 0) return null

  return (
    <Box>
      {activities.map((activity) => (
        <ActivityCard key={activity.id} activity={activity} />
      ))}
    </Box>
  )
}

export default BeneficiaryActivity

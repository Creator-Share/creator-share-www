import React, { useEffect, useState } from "react"
import Image from "next/image"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import { Box, Text, Flex, Badge } from "@chakra-ui/react"
import { Activity } from "@/types"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { createClient } from "@/utils/supabase/client"

interface ActivityDetailsModalProps {
  open: boolean
  onClose: () => void
  activity: Activity | null
}

const ActivityDetailsModal: React.FC<ActivityDetailsModalProps> = ({
  open,
  onClose,
  activity,
}) => {
  const [images, setImages] = useState<Array<{ id: string; image_url: string }>>([])
  const [videos, setVideos] = useState<Array<{ id: string; image_url: string }>>([])
  const [loading, setLoading] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const loadMedia = async () => {
      if (!activity || !open) return
      
      setLoading(true)
      
      try {
        // Get image media IDs from activity metadata
        const imageIds = activity.metadata?.media?.images || []
        const videoIds = activity.metadata?.media?.videos || []
        
        // Fetch media records for images
        const imageMedia: Array<{ id: string; image_url: string }> = []
        if (imageIds.length > 0) {
          const { data: imageRecords, error: imageError } = await supabase
            .from('media')
            .select('*')
            .in('id', imageIds)
          
          if (!imageError && imageRecords) {
            for (const mediaRecord of imageRecords) {
              try {
                const url = generatePublicUrl(mediaRecord as MediaRow)
                imageMedia.push({
                  id: mediaRecord.id,
                  image_url: url
                })
              } catch (error) {
                console.error('Error generating image URL for', mediaRecord.id, ':', error)
              }
            }
          }
        }
        
        // Fetch media records for videos
        const videoMedia: Array<{ id: string; image_url: string }> = []
        if (videoIds.length > 0) {
          const { data: videoRecords, error: videoError } = await supabase
            .from('media')
            .select('*')
            .in('id', videoIds)
          
          if (!videoError && videoRecords) {
            for (const mediaRecord of videoRecords) {
              try {
                const url = generatePublicUrl(mediaRecord as MediaRow)
                videoMedia.push({
                  id: mediaRecord.id,
                  image_url: url
                })
              } catch (error) {
                console.error('Error generating video URL for', mediaRecord.id, ':', error)
              }
            }
          }
        }
        
        setImages(imageMedia)
        setVideos(videoMedia)
      } catch (error) {
        console.error('Error loading media:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadMedia()
  }, [activity, open, supabase])

  if (!activity) return null

  const getActivitySourceBadge = (source: string) => {
    switch (source) {
      case 'admin':
        return <Badge colorScheme="blue">Admin</Badge>
      case 'sponsorship':
        return <Badge colorScheme="green">Sponsorship</Badge>
      case 'system':
        return <Badge colorScheme="gray">System</Badge>
      default:
        return <Badge colorScheme="gray">{source}</Badge>
    }
  }

  const getActivityTypeBadge = (type: string) => {
    switch (type) {
      case 'INFO':
        return <Badge colorScheme="blue" variant="subtle">INFO</Badge>
      case 'UPDATE':
        return <Badge colorScheme="orange" variant="subtle">UPDATE</Badge>
      case 'SUBSCRIPTION':
        return <Badge colorScheme="green" variant="subtle">SUBSCRIPTION</Badge>
      default:
        return <Badge colorScheme="gray" variant="subtle">{type}</Badge>
    }
  }


  return (
    <DialogRoot open={open} onOpenChange={(details) => {
      if (!details.open) onClose()
    }}>
      <DialogContent className="max-w-[600px] w-full relative rounded-2xl">
        <DialogHeader className="flex justify-between items-center p-6 pb-2">
          <Text className="text-xl font-bold text-gray-800">
            Activity Details
          </Text>
          <DialogCloseTrigger>
            <Box className="text-lg font-semibold cursor-pointer border-2 border-[#000000] rounded-full px-2">
              ×
            </Box>
          </DialogCloseTrigger>
        </DialogHeader>
        <DialogBody className="p-6">
          <Box className="space-y-4">
            {/* Activity Type and Source */}
            <Flex gap={2} align="center">
              {getActivityTypeBadge(activity.activity_type)}
              {getActivitySourceBadge(activity.activity_source)}
              <Text fontSize="sm" color="gray.500">
                Created by {activity.created_by}
              </Text>
            </Flex>

            {/* Title */}
            {activity.title && (
              <Box>
                <Text className="text-lg font-semibold mb-2">
                  {activity.title}
                </Text>
              </Box>
            )}

            {/* Description */}
            <Box>
              <Text className="text-gray-700">
                {activity.description}
              </Text>
            </Box>

                    {/* Images */}
                    {(activity.metadata?.media?.images?.length || 0) > 0 && (
                      <Box>
                        <Text className="font-medium mb-2">Images</Text>
                        {loading ? (
                          <Box className="text-center py-4">
                            <Text fontSize="sm" color="gray.500">Loading images...</Text>
                          </Box>
                        ) : images.length > 0 ? (
                          <Box className="space-y-2">
                            {images.map((image, index) => (
                              <Box key={index} position="relative" width="100%" height="256px" bg="gray.100">
                                {image.image_url ? (
                                  <Image
                                    src={image.image_url}
                                    alt={`Activity image ${index + 1}`}
                                    fill
                                    className="rounded-lg object-contain"
                                    sizes="(max-width: 600px) 100vw, 600px"
                                    unoptimized
                                    onError={() => {
                                      console.error('Image failed to load:', image.image_url)
                                    }}
                                  />
                                ) : (
                                  <Box 
                                    className="rounded-lg border-2 border-dashed border-gray-300 p-4 text-center text-gray-500 flex items-center justify-center"
                                    position="absolute"
                                    top={0}
                                    left={0}
                                    width="100%"
                                    height="100%"
                                  >
                                    <Text fontSize="sm">Image {index + 1} - URL not available</Text>
                                  </Box>
                                )}
                              </Box>
                            ))}
                          </Box>
                        ) : (
                          <Box 
                            className="rounded-lg border-2 border-dashed border-gray-300 p-4 text-center text-gray-500"
                            minH="100px"
                          >
                            <Text fontSize="sm">No images available</Text>
                          </Box>
                        )}
                      </Box>
                    )}

                    {/* Videos */}
                    {(activity.metadata?.media?.videos?.length || 0) > 0 && (
                      <Box>
                        <Text className="font-medium mb-2">Videos</Text>
                        {loading ? (
                          <Box className="text-center py-4">
                            <Text fontSize="sm" color="gray.500">Loading videos...</Text>
                          </Box>
                        ) : videos.length > 0 ? (
                          <Box className="space-y-2">
                            {videos.map((video, index) => (
                              <Box key={index}>
                                {video.image_url ? (
                                  <video
                                    className="rounded-lg max-w-full h-auto max-h-80 object-contain"
                                    src={video.image_url}
                                    controls
                                    preload="metadata"
                                    onError={(e) => {
                                      console.error('Video failed to load:', video.image_url)
                                      e.currentTarget.style.display = 'none'
                                    }}
                                  />
                                ) : (
                                  <Box 
                                    className="rounded-lg border-2 border-dashed border-gray-300 p-4 text-center text-gray-500"
                                    minH="100px"
                                  >
                                    <Text fontSize="sm">Video {index + 1} - URL not available</Text>
                                  </Box>
                                )}
                              </Box>
                            ))}
                          </Box>
                        ) : (
                          <Box 
                            className="rounded-lg border-2 border-dashed border-gray-300 p-4 text-center text-gray-500"
                            minH="100px"
                          >
                            <Text fontSize="sm">No videos available</Text>
                          </Box>
                        )}
                      </Box>
                    )}

            {/* Created Date */}
            <Box className="pt-4 border-t">
              <Text fontSize="sm" color="gray.500">
                Created: {new Date(activity.created_at).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </Text>
            </Box>
          </Box>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

export default ActivityDetailsModal

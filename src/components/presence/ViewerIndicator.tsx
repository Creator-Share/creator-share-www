"use client"

import React from "react"
import { Box, Text, Flex } from "@chakra-ui/react"
import { usePresence } from "@/hooks/usePresence"
import { keyframes } from "@emotion/react"

interface ViewerIndicatorProps {
  profileId: string
  variant?: "minimal" | "badge" | "detailed"
  showWhenZero?: boolean
  popularThreshold?: number
}

// Pulse animation for the indicator
const pulse = keyframes`
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
`

const ViewerIndicator: React.FC<ViewerIndicatorProps> = ({
  profileId,
  variant = "badge",
  showWhenZero = false,
  popularThreshold = 10,
}) => {
  const { getViewerCount } = usePresence()
  const viewerCount = getViewerCount(profileId)

  // Don't show if zero viewers and showWhenZero is false
  if (!showWhenZero && viewerCount.unique === 0) {
    return null
  }

  const isPopular = viewerCount.unique >= popularThreshold

  // Minimal variant - just an eye icon and number
  if (variant === "minimal") {
    return (
      <Flex
        align="center"
        gap={1}
        fontSize="xs"
        color="gray.600"
        bg="white"
        px={2}
        py={1}
        borderRadius="md"
        boxShadow="sm"
      >
        <Box
          as="span"
          animation={viewerCount.unique > 0 ? `${pulse} 2s ease-in-out infinite` : undefined}
        >
          👁️
        </Box>
        <Text fontWeight="medium">{viewerCount.unique}</Text>
      </Flex>
    )
  }

  // Badge variant - eye icon, number, and "viewing" text
  if (variant === "badge") {
    return (
      <Flex
        align="center"
        gap={1.5}
        fontSize="sm"
        color="gray.700"
        bg="white"
        px={3}
        py={1.5}
        borderRadius="full"
        boxShadow="md"
        border="1px solid"
        borderColor="gray.200"
      >
        <Box
          as="span"
          fontSize="md"
          animation={viewerCount.unique > 0 ? `${pulse} 2s ease-in-out infinite` : undefined}
        >
          👁️
        </Box>
        <Text fontWeight="semibold">{viewerCount.unique}</Text>
        <Text color="gray.500" fontSize="xs">
          {viewerCount.unique === 1 ? "viewer" : "viewers"}
        </Text>
        {isPopular && (
          <Box
            as="span"
            fontSize="sm"
            ml={0.5}
            animation={`${pulse} 1.5s ease-in-out infinite`}
          >
            🔥
          </Box>
        )}
      </Flex>
    )
  }

  // Detailed variant - full info with popular badge
  if (variant === "detailed") {
    return (
      <Box
        bg="white"
        p={3}
        borderRadius="lg"
        boxShadow="md"
        border="1px solid"
        borderColor="gray.200"
        minW="140px"
      >
        <Flex direction="column" gap={1}>
          <Flex align="center" gap={2}>
            <Box
              as="span"
              fontSize="lg"
              animation={viewerCount.unique > 0 ? `${pulse} 2s ease-in-out infinite` : undefined}
            >
              👁️
            </Box>
            <Text fontWeight="bold" fontSize="lg" color="gray.800">
              {viewerCount.unique}
            </Text>
            <Text fontSize="sm" color="gray.600">
              {viewerCount.unique === 1 ? "viewer" : "viewers"}
            </Text>
          </Flex>
          
          {isPopular && (
            <Flex
              align="center"
              gap={1}
              mt={1}
              px={2}
              py={0.5}
              bg="orange.50"
              borderRadius="md"
              border="1px solid"
              borderColor="orange.200"
            >
              <Box
                as="span"
                fontSize="sm"
                animation={`${pulse} 1.5s ease-in-out infinite`}
              >
                🔥
              </Box>
              <Text fontSize="xs" fontWeight="semibold" color="orange.700">
                Popular now
              </Text>
            </Flex>
          )}
          
          {viewerCount.total > viewerCount.unique && (
            <Text fontSize="xs" color="gray.500" mt={0.5}>
              ({viewerCount.total} tabs open)
            </Text>
          )}
        </Flex>
      </Box>
    )
  }

  return null
}

export default ViewerIndicator

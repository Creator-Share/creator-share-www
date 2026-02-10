"use client"
import { Box, Container, Flex, Text, Spinner } from "@chakra-ui/react"
import { useEffect, useState } from "react"

interface StatsData {
  childrenInNeed: number
  childrenSupported: number
}

export function StatsSection() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/stats")
        if (!response.ok) {
          throw new Error("Failed to fetch stats")
        }
        const data = await response.json()
        setStats(data)
      } catch (err) {
        console.error("Error fetching stats:", err)
        setError("Failed to load statistics")
      } finally {
        setIsLoading(false)
      }
    }

    fetchStats()
  }, [])

  if (error) {
    return null // Silently fail - don't show the section if there's an error
  }

  return (
    <Box py={{ base: 6, md: 8 }}>
      <Container maxW="container.xl">
        <Flex
          direction={{ base: "column", md: "row" }}
          gap={{ base: 4, md: 6 }}
          justify="center"
          align="center"
        >
          {/* Stat Card 1: Children Under Care */}
          <Flex
            direction="row"
            align="center"
            gap={3}
            bg="white"
            px={{ base: 8, md: 10 }}
            py={{ base: 5, md: 6 }}
            borderRadius="2xl"
            boxShadow="sm"
            minW={{ base: "280px", md: "300px" }}
          >
            {isLoading ? (
              <Spinner size="lg" color="gray.400" mx="auto" />
            ) : (
              <>
                <Text fontSize={{ base: "3xl", md: "4xl" }}>💛</Text>
                <Flex direction="column">
                  <Text
                    fontSize={{ base: "3xl", md: "4xl" }}
                    fontWeight="bold"
                    color="gray.800"
                    lineHeight="1"
                  >
                    {stats?.childrenInNeed.toLocaleString() || 0}
                  </Text>
                  <Text
                    mt={1}
                    fontSize={{ base: "sm", md: "md" }}
                    color="gray.700"
                    fontWeight="medium"
                  >
                    Children In Need
                  </Text>
                </Flex>
              </>
            )}
          </Flex>

          {/* Stat Card 2: Actively Sponsored */}
          <Flex
            direction="row"
            align="center"
            gap={3}
            bg="white"
            px={{ base: 8, md: 10 }}
            py={{ base: 5, md: 6 }}
            borderRadius="2xl"
            boxShadow="sm"
            minW={{ base: "280px", md: "300px" }}
          >
            {isLoading ? (
              <Spinner size="lg" color="gray.400" mx="auto" />
            ) : (
              <>
                <Text fontSize={{ base: "3xl", md: "4xl" }}>💚</Text>
                <Flex direction="column">
                  <Text
                    fontSize={{ base: "3xl", md: "4xl" }}
                    fontWeight="bold"
                    color="gray.800"
                    lineHeight="1"
                  >
                    {stats?.childrenSupported.toLocaleString() || 0}
                  </Text>
                  <Text
                    mt={1}
                    fontSize={{ base: "sm", md: "md" }}
                    color="gray.700"
                    fontWeight="medium"
                  >
                    Children Supported
                  </Text>
                </Flex>
              </>
            )}
          </Flex>
        </Flex>
      </Container>
    </Box>
  )
}

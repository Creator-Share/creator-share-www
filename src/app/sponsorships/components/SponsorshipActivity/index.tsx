import React, { useEffect, useState } from "react"
import { Box, Text, Flex, Spinner } from "@chakra-ui/react"
import { fetchActivitiesByBeneficiaryId } from "@/actions"
import { Activity } from "@/types"

import Link from "next/link"

const BeneficiaryActivity = ({
  beneficiaryId,
  username,
}: {
  beneficiaryId: string | undefined
  username: string
}) => {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadActivities = async () => {
      if (!beneficiaryId) {
        setLoading(false)
        return
      }
      const data = await fetchActivitiesByBeneficiaryId(beneficiaryId)
      setActivities(data)
      setLoading(false)
    }

    loadActivities()
  }, [beneficiaryId])

  return (
    <Box
      className="md:min-h-[443px] md:max-h-[443px]"
      borderWidth="1px"
      borderRadius="md"
      p={4}
      boxShadow="md"
      overflowY="auto"
    >
      <Text fontSize="lg" fontWeight="bold" mb={4}>
        Activities
      </Text>
      {loading ? (
        <Flex justify="center" align="center">
          <Spinner />
        </Flex>
      ) : activities.length === 0 ? (
        <Text color="gray.500">No activities yet...</Text>
      ) : (
        activities.map((activity) => (
          <Link
            key={activity.id}
            href={`/sponsorships/${username}/activity/${activity.id}`}
            style={{ textDecoration: "none" }}
          >
            <Box
              mb={2}
              p={2}
              borderWidth="1px"
              borderRadius="md"
              _hover={{ bg: "gray.50", cursor: "pointer" }}
            >
              <Text>{activity.description}</Text>
              <Text fontSize="sm" color="gray.400">
                {new Date(activity.created_at).toLocaleString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                })}
              </Text>
            </Box>
          </Link>
        ))
      )}
    </Box>
  )
}

export default BeneficiaryActivity

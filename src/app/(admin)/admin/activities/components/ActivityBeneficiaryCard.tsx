"use client"

import { Box, Button, Text, Badge, Flex, Skeleton } from "@chakra-ui/react"
import Image from "next/image"
import Link from "next/link"
import { BeneficiaryWithActivity } from "@/types/admin.types"
import { getActivityStatus, formatLastActivityDate } from "../utils"
import { ACTIVITY_STATUS_CONFIG } from "../constants"

interface ActivityBeneficiaryCardProps {
  beneficiary: BeneficiaryWithActivity
  onCreateActivity: (id: string, name: string) => void
  beneficiaryImage: string | null
  loadingImage: boolean
}

export default function ActivityBeneficiaryCard({
  beneficiary,
  onCreateActivity,
  beneficiaryImage,
  loadingImage,
}: ActivityBeneficiaryCardProps) {
  const hasActivity = beneficiary.last_activity_date !== null
  const activityStatus = getActivityStatus(
    beneficiary.days_since_last_activity ?? 0,
    hasActivity
  )
  const statusConfig = ACTIVITY_STATUS_CONFIG[activityStatus]

  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      borderColor="gray.200"
      p={4}
      bg="white"
      _hover={{ shadow: "md" }}
      transition="all 0.2s"
    >
      <Flex gap={4} mb={4}>
        {/* Photo */}
        <Box
          width="80px"
          height="80px"
          borderRadius="md"
          overflow="hidden"
          flexShrink={0}
          bg="gray.100"
          position="relative"
        >
          {loadingImage ? (
            <Skeleton width="100%" height="100%" />
          ) : beneficiaryImage ? (
            <Image
              src={beneficiaryImage}
              alt={beneficiary.name}
              fill
              style={{ objectFit: "cover" }}
              sizes="80px"
            />
          ) : (
            <Flex
              align="center"
              justify="center"
              height="100%"
              bg="gray.200"
              color="gray.500"
              fontSize="sm"
            >
              No Image
            </Flex>
          )}
        </Box>

        {/* Name, Username, Badge */}
        <Flex direction="column" justify="center" flex={1}>
          <Text fontWeight="bold" fontSize="lg" mb={1}>
            {beneficiary.name}
          </Text>
          <Text fontSize="sm" color="gray.600" mb={2}>
            @{beneficiary.username}
          </Text>
          <Badge
            bg={statusConfig.bgColor}
            color={statusConfig.color}
            borderWidth="1px"
            borderColor={statusConfig.borderColor}
            width="fit-content"
            fontSize="xs"
          >
            {statusConfig.emoji}{" "}
            {hasActivity
              ? `${beneficiary.days_since_last_activity} days`
              : statusConfig.label}
          </Badge>
        </Flex>
      </Flex>

      {/* Last Activity Date */}
      <Text fontSize="sm" color="gray.600" mb={4}>
        {formatLastActivityDate(beneficiary.last_activity_date)}
      </Text>

      {/* Buttons */}
      <Flex direction="column" gap={2}>
        <Button
          colorScheme="blue"
          width="100%"
          onClick={() =>
            onCreateActivity(beneficiary.id || "", beneficiary.name)
          }
        >
          Add Activity
        </Button>
        <Link href={`/admin/beneficiary/${beneficiary.id}`} passHref>
          <Button variant="outline" colorScheme="gray" width="100%">
            View Details →
          </Button>
        </Link>
      </Flex>
    </Box>
  )
}

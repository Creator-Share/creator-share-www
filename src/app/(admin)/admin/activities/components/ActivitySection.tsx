"use client"
import { useEffect, useState } from "react"
import { Box, Text, Button, Flex, Badge } from "@chakra-ui/react"
import { FaChevronDown, FaChevronUp } from "react-icons/fa"
import type { BeneficiaryWithActivity } from "@/types/admin.types"
import { ACTIVITY_STATUS_CONFIG, type ActivityStatus } from "../constants"
import ActivityBeneficiaryCard from "./ActivityBeneficiaryCard"

interface ActivitySectionProps {
  status: ActivityStatus
  beneficiaries: BeneficiaryWithActivity[]
  onCreateActivity: (id: string, name: string) => void
  beneficiaryImages: Record<string, string>
  loadingImages: Record<string, boolean>
  defaultCollapsed?: boolean
  /** When true, force the section open regardless of its collapsed state (e.g. during search) */
  forceExpanded?: boolean
}

export function ActivitySection({
  status,
  beneficiaries,
  onCreateActivity,
  beneficiaryImages,
  loadingImages,
  defaultCollapsed = false,
  forceExpanded = false,
}: ActivitySectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  // When a search becomes active, expand the section so results are visible.
  // When the search is cleared, revert to defaultCollapsed.
  useEffect(() => {
    if (forceExpanded) {
      setCollapsed(false)
    } else {
      setCollapsed(defaultCollapsed)
    }
  }, [forceExpanded, defaultCollapsed])

  // Don't render empty sections
  if (beneficiaries.length === 0) {
    return null
  }

  const config = ACTIVITY_STATUS_CONFIG[status]

  return (
    <Box className="mb-6">
      <Flex
        align="center"
        justify="space-between"
        mb={4}
        pb={2}
        borderBottom="2px solid"
        borderColor="gray.200"
      >
        <Flex align="center" gap={3}>
          <Text fontSize="xl" fontWeight="bold">
            {config.emoji} {config.label}
          </Text>
          <Badge
            bg={config.bgColor}
            color={config.color}
            fontSize="md"
            px={2}
            py={1}
          >
            {beneficiaries.length}
          </Badge>
        </Flex>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? "Expand" : "Collapse"}
          <Box ml={2}>
            {collapsed ? <FaChevronDown /> : <FaChevronUp />}
          </Box>
        </Button>
      </Flex>

      {!collapsed && (
        <Box
          display="grid"
          gridTemplateColumns={{
            base: "1fr",
            sm: "repeat(2, 1fr)",
            lg: "repeat(3, 1fr)",
            xl: "repeat(4, 1fr)",
          }}
          gap={4}
        >
          {beneficiaries.map((beneficiary) => (
            <ActivityBeneficiaryCard
              key={beneficiary.id}
              beneficiary={beneficiary}
              onCreateActivity={onCreateActivity}
              beneficiaryImage={beneficiaryImages[beneficiary.id || ""] || null}
              loadingImage={loadingImages[beneficiary.id || ""] || false}
            />
          ))}
        </Box>
      )}
    </Box>
  )
}

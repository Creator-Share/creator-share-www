"use client"

import React from "react"
import { Flex, Button } from "@chakra-ui/react"
import {
  ALL_BENEFICIARY_TABS,
  BeneficiaryTabType,
  BeneficiaryTypeConfig,
  TYPE_TO_ROUTE,
  ROUTE_TO_TYPE,
  getDefaultBudgetGoal,
  isOpenSponsorshipType,
  MINIMUM_OPEN_SPONSORSHIP_CENTS,
  getApiTypes,
  getMaxAgeYears,
} from "@/config/beneficiaryTypes"

// Re-export everything so existing imports from this module continue to work.
export type { BeneficiaryTabType, BeneficiaryTypeConfig }
export {
  ALL_BENEFICIARY_TABS,
  TYPE_TO_ROUTE,
  ROUTE_TO_TYPE,
  getDefaultBudgetGoal,
  isOpenSponsorshipType,
  MINIMUM_OPEN_SPONSORSHIP_CENTS,
  getApiTypes,
  getMaxAgeYears,
}

// Backward-compat alias: older code imported BeneficiaryTypeTab from here.
export type BeneficiaryTypeTab = BeneficiaryTypeConfig

interface BeneficiaryTypeNavProps {
  /** Currently active tab type — null means "All" */
  activeType: BeneficiaryTabType | null
  onChange: (type: BeneficiaryTabType | null) => void
  tabs?: BeneficiaryTypeConfig[]
  /**
   * When true, show types that are not yet publicly visible (e.g. ANIMAL).
   * Admins need to manage those records even before launch.
   */
  isAdminMode?: boolean
  className?: string
}

const BeneficiaryTypeNav: React.FC<BeneficiaryTypeNavProps> = ({
  activeType,
  onChange,
  tabs = ALL_BENEFICIARY_TABS,
  isAdminMode = false,
  className,
}) => {
  const visibleTabs = tabs.filter(
    (tab) => !tab.isLegacyAlias && (isAdminMode || tab.isPubliclyVisible),
  )

  return (
    <Flex
      bg="gray.100"
      borderRadius="16px"
      p="3px"
      display="inline-flex"
      className={className}
      mb={4}
      gap={4}
    >
      {visibleTabs.map((tab) => {
        const isActive = activeType === tab.type
        return (
          <Button
            key={tab.type ?? "all"}
            flex={1}
            size="md"
            borderRadius="13px"
            bg={isActive ? "white" : "transparent"}
            color={isActive ? "#2b7ff9" : "gray.500"}
            fontWeight={isActive ? "semibold" : "medium"}
            boxShadow={isActive ? "sm" : "none"}
            onClick={() => onChange(tab.type)}
            _hover={{ bg: isActive ? "white" : "gray.200" }}
            transition="all 0.15s"
            px={5}
            py={2}
          >
            {tab.label}
          </Button>
        )
      })}
    </Flex>
  )
}

export default BeneficiaryTypeNav

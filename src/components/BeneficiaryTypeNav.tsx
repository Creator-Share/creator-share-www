
"use client"

import React from "react"
import { Flex, Button } from "@chakra-ui/react"

export type BeneficiaryTabType = "CHILD" | "CHILD_LABORER" | "SPECIAL_NEEDS" | "ANIMAL"

export interface BeneficiaryTypeTab {
  label: string
  type: BeneficiaryTabType | null
  /**
   * Default sponsorship amount in cents when this type has no fixed budget_goal.
   * Used as the pre-filled amount on the sponsorship/payment form.
   * null = free-form (user chooses any amount)
   */
  defaultSponsorshipAmountCents: number | null
  /**
   * When true this entry is a legacy DB alias and should not appear as a
   * visible tab in the public-facing navigation (it is still used by admin
   * tooling and `getDefaultSponsorshipAmount` lookups).
   */
  isLegacyAlias?: boolean
}

/** Maps a BeneficiaryTabType to its sharable public URL path. */
export const TYPE_TO_ROUTE: Record<BeneficiaryTabType, string> = {
  CHILD: "/street",          // legacy alias — same route as CHILD_LABORER
  CHILD_LABORER: "/street",
  SPECIAL_NEEDS: "/care",
  ANIMAL: "/dogs",
}

/**
 * Maps a sharable public URL path back to its BeneficiaryTabType.
 * "/" resolves to null (= "All").
 */
export const ROUTE_TO_TYPE: Record<string, BeneficiaryTabType | null> = {
  "/": null,
  "/street": "CHILD_LABORER",
  "/care": "SPECIAL_NEEDS",
  "/dogs": "ANIMAL",
}

/**
 * Read a per-type sponsorship amount from an env variable.
 * Falls back to the provided hardcoded default if the env var is missing/invalid.
 */
function envAmount(envKey: string, fallbackCents: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallbackCents
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackCents
}

export const ALL_BENEFICIARY_TABS: BeneficiaryTypeTab[] = [
  {
    label: "All Opportunities",
    type: null,
    defaultSponsorshipAmountCents: null,
  },
  {
    // Legacy alias — treated the same as CHILD_LABORER.
    // Hidden from the public nav; kept so getDefaultSponsorshipAmount("CHILD") resolves.
    label: "Child Labourers",
    type: "CHILD",
    isLegacyAlias: true,
    defaultSponsorshipAmountCents: envAmount("NEXT_PUBLIC_SPONSORSHIP_AMOUNT_CHILD_LABORER", 3333),
  },
  {
    label: "Child Labourers",
    type: "CHILD_LABORER",
    defaultSponsorshipAmountCents: envAmount("NEXT_PUBLIC_SPONSORSHIP_AMOUNT_CHILD_LABORER", 3333),
  },
  {
    label: "Special Needs",
    type: "SPECIAL_NEEDS",
    defaultSponsorshipAmountCents: envAmount("NEXT_PUBLIC_SPONSORSHIP_AMOUNT_SPECIAL_NEEDS", 5000),
  },
  {
    label: "Rescue Dogs",
    type: "ANIMAL",
    defaultSponsorshipAmountCents: envAmount("NEXT_PUBLIC_SPONSORSHIP_AMOUNT_ANIMAL", 2500),
  },
]

export function getDefaultSponsorshipAmount(
  type: BeneficiaryTabType | string | null | undefined,
): number | null {
  const tab = ALL_BENEFICIARY_TABS.find((t) => t.type === type)
  return tab ? tab.defaultSponsorshipAmountCents : null
}

interface BeneficiaryTypeNavProps {
  /** Currently active tab type — null means "All" */
  activeType: BeneficiaryTabType | null
  onChange: (type: BeneficiaryTabType | null) => void
  tabs?: BeneficiaryTypeTab[]
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
  // In admin mode: show every tab (including legacy aliases, for completeness).
  // In public mode: show all except legacy aliases — "All Opportunities" IS included.
  const visibleTabs = isAdminMode
    ? tabs
    : tabs.filter((tab) => !tab.isLegacyAlias)

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
            color={isActive ? "#0654C6" : "gray.500"}
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
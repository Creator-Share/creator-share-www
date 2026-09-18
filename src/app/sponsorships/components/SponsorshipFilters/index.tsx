"use client"

import React, { useState, useEffect, useRef } from "react"
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Button is referenced only by the currently commented-out All | Sponsored toggle below; keeping the import so the restore is one uncomment.
import { Box, Button, Text, Input, IconButton } from "@chakra-ui/react"
import { Slider } from "@/components/ui/slider"
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Tooltip } from "@/components/ui/tooltip"
import { useFilterStore } from "@/store/filterStore"
import { FiltersProps } from "@/types/propTypes"
import { beneficiaryTypes, genders, status as statusOptions } from "./config"
import { IoClose, IoSearchOutline } from "react-icons/io5"
import type { BeneficiaryTabType } from "@/config/beneficiaryTypes"
import { ALL_STATUSES, PUBLIC_STATUSES } from "@/config/beneficiaryStatuses"

const SponsorshipFilters: React.FC<
  FiltersProps & {
    isAdminMode?: boolean
    isSticky?: boolean
    activeType?: BeneficiaryTabType | null
    onTypeChange?: (type: BeneficiaryTabType | null) => void
    resultCount?: number
    hasMoreResults?: boolean
    /** When true, suppresses own card border/shadow/radius; the parent provides the card frame. */
    noCard?: boolean
  }
> = ({
  onFilterChange,
  beneficiaryType = "CHILD",
  isAdminMode = false,
  isSticky = false,
  activeType,
  onTypeChange,
  resultCount,
  hasMoreResults = false,
  noCard = false,
}) => {
  const {
    selectedGender,
    selectedAgeRange,
    selectedStatus,
    setGender,
    setAgeRange,
    setStatus,
  } = useFilterStore()

  // When activeType prop is provided (main page), derive animal mode from it.
  // Otherwise fall back to the beneficiaryType prop (admin/embed).
  const isAnimal =
    activeType !== undefined
      ? activeType === "ANIMAL"
      : beneficiaryType === "ANIMAL"

  const defaultMaxAge = isAnimal ? 20 : 14
  const [minAge, setMinAge] = useState<number>(selectedAgeRange[0] || 0)
  const [maxAge, setMaxAge] = useState<number>(
    selectedAgeRange[1] || defaultMaxAge,
  )

  const [searchQuery, setSearchQuery] = useState<string>("")
  const [mounted, setMounted] = useState(false)

  const isInternalUpdateRef = useRef(false)
  const ageRangeUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const previousAgeRangeRef = useRef<[number, number]>([minAge, maxAge])
  const sliderDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Initialize admin status filter when in admin mode (only on mount)
  const hasInitializedRef = useRef(false)
  useEffect(() => {
    if (isAdminMode && mounted && !hasInitializedRef.current) {
      const allStatuses = [
        "New",
        "Partially Funded",
        "Budget Fulfilled",
        "Draft",
        "Archived",
        "Sponsorship Cancelled",
      ]
      const hasAllStatuses = allStatuses.every((status) =>
        selectedStatus.includes(status),
      )
      if (!hasAllStatuses && selectedStatus.length === 0) {
        hasInitializedRef.current = true
        setStatus(allStatuses)
        onFilterChange({
          gender: selectedGender,
          ageRange: selectedAgeRange,
          status: allStatuses,
          search: searchQuery,
        })
      } else {
        hasInitializedRef.current = true
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminMode, mounted])

  useEffect(() => {
    if (isInternalUpdateRef.current) {
      if (ageRangeUpdateTimeoutRef.current) {
        clearTimeout(ageRangeUpdateTimeoutRef.current)
      }
      ageRangeUpdateTimeoutRef.current = setTimeout(() => {
        isInternalUpdateRef.current = false
      }, 150)
      return
    }

    const newMin = selectedAgeRange[0] || 0
    const newMax = selectedAgeRange[1] || defaultMaxAge
    const newAgeRange: [number, number] = [newMin, newMax]

    const prevMin = previousAgeRangeRef.current[0]
    const prevMax = previousAgeRangeRef.current[1]

    if (newMin !== prevMin || newMax !== prevMax) {
      setMinAge(newMin)
      setMaxAge(newMax)
      previousAgeRangeRef.current = newAgeRange
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgeRange, defaultMaxAge])

  useEffect(() => {
    return () => {
      if (ageRangeUpdateTimeoutRef.current) {
        clearTimeout(ageRangeUpdateTimeoutRef.current)
      }
      if (sliderDebounceTimeoutRef.current) {
        clearTimeout(sliderDebounceTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    previousAgeRangeRef.current = [minAge, maxAge]
  }, [minAge, maxAge])

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleFilterChange = (updatedFilters: {
    gender?: string
    ageRange?: [number, number]
    status?: string[]
    search?: string
  }) => {
    const newStatus = updatedFilters.status ?? selectedStatus

    const newFilters = {
      gender: updatedFilters.gender ?? selectedGender,
      ageRange: updatedFilters.ageRange ?? selectedAgeRange,
      status: newStatus,
      search: updatedFilters.search ?? searchQuery,
    }

    if (updatedFilters.gender !== undefined) {
      setGender(newFilters.gender)
    }
    if (updatedFilters.ageRange !== undefined) {
      setAgeRange(newFilters.ageRange)
    }
    if (updatedFilters.search !== undefined) {
      setSearchQuery(newFilters.search)
    }
    setStatus(newStatus)

    onFilterChange(newFilters)
  }

  const handleClearFilters = (e: React.MouseEvent) => {
    e.preventDefault()

    const defaultStatus = isAdminMode
      ? [...ALL_STATUSES]
      : [...PUBLIC_STATUSES]

    isInternalUpdateRef.current = true

    setGender("")
    setAgeRange([0, defaultMaxAge])
    setStatus(defaultStatus)
    setMinAge(0)
    setMaxAge(defaultMaxAge)
    if (mounted) {
      setSearchQuery("")
    }
    onFilterChange({
      gender: "",
      ageRange: [0, defaultMaxAge],
      status: defaultStatus,
      search: "",
    })

    if (onTypeChange) {
      onTypeChange(null)
    }
  }

  const hasSearchQuery = mounted && searchQuery.trim().length > 0

  // Mirrors the defaults seeded by SponsorshipsContainer / filterStore:
  // admin mode shows every status, public mode shows the PUBLIC_STATUSES
  // set. Keep these in sync with the store or the dirty-check will
  // report phantom "active filters" on a fresh page load.
  const modeDefaultStatus = isAdminMode
    ? (ALL_STATUSES as readonly string[])
    : (PUBLIC_STATUSES as readonly string[])

  const isGenderDefault = isAnimal || (selectedGender ?? "") === ""
  const isAgeDefault =
    isAnimal ||
    (selectedAgeRange[0] === 0 && selectedAgeRange[1] === defaultMaxAge)
  const isStatusDefault =
    selectedStatus.length === modeDefaultStatus.length &&
    modeDefaultStatus.every((s) => selectedStatus.includes(s))

  const isTypeFiltered = activeType != null

  const isDefaultFilters =
    isGenderDefault && isAgeDefault && isStatusDefault && !hasSearchQuery && !isTypeFiltered

  const activeFilterCount = [
    !isGenderDefault,
    !isAgeDefault,
    !isStatusDefault,
    hasSearchQuery,
    isTypeFiltered,
  ].filter(Boolean).length

  return (
    <>
      <Box
        className={noCard ? undefined : `bg-white border ${isSticky ? "rounded-b-3xl rounded-t-none" : "rounded-3xl"}`}
        pt={{ base: 6, lg: 4 }}
        pb={{ base: 4, lg: 4 }}
        px={{ base: 3, md: 4 }}
        transition={noCard ? undefined : "box-shadow 0.3s ease, border-radius 0.3s ease"}
        style={noCard ? undefined : {
          boxShadow:
            "0 4px 24px -4px rgba(0,0,0,0.08), 0 2px 8px -2px rgba(0,0,0,0.04)",
        }}
      >
        <Box
          display="grid"
          gridTemplateColumns={{
            base: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(3, 1fr)",
            lg: "repeat(auto-fit, minmax(130px, 1fr))",
          }}
          gap={{ base: 2, md: 2, lg: 3 }}
          px={0}
          py={0}
          width="100%"
          alignItems="center"
        >
          {/* Beneficiary Type dropdown — shown whenever onTypeChange is provided.
              On the home page this stays in sync with the hero nav selector.
              In admin mode it is the primary type filter. */}
          {onTypeChange && (
            <Box minW={0}>
              <SelectRoot
                collection={beneficiaryTypes}
                value={activeType ? [activeType] : [""]}
                onValueChange={(details) => {
                  const raw = details.items[0]?.value ?? ""
                  const type = raw === "" ? null : (raw as BeneficiaryTabType)
                  onTypeChange(type)
                }}
                size="xs"
                className="rounded-2xl w-full"
              >
                <SelectTrigger css={{ borderRadius: "16px !important" }}>
                  <SelectValueText placeholder="All Opportunities">
                    {() => {
                      const selected = beneficiaryTypes.items.find(
                        (item) => item.value === (activeType ?? ""),
                      )
                      return selected ? selected.label : "All Opportunities"
                    }}
                  </SelectValueText>
                </SelectTrigger>
                <SelectContent>
                  {beneficiaryTypes.items.map((item) => (
                    <SelectItem item={item} key={item.value || "all"}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </Box>
          )}

          {/* Gender — not applicable for animals */}
          {!isAnimal && (
            <Box minW={0}>
              <SelectRoot
                collection={genders}
                value={selectedGender ? [selectedGender] : [""]}
                onValueChange={(details) => {
                  const value = details.items[0]
                  handleFilterChange({ gender: value?.value || "" })
                }}
                size="xs"
                className="rounded-2xl w-full"
              >
                <SelectTrigger css={{ borderRadius: "16px !important" }}>
                  <SelectValueText placeholder="All Genders">
                    {() => {
                      const selected = genders.items.find(
                        (item) => item.value === selectedGender,
                      )
                      return selected ? selected.label : "All Genders"
                    }}
                  </SelectValueText>
                </SelectTrigger>
                <SelectContent>
                  {genders.items.map((gender) => (
                    <SelectItem item={gender} key={gender.value || "all"}>
                      {gender.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </Box>
          )}

          {/* Age range — hidden for animals */}
          {!isAnimal && (
            <Box minW={0} px={2}>
              <Text
                mb={0}
                fontSize="xs"
                fontWeight="semibold"
                textAlign="center"
                color="gray.600"
              >
                Age: {minAge}–{maxAge} yrs
              </Text>
              <Box mt="-2px">
                <Slider
                  size="sm"
                  value={[minAge, maxAge]}
                  min={0}
                  max={defaultMaxAge}
                  step={1}
                  variant="solid"
                  onValueChange={(details) => {
                    if (details.value && details.value.length >= 2) {
                      const [newMin, origMax] = details.value
                      let newMax = origMax

                      const minDistance = 1
                      if (newMax - newMin < minDistance) {
                        newMax = Math.max(newMin + minDistance, maxAge)
                      }

                      setMinAge(newMin)
                      setMaxAge(newMax)

                      if (sliderDebounceTimeoutRef.current) {
                        clearTimeout(sliderDebounceTimeoutRef.current)
                      }

                      sliderDebounceTimeoutRef.current = setTimeout(() => {
                        isInternalUpdateRef.current = true
                        handleFilterChange({ ageRange: [newMin, newMax] })
                      }, 300)
                    }
                  }}
                  showValue
                />
              </Box>
            </Box>
          )}

          {/* Status */}
          {isAdminMode ? (
            <Tooltip content="Filter by funding status (Admin Only)">
              <Box minW={0}>
                <SelectRoot
                  collection={statusOptions}
                  value={selectedStatus}
                  onValueChange={(details) => {
                    const values = Array.isArray(details.value)
                      ? details.value
                      : details.items.map((item) => item.value)
                    handleFilterChange({ status: values })
                  }}
                  size="xs"
                  className="rounded-2xl w-full"
                  multiple
                >
                  <SelectTrigger css={{ borderRadius: "16px !important" }}>
                    <SelectValueText placeholder="Select Status">
                      {() => {
                        const allSelected = statusOptions.items.every((item) =>
                          selectedStatus.includes(item.value),
                        )
                        if (allSelected) return "All States"
                        const selected = statusOptions.items
                          .filter((item) => selectedStatus.includes(item.value))
                          .map((item) => item.label)
                          .join(", ")
                        return selected || "Select Status"
                      }}
                    </SelectValueText>
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.items.map((option) => (
                      <SelectItem item={option} key={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
              </Box>
            </Tooltip>
          ) : null
            /*
              Public All | Sponsored toggle temporarily hidden.
              The default status set (PUBLIC_STATUSES) already shows every
              public child, so we don't need a user-facing switch right
              now. Restore by uncommenting the block below.

              <Box minW={0}>
                <Box
                  bg="gray.100"
                  borderRadius="16px"
                  p="2px"
                  display="flex"
                  gap={0}
                >
                  {(
                    [
                      {
                        label: "All",
                        statuses: PUBLIC_STATUSES as readonly string[],
                      },
                      {
                        label: "Sponsored",
                        statuses: ["Budget Fulfilled"] as readonly string[],
                      },
                    ] as const
                  ).map(({ label, statuses }) => {
                    const isActive =
                      statuses.length === selectedStatus.length &&
                      statuses.every((s) => selectedStatus.includes(s))
                    return (
                      <Button
                        key={label}
                        flex={1}
                        size="xs"
                        borderRadius="14px"
                        fontSize="xs"
                        bg={isActive ? "white" : "transparent"}
                        color={isActive ? "#2b7ff9" : "gray.500"}
                        fontWeight={isActive ? "semibold" : "medium"}
                        boxShadow={isActive ? "sm" : "none"}
                        onClick={() =>
                          handleFilterChange({ status: [...statuses] })
                        }
                        _hover={{ bg: isActive ? "white" : "gray.200" }}
                        transition="all 0.15s"
                      >
                        {label}
                      </Button>
                    )
                  })}
                </Box>
              </Box>
            */
          }

          {/* Search */}
          <Box minW={0} position="relative">
            {/* Search icon — left adornment */}
            <Box
              position="absolute"
              left="0.6rem"
              top="50%"
              transform="translateY(-50%)"
              pointerEvents="none"
              color="gray.400"
              zIndex={1}
            >
              <IoSearchOutline size={15} />
            </Box>
            <Input
              placeholder="Search"
              value={mounted ? searchQuery : ""}
              onChange={(e) => {
                if (!mounted) return
                const value = e.target.value
                setSearchQuery(value)
                handleFilterChange({ search: value })
              }}
              size="xs"
              borderRadius="16px"
              paddingLeft="2rem"
              paddingRight="2.5rem"
              bg="gray.100"
              borderColor="transparent"
              _hover={{ bg: "gray.200", borderColor: "transparent" }}
              _focus={{
                bg: "white",
                borderColor: "#2b7ff9",
                boxShadow: "0 0 0 1px #2b7ff9",
              }}
              suppressHydrationWarning={true}
            />
            {mounted && searchQuery && (
              <IconButton
                aria-label="Clear search"
                size="xs"
                position="absolute"
                right="2px"
                top="50%"
                transform="translateY(-50%)"
                onClick={() => {
                  setSearchQuery("")
                  handleFilterChange({ search: "" })
                }}
                variant="ghost"
                borderRadius="full"
                _hover={{ bg: "gray.200" }}
              >
                <IoClose />
              </IconButton>
            )}
          </Box>
        </Box>

        {/* Info strip — always shown when result count is available, collapses otherwise */}
        <Box
          overflow="hidden"
          style={{
            maxHeight:
              resultCount !== undefined || !isDefaultFilters ? "3.5rem" : 0,
            opacity: resultCount !== undefined || !isDefaultFilters ? 1 : 0,
            transition: "max-height 0.25s ease, opacity 0.2s ease",
          }}
          px={0}
          pt={1.5}
          pb={{ base: 2, lg: 0 }}
          display="flex"
          justifyContent="space-between"
          alignItems="center"
        >
          {/* Left: result count — extra left padding (double the card's own px) */}
          <Text fontSize="xs" color="gray.400" lineHeight="1" pl={{ base: 3, md: 4 }}>
            {resultCount !== undefined
              ? `${resultCount}${hasMoreResults ? "+" : ""} shown`
              : null}
          </Text>

          {/* Right: active filter count + clear link — extra right padding (double the card's own px) */}
          <Text fontSize="xs" color="gray.500" lineHeight="1" pr={{ base: 3, md: 4 }}>
            {!isDefaultFilters && (
              <>
                {activeFilterCount === 1
                  ? "1 active filter"
                  : `${activeFilterCount} active filters`}
                {" — "}
                <Box
                  as="button"
                  onClick={handleClearFilters}
                  display="inline"
                  color="#2b7ff9"
                  fontWeight="semibold"
                  textDecoration="underline"
                  textUnderlineOffset="2px"
                  _hover={{ color: "#1a6fe0" }}
                  cursor="pointer"
                  background="none"
                  border="none"
                  p={0}
                  fontSize="xs"
                >
                  show all
                </Box>
              </>
            )}
          </Text>
        </Box>
      </Box>
    </>
  )
}

export default SponsorshipFilters

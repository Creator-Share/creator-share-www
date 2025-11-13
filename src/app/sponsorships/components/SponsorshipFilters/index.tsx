"use client"

import React, { useState, useEffect, useRef } from "react"
import { Box, Flex, Button, Text, Input, IconButton } from "@chakra-ui/react"
import { Global, css } from "@emotion/react"
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
import { genders, status as statusOptions } from "./config"
import { useAuthStore } from "@/store/authStore"
import { IoClose } from "react-icons/io5"

const SponsorshipFilters: React.FC<
  FiltersProps & { variant?: "default" | "sidebar"; isAdminMode?: boolean }
> = ({
  onFilterChange,
  variant = "default",
  beneficiaryType = "CHILD",
  isAdminMode = false,
}) => {
  const {
    selectedGender,
    selectedAgeRange,
    selectedStatus,
    setGender,
    setAgeRange,
    setStatus,
  } = useFilterStore()
  const defaultMaxAge = beneficiaryType === "ANIMAL" ? 20 : 14
  const [minAge, setMinAge] = useState<number>(selectedAgeRange[0] || 0)
  const [maxAge, setMaxAge] = useState<number>(
    selectedAgeRange[1] || defaultMaxAge
  )
  
  // Debug logging
  console.log('[AgeRange Debug] Component Render:', {
    minAge,
    maxAge,
    selectedAgeRange,
    defaultMaxAge,
    beneficiaryType,
  })
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [mounted, setMounted] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const user = useAuthStore((state) => state.user)
  
  // Track if we're updating internally to prevent circular updates
  const isInternalUpdateRef = useRef(false)
  const ageRangeUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const previousAgeRangeRef = useRef<[number, number]>([minAge, maxAge])
  const sliderDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const checkAdminStatus = async () => {
      if (user?.id) {
        const response = await fetch("/api/auth/check-admin")
        const { isAdmin } = await response.json()
        setIsAdmin(isAdmin)
      } else {
        setIsAdmin(false)
      }
    }
    checkAdminStatus()
  }, [user])

  // Only sync from filter store when change is external (not from our own updates)
  useEffect(() => {
    console.log('[AgeRange Debug] Filter Store Sync Effect Triggered:', {
      isInternalUpdate: isInternalUpdateRef.current,
      selectedAgeRange,
      currentMinAge: minAge,
      currentMaxAge: maxAge,
      previousAgeRange: previousAgeRangeRef.current,
    })
    
    // Skip if this is an internal update
    if (isInternalUpdateRef.current) {
      console.log('[AgeRange Debug] Skipping external sync - internal update in progress')
      // Reset the flag after a short delay to allow state updates to propagate
      if (ageRangeUpdateTimeoutRef.current) {
        clearTimeout(ageRangeUpdateTimeoutRef.current)
      }
      ageRangeUpdateTimeoutRef.current = setTimeout(() => {
        console.log('[AgeRange Debug] Resetting internal update flag')
        isInternalUpdateRef.current = false
      }, 150)
      return
    }

    // Get values from filter store
    const newMin = selectedAgeRange[0] || 0
    const newMax = selectedAgeRange[1] || defaultMaxAge
    const newAgeRange: [number, number] = [newMin, newMax]
    
    // Only update if the values actually changed and are different from previous
    const prevMin = previousAgeRangeRef.current[0]
    const prevMax = previousAgeRangeRef.current[1]
    
    console.log('[AgeRange Debug] Comparing values:', {
      newMin,
      newMax,
      prevMin,
      prevMax,
      willUpdate: newMin !== prevMin || newMax !== prevMax,
    })
    
    if (newMin !== prevMin || newMax !== prevMax) {
      console.log('[AgeRange Debug] Updating local state from filter store:', {
        from: [prevMin, prevMax],
        to: [newMin, newMax],
      })
      setMinAge(newMin)
      setMaxAge(newMax)
      previousAgeRangeRef.current = newAgeRange
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAgeRange, defaultMaxAge]) // Removed minAge and maxAge from dependencies to prevent circular updates
  
  // Cleanup timeouts on unmount
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
  
  // Update ref when local state changes (for internal updates)
  useEffect(() => {
    console.log('[AgeRange Debug] Local state changed, updating previousRef:', {
      minAge,
      maxAge,
      previousRef: previousAgeRangeRef.current,
    })
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
    // Always include the current status if not explicitly changed
    const newStatus = updatedFilters.status ?? selectedStatus
    console.log("New status:", newStatus)

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

    console.log('[AgeRange Debug] Clearing filters:', {
      currentMinAge: minAge,
      currentMaxAge: maxAge,
      defaultMaxAge,
    })

    // Determine default status based on mode
    const defaultStatus = isAdminMode
      ? ["New", "Partially Funded", "Budget Fulfilled", "Draft", "Archived"]
      : ["New", "Partially Funded"]

    // Mark as internal update to prevent circular sync
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
  }

  // Determine if current filters differ from mode-specific defaults to enable Clear button
  const hasSearchQuery = mounted && searchQuery.trim().length > 0

  const modeDefaultStatus = isAdminMode
    ? ["New", "Partially Funded", "Budget Fulfilled", "Draft", "Archived"]
    : ["New", "Partially Funded"]

  const isGenderDefault = (selectedGender ?? "") === ""
  const isAgeDefault =
    selectedAgeRange[0] === 0 && selectedAgeRange[1] === defaultMaxAge
  const isStatusDefault =
    selectedStatus.length === modeDefaultStatus.length &&
    modeDefaultStatus.every((s) => selectedStatus.includes(s))

  const isDefaultFilters =
    isGenderDefault && isAgeDefault && isStatusDefault && !hasSearchQuery

  return (
    <>
      <Global
        styles={css`
          [data-scope="select"][data-part="trigger"] {
            border-radius: 16px !important;
          }
        `}
      />
      <Box
        className="bg-white border rounded-3xl shadow-sm"
        p={{ base: 4, md: 5 }}
      >
        <Box className="bg-transparent rounded-2xl" width="100%">
          <Flex
            align="center"
            className={
              variant === "sidebar" ? "flex-col" : "flex-col lg:flex-row"
            }
            gap={8}
            px={{ base: 2, md: 4 }}
            py={2}
            position="relative"
            alignItems="center"
            width="100%"
          >
            {/* Age Range Slider */}
            <Box
              flex={{ base: "1 1 100%", md: "1 1 0" }}
              w="100%"
              minW={0}
              px={2}
            >
              <Text
                mb={2}
                fontSize="sm"
                fontWeight="semibold"
                textAlign="center"
              >
                Age Range: {minAge} - {maxAge} years
              </Text>
              <Box>
                <Slider
                  size={"sm"}
                  value={[minAge, maxAge]}
                  min={0}
                  max={defaultMaxAge}
                  step={1}
                  variant={"solid"}
                  onValueChange={(details) => {
                    if (details.value && details.value.length >= 2) {
                      const [newMin, origMax] = details.value
                      let newMax = origMax

                      console.log('[AgeRange Debug] Slider onChange:', {
                        receivedValues: details.value,
                        newMin,
                        origMax,
                        currentMinAge: minAge,
                        currentMaxAge: maxAge,
                        timestamp: Date.now(),
                      })

                      const minDistance = 1
                      if (newMax - newMin < minDistance) {
                        console.log('[AgeRange Debug] Adjusting maxAge for minimum distance')
                        newMax = Math.max(newMin + minDistance, maxAge)
                      }

                      console.log('[AgeRange Debug] Updating local state immediately:', {
                        newMin,
                        newMax,
                      })

                      // Update local state immediately for responsive UI
                      setMinAge(newMin)
                      setMaxAge(newMax)
                      
                      // Clear any existing debounce timeout
                      if (sliderDebounceTimeoutRef.current) {
                        console.log('[AgeRange Debug] Clearing previous debounce timeout')
                        clearTimeout(sliderDebounceTimeoutRef.current)
                      }
                      
                      // Debounce the filter store update to prevent rapid updates
                      sliderDebounceTimeoutRef.current = setTimeout(() => {
                        console.log('[AgeRange Debug] Debounced update - setting internal flag and updating filter store:', {
                          newMin,
                          newMax,
                          timestamp: Date.now(),
                        })
                        
                        // Mark as internal update to prevent circular sync
                        isInternalUpdateRef.current = true
                        
                        // Update filter store and trigger filter change
                        handleFilterChange({ ageRange: [newMin, newMax] })
                      }, 300) // 300ms debounce delay
                    }
                  }}
                  showValue
                />
              </Box>
            </Box>

            {/* Gender Select Dropdown */}
            <Box flex={{ base: "1 1 100%", md: "1 1 0" }} w="100%" minW={0}>
              <SelectRoot
                collection={genders}
                value={selectedGender ? [selectedGender] : [""]}
                onValueChange={(details) => {
                  const value = details.items[0]
                  handleFilterChange({ gender: value?.value || "" })
                }}
                size="sm"
                className="rounded-2xl w-full"
              >
                <SelectTrigger
                  css={{
                    borderRadius: "16px !important",
                  }}
                >
                  <SelectValueText placeholder="All Genders">
                    {() => {
                      const selected = genders.items.find(
                        (item) => item.value === selectedGender
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

            {/* Status Select Dropdown - Admin Only */}
            {user && isAdmin && (
              <Tooltip content="Filter by funding status (Admin Only)">
                <Box flex={{ base: "1 1 100%", md: "1 1 0" }} w="100%" minW={0}>
                  <SelectRoot
                    collection={statusOptions}
                    value={selectedStatus}
                    onValueChange={(details) => {
                      const values = details.items.map((item) => item.value)
                      handleFilterChange({ status: values })
                    }}
                    size="sm"
                    className="rounded-2xl w-full"
                    multiple
                  >
                    <SelectTrigger
                      css={{
                        borderRadius: "16px !important",
                      }}
                    >
                      <SelectValueText placeholder="Select Status">
                        {() => {
                          const selected = statusOptions.items
                            .filter((item) =>
                              selectedStatus.includes(item.value)
                            )
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
            )}

            {/* Search Field */}
            <Box
              flex={{ base: "1 1 100%", md: "1 1 0" }}
              w="100%"
              minW={0}
              position="relative"
            >
              <Input
                placeholder="Search for a Child"
                value={mounted ? searchQuery : ""}
                onChange={(e) => {
                  if (!mounted) return
                  const value = e.target.value
                  setSearchQuery(value)
                  handleFilterChange({ search: value })
                }}
                size="sm"
                className="rounded-2xl"
                borderRadius="16px"
                paddingRight="2.5rem"
                _focus={{
                  borderColor: "#1C3C8C",
                  boxShadow: "0 0 0 1px #1C3C8C",
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

            <Box flex={{ base: "1 1 100%", md: "1 1 0" }} w="100%" minW={0}>
              <Tooltip
                content="This button will clear search filters to show all children if you have search filters applied"
                disabled={!isDefaultFilters}
              >
                <Button
                  onClick={handleClearFilters}
                  size="md"
                  fontWeight="semibold"
                  width={{ base: "100%", md: "100%" }}
                  bg="#1C3C8C"
                  color="white"
                  borderRadius="16px"
                  _hover={{ bg: "#1C2B7A" }}
                  _active={{ bg: "#182765" }}
                  disabled={isDefaultFilters}
                  _disabled={{
                    bg: "gray.300",
                    color: "white",
                    cursor: "not-allowed",
                    _dark: { bg: "gray.600", color: "gray.200" },
                  }}
                >
                  {!isDefaultFilters
                    ? "Clear Search & Filters"
                    : "Showing All Children"}
                </Button>
              </Tooltip>
            </Box>
          </Flex>
        </Box>
      </Box>
    </>
  )
}

export default SponsorshipFilters

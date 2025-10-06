"use client"

import React, { useState, useEffect } from "react"
import { Box, Flex, Button, Text, Input } from "@chakra-ui/react"
import { Slider } from "@/components/ui/slider"
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { useFilterStore } from "@/store/filterStore"
import { FiltersProps } from "@/types/propTypes"
import { genders, status as statusOptions } from "./config"

const Filters: React.FC<FiltersProps & { variant?: "default" | "sidebar" }> = ({
  onFilterChange,
  variant = "default",
  beneficiaryType = "CHILD",
}) => {
  const {
    selectedGender,
    selectedAgeRange,
    selectedStatus,
    setGender,
    setAgeRange,
    setStatus,
    resetToDefaults,
    isDirty,
  } = useFilterStore()
  const [minAge, setMinAge] = useState<number>(selectedAgeRange[0] || 0)
  const defaultMaxAge = beneficiaryType === "ANIMAL" ? 20 : 14
  const [maxAge, setMaxAge] = useState<number>(
    selectedAgeRange[1] || defaultMaxAge,
  )
  const [searchTerm, setSearchTerm] = useState<string>("")

  useEffect(() => {
    setMinAge(selectedAgeRange[0] || 0)
    setMaxAge(selectedAgeRange[1] || defaultMaxAge)
  }, [selectedAgeRange, defaultMaxAge])

  const handleFilterChange = (updatedFilters: {
    gender?: string
    ageRange?: [number, number]
    status?: string[]
    searchTerm?: string
  }) => {
    // Always include the current status if not explicitly changed
    const newStatus = updatedFilters.status ?? selectedStatus
    const newSearchTerm = updatedFilters.searchTerm ?? searchTerm
    console.log("New status:", newStatus)

    const newFilters = {
      gender: updatedFilters.gender ?? selectedGender,
      ageRange: updatedFilters.ageRange ?? selectedAgeRange,
      status: newStatus,
      searchTerm: newSearchTerm,
    }

    if (updatedFilters.gender !== undefined) {
      setGender(newFilters.gender)
    }
    if (updatedFilters.ageRange !== undefined) {
      setAgeRange(newFilters.ageRange)
    }
    if (updatedFilters.searchTerm !== undefined) {
      setSearchTerm(newSearchTerm)
    }
    setStatus(newStatus)

    onFilterChange(newFilters)
  }

  const handleClearFilters = (e: React.MouseEvent) => {
    e.preventDefault()
    resetToDefaults()
    setMinAge(0)
    setMaxAge(defaultMaxAge)
    setSearchTerm("")
    onFilterChange({
      gender: "",
      ageRange: [0, defaultMaxAge],
      status: ["New", "Partially Funded"],
      searchTerm: "",
    })
  }

  // Determine if current filters differ from defaults to enable Clear button
  // Call directly so it reflects the latest store state each render
  const isDefaultFilters = !isDirty()

  return (
    <Box className="bg-transparent rounded-xl" width="100%">
      {/* Search Section */}
      <Box mb={4}>
        <Input
          placeholder="Search by name or username..."
          value={searchTerm}
          onChange={(e) => handleFilterChange({ searchTerm: e.target.value })}
          size="sm"
          className="border rounded-xl w-full"
          px={4}
          py={2}
        />
      </Box>

      {/* Filters Section */}
      <Flex
        align="center"
        className={variant === "sidebar" ? "flex-col" : "flex-col md:flex-row"}
        gap={4}
        position="relative"
        alignItems="center"
        width="100%"
      >
        {/* Gender Select Dropdown */}
        <Box flex={{ base: "1 1 100%", md: "1 1 0" }} w="100%" minW={0}>
          <SelectRoot
            collection={genders}
            value={selectedGender ? [selectedGender] : undefined}
            onValueChange={(details) => {
              const value = details.items[0]
              handleFilterChange({ gender: value?.value || "" })
            }}
            size="sm"
            className="border rounded-xl w-full"
            px={4}
            py={2}
          >
            <SelectTrigger>
              <SelectValueText placeholder="Select Gender">
                {() => {
                  const selected = genders.items.find(
                    (item) => item.value === selectedGender,
                  )
                  return selected ? selected.label : "Select Gender"
                }}
              </SelectValueText>
            </SelectTrigger>
            <SelectContent>
              {genders.items.map((gender) => (
                <SelectItem item={gender} key={gender.value}>
                  {gender.label}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </Box>

        {/* Status Select Dropdown */}
        <Box flex={{ base: "1 1 100%", md: "1 1 0" }} w="100%" minW={0}>
          <SelectRoot
            collection={statusOptions}
            value={selectedStatus}
            onValueChange={(details) => {
              const values = details.items.map((item) => item.value)
              handleFilterChange({ status: values })
            }}
            size="sm"
            className="border rounded-xl w-full"
            px={4}
            py={2}
            multiple
          >
            <SelectTrigger>
              <SelectValueText placeholder="Select Status">
                {() => {
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

        <Box flex={{ base: "1 1 100%", md: "1 1 0" }} w="100%" px={2} minW={0}>
          <Text mb={2} fontSize="md" fontWeight="semibold">
            Age Range: {minAge} - {maxAge} years
          </Text>
          <Box>
            <Slider
              value={[minAge, maxAge]}
              min={0}
              max={defaultMaxAge}
              step={1}
              variant={"solid"}
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
                  handleFilterChange({ ageRange: [newMin, newMax] })
                }
              }}
              showValue
            />
          </Box>
        </Box>
        <Box flex={{ base: "1 1 100%", md: "1 1 0" }} w="100%" minW={0}>
          <Button
            onClick={handleClearFilters}
            size="md"
            fontWeight="semibold"
            width={{ base: "100%", md: "100%" }}
            bg="#1C3C8C"
            color="white"
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
            Show All Children
          </Button>
        </Box>
      </Flex>
    </Box>
  )
}

export default Filters

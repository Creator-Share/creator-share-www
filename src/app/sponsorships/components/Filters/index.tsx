"use client";

import React, { useState, useEffect } from "react";
import { Box, Flex, Button, Text } from "@chakra-ui/react";
import { Slider } from "@/components/ui/slider";
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useFilterStore } from "@/store/filterStore";
import { FiltersProps } from "@/types/propTypes";
import { genders, status as statusOptions } from "./config";

const Filters: React.FC<FiltersProps & { variant?: 'default' | 'sidebar' }> = ({ 
  onFilterChange,
  variant = 'default'
}) => {
  const {
    selectedGender,
    selectedAgeRange,
    selectedStatus,
    setGender,
    setAgeRange,
    setStatus,
    clearFilters,
  } = useFilterStore();
  const [minAge, setMinAge] = useState<number>(selectedAgeRange[0] || 0);
  const [maxAge, setMaxAge] = useState<number>(selectedAgeRange[1] || 14);

  useEffect(() => {
    setMinAge(selectedAgeRange[0] || 0);
    setMaxAge(selectedAgeRange[1] || 14);
  }, [selectedAgeRange]);

  const handleFilterChange = (updatedFilters: {
    gender?: string;
    ageRange?: [number, number];
    status?: string[];
  }) => {
    if (updatedFilters.gender !== undefined) {
      setGender(updatedFilters.gender);
    }
    if (updatedFilters.ageRange !== undefined) {
      setAgeRange(updatedFilters.ageRange);
    }
    if (updatedFilters.status !== undefined) {
      setStatus(updatedFilters.status);
    }

    onFilterChange({
      gender: updatedFilters.gender ?? selectedGender,
      ageRange: updatedFilters.ageRange ?? selectedAgeRange,
      status: updatedFilters.status ?? selectedStatus,
    });
  };

  const handleClearFilters = (e: React.MouseEvent) => {
    e.preventDefault();
    clearFilters();
    setMinAge(0);
    setMaxAge(14);
    onFilterChange({ gender: "", ageRange: [0, 14], status: [] });
  };

  return (
    <Box className="bg-transparent rounded-xl" width="100%">
      <Flex 
        align="center" 
        className={variant === 'sidebar' ? "flex-col" : "flex-col md:flex-row"} 
        gap={4}
        position="relative"
        alignItems="stretch"
      >
        {/* Gender Select Dropdown */}
        <SelectRoot
          collection={genders}
          value={selectedGender ? [selectedGender] : undefined}
          onValueChange={(details) => {
            const value = details.items[0];
            handleFilterChange({ gender: value?.value || "" });
          }}
          size="sm"
          className="border rounded-xl"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Gender">
              {() => {
                const selected = genders.items.find(item => item.value === selectedGender);
                return selected ? selected.label : "Select Gender";
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

        {/* Status Select Dropdown */}
        <SelectRoot
          collection={statusOptions}
          value={selectedStatus && selectedStatus.length > 0 ? selectedStatus : undefined}
          onValueChange={(details) => {
            const values = details.items.map(item => item.value);
            handleFilterChange({ status: values });
          }}
          size="sm"
          className="border rounded-xl"
          px={4}
          py={2}
          multiple
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Status">
              {() => {
                const selected = statusOptions.items.find(item => selectedStatus.includes(item.value));
                return selected ? selected.label : "Select Status";
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

        <Box maxW="300px" w="100%" px={2}>
          <Text mb={2} fontSize="md" fontWeight="semibold">
            Age Range: {minAge} - {maxAge} years
          </Text>
          <Box>
            <Slider
              value={[minAge, maxAge]}
              min={0}
              max={14}
              step={1}
              onValueChange={(details) => {
                if (details.value && details.value.length >= 2) {
                  const [newMin, origMax] = details.value;
                  let newMax = origMax;
                  
                  const minDistance = 1;
                  if (newMax - newMin < minDistance) {
                    newMax = Math.max(newMin + minDistance, maxAge);
                  }
                  
                  setMinAge(newMin);
                  setMaxAge(newMax);
                  handleFilterChange({ ageRange: [newMin, newMax] });
                }
              }}
              showValue
            />
          </Box>
        </Box>
        <Button
          onClick={handleClearFilters}
          className="bg-[#1C3C8C] text-base font-semibold text-[#F8FAFC]"
          px={4}
          py={6}
        >
          Clear Filter
        </Button>
      </Flex>
    </Box>
  );
};

export default Filters;

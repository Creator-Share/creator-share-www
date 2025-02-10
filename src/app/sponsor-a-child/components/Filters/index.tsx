"use client";

import React from "react";
import { Box, Flex, Button } from "@chakra-ui/react";
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { genders, ageOptions } from "./config";
import { useFilterStore } from "@/store/filterStore";
import { FiltersProps } from "@/types/propTypes";

const Filters: React.FC<FiltersProps> = ({ onFilterChange }) => {
  const { selectedGender, selectedAge, setGender, setAge, clearFilters } = useFilterStore();

  const handleFilterChange = (updatedFilters: { gender?: string; age?: string }) => {
    if (updatedFilters.gender !== undefined) {
      setGender(updatedFilters.gender);
    }
    if (updatedFilters.age !== undefined) {
      setAge(updatedFilters.age);
    }

    onFilterChange({
      gender: updatedFilters.gender ?? selectedGender,
      age: updatedFilters.age ?? selectedAge,
    });
  };

  const handleClearFilters = (e: React.MouseEvent) => {
    e.preventDefault();
    clearFilters();
    onFilterChange({ gender: '', age: '' });
  };

  return (
    <Box className="border" width="100%" py={6} px={{ base: 3, md: 12 }} mb={4}>
      <Flex align="center" className="flex-col md:flex-row" gap={4}>
        <SelectRoot
          collection={genders}
          value={selectedGender ? [selectedGender] : undefined}
          onValueChange={(details) => {
            const value = details.items[0];
            handleFilterChange({ gender: value?.value || "" });
          }}
          size="sm"
          className="border rounded-lg"
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

        <SelectRoot
          collection={ageOptions}
          value={selectedAge ? [selectedAge] : undefined}
          onValueChange={(details) => {
            const value = details.items[0];
            handleFilterChange({ age: value?.value || "" });
          }}
          size="sm"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Age">
              {() => {
                const selected = ageOptions.items.find(item => item.value === selectedAge);
                return selected ? selected.label : "Select Age";
              }}
            </SelectValueText>
          </SelectTrigger>
          <SelectContent>
            {ageOptions.items.map((age) => (
              <SelectItem item={age} key={age.value}>
                {age.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

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

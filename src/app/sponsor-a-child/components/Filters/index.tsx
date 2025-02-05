"use client";

import React, { useState } from "react";
import { Box, Flex, Button } from "@chakra-ui/react";
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { genders, ageOptions } from "./config";

interface FiltersProps {
  onFilterChange: (filters: {
    gender: string;
    age: string;
  }) => void;
}


const Filters: React.FC<FiltersProps> = ({ onFilterChange }) => {
  const [selectedGender, setSelectedGender] = useState<string>("");
  const [selectedAge, setSelectedAge] = useState<string>("");

  const handleFilterChange = (updatedFilters: { gender?: string; age?: string }) => {
    setSelectedGender(updatedFilters.gender ?? selectedGender);
    setSelectedAge(updatedFilters.age ?? selectedAge);

    const filters = {
      gender: updatedFilters.gender ?? selectedGender,
      age: updatedFilters.age ?? selectedAge,
    };

    console.log("Filters Applied:", filters);
    onFilterChange(filters);
  };

  const handleClearFilters = () => {
    setSelectedGender("");
    setSelectedAge("");

    console.log("Filters Cleared");
    onFilterChange({ gender: "", age: "" });
  };

  return (
    <Box className="border" width="100%" py={6} px={{ base: 3, md: 12 }} mb={4}>
      <Flex align="center" className="flex-col md:flex-row" gap={4}>
        {/* Gender Selector */}
        <SelectRoot
          collection={genders}
          onValueChange={(value) => {
            let extractedValue = "";
            if (value && typeof value === "object" && "value" in value) {
              extractedValue = Array.isArray(value.value) ? value.value[0] : value.value;
            }
            handleFilterChange({ gender: extractedValue });
          }}
          size="sm"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Gender">
              {() => selectedGender || "Select Gender"}
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

        {/* Age Selector */}
        <SelectRoot
          collection={ageOptions}
          onValueChange={(value) => {
            let extractedValue = "";
            if (value && typeof value === "object" && "value" in value) {
              extractedValue = Array.isArray(value.value) ? value.value[0] : value.value;
            }
            handleFilterChange({ age: extractedValue });
          }}
          size="sm"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Age">
              {() => selectedAge || "Select Age"}
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

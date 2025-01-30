"use client";

import React, { useState } from "react";
import {
  Box,
  Button,
  Flex,
} from "@chakra-ui/react";
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {  genders, ageOptions } from "./config";

interface FiltersProps {
  onFilterChange: (filters: {
    gender: string;
    age: string;
  }) => void;
}



const Filters: React.FC<FiltersProps> = ({ onFilterChange }) => {
  const [selectedGender, setSelectedGender] = useState<string>("");
  const [selectedAge, setSelectedAge] = useState<string>("");


  const handleFilterChange = () => {
    onFilterChange({
      gender: selectedGender,
      age: selectedAge,
    });
  };

  return (
    <Box className="border" width="100%" py={6} px={{base:3 ,md:12}}>
      <Flex align="center" className="flex-col" gap={4}>
        <SelectRoot
          collection={genders}
          onValueChange={(value) =>
            setSelectedGender(Array.isArray(value) ? value[0] : value)
          }
          size="sm"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Gender" />
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
          onValueChange={(value) =>
            setSelectedAge(Array.isArray(value) ? value[0] : value)
          }
          size="sm"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Age" />
          </SelectTrigger>
          <SelectContent>
            {ageOptions.items.map((age) => (
              <SelectItem item={age} key={age.value}>
                {age.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <Button onClick={handleFilterChange} className="bg-[#1C3C8C] w-full text-base font-semibold text-[#F8FAFC]" px={4} py={6}>
          Clear Filter
        </Button>
      </Flex>
    </Box>
  );
};

export default Filters;

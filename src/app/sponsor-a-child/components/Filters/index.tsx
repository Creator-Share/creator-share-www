"use client";

import React, { useState } from "react";
import {
  Box,
  Button,
  Flex,
} from "@chakra-ui/react";
import {
  SelectRoot,
  SelectItemGroup,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { locations, genders, ageOptions, dayOptions, monthOptions } from "./config";

interface FiltersProps {
  onFilterChange: (filters: {
    location: string;
    gender: string;
    age: string;
    day: string;
    month: string;
  }) => void;
}



const Filters: React.FC<FiltersProps> = ({ onFilterChange }) => {
  const [selectedLocation, setSelectedLocation] = useState<string>("");
  const [selectedGender, setSelectedGender] = useState<string>("");
  const [selectedAge, setSelectedAge] = useState<string>("");
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [selectedMonth, setSelectedMonth] = useState<string>("");

  const categories = locations.items.reduce(
    (acc, item) => {
      const group = acc.find((group) => group.group === item.group)
      if (group) {
        group.items.push(item)
      } else {
        acc.push({ group: item.group, items: [item] })
      }
      return acc
    },
    [] as { group: string; items: (typeof locations)["items"] }[],
  )

  const handleFilterChange = () => {
    onFilterChange({
      location: selectedLocation,
      gender: selectedGender,
      age: selectedAge,
      day: selectedDay,
      month: selectedMonth
    });
  };

  return (
    <Box className="border" width="100%" py={6} px={12}>
      <Flex align="center" gap={4}>
        <SelectRoot
          collection={locations}
          onValueChange={(value) =>
            setSelectedLocation(Array.isArray(value) ? value[0] : value)
          }
          size="sm"
          width="280px"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select location" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItemGroup key={category.group} label={category.group}>
                {category.items.map((item) => (
                  <SelectItem item={item} key={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectItemGroup>
            ))}
          </SelectContent>
        </SelectRoot>
        <SelectRoot
          collection={genders}
          onValueChange={(value) =>
            setSelectedGender(Array.isArray(value) ? value[0] : value)
          }
          size="sm"
          width="200px"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select gender" />
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
          width="200px"
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
        <SelectRoot
          collection={monthOptions}
          onValueChange={(value) =>
            setSelectedMonth(Array.isArray(value) ? value[0] : value)
          }
          size="sm"
          width="200px"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Birth Month" />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.items.map((month) => (
              <SelectItem item={month} key={month.value}>
                {month.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <SelectRoot
          collection={dayOptions}
          onValueChange={(value) =>
            setSelectedDay(Array.isArray(value) ? value[0] : value)
          }
          size="sm"
          width="200px"
          className="border rounded-lg"
          px={4}
          py={2}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select Birth Date" />
          </SelectTrigger>
          <SelectContent>
            {dayOptions.items.map((day) => (
              <SelectItem item={day} key={day.value}>
                {day.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <Button onClick={handleFilterChange} className="bg-[#1C3C8C] text-base font-semibold text-[#F8FAFC]" px={4} py={6}>
          Clear Filter
        </Button>
      </Flex>
    </Box>
  );
};

export default Filters;

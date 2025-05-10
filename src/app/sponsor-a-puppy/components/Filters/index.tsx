"use client";
import React from "react";
import { Box, Button, Flex, Text, VStack } from "@chakra-ui/react";
import { Field as FormControl } from "@/components/ui/field";
import { NativeSelectRoot as Select } from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";

interface FiltersProps {
  onFilterChange: (filters: {
    gender?: string;
    ageRange?: [number, number];
    status?: string[];
  }) => void;
  onReset?: () => void;
}

interface ValueChangeDetails {
  value: [number, number];
}

const STATUS_OPTIONS = ["New", "Partially Funded", "Budget Fulfilled"];

const Filters: React.FC<FiltersProps> = ({ onFilterChange, onReset }) => {
  const [gender, setGender] = React.useState("");
  const [ageRange, setAgeRange] = React.useState<[number, number]>([0, 14]);
  const [status, setStatus] = React.useState<string[]>(["New", "Partially Funded"]);

  const handleGenderChange = (event: React.FormEvent<HTMLDivElement>) => {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    setGender(value);
    onFilterChange({ gender: value, ageRange, status });
  };

  const handleAgeRangeChange = (details: ValueChangeDetails) => {
    const newRange = details.value;
    setAgeRange(newRange);
    onFilterChange({ gender, ageRange: newRange, status });
  };

  const handleStatusChange = (value: string, checked: boolean) => {
    const newStatus = checked
      ? [...status, value]
      : status.filter((s) => s !== value);
    setStatus(newStatus);
    onFilterChange({ gender, ageRange, status: newStatus });
  };

  const handleReset = () => {
    setGender("");
    setAgeRange([0, 14]);
    setStatus(["New", "Partially Funded"]);
    onFilterChange({
      gender: "",
      ageRange: [0, 14],
      status: ["New", "Partially Funded"],
    });
    if (onReset) onReset();
  };

  return (
    <Box
      p={6}
      bg="white"
      borderRadius="xl"
      shadow="sm"
      border="1px"
      borderColor="gray.200"
    >
      <VStack gap={6} align="stretch">
        <Text fontSize="lg" fontWeight="semibold" color="#1C3C8C">
          Filter Puppies
        </Text>

        <FormControl>
          <Text as="label" display="block" mb={2}>Gender</Text>
          <Select defaultValue={gender} onInput={handleGenderChange}>
            <option value="">All</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
          </Select>
        </FormControl>

        <FormControl>
          <Text as="label" display="block" mb={2}>Age Range (months)</Text>
          <Box px={4}>
            <Slider
              defaultValue={[0, 14]}
              min={0}
              max={14}
              step={1}
              onValueChange={handleAgeRangeChange}
            />
            <Flex justify="space-between" mt={2}>
              <Text fontSize="sm" color="gray.600">
                {ageRange[0]} months
              </Text>
              <Text fontSize="sm" color="gray.600">
                {ageRange[1]} months
              </Text>
            </Flex>
          </Box>
        </FormControl>

        <FormControl>
          <Text as="label" display="block" mb={2}>Status</Text>
          <VStack align="start" gap={2}>
            {STATUS_OPTIONS.map((option) => (
              <Checkbox
                key={option}
                checked={status.includes(option)}
                onCheckedChange={(checked) => handleStatusChange(option, checked)}
              >
                {option}
              </Checkbox>
            ))}
          </VStack>
        </FormControl>

        <Button
          onClick={handleReset}
          variant="outline"
          colorScheme="blue"
          size="sm"
        >
          Reset Filters
        </Button>
      </VStack>
    </Box>
  );
};

export default Filters;

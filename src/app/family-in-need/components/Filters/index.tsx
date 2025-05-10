"use client";
import React from "react";
import { Box, Button, Flex, Text, VStack } from "@chakra-ui/react";
import { Field as FormControl } from "@/components/ui/field";
import { NativeSelectRoot as Select } from "@/components/ui/native-select";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";

interface FiltersProps {
  onFilterChange: (filters: {
    familySize?: string;
    ageRange?: [number, number];
    status?: string[];
  }) => void;
  onReset?: () => void;
}

interface ValueChangeDetails {
  value: [number, number];
}

const STATUS_OPTIONS = ["New", "Partially Funded", "Budget Fulfilled"];
const FAMILY_SIZE_OPTIONS = ["Small (2-3)", "Medium (4-6)", "Large (7+)"];

const Filters: React.FC<FiltersProps> = ({ onFilterChange, onReset }) => {
  const [familySize, setFamilySize] = React.useState("");
  const [ageRange, setAgeRange] = React.useState<[number, number]>([0, 14]);
  const [status, setStatus] = React.useState<string[]>(["New", "Partially Funded"]);

  const handleFamilySizeChange = (event: React.FormEvent<HTMLDivElement>) => {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    setFamilySize(value);
    onFilterChange({ familySize: value, ageRange, status });
  };

  const handleAgeRangeChange = (details: ValueChangeDetails) => {
    const newRange = details.value;
    setAgeRange(newRange);
    onFilterChange({ familySize, ageRange: newRange, status });
  };

  const handleStatusChange = (value: string, checked: boolean) => {
    const newStatus = checked
      ? [...status, value]
      : status.filter((s) => s !== value);
    setStatus(newStatus);
    onFilterChange({ familySize, ageRange, status: newStatus });
  };

  const handleReset = () => {
    setFamilySize("");
    setAgeRange([0, 14]);
    setStatus(["New", "Partially Funded"]);
    onFilterChange({
      familySize: "",
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
          Filter Families
        </Text>

        <FormControl>
          <Text as="label" display="block" mb={2}>Family Size</Text>
          <Select defaultValue={familySize} onInput={handleFamilySizeChange}>
            <option value="">All</option>
            {FAMILY_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </FormControl>

        <FormControl>
          <Text as="label" display="block" mb={2}>Average Age Range (years)</Text>
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
                {ageRange[0]} years
              </Text>
              <Text fontSize="sm" color="gray.600">
                {ageRange[1]} years
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

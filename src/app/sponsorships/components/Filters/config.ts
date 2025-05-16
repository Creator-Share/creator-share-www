import { createListCollection } from "@chakra-ui/react";
export const genders = createListCollection({
  items: [
    { label: "Boy", value: "Boy" },
    { label: "Girl", value: "Girl" },
  ],
});

export const status = createListCollection({
  items: [
    { label: "New", value: "New" },
    { label: "Partially Funded", value: "Partially Funded" },
    { label: "Budget Fulfilled", value: "Budget Fulfilled" },
    { label: "Archived", value: "Archived" },
    { label: "Draft", value: "Draft" },
  ],
});

export const ageOptions = createListCollection({
  items: [
    { label: "less than 1", value: "less_than_1" },
    ...Array.from({ length: 14 }, (_, i) => ({
      label: `${i + 1}`,
      value: `${i + 1}`,
    })),
  ],
});
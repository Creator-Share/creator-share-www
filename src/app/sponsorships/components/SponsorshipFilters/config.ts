import { createListCollection } from "@chakra-ui/react"
export const genders = createListCollection({
  items: [
    { label: "All Genders", value: "" },
    { label: "Boys", value: "Boy" },
    { label: "Girls", value: "Girl" },
  ],
})

export const status = createListCollection({
  items: [
    { label: "New", value: "New" },
    { label: "Partially Funded", value: "Partially Funded" },
    { label: "Budget Fulfilled", value: "Budget Fulfilled" },
    { label: "Draft", value: "Draft" },
    { label: "Archived", value: "Archived" },
    { label: "Sponsorship Cancelled", value: "Sponsorship Cancelled" },
  ],
})

export const ageOptions = createListCollection({
  items: [
    { label: "less than 1", value: "less_than_1" },
    ...Array.from({ length: 14 }, (_, i) => ({
      label: `${i + 1}`,
      value: `${i + 1}`,
    })),
  ],
})

import { createListCollection } from "@chakra-ui/react";

export const paymentOptionsCollection = createListCollection({
  items: [
    { label: "Monthly Recurring", value: "subscription" },
    { label: "Yearly Recurring", value: "payment" },
  ],
});
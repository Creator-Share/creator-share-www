import { createListCollection } from "@chakra-ui/react";

export const paymentOptionsCollection = createListCollection({
  items: [
    { label: "Monthly", value: "subscription" },
    { label: "Annually", value: "subscription" },
    { label: "Single Year (non-recurring)", value: "payment" },

  ],
});
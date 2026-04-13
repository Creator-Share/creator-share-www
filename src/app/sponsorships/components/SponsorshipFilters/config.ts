import { createListCollection } from "@chakra-ui/react"
import { ALL_BENEFICIARY_TABS } from "@/config/beneficiaryTypes"
import { ALL_STATUSES } from "@/config/beneficiaryStatuses"

export const beneficiaryTypes = createListCollection({
  items: [
    { label: "All Opportunities", value: "" },
    ...ALL_BENEFICIARY_TABS.filter(
      (tab) => !tab.isLegacyAlias && tab.isPubliclyVisible && tab.type !== null,
    ).map((tab) => ({ label: tab.label, value: tab.type as string })),
  ],
})

export const genders = createListCollection({
  items: [
    { label: "All Genders", value: "" },
    { label: "Boys", value: "Boy" },
    { label: "Girls", value: "Girl" },
  ],
})

export const status = createListCollection({
  items: ALL_STATUSES.map((s) => ({ label: s, value: s })),
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

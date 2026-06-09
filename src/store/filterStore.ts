import { create } from "zustand"
import { FilterState } from "@/types/index"
import { PUBLIC_STATUSES } from "@/config/beneficiaryStatuses"

const DEFAULTS = {
  selectedGender: "",
  selectedAgeRange: [0, 14] as [number, number],
  selectedStatus: PUBLIC_STATUSES as string[],
  searchQuery: "",
}

export const useFilterStore = create<FilterState>((set, get) => ({
  ...DEFAULTS,
  setGender: (gender) => set({ selectedGender: gender }),
  setAgeRange: (ageRange) => set({ selectedAgeRange: ageRange }),
  setStatus: (status) => set({ selectedStatus: status }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  resetToDefaults: () => set({ ...DEFAULTS }),
  isDirty: () => {
    const { selectedGender, selectedAgeRange, selectedStatus, searchQuery } = get()
    const isGenderDirty = (selectedGender ?? "") !== DEFAULTS.selectedGender
    const isAgeDirty =
      selectedAgeRange[0] !== DEFAULTS.selectedAgeRange[0] ||
      selectedAgeRange[1] !== DEFAULTS.selectedAgeRange[1]
    const isStatusDirty =
      selectedStatus.length !== DEFAULTS.selectedStatus.length ||
      DEFAULTS.selectedStatus.some((s) => !selectedStatus.includes(s))
    const isSearchDirty = searchQuery !== DEFAULTS.searchQuery
    return isGenderDirty || isAgeDirty || isStatusDirty || isSearchDirty
  },
}))
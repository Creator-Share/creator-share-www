import { create } from "zustand";
import { FilterState } from "@/types/index";

export const useFilterStore = create<FilterState>((set) => ({
  selectedGender: "",
  selectedAgeRange: [0, 14],
  selectedStatus: ["New", "Partially Funded"],
  setGender: (gender) => set({ selectedGender: gender }),
  setAgeRange: (ageRange) => set({ selectedAgeRange: ageRange }),
  setStatus: (status) => set({ selectedStatus: status }),
  clearFilters: () => set({ selectedGender: "", selectedAgeRange: [0, 14], selectedStatus: [] }),
}));



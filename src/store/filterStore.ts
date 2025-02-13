import { create } from "zustand";
import { FilterState } from "@/types/index";

export const useFilterStore = create<FilterState>((set) => ({
  selectedGender: "",
  selectedAgeRange: [0],
  setGender: (gender) => set({ selectedGender: gender }),
  setAgeRange: (ageRange) => set({ selectedAgeRange: ageRange }),
  clearFilters: () => set({ selectedGender: "", selectedAgeRange: [0] }),
}));



import { create } from "zustand";
import { FilterState } from "@/types/index";

export const useFilterStore = create<FilterState>((set) => ({
  selectedGender: "",
  selectedAgeRange: [0, 14],
  selectedStatus: ["ACTIVE", "PENDING"],
  selectedType: undefined,
  setGender: (gender) => set({ selectedGender: gender }),
  setAgeRange: (ageRange) => set({ selectedAgeRange: ageRange }),
  setStatus: (status) => set({ selectedStatus: status }),
  setType: (type) => set({ selectedType: type }),
  clearFilters: () => set({ 
    selectedGender: "", 
    selectedAgeRange: [0, 14], 
    selectedStatus: ["ACTIVE", "PENDING"],
    selectedType: undefined
  }),
}));

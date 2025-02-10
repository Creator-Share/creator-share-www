import { create } from 'zustand'
import { FilterState } from '@/types/index'

export const useFilterStore = create<FilterState>((set) => ({
  selectedGender: '',
  selectedAge: '',
  setGender: (gender) => set({ selectedGender: gender }),
  setAge: (age) => set({ selectedAge: age }),
  clearFilters: () => set({ selectedGender: '', selectedAge: '' }),
}))

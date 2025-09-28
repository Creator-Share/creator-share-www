import { create } from "zustand"
import { Beneficiaries } from "@/types/admin.types"

interface FormStoreState {
  formData: Partial<Beneficiaries>
  formDataEdit: Partial<Beneficiaries>
  imageFiles: File[]
  videoFiles: File[]
  
  setFormData: (data: Partial<Beneficiaries>) => void
  setFormDataEdit: (data: Partial<Beneficiaries>) => void
  setImageFiles: (files: File[]) => void
  setVideoFiles: (files: File[]) => void
  resetForm: () => void
}

export const useFormStore = create<FormStoreState>((set) => ({
  formData: {},
  formDataEdit: {},
  imageFiles: [],
  videoFiles: [],
  
  setFormData: (data) => set({ formData: data }),
  setFormDataEdit: (data) => set({ formDataEdit: data }),
  setImageFiles: (files) => set({ imageFiles: files }),
  setVideoFiles: (files) => set({ videoFiles: files }),
  resetForm: () => set({ 
    formData: {}, 
    formDataEdit: {}, 
    imageFiles: [], 
    videoFiles: [] 
  }),
})) 
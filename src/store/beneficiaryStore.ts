import { create } from "zustand"
import { Beneficiaries, BeneficiaryType } from "@/types/admin.types"

interface BeneficiaryStoreState {
  data: Beneficiaries[]
  loading: boolean
  selectedBeneficiary: Beneficiaries | null
  selectedRowsForDeletion: Beneficiaries[]
  
  // Actions
  setSelectedBeneficiary: (beneficiary: Beneficiaries | null) => void
  setSelectedRowsForDeletion: (rows: Beneficiaries[]) => void
  fetchBeneficiaries: (type: BeneficiaryType) => Promise<void>
  createBeneficiary: (type: BeneficiaryType, formData: Partial<Beneficiaries>, imageFiles?: File[], videoFiles?: File[]) => Promise<boolean>
  updateBeneficiary: (type: BeneficiaryType, updated: Partial<Beneficiaries>) => Promise<void>
  deleteBeneficiary: (type: BeneficiaryType, id: string) => Promise<void>
  bulkDelete: (type: BeneficiaryType, ids: string[]) => Promise<void>
}

export const useBeneficiaryStore = create<BeneficiaryStoreState>((set, get) => ({
  data: [],
  loading: false,
  selectedBeneficiary: null,
  selectedRowsForDeletion: [],
  
  setSelectedBeneficiary: (beneficiary) => set({ selectedBeneficiary: beneficiary }),
  setSelectedRowsForDeletion: (rows) => set({ selectedRowsForDeletion: rows }),

  fetchBeneficiaries: async (type) => {
    set({ loading: true })
    try {
      const res = await fetch(`/api/beneficiaries/get?beneficiary_type=${type}`)
      const json = await res.json()
      set({ data: Array.isArray(json.people) ? json.people : [] })
    } catch {
      set({ data: [] })
    }
    set({ loading: false })
  },

  // Update createBeneficiary to return the created beneficiary ID
  createBeneficiary: async (type, formData, imageFiles = [], videoFiles = []) => {
    try {
      const payload = { ...formData, beneficiary_type: type }
      
      // Create FormData to handle file uploads
      const formDataToSend = new FormData()
      
      // Add form fields
      Object.keys(payload).forEach(key => {
        const value = payload[key as keyof typeof payload]
        if (value !== null && value !== undefined) {
          if (key === 'location_geo' && typeof value === 'object') {
            formDataToSend.append(key, JSON.stringify(value))
          } else {
            formDataToSend.append(key, String(value))
          }
        }
      })
      
      const res = await fetch("/api/admin/beneficiaries/create", {
        method: "POST",
        body: formDataToSend,
      })

      if (!res.ok) {
        const errorText = await res.text()
        console.error("Create beneficiary failed:", errorText)
        return false
      }

      const result = await res.json()
      const beneficiaryId = result.beneficiary?.id

      // Upload files if beneficiary was created successfully
      if (beneficiaryId) {
        // Upload images
        if (imageFiles.length > 0) {
          const imageFormData = new FormData()
          imageFormData.append("beneficiaryId", beneficiaryId)
          imageFiles.forEach((f) => imageFormData.append("images", f))

          await fetch("/api/admin/beneficiaries/images/create", {
            method: "POST",
            body: imageFormData,
          })
        }

        // Upload videos
        if (videoFiles.length > 0) {
          const videoFormData = new FormData()
          videoFormData.append("beneficiaryId", beneficiaryId)
          videoFormData.append("video", videoFiles[0])

          await fetch("/api/admin/beneficiaries/video/create", {
            method: "POST",
            body: videoFormData,
          })
        }
      }

      await get().fetchBeneficiaries(type)
      return true
    } catch (error) {
      console.error("Create beneficiary error:", error)
      return false
    }
  },

  updateBeneficiary: async (type, updated) => {
    try {
      const res = await fetch(`/api/admin/beneficiaries/update/${updated.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      })

      if (!res.ok) {
        const errorData = await res.json()
        console.error("Update beneficiary failed:", errorData)
        return
      }

      await get().fetchBeneficiaries(type)
    } catch (error) {
      console.error("Update beneficiary error:", error)
    }
  },

  deleteBeneficiary: async (type, id) => {
    try {
      const res = await fetch(`/api/admin/beneficiaries/delete/${id}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const errorData = await res.json()
        console.error("Delete beneficiary failed:", errorData)
        return
      }

      await get().fetchBeneficiaries(type)
    } catch (error) {
      console.error("Delete beneficiary error:", error)
    }
  },

  bulkDelete: async (type, ids) => {
    try {
      const res = await fetch("/api/admin/beneficiaries/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        console.error("Bulk delete failed:", errorData)
        return
      }

      await get().fetchBeneficiaries(type)
    } catch (error) {
      console.error("Bulk delete error:", error)
    }
  },
}))

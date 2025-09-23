import { create } from "zustand";
import { Beneficiaries } from "@/types/admin.types";

import { BeneficiaryType } from "@/types/admin.types";

interface BeneficiaryStoreState {
  data: Beneficiaries[];
  loading: boolean;
  formData: Partial<Beneficiaries>;
  formDataEdit: Partial<Beneficiaries>;
  selectedBeneficiary: Beneficiaries | null;
  imageFiles: File[];
  videoFiles: File[];
  selectedRowsForDeletion: Beneficiaries[];
  setFormData: (data: Partial<Beneficiaries>) => void;
  setFormDataEdit: (data: Partial<Beneficiaries>) => void;
  setSelectedBeneficiary: (beneficiary: Beneficiaries | null) => void;
  setImageFiles: (files: File[]) => void;
  setVideoFiles: (files: File[]) => void;
  setSelectedRowsForDeletion: (rows: Beneficiaries[]) => void;
  fetchBeneficiaries: (type: BeneficiaryType) => Promise<void>;
  createBeneficiary: (
    type: BeneficiaryType,
    formData: Partial<Beneficiaries>,
    imageFiles: File[],
    videoFiles: File[]
  ) => Promise<boolean>;
  updateBeneficiary: (type: BeneficiaryType, updated: Partial<Beneficiaries>) => Promise<void>;
  deleteBeneficiary: (type: BeneficiaryType, id: string) => Promise<void>;
  bulkDelete: (type: BeneficiaryType, ids: string[]) => Promise<void>;
}

export const useBeneficiaryStore = create<BeneficiaryStoreState>((set, get) => ({
  data: [],
  loading: false,
  formData: {},
  formDataEdit: {},
  selectedBeneficiary: null,
  imageFiles: [],
  videoFiles: [],
  selectedRowsForDeletion: [],
  setFormData: (data) => set({ formData: data }),
  setFormDataEdit: (data) => set({ formDataEdit: data }),
  setSelectedBeneficiary: (beneficiary) => set({ selectedBeneficiary: beneficiary }),
  setImageFiles: (files) => set({ imageFiles: files }),
  setVideoFiles: (files) => set({ videoFiles: files }),
  setSelectedRowsForDeletion: (rows) => set({ selectedRowsForDeletion: rows }),

  fetchBeneficiaries: async (type) => {
    set({ loading: true });
    try {
      const res = await fetch(`/api/admin/beneficiaries/retrieve?beneficiary_type=${type}`);
      const json = await res.json();
      set({ data: Array.isArray(json.beneficiaries) ? json.beneficiaries : [] });
    } catch {
      set({ data: [] });
    }
    set({ loading: false });
  },

  createBeneficiary: async (type, formData, imageFiles, videoFiles) => {
    try {
      const payload = { ...formData, beneficiary_type: type };
      const res = await fetch("/api/admin/beneficiaries/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        console.error("Create beneficiary failed:", errorData);
        return false;
      }
      
      const result = await res.json();
      const beneficiaryId = result.beneficiary?.id;
      
      if (!beneficiaryId) {
        console.error("No beneficiary ID returned");
        return false;
      }
      
      // Upload images if any
      if (imageFiles && imageFiles.length > 0) {
        try {
          const imageFormData = new FormData();
          imageFiles.forEach((file) => {
            imageFormData.append(`images`, file);
          });
          imageFormData.append('beneficiary_id', beneficiaryId);
          
          const imageRes = await fetch("/api/admin/beneficiaries/images/create", {
            method: "POST",
            body: imageFormData,
          });
          
          if (!imageRes.ok) {
            console.error("Image upload failed:", await imageRes.json());
          }
        } catch (imageError) {
          console.error("Image upload error:", imageError);
        }
      }
      
      // Upload video if any
      if (videoFiles && videoFiles.length > 0) {
        try {
          const videoFormData = new FormData();
          videoFiles.forEach((file) => {
            videoFormData.append(`video`, file);
          });
          videoFormData.append('beneficiary_id', beneficiaryId);
          
          const videoRes = await fetch("/api/admin/beneficiaries/video/create", {
            method: "POST",
            body: videoFormData,
          });
          
          if (!videoRes.ok) {
            console.error("Video upload failed:", await videoRes.json());
          }
        } catch (videoError) {
          console.error("Video upload error:", videoError);
        }
      }
      
      await get().fetchBeneficiaries(type);
      return true;
    } catch (error) {
      console.error("Create beneficiary error:", error);
      return false;
    }
  },

  updateBeneficiary: async (type, updated) => {
    try {
      await fetch(`/api/admin/beneficiaries/update/${updated.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      });
      await get().fetchBeneficiaries(type);
    } catch {}
  },

  deleteBeneficiary: async (type, id) => {
    try {
      await fetch(`/api/admin/beneficiaries/delete/${id}`, { method: "DELETE" });
      await get().fetchBeneficiaries(type);
    } catch {}
  },

  bulkDelete: async (type, ids) => {
    try {
      const response = await fetch("/api/admin/beneficiaries/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error("Bulk delete failed:", errorData);
        throw new Error(errorData.error || "Bulk delete failed");
      }
      
      await get().fetchBeneficiaries(type);
    } catch (error) {
      console.error("Bulk delete error:", error);
      throw error;
    }
  },
}));

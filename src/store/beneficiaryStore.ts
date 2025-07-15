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

  createBeneficiary: async (type, formData) => {
    try {
      const payload = { ...formData, beneficiary_type: type };
      const res = await fetch("/api/admin/beneficiaries/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return false;
      // TODO: handle image/video upload if needed
      await get().fetchBeneficiaries(type);
      return true;
    } catch {
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
      await fetch("/api/beneficiaries/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      await get().fetchBeneficiaries(type);
    } catch {}
  },
}));

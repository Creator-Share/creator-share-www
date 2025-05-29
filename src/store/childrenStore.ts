import { create } from "zustand";
import { Beneficiaries } from "@/types/admin.types";
import { centsToDollars } from "@/utils/currency";

type ChildrenState = {
  data: Beneficiaries[];
  loading: boolean;
  error: string | null;
  formData: Beneficiaries;
  formDataEdit: Beneficiaries;
  selectedChild: Beneficiaries | null;
  imageFiles: File[];
  videoFiles: File[];
  selectedRowsForDeletion: Beneficiaries[];
  fetchChildren: () => Promise<void>;
  createChild: (child: Beneficiaries, imageFiles: File[], videoFiles: File[]) => Promise<boolean>;
  updateChild: (child: Beneficiaries) => Promise<void>;
  deleteChild: (id: string) => Promise<void>;
  bulkDelete: (ids: string[]) => Promise<void>;
  setFormData: (data: Beneficiaries) => void;
  setFormDataEdit: (data: Beneficiaries) => void;
  setSelectedChild: (child: Beneficiaries | null) => void;
  setImageFiles: (files: File[]) => void;
  setVideoFiles: (files: File[]) => void;
  setSelectedRowsForDeletion: (rows: Beneficiaries[]) => void;
  uploadFileToSupabase: (file: File, folder: string) => Promise<string | null>;
};

const defaultBeneficiary: Beneficiaries = {
  name: "",
  gender: "Boy",
  username: "",
  birth_date: "",
  biography: "",
  budget_goal: 0,
  budget_raised: 0,
  status: "New",
  country: "",
  location_geo: null,
  location_str: "",
  video_url: "",
  introduction: "",
  active_subscriptions: 0,
  metadata: {},
  beneficiary_type: "CHILD",
};

export const useChildrenStore = create<ChildrenState>((set, get) => ({
  data: [],
  loading: false,
  error: null,
  formData: { ...defaultBeneficiary },
  formDataEdit: { ...defaultBeneficiary },
  selectedChild: null,
  imageFiles: [],
  videoFiles: [],
  selectedRowsForDeletion: [],
  setFormData: (data) => set({ formData: data }),
  setFormDataEdit: (data) => set({ formDataEdit: data }),
  setSelectedChild: (child) => set({ selectedChild: child }),
  setImageFiles: (files) => set({ imageFiles: files }),
  setVideoFiles: (files) => set({ videoFiles: files }),
  setSelectedRowsForDeletion: (rows) => set({ selectedRowsForDeletion: rows }),
  fetchChildren: async () => {
    set({ loading: true, error: null });
    try {
      const response = await fetch('/api/admin/children/retrieve');
      if (!response.ok) throw new Error('Network response was not ok');
      const fetchedData = await response.json();
      const childrenArr = Array.isArray(fetchedData.children) ? fetchedData.children : [];
      const childrenOnly = childrenArr.filter((b: Beneficiaries) => b.beneficiary_type === "CHILD");
      set({ data: childrenOnly, loading: false });
    } catch {
      set({ error: "Failed to fetch children", loading: false });
    }
  },
  createChild: async (child, imageFiles, videoFiles) => {
    try {
      const budgetGoalInCents = Math.round(parseFloat(child.budget_goal.toString()) * 100);
      const childData = { ...child, budget_goal: budgetGoalInCents };
      const response = await fetch('/api/admin/children/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(childData),
      });
      if (!response.ok) throw new Error('Failed to create beneficiary');
      const newChild = await response.json();

      // Upload images
      const imageUrls: string[] = [];
      if (imageFiles.length > 0) {
        for (const imageFile of imageFiles) {
          const imageUrl = await get().uploadFileToSupabase(imageFile, "images");
          if (imageUrl) imageUrls.push(imageUrl);
        }
        const imageRecords = imageUrls.map((url, index) => ({
          beneficiary_id: newChild.id,
          image_url: url,
          order_index: index
        }));
        const imagesResponse = await fetch('/api/admin/children/images/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: imageRecords }),
        });
        if (!imagesResponse.ok) throw new Error('Failed to create image records');
      }

      // Upload video
      if (videoFiles.length > 0) {
        const videoUrl = await get().uploadFileToSupabase(videoFiles[0], "videos");
        if (videoUrl) {
          const videoUpdateResponse = await fetch('/api/admin/children/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: newChild.id, video_url: videoUrl }),
          });
          if (!videoUpdateResponse.ok) throw new Error('Failed to update video URL');
        }
      }

      set((state) => ({
        data: [...state.data, { ...newChild, budget_goal: centsToDollars(newChild.budget_goal) }],
        formData: { ...defaultBeneficiary },
        imageFiles: [],
        videoFiles: [],
      }));
      return true;
    } catch {
      set({ error: "Failed to create beneficiary" });
      return false;
    }
  },
  updateChild: async (updatedChild) => {
    try {
      const response = await fetch('/api/admin/children/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedChild),
      });
      if (!response.ok) throw new Error('Failed to update beneficiary');
      set((state) => ({
        data: state.data.map(beneficiary =>
          beneficiary.id === updatedChild.id
            ? { ...updatedChild, budget_goal: parseFloat(centsToDollars(updatedChild.budget_goal)) }
            : beneficiary
        ),
      }));
    } catch {
      set({ error: "Failed to update beneficiary" });
    }
  },
  deleteChild: async (beneficiaryId) => {
    try {
      const response = await fetch('/api/admin/children/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ beneficiaryId }),
      });
      if (!response.ok) throw new Error('Failed to delete beneficiary');
      set((state) => ({
        data: state.data.filter(beneficiary => beneficiary.id !== beneficiaryId),
      }));
    } catch {
      set({ error: "Failed to delete beneficiary" });
    }
  },
  bulkDelete: async (beneficiaryIds) => {
    try {
      const response = await fetch("/api/admin/children/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beneficiaryIds }),
      });
      if (!response.ok) throw new Error("Bulk delete failed");
      set((state) => ({
        data: state.data.filter((beneficiary) => beneficiary.id && !beneficiaryIds.includes(beneficiary.id)),
        selectedRowsForDeletion: [],
      }));
    } catch {
      set({ error: "Bulk delete failed" });
    }
  },
  // Helper for file upload
  uploadFileToSupabase: async (file: File, folder: string): Promise<string | null> => {
    const { createClient } = await import("@/utils/supabase/client");
    const supabase = createClient();
    const fileName = `${Date.now()}-${file.name}`;
    const filePath = `${folder}/${fileName}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("beneficiaries")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      const { data } = supabase.storage
        .from("beneficiaries")
        .getPublicUrl(filePath);
      if (!data.publicUrl) throw new Error("Failed to get public URL");
      return data.publicUrl;
    } catch {
      return null;
    }
  },
}));

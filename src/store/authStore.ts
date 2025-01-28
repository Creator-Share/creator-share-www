import { create } from "zustand";
import { createClient } from "@/utils/supabase/client";

interface AuthState {
  user: string | null;
  registrationEmail: string | null;
  logout: () => Promise<void>;
  setRegistrationEmail: (email: string) => void;
  clearRegistrationEmail: () => void;
  fetchUser: () => Promise<void>;
}
const supabase = createClient()

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  registrationEmail: null,
logout: async () => {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        const result = await response.json();
        console.error("Logout API Error:", result.error);
        return;
      }
      set({ user: null });
    } catch (error) {
      console.error("Unexpected logout error:", error);
    }
  },

  fetchUser: async () => {
    const { data } = await supabase.auth.getUser();
    set({ user: data.user?.email || null });
  },
  setRegistrationEmail: (email: string) => set({ registrationEmail: email }),
  clearRegistrationEmail: () => set({ registrationEmail: null }),
}));

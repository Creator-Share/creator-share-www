import { create } from "zustand";
import { createClient } from "@/utils/supabase/client";
import { AuthState } from "@/types";

const supabase = createClient();

export const useAuthStore = create<AuthState>((set) => {
  supabase.auth.onAuthStateChange((_, session) => {
    set({ user: session?.user || null });
  });

  return {
    user: null,
    registrationEmail: null,

    logout: async () => {
      try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
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
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        if (error.message === "Auth session missing!") {
          set({ user: null });
        } else {
          console.error("Error fetching user:", error);
          set({ user: null });
        }
      } else {
        set({ user: data.user || null });
      }
    },

    setRegistrationEmail: (email: string) => set({ registrationEmail: email }),
    clearRegistrationEmail: () => set({ registrationEmail: null }),
  };
});

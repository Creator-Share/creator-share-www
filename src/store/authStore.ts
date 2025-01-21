import { create } from "zustand";
import { supabase } from "@/utils/supabaseClient";

interface AuthState {
  user: string | null;
  registrationEmail: string | null;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  setRegistrationEmail: (email: string) => void;
  clearRegistrationEmail: () => void;
  fetchUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  registrationEmail: null,
  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("Login Error:", error.message);
      return { error: error.message };
    }

    set({ user: data.user?.email || null });
    return {};
  },

  logout: async () => {
    await supabase.auth.signOut();
    set({ user: null });
  },

  fetchUser: async () => {
    const { data } = await supabase.auth.getUser();
    set({ user: data.user?.email || null });
  },
  setRegistrationEmail: (email: string) => set({ registrationEmail: email }),
  clearRegistrationEmail: () => set({ registrationEmail: null }),
}));

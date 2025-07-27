import { User } from "@supabase/supabase-js";
export interface AuthState {
  user: User | null;
  registrationEmail: string | null;
  logout: () => Promise<void>;
  setRegistrationEmail: (email: string) => void;
  clearRegistrationEmail: () => void;
  fetchUser: () => Promise<void>;
}

export interface FormValues {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface loginForm {
    email: string;
    password: string;
  }

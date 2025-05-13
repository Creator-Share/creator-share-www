import { User } from "@supabase/supabase-js";

type Geography = {
  coordinates: [number, number];
  type: "Point";
};

export type SponsorshipType = 'STREET_INVOLVED' | 'CHILD_LABOR' | 'FAMILY' | 'PUPPY' | 'CHILD';

export type SponsorshipStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE';

export interface Sponsorship {
  id: string;
  created_at: string;
  sponsorship_type: SponsorshipType;
  status: SponsorshipStatus;
  location_str: string;
  location_geo: Geography | null;
  story: string;
  budget_goal: number;
  budget_raised: number;
  monthly_support_cost: number;
}

// Type-specific interfaces extending base Sponsorship
export interface ChildSponsorship extends Sponsorship {
  name: string;
  birth_date: string;
  gender: string;
  biography: string;
  country: string;
  video_url: string;
  introduction: string;
  image_url?: string;
}

export interface StreetInvolvedSponsorship extends Sponsorship {
  name: string;
  age: number;
  gender: string;
  background_story: string;
  current_situation: string;
}

export interface ChildLaborSponsorship extends Sponsorship {
  name: string;
  age: number;
  gender: string;
  background_story: string;
  country: string;
  birth_date: string;
  video_url: string;
}

export interface FamilySponsorship extends Sponsorship {
  family_name: string;
  members_count: number;
}

export interface PuppySponsorship extends Sponsorship {
  name: string;
  breed: string;
  age_months: number;
  gender: string;
  medical_history: string;
  vaccination_status: string;
}

export interface SponsorshipImage {
  id: string;
  sponsorship_id: string;
  image_url: string;
  order_index: number;
  created_at: string;
}

export interface Subscription {
  id: string;
  created_at: string;
  user_id: string;
  sponsorship_id: string;
  amount: number;
  currency: string;
  interval: string;
  stripe_price_id: string;
  stripe_subscription_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  canceled_at?: string;
  sponsorship_type: SponsorshipType;
}

export interface Activity {
  id: string;
  description: string;
  created_at: string;
  sponsorship_id: string;
}

export interface TransactionLedger {
  id: string;
  created_at: string;
  user_id: string;
  sponsorship_id: string;
  credit: number;
  amount: number;
  customer_email: string;
  customer_name: string;
  reference: string;
  description: string;
  tx_action: string;
  sponsorship_type: SponsorshipType;
  payment_status: string;
  stripe_payment_intent: string;
  payment_method_type: string;
  currency: string;
}

//Auth types
export interface loginForm {
  email: string;
  password: string;
}

export interface RoleAssignment {
  roles: {
    name: string;
  };
}

export interface AuthState {
  user: User | null;
  registrationEmail: string | null;
  logout: () => Promise<void>;
  setRegistrationEmail: (email: string) => void;
  clearRegistrationEmail: () => void;
  fetchUser: () => Promise<void>;
}

export interface FilterState {
  selectedGender: string;
  selectedAgeRange: [number, number];
  selectedStatus: string[];
  selectedType?: SponsorshipType;
  setGender: (gender: string) => void;
  setAgeRange: (ageRange: [number, number]) => void;
  setStatus: (status: string[]) => void;
  setType?: (type: SponsorshipType) => void;
  clearFilters: () => void;
}

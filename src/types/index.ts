import { User } from "@supabase/supabase-js";

type Geography = {
  coordinates: [number, number];
  type: "Point";
};

export interface SponsorPeople {
  id: string;
  name: string;
  username: string;
  gender: string;
  birth_date: number;
  image_url: string;
  biography: string;
  country_group: string;
  time_in_site: string;
  budget_goal: number;
  budget_raised: number;
  status: string;
  country: string;
  location_geo: Geography;
  video_url: string;
  introduction: string;
}

export interface SponsorPeopleImage {
  id: string;
  sponsor_people_id: string;
  image_url: string;
  order_index: number;
}

export interface Subscription {
  id: string;
  created_at: string;
  amount: number;
  interval: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  stripe_subscription_id: string;
  child: {
    name: string;
  };
}

export interface Activity {
  id: string;
  description: string;
  created_at: string;
  child_id: string;
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
  setGender: (gender: string) => void;
  setAgeRange: (ageRange: [number, number]) => void;
  setStatus: (status: string[]) => void;
  clearFilters: () => void;
}

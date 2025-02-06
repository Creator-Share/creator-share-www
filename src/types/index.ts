import { User } from "@supabase/supabase-js"; 



type Geography = {
  coordinates: [number, number];
  type: 'Point';
};

export interface People {
    id: string;
    name: string;
    gender:string;
    birth_date: number;
    image_url: string;
    biography: string;
    country_group: string;
    time_in_site: string;
    budget_goal: number;
    budget_raised: number;
    status: string;
    country:string;
    location_geo: Geography;
    video_url: string;
    introduction: string
  }

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
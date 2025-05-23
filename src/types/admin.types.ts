export type Gender = "Boy" | "Girl";
export type PersonStatus = "New" | "Partially Funded" | "Budget Fulfilled" | "Archived" | "Draft";
export type BeneficiaryType = "CHILD" | "ANIMAL" | "FAMILY";

export interface Geography {
  coordinates: [number, number];
  type: "Point";
}

export interface Beneficiaries {
  id?: string;
  name: string;
  username: string;
  gender: Gender;
  birth_date: string;
  biography: string;
  budget_goal: number;
  budget_raised: number;
  status: PersonStatus;
  country: string;
  location_geo: Geography | null;
  location_str: string;
  video_url: string;
  introduction: string;
  active_subscriptions: number;
  metadata: Record<string, unknown>;
  beneficiary_type: BeneficiaryType;
}

export interface Activity {
  id: string;
  description: string;
  created_at: string;
  beneficiary_id: string;
  title: string;
  images_url?: string[];
  videos_url?: string[];
}

export interface BeneficiaryMedia {
  id: string;
  beneficiary_id: string;
  image_url: string;
  order_index: number;
  created_at: string;
  acitivy_id?:string;
}

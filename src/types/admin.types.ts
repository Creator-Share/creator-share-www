export type Gender = "Boy" | "Girl";
export type Status = "New" | "Partially Funded" | "Budget Fulfilled" | "Archived" | "Draft";
export type BeneficiaryType = "CHILD" | "ANIMAL" | "FAMILY" | "STREET_INVOLVED" | "CHILD_LABORER";

export interface Geography {
  coordinates: [number, number];
  type: "Point";
}

export interface Beneficiaries {
  id?: string;
  name: string;
  username: string;
  gender?: Gender;
  birth_date?: string;
  biography: string;
  budget_goal: number;
  budget_raised: number;
  status: Status;
  country: string;
  location_geo: Geography | null;
  location_str: string;
  video_url: string;
  introduction: string;
  active_subscriptions: number;
  metadata: Record<string, unknown>;
  beneficiary_type: BeneficiaryType;
  image_url?: string;
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
  acitivy_id?: string;
  type?: "IMAGE" | "VIDEO" | "images" | "videos"; // Add this field
}

export type AnimalBeneficiary = {
  id?: string;
  name: string;
  username: string;
  biography: string;
  introduction: string;
  budget_goal: string | number;
  budget_raised: number;
  status: Status;
  country: string;
  location_str: string;
  gender: Gender;
  video_url?: string;
  birth_date: string;
  active_subscriptions?: number;
  beneficiary_type: "ANIMAL";
  metadata: {
    breed?: string;
    animal_type?: string;
    [key: string]: unknown;
  };
  breed?: string;
  animal_type?: string;
};

export interface Expense {
  id?: string;
  created_at?: string;
  name: string;
  description: string;
  organization_id?: string;
  price: number;
  icon?: string;
}

export interface ExpenseAssignment {
  id?: string;
  created_at?: string;
  beneficiary_id: string;
  expense_id: string;
  weight: number;
  fulfilled: boolean;
  onetime_expense: boolean;
  expenses?: Expense; // Add this to handle nested expense data
}

export interface ExpenseWithAssignment extends Expense {
  assignment?: ExpenseAssignment;
}

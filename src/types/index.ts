import { User } from "@supabase/supabase-js"

export type Gender = "Boy" | "Girl"
export type Status =
  | "New"
  | "Partially Funded"
  | "Budget Fulfilled"
  | "Archived"
  | "Draft"
  | "Sponsorship Cancelled"
export type BeneficiaryType = "CHILD" | "ANIMAL" | "FAMILY"

type Geography = {
  coordinates: [number, number]
  type: "Point"
}

export interface Beneficiaries {
  id: string
  name: string
  username: string
  gender: Gender
  age?: number
  birth_date: string
  biography: string
  budget_goal: number
  budget_raised: number
  status: Status
  country: string
  location_geo: Geography | null
  location_str: string
  video_url: string
  introduction: string
  active_subscriptions: number
  metadata: Record<string, unknown>
  beneficiary_type: BeneficiaryType
  image_url?: string
  sort_weight?: number
  created_at?: string
}

export interface BeneficiaryMedia {
  id: string
  beneficiary_id: string
  image_url: string
  order_index: number
  created_at: string
  activity_id?: string // Fixed typo in property name
}

export interface Subscription {
  id: string
  created_at: string
  amount: number
  interval: string
  status: string
  current_period_start: string
  current_period_end: string
  sponsorship_id: string
  beneificiary: {
    name: string
  }
}

export interface Activity {
  id: string
  description: string
  created_at: string
  beneficiary_id: string
  user_id: string | null
  title: string
  images_url?: string[]
  videos_url?: string[]
  activity_type: "INFO" | "UPDATE" | "SUBSCRIPTION"
  created_by: string
  metadata?: {
    media?: {
      images?: string[]
      videos?: string[]
    }
  }
  activity_source: "admin" | "sponsorship" | "system"
}

//Auth types

export interface loginForm {
  email: string
  password: string
}

export interface Role {
  name: string
}

export interface RoleAssignment {
  roles: Role
}

export interface SingleRoleData {
  roles: {
    name: string
  }[]
}

export type RoleAssignmentResponse = RoleAssignment[]

export interface AuthState {
  user: User | null
  registrationEmail: string | null
  logout: () => Promise<void>
  setRegistrationEmail: (email: string) => void
  clearRegistrationEmail: () => void
  fetchUser: () => Promise<void>
}

export interface FilterState {
  selectedGender: string
  selectedAgeRange: [number, number]
  selectedStatus: string[]
  setGender: (gender: string) => void
  setAgeRange: (ageRange: [number, number]) => void
  setStatus: (status: string[]) => void
  resetToDefaults: () => void
  isDirty: () => boolean
}

// Export Telegram types
export * from './telegram.types'

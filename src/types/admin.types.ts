import type { Status } from "@/config/beneficiaryStatuses"
import type { Database } from "@/lib/types/db.types"

// Re-export so consumers importing from "@/types/admin.types" continue to work
export type { Status }

export type Gender = "Boy" | "Girl"

/**
 * Source of truth for valid beneficiary_type values.
 *
 * Mirrors the active types in src/config/beneficiaryTypes.ts (BeneficiaryTabType).
 * The DB column is plain text; this list is enforced at write boundaries via
 * isBeneficiaryType. To add a type, add it here and to ALL_BENEFICIARY_TABS.
 */
export const BENEFICIARY_TYPES = [
  "CHILD",
  "CHILD_LABORER",
  "SPECIAL_NEEDS",
  "IN_OUR_CARE",
  "ANIMAL",
] as const

export type BeneficiaryType = (typeof BENEFICIARY_TYPES)[number]

export function isBeneficiaryType(v: unknown): v is BeneficiaryType {
  return (
    typeof v === "string" &&
    (BENEFICIARY_TYPES as readonly string[]).includes(v)
  )
}

export interface Geography {
  coordinates: [number, number]
  type: "Point"
}

export interface BeneficiaryMetadata {
  birth_date_is_estimate?: boolean
  [key: string]: unknown
}

export interface Beneficiaries {
  id?: string
  name: string
  username: string
  gender?: Gender
  birth_date?: string
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
  metadata: BeneficiaryMetadata
  beneficiary_type: BeneficiaryType
  image_url?: string
  created_at?: string
  sort_weight?: number
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
  documents_url?: string[]
  activity_type: "INFO" | "UPDATE" | "SUBSCRIPTION"
  created_by: string
  is_public?: boolean
  metadata?: {
    media?: {
      images?: string[]
      videos?: string[]
    }
  }
  activity_source: "admin" | "sponsorship" | "system"
}

export interface BeneficiaryWithActivity extends Beneficiaries {
  last_activity_date: string | null
  days_since_last_activity: number | null
  has_activity: boolean
  /** True if this beneficiary has at least one public activity with an image or video attachment */
  has_public_activity_media: boolean
}

export interface BeneficiaryMedia {
  id: string
  parent_id: string
  extension: string
  type: "IMAGE" | "VIDEO"
  weight: number | null
  created_at: string | null
}

export type AnimalBeneficiary = {
  id?: string
  name: string
  username: string
  biography: string
  introduction: string
  budget_goal: string | number
  budget_raised: number
  status: Status
  country: string
  location_str: string
  gender: Gender
  video_url?: string
  birth_date: string
  active_subscriptions?: number
  beneficiary_type: "ANIMAL"
  metadata: {
    breed?: string
    animal_type?: string
    [key: string]: unknown
  }
  breed?: string
  animal_type?: string
}

export interface Expense {
  id?: string
  created_at?: string
  name: string
  description: string
  organization_id?: string
  price: number
  icon?: string
}

export interface ExpenseAssignment {
  id?: string
  created_at?: string
  beneficiary_id: string
  expense_id: string
  weight: number
  fulfilled: boolean
  onetime_expense: boolean
  expenses?: Expense // Add this to handle nested expense data
}

export interface ExpenseWithAssignment extends Expense {
  assignment?: ExpenseAssignment
}

// Manage Users Types
export interface User {
  id: string
  first_name: string | null
  last_name: string | null
  email: string
  created_at: string
}

export interface Role {
  id: string
  name: string
  description: string | null
  display_name: string | null
  created_at: string
}

export interface UserRole {
  id: string
  user_id: string
  role_id: string
  created_at: string
  user?: User
  role?: Role
}

export interface UserInvitation {
  email: string
  role_ids: string[]
  invited_by: string
}

export interface UserManagementState {
  users: UserRole[]
  roles: Role[]
  loading: boolean
  error: string | null
  selectedUsers: Set<string>
}

export interface UserManagementActions {
  fetchUsers: () => Promise<void>
  fetchRoles: () => Promise<void>
  inviteUser: (invitation: UserInvitation) => Promise<boolean>
  assignRole: (userId: string, roleId: string) => Promise<boolean>
  removeRole: (userId: string, roleId: string) => Promise<boolean>
  deleteUser: (userId: string) => Promise<boolean>
  updateUserRole: (userId: string, roleId: string) => Promise<boolean>
  assignMultipleRoles: (userId: string, roleIds: string[]) => Promise<boolean>
  bulkDeleteUsers: (userIds: string[]) => Promise<boolean>
  setSelectedUsers: (userIds: Set<string>) => void
  clearError: () => void
}

export type UserRoleName = "SUPER_ADMIN" | "EMPLOYEE"

export interface RolePermissions {
  canManageUsers: boolean
  canAssignRoles: boolean
  canAccessAdmin: boolean
  canManageBeneficiaries: boolean
  canManageActivities: boolean
  canManageExpenses: boolean
}

// Permission mapping based on role
export const ROLE_PERMISSIONS: Record<UserRoleName, RolePermissions> = {
  SUPER_ADMIN: {
    canManageUsers: true,
    canAssignRoles: true,
    canAccessAdmin: true,
    canManageBeneficiaries: true,
    canManageActivities: true,
    canManageExpenses: true,
  },
  EMPLOYEE: {
    canManageUsers: false,
    canAssignRoles: false,
    canAccessAdmin: true,
    canManageBeneficiaries: true,
    canManageActivities: true,
    canManageExpenses: false,
  },
}

//subscriptions
//
// Field names mirror the live DB schema. Historically this carried
// `child_id` and `sponsorship_id`, but the underlying columns are
// `beneficiary_id` (since 20251006120000_missing_migrations.sql) and the
// row's own primary key (`id`); there is no separate sponsorship id. The
// admin page now reads beneficiary_id and passes subscription.id to the
// cancel endpoint, which dispatches against either the DB id or the
// stripe_subscription_id via findSubscription.
export interface RawSubscription {
  id: string
  beneficiary_id: string | null
  status: string
  amount: number
  charged_amount?: number | null
  charged_currency?: Database["public"]["Enums"]["payment_currency"]
  charged_currency_minor_unit?: number
  conversion_rate?: number
  conversion_rate_source?: string
  currency_config_version?: string
  interval: string
  current_period_start: string
  current_period_end: string
  created_at: string
  user_id: string
  sponsorship_method: "STRIPE" | "PAYPAL" | null
  payment_region: Database["public"]["Enums"]["stripe_region"]
  beneficiaries?: {
    id: string
    name: string
    username: string
  } | null
}

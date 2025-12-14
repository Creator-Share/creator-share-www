export type Gender = "Boy" | "Girl"
export type Status =
  | "New"
  | "Partially Funded"
  | "Budget Fulfilled"
  | "Archived"
  | "Draft"
  | "Sponsorship Cancelled"
export type BeneficiaryType =
  | "CHILD"
  | "ANIMAL"
  | "FAMILY"
  | "STREET_INVOLVED"
  | "CHILD_LABORER"

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

export interface BeneficiaryMedia {
  id: string
  beneficiary_id: string
  image_url: string
  order_index: number
  created_at: string
  acitivy_id?: string
  type?: "IMAGE" | "VIDEO" | "images" | "videos" // Add this field
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
export interface RawSubscription {
  id: string
  child_id: string
  status: string
  amount: number
  interval: string
  current_period_start: string
  current_period_end: string
  created_at: string
  sponsorship_id: string
  user_id: string
  beneficiaries?: {
    id: string
    name: string
    username: string
  } | null
}

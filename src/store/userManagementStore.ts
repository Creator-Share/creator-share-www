import { create } from "zustand"
import { UserManagementState, UserManagementActions, UserInvitation } from "@/types/admin.types"

interface UserManagementStore extends UserManagementState, UserManagementActions {}

export const useUserManagementStore = create<UserManagementStore>((set, get) => ({
  // State
  users: [],
  roles: [],
  loading: false,
  error: null,
  selectedUsers: new Set(),

  // Actions
  fetchUsers: async () => {
    set({ loading: true, error: null })
    try {
      const response = await fetch("/api/admin/users")
      if (!response.ok) {
        throw new Error("Failed to fetch users")
      }
      const users = await response.json()
      set({ users, loading: false })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
    }
  },

  fetchRoles: async () => {
    set({ loading: true, error: null })
    try {
      const response = await fetch("/api/admin/roles")
      if (!response.ok) {
        throw new Error("Failed to fetch roles")
      }
      const roles = await response.json()
      set({ roles, loading: false })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
    }
  },

  inviteUser: async (invitation: UserInvitation) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invitation),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to invite user")
      }

      await get().fetchUsers()
      set({ loading: false })
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
      return false
    }
  },

  assignRole: async (userId: string, roleId: string) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch("/api/admin/users/assign-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roleId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to assign role")
      }

      await get().fetchUsers()
      set({ loading: false })
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
      return false
    }
  },

  removeRole: async (userId: string, roleId: string) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch("/api/admin/users/remove-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roleId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to remove role")
      }

      await get().fetchUsers()
      set({ loading: false })
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
      return false
    }
  },

  deleteUser: async (userId: string) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to delete user")
      }

      await get().fetchUsers()
      set({ loading: false })
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
      return false
    }
  },

  bulkDeleteUsers: async (userIds: string[]) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch('/api/admin/users/bulk-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: userIds }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to delete users')
      }

      // Refresh the users list
      await get().fetchUsers()
      set({ loading: false })
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
      throw error
    }
  },

  updateUserRole: async (userId: string, roleId: string) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch("/api/admin/users/update-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roleId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to update user role")
      }

      await get().fetchUsers()
      set({ loading: false })
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
      return false
    }
  },

  assignMultipleRoles: async (userId: string, roleIds: string[]) => {
    set({ loading: true, error: null })
    try {
      const response = await fetch("/api/admin/users/assign-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, roleIds }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to assign roles")
      }

      await get().fetchUsers()
      set({ loading: false })
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      set({ error: errorMessage, loading: false })
      return false
    }
  },

  setSelectedUsers: (userIds: Set<string>) => {
    set({ selectedUsers: userIds })
  },

  clearError: () => {
    set({ error: null })
  },
})) 
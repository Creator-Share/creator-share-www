"use client"
import React, { useEffect, useState } from "react"
import { Box, Text, Flex, Button, Menu, Portal } from "@chakra-ui/react"
import { useUserManagementStore } from "@/store/userManagementStore"
import { UserRole, User, Role } from "@/types/admin.types"
import { InviteUserDialog } from "./components/InviteUserDialog"
import { EditRoleDialog } from "./components/EditRoleDialog"
import { BulkActionButton } from "@/components/admin-ui/BulkActionButton"
import DeleteDialog from "../beneficiaries/components/DeleteDialog"
import { toaster } from "@/components/ui/toaster"
import { Checkbox } from "@/components/ui/checkbox"
import { GoPlusCircle } from "react-icons/go"
import { HiDotsVertical } from "react-icons/hi"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { LogoLoader } from "@/components/common/LogoLoader"

const UserManagement = () => {
  const {
    users,
    roles,
    loading,
    error,
    selectedUsers,
    fetchUsers,
    fetchRoles,
    deleteUser,
    assignMultipleRoles,
    setSelectedUsers,
    clearError,
    bulkDeleteUsers,
  } = useUserManagementStore()

  const [isInviteDrawerOpen, setIsInviteDrawerOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isEditRoleDialogOpen, setIsEditRoleDialogOpen] = useState(false)
  const [usersToDelete, setUsersToDelete] = useState<UserRole[]>([])
  const [userToEditRole, setUserToEditRole] = useState<UserRole | null>(null)
  const [userRoleAssignments, setUserRoleAssignments] = useState<UserRole[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [isClient, setIsClient] = useState(false)

  // Fix hydration by ensuring client-side rendering
  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    fetchUsers()
    fetchRoles()
  }, [fetchUsers, fetchRoles])

  useEffect(() => {
    if (error) {
      // Defer toast to avoid flushSync error
      setTimeout(() => {
        toaster.create({
          title: "Error",
          description: error,
          duration: 5000,
        })
      }, 0)
      clearError()
    }
  }, [error, clearError])

  // Group users by user_id to handle multiple roles
  const groupedUsers = users.reduce((acc, userRole) => {
    const userId = userRole.user_id
    if (!acc[userId]) {
      acc[userId] = {
        user: userRole.user,
        roles: [],
        created_at: userRole.created_at,
      }
    }
    // Only push non-null roles
    if (userRole.role) {
      acc[userId].roles.push(userRole.role)
    }
    return acc
  }, {} as Record<string, { user: User | undefined; roles: (Role | undefined)[]; created_at: string }>)

  // Separate users with roles and users without roles
  const usersWithRoles = Object.values(groupedUsers).filter(
    (userGroup) =>
      userGroup.roles.length > 0 &&
      userGroup.roles.some((role) => role !== null && role !== undefined)
  )

  const usersWithoutRoles = Object.values(groupedUsers).filter(
    (userGroup) =>
      userGroup.roles.length === 0 ||
      userGroup.roles.every((role) => role === null || role === undefined)
  )

  // Filter both groups based on search term
  const filteredUsersWithRoles = usersWithRoles.filter(
    (userGroup) =>
      userGroup.user?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      userGroup.user?.first_name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      userGroup.user?.last_name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      userGroup.roles.some((role) =>
        role?.name?.toLowerCase().includes(searchTerm.toLowerCase())
      )
  )

  const filteredUsersWithoutRoles = usersWithoutRoles.filter(
    (userGroup) =>
      userGroup.user?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      userGroup.user?.first_name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase()) ||
      userGroup.user?.last_name
        ?.toLowerCase()
        .includes(searchTerm.toLowerCase())
  )

  // Get all unique user IDs from filtered results
  const allFilteredUserIds = [
    ...filteredUsersWithRoles.map((u) => u.user?.id).filter(Boolean),
    ...filteredUsersWithoutRoles.map((u) => u.user?.id).filter(Boolean),
  ].filter(Boolean) as string[]

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allUserIds = new Set(allFilteredUserIds)
      setSelectedUsers(allUserIds)
    } else {
      setSelectedUsers(new Set())
    }
  }

  const handleSelectUser = (userId: string, checked: boolean) => {
    const newSelected = new Set(selectedUsers)
    if (checked) {
      newSelected.add(userId)
    } else {
      newSelected.delete(userId)
    }
    setSelectedUsers(newSelected)
  }

  const handleBulkDelete = () => {
    if (selectedUsers.size === 0) {
      toaster.create({
        title: "No Selection",
        description: "No users selected for deletion.",
        duration: 5000,
      })
      return
    }

    const selectedUserRoles = users.filter(
      (user) => user.user?.id && selectedUsers.has(user.user.id)
    )
    setUsersToDelete(selectedUserRoles)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    try {
      const userIds = usersToDelete.map((user) => user.user_id).filter(Boolean)

      // Try bulk delete first (fastest)
      try {
        await bulkDeleteUsers(userIds)
      } catch (bulkError) {
        console.warn(
          "Bulk delete failed, falling back to parallel individual deletes:",
          bulkError
        )

        // Fallback to parallel individual deletes (still much faster than sequential)
        const deletePromises = usersToDelete.map((user) =>
          deleteUser(user.user_id)
        )
        await Promise.all(deletePromises)
      }

      setSelectedUsers(new Set())
      setUsersToDelete([])
      setIsDeleteDialogOpen(false)
      toaster.create({
        title: "Success",
        description: `Successfully deleted ${userIds.length} users.`,
        duration: 5000,
      })
    } catch (error) {
      console.error("Bulk delete error:", error)
      toaster.create({
        title: "Error",
        description: `Failed to delete users: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        duration: 5000,
      })
    }
  }

  const handleEditRole = (userGroup: {
    user: User | undefined
    roles: (Role | undefined)[]
    created_at: string
  }) => {
    if (userGroup.user?.id) {
      const allUserRoleAssignments = users.filter(
        (user) => user.user?.id === userGroup.user?.id
      )
      if (allUserRoleAssignments.length > 0) {
        setUserToEditRole(allUserRoleAssignments[0])
        setUserRoleAssignments(allUserRoleAssignments)
        setIsEditRoleDialogOpen(true)
      }
    }
  }

  const handleRoleUpdate = async (userId: string, roleIds: string[]) => {
    await assignMultipleRoles(userId, roleIds)
  }

  // Fix the selection logic - check against filtered users, not all users
  const isAllSelected =
    allFilteredUserIds.length > 0 &&
    allFilteredUserIds.every((userId) => selectedUsers.has(userId))
  const isSomeSelected =
    allFilteredUserIds.some((userId) => selectedUsers.has(userId)) &&
    !isAllSelected

  // Helper function to format date consistently
  const formatDate = (dateString: string) => {
    if (!isClient) return "Loading..."
    try {
      return new Date(dateString).toLocaleDateString()
    } catch {
      return "Invalid Date"
    }
  }

  const renderUserCard = (userGroup: {
    user: User | undefined
    roles: (Role | undefined)[]
    created_at: string
  }) => {
    return (
      <Box
        key={`${userGroup.user?.id}`}
        className="border border-gray-200 rounded-lg p-4 bg-white hover:shadow-md transition-shadow"
      >
        {/* Checkbox and Menu aligned in the same row */}
        <Flex justify="space-between" align="center" mb={3}>
          <Checkbox
            checked={selectedUsers.has(userGroup.user?.id || "")}
            onCheckedChange={(checked) =>
              handleSelectUser(userGroup.user?.id || "", !!checked)
            }
            className="h-5 w-5 border-2 border-gray-400"
          />

          {/* Ellipses Menu - Aligned with checkbox */}
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="flex items-center justify-center p-2 hover:bg-gray-100 rounded-md"
              >
                <HiDotsVertical className="w-5 h-5 text-gray-600" />
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  <Menu.Item
                    value="edit"
                    onClick={() => handleEditRole(userGroup)}
                    className="flex items-center gap-2 text-blue-600 hover:bg-blue-50"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    Edit Role
                  </Menu.Item>
                  <Menu.Item
                    value="delete"
                    onClick={() => {
                      if (userGroup.user?.id) {
                        deleteUser(userGroup.user.id)
                      }
                    }}
                    className="flex items-center gap-2 text-red-600 hover:bg-red-50"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Delete
                  </Menu.Item>
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Flex>

        {/* User info - Mobile optimized */}
        <Box className="space-y-3">
          <Box>
            <Text fontSize="lg" fontWeight="bold" mb={1} className="break-all">
              {userGroup.user?.email || "No email"}
            </Text>

            <Text fontSize="sm" color="gray.600">
              <strong>Name:</strong> {userGroup.user?.first_name || "N/A"}{" "}
              {userGroup.user?.last_name || ""}
            </Text>
          </Box>

          {/* Roles - Mobile optimized */}
          <Box>
            <Text
              as="span"
              fontWeight="bold"
              fontSize="sm"
              color="gray.600"
              display="block"
              mb={2}
            >
              Roles:
            </Text>
            <Box className="flex flex-wrap gap-1">
              {userGroup.roles && userGroup.roles.length > 0 ? (
                userGroup.roles
                  .filter((role) => role !== null && role !== undefined)
                  .map((role, roleIndex) => (
                    <span
                      key={roleIndex}
                      className={`px-2 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
                        role?.name === "SUPER_ADMIN"
                          ? "bg-red-100 text-red-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {role?.display_name || role?.name || "N/A"}
                    </span>
                  ))
              ) : (
                <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600 whitespace-nowrap">
                  No roles assigned
                </span>
              )}
            </Box>
          </Box>

          <Text fontSize="sm" color="gray.600">
            <strong>Joined:</strong> {formatDate(userGroup.created_at)}
          </Text>

          {userGroup.roles && userGroup.roles.length > 0 && (
            <Text fontSize="sm" color="gray.500" className="leading-relaxed">
              {userGroup.roles
                .filter((role) => role !== null && role !== undefined)
                .map((role) => role?.description)
                .filter(Boolean)
                .join(" • ")}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  if (loading) {
    return <LogoLoader size="lg" minHeight="100vh" />
  }

  const totalFilteredUsers =
    filteredUsersWithRoles.length + filteredUsersWithoutRoles.length
  const hasResults = totalFilteredUsers > 0

  return (
    <AdminPageLayout
      title="Manage Users"
      description="Manage user accounts and role assignments"
      breadcrumb={[{ label: "Manage Users" }]}
      searchPlaceholder="Search by email, name, or role..."
      searchValue={searchTerm}
      onSearchChange={setSearchTerm}
      showSelectAll={true}
      isAllSelected={isAllSelected}
      isSomeSelected={isSomeSelected}
      onSelectAll={handleSelectAll}
      selectedCount={selectedUsers.size}
      totalCount={totalFilteredUsers}
      bulkActions={
        selectedUsers.size > 0 ? (
          <BulkActionButton
            label="Delete"
            count={selectedUsers.size}
            action={handleBulkDelete}
            className="border-[2px] border-transparent rounded-md w-full md:w-auto h-[40px] px-6 bg-[#ff0000] text-white hover:bg-[#ff0000] hover:text-white justify-center"
          />
        ) : undefined
      }
      primaryAction={
        <Button
          onClick={() => setIsInviteDrawerOpen(true)}
          className="border-[2px] border-[#E0E0E0] rounded-md w-full md:w-auto h-[40px] px-6 bg-[#2b7ff9] text-white hover:bg-[#2b7ff9] justify-center"
        >
          <GoPlusCircle className="mr-2" />
          Invite User
        </Button>
      }
      showResults={hasResults}
      noResultsMessage="No users found matching your search."
    >
      {/* Users with Roles Section - Mobile optimized */}
      {filteredUsersWithRoles.length > 0 && (
        <Box className="mb-6 md:mb-8">
          <Flex
            align="center"
            gap={3}
            mb={4}
            direction="column"
            className="md:flex-row md:items-center"
          >
            <Flex align="center" gap={3} className="w-full md:w-auto">
              <Box className="h-6 w-1 bg-blue-500 rounded-full md:h-8" />
              <Text
                fontSize="lg"
                fontWeight="bold"
                color="gray.800"
                className="md:text-xl"
              >
                Users with Roles
              </Text>
              <Box className="bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-xs font-medium md:text-sm">
                {filteredUsersWithRoles.length}
              </Box>
            </Flex>
          </Flex>
          <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsersWithRoles.map(renderUserCard)}
          </Box>
        </Box>
      )}

      {/* Users without Roles Section - Mobile optimized */}
      {filteredUsersWithoutRoles.length > 0 && (
        <Box className="mb-6 md:mb-8">
          <Flex
            align="center"
            gap={3}
            mb={4}
            direction="column"
            className="md:flex-row md:items-center"
          >
            <Flex align="center" gap={3} className="w-full md:w-auto">
              <Box className="h-6 w-1 bg-orange-500 rounded-full md:h-8" />
              <Text
                fontSize="lg"
                fontWeight="bold"
                color="gray.800"
                className="md:text-xl"
              >
                Users without Roles
              </Text>
              <Box className="bg-orange-100 text-orange-800 px-2 py-1 rounded-full text-xs font-medium md:text-sm">
                {filteredUsersWithoutRoles.length}
              </Box>
            </Flex>
          </Flex>
          <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsersWithoutRoles.map(renderUserCard)}
          </Box>
        </Box>
      )}

      {/* Invite User Dialog */}
      <InviteUserDialog
        isOpen={isInviteDrawerOpen}
        onClose={() => setIsInviteDrawerOpen(false)}
      />

      {/* Delete Dialog */}
      <DeleteDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        itemCount={usersToDelete.length}
      />

      {/* Edit Role Dialog */}
      <EditRoleDialog
        isOpen={isEditRoleDialogOpen}
        onClose={() => setIsEditRoleDialogOpen(false)}
        user={userToEditRole}
        userRoles={userRoleAssignments}
        allRoles={roles}
        onRoleUpdate={handleRoleUpdate}
      />
    </AdminPageLayout>
  )
}

export default UserManagement

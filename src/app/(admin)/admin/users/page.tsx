"use client"
import React, { useEffect, useState } from "react"
import { Box, Text, Flex, Button, Input } from "@chakra-ui/react"
import { useUserManagementStore } from "@/store/userManagementStore"
import { UserRole, User, Role } from "@/types/admin.types"
import {InviteUserDialog} from "./components/InviteUserDialog"
import { EditRoleDialog } from "./components/EditRoleDialog"
import { BulkActionButton } from "@/components/admin-ui/BulkActionButton"
import DeleteDialog from "../children/components/DeleteDialog"
import { toaster } from "@/components/ui/toaster"
import GoBackButton from "@/components/ui/goBack"
import { Checkbox } from "@/components/ui/checkbox"
import { GoPlusCircle } from "react-icons/go"
import { FaEdit } from "react-icons/fa"

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
  } = useUserManagementStore()

  const [isInviteDrawerOpen, setIsInviteDrawerOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isEditRoleDialogOpen, setIsEditRoleDialogOpen] = useState(false)
  const [usersToDelete, setUsersToDelete] = useState<UserRole[]>([])
  const [userToEditRole, setUserToEditRole] = useState<UserRole | null>(null)
  const [userRoleAssignments, setUserRoleAssignments] = useState<UserRole[]>([])
  const [searchTerm, setSearchTerm] = useState("")

  useEffect(() => {
    fetchUsers()
    fetchRoles()
  }, [fetchUsers, fetchRoles])

  useEffect(() => {
    if (error) {
      toaster.create({
        title: "Error",
        description: error,
        duration: 5000,
      })
      clearError()
    }
  }, [error, clearError])

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allUserIds = new Set(users.map((user) => user.user?.id).filter(Boolean) as string[])
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

    const selectedUserRoles = users.filter((user) =>
      user.user?.id && selectedUsers.has(user.user.id)
    )
    setUsersToDelete(selectedUserRoles)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    try {
      for (const user of usersToDelete) {
        await deleteUser(user.user_id)
      }
      setSelectedUsers(new Set())
      setUsersToDelete([])
      setIsDeleteDialogOpen(false)
      toaster.create({
        title: "Success",
        description: "Selected users deleted successfully.",
        duration: 5000,
      })
    } catch (error) {
      console.error("Bulk delete error:", error)
      toaster.create({
        title: "Error",
        description: "Failed to delete selected users. Please try again.",
        duration: 5000,
      })
    }
  }

  const handleEditRole = (userGroup: { user: User | undefined; roles: (Role | undefined)[]; created_at: string }) => {
    // Find all role assignments for this user
    if (userGroup.user?.id) {
      const allUserRoleAssignments = users.filter(user => user.user?.id === userGroup.user?.id)
      if (allUserRoleAssignments.length > 0) {
        setUserToEditRole(allUserRoleAssignments[0]) // Use first one for user info
        setUserRoleAssignments(allUserRoleAssignments) // Store all role assignments
        setIsEditRoleDialogOpen(true)
      }
    }
  }

  const handleRoleUpdate = async (userId: string, roleIds: string[]) => {
    await assignMultipleRoles(userId, roleIds)
  }

  const isAllSelected = users.length > 0 && selectedUsers.size === users.length
  const isSomeSelected = selectedUsers.size > 0 && selectedUsers.size < users.length

  // Group users by user_id to handle multiple roles
  const groupedUsers = users.reduce((acc, userRole) => {
    const userId = userRole.user_id
    if (!acc[userId]) {
      acc[userId] = {
        user: userRole.user,
        roles: [],
        created_at: userRole.created_at
      }
    }
    acc[userId].roles.push(userRole.role)
    return acc
  }, {} as Record<string, { user: User | undefined; roles: (Role | undefined)[]; created_at: string }>)

  // Convert grouped users to array and filter based on search term
  const filteredUsers = Object.values(groupedUsers).filter((userGroup) =>
    userGroup.user?.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    userGroup.user?.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    userGroup.user?.last_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    userGroup.roles.some(role => role?.name?.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  if (loading) {
    return (
      <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <Box>
      <GoBackButton />
      <Box className="container mx-auto mt-12 p-4">
        {/* Simple header with bulk actions */}
        <Flex justify="space-between" align="center" mb={6}>
          <Text fontSize="2xl" fontWeight="bold">User Management</Text>
          
          <Flex gap={3}>
            {selectedUsers.size > 0 && (
              <BulkActionButton
                label="Delete"
                count={selectedUsers.size}
                action={handleBulkDelete}
                className="border-[2px] border-transparent rounded-md w-fit h-[40px] px-10 bg-[#ff0000] text-white hover:bg-[#ff0000] hover:text-white"
              />
            )}
            
            <Button
              onClick={() => setIsInviteDrawerOpen(true)}
              className="border-[2px] border-[#E0E0E0] rounded-md w-fit h-[40px] px-10 bg-[#1C3C8C] text-white"
            >
              <GoPlusCircle className="mr-2" />
              Invite User
            </Button>
          </Flex>
        </Flex>

        {/* Search and Select All */}
        <Box className="mb-6 space-y-4">
          <Input
            placeholder="Search by email, name, or role"
            value={searchTerm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSearchTerm(e.target.value)
            }
            className="border max-w-md"
            px={3}
            py={2}
          />

          {users.length > 0 && (
            <Box className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <Checkbox
                checked={isAllSelected}
                _indeterminate={isSomeSelected ? {} : undefined}
                onCheckedChange={handleSelectAll}
                className="h-5 w-5 border-2 border-gray-400"
              />
              <Text className="text-sm font-medium text-gray-700">
                Select All ({selectedUsers.size} selected)
              </Text>
              {selectedUsers.size > 0 && (
                <Text className="text-xs text-gray-500 ml-auto">
                  {selectedUsers.size} of {users.length} users selected
                </Text>
              )}
            </Box>
          )}
        </Box>

        {/* User Cards Grid */}
        <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((userGroup, index) => (
            <Box
              key={`${userGroup.user?.id || index}`}
              className="border border-gray-200 rounded-lg p-4 bg-white hover:shadow-md transition-shadow"
            >
              <Flex justify="space-between" align="start" mb={3}>
                <Checkbox
                  checked={selectedUsers.has(userGroup.user?.id || "")}
                  onCheckedChange={(checked) => handleSelectUser(userGroup.user?.id || "", !!checked)}
                  className="h-5 w-5 border-2 border-gray-400"
                />
                <Flex gap={2}>
                  <Button
                    size="sm"
                    variant="outline"
                    colorScheme="blue"
                    onClick={() => handleEditRole(userGroup)}
                    className="flex items-center gap-1"
                  >
                    <FaEdit className="text-xs" />
                    Edit Role
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    colorScheme="red"
                    onClick={() => {
                      if (userGroup.user?.id) {
                        deleteUser(userGroup.user.id)
                      }
                    }}
                  >
                    Delete
                  </Button>
                </Flex>
              </Flex>
              
              <Box>
                <Text fontSize="lg" fontWeight="bold" mb={2}>
                  {userGroup.user?.email || "No email"}
                </Text>
                
                <Text fontSize="sm" color="gray.600" mb={1}>
                  <strong>Name:</strong> {userGroup.user?.first_name || "N/A"} {userGroup.user?.last_name || ""}
                </Text>
                
                <Box fontSize="sm" color="gray.600" mb={1}>
                  <Text as="span" fontWeight="bold">Roles:</Text>
                  <Box className="flex flex-wrap gap-1 mt-1">
                    {userGroup.roles.map((role, roleIndex) => (
                      <span
                        key={roleIndex}
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          role?.name === "SUPER_ADMIN" 
                            ? "bg-red-100 text-red-800" 
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {role?.display_name || role?.name || "N/A"}
                      </span>
                    ))}
                  </Box>
                </Box>
                
                <Text fontSize="sm" color="gray.600" mb={1}>
                  <strong>Joined:</strong> {new Date(userGroup.created_at).toLocaleDateString()}
                </Text>
                
                {userGroup.roles.length > 0 && (
                  <Text fontSize="sm" color="gray.500" mt={2}>
                    {userGroup.roles.map(role => role?.description).filter(Boolean).join(" • ")}
                  </Text>
                )}
              </Box>
            </Box>
          ))}
        </Box>

        {filteredUsers.length === 0 && (
          <Box className="text-center py-12">
            <Text className="text-gray-500">
              No users found matching your search.
            </Text>
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
      </Box>
    </Box>
  )
}

export default UserManagement 
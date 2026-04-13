"use client"
import React, { useState, useEffect } from "react"
import {
  DialogRoot,
  DialogBackdrop,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Box, Text } from "@chakra-ui/react"
import { Checkbox } from "@/components/ui/checkbox"
import { UserRole, Role } from "@/types/admin.types"
import { toaster } from "@/components/ui/toaster"

interface EditRoleDialogProps {
  isOpen: boolean
  onClose: () => void
  user: UserRole | null
  userRoles: UserRole[] // All role assignments for this user
  allRoles: Role[] // All available roles
  onRoleUpdate: (userId: string, roleIds: string[]) => Promise<void>
}

export const EditRoleDialog: React.FC<EditRoleDialogProps> = ({
  isOpen,
  onClose,
  user,
  userRoles,
  allRoles,
  onRoleUpdate,
}) => {
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (userRoles && userRoles.length > 0) {
      // Initialize with all current roles for this user
      const currentRoleIds = userRoles
        .map(userRole => userRole.role?.id)
        .filter((id): id is string => Boolean(id))
      setSelectedRoleIds(new Set(currentRoleIds))
    }
  }, [userRoles])

  const handleRoleToggle = (roleId: string, checked: boolean) => {
    const newSelected = new Set(selectedRoleIds)
    if (checked) {
      newSelected.add(roleId)
    } else {
      newSelected.delete(roleId)
    }
    setSelectedRoleIds(newSelected)
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRoleIds(new Set(allRoles.map(role => role.id)))
    } else {
      setSelectedRoleIds(new Set())
    }
  }

  const handleSubmit = async () => {
    if (!user || !user.user?.id) return

    setLoading(true)
    try {
      await onRoleUpdate(user.user.id, Array.from(selectedRoleIds))
      toaster.create({
        title: "Success",
        description: "User roles updated successfully.",
        duration: 5000,
      })
      onClose()
    } catch (error) {
      console.error("Error updating roles:", error)
      toaster.create({
        title: "Error",
        description: "Failed to update user roles. Please try again.",
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  const isAllSelected = allRoles.length > 0 && selectedRoleIds.size === allRoles.length
  const isSomeSelected = selectedRoleIds.size > 0 && selectedRoleIds.size < allRoles.length

  return (
    <DialogRoot open={isOpen} onOpenChange={onClose}>
      <DialogBackdrop />
      <DialogContent className="max-w-md p-8">
          <DialogHeader>
            <DialogTitle>Edit User Roles</DialogTitle>
            <DialogDescription>
              Assign multiple roles to {user.user?.email}
            </DialogDescription>
            <DialogCloseTrigger onClick={onClose} />
          </DialogHeader>

          <div className="space-y-4 mt-4">
            <div>
              <Text fontSize="sm" fontWeight="medium" mb={2}>
                User: {user.user?.first_name} {user.user?.last_name}
              </Text>
              <Text fontSize="sm" color="gray.600" mb={4}>
                Email: {user.user?.email}
              </Text>
            </div>

            <div>
              <Text fontSize="sm" fontWeight="medium" mb={3}>
                Select Roles:
              </Text>
              
              {/* Select All */}
              <Box className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mb-3">
                <Checkbox
                  checked={isAllSelected}
                  _indeterminate={isSomeSelected ? {} : undefined}
                  onCheckedChange={handleSelectAll}
                  className="h-5 w-5 border-2 border-gray-400"
                />
                <Text className="text-sm font-medium text-gray-700">
                  Select All ({selectedRoleIds.size} selected)
                </Text>
              </Box>

              {/* Role Checkboxes */}
              <Box className="space-y-2 max-h-48 overflow-y-auto">
                {allRoles.map((role) => (
                  <Box
                    key={role.id}
                    className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                  >
                    <Checkbox
                      checked={selectedRoleIds.has(role.id)}
                      onCheckedChange={(checked) => handleRoleToggle(role.id, !!checked)}
                      className="h-5 w-5 border-2 border-gray-400"
                    />
                    <Box className="flex-1">
                      <Text className="font-medium text-sm">
                        {role.display_name || role.name}
                      </Text>
                      {role.description && (
                        <Text className="text-xs text-gray-500 mt-1">
                          {role.description}
                        </Text>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </div>

            <div className="flex justify-end space-x-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={loading}
                className="px-2 py-4"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading || selectedRoleIds.size === 0}
                className="bg-[#2b7ff9] text-white hover:bg-[#1a6fe0] px-2 py-4"
              >
                {loading ? "Updating..." : "Update Roles"}
              </Button>
            </div>
          </div>
        </DialogContent>
    </DialogRoot>
  )
}
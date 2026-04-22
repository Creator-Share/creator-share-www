"use client"
import React, { useState } from "react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@chakra-ui/react"
import { Checkbox } from "@/components/ui/checkbox"
import { Text, Box } from "@chakra-ui/react"
import { useUserManagementStore } from "@/store/userManagementStore"
import { toaster } from "@/components/ui/toaster"

interface InviteUserDialogProps {
  isOpen: boolean
  onClose: () => void
}

export const InviteUserDialog: React.FC<InviteUserDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { roles } = useUserManagementStore()
  const [email, setEmail] = useState("")
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

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
      setSelectedRoleIds(new Set(roles.map(role => role.id)))
    } else {
      setSelectedRoleIds(new Set())
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || selectedRoleIds.size === 0) {
      toaster.create({
        title: "Error",
        description: "Please fill in email and select at least one role.",
        duration: 5000,
      })
      return
    }

    setLoading(true)
    
    try {
      const inviteResponse = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          role_ids: Array.from(selectedRoleIds), // Convert Set to Array like EditRoleDialog
        }),
      })

      if (!inviteResponse.ok) {
        const error = await inviteResponse.json()
        throw new Error(error.error || 'Failed to invite user')
      }

      toaster.create({
        title: "Success",
        description: `User invited successfully with ${selectedRoleIds.size} role(s).`,
        duration: 5000,
      })

      setEmail("")
      setSelectedRoleIds(new Set())
      onClose()
    } catch (error) {
      console.error("Error inviting user:", error)
      toaster.create({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to invite user",
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  const isAllSelected = roles.length > 0 && selectedRoleIds.size === roles.length
  const isSomeSelected = selectedRoleIds.size > 0 && selectedRoleIds.size < roles.length

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <h2 className="text-xl font-semibold">Invite User</h2>
          <DialogCloseTrigger onClick={onClose} />
        </DialogHeader>
        
        <DialogBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="px-2 border border-gray-300 rounded-md"
              />
            </div>

            <div>
              <Text fontSize="sm" fontWeight="medium" mb={3}>
                Select Roles:
              </Text>
              
              {/* Select All - Same pattern as EditRoleDialog */}
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

              {/* Role Checkboxes - Same pattern as EditRoleDialog */}
              <Box className="space-y-2 max-h-48 overflow-y-auto">
                {roles.map((role) => (
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
          </form>
        </DialogBody>

        <DialogFooter>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              loading={loading}
              disabled={selectedRoleIds.size === 0}
              className="bg-[#2b7ff9] text-white px-4 py-2"
            >
              Invite User
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  )
}
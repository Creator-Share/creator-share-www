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
import { NativeSelectField, NativeSelectRoot } from "@/components/ui/native-select"
import { useUserManagementStore } from "@/store/userManagementStore"
import { toaster } from "@/components/ui/toaster"

interface InviteUserDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export const InviteUserDrawer: React.FC<InviteUserDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const { roles, inviteUser } = useUserManagementStore()
  const [email, setEmail] = useState("")
  const [roleId, setRoleId] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !roleId) {
      toaster.create({
        title: "Error",
        description: "Please fill in all fields.",
        duration: 5000,
      })
      return
    }

    setLoading(true)
    
    try {
      const success = await inviteUser({
        email,
        role_id: roleId,
        invited_by: "current_user",
      })

      if (success) {
        toaster.create({
          title: "Success",
          description: "User invited successfully.",
          duration: 5000,
        })
        setEmail("")
        setRoleId("")
        onClose()
      }
    } catch (error) {
      console.error("Error inviting user:", error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
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
              />
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium mb-2">
                Role
              </label>
              <NativeSelectRoot>
                <NativeSelectField
                  id="role"
                  className="border"
                  px={2}
                  placeholder="Select a role"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                >
                  <option value="">Select a role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.display_name || role.name}
                    </option>
                  ))}
                </NativeSelectField>
              </NativeSelectRoot>
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
              className="bg-[#1C3C8C] text-white"
            >
              Invite User
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  )
} 
import React, { useState } from "react"
import { Text, Flex } from "@chakra-ui/react"
import { Button } from "@/components/ui/button"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogCloseTrigger,
} from "@/components/ui/dialog"

interface DeleteDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  itemCount: number
  accountOffboarding?: boolean
}

const DeleteDialog: React.FC<DeleteDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemCount,
  accountOffboarding = false,
}) => {
  const [isLoading, setIsLoading] = useState(false)

  const handleConfirm = async () => {
    try {
      setIsLoading(true)
      await onConfirm()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <DialogRoot open={isOpen} onOpenChange={({ open }) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <Text className="text-xl font-semibold">{accountOffboarding ? "Disable account access" : "Confirm Deletion"}</Text>
          <DialogCloseTrigger onClick={onClose} />
        </DialogHeader>
        <DialogBody>
          <Text>
            {accountOffboarding
              ? `Disable platform access for ${itemCount} selected accounts? Sponsorships, billing, profiles, and financial history will be retained. Transfer any active Advocate ownership first.`
              : `Are you sure you want to delete ${itemCount} selected children? This action cannot be undone.`}
          </Text>
          <Flex gap={3} mt={4}>
            <Button 
              onClick={onClose} 
              className="bg-gray-500 text-white p-4"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirm} 
              className="bg-red-500 text-white p-4"
              disabled={isLoading}
            >
              {isLoading ? "Working..." : accountOffboarding ? "Disable access" : "Delete"}
            </Button>
          </Flex>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

export default DeleteDialog

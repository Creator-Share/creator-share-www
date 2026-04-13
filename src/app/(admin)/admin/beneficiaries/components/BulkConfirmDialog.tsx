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

interface BulkConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
  itemCount: number
  actionLabel: string
  description?: string
}

const BulkConfirmDialog: React.FC<BulkConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  itemCount,
  actionLabel,
  description,
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
    <DialogRoot open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <Text className="text-xl font-semibold">Confirm Bulk Action</Text>
          <DialogCloseTrigger onClick={onClose} />
        </DialogHeader>
        <DialogBody>
          <Text>
            You are about to <strong>{actionLabel}</strong> for{" "}
            <strong>{itemCount} {itemCount === 1 ? "beneficiary" : "beneficiaries"}</strong>.
            This cannot be undone.
          </Text>
          {description && (
            <Text className="mt-2 text-sm text-gray-500">{description}</Text>
          )}
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
              className="bg-[#2B7FF9] text-white p-4"
              disabled={isLoading}
            >
              {isLoading ? "Applying..." : "Confirm"}
            </Button>
          </Flex>
        </DialogBody>
      </DialogContent>
    </DialogRoot>
  )
}

export default BulkConfirmDialog

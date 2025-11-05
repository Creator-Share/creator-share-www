"use client"
import React from "react"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import { Text, Box, Stack } from "@chakra-ui/react"
import { Button } from "@/components/ui/button"

interface ProofreadModalProps {
  isOpen: boolean
  onClose: () => void
  originalText: string
  proofreadText: string
  onAccept: (text: string) => void
  fieldLabel?: string
}

const ProofreadModal: React.FC<ProofreadModalProps> = ({
  isOpen,
  onClose,
  originalText,
  proofreadText,
  onAccept,
  fieldLabel = "Text",
}) => {
  const handleAccept = () => {
    onAccept(proofreadText)
    onClose()
  }

  return (
    <DialogRoot open={isOpen} onOpenChange={({ open }) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex justify-between items-center p-6 pb-2">
          <DialogTitle>
            <Text fontSize="2xl" fontWeight="bold">
              AI Proofreading Suggestions
            </Text>
          </DialogTitle>
          <DialogCloseTrigger
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          />
        </DialogHeader>

        <DialogBody className="p-6">
          <Stack gap={6}>
            {/* Original Text */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
                Original {fieldLabel}:
              </Text>
              <Box
                p={4}
                bg="gray.50"
                borderRadius="md"
                border="1px solid"
                borderColor="gray.200"
              >
                <Text fontSize="sm" color="gray.800" whiteSpace="pre-wrap">
                  {originalText}
                </Text>
              </Box>
            </Box>

            {/* Proofread Text */}
            <Box>
              <Text fontSize="sm" fontWeight="semibold" color="blue.700" mb={2}>
                AI-Improved {fieldLabel}:
              </Text>
              <Box
                p={4}
                bg="blue.50"
                borderRadius="md"
                border="1px solid"
                borderColor="blue.200"
              >
                <Text fontSize="sm" color="gray.800" whiteSpace="pre-wrap">
                  {proofreadText}
                </Text>
              </Box>
            </Box>

            {/* Info Message */}
            <Box
              p={3}
              bg="yellow.50"
              borderRadius="md"
              border="1px solid"
              borderColor="yellow.200"
            >
              <Text fontSize="xs" color="gray.700">
                <Text as="span" fontWeight="semibold">
                  Note:
                </Text>{" "}
                Review the AI suggestions carefully. You can accept these changes
                or close this dialog to keep your original text. The AI aims to
                improve grammar, readability, and tone while preserving your
                original meaning.
              </Text>
            </Box>
          </Stack>
        </DialogBody>

        <DialogFooter className="flex justify-end gap-3 p-6 pt-2">
          <Button
            className="bg-gray-500 text-white hover:bg-gray-600"
            onClick={onClose}
          >
            Keep Original
          </Button>
          <Button
            className="bg-blue-600 text-white hover:bg-blue-700"
            onClick={handleAccept}
          >
            Accept AI Suggestions
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  )
}

export default ProofreadModal

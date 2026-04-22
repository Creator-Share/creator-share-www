"use client"
import React, { useState } from "react"
import { Box, Text, Flex, Stack, Textarea } from "@chakra-ui/react"
import { Button } from "@/components/ui/button"
import { HiX, HiCheck, HiRefresh } from "react-icons/hi"

interface ProofreadComparisonProps {
  originalText: string
  proofreadText: string
  onAccept: () => void
  onReject: () => void
  onRetry: (instructions?: string) => void
  fieldLabel?: string
  isRetrying?: boolean
}

const ProofreadComparison: React.FC<ProofreadComparisonProps> = ({
  originalText,
  proofreadText,
  onAccept,
  onReject,
  onRetry,
  fieldLabel = "Text",
  isRetrying = false
}) => {
  const [instructions, setInstructions] = useState("")
  return (
    <Box
      border="2px solid"
      borderColor="blue.300"
      borderRadius="md"
      bg="blue.50"
      p={4}
      mb={4}
    >
      <Flex justify="space-between" align="center" mb={4}>
        <Text fontSize="md" fontWeight="bold" color="blue.700">
          AI Proofreading Suggestions
        </Text>
        <Flex gap={2}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onRetry(instructions)}
            disabled={isRetrying}
            loading={isRetrying}
            className="border-blue-500 text-blue-600 hover:bg-blue-100"
          >
            <HiRefresh className="mr-1" />
            Retry
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onReject}
            className="bg-gray-500 text-white hover:bg-gray-600"
          >
            <HiX className="mr-1" />
            Reject
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onAccept}
            className="bg-green-600 text-white hover:bg-green-700"
          >
            <HiCheck className="mr-1" />
            Accept
          </Button>
        </Flex>
      </Flex>

      <Box mb={4}>
        <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
          Additional Instructions (optional):
        </Text>
        <Textarea
          placeholder="E.g., 'Make it more formal' or 'Use simpler language' or 'Focus on their strengths'"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          size="sm"
          rows={2}
          className="border"
        />
      </Box>

      <Stack direction={{ base: "column", lg: "row" }} gap={4}>
        {/* Original Text */}
        <Box flex={1}>
          <Text fontSize="sm" fontWeight="semibold" color="gray.700" mb={2}>
            Original {fieldLabel}:
          </Text>
          <Box
            p={3}
            bg="white"
            borderRadius="md"
            border="1px solid"
            borderColor="gray.300"
            maxH="300px"
            overflowY="auto"
          >
            <Text fontSize="sm" color="gray.800" whiteSpace="pre-wrap">
              {originalText}
            </Text>
          </Box>
        </Box>

        {/* AI-Improved Text */}
        <Box flex={1}>
          <Text fontSize="sm" fontWeight="semibold" color="blue.700" mb={2}>
            AI-Improved {fieldLabel}:
          </Text>
          <Box
            p={3}
            bg="white"
            borderRadius="md"
            border="2px solid"
            borderColor="blue.400"
            maxH="300px"
            overflowY="auto"
          >
            <Text fontSize="sm" color="gray.800" whiteSpace="pre-wrap">
              {proofreadText}
            </Text>
          </Box>
        </Box>
      </Stack>

      <Box mt={3} p={2} bg="yellow.50" borderRadius="md" border="1px solid" borderColor="yellow.200">
        <Text fontSize="xs" color="gray.700">
          <Text as="span" fontWeight="semibold">Note:</Text>{" "}
          Review the AI suggestions carefully. The AI aims to improve grammar, readability, and tone while preserving your original meaning and respecting each beneficiary's dignity.
        </Text>
      </Box>
    </Box>
  )
}

export default ProofreadComparison

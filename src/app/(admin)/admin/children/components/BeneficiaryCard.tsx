"use client"
import React from "react"
import { Box, Button, Text, Progress, Badge } from "@chakra-ui/react"
import Image from "next/image"
import { Checkbox } from "@/components/ui/checkbox"
import { Beneficiaries } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"

interface BeneficiaryCardProps {
  beneficiary: Beneficiaries
  isSelected: boolean
  onSelect: (id: string, checked: boolean) => void
  onEdit: (beneficiary: Beneficiaries) => void
  beneficiaryImages: Record<string, string>
  loadingImages: Record<string, boolean>
}

const BeneficiaryCard: React.FC<BeneficiaryCardProps> = ({
  beneficiary,
  isSelected,
  onSelect,
  onEdit,
  beneficiaryImages,
  loadingImages,
}) => {
  const publicHardcoded = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const goal = Number(
    publicHardcoded !== null ? publicHardcoded : beneficiary.budget_goal || 0,
  )
  const raised = Number(beneficiary.budget_raised || 0)
  const progress =
    goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0

  return (
    <Box className="border rounded-xl p-4 bg-white space-y-3 relative">
      {/* Individual checkbox positioned in top-right corner */}
      {beneficiary.id && (
        <Box className="absolute top-1 right-1 z-10">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect(beneficiary.id!, !!checked)}
            className="h-5 w-5 border-2 bg-white/80 backdrop-blur-sm rounded"
          />
        </Box>
      )}

      <Box className="flex items-start gap-4">
        <Box className="relative w-[80px] h-[80px]">
          {!beneficiary.id ? (
            <div className="w-full h-full rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-sm text-center p-2">
              No Image Available
            </div>
          ) : loadingImages[beneficiary.id] ? (
            <div className="w-full h-full bg-gray-200 rounded-lg animate-pulse" />
          ) : beneficiaryImages[beneficiary.id] ? (
            <Image
              src={beneficiaryImages[beneficiary.id]}
              alt={`${beneficiary.name}'s photo`}
              fill
              className="rounded-lg object-cover"
            />
          ) : (
            <div className="w-full h-full rounded-lg bg-gray-100 flex items-center justify-center text-gray-500 text-sm text-center p-2">
              No Image Available
            </div>
          )}
        </Box>
        <Box className="flex-1 flex items-start justify-between">
          <Box>
            <Text className="text-lg font-semibold leading-6">
              {beneficiary.name}
            </Text>
            <Text className="text-xs text-gray-500">
              @{beneficiary.username}
            </Text>
          </Box>
          <Badge colorPalette="blue">{beneficiary.status}</Badge>
        </Box>
      </Box>

      <Box className="text-sm text-gray-600">
        <Text>
          {beneficiary.country}
          {beneficiary.location_str ? ` • ${beneficiary.location_str}` : ""}
        </Text>
      </Box>

      <Box className="space-y-1">
        <Box className="flex justify-between text-sm">
          <Text>Raised</Text>
          <Text>
            ${centsToDollars(beneficiary.budget_raised)} / $
            {centsToDollars(goal || beneficiary.budget_goal)}
          </Text>
        </Box>
        <Progress.Root value={progress}>
          <Progress.Track className="rounded-xl h-2">
            <Progress.Range className="bg-[#1C3C8C]" />
          </Progress.Track>
        </Progress.Root>
      </Box>

      {/* Edit button */}
      <Box className="pt-1">
        <Button
          className="w-full bg-[#1C3C8C] text-white"
          onClick={() => onEdit(beneficiary)}
        >
          Edit
        </Button>
      </Box>
    </Box>
  )
}

export default BeneficiaryCard

"use client"
import React from "react"
import { Box, Button, Text, Progress, Badge } from "@chakra-ui/react"
import Image from "next/image"
import { Checkbox } from "@/components/ui/checkbox"
import { Beneficiaries } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"
import { getDefaultSponsorshipAmount } from "@/components/BeneficiaryTypeNav"

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
  const goal =
    getDefaultSponsorshipAmount(beneficiary.beneficiary_type) ??
    beneficiary.budget_goal ??
    0
  const raised = Number(beneficiary.budget_raised || 0)
  const progress =
    goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "New":
        return "blue"
      case "Partially Funded":
        return "orange"
      case "Budget Fulfilled":
        return "green"
      case "Draft":
        return "purple"
      case "Archived":
        return "red"
      case "Sponsorship Cancelled":
        return "yellow"
      default:
        return "gray"
    }
  }

  const [isHovered, setIsHovered] = React.useState(false)

  const handleCardClick = () => {
    if (beneficiary.id) {
      onSelect(beneficiary.id, !isSelected)
    }
  }

  const getBackgroundColor = () => {
    if (isSelected) return "#F0F7FF"
    if (isHovered) return "#f9fafb"
    return "white"
  }

  return (
    <Box
      className="rounded-xl relative transition-all duration-200 flex flex-col cursor-pointer"
      style={{
        border: isSelected ? "2px solid #2B7FF9" : "2px solid #e5e7eb",
        padding: "16px",
        backgroundColor: getBackgroundColor(),
        height: "100%",
      }}
      onClick={handleCardClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
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
              unoptimized
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
          <Box className="flex flex-col items-end gap-2">
            {/* Checkbox positioned at far right above status */}
            {beneficiary.id && (
              <Box onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) =>
                    onSelect(beneficiary.id!, !!checked)
                  }
                  colorPalette="blue"
                  css={{
                    "& [data-part='control']": {
                      width: "20px",
                      height: "20px",
                      borderWidth: "2px",
                      borderColor: isSelected ? "#2B7FF9" : "#d1d5db",
                      backgroundColor: isSelected ? "#2B7FF9" : "white",
                      _checked: {
                        backgroundColor: "#2B7FF9",
                        borderColor: "#2B7FF9",
                      },
                    },
                  }}
                />
              </Box>
            )}
            <Badge colorPalette={getStatusBadgeColor(beneficiary.status)}>
              {beneficiary.status}
            </Badge>
          </Box>
        </Box>
      </Box>

      <Box className="text-sm text-gray-600 mt-3">
        <Text>
          {beneficiary.country}
          {beneficiary.location_str ? ` • ${beneficiary.location_str}` : ""}
        </Text>
      </Box>

      {/* Hide budget goal progress for SPECIAL_NEEDS beneficiaries */}
      {beneficiary.beneficiary_type !== "SPECIAL_NEEDS" && (
        <Box className="space-y-1 mt-3">
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
      )}

      {/* Spacer to push button to bottom */}
      <Box className="flex-grow" />

      {/* Edit button - always at bottom */}
      <Box className="mt-3">
        <Button
          className="w-full bg-[#1C3C8C] text-white"
          onClick={(e) => {
            e.stopPropagation()
            onEdit(beneficiary)
          }}
        >
          Edit
        </Button>
      </Box>
    </Box>
  )
}

export default BeneficiaryCard

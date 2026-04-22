"use client"
import React from "react"
import { Box, Flex, Button, Text, Spinner } from "@chakra-ui/react"
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu"
import { FiChevronDown } from "react-icons/fi"
import { BULK_ASSIGNABLE_STATUSES } from "@/config/beneficiaryStatuses"
import { ALL_BENEFICIARY_TABS } from "@/config/beneficiaryTypes"

interface FloatingActionBarProps {
  selectedCount: number
  visibleCount: number
  totalMatchingCount?: number
  onSelectVisible: () => void
  onSelectAllMatching: () => Promise<void>
  isSelectingAll?: boolean
  onDeselectAll: () => void
  onDelete: () => void
  onSetStatus: (status: string) => void
  onSetType: (type: string) => void
  onReinstate?: () => void
  hasCancelledSelected?: boolean
}

const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  selectedCount,
  visibleCount,
  totalMatchingCount,
  onSelectVisible,
  onSelectAllMatching,
  isSelectingAll = false,
  onDeselectAll,
  onDelete,
  onSetStatus,
  onSetType,
  onReinstate,
  hasCancelledSelected = false,
}) => {
  if (selectedCount === 0) return null

  return (
    <Box
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200"
      style={{ transform: "translateZ(0)" }}
    >
      <Box className="container mx-auto px-4 py-4">
        <Flex gap={3} flexWrap="wrap" justify="center" align="center">

          <Text className="text-sm text-gray-500">{selectedCount} items selected</Text>

          {/* Select All dropdown */}
          <MenuRoot>
            <MenuTrigger asChild>
              <Button
                className="border-[2px] border-[#2B7FF9] rounded-md w-full md:w-fit h-[40px] px-6 bg-white text-[#2B7FF9] hover:bg-[#f0f7ff] flex items-center gap-2"
                disabled={isSelectingAll}
              >
                {isSelectingAll ? <Spinner size="xs" /> : null}
                Select All
                <FiChevronDown className="w-4 h-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem value="visible" onClick={onSelectVisible}>
                All visible ({visibleCount} loaded)
              </MenuItem>
              <MenuItem
                value="matching"
                onClick={onSelectAllMatching}
                disabled={isSelectingAll}
              >
                {isSelectingAll
                  ? "Fetching..."
                  : `All matching filters${totalMatchingCount != null ? ` (${totalMatchingCount} total)` : ""}`}
              </MenuItem>
            </MenuContent>
          </MenuRoot>

          <Button
            onClick={onDeselectAll}
            className="border-[2px] border-gray-300 rounded-md w-full md:w-fit h-[40px] px-6 bg-white text-gray-600 hover:bg-gray-50"
          >
            Deselect All
          </Button>

          {onReinstate && hasCancelledSelected && (
            <Button
              onClick={onReinstate}
              className="border-[2px] border-[#10b981] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#10b981] text-white hover:bg-[#059669]"
            >
              Reinstate to New
            </Button>
          )}

          {/* Set Status dropdown */}
          <MenuRoot>
            <MenuTrigger asChild>
              <Button
                className="border-[2px] border-gray-300 rounded-md w-full md:w-fit h-[40px] px-6 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-2"
              >
                Set Status
                <FiChevronDown className="w-4 h-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {BULK_ASSIGNABLE_STATUSES.map((status) => (
                <MenuItem key={status} value={status} onClick={() => onSetStatus(status)}>
                  {status}
                </MenuItem>
              ))}
            </MenuContent>
          </MenuRoot>

          {/* Set Type dropdown */}
          <MenuRoot>
            <MenuTrigger asChild>
              <Button
                className="border-[2px] border-gray-300 rounded-md w-full md:w-fit h-[40px] px-6 bg-white text-gray-600 hover:bg-gray-50 flex items-center gap-2"
              >
                Set Type
                <FiChevronDown className="w-4 h-4" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {ALL_BENEFICIARY_TABS.filter(t => t.type != null && !t.isLegacyAlias).map(({ type, label }) => (
                <MenuItem key={type!} value={type!} onClick={() => onSetType(type!)}>
                  {label}
                </MenuItem>
              ))}
            </MenuContent>
          </MenuRoot>

          <Button
            onClick={onDelete}
            className="border-[2px] border-red-500 rounded-md w-full md:w-fit h-[40px] px-6 bg-white text-red-600 hover:bg-red-50"
          >
            Bulk Delete
          </Button>

        </Flex>
      </Box>
    </Box>
  )
}

export default FloatingActionBar

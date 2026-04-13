"use client"
import React from "react"
import { Box, Flex, Button, Text } from "@chakra-ui/react"
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from "@/components/ui/menu"
import { FiChevronDown } from "react-icons/fi"
import { BULK_ASSIGNABLE_STATUSES } from "@/config/beneficiaryStatuses"

interface FloatingActionBarProps {
  selectedCount: number
  onDeselectAll: () => void
  onDelete: () => void
  onSetStatus: (status: string) => void
  onReinstate?: () => void
  hasCancelledSelected?: boolean
}

const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  selectedCount,
  onDeselectAll,
  onDelete,
  onSetStatus,
  onReinstate,
  hasCancelledSelected = false,
}) => {
  if (selectedCount === 0) return null

  return (
    <Box
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t-2 border-gray-200 shadow-lg"
      style={{
        transform: "translateZ(0)"
      }}
    >
      <Box className="container mx-auto px-4 py-4">
        <Flex
          gap={3}
          flexWrap="wrap"
          justify="center"
          align="center"
        >
          <Button
            onClick={onDeselectAll}
            className="border-[2px] border-[#2B7FF9] rounded-md w-full md:w-fit h-[40px] px-10 bg-white text-[#2B7FF9] hover:bg-[#f0f7ff]"
          >
            Deselect All
          </Button>

          <Button
            onClick={onDelete}
            className="border-[2px] border-transparent rounded-md w-full md:w-fit h-[40px] px-10 bg-[#ff0000] text-white hover:bg-[#cc0000]"
          >
            Delete ({selectedCount})
          </Button>

          {onReinstate && hasCancelledSelected && (
            <Button
              onClick={onReinstate}
              className="border-[2px] border-[#10b981] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#10b981] text-white hover:bg-[#059669]"
            >
              Reinstate to New
            </Button>
          )}

          <MenuRoot>
            <MenuTrigger asChild>
              <Button
                className="border-[2px] border-[#000000] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#ffffff] text-black hover:bg-[#f0f0f0] flex items-center gap-2"
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

          <Text className="text-sm text-gray-500">Selected {selectedCount} items</Text>
        </Flex>
      </Box>
    </Box>
  )
}

export default FloatingActionBar

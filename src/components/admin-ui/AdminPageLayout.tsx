"use client"
import React from "react"
import { Box, Text, Flex, Button, Input } from "@chakra-ui/react"
import { Checkbox } from "@/components/ui/checkbox"
import { GoArrowLeft } from "react-icons/go"
import { useRouter } from "next/navigation"
import Link from "next/link"

interface AdminPageLayoutProps {
  title: string
  description?: string
  breadcrumb?: {
    label: string
    href?: string
  }[]
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  showSelectAll?: boolean
  isAllSelected?: boolean
  isSomeSelected?: boolean
  onSelectAll?: (checked: boolean) => void
  selectedCount?: number
  totalCount?: number
  bulkActions?: React.ReactNode
  primaryAction?: React.ReactNode
  children: React.ReactNode
  noResultsMessage?: string
  showResults?: boolean
  hideSearchSection?: boolean
}

const AdminPageLayout: React.FC<AdminPageLayoutProps> = ({
  title,
  description,
  breadcrumb,
  searchPlaceholder = "Search...",
  searchValue = "",
  onSearchChange,
  showSelectAll = false,
  isAllSelected = false,
  isSomeSelected = false,
  onSelectAll,
  selectedCount = 0,
  totalCount = 0,
  bulkActions,
  primaryAction,
  children,
  noResultsMessage = "No items found matching your search.",
  showResults = true,
  hideSearchSection = false,
}) => {
  const router = useRouter()

  return (
    <Box className="min-h-screen">
      {/* Header with breadcrumb navigation */}
      <Box className="border-b border-gray-200">
        <Box className="container mx-auto px-4 py-4">
          <Flex align="center" gap={4} mb={4}>
            <Button
              variant="ghost"
              onClick={() => router.back()}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 p-2"
            >
              <GoArrowLeft className="w-4 h-4" />
              <Text fontSize="sm">Back</Text>
            </Button>

            <Box className="h-6 w-px bg-gray-300" />

            <Link href="/admin" className="cursor-pointer">
              <Text
                fontSize="sm"
                color="gray.500"
                _hover={{ color: "gray.900" }}
              >
                Admin Dashboard
              </Text>
            </Link>

            {breadcrumb?.map((item, index) => (
              <React.Fragment key={index}>
                <Text fontSize="sm" color="gray.400">
                  /
                </Text>
                <Text
                  fontSize="sm"
                  color={
                    index === breadcrumb.length - 1 ? "gray.900" : "gray.500"
                  }
                  fontWeight={
                    index === breadcrumb.length - 1 ? "medium" : "normal"
                  }
                >
                  {item.label}
                </Text>
              </React.Fragment>
            ))}
          </Flex>

          {/* Title and Actions - FORCE horizontal layout on desktop */}
          <div className="flex flex-col space-y-4 md:flex-row md:justify-between md:items-end md:space-y-0">
            {/* Title and Description */}
            <div className="flex-1">
              <Text
                fontSize="2xl md:text-3xl"
                fontWeight="bold"
                color="gray.900"
                mb={1}
              >
                {title}
              </Text>
              {description && (
                <Text fontSize="sm md:text-base" color="gray.600">
                  {description}
                </Text>
              )}
            </div>

            {/* Actions - FORCE beside title on desktop */}
            {(bulkActions || primaryAction) && (
              <div className="w-full md:w-auto md:flex-shrink-0">
                <div className="flex flex-col space-y-3 md:flex-row md:space-y-0 md:space-x-3 md:items-center">
                  {bulkActions && (
                    <div className="flex flex-col space-y-3 md:flex-row md:space-y-0 md:space-x-3 md:items-center">
                      {bulkActions}
                    </div>
                  )}
                  {primaryAction && (
                    <div className="w-full md:w-auto">{primaryAction}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Box>
      </Box>

      {/* Main content */}
      <Box className="container mx-auto px-4 py-6">
        {/* Search and filters */}
        {!hideSearchSection && (
          <Box className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <Flex justify="space-between" align="center" mb={4}>
              <Text fontSize="lg" fontWeight="semibold" color="gray.900">
                Search & Filter
              </Text>

              {showSelectAll && totalCount > 0 && (
                <Box className="flex items-center gap-3">
                  <Checkbox
                    checked={isAllSelected}
                    _indeterminate={isSomeSelected ? {} : undefined}
                    onCheckedChange={onSelectAll}
                    className="h-5 w-5 border-2 border-gray-400"
                  />
                  <Text className="text-sm font-medium text-gray-700">
                    Select All ({selectedCount} selected)
                  </Text>
                  {selectedCount > 0 && (
                    <Text className="text-xs text-gray-500 ml-auto">
                      {selectedCount} of {totalCount} items selected
                    </Text>
                  )}
                </Box>
              )}
            </Flex>

            <Input
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onSearchChange?.(e.target.value)
              }
              className="w-full"
              px={4}
              py={3}
            />
          </Box>
        )}

        {/* Content */}
        {showResults ? (
          children
        ) : (
          <Box className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <Text className="text-gray-500 text-lg">{noResultsMessage}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}

export default AdminPageLayout

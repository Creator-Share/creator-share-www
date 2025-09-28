"use client"
import React, { useEffect, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { Box, Button, Text, Input, Flex } from "@chakra-ui/react"
import { MdDeleteOutline } from "react-icons/md"
import { toaster } from "@/components/ui/toaster"
import DeleteDialog from "./components/DeleteDialog"
import BeneficiaryCard from "./components/BeneficiaryCard"
import { useBeneficiaryStore } from "@/store/beneficiaryStore"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"
import { dollarsToCents } from "@/utils/currency"
import GoBackButton from "@/components/ui/goBack"
import { Checkbox } from "@/components/ui/checkbox"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { useFormStore } from "@/store/formStore"

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), {
  ssr: false,
})
const EditDrawer = dynamic(() => import("./components/EditDrawer"), {
  ssr: false,
})

const ChildrenTable = () => {
  // const initialFormData: Beneficiaries = {
  //   name: "",
  //   username: "",
  //   gender: "Boy",
  //   birth_date: "",
  //   biography: "",
  //   budget_goal: 0,
  //   budget_raised: 0,
  //   status: "Draft",
  //   country: "",
  //   location_geo: null,
  //   location_str: "",
  //   video_url: "",
  //   introduction: "",
  //   active_subscriptions: 0,
  //   metadata: {},
  //   beneficiary_type: "CHILD",
  //   image_url: "",
  // }

  const { 
    formData, 
    setFormData, 
    formDataEdit,
    setFormDataEdit,
    imageFiles, 
    setImageFiles, 
    videoFiles, 
    setVideoFiles 
  } = useFormStore()

  const {
    data,
    loading,
    selectedBeneficiary,
    selectedRowsForDeletion,
    setSelectedBeneficiary,
    setSelectedRowsForDeletion,
    fetchBeneficiaries,
    createBeneficiary,
    updateBeneficiary,
    deleteBeneficiary,
    bulkDelete,
  } = useBeneficiaryStore()

  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false)
  const [selectedCount, setSelectedCount] = useState(0)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [beneficiaryImages, setBeneficiaryImages] = useState<
    Record<string, string>
  >({})
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>(
    {},
  )
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const fetchedImagesRef = useRef<Set<string>>(new Set())
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 9 // Show 9 items per page (3x3 grid)

  useEffect(() => {
    fetchBeneficiaries("CHILD")
  }, [fetchBeneficiaries])

  // Lazy load images only for visible beneficiaries
  const fetchImagesForVisibleBeneficiaries = useCallback(async (visibleBeneficiaries: Beneficiaries[]) => {
    if (!visibleBeneficiaries?.length) return

    // Get IDs that need to be fetched (not already fetched and not currently loading)
    const idsToFetch = visibleBeneficiaries
      .map((b) => b.id)
      .filter((id): id is string => 
        !!id && 
        !fetchedImagesRef.current.has(id) && 
        !loadingImages[id]
      )

    if (!idsToFetch.length) return

    // Set loading state for these IDs
    setLoadingImages((prev) => ({
      ...prev,
      ...Object.fromEntries(idsToFetch.map((id) => [id, true])),
    }))

    // Fetch images in smaller batches to avoid overwhelming the server
    const batchSize = 5
    for (let i = 0; i < idsToFetch.length; i += batchSize) {
      const batch = idsToFetch.slice(i, i + batchSize)
      
      await Promise.all(
        batch.map(async (id) => {
          fetchedImagesRef.current.add(id)
          try {
            const response = await fetch(
              `/api/admin/beneficiaries/images/${id}`,
            )
            if (response.ok) {
              const images = await response.json()
              if (images && images.length > 0) {
                // Filter for only IMAGE type media
                const imageMedia = images.filter((img: BeneficiaryMedia) => img.type === "IMAGE")
                
                if (imageMedia.length > 0) {
                  const img = imageMedia[0]
                  const src = img?.id
                    ? generatePublicUrl(img as unknown as MediaRow)
                    : img?.image_url || ""
                
                  // Only set the image if we have a valid src
                  if (src && src.trim() !== "") {
                    setBeneficiaryImages((prev) => ({
                      ...prev,
                      [id]: src,
                    }))
                  }
                }
              }
            } else {
              console.error(`Failed to fetch images for beneficiary ${id}:`, response.status, response.statusText)
            }
          } catch (error) {
            console.error("Error fetching beneficiary image:", error)
          } finally {
            setLoadingImages((prev) => ({ ...prev, [id]: false }))
          }
        }),
      )
      
      // Small delay between batches to prevent overwhelming the server
      if (i + batchSize < idsToFetch.length) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  }, [loadingImages])

  // Fetch images when visible beneficiaries change
  useEffect(() => {
    if (!data?.length) return

    // Update the filteredData to sort by creation date (newest first)
    const filteredData = data
      .filter(
        (b) =>
          (b.name?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
          (b.username?.toLowerCase() || "").includes(searchTerm.toLowerCase()),
      )
      .sort((a, b) => {
        // Sort by created_at in descending order (newest first)
        const dateA = new Date(a.created_at || 0).getTime()
        const dateB = new Date(b.created_at || 0).getTime()
        return dateB - dateA
      })

    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const visibleBeneficiaries = filteredData.slice(startIndex, endIndex)

    fetchImagesForVisibleBeneficiaries(visibleBeneficiaries)
  }, [data, searchTerm, currentPage, fetchImagesForVisibleBeneficiaries])

  // Open EditDrawer only when selectedBeneficiary is set and valid
  useEffect(() => {
    if (
      selectedBeneficiary &&
      typeof selectedBeneficiary === "object" &&
      selectedBeneficiary.id
    ) {
      setIsEditDrawerOpen(true)
    }
  }, [selectedBeneficiary])

  // Update selected count when selectedItems changes
  useEffect(() => {
    setSelectedCount(selectedItems.size)
  }, [selectedItems])

  // Reset to first page when search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm])

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target
    const processedValue =
      name === "budget_goal" ? parseFloat(value) || 0 : value
    setFormData({ ...formData, [name]: processedValue })
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData({ ...formData, [name]: value })
  }

  const handleLocationSelect = (
    geo: [number, number],
    locationStr: string,
    country: string,
  ) => {
    setFormData({
      ...formData,
      location_geo: geo
        ? { type: "Point", coordinates: [geo[1], geo[0]] }
        : null,
      location_str: locationStr,
      country,
    })
  }

  const handleSubmit = async (): Promise<boolean> => {
    if (
      !formData.name ||
      !formData.username ||
      !formData.gender ||
      !formData.birth_date ||
      !formData.biography ||
      !formData.status ||
      !formData.country ||
      !formData.introduction
    ) {
      toaster.create({
        title: "Error",
        description: "Please fill in all required fields",
        duration: 5000,
      })
      return false
    }

    const formDataWithCents = {
      ...formData,
      budget_goal: parseInt(dollarsToCents(formData.budget_goal || 0)),
    }
    const success = await createBeneficiary(
      "CHILD",
      formDataWithCents,
      imageFiles,
      videoFiles,
    )
    if (success) {
      setIsCreateDrawerOpen(false)
      toaster.create({
        title: "Success",
        description: "Child created successfully.",
        duration: 5000,
      })
      return true
    } else {
      toaster.create({
        title: "Error",
        description: "Failed to create beneficiary",
        duration: 5000,
      })
      return false
    }
  }

  const handleSave = async (updated: Partial<Beneficiaries>) => {
    await updateBeneficiary("CHILD", updated)
    setIsEditDrawerOpen(false)
    toaster.create({
      title: "Success",
      description: "Child updated successfully.",
      duration: 5000,
    })
  }

  const handleBulkDelete = () => {
    if (selectedItems.size === 0) {
      toaster.create({
        title: "No Selection",
        description: "No rows selected for deletion.",
        duration: 5000,
      })
      return
    }

    const selectedBeneficiaries = data.filter(
      (b) => b.id && selectedItems.has(b.id),
    )
    setSelectedRowsForDeletion(selectedBeneficiaries)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    try {
      const beneficiaryIds = selectedRowsForDeletion
        .map((b) => b.id)
        .filter((id): id is string => typeof id === "string")
      await bulkDelete("CHILD", beneficiaryIds)
      setSelectedItems(new Set())
      setSelectedRowsForDeletion([])
      setIsDeleteDialogOpen(false)
      toaster.create({
        title: "Success",
        description: "Selected beneficiaries deleted successfully.",
        duration: 5000,
      })
    } catch (error) {
      console.error("Bulk delete error:", error)
      toaster.create({
        title: "Error",
        description:
          "Failed to delete selected beneficiaries. Please try again.",
        duration: 5000,
      })
    }
  }

  const handleDelete = async (beneficiaryId: string) => {
    await deleteBeneficiary("CHILD", beneficiaryId)
    setIsEditDrawerOpen(false)
    toaster.create({
      title: "Success",
      description: "Child deleted successfully.",
      duration: 5000,
    })
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = data.filter((b) => b.id).map((b) => b.id!)
      setSelectedItems(new Set(allIds))
    } else {
      setSelectedItems(new Set())
    }
  }

  const handleSelectItem = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedItems)
    if (checked) {
      newSelected.add(id)
    } else {
      newSelected.delete(id)
    }
    setSelectedItems(newSelected)
  }

  const handleEditBeneficiary = (beneficiary: Beneficiaries) => {
    setSelectedBeneficiary(beneficiary)
    setIsEditDrawerOpen(true)
  }

  const filteredData = data.filter(
    (b) =>
      (b.name?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
      (b.username?.toLowerCase() || "").includes(searchTerm.toLowerCase()),
  )

  // Pagination logic
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedData = filteredData.slice(startIndex, endIndex)

  // Generate pagination items with ellipsis
  const generatePaginationItems = () => {
    const totalPages = Math.ceil(filteredData.length / itemsPerPage) // Move calculation here
    const items = []
    const maxVisiblePages = 7 // Show max 7 page numbers
    
    if (totalPages <= maxVisiblePages) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        items.push(i)
      }
    } else {
      // Always show first page
      items.push(1)
      
      if (currentPage <= 4) {
        // Show first 5 pages + ellipsis + last page
        for (let i = 2; i <= 5; i++) {
          items.push(i)
        }
        items.push('ellipsis')
        items.push(totalPages)
      } else if (currentPage >= totalPages - 3) {
        // Show first page + ellipsis + last 5 pages
        items.push('ellipsis')
        for (let i = totalPages - 4; i <= totalPages; i++) {
          items.push(i)
        }
      } else {
        // Show first page + ellipsis + current-1, current, current+1 + ellipsis + last page
        items.push('ellipsis')
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          items.push(i)
        }
        items.push('ellipsis')
        items.push(totalPages)
      }
    }
    
    return items
  }

  const paginationItems = generatePaginationItems()

  const isAllSelected =
    data.length > 0 && selectedItems.size === data.filter((b) => b.id).length
  const isSomeSelected =
    selectedItems.size > 0 &&
    selectedItems.size < data.filter((b) => b.id).length

  if (loading) {
    return (
      <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <Box>
      <GoBackButton />
      <Box className="container mx-auto mt-12 p-4">
        {/* Header */}
        <Box className="grid grid-cols-1 lg:grid-cols-2 mb-6 gap-4">
          <Text className="text-3xl font-semibold leading-9">
            Manage Children ({filteredData.length} total)
          </Text>
          <Box className="flex gap-3 justify-end">
            <CreateDrawer
              formData={formData}
              isDrawerOpen={isCreateDrawerOpen}
              setIsDrawerOpen={setIsCreateDrawerOpen}
              setFormData={(value) => {
                if (typeof value === "function") {
                  const currentValue = value(formData)
                  setFormData(currentValue)
                } else {
                  setFormData(value)
                }
              }}
              handleInputChange={handleInputChange}
              handleSelectChange={handleSelectChange}
              handleLocationSelect={handleLocationSelect}
              handleSubmit={handleSubmit}
              imageFiles={imageFiles}
              setImageFiles={(value) =>
                typeof value === "function"
                  ? setImageFiles(value(imageFiles))
                  : setImageFiles(value)
              }
              videoFiles={videoFiles}
              setVideoFiles={(value) =>
                typeof value === "function"
                  ? setVideoFiles(value(videoFiles))
                  : setVideoFiles(value)
              }
              handleDrawerClose={() => setIsCreateDrawerOpen(false)}
            />
            {selectedCount > 0 && (
              <Button
                onClick={handleBulkDelete}
                className="border-[2px] border-[#E0E0E0] bg-red-500 text-white w-fit h-[40px] px-4"
              >
                <MdDeleteOutline className="mr-[3.5px]" /> Bulk Delete (
                {selectedCount})
              </Button>
            )}
          </Box>
        </Box>

        {/* Search and Select All */}
        <Box className="mb-6 space-y-4">
          <Input
            placeholder="Search by name or username"
            value={searchTerm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setSearchTerm(e.target.value)
            }
            className="border max-w-md"
            px={3}
            py={2}
          />

          {data.length > 0 && (
            <Box className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <Checkbox
                checked={isAllSelected}
                _indeterminate={isSomeSelected ? {} : undefined}
                onCheckedChange={handleSelectAll}
                className="h-5 w-5 border-2 border-gray-400"
              />
              <Text className="text-sm font-medium text-gray-700">
                Select All ({selectedCount} selected)
              </Text>
              {selectedCount > 0 && (
                <Text className="text-xs text-gray-500 ml-auto">
                  {selectedCount} of {data.filter((b) => b.id).length} children
                  selected
                </Text>
              )}
            </Box>
          )}
        </Box>

        {/* Grid Layout */}
        <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {paginatedData.map((beneficiary) => (
            <BeneficiaryCard
              key={beneficiary.id || beneficiary.username}
              beneficiary={beneficiary}
              isSelected={
                beneficiary.id ? selectedItems.has(beneficiary.id) : false
              }
              onSelect={handleSelectItem}
              onEdit={handleEditBeneficiary}
              beneficiaryImages={beneficiaryImages}
              loadingImages={loadingImages}
            />
          ))}
        </Box>

        {filteredData.length === 0 && (
          <Box className="text-center py-12">
            <Text className="text-gray-500">
              No children found matching your search.
            </Text>
          </Box>
        )}

        {/* Pagination */}
        {filteredData.length > itemsPerPage && (
          <Flex justify="center" mt={8} gap={2} flexWrap="wrap">
            <Flex gap={1} align="center">
              <Button
                onClick={() => {
                  setCurrentPage((prev) => Math.max(1, prev - 1))
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                disabled={currentPage === 1}
                size="sm"
                variant="outline"
              >
                Previous
              </Button>
              
              {paginationItems.map((item, index) => (
                <React.Fragment key={index}>
                  {item === 'ellipsis' ? (
                    <Box px={2} py={1} color="gray.500">
                      ...
                    </Box>
                  ) : (
                    <Button
                      onClick={() => {
                        setCurrentPage(item as number)
                        window.scrollTo({ top: 0, behavior: "smooth" })
                      }}
                      colorScheme={currentPage === item ? "blue" : undefined}
                      variant={currentPage === item ? "solid" : "outline"}
                      size="sm"
                      aria-current={currentPage === item ? "page" : undefined}
                      fontWeight={currentPage === item ? "bold" : "normal"}
                    >
                      {item}
                    </Button>
                  )}
                </React.Fragment>
              ))}
              
              <Button
                onClick={() => {
                  const totalPages = Math.ceil(filteredData.length / itemsPerPage) // Calculate here too
                  setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
                disabled={currentPage === Math.ceil(filteredData.length / itemsPerPage)} // And here
                size="sm"
                variant="outline"
              >
                Next
              </Button>
            </Flex>
          </Flex>
        )}

        {/* Edit Drawer */}
        {isEditDrawerOpen && selectedBeneficiary && (
          <EditDrawer
            selectedChild={selectedBeneficiary as Partial<Beneficiaries>}
            formDataEdit={formDataEdit as Partial<Beneficiaries>}
            setFormDataEdit={(value) => {
              if (typeof value === "function") {
                const currentValue = value(formDataEdit)
                setFormDataEdit(currentValue)
              } else {
                setFormDataEdit(value)
              }
            }}
            isDrawerOpen={isEditDrawerOpen}
            onClose={() => setIsEditDrawerOpen(false)}
            onSave={handleSave}
            onDelete={handleDelete}
            imageFiles={imageFiles}
            setImageFiles={(value) =>
              typeof value === "function"
                ? setImageFiles(value(imageFiles))
                : setImageFiles(value)
            }
            videoFiles={videoFiles}
            setVideoFiles={(value) =>
              typeof value === "function"
                ? setVideoFiles(value(videoFiles))
                : setVideoFiles(value)
            }
          />
        )}

        {/* Delete Dialog */}
        <DeleteDialog
          isOpen={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={confirmDelete}
          itemCount={selectedRowsForDeletion.length}
        />
      </Box>
    </Box>
  )
}

export default ChildrenTable

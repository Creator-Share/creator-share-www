"use client"
import React, { useEffect, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { Box, Flex, Button, Spinner, Badge } from "@chakra-ui/react"
import { toaster } from "@/components/ui/toaster"
import DeleteDialog from "./components/DeleteDialog"
import BeneficiaryCard from "./components/BeneficiaryCard"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"
import { dollarsToCents } from "@/utils/currency"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { useFormStore } from "@/store/formStore"
import { BulkActionButton } from "@/components/admin-ui/BulkActionButton"
import { GoPlusCircle } from "react-icons/go"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import SponsorshipFilters from "@/app/sponsorships/components/SponsorshipFilters"

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), {
  ssr: false,
})
const EditDrawer = dynamic(() => import("./components/EditDrawer"), {
  ssr: false,
})

const ChildrenTable = () => {
  const {
    formData,
    setFormData,
    formDataEdit,
    setFormDataEdit,
    imageFiles,
    setImageFiles,
    videoFiles,
    setVideoFiles,
  } = useFormStore()

  // Use pagination hook for infinite scroll
  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
    })

  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [beneficiaryImages, setBeneficiaryImages] = useState<
    Record<string, string>
  >({})
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>(
    {}
  )
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectedBeneficiary, setSelectedBeneficiary] =
    useState<Beneficiaries | null>(null)
  const [selectedRowsForDeletion, setSelectedRowsForDeletion] = useState<
    Beneficiaries[]
  >([])
  const fetchedImagesRef = useRef<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  // Status stats
  const [stats, setStats] = useState<{
    total: number
    statusCounts: Record<string, number>
  }>({
    total: 0,
    statusCounts: {
      New: 0,
      "Partially Funded": 0,
      "Budget Fulfilled": 0,
      Draft: 0,
      Archived: 0,
    },
  })

  // Fetch stats
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(
          "/api/admin/beneficiaries/stats?beneficiary_type=CHILD"
        )
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch (error) {
        console.error("Error fetching stats:", error)
      }
    }
    fetchStats()
  }, [beneficiaries]) // Refetch when beneficiaries change

  useEffect(() => {
    if (!formData.status) {
      setFormData({ ...formData, status: "New" })
    }
  }, [formData, setFormData])

  // Lazy load images only for visible beneficiaries
  const fetchImagesForVisibleBeneficiaries = useCallback(
    async (visibleBeneficiaries: Beneficiaries[]) => {
      if (!visibleBeneficiaries?.length) return

      // Get IDs that need to be fetched (not already fetched and not currently loading)
      const idsToFetch = visibleBeneficiaries
        .map((b) => b.id)
        .filter(
          (id): id is string =>
            !!id && !fetchedImagesRef.current.has(id) && !loadingImages[id]
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
                `/api/admin/beneficiaries/images/${id}`
              )
              if (response.ok) {
                const images = await response.json()
                if (images && images.length > 0) {
                  // Filter for only IMAGE type media
                  const imageMedia = images.filter(
                    (img: BeneficiaryMedia) => img.type === "IMAGE"
                  )

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
                console.error(
                  `Failed to fetch images for beneficiary ${id}:`,
                  response.status,
                  response.statusText
                )
              }
            } catch (error) {
              console.error("Error fetching beneficiary image:", error)
            } finally {
              setLoadingImages((prev) => ({ ...prev, [id]: false }))
            }
          })
        )

        // Small delay between batches to prevent overwhelming the server
        if (i + batchSize < idsToFetch.length) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    },
    [loadingImages]
  )

  // Fetch images when visible beneficiaries change
  useEffect(() => {
    if (beneficiaries.length) {
      fetchImagesForVisibleBeneficiaries(beneficiaries)
    }
  }, [beneficiaries, fetchImagesForVisibleBeneficiaries])

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

  // Add this useEffect to ensure selection state is properly managed
  useEffect(() => {
    // Clear selection if selected items no longer exist in data
    if (selectedItems.size > 0) {
      const existingIds = new Set(
        beneficiaries.filter((b) => b.id).map((b) => b.id!)
      )
      const validSelectedItems = Array.from(selectedItems).filter((id) =>
        existingIds.has(id)
      )

      if (validSelectedItems.length !== selectedItems.size) {
        setSelectedItems(new Set(validSelectedItems))
      }
    }
  }, [beneficiaries, selectedItems])

  // Infinite scroll detection
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let ticking = false
    let lastLoadTime = 0
    const LOAD_THROTTLE_MS = 500
    const SCROLL_THRESHOLD_PX = 300

    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const now = Date.now()

        // Check if container has internal scroll
        const hasInternalScroll =
          container.scrollHeight > container.clientHeight

        let distanceFromBottom
        if (hasInternalScroll) {
          // Container is scrolling internally
          const scrollTop = container.scrollTop
          const scrollHeight = container.scrollHeight
          const clientHeight = container.clientHeight
          distanceFromBottom = scrollHeight - (scrollTop + clientHeight)
        } else {
          // Container fits in viewport, use window scroll position
          const rect = container.getBoundingClientRect()
          distanceFromBottom = rect.bottom - window.innerHeight
        }

        if (
          distanceFromBottom <= SCROLL_THRESHOLD_PX &&
          hasMore &&
          !isLoading &&
          now - lastLoadTime > LOAD_THROTTLE_MS
        ) {
          lastLoadTime = now
          loadMore()
        }
        ticking = false
      })
    }

    // Listen to both container scroll and window scroll
    container.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", onScroll)
      window.removeEventListener("scroll", onScroll)
    }
  }, [hasMore, isLoading, loadMore])

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
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
    country: string
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

    try {
      const res = await fetch("/api/admin/beneficiaries/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formDataWithCents,
          beneficiary_type: "CHILD",
        }),
      })

      if (!res.ok) {
        throw new Error("Failed to create beneficiary")
      }

      const { beneficiaryId } = await res.json()

      // Upload images and videos
      if (imageFiles.length > 0 || videoFiles.length > 0) {
        const formDataMedia = new FormData()
        imageFiles.forEach((file) => formDataMedia.append("images", file))
        videoFiles.forEach((file) => formDataMedia.append("videos", file))

        await fetch(`/api/admin/beneficiaries/media/upload/${beneficiaryId}`, {
          method: "POST",
          body: formDataMedia,
        })
      }

      setIsCreateDrawerOpen(false)
      toaster.create({
        title: "Success",
        description: "Child created successfully.",
        duration: 5000,
      })

      // Reload the list
      window.location.reload()
      return true
    } catch (error) {
      toaster.create({
        title: "Error",
        description: "Failed to create beneficiary",
        duration: 5000,
      })
      return false
    }
  }

  const handleSave = async (updated: Partial<Beneficiaries>) => {
    try {
      const res = await fetch(`/api/admin/beneficiaries/update/${updated.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
      })

      if (!res.ok) {
        throw new Error("Failed to update beneficiary")
      }

      // Force re-fetch images for the updated child
      if (updated.id) {
        // Clear cached images
        setBeneficiaryImages((prev) => {
          const newState = { ...prev }
          delete newState[updated.id!]
          return newState
        })

        // Remove from fetchedImagesRef
        fetchedImagesRef.current.delete(updated.id!)

        try {
          const response = await fetch(
            `/api/admin/beneficiaries/images/${updated.id}`
          )
          if (response.ok) {
            const images = await response.json()
            const imageMedia = images.filter(
              (img: BeneficiaryMedia) => img.type === "IMAGE"
            )

            if (imageMedia.length > 0) {
              const img = imageMedia[0]
              const src = img?.id
                ? generatePublicUrl(img as unknown as MediaRow)
                : img?.image_url || ""

              if (src && src.trim() !== "") {
                setBeneficiaryImages((prev) => ({
                  ...prev,
                  [updated.id!]: src,
                }))
              }
            }
          }
        } catch (error) {
          console.error("Error re-fetching images for updated child:", error)
        }
      }

      setIsEditDrawerOpen(false)
      toaster.create({
        title: "Success",
        description: "Child updated successfully.",
        duration: 5000,
      })

      // Reload to show changes
      window.location.reload()
    } catch (error) {
      toaster.create({
        title: "Error",
        description: "Failed to update beneficiary",
        duration: 5000,
      })
    }
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

    const selectedBeneficiaries = beneficiaries.filter(
      (b) => b.id && selectedItems.has(b.id)
    )
    setSelectedRowsForDeletion(selectedBeneficiaries)
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    try {
      const beneficiaryIds = selectedRowsForDeletion
        .map((b) => b.id)
        .filter((id): id is string => typeof id === "string")

      const res = await fetch("/api/admin/beneficiaries/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: beneficiaryIds }),
      })

      if (!res.ok) {
        throw new Error("Failed to delete beneficiaries")
      }

      setSelectedItems(new Set())
      setSelectedRowsForDeletion([])
      setIsDeleteDialogOpen(false)
      toaster.create({
        title: "Success",
        description: "Selected beneficiaries deleted successfully.",
        duration: 5000,
      })

      // Reload the list
      window.location.reload()
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
    try {
      const res = await fetch(
        `/api/admin/beneficiaries/delete/${beneficiaryId}`,
        {
          method: "DELETE",
        }
      )

      if (!res.ok) {
        throw new Error("Failed to delete beneficiary")
      }

      setIsEditDrawerOpen(false)
      toaster.create({
        title: "Success",
        description: "Child deleted successfully.",
        duration: 5000,
      })

      // Reload the list
      window.location.reload()
    } catch (error) {
      toaster.create({
        title: "Error",
        description: "Failed to delete child",
        duration: 5000,
      })
    }
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = beneficiaries.filter((b) => b.id).map((b) => b.id!)
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

  // Single responsibility - handle any bulk status update
  const handleBulkStatusUpdate = async (status: string) => {
    if (selectedItems.size === 0) return

    try {
      const beneficiaryIds = Array.from(selectedItems)
      console.log(
        "Updating status for IDs:",
        beneficiaryIds,
        "to status:",
        status
      )

      const res = await fetch("/api/admin/beneficiaries/bulk-update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: beneficiaryIds, status }),
      })

      if (!res.ok) {
        throw new Error("Failed to update status")
      }

      // Clear selection BEFORE making the API call to prevent race conditions
      setSelectedItems(new Set())
      setSelectedRowsForDeletion([])

      toaster.create({
        title: "Success",
        description: `Selected beneficiaries moved to ${status.toLowerCase()} successfully.`,
        duration: 5000,
      })

      // Reload the list
      window.location.reload()
    } catch (error) {
      console.error("Bulk status update error:", error)
      toaster.create({
        title: "Error",
        description: `Failed to update selected beneficiaries: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        duration: 5000,
      })
    }
  }

  const isAllSelected =
    beneficiaries.length > 0 &&
    selectedItems.size === beneficiaries.filter((b) => b.id).length
  const isSomeSelected =
    selectedItems.size > 0 &&
    selectedItems.size < beneficiaries.filter((b) => b.id).length

  const hasResults = beneficiaries.length > 0

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
      default:
        return "gray"
    }
  }

  return (
    <AdminPageLayout
      title="Children"
      description="Manage child beneficiaries"
      breadcrumb={[{ label: "Children" }]}
      hideSearchSection={true}
      showSelectAll={true}
      isAllSelected={isAllSelected}
      isSomeSelected={isSomeSelected}
      onSelectAll={handleSelectAll}
      selectedCount={selectedItems.size}
      totalCount={beneficiaries.filter((b) => b.id).length}
      bulkActions={
        selectedItems.size > 0 ? (
          <>
            <BulkActionButton
              label="Delete"
              count={selectedItems.size}
              action={handleBulkDelete}
              className="border-[2px] border-transparent rounded-md w-full md:w-fit h-[40px] px-10 bg-[#ff0000] text-white hover:bg-[#ff0000] hover:text-white"
            />
            <BulkActionButton
              label="Archive"
              count={selectedItems.size}
              action={() => handleBulkStatusUpdate("Archived")}
              className="border-[2px] border-[#000000] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#ffffff] text-black hover:bg-[#f0f0f0] hover:text-black"
            />
            <BulkActionButton
              label="Draft"
              count={selectedItems.size}
              action={() => handleBulkStatusUpdate("Draft")}
              className="border-[2px] border-[#000000] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#ffffff] text-black hover:bg-[#f0f0f0] hover:text-black"
            />
          </>
        ) : undefined
      }
      primaryAction={
        <Button
          onClick={() => setIsCreateDrawerOpen(true)}
          className="border-[2px] border-[#E0E0E0] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#1C3C8C] text-white"
        >
          <GoPlusCircle className="mr-2" />
          Add New
        </Button>
      }
      showResults={hasResults || isLoading}
      noResultsMessage="No children found matching your search."
    >
      {/* Filters */}
      <Box mb={6}>
        <SponsorshipFilters
          onFilterChange={handleFilterChange}
          beneficiaryType="CHILD"
        />
      </Box>

      {/* Status Badges */}
      <Flex gap={3} mb={6} flexWrap="wrap">
        <Badge colorPalette="gray" size="lg" px={4} py={2}>
          Total: {stats.total}
        </Badge>
        {Object.entries(stats.statusCounts).map(([status, count]) => (
          <Badge
            key={status}
            colorPalette={getStatusBadgeColor(status)}
            size="lg"
            px={4}
            py={2}
          >
            {status}: {count}
          </Badge>
        ))}
      </Flex>

      {/* Grid Layout */}
      <Box
        ref={containerRef}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {beneficiaries.map((beneficiary) => (
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

      {/* Infinite scroll loading indicator */}
      {isLoading && (
        <Flex justify="center" py={12} align="center">
          <Spinner size="xl" color="blue.500" />
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

      {/* Create Drawer */}
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
    </AdminPageLayout>
  )
}

export default ChildrenTable

"use client"
import React, { useEffect, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { Box, Flex, Button, Spinner, Text } from "@chakra-ui/react"
import { toaster } from "@/components/ui/toaster"
import DeleteDialog from "./components/DeleteDialog"
import BeneficiaryCard from "./components/BeneficiaryCard"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"
import { dollarsToCents } from "@/utils/currency"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { compressImages } from "@/utils/imageCompression"
import { useFormStore } from "@/store/formStore"
import { useFilterStore } from "@/store/filterStore"
import { GoPlusCircle } from "react-icons/go"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import SponsorshipFilters from "@/app/sponsorships/components/SponsorshipFilters"
import FloatingActionBar from "@/components/admin-ui/FloatingActionBar"

type FiltersState = {
  gender: string
  ageRange: [number, number]
  status: string[]
  search?: string
  beneficiary_type?: "CHILD" | "ANIMAL" | "FAMILY" | "STREET_INVOLVED"
}

const BeneficiaryModal = dynamic(() => import("./components/BeneficiaryModal"), {
  ssr: false,
})

const ChildrenTable = () => {
  const {
    formData,
    setFormData,
    imageFiles,
    setImageFiles,
    videoFiles,
    setVideoFiles,
  } = useFormStore()

  // Define all statuses for admin mode
  const allStatuses = [
    "New",
    "Partially Funded",
    "Budget Fulfilled",
    "Draft",
    "Archived",
    "Sponsorship Cancelled",
  ]

  const { setStatus: setFilterStatus } = useFilterStore()

  // Use pagination hook for infinite scroll with admin mode configuration
  // Initialize with all statuses to avoid race condition when all children are Draft
  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: "CHILD",
      autoRetry: true,
      initialStatus: allStatuses, // Initialize with all statuses from the start
      isAdminMode: true, // Enable admin mode (allows ageRange filtering with Draft)
    })

  // Initialize filter store with admin statuses on mount
  // This syncs the filter store with the hook's initial filters
  useEffect(() => {
    setFilterStatus(allStatuses)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFilterStatus])

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
      "Sponsorship Cancelled": 0,
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
      !formData.biography ||
      !formData.status ||
      !formData.country
    ) {
      toaster.create({
        title: "Error",
        description: "Please fill in all required fields",
        duration: 5000,
      })
      return false
    }

    // Ensure budget_goal is a valid number
    const budgetGoalInCents = Math.max(0, parseInt(dollarsToCents(formData.budget_goal || 0)))

    try {
      // Send data as JSON
      const birthDateIsEstimate =
        Boolean(formData.metadata?.birth_date_is_estimate) ||
        Boolean((formData as { birth_date_is_estimate?: boolean }).birth_date_is_estimate)

      const dataToSend = {
        name: formData.name,
        username: formData.username,
        gender: formData.gender,
        birth_date: formData.birth_date || undefined,
        biography: formData.biography,
        budget_goal: Number(budgetGoalInCents),
        budget_raised: 0,
        status: formData.status,
        country: formData.country,
        location_str: formData.location_str || "",
        location_geo: formData.location_geo || null,
        metadata: {
          ...(formData.metadata || {}),
          birth_date_is_estimate: birthDateIsEstimate,
        },
        beneficiary_type: "CHILD"
      }

      const res = await fetch("/api/admin/beneficiaries/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(dataToSend)
      })

      if (!res.ok) {
        throw new Error("Failed to create beneficiary")
      }

      const responseData = await res.json()
      const beneficiaryId = responseData.beneficiary?.id || responseData.beneficiaryId

      // Upload images (compressed to ensure under 4MB)
      if (imageFiles.length > 0) {
        try {
          // Compress images before upload
          const compressedFiles = await compressImages(imageFiles, {
            maxSizeMB: 3.5,
          })

          const formDataImages = new FormData()
          formDataImages.append("beneficiaryId", beneficiaryId)
          compressedFiles.forEach((file) => formDataImages.append("images", file))

          const uploadImagesRes = await fetch(`/api/admin/beneficiaries/images/create`, {
            method: "POST",
            body: formDataImages,
          })

          if (!uploadImagesRes.ok) {
            console.error('Failed to upload images:', await uploadImagesRes.text())
            toaster.create({
              title: "Warning",
              description: "Child was created but image upload failed",
              duration: 5000,
            })
          }
        } catch (error) {
          console.error('Image upload error:', error)
          toaster.create({
            title: "Warning",
            description: "Child was created but image upload failed",
            duration: 5000,
          })
        }
      }

      // Upload video
      if (videoFiles.length > 0) {
        const formDataVideo = new FormData()
        formDataVideo.append("beneficiaryId", beneficiaryId)
        formDataVideo.append("video", videoFiles[0]) // Only upload first video

        const uploadVideoRes = await fetch(`/api/admin/beneficiaries/video/create`, {
          method: "POST",
          body: formDataVideo,
        })

        if (!uploadVideoRes.ok) {
          console.error('Failed to upload video:', await uploadVideoRes.text())
          toaster.create({
            title: "Warning",
            description: "Child was created but video upload failed",
            duration: 5000,
          })
        }
      }

      setIsCreateDrawerOpen(false)
      toaster.create({
        title: "Success",
        description: "Child created successfully.",
        duration: 5000,
      })

      // Refresh the list while maintaining current filter state
      const allStatuses = [
        "New",
        "Partially Funded",
        "Budget Fulfilled",
        "Draft",
        "Archived",
        "Sponsorship Cancelled",
      ]
      setFilterStatus(allStatuses)
      handleFilterChange({
        gender: "",
        ageRange: [0, 14] as [number, number],
        status: allStatuses,
        search: "",
        beneficiary_type: "CHILD"
      })
      return true
    } catch {
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

      // Refresh the list using current filter state
      const currentFilters: FiltersState = {
        gender: "",
        ageRange: [0, 14] as [number, number],
        status: updated.status ? [updated.status] : ["New"],
        search: "",
        beneficiary_type: "CHILD"
      }
      setFilterStatus(currentFilters.status)
      handleFilterChange(currentFilters)
    } catch {
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

      // Refresh the list using current filter state
      const currentFilters: FiltersState = {
        gender: "",
        ageRange: [0, 14] as [number, number],
        status: ["New", "Partially Funded", "Budget Fulfilled", "Draft", "Archived", "Sponsorship Cancelled"],
        search: "",
        beneficiary_type: "CHILD"
      }
      setFilterStatus(currentFilters.status)
      handleFilterChange(currentFilters)
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
    } catch {
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

  const handleStatusBadgeClick = (status: string) => {
    // Update the filter store AND call handleFilterChange
    setFilterStatus([status])
    handleFilterChange({ status: [status] })
  }

  const handleTotalBadgeClick = () => {
    // Reset to admin default (all statuses)
    const allStatuses = [
      "New",
      "Partially Funded",
      "Budget Fulfilled",
      "Draft",
      "Archived",
    ]
    setFilterStatus(allStatuses)
    handleFilterChange({ status: allStatuses })
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

      // Clear selection after successful update
      setSelectedItems(new Set())
      setSelectedRowsForDeletion([])

      toaster.create({
        title: "Success",
        description: `Selected beneficiaries moved to ${status.toLowerCase()} successfully.`,
        duration: 5000,
      })

      // Refresh the list using current filter state instead of reloading
      const allStatuses = [
        "New",
        "Partially Funded",
        "Budget Fulfilled",
        "Draft",
        "Archived",
        "Sponsorship Cancelled",
      ]
      setFilterStatus(allStatuses)
      handleFilterChange({
        gender: "",
        ageRange: [0, 14] as [number, number],
        status: allStatuses,
        search: "",
        beneficiary_type: "CHILD"
      })
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

  // Reinstate children from "Sponsorship Cancelled" back to "New"
  const handleReinstate = async () => {
    // Filter selected items to only those with "Sponsorship Cancelled" status
    const cancelledBeneficiaries = beneficiaries.filter(
      (b) => b.id && selectedItems.has(b.id) && b.status === "Sponsorship Cancelled"
    )

    if (cancelledBeneficiaries.length === 0) {
      toaster.create({
        title: "No Selection",
        description: "Please select children with 'Sponsorship Cancelled' status to reinstate.",
        duration: 5000,
      })
      return
    }

    try {
      const beneficiaryIds = cancelledBeneficiaries.map((b) => b.id!).filter((id): id is string => !!id)

      const res = await fetch("/api/admin/beneficiaries/bulk-update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: beneficiaryIds, status: "New" }),
      })

      if (!res.ok) {
        throw new Error("Failed to reinstate beneficiaries")
      }

      // Clear selection after successful update
      setSelectedItems(new Set())
      setSelectedRowsForDeletion([])

      toaster.create({
        title: "Success",
        description: `${cancelledBeneficiaries.length} child(ren) reinstated to "New" status successfully.`,
        duration: 5000,
      })

      // Refresh the list
      const allStatuses = [
        "New",
        "Partially Funded",
        "Budget Fulfilled",
        "Draft",
        "Archived",
        "Sponsorship Cancelled",
      ]
      setFilterStatus(allStatuses)
      handleFilterChange({
        gender: "",
        ageRange: [0, 14] as [number, number],
        status: allStatuses,
        search: "",
        beneficiary_type: "CHILD"
      })
    } catch (error) {
      console.error("Reinstate error:", error)
      toaster.create({
        title: "Error",
        description: `Failed to reinstate beneficiaries: ${
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
      primaryAction={
        <Button
          onClick={() => {
            // Open create modal without affecting filters
            setIsCreateDrawerOpen(true)
            // Ensure form data has default status
            if (!formData.status) {
              setFormData({ ...formData, status: "New" })
            }
          }}
          className="border-[2px] border-[#E0E0E0] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#1C3C8C] text-white"
        >
          <GoPlusCircle className="mr-2" />
          Add New
        </Button>
      }
      showResults={true}
      noResultsMessage="No children found matching your search."
    >
      {/* Filters */}
      <Box mb={6}>
        <SponsorshipFilters
          onFilterChange={handleFilterChange}
          beneficiaryType="CHILD"
          isAdminMode={true}
        />
      </Box>

      {/* Status Badges */}
      <Flex gap={3} mb={6} flexWrap="wrap">
        <Button
          colorPalette="gray"
          size="lg"
          px={4}
          py={2}
          onClick={handleTotalBadgeClick}
          variant="subtle"
          style={{ cursor: "pointer", fontWeight: "normal" }}
        >
          Total: {stats.total}
        </Button>
        {Object.entries(stats.statusCounts).map(([status, count]) => (
          <Button
            key={status}
            colorPalette={getStatusBadgeColor(status)}
            size="lg"
            px={4}
            py={2}
            onClick={() => handleStatusBadgeClick(status)}
            variant="subtle"
            style={{ cursor: "pointer", fontWeight: "normal" }}
          >
            {status}: {count}
          </Button>
        ))}
      </Flex>

      {/* Scrollable Container with Grid Layout */}
      <Box
        ref={containerRef}
        width="100%"
        className="border bg-white rounded-2xl"
        style={{
          minHeight: beneficiaries.length ? "auto" : "100px",
          maxHeight: "200vh",
          overflowY: "auto",
        }}
      >
        <Box p={8}>
          {beneficiaries.length === 0 && !isLoading ? (
            <Flex justify="center" py={12} align="center" direction="column">
              <Text fontSize="lg" color="gray.600" textAlign="center">
                No children found
              </Text>
              <Text fontSize="sm" color="gray.500" textAlign="center" mt={2}>
                Try adjusting your search or filters to find more results
              </Text>
            </Flex>
          ) : (
            <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          )}
        </Box>

        {/* Infinite scroll loading indicator */}
        {isLoading && (
          <Flex justify="center" py={12} align="center">
            <Spinner size="xl" color="blue.500" />
          </Flex>
        )}
      </Box>

      {/* Edit Modal */}
      {isEditDrawerOpen && selectedBeneficiary && (
        <BeneficiaryModal
          mode="edit"
          isOpen={isEditDrawerOpen}
          onClose={() => setIsEditDrawerOpen(false)}
          selectedChild={selectedBeneficiary as Partial<Beneficiaries>}
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

      {/* Create Modal */}
      <BeneficiaryModal
        mode="create"
        isOpen={isCreateDrawerOpen}
        onClose={() => setIsCreateDrawerOpen(false)}
        formData={formData}
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
      />

      {/* Floating Action Bar */}
      <FloatingActionBar
        selectedCount={selectedItems.size}
        onDeselectAll={() => setSelectedItems(new Set())}
        onDelete={handleBulkDelete}
        onSetStatus={handleBulkStatusUpdate}
        onReinstate={handleReinstate}
        hasCancelledSelected={beneficiaries.some(
          (b) => b.id && selectedItems.has(b.id) && b.status === "Sponsorship Cancelled"
        )}
      />
    </AdminPageLayout>
  )
}

export default ChildrenTable

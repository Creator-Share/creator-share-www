"use client"
import React, { useEffect, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { Box, Flex, Button, Spinner, Text } from "@chakra-ui/react"
import { toaster } from "@/components/ui/toaster"
import DeleteDialog from "./components/DeleteDialog"
import BulkConfirmDialog from "./components/BulkConfirmDialog"
import BeneficiaryCard from "./components/BeneficiaryCard"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"
import { dollarsToCents } from "@/utils/currency"
import { isOpenSponsorshipType } from "@/config/beneficiaryTypes"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { compressImages } from "@/utils/imageCompression"
import { useFormStore } from "@/store/formStore"
import { useFilterStore } from "@/store/filterStore"
import { GoPlusCircle } from "react-icons/go"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { useBeneficiaryPagination } from "@/hooks/useBeneficiaryPagination"
import SponsorshipFilters from "@/app/sponsorships/components/SponsorshipFilters"
import FloatingActionBar from "@/components/admin-ui/FloatingActionBar"
import {
  BeneficiaryTabType,
  ALL_BENEFICIARY_TABS,
  getApiTypes,
  getMaxAgeYears,
} from "@/config/beneficiaryTypes"
import {
  ALL_STATUSES,
  STATUS_DISPLAY_CONFIG,
} from "@/config/beneficiaryStatuses"

type FiltersState = {
  gender: string
  ageRange: [number, number]
  status: string[]
  search?: string
  /** Accepts single type or comma-separated types (e.g. "CHILD,CHILD_LABORER") */
  beneficiary_type?: string
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

  const allStatuses = ALL_STATUSES as unknown as string[]

  const { setStatus: setFilterStatus } = useFilterStore()

  // Active type tab — null means "All"
  const [activeType, setActiveType] = useState<BeneficiaryTabType | null>(null)

  const { beneficiaries, hasMore, isLoading, handleFilterChange, loadMore, filters } =
    useBeneficiaryPagination({
      recordsPerPage: 9,
      beneficiaryType: activeType ?? undefined,
      autoRetry: true,
      initialStatus: allStatuses,
      isAdminMode: true,
    })

  useEffect(() => {
    setFilterStatus(allStatuses)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFilterStatus])

  const handleTypeChange = useCallback(
    (type: BeneficiaryTabType | null) => {
      setActiveType(type)
      handleFilterChange({
        beneficiary_type: getApiTypes(type),
        gender: "",
        ageRange: [0, getMaxAgeYears(type)],
        status: allStatuses,
        search: "",
      })
      setFilterStatus(allStatuses)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleFilterChange, setFilterStatus]
  )

  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [beneficiaryImages, setBeneficiaryImages] = useState<Record<string, string>>({})
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({})
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiaries | null>(null)
  const [selectedRowsForDeletion, setSelectedRowsForDeletion] = useState<Beneficiaries[]>([])
  const [pendingBulkAction, setPendingBulkAction] = useState<{
    kind: "status" | "type" | "reinstate"
    value: string
    label: string
    ids?: string[]
  } | null>(null)
  const [isSelectingAll, setIsSelectingAll] = useState(false)
  const fetchedImagesRef = useRef<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement>(null)

  const [stats, setStats] = useState<{
    total: number
    statusCounts: Record<string, number>
  }>({
    total: 0,
    statusCounts: Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])),
  })

  // Fetch stats scoped to active type — only re-run when activeType changes, not on every page load
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const typeParam = getApiTypes(activeType)
        const url = typeParam
          ? `/api/admin/beneficiaries/stats?beneficiary_type=${encodeURIComponent(typeParam)}`
          : `/api/admin/beneficiaries/stats`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch (error) {
        console.error("Error fetching stats:", error)
      }
    }
    fetchStats()
  }, [activeType])

  useEffect(() => {
    if (!formData.status) {
      setFormData({ ...formData, status: "New" })
    }
  }, [formData, setFormData])

  const fetchImagesForVisibleBeneficiaries = useCallback(
    async (visibleBeneficiaries: Beneficiaries[]) => {
      if (!visibleBeneficiaries?.length) return
      const idsToFetch = visibleBeneficiaries
        .map((b) => b.id)
        .filter((id): id is string => !!id && !fetchedImagesRef.current.has(id) && !loadingImages[id])
      if (!idsToFetch.length) return

      setLoadingImages((prev) => ({
        ...prev,
        ...Object.fromEntries(idsToFetch.map((id) => [id, true])),
      }))

      const batchSize = 5
      for (let i = 0; i < idsToFetch.length; i += batchSize) {
        const batch = idsToFetch.slice(i, i + batchSize)
        await Promise.all(
          batch.map(async (id) => {
            fetchedImagesRef.current.add(id)
            try {
              const response = await fetch(`/api/admin/beneficiaries/images/${id}`)
              if (response.ok) {
                const images = await response.json()
                if (images?.length > 0) {
                  const imageMedia = images.filter((img: BeneficiaryMedia) => img.type === "IMAGE")
                  if (imageMedia.length > 0) {
                    const img = imageMedia[0]
                    const src = img?.id ? generatePublicUrl(img as unknown as MediaRow) : img?.image_url || ""
                    if (src && src.trim() !== "") {
                      setBeneficiaryImages((prev) => ({ ...prev, [id]: src }))
                    }
                  }
                }
              }
            } catch (error) {
              console.error("Error fetching beneficiary image:", error)
            } finally {
              setLoadingImages((prev) => ({ ...prev, [id]: false }))
            }
          })
        )
        if (i + batchSize < idsToFetch.length) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    },
    [loadingImages]
  )

  useEffect(() => {
    if (beneficiaries.length) fetchImagesForVisibleBeneficiaries(beneficiaries)
  }, [beneficiaries, fetchImagesForVisibleBeneficiaries])

  useEffect(() => {
    if (selectedBeneficiary?.id) setIsEditDrawerOpen(true)
  }, [selectedBeneficiary])

  useEffect(() => {
    if (selectedItems.size > 0) {
      const existingIds = new Set(beneficiaries.filter((b) => b.id).map((b) => b.id!))
      const valid = Array.from(selectedItems).filter((id) => existingIds.has(id))
      if (valid.length !== selectedItems.size) setSelectedItems(new Set(valid))
    }
  }, [beneficiaries, selectedItems])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let ticking = false
    let lastLoadTime = 0
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const now = Date.now()
        const hasInternalScroll = container.scrollHeight > container.clientHeight
        const distanceFromBottom = hasInternalScroll
          ? container.scrollHeight - (container.scrollTop + container.clientHeight)
          : container.getBoundingClientRect().bottom - window.innerHeight
        if (distanceFromBottom <= 300 && hasMore && !isLoading && now - lastLoadTime > 500) {
          lastLoadTime = now
          loadMore()
        }
        ticking = false
      })
    }
    container.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", onScroll)
      window.removeEventListener("scroll", onScroll)
    }
  }, [hasMore, isLoading, loadMore])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData({ ...formData, [name]: name === "budget_goal" ? parseFloat(value) || 0 : value })
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormData({ ...formData, [name]: value })
  }

  const handleLocationSelect = (geo: [number, number], locationStr: string, country: string) => {
    setFormData({
      ...formData,
      location_geo: geo ? { type: "Point", coordinates: [geo[1], geo[0]] } : null,
      location_str: locationStr,
      country,
    })
  }

  const handleSubmit = async (): Promise<boolean> => {
    if (!formData.name || !formData.username || !formData.gender || !formData.biography || !formData.status || !formData.country) {
      toaster.create({ title: "Error", description: "Please fill in all required fields", duration: 5000 })
      return false
    }

    const isOpen = isOpenSponsorshipType(formData.beneficiary_type)
    const budgetGoalInCents = isOpen
      ? -1
      : Math.max(0, parseInt(dollarsToCents(formData.budget_goal || 0)))

    try {
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
        metadata: { ...(formData.metadata || {}), birth_date_is_estimate: birthDateIsEstimate },
          beneficiary_type: formData.beneficiary_type || "CHILD",
      }

      const res = await fetch("/api/admin/beneficiaries/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataToSend),
      })
      if (!res.ok) throw new Error("Failed to create beneficiary")

      const responseData = await res.json()
      const beneficiaryId = responseData.beneficiary?.id || responseData.beneficiaryId

      if (imageFiles.length > 0) {
        try {
          const compressedFiles = await compressImages(imageFiles, { maxSizeMB: 3.5 })
          const fd = new FormData()
          fd.append("beneficiaryId", beneficiaryId)
          compressedFiles.forEach((f) => fd.append("images", f))
          const uploadRes = await fetch(`/api/admin/beneficiaries/images/create`, { method: "POST", body: fd })
          if (!uploadRes.ok) toaster.create({ title: "Warning", description: "Beneficiary created but image upload failed", duration: 5000 })
        } catch (error) {
          console.error("Image upload error:", error)
        }
      }

      if (videoFiles.length > 0) {
        const fd = new FormData()
        fd.append("beneficiaryId", beneficiaryId)
        fd.append("video", videoFiles[0])
        const uploadRes = await fetch(`/api/admin/beneficiaries/video/create`, { method: "POST", body: fd })
        if (!uploadRes.ok) toaster.create({ title: "Warning", description: "Beneficiary created but video upload failed", duration: 5000 })
      }

      setIsCreateDrawerOpen(false)
      toaster.create({ title: "Success", description: "Beneficiary created successfully.", duration: 5000 })
      setFilterStatus(allStatuses)
      handleFilterChange({ gender: "", ageRange: [0, getMaxAgeYears(activeType)], status: allStatuses, search: "" })
      return true
    } catch {
      toaster.create({ title: "Error", description: "Failed to create beneficiary", duration: 5000 })
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
      if (!res.ok) throw new Error("Failed to update beneficiary")

      if (updated.id) {
        setBeneficiaryImages((prev) => { const s = { ...prev }; delete s[updated.id!]; return s })
        fetchedImagesRef.current.delete(updated.id!)
        try {
          const response = await fetch(`/api/admin/beneficiaries/images/${updated.id}`)
          if (response.ok) {
            const images = await response.json()
            const imageMedia = images.filter((img: BeneficiaryMedia) => img.type === "IMAGE")
            if (imageMedia.length > 0) {
              const img = imageMedia[0]
              const src = img?.id ? generatePublicUrl(img as unknown as MediaRow) : img?.image_url || ""
              if (src?.trim()) setBeneficiaryImages((prev) => ({ ...prev, [updated.id!]: src }))
            }
          }
        } catch (error) { console.error("Error re-fetching images:", error) }
      }

      setIsEditDrawerOpen(false)
      toaster.create({ title: "Success", description: "Beneficiary updated successfully.", duration: 5000 })
      const currentFilters: FiltersState = {
        gender: "", ageRange: [0, getMaxAgeYears(activeType)],
        status: allStatuses, search: "",
      }
      setFilterStatus(currentFilters.status)
      handleFilterChange(currentFilters)
    } catch {
      toaster.create({ title: "Error", description: "Failed to update beneficiary", duration: 5000 })
    }
  }

  const handleBulkDelete = () => {
    if (selectedItems.size === 0) {
      toaster.create({ title: "No Selection", description: "No rows selected for deletion.", duration: 5000 })
      return
    }
    setSelectedRowsForDeletion(beneficiaries.filter((b) => b.id && selectedItems.has(b.id)))
    setIsDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    try {
      const ids = selectedRowsForDeletion.map((b) => b.id).filter((id): id is string => typeof id === "string")
      const res = await fetch("/api/admin/beneficiaries/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error("Failed to delete beneficiaries")
      setSelectedItems(new Set())
      setSelectedRowsForDeletion([])
      setIsDeleteDialogOpen(false)
      toaster.create({ title: "Success", description: "Selected beneficiaries deleted successfully.", duration: 5000 })
      const filters: FiltersState = { gender: "", ageRange: [0, getMaxAgeYears(activeType)], status: allStatuses, search: "" }
      setFilterStatus(filters.status)
      handleFilterChange(filters)
    } catch (error) {
      console.error("Bulk delete error:", error)
      toaster.create({ title: "Error", description: "Failed to delete selected beneficiaries. Please try again.", duration: 5000 })
    }
  }

  const handleDelete = async (beneficiaryId: string) => {
    try {
      const res = await fetch(`/api/admin/beneficiaries/delete/${beneficiaryId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete beneficiary")
      setIsEditDrawerOpen(false)
      setSelectedBeneficiary(null)
      toaster.create({ title: "Success", description: "Beneficiary deleted successfully.", duration: 5000 })
      setFilterStatus(allStatuses)
      handleFilterChange({ gender: "", ageRange: [0, activeType === "ANIMAL" ? 20 : 14], status: allStatuses, search: "" })
    } catch {
      toaster.create({ title: "Error", description: "Failed to delete beneficiary", duration: 5000 })
    }
  }

  const handleSelectAll = (checked: boolean) => {
    setSelectedItems(checked ? new Set(beneficiaries.filter((b) => b.id).map((b) => b.id!)) : new Set())
  }

  const handleSelectVisible = () => {
    setSelectedItems(new Set(beneficiaries.filter((b) => b.id).map((b) => b.id!)))
  }

  const handleSelectAllMatching = async () => {
    setIsSelectingAll(true)
    try {
      const params = new URLSearchParams()
      if (filters.beneficiary_type) params.set("beneficiary_type", filters.beneficiary_type)
      if (filters.gender) params.set("gender", filters.gender)
      if (filters.status?.length) params.set("status", filters.status.join(","))
      if (filters.ageRange) params.set("ageRange", filters.ageRange.join(","))
      if (filters.search) params.set("search", filters.search)

      const res = await fetch(`/api/admin/beneficiaries/ids?${params.toString()}`)
      if (!res.ok) throw new Error("Failed to fetch matching IDs")
      const data = await res.json()
      setSelectedItems(new Set(data.ids as string[]))
    } catch (error) {
      console.error("Select all matching error:", error)
      toaster.create({ title: "Error", description: "Failed to select all matching beneficiaries.", duration: 5000 })
    } finally {
      setIsSelectingAll(false)
    }
  }

  const handleSelectItem = (id: string, checked: boolean) => {
    const s = new Set(selectedItems)
    if (checked) s.add(id)
    else s.delete(id)
    setSelectedItems(s)
  }

  const handleEditBeneficiary = (beneficiary: Beneficiaries) => {
    setSelectedBeneficiary(beneficiary)
    setIsEditDrawerOpen(true)
  }

  const handleStatusBadgeClick = (status: string) => {
    setFilterStatus([status])
    handleFilterChange({ status: [status] })
  }

  const handleTotalBadgeClick = () => {
    setFilterStatus(allStatuses)
    handleFilterChange({ status: allStatuses })
  }

  const handleBulkStatusUpdate = (status: string) => {
    if (selectedItems.size === 0) return
    setPendingBulkAction({ kind: "status", value: status, label: `set status to "${status}"` })
  }

  const handleBulkTypeUpdate = (type: string) => {
    if (selectedItems.size === 0) return
    const match = ALL_BENEFICIARY_TABS.find((t) => t.type === type && !t.isLegacyAlias)
    setPendingBulkAction({ kind: "type", value: type, label: `change type to "${match?.label ?? type}"` })
  }

  const handleReinstate = () => {
    const cancelled = beneficiaries.filter((b) => b.id && selectedItems.has(b.id) && b.status === "Sponsorship Cancelled")
    if (cancelled.length === 0) {
      toaster.create({ title: "No Selection", description: "Please select beneficiaries with 'Sponsorship Cancelled' status.", duration: 5000 })
      return
    }
    const ids = cancelled.map((b) => b.id!).filter((id): id is string => !!id)
    setPendingBulkAction({ kind: "reinstate", value: "New", label: `reinstate ${ids.length} beneficiaries to "New"`, ids })
  }

  const executeBulkAction = async () => {
    if (!pendingBulkAction) return
    const { kind, value, ids: overrideIds } = pendingBulkAction
    const ids = overrideIds ?? Array.from(selectedItems)
    try {
      if (kind === "status" || kind === "reinstate") {
        const res = await fetch("/api/admin/beneficiaries/bulk-update-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, status: value }),
        })
        if (!res.ok) throw new Error("Failed to update status")
        toaster.create({ title: "Success", description: kind === "reinstate" ? `${ids.length} reinstated to "New" successfully.` : `Moved to ${value.toLowerCase()} successfully.`, duration: 5000 })
      } else {
        const res = await fetch("/api/admin/beneficiaries/bulk-update-type", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids, beneficiary_type: value }),
        })
        if (!res.ok) throw new Error("Failed to update type")
        toaster.create({ title: "Success", description: `Updated type for ${ids.length} beneficiaries successfully.`, duration: 5000 })
      }
      setSelectedItems(new Set())
      setSelectedRowsForDeletion([])
      setPendingBulkAction(null)
      setFilterStatus(allStatuses)
      handleFilterChange({ gender: "", ageRange: [0, getMaxAgeYears(activeType)], status: allStatuses, search: "" })
    } catch (error) {
      console.error("Bulk action error:", error)
      toaster.create({ title: "Error", description: `Failed: ${error instanceof Error ? error.message : "Unknown error"}`, duration: 5000 })
    }
  }

  const isAllSelected = beneficiaries.length > 0 && selectedItems.size === beneficiaries.filter((b) => b.id).length
  const isSomeSelected = selectedItems.size > 0 && selectedItems.size < beneficiaries.filter((b) => b.id).length

  const getStatusBadgeColor = (status: string) =>
    STATUS_DISPLAY_CONFIG[status as keyof typeof STATUS_DISPLAY_CONFIG]?.color ?? "gray"

  return (
    <AdminPageLayout
      title="Beneficiaries"
      description="Manage beneficiaries"
      breadcrumb={[{ label: "Beneficiaries" }]}
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
            setIsCreateDrawerOpen(true)
            if (!formData.status) setFormData({ ...formData, status: "New" })
          }}
          className="border-[2px] border-[#E0E0E0] rounded-md w-full md:w-fit h-[40px] px-10 bg-[#2b7ff9] text-white"
        >
          <GoPlusCircle className="mr-2" />
          Add New
        </Button>
      }
      showResults={true}
      noResultsMessage="No beneficiaries found matching your search."
    >
      {/* Filters */}
      <Box mb={6}>
        <SponsorshipFilters
          onFilterChange={handleFilterChange}
          beneficiaryType={activeType === "ANIMAL" ? "ANIMAL" : "CHILD"}
          isAdminMode={true}
          activeType={activeType}
          onTypeChange={handleTypeChange}
        />
      </Box>

      {/* Status Badges */}
      <Flex gap={2} mb={6} flexWrap="wrap">
        <Button colorPalette="gray" size="sm" px={3} borderRadius="full" onClick={handleTotalBadgeClick} variant="subtle" style={{ cursor: "pointer", fontWeight: "normal", fontSize: "0.75rem" }}>
          Total: {stats.total}
        </Button>
        {Object.entries(stats.statusCounts).map(([status, count]) => (
          <Button
            key={status}
            colorPalette={getStatusBadgeColor(status)}
            size="sm"
            px={3}
            borderRadius="full"
            onClick={() => handleStatusBadgeClick(status)}
            variant="subtle"
            style={{ cursor: "pointer", fontWeight: "normal", fontSize: "0.75rem" }}
          >
            {status}: {count}
          </Button>
        ))}
      </Flex>

      {/* Scrollable Container with Grid Layout */}
      <Box ref={containerRef} width="100%" className="border bg-white rounded-2xl" style={{ minHeight: beneficiaries.length ? "auto" : "100px", maxHeight: "200vh", overflowY: "auto" }}>
        <Box p={8}>
          {beneficiaries.length === 0 && !isLoading ? (
            <Flex justify="center" py={12} align="center" direction="column">
              <Text fontSize="lg" color="gray.600" textAlign="center">No beneficiaries found</Text>
              <Text fontSize="sm" color="gray.500" textAlign="center" mt={2}>Try adjusting your search or filters to find more results</Text>
            </Flex>
          ) : (
            <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {beneficiaries.map((beneficiary) => (
                <BeneficiaryCard
                  key={beneficiary.id || beneficiary.username}
                  beneficiary={beneficiary}
                  isSelected={beneficiary.id ? selectedItems.has(beneficiary.id) : false}
                  onSelect={handleSelectItem}
                  onEdit={handleEditBeneficiary}
                  beneficiaryImages={beneficiaryImages}
                  loadingImages={loadingImages}
                />
              ))}
            </Box>
          )}
        </Box>
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
          setImageFiles={(value) => typeof value === "function" ? setImageFiles(value(imageFiles)) : setImageFiles(value)}
          videoFiles={videoFiles}
          setVideoFiles={(value) => typeof value === "function" ? setVideoFiles(value(videoFiles)) : setVideoFiles(value)}
        />
      )}

      {/* Delete Dialog */}
      <DeleteDialog isOpen={isDeleteDialogOpen} onClose={() => setIsDeleteDialogOpen(false)} onConfirm={confirmDelete} itemCount={selectedRowsForDeletion.length} />

      {/* Bulk Action Confirm Dialog */}
      <BulkConfirmDialog
        isOpen={pendingBulkAction !== null}
        onClose={() => setPendingBulkAction(null)}
        onConfirm={executeBulkAction}
        itemCount={pendingBulkAction?.ids?.length ?? selectedItems.size}
        actionLabel={pendingBulkAction?.label ?? ""}
      />

      {/* Create Modal */}
      <BeneficiaryModal
        mode="create"
        isOpen={isCreateDrawerOpen}
        onClose={() => setIsCreateDrawerOpen(false)}
        formData={formData}
        setFormData={(value) => {
          if (typeof value === "function") { setFormData(value(formData)) } else { setFormData(value) }
        }}
        handleInputChange={handleInputChange}
        handleSelectChange={handleSelectChange}
        handleLocationSelect={handleLocationSelect}
        handleSubmit={handleSubmit}
        imageFiles={imageFiles}
        setImageFiles={(value) => typeof value === "function" ? setImageFiles(value(imageFiles)) : setImageFiles(value)}
        videoFiles={videoFiles}
        setVideoFiles={(value) => typeof value === "function" ? setVideoFiles(value(videoFiles)) : setVideoFiles(value)}
      />

      {/* Floating Action Bar */}
      <FloatingActionBar
        selectedCount={selectedItems.size}
        visibleCount={beneficiaries.filter((b) => b.id).length}
        totalMatchingCount={stats.total}
        onSelectVisible={handleSelectVisible}
        onSelectAllMatching={handleSelectAllMatching}
        isSelectingAll={isSelectingAll}
        onDeselectAll={() => setSelectedItems(new Set())}
        onDelete={handleBulkDelete}
        onSetStatus={handleBulkStatusUpdate}
        onSetType={handleBulkTypeUpdate}
        onReinstate={handleReinstate}
        hasCancelledSelected={beneficiaries.some((b) => b.id && selectedItems.has(b.id) && b.status === "Sponsorship Cancelled")}
      />
    </AdminPageLayout>
  )
}

export default ChildrenTable

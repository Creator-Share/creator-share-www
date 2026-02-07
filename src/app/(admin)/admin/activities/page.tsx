"use client"
import React, { useEffect, useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Box, Flex, Text } from "@chakra-ui/react"
import { toaster } from "@/components/ui/toaster"
import { LogoLoader } from "@/components/common/LogoLoader"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import { ActivitySection } from "./components/ActivitySection"
import { CreateActivityModal } from "./components/ActivityModals"
import { BeneficiaryWithActivity, BeneficiaryMedia } from "@/types/admin.types"
import { categorizeBeneficiaries } from "./utils"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"

const ActivitiesAdminPage: React.FC = () => {
  const router = useRouter()
  const [beneficiaries, setBeneficiaries] = useState<BeneficiaryWithActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [beneficiaryImages, setBeneficiaryImages] = useState<Record<string, string>>({})
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({})
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<{
    id: string
    name: string
  } | null>(null)

  // Modal state
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [activityType, setActivityType] = useState("UPDATE")
  const [error, setError] = useState<string | null>(null)

  const fetchedImagesRef = useRef<Set<string>>(new Set())

  // Fetch beneficiaries on mount
  useEffect(() => {
    const fetchBeneficiaries = async () => {
      try {
        setLoading(true)
        const res = await fetch("/api/admin/beneficiaries/with-activity-status")
        const data = await res.json()
        setBeneficiaries(data.beneficiaries || [])
      } catch (error) {
        console.error("Failed to fetch beneficiaries:", error)
        toaster.create({
          title: "Error",
          description: "Failed to load beneficiaries",
          type: "error",
          duration: 5000,
        })
        setBeneficiaries([])
      } finally {
        setLoading(false)
      }
    }
    fetchBeneficiaries()
  }, [])

  // Image loading - reuse pattern from /admin/children/page.tsx
  const fetchImagesForVisibleBeneficiaries = useCallback(
    async (visibleBeneficiaries: BeneficiaryWithActivity[]) => {
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

  // Fetch images when beneficiaries change
  useEffect(() => {
    if (beneficiaries.length) {
      fetchImagesForVisibleBeneficiaries(beneficiaries)
    }
  }, [beneficiaries, fetchImagesForVisibleBeneficiaries])

  // Client-side search filtering
  const filteredBeneficiaries = beneficiaries.filter((b) => {
    if (!search) return true
    const searchLower = search.toLowerCase()
    return (
      b.name.toLowerCase().includes(searchLower) ||
      b.username.toLowerCase().includes(searchLower)
    )
  })

  // Categorize beneficiaries
  const categorized = categorizeBeneficiaries(filteredBeneficiaries)

  // Handle create activity
  const handleCreateActivity = (beneficiaryId: string, beneficiaryName: string) => {
    setSelectedBeneficiary({ id: beneficiaryId, name: beneficiaryName })
    setCreateModalOpen(true)
    setTitle("")
    setDescription("")
    setActivityType("UPDATE")
    setError(null)
  }

  // Handle activity created
  // Note: The modal now handles the API calls internally
  // This is just called to clean up and navigate
  const handleActivityCreated = async (formData: FormData) => {
    if (!selectedBeneficiary) return
    
    // Check if this was handled by the modal (new pattern)
    if (formData.has("_handled")) {
      // Modal handled everything, just navigate
      setCreateModalOpen(false)
      const beneficiaryIdToNavigate = selectedBeneficiary.id
      setSelectedBeneficiary(null)
      router.push(`/admin/beneficiary/${beneficiaryIdToNavigate}`)
      return
    }
    
    // Old pattern - should not reach here anymore
    console.warn("Received unhandled FormData - this should not happen")
  }

  const handleCloseModal = () => {
    setCreateModalOpen(false)
    setSelectedBeneficiary(null)
    setTitle("")
    setDescription("")
    setActivityType("UPDATE")
    setError(null)
  }

  return (
    <AdminPageLayout
      title="Activities"
      description="Manage activities for beneficiaries"
      breadcrumb={[{ label: "Activities" }]}
      searchPlaceholder="Search beneficiaries..."
      searchValue={search}
      onSearchChange={setSearch}
      showResults={true}
    >
      {loading ? (
        <LogoLoader size="lg" minHeight="60vh" />
      ) : beneficiaries.length === 0 ? (
        <Flex justify="center" py={12} align="center" direction="column">
          <Text fontSize="lg" color="gray.600" textAlign="center">
            No beneficiaries found
          </Text>
        </Flex>
      ) : (
        <Box>
          {/* Overdue Section */}
          <ActivitySection
            status="overdue"
            beneficiaries={categorized.overdue}
            onCreateActivity={handleCreateActivity}
            beneficiaryImages={beneficiaryImages}
            loadingImages={loadingImages}
          />

          {/* Due Soon Section */}
          <ActivitySection
            status="dueSoon"
            beneficiaries={categorized.dueSoon}
            onCreateActivity={handleCreateActivity}
            beneficiaryImages={beneficiaryImages}
            loadingImages={loadingImages}
          />

          {/* Up to Date Section (collapsed by default) */}
          <ActivitySection
            status="upToDate"
            beneficiaries={categorized.upToDate}
            onCreateActivity={handleCreateActivity}
            beneficiaryImages={beneficiaryImages}
            loadingImages={loadingImages}
            defaultCollapsed={true}
          />

          {/* No Activities Section */}
          <ActivitySection
            status="noActivities"
            beneficiaries={categorized.noActivities}
            onCreateActivity={handleCreateActivity}
            beneficiaryImages={beneficiaryImages}
            loadingImages={loadingImages}
          />
        </Box>
      )}

      {/* Create Activity Modal */}
      {selectedBeneficiary && (
        <CreateActivityModal
          open={createModalOpen}
          onClose={handleCloseModal}
          title={title}
          description={description}
          activityType={activityType}
          beneficiaryId={selectedBeneficiary.id}
          beneficiaryName={selectedBeneficiary.name}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
          onActivityTypeChange={setActivityType}
          onCreate={handleActivityCreated}
          onSuccess={() => {
            // This is called after successful creation but before navigation
            // We handle the navigation in handleActivityCreated
          }}
          creating={false}
          error={error}
        />
      )}
    </AdminPageLayout>
  )
}

export default ActivitiesAdminPage

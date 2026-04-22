"use client"

import React, { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import {
  Box,
  Text,
  Flex,
  Button,
  Input,
  Textarea,
  Progress,
} from "@chakra-ui/react"
import { NativeSelectRoot, NativeSelectField } from "@/components/ui/native-select"
import Image from "next/image"
import { toaster } from "@/components/ui/toaster"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"
import ActivitiesTable from "@/app/(admin)/admin/activities/components/ActivitiesTable"
import { Beneficiaries, Activity, BeneficiaryMedia } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"
import { isOpenSponsorshipType } from "@/config/beneficiaryTypes"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import ProofreadButton from "@/components/ai/ProofreadButton"
import { LogoLoader } from "@/components/common/LogoLoader"

const BeneficiaryDetailPage = () => {
  const params = useParams()
  const router = useRouter()
  const beneficiaryId = params.id as string

  // State management
  const [beneficiary, setBeneficiary] = useState<Beneficiaries | null>(null)
  const [activities, setActivities] = useState<Activity[]>([]) // eslint-disable-line @typescript-eslint/no-unused-vars
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [formData, setFormData] = useState<Beneficiaries | null>(null)
  const [originalData, setOriginalData] = useState<Beneficiaries | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null) // eslint-disable-line @typescript-eslint/no-unused-vars
  const [saving, setSaving] = useState(false)
  const [beneficiaryImage, setBeneficiaryImage] = useState<string | null>(null)

  // Fetch beneficiary data
  useEffect(() => {
    const fetchBeneficiary = async () => {
      try {
        const res = await fetch(`/api/admin/beneficiaries/retrieve`)
        if (!res.ok) throw new Error("Failed to fetch beneficiaries")

        const data = await res.json()
        const beneficiaryData = data.beneficiaries.find(
          (b: Beneficiaries) => b.id === beneficiaryId
        )

        if (!beneficiaryData) {
          toaster.create({
            title: "Error",
            description: "Beneficiary not found",
            type: "error",
            duration: 5000,
          })
          router.push("/admin/beneficiaries")
          return
        }

        setBeneficiary(beneficiaryData)
        setOriginalData(beneficiaryData)
      } catch (err) {
        console.error("Error fetching beneficiary:", err)
        toaster.create({
          title: "Error",
          description: "Failed to load beneficiary data",
          type: "error",
          duration: 5000,
        })
      } finally {
        setLoading(false)
      }
    }

    if (beneficiaryId) {
      fetchBeneficiary()
    }
  }, [beneficiaryId, router])

  // Fetch beneficiary image
  useEffect(() => {
    const fetchImage = async () => {
      try {
        const response = await fetch(
          `/api/admin/beneficiaries/images/${beneficiaryId}`
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
                setBeneficiaryImage(src)
              }
            }
          }
        }
      } catch (error) {
        console.error(`Failed to fetch image for beneficiary ${beneficiaryId}:`, error)
      }
    }

    if (beneficiaryId && beneficiary) {
      fetchImage()
    }
  }, [beneficiaryId, beneficiary])

  // Fetch activities
  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const res = await fetch(
          `/api/admin/activities/retrieve?beneficiary_id=${beneficiaryId}`
        )
        if (!res.ok) throw new Error("Failed to fetch activities")

        const data = await res.json()
        setActivities(data.activities || [])
      } catch (err) {
        console.error("Error fetching activities:", err)
        setActivities([])
      }
    }

    if (beneficiaryId) {
      fetchActivities()
    }
  }, [beneficiaryId])

  // Fetch user role on mount
  useEffect(() => {
    const fetchUserRole = async () => {
      try {
        const res = await fetch("/api/auth/user")
        if (!res.ok) return

        const { user } = await res.json()
        if (!user) return

        // Fetch role assignments
        const roleRes = await fetch(`/api/admin/users/roles?user_id=${user.id}`)
        if (!roleRes.ok) return

        const roleData = await roleRes.json()
        const hasSuperAdmin = roleData.roles?.some(
          (role: { name: string }) => role.name === "SUPER_ADMIN"
        )

        setUserRole(hasSuperAdmin ? "SUPER_ADMIN" : "EMPLOYEE")
      } catch (err) {
        console.error("Error fetching user role:", err)
      }
    }

    fetchUserRole()
  }, [])

  // Handle edit mode
  const handleEdit = () => {
    setOriginalData(beneficiary)
    setFormData(beneficiary)
    setEditMode(true)
  }

  // Handle cancel
  const handleCancel = () => {
    setBeneficiary(originalData)
    setFormData(null)
    setEditMode(false)
  }

  // Handle save
  const handleSave = async () => {
    if (!formData) return

    // Validate required fields
    if (!formData.name || !formData.biography) {
      toaster.create({
        title: "Validation Error",
        description: "Name and biography are required fields",
        type: "error",
        duration: 5000,
      })
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/beneficiaries/update/${beneficiaryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!res.ok) throw new Error("Failed to update beneficiary")

      const data = await res.json()
      setBeneficiary(data.beneficiary)
      setOriginalData(data.beneficiary)
      setEditMode(false)
      setFormData(null)

      toaster.create({
        title: "Success",
        description: "Beneficiary updated successfully",
        type: "success",
        duration: 5000,
      })
    } catch (err) {
      console.error("Error updating beneficiary:", err)
      toaster.create({
        title: "Error",
        description: "Failed to update beneficiary",
        type: "error",
        duration: 5000,
      })
    } finally {
      setSaving(false)
    }
  }

  // Handle form field changes
  const handleFieldChange = (field: keyof Beneficiaries, value: string) => {
    if (!formData) return
    setFormData({ ...formData, [field]: value })
  }

  if (loading) {
    return <LogoLoader size="lg" minHeight="100vh" />
  }

  if (!beneficiary) {
    return (
      <AdminPageLayout
        title="Not Found"
        breadcrumb={[
          { label: "Beneficiaries", href: "/admin/beneficiaries" },
          { label: "Not Found" },
        ]}
        hideSearchSection
      >
        <Box className="text-center py-12">
          <Text className="text-gray-500 text-lg">Beneficiary not found</Text>
        </Box>
      </AdminPageLayout>
    )
  }

  const isOpen = isOpenSponsorshipType(beneficiary.beneficiary_type)
  const fundingPercentage = !isOpen && beneficiary.budget_goal > 0
      ? Math.min(100, (beneficiary.budget_raised / beneficiary.budget_goal) * 100)
      : 0

  const displayData = editMode ? formData : beneficiary

  return (
    <AdminPageLayout
      title={beneficiary.name}
      description={`Viewing details for ${beneficiary.name}`}
      breadcrumb={[
        { label: "Beneficiaries", href: "/admin/beneficiaries" },
        { label: beneficiary.name },
      ]}
      hideSearchSection
    >
      {/* Profile Section */}
      <Box className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <Flex justify="space-between" align="center" mb={6}>
          <Text fontSize="xl" fontWeight="bold" color="gray.900">
            Profile Information
          </Text>
          {!editMode ? (
            <Button
              colorScheme="blue"
              onClick={handleEdit}
              className="border-[2px] border-[#E0E0E0] rounded-md h-[40px] px-6 bg-[#2b7ff9] text-white hover:bg-[#2b7ff9]"
            >
              Edit Profile
            </Button>
          ) : (
            <Flex gap={3}>
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={saving}
                className="border-[2px] border-gray-300 rounded-md h-[40px] px-6"
              >
                Cancel
              </Button>
              <Button
                colorScheme="blue"
                onClick={handleSave}
                disabled={saving}
                className="border-[2px] border-[#E0E0E0] rounded-md h-[40px] px-6 bg-[#2b7ff9] text-white hover:bg-[#2b7ff9]"
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </Flex>
          )}
        </Flex>

        {/* Top Section: Photo + Compact Fields */}
        <Box className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          {/* Profile Photo - Left Column */}
          <Box className="md:col-span-1">
            <Box
              className="relative w-full aspect-square rounded-lg overflow-hidden border border-gray-200"
              bg="gray.100"
            >
              {beneficiaryImage ? (
                <Image
                  src={beneficiaryImage}
                  alt={displayData?.name || "Beneficiary"}
                  fill
                  className="object-cover"
                />
              ) : (
                <Flex
                  justify="center"
                  align="center"
                  className="w-full h-full bg-gray-200"
                >
                  <Text color="gray.500">No photo</Text>
                </Flex>
              )}
            </Box>
          </Box>

          {/* Compact Fields - Right 3 Columns in 2x3 Grid */}
          <Box className="md:col-span-3">
            <Box className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Name */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={2} color="gray.700">
                  Name *
                </Text>
                {editMode ? (
                  <Input
                    value={formData?.name || ""}
                    onChange={(e) => handleFieldChange("name", e.target.value)}
                    className="border border-gray-300"
                  />
                ) : (
                  <Text fontSize="md">{beneficiary.name}</Text>
                )}
              </Box>

              {/* Username */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={2} color="gray.700">
                  Username
                </Text>
                {editMode ? (
                  <Input
                    value={formData?.username || ""}
                    onChange={(e) => handleFieldChange("username", e.target.value)}
                    className="border border-gray-300"
                  />
                ) : (
                  <Text fontSize="md">@{beneficiary.username}</Text>
                )}
              </Box>

              {/* Gender */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={2} color="gray.700">
                  Gender
                </Text>
                {editMode ? (
                  <NativeSelectRoot>
                    <NativeSelectField
                      value={formData?.gender || ""}
                      onChange={(e) => handleFieldChange("gender", e.target.value as "Boy" | "Girl")}
                    >
                      <option value="">Select gender...</option>
                      <option value="Boy">Boy</option>
                      <option value="Girl">Girl</option>
                    </NativeSelectField>
                  </NativeSelectRoot>
                ) : (
                  <Text fontSize="md">{beneficiary.gender || "N/A"}</Text>
                )}
              </Box>

              {/* Birth Date */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={2} color="gray.700">
                  Birth Date
                </Text>
                {editMode ? (
                  <Input
                    type="date"
                    value={formData?.birth_date || ""}
                    onChange={(e) => handleFieldChange("birth_date", e.target.value)}
                    className="border border-gray-300"
                  />
                ) : (
                  <Text fontSize="md">
                    {beneficiary.birth_date
                      ? new Date(beneficiary.birth_date).toLocaleDateString()
                      : "N/A"}
                  </Text>
                )}
              </Box>

              {/* Country */}
              <Box>
                <Text fontSize="sm" fontWeight="semibold" mb={2} color="gray.700">
                  Country
                </Text>
                {editMode ? (
                  <Input
                    value={formData?.country || ""}
                    onChange={(e) => handleFieldChange("country", e.target.value)}
                    className="border border-gray-300"
                  />
                ) : (
                  <Text fontSize="md">{beneficiary.country}</Text>
                )}
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Biography - Full Width */}
        <Box className="mb-6">
          <Flex justify="space-between" align="center" mb={2}>
            <Text fontSize="sm" fontWeight="semibold" color="gray.700">
              Biography *
            </Text>
            {editMode && formData && (
              <ProofreadButton
                text={formData.biography || ""}
                onAccept={(proofreadText) => handleFieldChange("biography", proofreadText)}
                fieldLabel="Biography"
                type="biography"
                size="sm"
              />
            )}
          </Flex>
          {editMode ? (
            <Textarea
              value={formData?.biography || ""}
              onChange={(e) => handleFieldChange("biography", e.target.value)}
              className="border border-gray-300"
              rows={8}
              minH="200px"
            />
          ) : (
            <Text fontSize="md" whiteSpace="pre-wrap">{beneficiary.biography}</Text>
          )}
        </Box>

        {/* Funding Progress - Full Width */}
        {!isOpen && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" mb={2} color="gray.700">
              Funding Progress
            </Text>
            <Flex justify="space-between" mb={2}>
              <Text fontSize="sm" color="gray.600">
                ${centsToDollars(beneficiary.budget_raised)} raised
              </Text>
              <Text fontSize="sm" color="gray.600">
                ${centsToDollars(beneficiary.budget_goal)} goal
              </Text>
            </Flex>
            <Progress.Root value={fundingPercentage}>
              <Progress.Track className="rounded-xl h-3">
                <Progress.Range className="bg-[#2b7ff9]" />
              </Progress.Track>
            </Progress.Root>
            <Text fontSize="xs" color="gray.500" mt={1}>
              {fundingPercentage.toFixed(1)}% funded
            </Text>
          </Box>
        )}
        {isOpen && (
          <Box>
            <Text fontSize="sm" fontWeight="semibold" mb={2} color="gray.700">
              Sponsorship Info
            </Text>
            <Text fontSize="sm" color="gray.600">
              Open sponsorship — ${centsToDollars(beneficiary.budget_raised)} raised
            </Text>
          </Box>
        )}
      </Box>

      {/* Activities Section */}
      <Box className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <ActivitiesTable
          beneficiaryType={beneficiary.beneficiary_type}
          beneficiaryId={beneficiaryId}
        />
      </Box>

      {/* 
        ========================================
        FUTURE IMPLEMENTATION: EXPENSES SECTION
        ========================================
        
        This section will display and manage expenses assigned to this beneficiary.
        
        UI/UX Design:
        - Section title: "Expenses" with "Add Expense" button
        - Table with columns: Name, Description, Price, Weight, Fulfilled, One-time
        - Each row has edit/delete actions
        - "Add Expense" opens modal to assign existing expenses or create new ones
        - Toggle fulfilled status with checkbox
        - Show total expenses vs budget raised
        
        Implementation Notes:
        - Create ExpensesTable component similar to ActivitiesTable
        - Fetch data from /api/admin/expenses/assignments?beneficiary_id={id}
        - Use ExpenseAssignment type from admin.types.ts
        - Handle weight calculations (percentage of total budget)
        - Show visual indicator when total weight > 100%
        - Add expense assignment modal with:
          * Search existing expenses
          * Create new expense inline
          * Set weight (percentage or dollar amount)
          * Mark as one-time or recurring
        
        API Endpoints Needed:
        - GET /api/admin/expenses/assignments?beneficiary_id={id}
        - POST /api/admin/expenses/assignments (assign expense to beneficiary)
        - PUT /api/admin/expenses/assignments/{id} (update assignment)
        - DELETE /api/admin/expenses/assignments/{id} (remove assignment)
        
        Example Code Structure:
        ```tsx
        <Box className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <Flex justify="space-between" align="center" mb={4}>
            <Text fontSize="xl" fontWeight="bold" color="gray.900">
              Expenses
            </Text>
            <Button colorScheme="blue" onClick={() => setExpenseModalOpen(true)}>
              Add Expense
            </Button>
          </Flex>
          
          <ExpensesTable 
            beneficiaryId={beneficiaryId}
            onUpdate={refetchExpenses}
          />
          
          <Box mt={4} p={4} bg="gray.50" rounded="md">
            <Flex justify="space-between">
              <Text fontWeight="semibold">Total Budget:</Text>
              <Text>${centsToDollars(beneficiary.budget_goal)}</Text>
            </Flex>
            <Flex justify="space-between">
              <Text fontWeight="semibold">Total Expenses:</Text>
              <Text color={totalExpenses > beneficiary.budget_goal ? "red.500" : "green.500"}>
                ${centsToDollars(totalExpenses)}
              </Text>
            </Flex>
          </Box>
        </Box>
        ```
      */}

      {/* 
        ========================================
        FUTURE IMPLEMENTATION: SPONSORS SECTION
        ========================================
        
        This section will display active sponsors for this beneficiary.
        
        UI/UX Design:
        - Section title: "Active Sponsors" with sponsor count badge
        - Card grid showing sponsor information:
          * Sponsor name (or "Anonymous")
          * Email (redacted: j***@example.com)
          * Subscription amount and interval
          * Start date
          * Status badge (active/canceled/past_due)
          * Email notification preference
        - Filter by status (active/all)
        - "Send Message" button to message all sponsors
        
        Implementation Notes:
        - Fetch from /api/admin/sponsors?beneficiary_id={id}
        - Use RawSubscription type or create SponsorInfo type
        - Respect privacy: don't show full email addresses
        - Show subscription health (payment issues, cancellation scheduled)
        - Link to send targeted messages to sponsors
        - Show total monthly recurring revenue from this beneficiary
        
        API Endpoints Needed:
        - GET /api/admin/sponsors?beneficiary_id={id}
        - GET /api/admin/sponsors/{subscription_id} (detailed view)
        
        Example Code Structure:
        ```tsx
        <Box className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <Flex justify="space-between" align="center" mb={4}>
            <Flex align="center" gap={3}>
              <Text fontSize="xl" fontWeight="bold" color="gray.900">
                Active Sponsors
              </Text>
              <Box className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-medium">
                {sponsors.length}
              </Box>
            </Flex>
            <Button 
              variant="outline" 
              onClick={() => router.push(`/admin/messaging?beneficiary_id=${beneficiaryId}`)}
            >
              Message All Sponsors
            </Button>
          </Flex>
          
          <Box className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sponsors.map((sponsor) => (
              <Box 
                key={sponsor.id} 
                className="border border-gray-200 rounded-lg p-4 bg-white hover:shadow-md transition-shadow"
              >
                <Flex justify="space-between" align="start" mb={2}>
                  <Text fontWeight="semibold">{sponsor.name || "Anonymous"}</Text>
                  <Box 
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      sponsor.status === "active" 
                        ? "bg-green-100 text-green-800" 
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {sponsor.status}
                  </Box>
                </Flex>
                
                <Text fontSize="sm" color="gray.600" mb={1}>
                  {sponsor.emailRedacted}
                </Text>
                
                <Text fontSize="lg" fontWeight="bold" color="blue.600" mb={1}>
                  ${centsToDollars(sponsor.amount)}/{sponsor.interval}
                </Text>
                
                <Text fontSize="xs" color="gray.500">
                  Since {new Date(sponsor.created_at).toLocaleDateString()}
                </Text>
                
                {!sponsor.emailNotification && (
                  <Text fontSize="xs" color="orange.500" fontStyle="italic" mt={2}>
                    Email notifications disabled
                  </Text>
                )}
              </Box>
            ))}
          </Box>
          
          <Box mt={4} p={4} bg="blue.50" rounded="md">
            <Flex justify="space-between">
              <Text fontWeight="semibold">Monthly Recurring Revenue:</Text>
              <Text fontWeight="bold" color="blue.600">
                ${calculateMRR(sponsors)}
              </Text>
            </Flex>
          </Box>
        </Box>
        ```
      */}

      {/* 
        ========================================
        FUTURE IMPLEMENTATION: MEDIA GALLERY
        ========================================
        
        This section will display all media (photos/videos) for this beneficiary.
        
        UI/UX Design:
        - Section title: "Media Gallery" with "Upload Media" button
        - Tabs: All, Photos, Videos
        - Grid layout with thumbnails
        - Click to view full size in lightbox
        - Drag-and-drop reordering for profile gallery
        - Set primary photo option
        - Delete with confirmation
        - Filter by source: Profile, Activities, User Uploads
        
        Implementation Notes:
        - Fetch from /api/admin/beneficiaries/{id}/media
        - Combine profile image, activity media, and beneficiary_media table
        - Use BeneficiaryMedia type from admin.types.ts
        - Implement image lightbox component (react-image-lightbox or similar)
        - Support drag-and-drop reordering with react-beautiful-dnd
        - Handle image uploads with compression
        - Link media to source (activity_id if from activity)
        
        API Endpoints Needed:
        - GET /api/admin/beneficiaries/{id}/media
        - POST /api/admin/beneficiaries/{id}/media (upload new media)
        - PUT /api/admin/beneficiaries/{id}/media/{media_id} (update order/primary)
        - DELETE /api/admin/beneficiaries/{id}/media/{media_id}
        
        Example Code Structure:
        ```tsx
        <Box className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <Flex justify="space-between" align="center" mb={4}>
            <Text fontSize="xl" fontWeight="bold" color="gray.900">
              Media Gallery
            </Text>
            <Button colorScheme="blue" onClick={() => setUploadModalOpen(true)}>
              Upload Media
            </Button>
          </Flex>
          
          <Tabs variant="enclosed" mb={4}>
            <TabList>
              <Tab>All ({allMedia.length})</Tab>
              <Tab>Photos ({photos.length})</Tab>
              <Tab>Videos ({videos.length})</Tab>
            </TabList>
            
            <TabPanels>
              <TabPanel>
                <Box className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {allMedia.map((media, index) => (
                    <Box 
                      key={media.id}
                      className="relative group aspect-square rounded-lg overflow-hidden border border-gray-200 cursor-pointer hover:shadow-lg transition-shadow"
                      onClick={() => openLightbox(index)}
                    >
                      {media.type === 'IMAGE' ? (
                        <Image 
                          src={media.image_url} 
                          alt="" 
                          fill 
                          className="object-cover" 
                        />
                      ) : (
                        <video 
                          src={media.image_url} 
                          className="w-full h-full object-cover"
                        />
                      )}
                      
                      <Box className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                        <Button 
                          size="sm" 
                          colorScheme="red" 
                          className="opacity-0 group-hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteMedia(media.id)
                          }}
                        >
                          Delete
                        </Button>
                      </Box>
                      
                      {media.order_index === 0 && (
                        <Box 
                          className="absolute top-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded"
                        >
                          Primary
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </TabPanel>
              // ... Similar for Photos and Videos tabs
            </TabPanels>
          </Tabs>
        </Box>
        ```
      */}
    </AdminPageLayout>
  )
}

export default BeneficiaryDetailPage

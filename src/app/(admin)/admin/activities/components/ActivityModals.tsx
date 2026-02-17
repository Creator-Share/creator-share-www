import React, { useEffect, useState } from "react"
import { Button, Input, Textarea, createListCollection, Box, Flex, Text, Spinner } from "@chakra-ui/react"
import Image from "next/image"
import { Activity } from "@/types/admin.types"
import ProofreadButton from "@/components/ai/ProofreadButton"
import {
  FileUploadRoot,
  FileUploadTrigger,
  FileUploadList,
} from "@/components/ui/file-upload"
import {
  SelectRoot,
  SelectTrigger,
  SelectValueText,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { HiUpload } from "react-icons/hi"
import { createClient } from "@/utils/supabase/client"
import { compressImage } from "@/utils/imageCompression"
import { toaster } from "@/components/ui/toaster"

const activityTypeCollection = createListCollection({
  items: [
    { value: "INFO", label: "INFO" },
    { value: "UPDATE", label: "UPDATE" },
    { value: "SUBSCRIPTION", label: "SUBSCRIPTION" },
  ],
})

interface SponsorInfo {
  subscriptionId: string
  userId: string | null
  emailRedacted: string
  name: string | null
  amount: number | null
  interval: string | null
  emailNotification: boolean | null
}

interface CreateModalProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  activityType: string
  beneficiaryId: string
  beneficiaryName: string
  onTitleChange: (v: string) => void
  onDescriptionChange: (v: string) => void
  onActivityTypeChange: (v: string) => void
  /**
   * Called after the activity (and any media / notifications) have been
   * successfully created. Use this to close the modal, refresh data, or
   * navigate. No FormData is passed – the modal owns the API workflow.
   */
  onComplete?: () => void
}

export const CreateActivityModal: React.FC<CreateModalProps> = ({
  open,
  onClose,
  title,
  description,
  activityType,
  beneficiaryId,
  beneficiaryName,
  onTitleChange,
  onDescriptionChange,
  onActivityTypeChange,
  onComplete,
}) => {
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [videoPreviews, setVideoPreviews] = useState<string[]>([])
  
  // Sponsor and messaging features
  const [isPublic, setIsPublic] = useState(false)
  const [sendToSponsors, setSendToSponsors] = useState(true)
  const [sponsors, setSponsors] = useState<SponsorInfo[]>([])
  const [selectedSponsorIds, setSelectedSponsorIds] = useState<Set<string>>(new Set())
  const [loadingSponsors, setLoadingSponsors] = useState(false)
  const [compressing, setCompressing] = useState(false)
  
  const supabase = createClient()

  useEffect(() => {
    if (!open) {
      setImageFiles([])
      setVideoFiles([])
      setImagePreviews([])
      setVideoPreviews([])
      setIsPublic(false)
      setSendToSponsors(true)
      setSponsors([])
      setSelectedSponsorIds(new Set())
      return
    }
  }, [open])
  
  // Fetch sponsors when beneficiary is selected and sendToSponsors is enabled
  useEffect(() => {
    const fetchSponsors = async () => {
      if (!open || !beneficiaryId || !sendToSponsors) {
        setSponsors([])
        return
      }

      setLoadingSponsors(true)
      try {
        const res = await fetch(
          `/api/admin/messaging/sponsors?beneficiary_id=${beneficiaryId}`,
        )
        const data = await res.json()
        setSponsors(data.sponsors || [])
        // Auto-select all sponsors by default
        setSelectedSponsorIds(new Set((data.sponsors || []).map((s: SponsorInfo) => s.subscriptionId)))
      } catch (error) {
        console.error("Failed to fetch sponsors:", error)
        setSponsors([])
      } finally {
        setLoadingSponsors(false)
      }
    }

    fetchSponsors()
  }, [open, beneficiaryId, sendToSponsors, supabase])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  useEffect(() => {
    const urls = imageFiles.map((file) => URL.createObjectURL(file))
    setImagePreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [imageFiles])

  useEffect(() => {
    const urls = videoFiles.map((file) => URL.createObjectURL(file))
    setVideoPreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [videoFiles])

  const handleRemoveImage = (index: number) => {
    // Revoke the object URL for the removed image
    if (imagePreviews[index]) {
      URL.revokeObjectURL(imagePreviews[index])
    }
    // Remove from both arrays
    const newFiles = imageFiles.filter((_, i) => i !== index)
    const newPreviews = imagePreviews.filter((_, i) => i !== index)
    setImageFiles(newFiles)
    setImagePreviews(newPreviews)
  }

  const handleRemoveVideo = (index: number) => {
    // Revoke the object URL for the removed video
    if (videoPreviews[index]) {
      URL.revokeObjectURL(videoPreviews[index])
    }
    // Remove from both arrays
    const newFiles = videoFiles.filter((_, i) => i !== index)
    const newPreviews = videoPreviews.filter((_, i) => i !== index)
    setVideoFiles(newFiles)
    setVideoPreviews(newPreviews)
  }

  const handleToggleSponsor = (subscriptionId: string) => {
    const newSet = new Set(selectedSponsorIds)
    if (newSet.has(subscriptionId)) {
      newSet.delete(subscriptionId)
    } else {
      newSet.add(subscriptionId)
    }
    setSelectedSponsorIds(newSet)
  }

  const handleSelectAllSponsors = () => {
    if (selectedSponsorIds.size === sponsors.length) {
      setSelectedSponsorIds(new Set())
    } else {
      setSelectedSponsorIds(new Set(sponsors.map((s) => s.subscriptionId)))
    }
  }

  const handleCreate = async () => {
    setCompressing(true)
    
    try {
      // Step 1: Create activity with JSON only (no files)
      // Build JSON payload
      const activityData = {
        title,
        description,
        activity_type: activityType,
        activity_source: "admin",
        beneficiary_id: beneficiaryId,
        is_public: isPublic,
        selected_sponsor_ids: sendToSponsors ? Array.from(selectedSponsorIds) : [],
      }

      // Make the actual API calls here instead of passing work to the parent
      const createResponse = await fetch("/api/admin/activities/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(activityData),
      })
      
      if (!createResponse.ok) {
        const errorData = await createResponse.json()
        throw new Error(errorData.error || "Failed to create activity")
      }
      
      const { activityId } = await createResponse.json()
      
      // Step 2: Upload media (images and/or videos) via server-side endpoint
      // This routes all storage writes through /api/admin/activities/media/create,
      // which applies server-side validation and SuperAdmin auth.
      if (imageFiles.length > 0 || videoFiles.length > 0) {
        try {
          const formDataMedia = new FormData()
          formDataMedia.append("activityId", activityId)

          // Compress and append images (following beneficiary pattern)
          if (imageFiles.length > 0) {
            const { compressImages } = await import("@/utils/imageCompression")
            const compressedFiles = await compressImages(imageFiles, {
              maxSizeMB: 3.5,
            })

            compressedFiles.forEach((file) =>
              formDataMedia.append("images", file),
            )
          }

          // Append videos directly; size/type validation is enforced server-side
          if (videoFiles.length > 0) {
            videoFiles.forEach((file) => formDataMedia.append("videos", file))
          }

          const uploadMediaRes = await fetch(
            "/api/admin/activities/media/create",
            {
              method: "POST",
              body: formDataMedia,
            },
          )

          if (!uploadMediaRes.ok) {
            console.error(
              "Failed to upload media:",
              await uploadMediaRes.text(),
            )
            toaster.create({
              title: "Warning",
              description:
                "Activity created but media upload failed. Please try again from the activity editor.",
              type: "warning",
              duration: 5000,
            })
          }
        } catch (error) {
          console.error("Media upload error:", error)
          toaster.create({
            title: "Warning",
            description:
              "Activity created but media upload failed. Please try again from the activity editor.",
            type: "warning",
            duration: 5000,
          })
        }
      }
      
      // Step 3: Send email notifications AFTER media is uploaded
      // This ensures emails include the uploaded images/videos
      if (sendToSponsors && selectedSponsorIds.size > 0) {
        try {
          await fetch('/api/admin/activities/notify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              activityId,
              beneficiaryId,
              selectedSponsorIds: Array.from(selectedSponsorIds),
            }),
          })
          // Don't fail if notifications fail - activity was still created
        } catch (error) {
          console.error('Failed to send email notifications:', error)
        }
      }
      
      // Success!
      toaster.create({
        title: "Success",
        description: "Activity created successfully",
        type: "success",
        duration: 5000,
      })

      // Let the parent know we're done so it can close the modal,
      // refresh data, or navigate as needed.
      onComplete?.()
    } catch (error) {
      console.error("Error creating activity:", error)
      toaster.create({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create activity",
        type: "error",
        duration: 5000,
      })
    } finally {
      setCompressing(false)
    }
  }

  return open ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          width: "min(1200px, 90vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}
        >
          Create Activity for {beneficiaryName}
        </div>

                {/* Public/Private Toggle */}
                <div style={{ marginBottom: 12, padding: 12, background: "#f3f4f6", borderRadius: 8 }}>
          <Flex align="center" gap={3}>
            <Checkbox
              checked={isPublic}
              onCheckedChange={(checked) => setIsPublic(!!checked)}
            />
            <Box flex={1}>
              <Text fontWeight="semibold" fontSize="sm">Make this activity public</Text>
              <Text fontSize="xs" color="gray.600">
                Public activities appear on the beneficiary's profile page
              </Text>
            </Box>
            <Box
              px={2}
              py={1}
              borderRadius={4}
              fontWeight="semibold"
              fontSize="xs"
              bg={isPublic ? "green.100" : "gray.200"}
              color={isPublic ? "green.800" : "gray.600"}
            >
              {isPublic ? "PUBLIC" : "PRIVATE"}
            </Box>
          </Flex>
        </div>

        {/* Send to Sponsors Toggle */}
        <div style={{ marginBottom: 12, padding: 12, background: "#eff6ff", borderRadius: 8 }}>
          <Flex align="center" gap={3}>
            <Checkbox
              checked={sendToSponsors}
              onCheckedChange={(checked) => setSendToSponsors(!!checked)}
            />
            <Box flex={1}>
              <Text fontWeight="semibold" fontSize="sm">Send email notifications to sponsors</Text>
              <Text fontSize="xs" color="gray.600">
                Email this update to selected sponsors
              </Text>
            </Box>
          </Flex>
          
          {/* Sponsor Selection */}
          {sendToSponsors && (
            <Box mt={3} p={3} bg="white" borderRadius={6} border="1px solid #e5e7eb">
              <Flex justify="space-between" align="center" mb={2}>
                <Text fontSize="sm" fontWeight="medium">
                  Sponsors ({sponsors.length})
                </Text>
                {sponsors.length > 0 && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={handleSelectAllSponsors}
                    colorScheme="blue"
                  >
                    {selectedSponsorIds.size === sponsors.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                )}
              </Flex>
              
              {loadingSponsors ? (
                <Flex justify="center" py={4}>
                  <Spinner size="sm" />
                </Flex>
              ) : sponsors.length === 0 ? (
                <Text fontSize="sm" color="gray.500">
                  No sponsors found for this beneficiary
                </Text>
              ) : (
                <Box maxH="200px" overflowY="auto" className="space-y-2">
                  {sponsors.map((sponsor) => (
                    <Flex
                      key={sponsor.subscriptionId}
                      align="center"
                      gap={2}
                      p={2}
                      borderRadius={4}
                      _hover={{ bg: "gray.50" }}
                    >
                      <Checkbox
                        checked={selectedSponsorIds.has(sponsor.subscriptionId)}
                        onCheckedChange={() => handleToggleSponsor(sponsor.subscriptionId)}
                      />
                      <Box flex={1}>
                        <Text fontSize="sm" fontWeight="medium">
                          {sponsor.name || "Unknown"}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                          {sponsor.emailRedacted}
                        </Text>
                      </Box>
                      {sponsor.emailNotification === false && (
                        <Text fontSize="xs" color="gray.400" fontStyle="italic">
                          (Notifications disabled)
                        </Text>
                      )}
                    </Flex>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </div>
        <SelectRoot
          collection={activityTypeCollection}
          className="border border-stone-600"
          style={{ marginBottom: 12 }}
          value={[activityType]}
          onValueChange={(details) => onActivityTypeChange(details.value[0])}
        >
          <SelectTrigger className="w-full">
            <SelectValueText placeholder="Select Activity Type" />
          </SelectTrigger>
          <SelectContent>
            {activityTypeCollection.items.map((option) => (
              <SelectItem key={option.value} item={option}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <div style={{ marginBottom: 12 }}>
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={title}
              onAccept={onTitleChange}
              fieldLabel="Title"
              size="sm"
              type="activity"
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Textarea
            placeholder="Description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={description}
              onAccept={onDescriptionChange}
              fieldLabel="Description"
              size="sm"
              type="activity"
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload Images</label>
          <FileUploadRoot
            onFileChange={(fileDetails) => {
              const newFiles = fileDetails.acceptedFiles
              
              // Revoke all old URLs
              imagePreviews.forEach(url => URL.revokeObjectURL(url))
              
              // Create fresh URLs for all files
              const newUrls = newFiles.map(file => URL.createObjectURL(file))
              
              setImageFiles(newFiles)
              setImagePreviews(newUrls)
            }}
            accept={["image/*"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}>
                <HiUpload /> Upload Images
              </Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={imageFiles} />
          </FileUploadRoot>
          {imagePreviews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {imagePreviews.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 150,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#f9fafb",
                      position: "relative",
                    }}
                  >
                    <Image
                      src={src}
                      alt={`Preview ${index + 1}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveImage(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    type="button"
                    aria-label="Remove image"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload Videos</label>
          <FileUploadRoot
            onFileChange={(fileDetails) => {
              const newFiles = fileDetails.acceptedFiles
              
              // Revoke all old URLs
              videoPreviews.forEach(url => URL.revokeObjectURL(url))
              
              // Create fresh URLs for all files
              const newUrls = newFiles.map(file => URL.createObjectURL(file))
              
              setVideoFiles(newFiles)
              setVideoPreviews(newUrls)
            }}
            accept={["video/*"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}>
                <HiUpload /> Upload Videos
              </Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={videoFiles} />
          </FileUploadRoot>
          {videoPreviews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {videoPreviews.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 240,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#000",
                    }}
                  >
                    <video
                      src={src}
                      controls
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <button
                    onClick={() => handleRemoveVideo(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                    type="button"
                    aria-label="Remove video"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={compressing}
          >
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={handleCreate}
            disabled={!title || !description || compressing}
          >
            {compressing ? "Compressing..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  ) : null
}

interface EditModalProps {
  open: boolean
  onClose: () => void
  activity: Activity | null
  onSave: (formData: FormData) => void
  saving: boolean
  error: string | null
}

export const EditActivityModal: React.FC<EditModalProps> = ({
  open,
  onClose,
  activity,
  onSave,
  saving,
  error,
}) => {
  // State variables
  const [title, setTitle] = useState(activity?.title || "")
  const [description, setDescription] = useState(activity?.description || "")
  const [activityType, setActivityType] = useState<"INFO" | "UPDATE" | "SUBSCRIPTION">(activity?.activity_type || "UPDATE")
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [videoPreviews, setVideoPreviews] = useState<string[]>([])
  const [existingImages, setExistingImages] = useState<string[]>(activity?.images_url || [])
  const [existingVideos, setExistingVideos] = useState<string[]>(activity?.videos_url || [])
  const [isPublic, setIsPublic] = useState(activity?.is_public || false)
  const [compressing, setCompressing] = useState(false)

  // Sync with activity prop changes
  useEffect(() => {
    if (activity) {
      setTitle(activity.title || "")
      setDescription(activity.description || "")
      setActivityType(activity.activity_type || "UPDATE")
      setExistingImages(activity.images_url || [])
      setExistingVideos(activity.videos_url || [])
      setIsPublic(activity.is_public || false)
    }
  }, [activity])

  // Clear file uploads when modal closes
  useEffect(() => {
    if (!open) {
      setImageFiles([])
      setVideoFiles([])
      setImagePreviews([])
      setVideoPreviews([])
    }
  }, [open])

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  // Create previews for new images
  useEffect(() => {
    const urls = imageFiles.map((file) => URL.createObjectURL(file))
    setImagePreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [imageFiles])

  // Create previews for new videos
  useEffect(() => {
    const urls = videoFiles.map((file) => URL.createObjectURL(file))
    setVideoPreviews(urls)

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [videoFiles])

  const handleRemoveImage = (index: number) => {
    // Revoke the object URL for the removed image
    if (imagePreviews[index]) {
      URL.revokeObjectURL(imagePreviews[index])
    }
    // Remove from both arrays
    const newFiles = imageFiles.filter((_, i) => i !== index)
    const newPreviews = imagePreviews.filter((_, i) => i !== index)
    setImageFiles(newFiles)
    setImagePreviews(newPreviews)
  }

  const handleRemoveVideo = (index: number) => {
    // Revoke the object URL for the removed video
    if (videoPreviews[index]) {
      URL.revokeObjectURL(videoPreviews[index])
    }
    // Remove from both arrays
    const newFiles = videoFiles.filter((_, i) => i !== index)
    const newPreviews = videoPreviews.filter((_, i) => i !== index)
    setVideoFiles(newFiles)
    setVideoPreviews(newPreviews)
  }

  const handleRemoveExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index))
  }

  const handleRemoveExistingVideo = (index: number) => {
    setExistingVideos((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (!activity) return
    
    setCompressing(true)
    
    try {
      // Compress images before uploading
      const compressedImages: File[] = []
      const largeFiles: string[] = []
      
      for (const file of imageFiles) {
        try {
          const compressed = await compressImage(file, {
            maxSizeMB: 3.5, // Target 3.5MB to leave buffer under Vercel's 4.5MB limit
          })
          
          if (compressed.size < file.size) {
            const sizeReduction = ((1 - compressed.size / file.size) * 100).toFixed(0)
            largeFiles.push(`${file.name} (${sizeReduction}% smaller)`)
          }
          
          compressedImages.push(compressed)
        } catch (error) {
          console.error(`Failed to compress ${file.name}:`, error)
          // If compression fails, use original file (API will validate size)
          compressedImages.push(file)
        }
      }
      
      if (largeFiles.length > 0) {
        toaster.create({
          title: "Large Files Compressed",
          description: `These files were automatically compressed: ${largeFiles.join(', ')}`,
          type: "info",
          duration: 5000,
        })
      }
      
      const formData = new FormData()
      formData.append("id", activity.id)
      formData.append("title", title)
      formData.append("description", description)
      formData.append("activity_type", activityType)
      formData.append("is_public", String(isPublic))
      formData.append("beneficiary_id", activity.beneficiary_id)
      
      // Append existing media that wasn't removed
      formData.append("existing_images", JSON.stringify(existingImages))
      formData.append("existing_videos", JSON.stringify(existingVideos))
      
      // Append new media files (use compressed images)
      compressedImages.forEach((file) => formData.append("images", file))
      videoFiles.forEach((file) => formData.append("videos", file))
      
      onSave(formData)
    } catch (error) {
      console.error("Error preparing activity:", error)
      toaster.create({
        title: "Error",
        description: "Failed to prepare files for upload",
        type: "error",
        duration: 5000,
      })
    } finally {
      setCompressing(false)
    }
  }

  return open ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          width: "min(1200px, 90vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}
        >
          Edit Activity
        </div>

        {/* Public/Private Toggle */}
        <div style={{ marginBottom: 12, padding: 12, background: "#f3f4f6", borderRadius: 8 }}>
          <Flex align="center" gap={3}>
            <Checkbox
              checked={isPublic}
              onCheckedChange={(checked) => setIsPublic(!!checked)}
            />
            <Box flex={1}>
              <Text fontWeight="semibold" fontSize="sm">Make this activity public</Text>
              <Text fontSize="xs" color="gray.600">
                Public activities appear on the beneficiary's profile page
              </Text>
            </Box>
            <Box
              px={2}
              py={1}
              borderRadius={4}
              fontWeight="semibold"
              fontSize="xs"
              bg={isPublic ? "green.100" : "gray.200"}
              color={isPublic ? "green.800" : "gray.600"}
            >
              {isPublic ? "PUBLIC" : "PRIVATE"}
            </Box>
          </Flex>
        </div>

        {/* Activity Type Dropdown */}
        <SelectRoot
          collection={activityTypeCollection}
          className="border border-stone-600"
          style={{ marginBottom: 12 }}
          value={[activityType]}
          onValueChange={(details) => {
            const newType = details.value[0]
            if (newType === "INFO" || newType === "UPDATE" || newType === "SUBSCRIPTION") {
              setActivityType(newType)
            }
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValueText placeholder="Select Activity Type" />
          </SelectTrigger>
          <SelectContent>
            {activityTypeCollection.items.map((option) => (
              <SelectItem key={option.value} item={option}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>

        {/* Title Input */}
        <div style={{ marginBottom: 12 }}>
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={title}
              onAccept={setTitle}
              fieldLabel="Title"
              size="sm"
              type="activity"
            />
          </div>
        </div>

        {/* Description Textarea */}
        <div style={{ marginBottom: 12 }}>
          <Textarea
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            p={2}
            className="border border-stone-600"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <ProofreadButton
              text={description}
              onAccept={setDescription}
              fieldLabel="Description"
              size="sm"
              type="activity"
            />
          </div>
        </div>

        {/* Existing Images */}
        {existingImages.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 500 }}>Current Images</label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {existingImages.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 150,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#f9fafb",
                      position: "relative",
                    }}
                  >
                    <Image
                      src={src}
                      alt={`Existing ${index + 1}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveExistingImage(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    type="button"
                    aria-label="Remove image"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload New Images */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload New Images</label>
          <FileUploadRoot
            onFileChange={(fileDetails) => {
              const newFiles = fileDetails.acceptedFiles
              
              // Revoke all old URLs
              imagePreviews.forEach(url => URL.revokeObjectURL(url))
              
              // Create fresh URLs for all files
              const newUrls = newFiles.map(file => URL.createObjectURL(file))
              
              setImageFiles(newFiles)
              setImagePreviews(newUrls)
            }}
            accept={["image/*"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}>
                <HiUpload /> Upload Images
              </Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={imageFiles} />
          </FileUploadRoot>
          {imagePreviews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {imagePreviews.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 150,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#f9fafb",
                      position: "relative",
                    }}
                  >
                    <Image
                      src={src}
                      alt={`Preview ${index + 1}`}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                  <button
                    onClick={() => handleRemoveImage(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    type="button"
                    aria-label="Remove image"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Existing Videos */}
        {existingVideos.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontWeight: 500 }}>Current Videos</label>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {existingVideos.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 240,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#000",
                    }}
                  >
                    <video
                      src={src}
                      controls
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <button
                    onClick={() => handleRemoveExistingVideo(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                    type="button"
                    aria-label="Remove video"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload New Videos */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontWeight: 500 }}>Upload New Videos</label>
          <FileUploadRoot
            onFileChange={(fileDetails) => {
              const newFiles = fileDetails.acceptedFiles
              
              // Revoke all old URLs
              videoPreviews.forEach(url => URL.revokeObjectURL(url))
              
              // Create fresh URLs for all files
              const newUrls = newFiles.map(file => URL.createObjectURL(file))
              
              setVideoFiles(newFiles)
              setVideoPreviews(newUrls)
            }}
            accept={["video/*"]}
            maxFiles={5}
          >
            <FileUploadTrigger asChild>
              <Button variant="outline" size="sm" className="border" px={4}>
                <HiUpload /> Upload Videos
              </Button>
            </FileUploadTrigger>
            <FileUploadList showSize clearable files={videoFiles} />
          </FileUploadRoot>
          {videoPreviews.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 8,
              }}
            >
              {videoPreviews.map((src, index) => (
                <div
                  key={src}
                  className="relative group"
                  style={{
                    width: 240,
                    height: 150,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      backgroundColor: "#000",
                    }}
                  >
                    <video
                      src={src}
                      controls
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    >
                      Your browser does not support the video tag.
                    </video>
                  </div>
                  <button
                    onClick={() => handleRemoveVideo(index)}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 z-10"
                    type="button"
                    aria-label="Remove video"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={saving || compressing}
          >
            Cancel
          </Button>
          <Button
            colorScheme="blue"
            onClick={handleSave}
            disabled={!title || !description || saving || compressing}
          >
            {compressing ? "Compressing..." : saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  ) : null
}

interface DeleteModalProps {
  open: boolean
  onClose: () => void
  activity: Activity | null
  onDelete: () => void
  deleting: boolean
  error: string | null
}

export const DeleteActivityModal: React.FC<DeleteModalProps> = ({
  open,
  onClose,
  activity,
  onDelete,
  deleting,
  error,
}) => {
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (open) {
      const originalStyle = window.getComputedStyle(document.body).overflow
      document.body.style.overflow = "hidden"
      return () => {
        document.body.style.overflow = originalStyle
      }
    }
  }, [open])

  return open && activity ? (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "white",
          padding: 24,
          borderRadius: 8,
          minWidth: 350,
          maxWidth: "90vw",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 2px 16px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{ fontWeight: "bold", fontSize: "1.125rem", marginBottom: 16 }}
        >
          Delete Activity
        </div>
        <div style={{ marginBottom: 16 }}>
          Are you sure you want to delete the activity <b>{activity.title}</b>?
        </div>
        {error && <div style={{ color: "red", marginBottom: 8 }}>{error}</div>}
        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button
            onClick={onClose}
            style={{ marginRight: 12 }}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button colorScheme="red" onClick={onDelete} disabled={deleting}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  ) : null
}

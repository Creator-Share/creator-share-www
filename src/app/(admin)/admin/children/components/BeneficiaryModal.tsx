"use client"
import React, { useState, useEffect, useCallback } from "react"
import DeleteDialog from "./DeleteDialog"
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogCloseTrigger,
} from "@/components/ui/dialog"
import {
  Text,
  Fieldset,
  Input,
  Stack,
  Textarea,
  Image,
  CloseButton,
  InputGroup,
  FileUpload,
} from "@chakra-ui/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import {
  NativeSelectField,
  NativeSelectRoot,
} from "@/components/ui/native-select"
import { Tooltip } from "@/components/ui/tooltip"
import { LuFileUp } from "react-icons/lu"
import { HiUpload, HiX } from "react-icons/hi"
import {
  FileUploadRoot,
  FileUploadTrigger,
} from "@/components/ui/file-upload"
import MapPicker from "./MapPicker"
import ActivitiesTable from "../../activities/components/ActivitiesTable"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"
import ProofreadButton from "@/components/ai/ProofreadButton"
import { toaster } from "@/components/ui/toaster"
import { dollarsToCents } from "@/utils/currency"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import {
  uploadImagesForTransformation
} from "@/utils/supabase/imageTransform"

type BeneficiaryModalMode = "create" | "edit"

interface BeneficiaryModalProps {
  mode: BeneficiaryModalMode
  isOpen: boolean
  onClose: () => void
  // For create mode
  formData?: Partial<Beneficiaries>
  setFormData?: React.Dispatch<React.SetStateAction<Partial<Beneficiaries>>>
  handleInputChange?: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => void
  handleSelectChange?: (name: keyof Beneficiaries, value: string) => void
  handleLocationSelect?: (
    geo: [number, number],
    locationStr: string,
    country: string
  ) => void
  handleSubmit?: () => Promise<boolean>
  // For edit mode
  selectedChild?: Partial<Beneficiaries>
  onSave?: (updatedChild: Partial<Beneficiaries>) => void
  onDelete?: (childId: string) => Promise<void>
  // Shared
  imageFiles: File[]
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>
  videoFiles: File[]
  setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>
}

const BeneficiaryModal: React.FC<BeneficiaryModalProps> = ({
  mode,
  isOpen,
  onClose,
  formData: externalFormData,
  setFormData: setExternalFormData,
  handleInputChange: externalHandleInputChange,
  handleSelectChange: externalHandleSelectChange,
  handleLocationSelect: externalHandleLocationSelect,
  handleSubmit,
  selectedChild,
  onSave,
  onDelete,
  imageFiles,
  setImageFiles,
  videoFiles,
  setVideoFiles,
}) => {
  const isEditMode = mode === "edit"
  const isCreateMode = mode === "create"

  // Local state for edit mode
  const [localFormData, setLocalFormData] = useState<Partial<Beneficiaries>>(
    selectedChild || {}
  )
  const [allImages, setAllImages] = useState<BeneficiaryMedia[]>([])
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [isImageLoading, setIsImageLoading] = useState(false)

  // Shared state
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null)
  const [processedImages, setProcessedImages] = useState<File[]>([])
  const [, setUploadedImagePaths] = useState<string[]>([])
  const [isProcessingImages, setIsProcessingImages] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Use the appropriate form data based on mode
  const formData = isEditMode ? localFormData : externalFormData || {}

  // Environment variable for sponsorship amount
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const publicHardcodedCents = publicHardcodedRaw
    ? parseInt(publicHardcodedRaw, 10)
    : null

  // Generate a short URL-style string
  const generateShortUrl = useCallback(() => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }, [])

  // Prepopulate username in create mode when modal opens
  useEffect(() => {
    if (isCreateMode && isOpen && !formData.username && setExternalFormData) {
      setExternalFormData((prev: Partial<Beneficiaries>) => ({ 
        ...prev, 
        username: generateShortUrl() 
      }))
    }
  }, [isCreateMode, isOpen, generateShortUrl, setExternalFormData, formData.username])

  // Update local form data when selectedChild changes (edit mode)
  useEffect(() => {
    if (isEditMode && selectedChild) {
      const formattedData = {
        ...selectedChild,
        budget_goal: selectedChild.budget_goal
          ? selectedChild.budget_goal / 100
          : 0,
      }
      setLocalFormData(formattedData)
      setVideoUrl(selectedChild.video_url || null)
    }
  }, [selectedChild, isEditMode])

  // Fetch images for edit mode
  const fetchImages = useCallback(async () => {
    if (isEditMode && selectedChild?.id) {
      const response = await fetch(
        `/api/admin/beneficiaries/images/${selectedChild.id}`
      )
      if (response.ok) {
        const media = await response.json()
        const validImages = media.filter(
          (item: BeneficiaryMedia) =>
            item && (item.id || item.image_url) && item.type === "IMAGE"
        )
        setAllImages(validImages)

        const videoMedia = media.filter(
          (item: BeneficiaryMedia) =>
            item && (item.id || item.image_url) && item.type === "VIDEO"
        )
        if (videoMedia.length > 0) {
          const video = videoMedia[0]
          const videoSrc = video?.id
            ? generatePublicUrl(video as unknown as MediaRow)
            : video?.image_url || ""
          if (videoSrc && videoSrc.trim() !== "") {
            setVideoUrl(videoSrc)
          }
        }
      }
    }
  }, [selectedChild?.id, isEditMode])

  useEffect(() => {
    fetchImages()
  }, [fetchImages])

  // Handle modal close - data persists unless explicitly cancelled
  const handleModalClose = () => {
    // Simply close the modal without clearing data
    onClose()
  }

  // Handle explicit cancel - clears data and resets
  const handleCancel = () => {
    if (hasUnsavedChanges) {
      const confirmClose = window.confirm(
        "You have unsaved changes. Clicking OK will discard all changes."
      )
      if (!confirmClose) return
    }
    
    // Clear all form data and reset state
    setHasUnsavedChanges(false)
    setImagePreviewUrls([])
    setVideoPreviewUrl(null)
    setImageFiles([])
    setVideoFiles([])
    
    if (isEditMode) {
      setLocalFormData(selectedChild || {})
    }
    
    onClose()
  }

  // Input change handler
  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setHasUnsavedChanges(true)
    const { name, value } = e.target
    const processedValue =
      name === "budget_goal" ? parseFloat(value) || 0 : value

    if (isEditMode) {
      setLocalFormData((prev) => ({ ...prev, [name]: processedValue }))
    } else if (externalHandleInputChange) {
      externalHandleInputChange(e)
    }
  }

  // Select change handler
  const handleSelectChange = (name: string, value: string) => {
    setHasUnsavedChanges(true)
    if (isEditMode) {
      setLocalFormData((prev) => ({ ...prev, [name]: value }))
    } else if (externalHandleSelectChange) {
      externalHandleSelectChange(name as keyof Beneficiaries, value)
    }
  }

  // Location select handler
  const handleLocationSelect = (
    geo: [number, number],
    locationStr: string,
    country: string
  ) => {
    setHasUnsavedChanges(true)
    if (isEditMode) {
      setLocalFormData((prev) => ({
        ...prev,
        location_geo: { type: "Point", coordinates: [geo[1], geo[0]] },
        location_str: locationStr,
        country: country,
      }))
    } else if (externalHandleLocationSelect) {
      externalHandleLocationSelect(geo, locationStr, country)
    }
  }

  // Image upload handler
  const handleImageChange = async (fileDetails: {
    acceptedFiles: File[]
    rejectedFiles?: Array<{file: File, errors: Array<string | {code?: string, message?: string}>}>
  }) => {
    // Show helpful error messages for rejected files
    if (fileDetails.rejectedFiles && fileDetails.rejectedFiles.length > 0) {
      const rejectedNames = fileDetails.rejectedFiles.map(r => r.file.name).join(', ')
      const errorMessages = fileDetails.rejectedFiles.map(r => 
        r.errors.map(e => typeof e === 'string' ? e : (e.message || e.code || 'Unknown error')).join(', ')
      ).join('; ')
      
      toaster.create({
        title: "Some Files Were Rejected",
        description: `Files: ${rejectedNames}. Reason: ${errorMessages}. Accepted formats: PNG, JPG, JPEG, HEIC. If you're having issues with JPG files, try re-saving them or converting to PNG.`,
        type: "error",
        duration: 10000,
      })
    }
    
    if (isCreateMode) {
      // In create mode, just store files locally - don't upload to Supabase yet
      if (fileDetails.acceptedFiles.length === 0) {
        // Clear everything if no files
        setImageFiles([])
        setImagePreviewUrls([])
        return
      }
      
      // Additional validation: check file extensions manually as a fallback
      const validFiles: File[] = []
      const invalidFiles: string[] = []
      
      fileDetails.acceptedFiles.forEach(file => {
        const ext = file.name.split('.').pop()?.toLowerCase()
        const validExtensions = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']
        const isImage = file.type.startsWith('image/')
        
        // Accept if extension is valid OR if MIME type indicates it's an image
        if ((ext && validExtensions.includes(ext)) || isImage) {
          validFiles.push(file)
        } else {
          invalidFiles.push(file.name)
        }
      })
      
      if (invalidFiles.length > 0) {
        toaster.create({
          title: "Invalid File Format",
          description: `These files were skipped: ${invalidFiles.join(', ')}. Please use PNG, JPG, JPEG, or HEIC formats.`,
          type: "warning",
          duration: 6000,
        })
      }
      
      if (validFiles.length === 0) return
      
      const previewUrls = validFiles.map((file) =>
        URL.createObjectURL(file)
      )
      
      setImageFiles(validFiles)
      setImagePreviewUrls(previewUrls)
      
      toaster.create({
        title: "Images Selected",
        description: `${validFiles.length} image${validFiles.length > 1 ? 's' : ''} selected. ${invalidFiles.length > 0 ? `${invalidFiles.length} file${invalidFiles.length > 1 ? 's' : ''} skipped.` : ''} Images will be optimized and uploaded when you save.`,
        type: "success",
        duration: 4000,
      })
    } else {
      // In edit mode, upload and optimize immediately
      if (fileDetails.acceptedFiles.length > 0) {
        try {
          setIsProcessingImages(true)
          
          // Upload and optimize images
          const optimizedPaths = await uploadImagesForTransformation(
            'media',
            fileDetails.acceptedFiles,
            `beneficiaries/${selectedChild?.id || 'temp'}`
          )
          
          setProcessedImages(fileDetails.acceptedFiles)
          setUploadedImagePaths(optimizedPaths)
          
          // Upload images immediately in edit mode
          const formData = new FormData()
          formData.append("beneficiaryId", selectedChild?.id || "")
          fileDetails.acceptedFiles.forEach((f) => formData.append("images", f))

          const response = await fetch(
            "/api/admin/beneficiaries/images/create",
            { method: "POST", body: formData }
          )
          if (!response.ok) throw new Error("Image upload failed")
          
          // Reset file states
          setImageFiles([])
          setProcessedImages([])
          setUploadedImagePaths([])

          // Refresh images list
          await fetchImages()
          
          toaster.create({
            title: "Images Uploaded",
            description: `${fileDetails.acceptedFiles.length} images have been uploaded successfully.`,
            type: "success",
            duration: 3000,
          })
        } catch (error) {
          console.error('Image optimization error:', error)
          toaster.create({
            title: "Optimization Error",
            description: "Failed to optimize images. They will be uploaded as-is.",
            type: "warning",
            duration: 5000,
          })
          setImageFiles(fileDetails.acceptedFiles)
        } finally {
          setIsProcessingImages(false)
        }
      } else {
        setImageFiles(fileDetails.acceptedFiles)
      }
    }
  }

  // Video upload handler
  const handleVideoChange = (fileDetails: { acceptedFiles: File[] }) => {
    setVideoFiles(fileDetails.acceptedFiles)
    if (fileDetails.acceptedFiles.length > 0) {
      setVideoPreviewUrl(URL.createObjectURL(fileDetails.acceptedFiles[0]))
    }
  }

  // Delete image handler (edit mode only)
  const handleDeleteImage = async (imageId: string) => {
    if (!imageId) return

    try {
      setIsImageLoading(true)
      const response = await fetch("/api/admin/beneficiaries/images/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId }),
      })

      if (!response.ok) {
        throw new Error("Failed to delete image")
      }

      setAllImages((prev) => prev.filter((img) => img.id !== imageId))
      toaster.create({
        title: "Success",
        description: "Image deleted successfully",
        duration: 3000,
      })
    } catch (error) {
      console.error("Delete image error:", error)
      toaster.create({
        title: "Error",
        description: "Failed to delete image",
        duration: 3000,
      })
    } finally {
      setIsImageLoading(false)
    }
  }

  // Delete preview image (create mode only)
  const handleDeletePreviewImage = (index: number) => {
    const newFiles = [...imageFiles]
    const newPreviewUrls = [...imagePreviewUrls]
    
    // Revoke the object URL to free memory
    URL.revokeObjectURL(newPreviewUrls[index])
    
    // Remove the file and preview URL at the specified index
    newFiles.splice(index, 1)
    newPreviewUrls.splice(index, 1)
    
    setImageFiles(newFiles)
    setImagePreviewUrls(newPreviewUrls)
    
    toaster.create({
      title: "Image Removed",
      description: "Image removed from selection",
      duration: 2000,
    })
  }

  // Submit handler
  const handleFormSubmit = async () => {
    const baseRequired = [
      "name",
      "username",
      "gender",
      "biography",
      "country",
    ] as const
    const requiredFields =
      publicHardcodedCents === null
        ? ([...baseRequired, "budget_goal"] as const)
        : baseRequired
    const emptyFields = requiredFields.filter((field) => !formData[field])

    if (emptyFields.length > 0) {
      toaster.create({
        title: "Validation Error",
        description: `Please fill in all required fields: ${emptyFields.join(", ")}`,
        duration: 5000,
      })
      return
    }

    try {
      setIsSaving(true)

      if (isCreateMode && handleSubmit && setExternalFormData) {
        // Create beneficiary first
        if (publicHardcodedCents !== null) {
          const dollars = publicHardcodedCents / 100
          setExternalFormData({ ...(formData || {}), budget_goal: dollars })
        }

        // Create beneficiary
        const success = await handleSubmit()
        if (!success) {
          setIsSaving(false)
          return
        }

        // Clean up after successful save
        if (imagePreviewUrls.length > 0) {
          imagePreviewUrls.forEach(url => URL.revokeObjectURL(url))
          setImagePreviewUrls([])
        }
        if (videoPreviewUrl) {
          URL.revokeObjectURL(videoPreviewUrl)
          setVideoPreviewUrl(null)
        }
        setImageFiles([])
        setVideoFiles([])
        setProcessedImages([])
        setUploadedImagePaths([])
        setHasUnsavedChanges(false)
        
        // Reset the parent's form data
        setExternalFormData({})
        
        onClose()
      } else if (isEditMode && onSave) {
        // Edit mode
        const updatedData = { ...localFormData }
        const envRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
        const envCents = envRaw ? parseInt(envRaw, 10) : null
        const budgetGoalInCentsFromForm = parseInt(
          dollarsToCents(localFormData.budget_goal || 0)
        )
        const budgetGoalInCents =
          envCents !== null && !isNaN(envCents)
            ? envCents
            : budgetGoalInCentsFromForm

        // Handle image uploads - use optimized images if available
        if (imageFiles.length > 0 || processedImages.length > 0) {
          try {
            const formData = new FormData()
            formData.append("beneficiaryId", selectedChild?.id || "")
            
            // Use processed/optimized images if available, otherwise use original files
            const filesToUpload = processedImages.length > 0 ? processedImages : imageFiles
            filesToUpload.forEach((f) => formData.append("images", f))

            const response = await fetch(
              "/api/admin/beneficiaries/images/create",
              { method: "POST", body: formData }
            )
            if (!response.ok) throw new Error("Image upload failed")
            
            // Reset file states
            setImageFiles([])
            setProcessedImages([])
            setUploadedImagePaths([])

            // Refresh images list
            await fetchImages()
          } catch {
            toaster.create({
              title: "Error",
              description: "Failed to upload images",
              duration: 5000,
            })
          }
        }

        // Handle video uploads
        if (videoFiles.length > 0) {
          try {
            const formData = new FormData()
            formData.append("beneficiaryId", selectedChild?.id || "")
            formData.append("video", videoFiles[0])

            const response = await fetch(
              "/api/admin/beneficiaries/video/create",
              { method: "POST", body: formData }
            )
            if (!response.ok) throw new Error("Video upload failed")

            const data = await response.json()
            if (data?.public_url) {
              updatedData.video_url = data.public_url
              setVideoUrl(data.public_url)
            }
          } catch {
            toaster.create({
              title: "Error",
              description: "Failed to upload video",
              duration: 5000,
            })
          }
        }

        await onSave({ ...updatedData, budget_goal: budgetGoalInCents })
        setHasUnsavedChanges(false)
        setImageFiles([])
        setVideoFiles([])
        
        // Refresh images list after saving
        await fetchImages()
      }
    } catch (error) {
      console.error("Error saving:", error)
      toaster.create({
        title: "Error",
        description: `Failed to ${isCreateMode ? "create" : "update"} beneficiary`,
        duration: 5000,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteBeneficiary = async () => {
    if (selectedChild?.id && onDelete) {
      try {
        setIsDeleting(true)
        await onDelete(selectedChild.id)
        setIsDeleteDialogOpen(false)
      } finally {
        setIsDeleting(false)
      }
    }
  }

  return (
    <DialogRoot
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) handleModalClose()
      }}
    >
      <DialogContent className="max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex justify-between items-center p-6 pb-2">
          <DialogTitle>
            <div className="flex items-center gap-2">
              <Text fontSize="3xl" fontWeight="bold">
                {isCreateMode ? "Add a Child" : "Edit Child"}
              </Text>
              {hasUnsavedChanges && (
                <Text fontSize="sm" color="orange.500" fontWeight="medium">
                  (Unsaved changes)
                </Text>
              )}
            </div>
          </DialogTitle>
          <DialogCloseTrigger
            onClick={handleModalClose}
            className="text-gray-500 hover:text-gray-700"
          />
        </DialogHeader>

        <DialogBody className="p-6">
          <Fieldset.Root size="lg">
            <Stack>
              <Fieldset.Legend>Child details</Fieldset.Legend>
              <Fieldset.HelperText>
                Please provide child details below.
              </Fieldset.HelperText>
            </Stack>

            <Fieldset.Content>
              <Field label="Name" required errorText="This field is required">
                <Input
                  name="name"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.name || ""}
                />
              </Field>

              <Field
                label={
                  <Tooltip
                    content="⚠️ Warning: Changing this after children are created will break existing links to their profiles"
                    showArrow
                  >
                    <span style={{ cursor: 'help', borderBottom: '1px dotted #666' }}>
                      URL Shortcut
                    </span>
                  </Tooltip>
                }
                required
                errorText="This field is required"
              >
                <Input
                  name="username"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.username || ""}
                />
              </Field>

              <Field label="Gender" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Gender"
                    px={2}
                    name="gender"
                    onChange={(e) => handleSelectChange("gender", e.target.value)}
                    value={formData.gender || ""}
                  >
                    <option value="Boy">Boy</option>
                    <option value="Girl">Girl</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>

              <Field
                label="Birth Date (Optional)"
                helperText="Leave blank if unknown"
              >
                <Input
                  name="birth_date"
                  type="date"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.birth_date || ""}
                />
              </Field>

              <Field
                label="Biography"
                required
                errorText="This field is required"
                helperText="Provide a detailed description about the child"
              >
                <Textarea
                  name="biography"
                  size="xl"
                  className="border"
                  px={2}
                  py={2}
                  onChange={handleInputChange}
                  value={formData.biography || ""}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <ProofreadButton
                    text={formData.biography || ""}
                    onAccept={(proofreadText) => {
                      if (isEditMode) {
                        setLocalFormData((prev) => ({ ...prev, biography: proofreadText }))
                      } else if (setExternalFormData) {
                        setExternalFormData((prev: Partial<Beneficiaries>) => ({ 
                          ...prev, 
                          biography: proofreadText 
                        }))
                      }
                      setHasUnsavedChanges(true)
                    }}
                    fieldLabel="Biography"
                    size="sm"
                  />
                </div>
              </Field>

              {/* Budget Goal */}
              {publicHardcodedCents === null ? (
                <Field
                  label="Budget Goal"
                  required
                  errorText="This field is required"
                >
                  <Input
                    name="budget_goal"
                    type="number"
                    min="0"
                    step="0.01"
                    className="border"
                    px={2}
                    onChange={handleInputChange}
                    value={formData.budget_goal || ""}
                  />
                </Field>
              ) : (
                <Field label="Sponsorship Amount">
                  <Input
                    name="budget_goal"
                    type="text"
                    className="border bg-gray-100"
                    px={2}
                    value={`$${((publicHardcodedCents || 0) / 100).toFixed(2)}`}
                    readOnly
                    disabled
                  />
                </Field>
              )}

              {/* Status */}
              <Field label="Status" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    px={2}
                    name="status"
                    onChange={(e) => handleSelectChange("status", e.target.value)}
                    value={formData.status || "New"}
                  >
                    <option value="New">New</option>
                    <option value="Partially Funded">Partially Funded</option>
                    <option value="Budget Fulfilled">Budget Fulfilled</option>
                    <option value="Archived">Archived</option>
                    <option value="Draft">Draft</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>

              {/* Images */}
              <Field label={isEditMode ? "Manage Images" : ""}>
                <div className="space-y-4">
                  {/* Show existing images in edit mode */}
                  {isEditMode && allImages.length > 0 && (
                    <div className="flex flex-wrap gap-4">
                      {allImages.map((image, index) => (
                        <div key={image.id} className="relative group">
                          <Image
                            src={
                              image.id
                                ? generatePublicUrl(image as unknown as MediaRow)
                                : image.image_url
                            }
                            alt={`Child's photo ${index + 1}`}
                            width={200}
                            height={200}
                            objectFit="cover"
                            className="rounded-xl"
                          />
                          <button
                            onClick={() => handleDeleteImage(image.id)}
                            className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                            disabled={isImageLoading}
                          >
                            <HiX size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Upload new images */}
                  {isCreateMode ? (
                    <FileUpload.Root
                      gap="1"
                      maxWidth="100%"
                      onFileChange={handleImageChange}
                      accept={["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"]}
                      maxFiles={5}
                    >
                      <FileUpload.HiddenInput />
                      <FileUpload.Label>
                        Upload Images (Will be processed on save)
                      </FileUpload.Label>
                      <InputGroup
                        startElement={<LuFileUp />}
                        endElement={
                          <FileUpload.ClearTrigger asChild>
                            <CloseButton
                              me="-1"
                              size="xs"
                              variant="plain"
                              focusVisibleRing="inside"
                              focusRingWidth="2px"
                              pointerEvents="auto"
                            />
                          </FileUpload.ClearTrigger>
                        }
                      >
                        <Input asChild>
                          <FileUpload.Trigger>
                            <FileUpload.FileText lineClamp={1} />
                          </FileUpload.Trigger>
                        </Input>
                      </InputGroup>

                      {imagePreviewUrls.length > 0 && (
                        <div className="mt-4">
                          <Text fontSize="sm" color="gray.600" mb={2}>
                            Selected Images ({imageFiles.length}):
                            {isProcessingImages && (
                              <Text as="span" color="blue.600" ml={2}>
                                (Optimizing...)
                              </Text>
                            )}
                          </Text>
                          <div className="flex flex-wrap gap-4">
                            {imagePreviewUrls.map((url, index) => {
                              const file = imageFiles[index]
                              const fileSizeKB = file
                                ? Math.round(file.size / 1024)
                                : 0
                              return (
                                <div key={index} className="relative group">
                                  <Image
                                    src={url}
                                    alt={`Preview ${index + 1}`}
                                    width={200}
                                    height={200}
                                    objectFit="cover"
                                    className="rounded-xl border-2 border-gray-200"
                                  />
                                  <div className="absolute bottom-2 left-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                                    {fileSizeKB}KB
                                  </div>
                                  <button
                                    onClick={() => handleDeletePreviewImage(index)}
                                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <HiX size={16} />
                                  </button>
                                  {isProcessingImages && (
                                    <div className="absolute inset-0 bg-blue-500 bg-opacity-20 rounded-xl flex items-center justify-center">
                                      <div className="bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-medium">
                                        Optimizing...
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </FileUpload.Root>
                  ) : (
                    <FileUploadRoot
                      onFileChange={handleImageChange}
                      accept={["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"]}
                      maxFiles={5}
                    >
                      <FileUploadTrigger asChild>
                        <Button variant="outline" size="sm" className="border" px={4}>
                          <HiUpload />{" "}
                          {allImages.length === 0
                            ? "Upload Images"
                            : "Add More Images"}
                        </Button>
                      </FileUploadTrigger>
                    </FileUploadRoot>
                  )}
                </div>
              </Field>

              {/* Video */}
              <Field label={isEditMode ? "Change Video" : ""}>
                <div className="space-y-4">
                  {isCreateMode ? (
                    <FileUpload.Root
                      gap="1"
                      maxWidth="100%"
                      onFileChange={handleVideoChange}
                      accept={["video/mp4"]}
                    >
                      <FileUpload.HiddenInput />
                      <FileUpload.Label>Upload Video</FileUpload.Label>
                      <InputGroup
                        startElement={<LuFileUp />}
                        endElement={
                          <FileUpload.ClearTrigger asChild>
                            <CloseButton
                              me="-1"
                              size="xs"
                              variant="plain"
                              focusVisibleRing="inside"
                              focusRingWidth="2px"
                              pointerEvents="auto"
                            />
                          </FileUpload.ClearTrigger>
                        }
                      >
                        <Input asChild>
                          <FileUpload.Trigger>
                            <FileUpload.FileText lineClamp={1} />
                          </FileUpload.Trigger>
                        </Input>
                      </InputGroup>

                      {videoPreviewUrl && (
                        <div className="relative group mt-4">
                          <video width="200" height="200" controls>
                            <source src={videoPreviewUrl} type="video/mp4" />
                            Your browser does not support the video tag.
                          </video>
                          <FileUpload.ClearTrigger asChild>
                            <CloseButton
                              className="absolute top-2 right-2"
                              size="sm"
                              variant="solid"
                              bg="red.500"
                              color="white"
                              _hover={{ bg: "red.600" }}
                            />
                          </FileUpload.ClearTrigger>
                        </div>
                      )}
                    </FileUpload.Root>
                  ) : (
                    <FileUploadRoot
                      onFileChange={handleVideoChange}
                      accept={["video/mp4"]}
                    >
                      <FileUploadTrigger asChild>
                        {videoUrl ? (
                          <video width="200" height="200" controls>
                            <source src={videoUrl} type="video/mp4" />
                            Your browser does not support the video tag.
                          </video>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border"
                            px={4}
                          >
                            <HiUpload /> Upload Video
                          </Button>
                        )}
                      </FileUploadTrigger>
                    </FileUploadRoot>
                  )}
                </div>
              </Field>

              {/* Map Picker */}
              <Field 
                label="Location" 
                required 
                errorText="Please select a location on the map"
                helperText="Click on the map to select a location. Country will be automatically detected."
              >
                <MapPicker
                  onSelectLocation={handleLocationSelect}
                  initialLocation={
                    isEditMode && selectedChild?.location_geo
                      ? {
                          coordinates: [
                            selectedChild.location_geo.coordinates[1],
                            selectedChild.location_geo.coordinates[0],
                          ],
                          locationStr: selectedChild.location_str || "",
                          country: selectedChild.country || "",
                        }
                      : undefined
                  }
                />
                
                {/* Show selected location details */}
                {formData.country && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-md border border-gray-200">
                    <Text fontSize="sm" color="gray.700" fontWeight="medium">
                      Selected Location:
                    </Text>
                    <Text fontSize="sm" color="gray.600">
                      {formData.location_str || "Location set"}
                    </Text>
                    <Text fontSize="sm" color="blue.600" fontWeight="medium" mt={1}>
                      Country: {formData.country}
                    </Text>
                  </div>
                )}
              </Field>
            </Fieldset.Content>
          </Fieldset.Root>

          {/* Activities Table (Edit mode only) */}
          {isEditMode && selectedChild?.id && (
            <div className="mt-8">
              <ActivitiesTable
                beneficiaryType="CHILD"
                beneficiaryId={selectedChild.id}
              />
            </div>
          )}
        </DialogBody>

        <DialogFooter className="flex justify-end gap-3 p-6 pt-2">
          <Button
            className="bg-gray-500 text-white hover:bg-gray-600"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>

          {isEditMode && (
            <Button
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={isDeleting || isSaving}
            >
              Delete
            </Button>
          )}

          <Button
            type="button"
            onClick={handleFormSubmit}
            className="bg-[#1C3C8C] text-white disabled:opacity-50"
            disabled={isSaving}
            loading={isSaving}
            loadingText={isCreateMode ? "Adding..." : "Saving..."}
          >
            {isSaving
              ? isCreateMode
                ? "Adding..."
                : "Saving..."
              : isCreateMode
                ? "Add Child"
                : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Delete Dialog (Edit mode only) */}
      {isEditMode && (
        <DeleteDialog
          isOpen={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={handleDeleteBeneficiary}
          itemCount={1}
        />
      )}
    </DialogRoot>
  )
}

export default BeneficiaryModal

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
import { Spinner } from "@chakra-ui/react"
import { Tooltip } from "@/components/ui/tooltip"
import { LuFileUp } from "react-icons/lu"
import { HiX } from "react-icons/hi"
import MapPicker from "./MapPicker"
import ActivitiesTable from "../../activities/components/ActivitiesTable"
import { Beneficiaries, BeneficiaryMedia, BeneficiaryMetadata } from "@/types/admin.types"
import { Checkbox } from "@/components/ui/checkbox"
import ProofreadButton from "@/components/ai/ProofreadButton"
import { toaster } from "@/components/ui/toaster"
import { dollarsToCents } from "@/utils/currency"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import { compressImage, compressImages } from "@/utils/imageCompression"
import { getDefaultSponsorshipAmount } from "@/components/BeneficiaryTypeNav"

type BeneficiaryModalMode = "create" | "edit"

interface BeneficiaryModalProps {
  mode: BeneficiaryModalMode
  isOpen: boolean
  onClose: () => void
  disabled?: boolean
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
  disabled = false,
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
  const [imagesToDelete, setImagesToDelete] = useState<string[]>([])

  // Shared state
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null)
  const [processedImages, setProcessedImages] = useState<File[]>([])
  const [, setUploadedImagePaths] = useState<string[]>([])
  const [isProcessingImages, setIsProcessingImages] = useState(false)
  const [compressionProgress, setCompressionProgress] = useState<{
    current: number
    total: number
    percent: number
    currentFileName?: string
  } | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [imageUploadKey, setImageUploadKey] = useState(0)
  const [videoUploadKey, setVideoUploadKey] = useState(0)
  const [showBiographyComparison, setShowBiographyComparison] = useState(false)
  const shouldShowOverlay = isProcessingImages || disabled

  const resetImageUploadInput = useCallback(() => {
    if (imagePreviewUrls.length > 0) {
      imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url))
    }
    setImagePreviewUrls([])
    setImageFiles([])
    setImageUploadKey((prev) => prev + 1)
  }, [imagePreviewUrls, setImageFiles])

  const resetVideoUploadInput = useCallback(() => {
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl)
    }
    setVideoPreviewUrl(null)
    setVideoFiles([])
    setVideoUploadKey((prev) => prev + 1)
  }, [videoPreviewUrl, setVideoFiles])

  // Use the appropriate form data based on mode
  const formData = isEditMode ? localFormData : externalFormData || {}
  const birthDateIsEstimate = Boolean(
    (formData.metadata as BeneficiaryMetadata | undefined)?.birth_date_is_estimate
  )

  // Environment variable for sponsorship amount
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const publicHardcodedCents = publicHardcodedRaw
    ? parseInt(publicHardcodedRaw, 10)
    : null

  // Per-type default amount in cents (e.g. $33.33 for CHILD_LABORER, $50 for SPECIAL_NEEDS, $25 for ANIMAL)
  const typeDefaultCents = getDefaultSponsorshipAmount(
    formData.beneficiary_type,
    0 // pass 0 so the helper returns the per-type default (not the budget_goal itself)
  )

  // Effective display/save amount: per-type default > env fallback > 0
  // Per-type default takes priority so each category shows its own amount.
  // The env var acts as a last-resort fallback for any type without a configured default.
  const effectiveAmountCents = typeDefaultCents ?? publicHardcodedCents ?? 0

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
            item && item.id && item.type === "IMAGE"
        )
        setAllImages(validImages)

        const videoMedia = media.filter(
          (item: BeneficiaryMedia) =>
            item && item.id && item.type === "VIDEO"
        )
        if (videoMedia.length > 0) {
          const video = videoMedia[0]
          const videoSrc = video?.id
            ? generatePublicUrl(video as unknown as MediaRow)
            : ""
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
    resetVideoUploadInput()
    setImageFiles([])
    resetImageUploadInput()

    if (isEditMode) {
      setLocalFormData(selectedChild || {})
      // Restore any images that were marked for deletion but not saved
      setImagesToDelete([])
      fetchImages()
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

  const updateMetadataField = useCallback(
    (key: keyof BeneficiaryMetadata | string, value: unknown) => {
      setHasUnsavedChanges(true)
      if (isEditMode) {
        setLocalFormData((prev) => ({
          ...prev,
          metadata: { ...(prev.metadata || {}), [key]: value },
        }))
      } else if (setExternalFormData) {
        setExternalFormData((prev: Partial<Beneficiaries>) => ({
          ...(prev || {}),
          metadata: {
            ...(((prev || {}).metadata as BeneficiaryMetadata) || {}),
            [key]: value,
          },
        }))
      }
    },
    [isEditMode, setExternalFormData]
  )

  const toggleBirthDateEstimate = useCallback(() => {
    updateMetadataField("birth_date_is_estimate", !birthDateIsEstimate)
  }, [birthDateIsEstimate, updateMetadataField])

  // Select change handler
  const handleSelectChange = (name: string, value: string) => {
    setHasUnsavedChanges(true)
    if (isEditMode) {
      setLocalFormData((prev) => ({
        ...prev,
        [name]: value,
        // Clear budget_goal when switching to SPECIAL_NEEDS
        ...(name === "beneficiary_type" && value === "SPECIAL_NEEDS" ? { budget_goal: 0 } : {}),
      }))
    } else if (externalHandleSelectChange) {
      // For beneficiary_type changes, combine the type + budget_goal update into a
      // single setExternalFormData call to avoid stale-closure race conditions where
      // two separate updates overwrite each other's changes.
      if (name === "beneficiary_type" && setExternalFormData) {
        if (value === "SPECIAL_NEEDS") {
          // SPECIAL_NEEDS has no budget goal — set both type and goal together
          setExternalFormData((prev: Partial<Beneficiaries>) => ({
            ...prev,
            beneficiary_type: value as Beneficiaries["beneficiary_type"],
            budget_goal: 0,
          }))
        } else if (publicHardcodedCents === null) {
          // No env override — auto-fill budget_goal with per-type default alongside type
          const newTypeDefault = getDefaultSponsorshipAmount(value, 0)
          setExternalFormData((prev: Partial<Beneficiaries>) => ({
            ...prev,
            beneficiary_type: value as Beneficiaries["beneficiary_type"],
            ...(newTypeDefault !== null ? { budget_goal: newTypeDefault / 100 } : {}),
          }))
        } else {
          // Env override is set — just update the type (budget_goal stays fixed by env)
          externalHandleSelectChange(name as keyof Beneficiaries, value)
        }
      } else {
        externalHandleSelectChange(name as keyof Beneficiaries, value)
      }
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

  // Compression is now handled by the utility function imported above

  // Image upload handler
  const handleImageChange = async (fileDetails: {
    acceptedFiles: File[]
    rejectedFiles?: Array<{ file: File, errors: Array<string | { code?: string, message?: string }> }>
  }) => {
    // Show helpful error messages for rejected files
    if (fileDetails.rejectedFiles && fileDetails.rejectedFiles.length > 0) {
      const rejectedNames = fileDetails.rejectedFiles.map(r => r.file.name).join(', ')
      const errorMessages = fileDetails.rejectedFiles.map(r =>
        r.errors.map(e => typeof e === 'string' ? e : (e.message || e.code || 'Unknown error')).join(', ')
      ).join('; ')

      toaster.create({
        title: "Some Files Were Rejected",
        description: `Files: ${rejectedNames}. Reason: ${errorMessages}. Accepted formats: All image formats. If you're having issues, try re-saving the file or converting to a different format.`,
        type: "error",
        duration: 10000,
      })
    }

    if (isCreateMode) {
      // In create mode, just store files locally - don't upload to Supabase yet
      if (fileDetails.acceptedFiles.length === 0) {
        resetImageUploadInput()
        return
      }

      // Show instant loading spinner
      setIsProcessingImages(true)

      try {
        // Additional validation: check file extensions and sizes
        const validFiles: File[] = []
        const invalidFiles: string[] = []
        const largeFiles: string[] = []
        const imageFiles = fileDetails.acceptedFiles.filter(f => f.type.startsWith('image/'))
        const totalImages = imageFiles.length

        // Initialize compression progress
        setCompressionProgress({
          current: 0,
          total: totalImages,
          percent: 0,
        })

        for (let i = 0; i < fileDetails.acceptedFiles.length; i++) {
          const file = fileDetails.acceptedFiles[i]
          const isImage = file.type.startsWith('image/')
          const fileSizeMB = (file.size / 1024 / 1024).toFixed(1)

          // Check file size
          if (file.size > 50 * 1024 * 1024) { // 50MB hard limit
            invalidFiles.push(`${file.name} (${fileSizeMB}MB - too large, max 50MB)`)
            continue
          }

          // Accept all image files
          if (isImage) {
            // Always compress to ensure files are under 4MB for Vercel
            try {
              const imageIndex = imageFiles.indexOf(file)
              const compressed = await compressImage(file, {
                maxSizeMB: 3.5, // Target 3.5MB to leave buffer
                onProgress: (progress) => {
                  // Update progress for current file
                  const overallProgress = ((imageIndex + progress / 100) / totalImages) * 100
                  setCompressionProgress({
                    current: imageIndex + 1,
                    total: totalImages,
                    percent: Math.round(overallProgress),
                    currentFileName: file.name,
                  })
                }
              })
              
              if (compressed.size < file.size) {
                const sizeReduction = ((1 - compressed.size / file.size) * 100).toFixed(0)
                largeFiles.push(`${file.name} (${sizeReduction}% smaller)`)
              }
              
              validFiles.push(compressed)
            } catch (error) {
              console.error(`Failed to compress ${file.name}:`, error)
              // If compression fails, try original file (API will validate size)
              validFiles.push(file)
            }
          } else {
            invalidFiles.push(file.name)
          }
        }

        // Clear compression progress when done
        setCompressionProgress(null)

        if (invalidFiles.length > 0) {
          toaster.create({
            title: "Invalid Files",
            description: `These files were skipped: ${invalidFiles.join(', ')}. Please use PNG, JPG, JPEG, or HEIC formats under 50MB.`,
            type: "warning",
            duration: 6000,
          })
        }

        if (largeFiles.length > 0) {
          toaster.create({
            title: "Large Files Compressed",
            description: `These files were over 10MB and have been automatically compressed: ${largeFiles.join(', ')}`,
            type: "info",
            duration: 6000,
          })
        }

        if (validFiles.length === 0) {
          setIsProcessingImages(false)
          return
        }

        const previewUrls = validFiles.map((file) =>
          URL.createObjectURL(file)
        )

        setImageFiles(validFiles)
        setImagePreviewUrls(previewUrls)

        toaster.create({
          title: "Images Ready",
          description: `${validFiles.length} image${validFiles.length > 1 ? 's' : ''} ready to upload. ${invalidFiles.length > 0 ? `${invalidFiles.length} file${invalidFiles.length > 1 ? 's' : ''} skipped.` : ''} Images will be uploaded when you save.`,
          type: "success",
          duration: 4000,
        })
      } catch (error) {
        console.error('Error processing images:', error)
        toaster.create({
          title: "Processing Error",
          description: "Failed to process some images. Please try again.",
          type: "error",
          duration: 5000,
        })
      } finally {
        setIsProcessingImages(false)
        setCompressionProgress(null)
      }
    } else {
      // In edit mode, defer upload until save (same as create mode)
      if (fileDetails.acceptedFiles.length === 0) {
        resetImageUploadInput()
        return
      }

      setIsProcessingImages(true)

      try {
        const validFiles: File[] = []
        const invalidFiles: string[] = []
        const largeFiles: string[] = []
        const imageFiles = fileDetails.acceptedFiles.filter(f => f.type.startsWith('image/'))
        const totalImages = imageFiles.length

        setCompressionProgress({ current: 0, total: totalImages, percent: 0 })

        for (let i = 0; i < fileDetails.acceptedFiles.length; i++) {
          const file = fileDetails.acceptedFiles[i]
          const isImage = file.type.startsWith('image/')
          const fileSizeMB = (file.size / 1024 / 1024).toFixed(1)

          if (file.size > 50 * 1024 * 1024) {
            invalidFiles.push(`${file.name} (${fileSizeMB}MB - too large, max 50MB)`)
            continue
          }

          if (isImage) {
            try {
              const imageIndex = imageFiles.indexOf(file)
              const compressed = await compressImage(file, {
                maxSizeMB: 3.5,
                onProgress: (progress) => {
                  const overallProgress = ((imageIndex + progress / 100) / totalImages) * 100
                  setCompressionProgress({
                    current: imageIndex + 1,
                    total: totalImages,
                    percent: Math.round(overallProgress),
                    currentFileName: file.name,
                  })
                }
              })
              if (compressed.size < file.size) {
                const sizeReduction = ((1 - compressed.size / file.size) * 100).toFixed(0)
                largeFiles.push(`${file.name} (${sizeReduction}% smaller)`)
              }
              validFiles.push(compressed)
            } catch (error) {
              console.error(`Failed to compress ${file.name}:`, error)
              validFiles.push(file)
            }
          } else {
            invalidFiles.push(file.name)
          }
        }

        setCompressionProgress(null)

        if (invalidFiles.length > 0) {
          toaster.create({
            title: "Invalid Files",
            description: `These files were skipped: ${invalidFiles.join(', ')}. Please use image files under 50MB.`,
            type: "warning",
            duration: 6000,
          })
        }

        if (largeFiles.length > 0) {
          toaster.create({
            title: "Large Files Compressed",
            description: `These files were over 10MB and have been automatically compressed: ${largeFiles.join(', ')}`,
            type: "info",
            duration: 6000,
          })
        }

        if (validFiles.length === 0) {
          setIsProcessingImages(false)
          return
        }

        const previewUrls = validFiles.map((file) => URL.createObjectURL(file))
        setImageFiles(validFiles)
        setImagePreviewUrls(previewUrls)
        setHasUnsavedChanges(true)

        toaster.create({
          title: "Images Ready",
          description: `${validFiles.length} image${validFiles.length > 1 ? 's' : ''} ready to upload. ${invalidFiles.length > 0 ? `${invalidFiles.length} file${invalidFiles.length > 1 ? 's' : ''} skipped.` : ''} Images will be uploaded when you save.`,
          type: "success",
          duration: 4000,
        })
      } catch (error) {
        console.error('Error processing images:', error)
        toaster.create({
          title: "Processing Error",
          description: "Failed to process some images. Please try again.",
          type: "error",
          duration: 5000,
        })
      } finally {
        setIsProcessingImages(false)
        setCompressionProgress(null)
      }
    }
  }

  // Video upload handler
  const handleVideoChange = (fileDetails: { acceptedFiles: File[] }) => {
    if (videoPreviewUrl) {
      URL.revokeObjectURL(videoPreviewUrl)
    }
    setVideoFiles(fileDetails.acceptedFiles)
    if (fileDetails.acceptedFiles.length > 0) {
      setVideoPreviewUrl(URL.createObjectURL(fileDetails.acceptedFiles[0]))
    } else {
      setVideoPreviewUrl(null)
    }
  }

  // Delete image handler (edit mode only) - deferred until save
  const handleDeleteImage = (imageId: string) => {
    if (!imageId) return
    setAllImages((prev) => prev.filter((img) => img.id !== imageId))
    setImagesToDelete((prev) => [...prev, imageId])
    setHasUnsavedChanges(true)
    toaster.create({
      title: "Image Marked for Removal",
      description: "This image will be removed when you save.",
      duration: 2000,
    })
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

    if (newFiles.length === 0) {
      resetImageUploadInput()
    }

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
    // SPECIAL_NEEDS has no budget goal, so never require it for that type
    const isSpecialNeeds = formData.beneficiary_type === "SPECIAL_NEEDS"
    const requiredFields =
      !isSpecialNeeds && publicHardcodedCents === null
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
        // If the amount is driven by config (env or per-type default), push it to form data
        // SPECIAL_NEEDS never has a budget goal — keep it at 0
        if (!isSpecialNeeds && effectiveAmountCents > 0 && !formData.budget_goal) {
          setExternalFormData({ ...(formData || {}), budget_goal: effectiveAmountCents / 100 })
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
        }
        resetImageUploadInput()
        resetVideoUploadInput()
        setProcessedImages([])
        setUploadedImagePaths([])
        setHasUnsavedChanges(false)

        // Reset the parent's form data
        setExternalFormData({})

        onClose()
      } else if (isEditMode && onSave) {
        // Edit mode
        const mergedMetadata = {
          ...(localFormData.metadata || {}),
          birth_date_is_estimate: birthDateIsEstimate,
        }
        const updatedData = { ...localFormData, metadata: mergedMetadata }
        const envRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
        const envCents = envRaw ? parseInt(envRaw, 10) : null
        const budgetGoalInCentsFromForm = parseInt(
          dollarsToCents(localFormData.budget_goal || 0)
        )
        // SPECIAL_NEEDS has no budget goal — always save 0
        const budgetGoalInCents =
          localFormData.beneficiary_type === "SPECIAL_NEEDS"
            ? 0
            : envCents !== null && !isNaN(envCents)
            ? envCents
            : budgetGoalInCentsFromForm

        // Delete images marked for removal
        if (imagesToDelete.length > 0) {
          for (const imageId of imagesToDelete) {
            try {
              await fetch("/api/admin/beneficiaries/images/delete", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageId }),
              })
            } catch (error) {
              console.error(`Failed to delete image ${imageId}:`, error)
            }
          }
          setImagesToDelete([])
        }

        // Handle image uploads - upload directly to Supabase (bypasses Vercel's 4.5MB limit)
        if (imageFiles.length > 0 || processedImages.length > 0) {
          try {
            // Use processed/optimized images if available, otherwise use original files
            const filesToUpload = processedImages.length > 0 ? processedImages : imageFiles

            // Compress images before upload to ensure they're under 4MB
            const compressedFiles = await compressImages(filesToUpload, {
              maxSizeMB: 3.5,
            })

            // Upload compressed images via API
            const formData = new FormData()
            formData.append("beneficiaryId", selectedChild?.id || "")
            compressedFiles.forEach((f) => formData.append("images", f))

            const response = await fetch(
              "/api/admin/beneficiaries/images/create",
              { method: "POST", body: formData }
            )
            if (!response.ok) {
              const errorText = await response.text()
              throw new Error(`Image upload failed: ${errorText}`)
            }

            // Reset file states
            resetImageUploadInput()
            setProcessedImages([])
            setUploadedImagePaths([])

            // Refresh images list
            await fetchImages()
          } catch (error) {
            console.error('Image upload error:', error)
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
        resetVideoUploadInput()

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

  const contentDimClass = shouldShowOverlay
    ? "opacity-0 pointer-events-none select-none"
    : "opacity-100"
  const selectedFilesLabel =
    imageFiles.length > 0
      ? `${imageFiles.length} file${imageFiles.length > 1 ? "s" : ""}`
      : "Select file(s)"
  const currentVideoPreview = videoPreviewUrl || videoUrl

  return (
    <>
    <DialogRoot
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) handleModalClose()
      }}
    >
      <DialogContent className="max-w-4xl w-full max-h-[90vh] relative flex flex-col">
        {shouldShowOverlay && (
          <div className="absolute inset-0 z-50 flex h-full w-full items-center justify-center bg-white/90 backdrop-blur-md">
            <div className="flex flex-col items-center gap-3 text-center">
              <Spinner size="xl" color="#1C3C8C" />
              <p className="text-lg font-medium text-[#1C3C8C]">
                {isProcessingImages
                  ? compressionProgress
                    ? `Compressing Images... ${compressionProgress.percent}%`
                    : "Processing Images..."
                  : "Form Disabled"}
              </p>
              {compressionProgress && (
                <div className="w-64 mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#1C3C8C] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${compressionProgress.percent}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-600 mt-2">
                    {compressionProgress.currentFileName && (
                      <>Compressing: {compressionProgress.currentFileName}</>
                    )}
                    {!compressionProgress.currentFileName && (
                      <>File {compressionProgress.current} of {compressionProgress.total}</>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogHeader className={`flex justify-between items-center p-6 pb-2 flex-none transition-opacity duration-200 ${contentDimClass}`}>
          <DialogTitle>
            <div className="flex items-center gap-2">
              <Text fontSize="3xl" fontWeight="bold">
                {isCreateMode ? "Add a Beneficiary" : "Edit Beneficiary"}
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

        <DialogBody className={`p-6 flex-1 overflow-y-auto transition-opacity duration-200 ${contentDimClass}`}>
          <Fieldset.Root size="lg">
            <Stack>
              <Fieldset.Legend>Beneficiary details</Fieldset.Legend>
              <Fieldset.HelperText>
                Please provide beneficiary details below.
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
                  disabled={false}
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
                  disabled={disabled}
                />
              </Field>

              <Field label="Beneficiary Type" required errorText="This field is required">
                <NativeSelectRoot disabled={disabled}>
                  <NativeSelectField
                    className="border"
                    px={2}
                    name="beneficiary_type"
                    onChange={(e) => handleSelectChange("beneficiary_type", e.target.value)}
                    value={formData.beneficiary_type || "CHILD_LABORER"}
                    _disabled={undefined}
                  >
                    <option value="CHILD_LABORER">Child Laborer</option>
                    <option value="SPECIAL_NEEDS">Special Needs</option>
                    <option value="ANIMAL">Animal</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>

              <Field label="Gender" required errorText="This field is required">
                <NativeSelectRoot disabled={disabled}>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Gender"
                    px={2}
                    name="gender"
                    onChange={(e) => handleSelectChange("gender", e.target.value)}
                    value={formData.gender || ""}
                    _disabled={undefined}
                  >
                    <option value="Boy">Boy</option>
                    <option value="Girl">Girl</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>

              <Field
                label="Birth Date (Optional)"
                helperText="Leave blank if unknown. Mark as estimated if it is a best guess."
              >
                <Input
                  name="birth_date"
                  type="date"
                  className={`border ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                  px={2}
                  onChange={handleInputChange}
                  value={formData.birth_date || ""}
                  disabled={false}
                />
                <Checkbox
                  className="mt-2"
                  checked={birthDateIsEstimate}
                  onCheckedChange={(checked) =>
                    updateMetadataField("birth_date_is_estimate", Boolean(checked))
                  }
                  onClick={toggleBirthDateEstimate}
                  disabled={disabled}
                  colorPalette="blue"
                >
                  Birth date is estimated
                </Checkbox>
              </Field>

              <Field
                label="Biography"
                required
                errorText="This field is required"
                helperText="Provide a detailed description about the child"
              >
                {!showBiographyComparison && (
                  <Textarea
                    name="biography"
                    size="xl"
                    rows={12}
                    className={`border ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                    px={2}
                    py={2}
                    onChange={handleInputChange}
                    value={formData.biography || ""}
                    disabled={disabled}
                  />
                )}
                <ProofreadButton
                  text={formData.biography || ""}
                  disabled={disabled}
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
                  type="biography"
                  onShowComparison={setShowBiographyComparison}
                />
              </Field>

              {/* Budget Goal / Sponsorship Amount */}
              {formData.beneficiary_type === "SPECIAL_NEEDS" ? (
                // Special Needs: no budget goal — show monthly contribution as read-only
                <Field
                  label="Monthly Contribution"
                  helperText="Special Needs beneficiaries have no fixed budget goal — this is the monthly sponsorship amount"
                >
                  <Input
                    name="budget_goal"
                    type="text"
                    className="border bg-gray-100"
                    px={2}
                    value={typeDefaultCents ? `$${(typeDefaultCents / 100).toFixed(2)}/mo` : "N/A"}
                    readOnly
                    disabled
                  />
                </Field>
              ) : publicHardcodedCents === null && typeDefaultCents === null ? (
                // No env override AND no per-type default → free-form editable field
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
                    className={`border ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                    px={2}
                    onChange={handleInputChange}
                    value={formData.budget_goal || ""}
                    disabled={disabled}
                  />
                </Field>
              ) : (
                // Env override OR per-type default → read-only display
                <Field
                  label="Sponsorship Amount"
                  helperText="Default for this beneficiary type"
                >
                  <Input
                    name="budget_goal"
                    type="text"
                    className="border bg-gray-100"
                    px={2}
                    value={`$${(effectiveAmountCents / 100).toFixed(2)}`}
                    readOnly
                    disabled
                  />
                </Field>
              )}

              {/* Status */}
              <Field label="Status" required errorText="This field is required">
                <NativeSelectRoot disabled={disabled}>
                  <NativeSelectField
                    className={`border ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                    px={2}
                    name="status"
                    onChange={(e) => handleSelectChange("status", e.target.value)}
                    value={formData.status || "New"}
                    _disabled={undefined}
                  >
                    <option value="New">New</option>
                    <option value="Partially Funded">Partially Funded</option>
                    <option value="Budget Fulfilled">Budget Fulfilled</option>
                    <option value="Archived">Archived</option>
                    <option value="Draft">Draft</option>
                    <option value="Sponsorship Cancelled">Sponsorship Cancelled</option>
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
                            src={generatePublicUrl(image as unknown as MediaRow)}
                            alt={`Child's photo ${index + 1}`}
                            width={200}
                            height={200}
                            objectFit="cover"
                            className="rounded-xl"
                          />
                          <button
                            onClick={() => handleDeleteImage(image.id)}
                            className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                            disabled={false}
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
                      key={`image-upload-${imageUploadKey}`}
                      gap="1"
                      maxWidth="100%"
                      onFileChange={handleImageChange}
                      accept={["image/*"]}
                      maxFiles={5}
                      disabled={false}
                    >
                      <FileUpload.HiddenInput 
                        accept="image/*"
                      />
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
                            <Text as="span" className="truncate text-left w-full">
                              {selectedFilesLabel}
                            </Text>
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
                                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                    disabled={disabled}
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
                    <FileUpload.Root
                      key={`image-upload-${imageUploadKey}`}
                      gap="1"
                      maxWidth="100%"
                      onFileChange={handleImageChange}
                      accept={["image/*"]}
                      maxFiles={5}
                      disabled={disabled}
                    >
                      <FileUpload.HiddenInput 
                        disabled={disabled}
                        accept="image/*"
                      />
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
                            <Text as="span" className="truncate text-left w-full">
                              {selectedFilesLabel}
                            </Text>
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
                                    className="absolute top-2 right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                                    disabled={disabled}
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
                  )}
                </div>
              </Field>

              {/* Video */}
              <Field label={isEditMode ? "Change Video" : ""}>
                <div className="space-y-4">
                  {isCreateMode ? (
                    <FileUpload.Root
                      key={`video-upload-${videoUploadKey}`}
                      gap="1"
                      maxWidth="100%"
                      onFileChange={handleVideoChange}
                      accept={["video/mp4"]}
                      disabled={disabled}
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
                              onClick={resetVideoUploadInput}
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
                              onClick={resetVideoUploadInput}
                            />
                          </FileUpload.ClearTrigger>
                        </div>
                      )}
                    </FileUpload.Root>
                  ) : (
                    <FileUpload.Root
                      key={`video-upload-${videoUploadKey}`}
                      gap="1"
                      maxWidth="100%"
                      onFileChange={handleVideoChange}
                      accept={["video/mp4"]}
                      disabled={disabled}
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
                              onClick={resetVideoUploadInput}
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

                      {currentVideoPreview && (
                        <div className="relative group mt-4">
                          <video width="200" height="200" controls>
                            <source src={currentVideoPreview} type="video/mp4" />
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
                              onClick={resetVideoUploadInput}
                            />
                          </FileUpload.ClearTrigger>
                        </div>
                      )}
                    </FileUpload.Root>
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
                <div>
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
                </div>

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

        <DialogFooter className={`flex justify-end gap-3 p-6 pt-2 flex-none transition-opacity duration-200 ${contentDimClass}`}>
          <Button
            className="bg-gray-500 text-white hover:bg-gray-600 disabled:opacity-50"
            onClick={handleCancel}
            disabled={isSaving || disabled}
          >
            Cancel
          </Button>

          {isEditMode && (
            <Button
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={isDeleting || isSaving || disabled}
            >
              Delete
            </Button>
          )}

          <Button
            type="button"
            onClick={handleFormSubmit}
            className="bg-[#1C3C8C] text-white disabled:opacity-50"
            disabled={isSaving || disabled}
            loading={isSaving}
            loadingText={isCreateMode ? "Adding..." : "Saving..."}
          >
            {isSaving
              ? isCreateMode
                ? "Adding..."
                : "Saving..."
              : isCreateMode
                ? "Add Beneficiary"
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
    </>
  )
}

export default BeneficiaryModal

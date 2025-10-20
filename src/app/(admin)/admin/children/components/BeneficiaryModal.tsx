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
import { LuFileUp } from "react-icons/lu"
import { HiUpload, HiX } from "react-icons/hi"
import {
  FileUploadRoot,
  FileUploadTrigger,
} from "@/components/ui/file-upload"
import MapPicker from "./MapPicker"
import ActivitiesTable from "../../activities/components/ActivitiesTable"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"
import { toaster } from "@/components/ui/toaster"
import { dollarsToCents } from "@/utils/currency"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"
import {
  uploadImagesForTransformation,
  getTransformedImageUrl,
  type ImageTransformOptions,
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

  // Handle modal close with confirmation
  const handleModalCloseWithConfirmation = () => {
    if (hasUnsavedChanges) {
      const confirmClose = window.confirm(
        "You have unsaved changes. Are you sure you want to close?"
      )
      if (!confirmClose) return
    }
    setHasUnsavedChanges(false)
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
  }) => {
    if (fileDetails.acceptedFiles.length === 0) return

    if (isCreateMode) {
      setIsProcessingImages(true)
      try {
        const uploadedPaths = await uploadImagesForTransformation(
          "media",
          fileDetails.acceptedFiles
        )
        const transformOptions: ImageTransformOptions = {
          width: 400,
          height: 400,
          resize: "contain",
          quality: 80,
        }
        const transformedUrls = uploadedPaths.map((path) =>
          getTransformedImageUrl("media", path, transformOptions)
        )
        setImageFiles(fileDetails.acceptedFiles)
        setProcessedImages(fileDetails.acceptedFiles)
        setUploadedImagePaths(uploadedPaths)
        setImagePreviewUrls(transformedUrls)
        toaster.create({
          title: "Images Uploaded & Optimized",
          description: `${uploadedPaths.length} images uploaded and transformed by Supabase`,
          type: "success",
          duration: 3000,
        })
      } catch (error) {
        console.error("Error processing images:", error)
        toaster.create({
          title: "Upload Error",
          description: "Failed to upload images to Supabase. Please try again.",
          type: "error",
          duration: 5000,
        })
        const previewUrls = fileDetails.acceptedFiles.map((file) =>
          URL.createObjectURL(file)
        )
        setImagePreviewUrls(previewUrls)
        setImageFiles(fileDetails.acceptedFiles)
      } finally {
        setIsProcessingImages(false)
      }
    } else {
      setImageFiles(fileDetails.acceptedFiles)
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
      setImageFiles([])
      toaster.create({
        title: "Success",
        description: "Image deleted successfully",
        duration: 3000,
      })
    } catch {
      toaster.create({
        title: "Error",
        description: "Failed to delete image",
        duration: 3000,
      })
    } finally {
      setIsImageLoading(false)
    }
  }

  // Submit handler
  const handleFormSubmit = async () => {
    const baseRequired = [
      "name",
      "username",
      "gender",
      "birth_date",
      "biography",
      "introduction",
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
        // Create mode
        if (publicHardcodedCents !== null) {
          const dollars = publicHardcodedCents / 100
          setExternalFormData({ ...(formData || {}), budget_goal: dollars })
        }

        const success = await handleSubmit()
        if (!success) return

        // Clean up
        imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url))
        if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl)
        setHasUnsavedChanges(false)
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

        // Handle image uploads
        if (imageFiles.length > 0) {
          try {
            const formData = new FormData()
            formData.append("beneficiaryId", selectedChild?.id || "")
            imageFiles.forEach((f) => formData.append("images", f))

            const response = await fetch(
              "/api/admin/beneficiaries/images/create",
              { method: "POST", body: formData }
            )
            if (!response.ok) throw new Error("Image upload failed")
            setImageFiles([])
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
        if (!open) handleModalCloseWithConfirmation()
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
            onClick={handleModalCloseWithConfirmation}
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
                label="Username"
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
                label="Birth Day"
                required
                errorText="This field is required"
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
              </Field>

              <Field
                label="Introduction"
                required
                errorText="This field is required"
              >
                <Textarea
                  name="introduction"
                  size="xl"
                  className="border"
                  px={2}
                  py={2}
                  onChange={handleInputChange}
                  value={formData.introduction || ""}
                />
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
                    type={isCreateMode ? "text" : "number"}
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
                    className={`border ${isCreateMode ? "bg-gray-100" : ""}`}
                    px={2}
                    name="status"
                    onChange={(e) => handleSelectChange("status", e.target.value)}
                    value={formData.status || "New"}
                    _disabled={isCreateMode ? { opacity: 0.6, cursor: "not-allowed" } : undefined}
                    {...(isCreateMode ? { disabled: true } : {})}
                  >
                    <option value="New">New</option>
                    {isEditMode && (
                      <>
                        <option value="Partially Funded">Partially Funded</option>
                        <option value="Budget Filled">Budget Filled</option>
                        <option value="Archived">Archived</option>
                        <option value="Draft">Draft</option>
                      </>
                    )}
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
                      accept={["image/*"]}
                      maxFiles={5}
                    >
                      <FileUpload.HiddenInput />
                      <FileUpload.Label>
                        {isProcessingImages
                          ? "Uploading & Optimizing Images..."
                          : "Upload Images (Auto-Optimized)"}
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

                      {isProcessingImages && (
                        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <Text fontSize="sm" color="blue.600" textAlign="center">
                            🔄 Uploading to Supabase and applying transformations...
                          </Text>
                        </div>
                      )}

                      {imagePreviewUrls.length > 0 && (
                        <div className="mt-4">
                          <Text fontSize="sm" color="gray.600" mb={2}>
                            Optimized Images via Supabase ({processedImages.length}):
                          </Text>
                          <div className="flex flex-wrap gap-4">
                            {imagePreviewUrls.map((url, index) => {
                              const file = processedImages[index]
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
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </FileUpload.Root>
                  ) : (
                    <FileUploadRoot
                      onFileChange={handleImageChange}
                      accept={["image/*"]}
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

              <Field label="Country" required errorText="This field is required">
                <Input
                  name="country"
                  className="border"
                  px={2}
                  value={formData.country || ""}
                  placeholder="Enter country name"
                  disabled
                />
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
            onClick={handleModalCloseWithConfirmation}
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


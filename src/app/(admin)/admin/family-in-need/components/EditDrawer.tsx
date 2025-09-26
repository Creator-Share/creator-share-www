"use client"
import React, { useEffect, useState, useCallback } from "react"
import {
  DrawerActionTrigger,
  DrawerBackdrop,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerRoot,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Text, Fieldset, Input, Stack, Textarea, Image } from "@chakra-ui/react"
import { Field } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import {
  NativeSelectField,
  NativeSelectRoot,
} from "@/components/ui/native-select"
import {
  FileUploadList,
  FileUploadRoot,
  FileUploadTrigger,
} from "@/components/ui/file-upload"
import MapPicker from "./MapPicker"
import { Beneficiaries, BeneficiaryMedia } from "@/types/admin.types"
import { toaster } from "@/components/ui/toaster"
import { dollarsToCents } from "@/utils/currency"
import { HiUpload, HiX } from "react-icons/hi"
import ActivitiesTable from "../../activities/components/ActivitiesTable"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"

interface EditDrawerProps {
  selectedBeneficiary: Beneficiaries | null
  formDataEdit: Partial<Beneficiaries>
  setFormDataEdit: React.Dispatch<React.SetStateAction<Partial<Beneficiaries>>>
  isDrawerOpen: boolean
  onClose: () => void
  onSave: (updated: Partial<Beneficiaries>) => void
  onDelete: (beneficiaryId: string) => Promise<void>
  imageFiles: File[]
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>
  videoFiles: File[]
  setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>
  onImagesUpdate?: () => void
}

const EditDrawer: React.FC<EditDrawerProps> = ({
  selectedBeneficiary,
  isDrawerOpen,
  imageFiles,
  videoFiles,
  onClose,
  onSave,
  onDelete,
  setImageFiles,
  setVideoFiles,
}) => {
  const [formDataEdit, setFormDataEdit] = useState<Beneficiaries>(
    selectedBeneficiary || {
      id: "",
      name: "",
      username: "",
      biography: "",
      budget_goal: 0,
      budget_raised: 0,
      status: "New",
      country: "",
      location_geo: null,
      location_str: "",
      video_url: "",
      introduction: "",
      active_subscriptions: 0,
      metadata: {},
      beneficiary_type: "FAMILY",
    },
  )
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [allImages, setAllImages] = useState<BeneficiaryMedia[]>([])
  const [isImageLoading, setIsImageLoading] = useState(false)

  // Legacy direct upload helper removed — uploads now go through server endpoints (/api/admin/beneficiaries/*)

  useEffect(() => {
    if (selectedBeneficiary) {
      // Convert budget_goal from cents to dollars for display
      const formattedData = {
        ...selectedBeneficiary,
        budget_goal: selectedBeneficiary.budget_goal
          ? selectedBeneficiary.budget_goal / 100
          : 0,
      }
      setFormDataEdit(formattedData)
      setVideoUrl(selectedBeneficiary.video_url || null)
    }
  }, [selectedBeneficiary])

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target
    setFormDataEdit((prev: Beneficiaries) => ({ ...prev, [name]: value }))
  }

  const handleSelectChange = (name: string, value: string) => {
    setFormDataEdit((prev: Beneficiaries) => ({ ...prev, [name]: value }))
  }

  const handleSave = async () => {
    const requiredFields = [
      "name",
      "username",
      "biography",
      "introduction",
      "budget_goal",
      "status",
      "country",
    ] as const
    const emptyFields = requiredFields.filter(
      (field) => !formDataEdit[field as keyof Beneficiaries],
    )

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
      const updatedData = { ...formDataEdit }
      const budgetGoalInCents = parseInt(
        dollarsToCents(formDataEdit.budget_goal || 0),
      )
      if (imageFiles.length > 0) {
        try {
          const formData = new FormData()
          formData.append("beneficiaryId", selectedBeneficiary?.id || "")
          imageFiles.forEach((f) => formData.append("images", f))

          const response = await fetch(
            "/api/admin/beneficiaries/images/create",
            {
              method: "POST",
              body: formData,
            },
          )

          if (!response.ok) {
            console.error(
              "Beneficiary images upload error: server responded with",
              response.status,
            )
            throw new Error("Image upload failed")
          }

          await fetchImages()
          setImageFiles([])
        } catch (err) {
          console.error("Error uploading images:", err)
          toaster.create({
            title: "Error",
            description: "Failed to upload images",
            duration: 5000,
          })
        }
      }

      if (videoFiles.length > 0) {
        try {
          const formData = new FormData()
          formData.append("beneficiaryId", selectedBeneficiary?.id || "")
          formData.append("video", videoFiles[0])

          const response = await fetch(
            "/api/admin/beneficiaries/video/create",
            {
              method: "POST",
              body: formData,
            },
          )

          if (!response.ok) {
            console.error(
              "Beneficiary video upload error: server responded with",
              response.status,
            )
            throw new Error("Video upload failed")
          }

          const data = await response.json()
          if (data?.public_url) {
            updatedData.video_url = data.public_url
            setVideoUrl(data.public_url)
          }
        } catch (err) {
          console.error("Error uploading video:", err)
          toaster.create({
            title: "Error",
            description: "Failed to upload video",
            duration: 5000,
          })
        }
      }

      await onSave({
        ...updatedData,
        budget_goal: budgetGoalInCents,
      })
    } catch (error) {
      console.error("Error saving:", error)
      toaster.create({
        title: "Error",
        description: "Failed to save changes",
        duration: 5000,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleLocationSelect = (
    geo: [number, number],
    locationStr: string,
    country: string,
  ) => {
    setFormDataEdit((prev: Beneficiaries) => ({
      ...prev,
      location_geo: { type: "Point", coordinates: [geo[1], geo[0]] },
      location_str: locationStr,
      country: country,
    }))
  }

  const fetchImages = useCallback(async () => {
    if (selectedBeneficiary?.id) {
      const response = await fetch(
        `/api/admin/beneficiaries/images/${selectedBeneficiary.id}`,
      )
      if (response.ok) {
        const images = await response.json()
        setAllImages(images)
      }
    }
  }, [selectedBeneficiary?.id])

  useEffect(() => {
    fetchImages()
  }, [selectedBeneficiary?.id, fetchImages])

  const handleDeleteImage = async (imageId: string) => {
    try {
      setIsImageLoading(true)
      const response = await fetch("/api/admin/beneficiaries/images/delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
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
      console.error("Error deleting image:", error)
      toaster.create({
        title: "Error",
        description: "Failed to delete image",
        duration: 3000,
      })
    } finally {
      setIsImageLoading(false)
    }
  }

  if (!selectedBeneficiary) return null

  return (
    <DrawerRoot
      placement="start"
      size="full"
      open={isDrawerOpen}
      onOpenChange={onClose}
    >
      <DrawerBackdrop />
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Text fontSize="5xl"> Edit Family in Need </Text>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <Fieldset.Root size="lg">
            <Stack>
              <Fieldset.Legend>Family in Need details</Fieldset.Legend>
              <Fieldset.HelperText>
                Please provide family in need details below.
              </Fieldset.HelperText>
            </Stack>
            <Fieldset.Content>
              <Field label="Name" required errorText="This field is required">
                <Input
                  name="name"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formDataEdit?.name || ""}
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
                  value={formDataEdit?.username || ""}
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
                  value={formDataEdit.biography || ""}
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
                  value={formDataEdit.introduction || ""}
                />
              </Field>
              <Field
                label="Budget Goal"
                required
                errorText="This field is required"
              >
                <Input
                  name="budget_goal"
                  type="number"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formDataEdit.budget_goal || ""}
                />
              </Field>
              <Field label="Status" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Status"
                    px={2}
                    name="status"
                    onChange={(e) =>
                      handleSelectChange("status", e.target.value)
                    }
                    value={formDataEdit.status || ""}
                  >
                    <option value="New">New</option>
                    <option value="Partially Funded">Partially Funded</option>
                    <option value="Budget Filled">Budget Filled</option>
                    <option value="Archived">Archived</option>
                    <option value="Draft">Draft</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              <Field label="Manage Images">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-4">
                    {allImages.map((image, index) => (
                      <div key={image.id} className="relative group">
                        <Image
                          src={
                            image.id
                              ? generatePublicUrl(image as unknown as MediaRow)
                              : image.image_url
                          }
                          alt={`Family in Need's photo ${index + 1}`}
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

                  <FileUploadRoot
                    onFileChange={(fileDetails) => {
                      setImageFiles(fileDetails.acceptedFiles)
                    }}
                    accept={["image/*"]}
                    maxFiles={5}
                  >
                    <FileUploadTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border"
                        px={4}
                      >
                        <HiUpload />{" "}
                        {allImages.length === 0
                          ? "Upload Images"
                          : "Add More Images"}
                      </Button>
                    </FileUploadTrigger>
                    <FileUploadList />
                  </FileUploadRoot>
                </div>
              </Field>
              <Field label="Change Video">
                <FileUploadRoot
                  onFileChange={(fileDetails) =>
                    setVideoFiles(fileDetails.acceptedFiles)
                  }
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
                  <FileUploadList />
                </FileUploadRoot>
              </Field>
              <MapPicker
                onSelectLocation={handleLocationSelect}
                initialLocation={
                  selectedBeneficiary && selectedBeneficiary.location_geo
                    ? {
                        coordinates: [
                          selectedBeneficiary.location_geo.coordinates[1],
                          selectedBeneficiary.location_geo.coordinates[0],
                        ],
                        locationStr: selectedBeneficiary.location_str,
                        country: selectedBeneficiary.country,
                      }
                    : undefined
                }
              />
            </Fieldset.Content>
          </Fieldset.Root>
          {selectedBeneficiary?.id && (
            <div className="mt-8">
              <ActivitiesTable
                beneficiaryType="FAMILY"
                beneficiaryId={selectedBeneficiary.id}
              />
            </div>
          )}
        </DrawerBody>

        <DrawerFooter>
          <DrawerActionTrigger asChild>
            <Button
              className="bg-black w-[29.5%] text-white"
              onClick={onClose}
              disabled={isDeleting || isSaving}
            >
              Cancel
            </Button>
          </DrawerActionTrigger>
          <Button
            className="bg-red-500 w-1/3 text-white"
            onClick={async () => {
              if (selectedBeneficiary?.id) {
                try {
                  setIsDeleting(true)
                  await onDelete(selectedBeneficiary.id)
                  onClose()
                } catch (error) {
                  console.error("Error deleting:", error)
                } finally {
                  setIsDeleting(false)
                }
              } else {
                console.error("Beneficiary ID is undefined")
              }
            }}
            disabled={isDeleting || isSaving}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
          <Button
            onClick={handleSave}
            className="bg-[#1C3C8C] w-1/3 text-white"
            loading={isSaving}
            loadingText="Saving..."
            disabled={isDeleting}
          >
            Save
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  )
}

export default EditDrawer

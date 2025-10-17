"use client"
import React, { useState } from "react"
import {
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerActionTrigger,
  DrawerRoot,
  DrawerBackdrop
} from "@/components/ui/drawer"
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
// import ExpenseManager from "./ExpenseManager";
import MapPicker from "./MapPicker"
import { Beneficiaries } from "@/types/admin.types"
import { toaster } from "@/components/ui/toaster"
import { 
  uploadImagesForTransformation, 
  getTransformedImageUrl,
  type ImageTransformOptions 
} from "@/utils/supabase/imageTransform"

type CreateDrawerProps = {
  formData: Partial<Beneficiaries>
  isDrawerOpen: boolean
  setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFormData: React.Dispatch<React.SetStateAction<Partial<Beneficiaries>>>
  handleInputChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void
  handleSelectChange: (name: keyof Beneficiaries, value: string) => void
  handleLocationSelect: (
    geo: [number, number],
    locationStr: string,
    country: string,
  ) => void
  handleSubmit: () => Promise<boolean>
  imageFiles: File[]
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>
  videoFiles: File[]
  setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>
  handleDrawerClose: () => void
}
const CreateDrawer = ({
  formData,
  setFormData,
  setVideoFiles,
  setIsDrawerOpen,
  isDrawerOpen,
  handleInputChange,
  handleSelectChange,
  handleLocationSelect,
  handleSubmit,
  setImageFiles,
  handleDrawerClose
}: CreateDrawerProps) => {
  const [isAdding, setIsAdding] = useState(false)
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null)
  const [processedImages, setProcessedImages] = useState<File[]>([])
  const [, setUploadedImagePaths] = useState<string[]>([])
  const [isProcessingImages, setIsProcessingImages] = useState(false)

  // Use environment variable for sponsorship amount
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const publicHardcodedCents = publicHardcodedRaw
    ? parseInt(publicHardcodedRaw, 10)
    : null


  const handleImageChange = async (fileDetails: { acceptedFiles: File[] }) => {
    if (fileDetails.acceptedFiles.length === 0) return

    setIsProcessingImages(true)
    
    try {
      // Upload images to Supabase for transformation using utility function
      const uploadedPaths = await uploadImagesForTransformation('media', fileDetails.acceptedFiles)
      
      // Generate transformed URLs using Supabase Image Transformation API
      const transformOptions: ImageTransformOptions = {
        width: 400,
        height: 400,
        resize: 'contain',
        quality: 80
        // Note: Supabase automatically optimizes to WebP when supported by the browser
      }
      
      const transformedUrls = uploadedPaths.map(path => 
        getTransformedImageUrl('media', path, transformOptions)
      )

      // Store original files, paths, and transformed URLs
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
      console.error('Error processing images:', error)
      toaster.create({
        title: "Upload Error",
        description: "Failed to upload images to Supabase. Please try again.",
        type: "error",
        duration: 5000,
      })
      
      // Fallback to local preview URLs
      const previewUrls = fileDetails.acceptedFiles.map((file) =>
        URL.createObjectURL(file),
      )
      setImagePreviewUrls(previewUrls)
      setImageFiles(fileDetails.acceptedFiles)
    } finally {
      setIsProcessingImages(false)
    }
  }

  const handleVideoChange = (fileDetails: { acceptedFiles: File[] }) => {
    setVideoFiles(fileDetails.acceptedFiles)

    // Create preview URL for video
    if (fileDetails.acceptedFiles.length > 0) {
      setVideoPreviewUrl(URL.createObjectURL(fileDetails.acceptedFiles[0]))
    }
  }

  const handleAdd = async () => {
    // Use environment variable for sponsorship amount
    const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
    const publicHardcodedCents = publicHardcodedRaw
      ? parseInt(publicHardcodedRaw, 10)
      : null

    // If public hardcoded goal is set, budget_goal is not required in the form.
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
      setIsAdding(true)

      // If the public hardcoded goal is present, set the form value to that goal (in dollars)
      if (publicHardcodedCents !== null) {
        const dollars = publicHardcodedCents / 100
        setFormData({ ...(formData || {}), budget_goal: dollars })
      }

      // Create the beneficiary first
      const success = await handleSubmit()
      if (!success) {
        return
      }

      // Clean up preview URLs
      imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url))
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl)
      handleDrawerClose()
    } catch (error) {
      console.error("Error adding:", error)
      toaster.create({
        title: "Error",
        description: "Failed to add child",
        duration: 5000,
      })
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <DrawerRoot
      placement="start"
      size="lg"
      open={isDrawerOpen}
      onOpenChange={({ open }) => {
        setIsDrawerOpen(open)
      }}
    >
      <DrawerBackdrop />
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Text fontSize="5xl"> Add a Child </Text>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
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
                />
              </Field>
              <Field label="Gender" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Gender"
                    px={2}
                    name="gender"
                    onChange={(e) =>
                      handleSelectChange("gender", e.target.value)
                    }
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
                />
              </Field>

              {/* Hide budget_goal input when public hardcoded sponsorship goal is set */}
              {publicHardcodedCents === null && (
                <Field
                  label="Budget Goal"
                  required
                  errorText="This field is required"
                >
                  <Input
                    name="budget_goal"
                    type="text"
                    className="border"
                    px={2}
                    onChange={handleInputChange}
                  />
                </Field>
              )}

              {/* Show fixed sponsorship amount when ENV is set */}
              {publicHardcodedCents !== null && (
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

              <Field label="Status" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border bg-gray-100"
                    px={2}
                    name="status"
                    defaultValue="New"
                    _disabled={{
                      opacity: 0.6,
                      cursor: "not-allowed",
                    }}
                  >
                    <option value="New">New</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              <Field>
                <div className="space-y-4">
                  <FileUpload.Root
                    gap="1"
                    maxWidth="100%"
                    onFileChange={handleImageChange}
                    accept={["image/*"]}
                    maxFiles={5}
                  >
                    <FileUpload.HiddenInput />
                    <FileUpload.Label>
                      {isProcessingImages ? "Uploading & Optimizing Images..." : "Upload Images (Auto-Optimized)"}
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

                    {/* Processing Indicator */}
                    {isProcessingImages && (
                      <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <Text fontSize="sm" color="blue.600" textAlign="center">
                          🔄 Uploading to Supabase and applying transformations... This may take a moment.
                        </Text>
                      </div>
                    )}

                    {/* Image Previews */}
                    {imagePreviewUrls.length > 0 && (
                      <div className="mt-4">
                        <Text fontSize="sm" color="gray.600" mb={2}>
                          Optimized Images via Supabase ({processedImages.length}):
                        </Text>
                        <div className="flex flex-wrap gap-4">
                          {imagePreviewUrls.map((url, index) => {
                            const file = processedImages[index]
                            const fileSizeKB = file ? Math.round(file.size / 1024) : 0
                            
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
                </div>
              </Field>
              <Field>
                <div className="space-y-4">
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

                    {/* Video Preview */}
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
                </div>
              </Field>
              <MapPicker onSelectLocation={handleLocationSelect} />
              <Field
                label="Country"
                required
                errorText="This field is required"
              >
                <Input
                  name="country"
                  className="border"
                  px={2}
                  defaultValue={formData.country || ""}
                  placeholder="Enter country name"
                  disabled
                />
              </Field>
              {/* Expense Management Section */}
              {/* <div className="mt-6">
                                <ExpenseManager
                                    budgetGoal={publicHardcodedCents !== null ? publicHardcodedCents : (formData.budget_goal ? Number(formData.budget_goal) * 100 : 0)}
                                />
                            </div> */}
            </Fieldset.Content>
          </Fieldset.Root>
        </DrawerBody>
        <DrawerFooter>
          <DrawerActionTrigger asChild>
            <Button
              className="bg-black w-1/2 text-white"
              onClick={handleDrawerClose}
              disabled={isAdding}
            >
              Cancel
            </Button>
          </DrawerActionTrigger>
          <Button
            type="button"
            onClick={handleAdd}
            className="bg-[#1C3C8C] w-1/2 text-white disabled:opacity-50"
            disabled={isAdding}
            loading={isAdding}
            loadingText="Adding..."
          >
            {isAdding ? "Adding..." : "Add"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  )
}

export default CreateDrawer

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
  DrawerBackdrop,
  DrawerTrigger,
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
import { GoPlusCircle } from "react-icons/go"
import { toaster } from "@/components/ui/toaster"

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
  handleDrawerClose,
}: CreateDrawerProps) => {
  const [isAdding, setIsAdding] = useState(false)
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null)

  // Read optional public sponsorship goal (cents). If set, the budget_goal field in the drawer
  // should be hidden and the value will be hardcoded on submission.
  const publicHardcodedRaw = process.env.NEXT_PUBLIC_SPONSORSHIP_GOAL
  const publicHardcodedCents = publicHardcodedRaw
    ? parseInt(publicHardcodedRaw, 10)
    : null

  const handleImageChange = (fileDetails: { acceptedFiles: File[] }) => {
    setImageFiles(fileDetails.acceptedFiles)

    // Create preview URLs for images
    const previewUrls = fileDetails.acceptedFiles.map((file) =>
      URL.createObjectURL(file),
    )
    setImagePreviewUrls(previewUrls)
  }

  const handleVideoChange = (fileDetails: { acceptedFiles: File[] }) => {
    setVideoFiles(fileDetails.acceptedFiles)

    // Create preview URL for video
    if (fileDetails.acceptedFiles.length > 0) {
      setVideoPreviewUrl(URL.createObjectURL(fileDetails.acceptedFiles[0]))
    }
  }

  const handleAdd = async () => {
    // Read optional public hardcoded sponsorship goal (cents) if set
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
        // Overwrite formData.budget_goal with hardcoded value (in dollars)
        setFormData({ ...(formData || {}), budget_goal: dollars })
      }

      const success = await handleSubmit()
      if (success) {
        // Clean up preview URLs
        imagePreviewUrls.forEach((url) => URL.revokeObjectURL(url))
        if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl)
        handleDrawerClose()
      }
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
      <DrawerTrigger asChild>
        <Button className="border-[2px] border-[#E0E0E0] rounded-md w-fit h-[40px] px-10 bg-[#1C3C8C] text-white">
          <GoPlusCircle className="mr-[3.5px]" /> List A Child
        </Button>
      </DrawerTrigger>
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
                    value={formData.status || ""}
                  >
                    <option value="New">New</option>
                    <option value="Partially Funded">Partially Funded</option>
                    <option value="Budget Fulfilled">Budget Fulfilled</option>
                    <option value="Archived">Archived</option>
                    <option value="Draft">Draft</option>
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
                    <FileUpload.Label>Upload Images</FileUpload.Label>
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

                    {/* Image Previews */}
                    <div className="flex flex-wrap gap-4 mt-4">
                      {imagePreviewUrls.map((url, index) => (
                        <div key={index} className="relative group">
                          <Image
                            src={url}
                            alt={`Preview ${index + 1}`}
                            width={200}
                            height={200}
                            objectFit="cover"
                            className="rounded-xl border-2 border-gray-200"
                          />
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
                      ))}
                    </div>
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
                  onChange={handleInputChange}
                  value={formData.country || ""}
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

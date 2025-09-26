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
import { Text, Fieldset, Input, Stack, Textarea } from "@chakra-ui/react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import {
  NativeSelectField,
  NativeSelectRoot,
} from "@/components/ui/native-select"
import { GoPlusCircle } from "react-icons/go"
import { toaster } from "@/components/ui/toaster"
import {
  FileUploadList,
  FileUploadRoot,
  FileUploadTrigger,
} from "@/components/ui/file-upload"
import { HiUpload } from "react-icons/hi"

import { AnimalBeneficiary } from "@/types/admin.types"

type CreateDrawerProps = {
  formData: AnimalBeneficiary
  isDrawerOpen: boolean
  setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>
  setFormData: React.Dispatch<React.SetStateAction<AnimalBeneficiary>>
  handleInputChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void
  handleSelectChange: (name: string, value: string) => void
  handleSubmit: (data: AnimalBeneficiary) => Promise<boolean>
  handleDrawerClose: () => void
  imageFiles: File[]
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>
  videoFiles: File[]
  setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>
}

const animalTypes = ["Puppy", "Kitten", "Dog", "Cat"] // Replace with your enums

const CreateDrawer = ({
  formData,
  setIsDrawerOpen,
  isDrawerOpen,
  handleInputChange,
  handleSelectChange,
  handleSubmit,
  handleDrawerClose,
  setImageFiles,
  setVideoFiles,
}: CreateDrawerProps) => {
  const [isAdding, setIsAdding] = useState(false)

  // Custom metadata fields state
  const [customFields, setCustomFields] = useState<
    { key: string; value: string }[]
  >([])

  // Add a new custom field
  const handleAddField = () => {
    setCustomFields([...customFields, { key: "", value: "" }])
  }

  // Update a custom field
  const handleCustomFieldChange = (
    idx: number,
    field: "key" | "value",
    val: string,
  ) => {
    setCustomFields((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, [field]: val } : item)),
    )
  }

  // Remove a custom field
  const handleRemoveField = (idx: number) => {
    setCustomFields((prev) => prev.filter((_, i) => i !== idx))
  }

  // Merge custom fields into metadata before submit
  const handleAdd = async () => {
    const requiredFields = [
      "name",
      "username",
      "gender",
      "birth_date",
      "biography",
      "introduction",
      "budget_goal",
      "country",
    ] as const

    // Check required metadata fields
    const requiredMetadataFields = ["breed", "animal_type"]
    const emptyMetadataFields = requiredMetadataFields.filter(
      (field) => !formData.metadata?.[field],
    )

    const emptyFields = [
      ...requiredFields.filter((field) => !formData[field]),
      ...emptyMetadataFields,
    ]

    if (emptyFields.length > 0) {
      toaster.create({
        title: "Validation Error",
        description: `Please fill in all required fields: ${emptyFields.join(", ")}`,
        duration: 5000,
      })
      return
    }

    // Prepare the data for submission
    const submitData = {
      ...formData,
      // Let the database generate the UUID
      metadata: {
        ...formData.metadata,
        ...Object.fromEntries(
          customFields
            .map(({ key, value }) => [key, value])
            .filter(([key]) => key),
        ),
      },
    }

    try {
      setIsAdding(true)
      const success = await handleSubmit(submitData)
      if (success) {
        handleDrawerClose()
        setCustomFields([])
      }
    } catch (error) {
      console.error("Error adding:", error)
      const errorMsg = (error as Error)?.message || ""
      if (
        errorMsg.includes("duplicate key value") ||
        errorMsg.toLowerCase().includes("username")
      ) {
        toaster.create({
          title: "Username Error",
          description:
            "This username is already taken. Please choose a different username.",
          duration: 5000,
        })
      } else {
        toaster.create({
          title: "Error",
          description: "Failed to add animal",
          duration: 5000,
        })
      }
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
        <Button className="border-[2px] border-[#E0E0E0] w-fit h-[40px] px-4">
          <GoPlusCircle className="mr-[3.5px]" /> New Animal
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Text fontSize="5xl"> Add an Animal </Text>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <Fieldset.Root size="lg">
            <Stack>
              <Fieldset.Legend>Animal details</Fieldset.Legend>
              <Fieldset.HelperText>
                Please provide animal details below.
              </Fieldset.HelperText>
            </Stack>
            <Fieldset.Content>
              <Field label="Name" required errorText="This field is required">
                <Input
                  name="name"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.name}
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
                  value={formData.username}
                />
              </Field>
              <Field label="Gender" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Gender"
                    px={2}
                    name="gender"
                    value={formData.gender}
                    onChange={(e) =>
                      handleSelectChange("gender", e.target.value)
                    }
                  >
                    <option value="">Select Gender</option>
                    <option value="Boy">Male</option>
                    <option value="Girl">Female</option>
                    <option value="Unknown">Unknown</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              <Field
                label="Birth Date"
                required
                errorText="This field is required"
              >
                <Input
                  name="birth_date"
                  type="date"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.birth_date}
                />
              </Field>
              <Field label="Breed" required errorText="This field is required">
                <Input
                  name="breed"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.metadata?.breed || ""}
                />
              </Field>
              <Field
                label="Animal Type"
                required
                errorText="This field is required"
              >
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Animal Type"
                    px={2}
                    name="animal_type"
                    value={formData.metadata?.animal_type || ""}
                    onChange={(e) =>
                      handleSelectChange("animal_type", e.target.value)
                    }
                  >
                    <option value="">Select Animal Type</option>
                    {animalTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              {/* Custom Metadata Fields */}
              <Field label="Additional Metadata">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mb-2"
                  onClick={handleAddField}
                >
                  + Add Field
                </Button>
                <Stack gap={2}>
                  {customFields.map((field, idx) => (
                    <div
                      key={idx}
                      style={{ display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <Input
                        placeholder="Field Name"
                        value={field.key}
                        onChange={(e) =>
                          handleCustomFieldChange(idx, "key", e.target.value)
                        }
                        className="border"
                        px={2}
                        width="40%"
                      />
                      <Input
                        placeholder="Value"
                        value={field.value}
                        onChange={(e) =>
                          handleCustomFieldChange(idx, "value", e.target.value)
                        }
                        className="border"
                        px={2}
                        width="40%"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        colorScheme="red"
                        onClick={() => handleRemoveField(idx)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </Stack>
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
                  value={formData.biography}
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
                  value={formData.introduction}
                />
              </Field>
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
                  value={formData.budget_goal}
                />
              </Field>
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
                  value={formData.country}
                />
              </Field>
              <Field
                label="Location"
                required
                errorText="This field is required"
              >
                <Input
                  name="location_str"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.location_str}
                />
              </Field>
              <Field label="Upload Image">
                <FileUploadRoot
                  onFileChange={(fileDetails) =>
                    setImageFiles(fileDetails.acceptedFiles)
                  }
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
                      <HiUpload /> Upload Image
                    </Button>
                  </FileUploadTrigger>
                  <FileUploadList />
                </FileUploadRoot>
              </Field>
              <Field label="Upload Video">
                <FileUploadRoot
                  onFileChange={(fileDetails) =>
                    setVideoFiles(fileDetails.acceptedFiles)
                  }
                  accept={["video/mp4"]}
                >
                  <FileUploadTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border"
                      px={4}
                    >
                      <HiUpload /> Upload Video
                    </Button>
                  </FileUploadTrigger>
                  <FileUploadList />
                </FileUploadRoot>
              </Field>
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

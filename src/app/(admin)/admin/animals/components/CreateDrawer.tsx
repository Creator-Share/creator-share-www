"use client";
import React, { useState } from "react";
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
} from "@/components/ui/drawer";
import { Text, Fieldset, Input, Stack, Textarea } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  NativeSelectField,
  NativeSelectRoot,
} from "@/components/ui/native-select";
import { AnimalBeneficiary } from "@/types/admin.types";
import { GoPlusCircle } from "react-icons/go";
import { toaster } from "@/components/ui/toaster";
import {
  FileUploadList,
  FileUploadRoot,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { HiUpload } from "react-icons/hi";

type AnimalFormState = Omit<AnimalBeneficiary, "budget_goal"> & { budget_goal: string };

type CreateDrawerProps = {
  formData: AnimalFormState;
  isDrawerOpen: boolean;
  setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setFormData: React.Dispatch<React.SetStateAction<AnimalFormState>>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSelectChange: (name: keyof AnimalBeneficiary, value: string) => void;
  handleSubmit: () => Promise<boolean>;
  handleDrawerClose: () => void;
  imageFiles: File[];
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
  videoFiles: File[];
  setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>;
};

const animalTypes = ["Puppy", "Kitten", "Dog", "Cat"]; // Replace with your enums

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
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    const requiredFields = [
      "name",
      "username",
      "gender",
      "birth_date",
      "biography",
      "introduction",
      "budget_goal",
      "status",
      "country",
      "breed",
      "animal_type",
    ] as const;
    const emptyFields = requiredFields.filter(
      (field) => !formData[field as keyof AnimalBeneficiary]
    );

    if (emptyFields.length > 0) {
      toaster.create({
        title: "Validation Error",
        description: `Please fill in all required fields: ${emptyFields.join(", ")}`,
        duration: 5000,
      });
      return;
    }

    try {
      setIsAdding(true);
      const success = await handleSubmit();
      if (success) {
        handleDrawerClose();
      }
    } catch (error) {
      console.error("Error adding:", error);
      const errorMsg = (error as Error)?.message || "";
      if (
        errorMsg.includes("duplicate key value") ||
        errorMsg.toLowerCase().includes("username")
      ) {
        toaster.create({
          title: "Username Error",
          description: "This username is already taken. Please choose a different username.",
          duration: 5000,
        });
      } else {
        toaster.create({
          title: "Error",
          description: "Failed to add animal",
          duration: 5000,
        });
      }
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <DrawerRoot
      placement="start"
      size="lg"
      open={isDrawerOpen}
      onOpenChange={({ open }) => {
        setIsDrawerOpen(open);
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
              <Field label="Username" required errorText="This field is required">
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
                    <option value="Female">Female</option>
                    <option value="Unknown">Unknown</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              <Field label="Birth Date" required errorText="This field is required">
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
                  value={formData.breed}
                />
              </Field>
              <Field label="Animal Type" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Animal Type"
                    px={2}
                    name="animal_type"
                    value={formData.animal_type}
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
              <Field label="Biography" required errorText="This field is required">
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
              <Field label="Introduction" required errorText="This field is required">
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
              <Field label="Budget Goal" required errorText="This field is required">
                <Input
                  name="budget_goal"
                  type="text"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.budget_goal}
                />
              </Field>
              <Field label="Status" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Status"
                    px={2}
                    name="status"
                    value={formData.status}
                    onChange={(e) =>
                      handleSelectChange("status", e.target.value)
                    }
                  >
                    <option value="New">New</option>
                    <option value="Partially Funded">Partially Funded</option>
                    <option value="Budget Filled">Budget Filled</option>
                    <option value="Archived">Archived</option>
                    <option value="Draft">Draft</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              <Field label="Country" required errorText="This field is required">
                <Input
                  name="country"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.country}
                />
              </Field>
              <Field label="Location" required errorText="This field is required">
                <Input
                  name="location_str"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formData.location_str}
                />
              </Field>
              <Field label="Upload Image">
                <FileUploadRoot onFileChange={(fileDetails) => setImageFiles(fileDetails.acceptedFiles)} accept={["image/*"]} maxFiles={5}>
                  <FileUploadTrigger asChild>
                    <Button variant="outline" size="sm" className="border" px={4}>
                      <HiUpload /> Upload Image
                    </Button>
                  </FileUploadTrigger>
                  <FileUploadList />
                </FileUploadRoot>
              </Field>
              <Field label="Upload Video">
                <FileUploadRoot onFileChange={(fileDetails) => setVideoFiles(fileDetails.acceptedFiles)} accept={["video/mp4"]}>
                  <FileUploadTrigger asChild>
                    <Button variant="outline" size="sm" className="border" px={4}>
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
  );
};

export default CreateDrawer;

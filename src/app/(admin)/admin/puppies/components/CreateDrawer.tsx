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
import { Text, Fieldset, Input, Stack } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  NativeSelectField,
  NativeSelectRoot,
} from "@/components/ui/native-select";
import {
  FileUploadList,
  FileUploadRoot,
  FileUploadTrigger,
} from "@/components/ui/file-upload";
import { HiUpload } from "react-icons/hi";
import { GoPlusCircle } from "react-icons/go";
import { toaster } from "@/components/ui/toaster";
import { Puppy } from "../columns";

type CreateDrawerProps = {
  formData: Puppy;
  isDrawerOpen: boolean;
  setIsDrawerOpen: (isOpen: boolean) => void;
  setFormData: React.Dispatch<React.SetStateAction<Puppy>>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSelectChange: (name: string, value: string) => void;
  handleSubmit: () => Promise<boolean>;
  imageFiles: File[];
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
  handleDrawerClose: () => void;
}

const CreateDrawer: React.FC<CreateDrawerProps> = ({
  formData,
  isDrawerOpen,
  setIsDrawerOpen,
  handleInputChange,
  handleSelectChange,
  handleSubmit,
  setImageFiles,
  handleDrawerClose
}) => {
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    const requiredFields = ["name", "age", "breed", "status"] as const;
    const emptyFields = requiredFields.filter(
      (field) => !formData[field as keyof Puppy]
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
      toaster.create({
        title: "Error",
        description: "Failed to add puppy",
        duration: 5000,
      });
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
          <GoPlusCircle className="mr-[3.5px]" /> New Puppy
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Text fontSize="5xl">Add a Puppy</Text>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <Fieldset.Root size="lg">
            <Stack>
              <Fieldset.Legend>Puppy details</Fieldset.Legend>
              <Fieldset.HelperText>
                Please provide puppy details below.
              </Fieldset.HelperText>
            </Stack>
            <Fieldset.Content>
              <Field label="Name" required errorText="This field is required">
                <Input
                  name="name"
                  className="border"
                  px={2}
                  value={formData.name}
                  onChange={handleInputChange}
                />
              </Field>
              <Field label="Age" required errorText="This field is required">
                <Input
                  name="age"
                  type="number"
                  className="border"
                  px={2}
                  value={formData.age}
                  onChange={handleInputChange}
                />
              </Field>
              <Field label="Breed" required errorText="This field is required">
                <Input
                  name="breed"
                  className="border"
                  px={2}
                  value={formData.breed}
                  onChange={handleInputChange}
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
                    onChange={(e) => handleSelectChange("status", e.target.value)}
                  >
                    <option value="available">Available</option>
                    <option value="sponsored">Sponsored</option>
                    <option value="unavailable">Unavailable</option>
                  </NativeSelectField>
                </NativeSelectRoot>
              </Field>
              <Field label="Upload Images">
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
                      <HiUpload /> Upload Images
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

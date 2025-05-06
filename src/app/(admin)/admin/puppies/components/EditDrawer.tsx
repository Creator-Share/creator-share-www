"use client";
import React, { useState, useEffect } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerActionTrigger,
  DrawerRoot,
  DrawerBackdrop,
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
import { toaster } from "@/components/ui/toaster";
import { Puppy } from "../columns";

interface EditDrawerProps {
  selectedPuppy: Puppy;
  formData: Puppy;
  setFormData: React.Dispatch<React.SetStateAction<Puppy>>;
  isDrawerOpen: boolean;
  onClose: () => void;
  onSave: (updatedPuppy: Puppy) => Promise<void>;
  onDelete: (puppyId: string) => Promise<void>;
  imageFiles: File[];
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
}

const EditDrawer: React.FC<EditDrawerProps> = ({
  selectedPuppy,
  formData,
  setFormData,
  isDrawerOpen,
  onClose,
  onSave,
  onDelete,
  setImageFiles,
}) => {
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (selectedPuppy) {
      setFormData(selectedPuppy);
    }
  }, [selectedPuppy, setFormData]);

  const handleSave = async () => {
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
      setIsEditing(true);
      await onSave(formData);
      toaster.create({
        title: "Success",
        description: "Puppy updated successfully",
        duration: 5000,
      });
    } catch (error) {
      console.error("Error updating:", error);
      toaster.create({
        title: "Error",
        description: "Failed to update puppy",
        duration: 5000,
      });
    } finally {
      setIsEditing(false);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this puppy?")) {
      try {
        await onDelete(selectedPuppy.id);
        toaster.create({
          title: "Success",
          description: "Puppy deleted successfully",
          duration: 5000,
        });
      } catch (error) {
        console.error("Error deleting:", error);
        toaster.create({
          title: "Error",
          description: "Failed to delete puppy",
          duration: 5000,
        });
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <DrawerRoot open={isDrawerOpen} onOpenChange={({ open }) => !open && onClose()}>
      <DrawerBackdrop />
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Text fontSize="5xl">Edit Puppy</Text>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <Fieldset.Root size="lg">
            <Stack>
              <Fieldset.Legend>Puppy details</Fieldset.Legend>
              <Fieldset.HelperText>
                Update puppy details below.
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
                    onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value as Puppy['status'] }))}
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
              className="bg-black w-1/3 text-white"
              onClick={onClose}
              disabled={isEditing}
            >
              Cancel
            </Button>
          </DrawerActionTrigger>
          <Button
            className="bg-red-500 w-1/3 text-white mx-2"
            onClick={handleDelete}
            disabled={isEditing}
          >
            Delete
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            className="bg-[#1C3C8C] w-1/3 text-white disabled:opacity-50"
            disabled={isEditing}
            loading={isEditing}
            loadingText="Saving..."
          >
            {isEditing ? "Saving..." : "Save"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
};

export default EditDrawer;

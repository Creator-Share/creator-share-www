"use client";
import React, { useState } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerRoot,
  DrawerBackdrop,
} from "@/components/ui/drawer";
import { Text, Fieldset, Input, Stack, Textarea } from "@chakra-ui/react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  NativeSelectField,
  NativeSelectRoot,
} from "@/components/ui/native-select";
import { AnimalBeneficiary } from "@/types/admin.types";

type AnimalFormState = Omit<AnimalBeneficiary, "budget_goal"> & { budget_goal: string };

type EditDrawerProps = {
  formDataEdit: AnimalFormState;
  setFormDataEdit: React.Dispatch<React.SetStateAction<AnimalFormState>>;
  isDrawerOpen: boolean;
  onClose: () => void;
  onSave: (animal: AnimalFormState) => Promise<void>;
  onDelete: (animalId: string) => Promise<void>;
};

const animalTypes = ["Puppy", "Kitten", "Dog", "Cat"];

const EditDrawer = ({
  formDataEdit,
  setFormDataEdit,
  isDrawerOpen,
  onClose,
  onSave,
  onDelete,
}: EditDrawerProps) => {
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Sync local input state with form state when drawer opens or value changes

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormDataEdit((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: keyof AnimalBeneficiary, value: string) => {
    setFormDataEdit((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    await onSave(formDataEdit);
    setIsSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    await onDelete(formDataEdit.id);
    setIsDeleting(false);
    onClose();
  };


  return (
    <DrawerRoot
      placement="start"
      size="lg"
      open={isDrawerOpen}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <DrawerBackdrop />
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            <Text fontSize="5xl"> Edit Animal </Text>
          </DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <Fieldset.Root size="lg">
            <Stack>
              <Fieldset.Legend>Edit animal details</Fieldset.Legend>
              <Fieldset.HelperText>
                Update animal details below.
              </Fieldset.HelperText>
            </Stack>
            <Fieldset.Content>
              <Field label="Name" required errorText="This field is required">
                <Input
                  name="name"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formDataEdit.name}
                />
              </Field>
              <Field label="Username" required errorText="This field is required">
                <Input
                  name="username"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formDataEdit.username}
                />
              </Field>
              <Field label="Gender" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Gender"
                    px={2}
                    name="gender"
                    value={formDataEdit.gender}
                    onChange={(e) =>
                      handleSelectChange("gender", e.target.value)
                    }
                  >
                    <option value="">Select Gender</option>
                    <option value="Boy">Male</option>
                    <option value="Girl">Female</option>
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
                  value={formDataEdit.birth_date}
                />
              </Field>
              <Field label="Breed" required errorText="This field is required">
                <Input
                  name="breed"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formDataEdit.breed}
                />
              </Field>
              <Field label="Animal Type" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Animal Type"
                    px={2}
                    name="animal_type"
                    value={formDataEdit.animal_type}
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
                  value={formDataEdit.biography}
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
                  value={formDataEdit.introduction}
                />
              </Field>
              <Field label="Budget Goal" required errorText="This field is required">
                <Input
                  name="budget_goal"
                  type="text"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formDataEdit.budget_goal}
                />
              </Field>
              <Field label="Status" required errorText="This field is required">
                <NativeSelectRoot>
                  <NativeSelectField
                    className="border"
                    placeholder="Select Status"
                    px={2}
                    name="status"
                    value={formDataEdit.status}
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
                  value={formDataEdit.country}
                />
              </Field>
              <Field label="Location" required errorText="This field is required">
                <Input
                  name="location_str"
                  className="border"
                  px={2}
                  onChange={handleInputChange}
                  value={formDataEdit.location_str}
                />
              </Field>
            </Fieldset.Content>
          </Fieldset.Root>
        </DrawerBody>
        <DrawerFooter>
          <Button
            type="button"
            onClick={handleDelete}
            className="bg-red-600 w-1/2 text-white disabled:opacity-50"
            disabled={isDeleting}
            loading={isDeleting}
            loadingText="Deleting..."
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            className="bg-[#1C3C8C] w-1/2 text-white disabled:opacity-50"
            disabled={isSaving}
            loading={isSaving}
            loadingText="Saving..."
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
};

export default EditDrawer;

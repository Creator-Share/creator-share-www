"use client"
import React from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerActionTrigger,
} from "@/components/ui/drawer";
import { Button, Text, Fieldset, Input, Stack, Textarea } from "@chakra-ui/react";
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
import MapPicker from "./MapPicker";
import { People } from "@/types/admin.types";

type CreateDrawerProps = {
  formData: People; // ✅ Use the People type instead of any
  setFormData: React.Dispatch<React.SetStateAction<People>>; // ✅ Ensure correct type
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSelectChange: (name: keyof People, value: string) => void; // ✅ Use keyof People to restrict allowed field names
  handleLocationSelect: (geo: [number, number], locationStr: string, country: string) => void;
  handleSubmit: (e: React.MouseEvent<HTMLButtonElement>) => void;
  imageFiles: File[];
  setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
  videoFiles: File[];
  setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>;
  handleDrawerClose: () => void;
};


const CreateDrawer = ({
  handleInputChange,
  handleSelectChange,
  handleLocationSelect,
  handleSubmit,
  setImageFiles,
  setVideoFiles,
  handleDrawerClose,
}: CreateDrawerProps) => {
  return (
    <DrawerContent>
      <DrawerHeader>
        <DrawerTitle>
          <Text fontSize="5xl"> Add a Child </Text>
        </DrawerTitle>
      </DrawerHeader>
      <DrawerBody>
        <Fieldset.Root size="lg" maxW="md">
          <Stack>
            <Fieldset.Legend>Child details</Fieldset.Legend>
            <Fieldset.HelperText>Please provide child details below.</Fieldset.HelperText>
          </Stack>
          <Fieldset.Content>
            <Field label="Name" required errorText="This field is required">
              <Input name="name" className="border" px={2} onChange={handleInputChange} />
            </Field>
            <Field label="Gender" required errorText="This field is required">
              <NativeSelectRoot>
                <NativeSelectField
                  className="border"
                  placeholder="Select Gender"
                  px={2}
                  name="gender"
                  onChange={(e) => handleSelectChange("gender", e.target.value)}
                >
                  <option value="Boy">Boy</option>
                  <option value="Girl">Girl</option>
                </NativeSelectField>
              </NativeSelectRoot>
            </Field>
            <Field label="Birth Day" required errorText="This field is required">
              <Input name="birth_date" type="date" className="border" px={2} onChange={handleInputChange} />
            </Field>
            <Field label="Biography" required errorText="This field is required">
              <Textarea name="biography" size="xl" className="border" px={2} py={2} onChange={handleInputChange} />
            </Field>
            <Field label="Budget Goal">
              <Input name="budget_goal" type="text" className="border" px={2} onChange={handleInputChange} />
            </Field>
            <Field label="Status" required errorText="This field is required">
              <NativeSelectRoot>
                <NativeSelectField
                  className="border"
                  placeholder="Select Status"
                  px={2}
                  name="status"
                  onChange={(e) => handleSelectChange("status", e.target.value)}
                >
                  <option value="New">New</option>
                  <option value="Partially Funded">Partially Funded</option>
                  <option value="Budget Filled">Budget Filled</option>
                  <option value="Archived">Archived</option>
                  <option value="Draft">Draft</option>
                </NativeSelectField>
              </NativeSelectRoot>
            </Field>
            <Field label="Upload Image">
              <FileUploadRoot onFileChange={(fileDetails) => setImageFiles(fileDetails.acceptedFiles)} accept={["image/*"]}>
                <FileUploadTrigger asChild>
                  <Button variant="outline" size="sm" className="border" px={4}>
                    <HiUpload /> Upload Image
                  </Button>
                </FileUploadTrigger>
                <FileUploadList />
              </FileUploadRoot>
            </Field>
            <Field label="Upload Video">
              <FileUploadRoot onFileChange={(fileDetails) => setVideoFiles(fileDetails.acceptedFiles)} accept={["video/mp4"]} >
                <FileUploadTrigger asChild>
                  <Button variant="outline" size="sm" className="border" px={4}>
                    <HiUpload /> Upload Video
                  </Button>
                </FileUploadTrigger>
                <FileUploadList />
              </FileUploadRoot>
            </Field>
            <MapPicker onCloseDrawer={handleDrawerClose} onSelectLocation={handleLocationSelect} />
          </Fieldset.Content>
        </Fieldset.Root>
      </DrawerBody>
      <DrawerFooter>
        <DrawerActionTrigger asChild>
          <Button variant="outline" onClick={handleDrawerClose}>Cancel</Button>
        </DrawerActionTrigger>
        <Button onClick={handleSubmit}>Save</Button>
      </DrawerFooter>
    </DrawerContent>
  );
};

export default CreateDrawer;
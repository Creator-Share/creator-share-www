"use client"
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
import {  Text, Fieldset, Input, Stack, Textarea } from "@chakra-ui/react";
import { Button } from '@/components/ui/button';
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
import { GoPlusCircle } from "react-icons/go";

type CreateDrawerProps = {
    formData: People;
    isDrawerOpen: boolean;
    setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setFormData: React.Dispatch<React.SetStateAction<People>>;
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    handleSelectChange: (name: keyof People, value: string) => void;
    handleLocationSelect: (geo: [number, number], locationStr: string, country: string) => void;
    handleSubmit: (e: React.MouseEvent<HTMLButtonElement>) => Promise<void>;
    imageFiles: File[];
    setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
    videoFiles: File[];
    setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>;
    handleDrawerClose: () => void;
};
const CreateDrawer = ({
    setIsDrawerOpen,
    isDrawerOpen,
    handleInputChange,
    handleSelectChange,
    handleLocationSelect,
    handleSubmit,
    setImageFiles,
    setVideoFiles,
    handleDrawerClose,
}: CreateDrawerProps) => {
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = async (e: React.MouseEvent<HTMLButtonElement>) => {
        try {
            setIsAdding(true);
            await handleSubmit(e);
        } catch (error) {
            console.error("Error adding:", error);
        } finally {
            setIsAdding(false);
        }
    };

    return (
        <DrawerRoot placement="start" size="lg" open={isDrawerOpen} onOpenChange={({ open }) => {
            setIsDrawerOpen(open);
          }}>
            <DrawerBackdrop />
            <DrawerTrigger asChild>
                <Button className="border-[2px] border-[#E0E0E0] w-fit h-[40px] px-4">
                    <GoPlusCircle className="mr-[3.5px]" /> New Child
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
                            <Field label="Budget Goal" required errorText="This field is required">
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
                            <Field label="Upload Image" required errorText="This field is required">
                                <FileUploadRoot onFileChange={(fileDetails) => setImageFiles(fileDetails.acceptedFiles)} accept={["image/*"]}>
                                    <FileUploadTrigger asChild>
                                        <Button variant="outline" size="sm" className="border" px={4}>
                                            <HiUpload /> Upload Image
                                        </Button>
                                    </FileUploadTrigger>
                                    <FileUploadList />
                                </FileUploadRoot>
                            </Field>
                            <Field label="Upload Video" required errorText="This field is required">
                                <FileUploadRoot onFileChange={(fileDetails) => setVideoFiles(fileDetails.acceptedFiles)} accept={["video/mp4"]} >
                                    <FileUploadTrigger asChild>
                                        <Button variant="outline" size="sm" className="border" px={4}>
                                            <HiUpload /> Upload Video
                                        </Button>
                                    </FileUploadTrigger>
                                    <FileUploadList />
                                </FileUploadRoot>
                            </Field>
                            <MapPicker onSelectLocation={handleLocationSelect} />
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
                        onClick={handleAdd} 
                        className="bg-[#1C3C8C] w-1/2 text-white"
                        disabled={isAdding}
                        loading={isAdding}
                        loadingText="Adding..."
                    >
                        Add
                    </Button>
                </DrawerFooter>
            </DrawerContent>
        </DrawerRoot>
    );
};

export default CreateDrawer;
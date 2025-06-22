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
import { Beneficiaries } from "@/types/admin.types";
import { GoPlusCircle } from "react-icons/go";
import { toaster } from "@/components/ui/toaster";

type CreateDrawerProps = {
    formData: Partial<Beneficiaries>;
    isDrawerOpen: boolean;
    setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setFormData: React.Dispatch<React.SetStateAction<Partial<Beneficiaries>>>;
    handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    handleSelectChange: (name: keyof Beneficiaries, value: string) => void;
    handleLocationSelect: (geo: [number, number], locationStr: string, country: string) => void;
    handleSubmit: () => Promise<boolean>;
    imageFiles: File[];
    setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
    videoFiles: File[];
    setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>;
    handleDrawerClose: () => void;
};
const CreateDrawer = ({
    formData,
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
    const [isAdding, setIsAdding] = useState(false);

    const handleAdd = async () => {
        
        const requiredFields = ['name', 'username', 'gender', 'birth_date', 'biography', 'introduction', 'budget_goal', 'country'] as const;
        const emptyFields = requiredFields.filter(field => !formData[field as keyof Beneficiaries]);
        
        if (emptyFields.length > 0) {
            toaster.create({
                title: "Validation Error",
                description: `Please fill in all required fields: ${emptyFields.join(', ')}`,
                duration: 5000,
            });
            return;
        }

        if (!formData.location_geo || !formData.location_str || !formData.country) {
            toaster.create({
                title: "Location Required",
                description: "Please select a location on the map",
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
                description: "Failed to add street involved",
                duration: 5000,
            });
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
                <Button className="border-[2px] border-[#E0E0E0] rounded-md w-fit h-[40px] px-10 bg-[#1C3C8C] text-white">
                    <GoPlusCircle className="mr-[3.5px]" /> List A Street Involved
                </Button>
            </DrawerTrigger>
            <DrawerContent>
                <DrawerHeader>
                    <DrawerTitle>
                        <Text fontSize="5xl"> Add a Street Involved </Text>
                    </DrawerTitle>
                </DrawerHeader>
                <DrawerBody>
                    <Fieldset.Root size="lg">
                        <Stack>
                            <Fieldset.Legend>Street Involved details</Fieldset.Legend>
                            <Fieldset.HelperText>Please provide street involved details below.</Fieldset.HelperText>
                        </Stack>
                        <Fieldset.Content>
                            <Field label="Name" required errorText="This field is required">
                                <Input name="name" className="border" px={2} onChange={handleInputChange} />
                            </Field>
                            <Field label="Username" required errorText="This field is required">
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
                            <Field label="Introduction" required errorText="This field is required">
                                <Textarea 
                                    name="introduction" 
                                    size="xl" 
                                    className="border" 
                                    px={2} 
                                    py={2} 
                                    onChange={handleInputChange} 
                                />
                            </Field>
                            <Field label="Budget Goal" required errorText="This field is required">
                                <Input 
                                    name="budget_goal" 
                                    type="number" 
                                    className="border" 
                                    px={2} 
                                    onChange={handleInputChange}
                                    value={formData.budget_goal || ''}
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

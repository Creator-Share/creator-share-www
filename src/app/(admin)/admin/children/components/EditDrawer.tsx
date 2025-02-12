"use client"
import React, {useEffect, useState} from 'react'
import {
    DrawerActionTrigger,
    DrawerBackdrop,
    DrawerBody,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    DrawerRoot,
    DrawerTitle,
} from "@/components/ui/drawer";
import { Text, Fieldset, Input, Stack, Textarea, Image } from "@chakra-ui/react";
import { Field } from "@/components/ui/field";
import { Button } from '@/components/ui/button';
import {
    NativeSelectField,
    NativeSelectRoot,
} from "@/components/ui/native-select";
import {
    FileUploadList,
    FileUploadRoot,
    FileUploadTrigger,
} from "@/components/ui/file-upload";
import MapPicker from './MapPicker';
import { SponsorPeople } from "@/types/admin.types";
import { createClient } from "@/utils/supabase/client";

interface EditDrawerProps {
    selectedChild: SponsorPeople | null;
    formDataEdit: SponsorPeople;
    setFormDataEdit: React.Dispatch<React.SetStateAction<SponsorPeople>>;
    isDrawerOpen: boolean;
    onClose: () => void;
    onSave: (updatedChild: SponsorPeople) => void;
    onDelete: (childId: string) => Promise<void>;
    imageFiles: File[];
    setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
    videoFiles: File[];
    setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>;
}

const EditDrawer: React.FC<EditDrawerProps> = ({
    selectedChild,
    isDrawerOpen,
    imageFiles,
    videoFiles,
    onClose,
    onSave,
    onDelete,
    setImageFiles,
    setVideoFiles,
}) => {
    const [formDataEdit, setFormDataEdit] = useState<SponsorPeople>(() => selectedChild || {} as SponsorPeople);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const uploadFileToSupabase = async (file: File, folder: string): Promise<string | null> => {
        const supabase = createClient();
        const fileName = `${Date.now()}-${file.name}`;
        const filePath = `${folder}/${fileName}`;

        const { error } = await supabase.storage.from("people").upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
        });

        if (error) {
            console.error("File upload failed:", error.message);
            return null;
        }

        const { data } = supabase.storage.from("people").getPublicUrl(filePath);
        return data.publicUrl;
    };

    useEffect(() => {
        if (selectedChild) {
            setFormDataEdit(selectedChild);
        }
    }, [selectedChild]);
    

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormDataEdit((prev: SponsorPeople) => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name: string, value: string) => {
        setFormDataEdit((prev: SponsorPeople) => ({ ...prev, [name]: value }));
    };

    const handleSave = async () => {
        try {
            setIsSaving(true);
            const updatedData = { ...formDataEdit };
            const budgetGoalInCents = Math.round(parseFloat(formDataEdit.budget_goal.toString()) * 100);

            if (imageFiles.length > 0) {
                const imageUrl = await uploadFileToSupabase(imageFiles[0], "images");
                if (imageUrl) updatedData.image_url = imageUrl;
            }
            if (videoFiles.length > 0) {
                const videoUrl = await uploadFileToSupabase(videoFiles[0], "videos");
                if (videoUrl) updatedData.video_url = videoUrl;
            }

            await onSave({ 
                ...updatedData, 
                budget_goal: budgetGoalInCents 
            });
        } catch (error) {
            console.error("Error saving:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleLocationSelect = (geo: [number, number], locationStr: string, country: string) => {
        setFormDataEdit((prev: SponsorPeople) => ({
            ...prev,
            location_geo: { type: "Point", coordinates: [geo[1], geo[0]] },
            location_str: locationStr,
            country: country
        }));
    };

    if (!selectedChild) return null;

    return (
        <DrawerRoot placement="start" size="lg" open={isDrawerOpen} onOpenChange={onClose}>
            <DrawerBackdrop />
            <DrawerContent>
                <DrawerHeader>
                    <DrawerTitle>
                        <Text fontSize="5xl"> Edit Child </Text>
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
                                <Input 
                                    name="name" 
                                    className="border" 
                                    px={2} 
                                    onChange={handleInputChange} 
                                    value={formDataEdit?.name || ''} 
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
                                        value={formDataEdit.gender || ''}
                                    >
                                        <option value="Boy">Boy</option>
                                        <option value="Girl">Girl</option>
                                    </NativeSelectField>
                                </NativeSelectRoot>
                            </Field>
                            <Field label="Birth Day" required errorText="This field is required">
                                <Input 
                                    name="birth_date" 
                                    type="date" 
                                    className="border" 
                                    px={2} 
                                    onChange={handleInputChange} 
                                    value={formDataEdit.birth_date || ''} 
                                />
                            </Field>
                            <Field label="Biography" required errorText="This field is required">
                                <Textarea 
                                    name="biography" 
                                    size="xl" 
                                    className="border" 
                                    px={2} 
                                    py={2} 
                                    onChange={handleInputChange} 
                                    value={formDataEdit.biography || ''} 
                                />
                            </Field>
                            <Field label="Budget Goal">
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
                                        onChange={(e) => handleSelectChange("status", e.target.value)}
                                        value={formDataEdit.status || ''}
                                    >
                                        <option value="New">New</option>
                                        <option value="Partially Funded">Partially Funded</option>
                                        <option value="Budget Filled">Budget Filled</option>
                                        <option value="Archived">Archived</option>
                                        <option value="Draft">Draft</option>
                                    </NativeSelectField>
                                </NativeSelectRoot>
                            </Field>
                            <Field label="Change Image">
                                <FileUploadRoot onFileChange={(fileDetails) => setImageFiles(fileDetails.acceptedFiles)} accept={["image/*"]}>
                                    <FileUploadTrigger asChild>
                                    <Image src={selectedChild.image_url} alt="Child Image" className="w-1/2 h-1/2 rounded-lg cursor-pointer" />
                                    </FileUploadTrigger>
                                    <FileUploadList />
                                </FileUploadRoot>
                            </Field>
                            <Field label="Upload Video">
                                <FileUploadRoot onFileChange={(fileDetails) => setVideoFiles(fileDetails.acceptedFiles)} accept={["video/mp4"]} >
                                    <FileUploadTrigger asChild>
                                        <video src={selectedChild.video_url} className="w-1/2 h-1/2 rounded-lg cursor-pointer" />
                                    </FileUploadTrigger>
                                    <FileUploadList />
                                </FileUploadRoot>
                            </Field>
                            <MapPicker 
                                onSelectLocation={handleLocationSelect} 
                                initialLocation={
                                    selectedChild.location_geo ? {
                                        coordinates: [
                                            selectedChild.location_geo.coordinates[1],
                                            selectedChild.location_geo.coordinates[0]
                                        ],
                                        locationStr: selectedChild.location_str,
                                        country: selectedChild.country
                                    } : undefined
                                }
                            />
                        </Fieldset.Content>
                    </Fieldset.Root>
                </DrawerBody>
                <DrawerFooter>
                    <DrawerActionTrigger asChild>
                        <Button 
                            className='bg-black w-[29.5%] text-white' 
                            onClick={onClose}
                            disabled={isDeleting || isSaving}
                        >
                            Cancel
                        </Button>
                    </DrawerActionTrigger>
                    <Button
                        className='bg-red-500 w-1/3 text-white'
                        onClick={async () => {
                            if (selectedChild?.id) {
                                try {
                                    setIsDeleting(true);
                                    await onDelete(selectedChild.id);
                                    onClose();
                                } catch (error) {
                                    console.error("Error deleting:", error);
                                } finally {
                                    setIsDeleting(false);
                                }
                            } else {
                                console.error("Child ID is undefined");
                            }
                        }}
                        disabled={isDeleting || isSaving}
                    >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                    </Button>
                    <Button 
                        onClick={handleSave} 
                        className="bg-[#1C3C8C] w-1/3 text-white"
                        loading={isSaving}
                        loadingText="Saving..."
                        disabled={isDeleting}
                    >
                        Save
                    </Button>
                </DrawerFooter>
            </DrawerContent>
        </DrawerRoot>
    )
}

export default EditDrawer;
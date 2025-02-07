"use client"
import React, {useEffect} from 'react'
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
import { Button, Text, Fieldset, Input, Stack, Textarea, Image } from "@chakra-ui/react";
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
import MapPicker from './MapPicker';
import { People } from "@/types/admin.types";

interface EditDrawerProps {
    selectedChild: People | null;
    formDataEdit: People;
    setFormDataEdit: React.Dispatch<React.SetStateAction<People>>;
    isDrawerOpen: boolean;
    onClose: () => void;
    onSave: (updatedChild: People) => void;
    onDelete: (childId: string) => void;
    onLocationSelect: (geo: [number, number], locationStr: string, country: string) => void;
    imageFiles: File[];
    setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
    videoFiles: File[];
    setVideoFiles: React.Dispatch<React.SetStateAction<File[]>>;
}


const EditDrawer: React.FC<EditDrawerProps> = ({
    selectedChild,
    isDrawerOpen,
    onClose,
    onSave,
    onDelete,
    onLocationSelect,
    // imageFiles,
    setImageFiles,
    // videoFiles,
    setVideoFiles,
}) => {
    const [formDataEdit, setFormDataEdit] = React.useState<People>(() => selectedChild || {} as People);

    useEffect(() => {
        if (selectedChild) {
            setFormDataEdit(selectedChild);
        }
    }, [selectedChild]);
    

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormDataEdit(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name: string, value: string) => {
        setFormDataEdit(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = () => {
        const budgetGoalInCents = Math.round(parseFloat(formDataEdit.budget_goal.toString()) * 100);
        onSave({ 
            ...formDataEdit, 
            budget_goal: budgetGoalInCents 
        });
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
                            <MapPicker onCloseDrawer={onClose} onSelectLocation={onLocationSelect} />
                        </Fieldset.Content>
                    </Fieldset.Root>
                </DrawerBody>
                <DrawerFooter>
                    <DrawerActionTrigger asChild>
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                    </DrawerActionTrigger>
                    <Button onClick={handleSave}>Save</Button>
                    <Button
                        variant="outline"
                        colorScheme="red"
                        onClick={() => {
                            if (selectedChild?.id) {
                                onDelete(selectedChild.id);
                            } else {
                                console.error("Child ID is undefined");
                            }
                        }}
                    >
                        Delete
                    </Button>
                </DrawerFooter>
            </DrawerContent>
        </DrawerRoot>
    )
}

export default EditDrawer;
import React from 'react'
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
import { Button, Text, Fieldset, Input, Stack, Textarea } from "@chakra-ui/react";
import { Field } from "@/components/ui/field";
import { HiUpload } from "react-icons/hi"
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
    isDrawerOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    onInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onSelectChange: (name: string, value: string) => void;
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
    onInputChange,
    onSelectChange,
    onLocationSelect,
    // imageFiles,
    setImageFiles,
    // videoFiles,
    setVideoFiles
}) => {
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
                                <Input name="name" className="border" px={2} onChange={onInputChange} value={selectedChild?.name || ''} />
                            </Field>
                            <Field label="Gender" required errorText="This field is required">
                                <NativeSelectRoot>
                                    <NativeSelectField
                                        className="border"
                                        placeholder="Select Gender"
                                        px={2}
                                        name="gender"
                                        onChange={(e) => onSelectChange("gender", e.target.value)}
                                        value={selectedChild?.gender || ''}
                                    >
                                        <option value="Boy">Boy</option>
                                        <option value="Girl">Girl</option>
                                    </NativeSelectField>
                                </NativeSelectRoot>
                            </Field>
                            <Field label="Birth Day" required errorText="This field is required">
                                <Input name="birth_date" type="date" className="border" px={2} onChange={onInputChange} value={selectedChild?.birth_date || ''} />
                            </Field>
                            <Field label="Biography" required errorText="This field is required">
                                <Textarea name="biography" size="xl" className="border" px={2} py={2} onChange={onInputChange} value={selectedChild?.biography || ''} />
                            </Field>
                            <Field label="Budget Goal">
                                <Input name="budget_goal" type="text" className="border" px={2} onChange={onInputChange} value={selectedChild?.budget_goal || ''} />
                            </Field>
                            <Field label="Status" required errorText="This field is required">
                                <NativeSelectRoot>
                                    <NativeSelectField
                                        className="border"
                                        placeholder="Select Status"
                                        px={2}
                                        name="status"
                                        onChange={(e) => onSelectChange("status", e.target.value)}
                                        value={selectedChild?.status || ''}
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
                            <MapPicker onCloseDrawer={onClose} onSelectLocation={onLocationSelect} />
                        </Fieldset.Content>
                    </Fieldset.Root>
                </DrawerBody>
                <DrawerFooter>
                    <DrawerActionTrigger asChild>
                        <Button variant="outline" onClick={onClose}>Cancel</Button>
                    </DrawerActionTrigger>
                    <Button onClick={onSave}>Save</Button>
                </DrawerFooter>
            </DrawerContent>
        </DrawerRoot>
    )
}

export default EditDrawer;
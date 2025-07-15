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
import { Text, Fieldset, Stack } from "@chakra-ui/react";
import { Button } from '@/components/ui/button';
import { FileUploadList, FileUploadRoot, FileUploadTrigger } from "@/components/ui/file-upload";
import { HiUpload } from "react-icons/hi";
import { toaster } from "@/components/ui/toaster";
import { Beneficiaries } from "@/types/admin.types";
import { centsToDollars } from "@/utils/currency";

type BulkUploadDrawerProps = {
    isDrawerOpen: boolean;
    setIsDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
    onUploadSuccess: (newChildren: Beneficiaries[]) => void;
};

const BulkUploadDrawer = ({
    isDrawerOpen,
    setIsDrawerOpen,
    onUploadSuccess,
}: BulkUploadDrawerProps) => {
    const [isUploading, setIsUploading] = useState(false);
    const [csvFile, setCsvFile] = useState<File | null>(null);

    const handleFileChange = (fileDetails: { acceptedFiles: File[] }) => {
        if (fileDetails.acceptedFiles.length > 0) {
            setCsvFile(fileDetails.acceptedFiles[0]);
        }
    };

    const processCSV = async (file: File): Promise<Beneficiaries[]> => {
        const text = await file.text();
        const rows = text.split('\n');
        const headers = rows[0].split(',').map((h) => h.trim());
        
        return rows.slice(1).filter(row => row.trim()).map(row => {
            const values = row.split(',').map(v => v.trim());
            const beneficiary: Partial<Beneficiaries> = {};
            headers.forEach((header, index) => {
                if (header === 'budget_goal') {
                    beneficiary[header] = Math.round(parseFloat(values[index]) * 100);
                } else if (header === 'location_geo') {
                    const [lat, lng] = values[index].split(';').map(Number);
                    beneficiary[header] = {
                        type: 'Point',
                        coordinates: [lng, lat]
                    };
                } else {
                    (beneficiary as Record<string, string>)[header] = values[index];
                }
            });
            return beneficiary as Beneficiaries;
        });
    };

    const handleUpload = async () => {
        if (!csvFile) {
            toaster.create({
                title: "Error",
                description: "Please select a CSV file to upload",
                duration: 5000,
            });
            return;
        }

        try {
            setIsUploading(true);
            const processedData = await processCSV(csvFile);
            
            const response = await fetch('/api/admin/beneficiaries/bulk-upload', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ children: processedData }),
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const newChildren = await response.json();
            const formattedChildren = newChildren.map((beneficiary: Beneficiaries) => ({
                ...beneficiary,
                budget_goal: centsToDollars(beneficiary.budget_goal)
            }));
            
            onUploadSuccess(formattedChildren);
            setIsDrawerOpen(false);
            
            toaster.create({
                title: "Success",
                description: `Successfully uploaded ${newChildren.length} children`,
                duration: 5000,
            });
        } catch (error) {
            toaster.create({
                title: "Error",
                description: "Failed to process upload",
                duration: 5000,
            });
            console.error(error);
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <DrawerRoot placement="start" size="lg" open={isDrawerOpen} onOpenChange={({ open }) => setIsDrawerOpen(open)}>
            <DrawerBackdrop />
            <DrawerTrigger asChild>
                <Button className="border-[2px] border-[#E0E0E0] w-fit h-[40px] px-4 ml-2">
                    <HiUpload className="mr-[3.5px]" /> Bulk Upload
                </Button>
            </DrawerTrigger>
            <DrawerContent>
                <DrawerHeader>
                    <DrawerTitle>
                        <Text fontSize="5xl">Bulk Upload Children</Text>
                    </DrawerTitle>
                </DrawerHeader>
                <DrawerBody>
                    <Fieldset.Root size="lg">
                        <Stack>
                            <Fieldset.Legend>Upload CSV File</Fieldset.Legend>
                            <Fieldset.HelperText>
                                Please upload a CSV file with the following headers:
                                name, gender, birth_date, biography, introduction, budget_goal, status, country, location_geo (format: "lat;lng"), location_str
                            </Fieldset.HelperText>
                        </Stack>
                        <FileUploadRoot
                            onFileChange={handleFileChange}
                            accept={[".csv"]}
                        >
                            <FileUploadTrigger asChild>
                                <Button variant="outline" size="sm" className="border" px={4}>
                                    <HiUpload /> Select CSV File
                                </Button>
                            </FileUploadTrigger>
                            <FileUploadList />
                        </FileUploadRoot>
                    </Fieldset.Root>
                </DrawerBody>
                <DrawerFooter>
                    <DrawerActionTrigger asChild>
                        <Button
                            className="bg-black w-1/2 text-white"
                            onClick={() => setIsDrawerOpen(false)}
                            disabled={isUploading}
                        >
                            Cancel
                        </Button>
                    </DrawerActionTrigger>
                    <Button
                        onClick={handleUpload}
                        className="bg-[#1C3C8C] w-1/2 text-white"
                        disabled={isUploading || !csvFile}
                        loading={isUploading}
                        loadingText="Uploading..."
                    >
                        Upload
                    </Button>
                </DrawerFooter>
            </DrawerContent>
        </DrawerRoot>
    );
};

export default BulkUploadDrawer;
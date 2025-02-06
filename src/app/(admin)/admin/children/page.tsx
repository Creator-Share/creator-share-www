"use client";

import React, { useEffect, useState } from "react";
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
} from "@/components/ui/file-upload"
import { HiUpload } from "react-icons/hi";
import {
  DrawerActionTrigger,
  DrawerBackdrop,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { columns } from "./columns";
import { People } from "@/types/admin.types";
import { createClient } from "@/utils/supabase/client";
import { GoPlusCircle } from "react-icons/go";
import dynamic from "next/dynamic";
// import EditDrawer from "./components/EditDrawer";

const MapPicker = dynamic(() => import("./components/MapPicker"), { ssr: false });
const EditDrawer = dynamic(() => import("./components/EditDrawer"), { ssr: false });
const ChildrenTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<People[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [formData, setFormData] = useState({
    name: "",
    gender: "",
    birth_date: "",
    biography: "",
    budget_goal: "",
    status: "",
    country: "",
    location_geo: null as string | null,
    location_str: "",
    image_url: "",
    video_url: ""
  });
  const [selectedChild, setSelectedChild] = useState<People | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const { data: fetchedData, error } = await supabase.from("people").select("*");
      if (error) {
        console.error("Error fetching people:", error);
      } else if (fetchedData) {
        setData(fetchedData as People[]);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLocationSelect = (geo: [number, number], locationStr: string, country: string) => {
    console.log("Selected Location String:", locationStr);
    console.log("Selected Country:", country);
    setFormData((prev) => ({
      ...prev,
      location_geo: `SRID=4326;POINT(${geo[1]} ${geo[0]})`,
      location_str: locationStr,
      country,
    }));
  };

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
  const handleSubmit = async () => {
    if (!formData.name || !formData.gender || !formData.birth_date || !formData.status) {
      console.error("Error: Missing required fields.");
      return;
    }

    const uploadedImageUrl = imageFiles.length > 0 ? await uploadFileToSupabase(imageFiles[0], "images") : "";
    const uploadedVideoUrl = videoFiles.length > 0 ? await uploadFileToSupabase(videoFiles[0], "videos") : "";

    const updatedFormData = {
      ...formData,
      image_url: uploadedImageUrl,
      video_url: uploadedVideoUrl,
    };

    console.log("Submitting Data:", updatedFormData);

    const supabase = createClient();
    const { error } = await supabase.from("people").insert([updatedFormData]);

    if (error) {
      console.error("Error adding child:", error);
    } else {
      console.log("Child added successfully!");
      setFormData({
        name: "",
        gender: "",
        birth_date: "",
        biography: "",
        budget_goal: "",
        status: "",
        country: "",
        location_geo: null,
        location_str: "",
        image_url: "",
        video_url: "",
      });
      setImageFiles([]);
      setVideoFiles([]);
    }
  };

  const handleRowClick = (row: People) => {
    setSelectedChild(row);
    setIsDrawerOpen(true);
  };

  const handleDrawerClose = () => {
    setIsDrawerOpen(false);
    console.log("Drawer closed by MapPicker");
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto h-[calc(100vh-200px)] mt-12">
      <div className="grid grid-cols-2 mb-2">
        <h1 className="text-3xl font-semibold leading-9">Children</h1>
        <div className="justify-self-end">
          <DrawerRoot placement="start" size="lg">
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
          </DrawerRoot>
        </div>
      </div>
      <DataTable
        columns={columns as ColumnDef<unknown, unknown>[]}
        data={data}
        controls="bottom"
        onRowClick={(data: unknown) => handleRowClick(data as People)}
      />
      {isDrawerOpen && (
        <EditDrawer
          selectedChild={selectedChild}
          isDrawerOpen={isDrawerOpen}
          onClose={handleDrawerClose}
          onSave={handleSubmit}
          onInputChange={handleInputChange}
          onSelectChange={handleSelectChange}
          onLocationSelect={handleLocationSelect}
          imageFiles={imageFiles}
          setImageFiles={setImageFiles}
          videoFiles={videoFiles}
          setVideoFiles={setVideoFiles}
        />
      )}
    </div>
  );
};

export default ChildrenTable;

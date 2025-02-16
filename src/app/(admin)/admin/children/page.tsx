"use client";
import React, { useEffect, useState, useRef } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef, Row } from "@tanstack/react-table";
import { columns } from "./columns";
import { SponsorPeople, Geography } from "@/types/admin.types";
import { createClient } from "@/utils/supabase/client";
import dynamic from "next/dynamic";
import { centsToDollars } from "@/utils/currency";
import BulkUploadDrawer from "./components/BulkUploadDrawer";
import { Box, Button, Text } from "@chakra-ui/react";
import { MdDeleteOutline } from "react-icons/md";

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), { ssr: false });
const EditDrawer = dynamic(() => import("./components/EditDrawer"), { ssr: false });

type TableInstance = {
  getSelectedRowModel: () => { rows: Row<SponsorPeople>[] };
};

const ChildrenTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SponsorPeople[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [formData, setFormData] = useState<SponsorPeople>({
    name: "",
    gender: "",
    birth_date: "",
    biography: "",
    budget_goal: 0 * 100,
    budget_raised: 0,
    status: "",
    country: "",
    location_geo: null,
    location_str: "",
    image_url: "",
    video_url: "",
    introduction: "",
  });
  const [formDataEdit, setFormDataEdit] = useState<SponsorPeople>({
    id: "",
    name: "",
    gender: "",
    birth_date: "",
    biography: "",
    budget_goal: 0,
    budget_raised: 0,
    status: "",
    country: "",
    location_geo: null as Geography | null,
    location_str: "",
    image_url: "",
    video_url: "",
    introduction: "",
  });

  const [selectedChild, setSelectedChild] = useState<SponsorPeople | null>(null);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isBulkUploadDrawerOpen, setIsBulkUploadDrawerOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const tableRef = useRef<TableInstance | null>(null);
  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/admin/children/retrieve');
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const fetchedData = await response.json();
        setData(fetchedData);
      } catch (error) {
        console.error("Error fetching people:", error);
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

  const handleLocationSelect = (geo: [number, number] | null, locationStr: string, country: string) => {
    setFormData((prev) => ({
      ...prev,
      location_geo: geo ? { type: "Point", coordinates: [geo[1], geo[0]] } as Geography : null,
      location_str: locationStr,
      country,
    }));
  };


  const uploadFileToSupabase = async (file: File, folder: string): Promise<string | null> => {
    const supabase = createClient();
    const fileName = `${Date.now()}-${file.name}`;
    const filePath = `${folder}/${fileName}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from("sponsor_people")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("File upload failed:", uploadError.message);
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      const { data } = supabase.storage
        .from("sponsor_people")
        .getPublicUrl(filePath);

      if (!data.publicUrl) {
        throw new Error("Failed to get public URL");
      }

      return data.publicUrl;
    } catch (error) {
      console.error("File upload error:", error);
      return null;
    }
  };

  const handleSubmit = async () => {
    try {
      let uploadedImageUrl = "";
      let uploadedVideoUrl = "";

      if (imageFiles.length > 0) {
        const imageUrl = await uploadFileToSupabase(imageFiles[0], "images");
        if (!imageUrl) {
          throw new Error("Failed to upload image");
        }
        uploadedImageUrl = imageUrl;
      }

      if (videoFiles.length > 0) {
        const videoUrl = await uploadFileToSupabase(videoFiles[0], "videos");
        if (!videoUrl) {
          throw new Error("Failed to upload video");
        }
        uploadedVideoUrl = videoUrl;
      }

      const budgetGoalInCents = Math.round(parseFloat(formData.budget_goal.toString()) * 100);

      const updatedFormData = {
        ...formData,
        budget_goal: budgetGoalInCents,
        image_url: uploadedImageUrl,
        video_url: uploadedVideoUrl,
      };

      const response = await fetch('/api/admin/children/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedFormData),
      });

      if (!response.ok) {
        throw new Error('Failed to create child');
      }

      const newChild = await response.json();
      setData((prevData) => [
        ...prevData,
        { ...newChild, budget_goal: centsToDollars(newChild.budget_goal) },
      ]);

      setFormData({
        name: "",
        gender: "",
        birth_date: "",
        biography: "",
        budget_goal: 0,
        budget_raised: 0,
        status: "",
        country: "",
        location_geo: null,
        location_str: "",
        image_url: "",
        video_url: "",
        introduction: "",
      });
      setImageFiles([]);
      setVideoFiles([]);
      setIsCreateDrawerOpen(false);
    } catch (error) {
      console.error("Error creating child:", error);
      alert(error instanceof Error ? error.message : "Failed to create child");
    }
  };

  const handleSave = async (updatedChild: SponsorPeople) => {
    try {
      const response = await fetch('/api/admin/children/update', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedChild),
      });

      if (!response.ok) {
        throw new Error('Failed to update child');
      }

      setData((prevData) => prevData.map(child =>
        child.id === updatedChild.id
          ? { ...updatedChild, budget_goal: parseFloat(centsToDollars(updatedChild.budget_goal)) }
          : child
      ));
      setIsEditDrawerOpen(false);
    } catch (error) {
      console.error("Error updating child:", error);
    }
  };

  const handleBulkDelete = async () => {
    if (!tableRef.current) return;

    const selectedRowModel = tableRef.current.getSelectedRowModel();
    const selectedRows = selectedRowModel.rows;

    if (selectedRows.length === 0) {
      alert("No rows selected for deletion.");
      return;
    }

    if (!confirm(`Are you sure you want to delete ${selectedRows.length} selected children?`)) {
      return;
    }
    const childIds = selectedRows.map((row: Row<SponsorPeople>) => row.original.id);

    try {
      const response = await fetch("/api/admin/children/bulk-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ childIds }),
      });

      if (!response.ok) {
        throw new Error("Bulk delete failed");
      }
      setData((prevData) =>
        prevData.filter((child) => !childIds.includes(child.id))
      );
      alert("Selected children deleted successfully.");
    } catch (error) {
      console.error("Bulk delete error:", error);
      alert("Bulk delete failed. Please try again.");
    }
  };

  const handleDelete = async (childId: string) => {
    try {
      const response = await fetch('/api/admin/children/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ childId }),
      });

      if (!response.ok) {
        throw new Error('Failed to delete child');
      }

      setData((prevData) => prevData.filter(child => child.id !== childId));
      setIsEditDrawerOpen(false);
    } catch (error) {
      console.error("Error deleting child:", error);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Box className="container mx-auto h-[calc(100vh-200px)] mt-12">
      <Box className="grid grid-cols-2 mb-2">
        <Text className="text-3xl font-semibold leading-9">Children</Text>
        <Box className="justify-self-end flex gap-3">
          <CreateDrawer
            setIsDrawerOpen={setIsCreateDrawerOpen}
            formData={formData}
            setFormData={setFormData}
            handleInputChange={handleInputChange}
            handleSelectChange={handleSelectChange}
            handleLocationSelect={handleLocationSelect}
            handleSubmit={handleSubmit}
            isDrawerOpen={isCreateDrawerOpen}
            imageFiles={imageFiles}
            setImageFiles={setImageFiles}
            videoFiles={videoFiles}
            setVideoFiles={setVideoFiles}
            handleDrawerClose={() => setIsCreateDrawerOpen(false)}
          />
          <BulkUploadDrawer
            isDrawerOpen={isBulkUploadDrawerOpen}
            setIsDrawerOpen={setIsBulkUploadDrawerOpen}
            onUploadSuccess={(newChildren) => {
              setData((prevData) => [...prevData, ...newChildren]);
            }}
          />
          {selectedCount > 0 && (
            <Button onClick={handleBulkDelete} className="border-[2px] border-[#E0E0E0] bg-red-500 text-white w-fit h-[40px] px-4">
              <MdDeleteOutline className="mr-[3.5px]" /> Bulk Delete ({selectedCount})
            </Button>
          )}
        </Box>
      </Box>
      <DataTable
        ref={tableRef}
        columns={columns as ColumnDef<unknown, unknown>[]}
        data={data}
        controls="bottom"
        onRowSelectionChange={(rowSelection) =>
          setSelectedCount(Object.keys(rowSelection).length)
        }
        onRowClick={(data: unknown) => {
          setSelectedChild(data as SponsorPeople);
          setIsEditDrawerOpen(true);
        }}
      />
      {isEditDrawerOpen && selectedChild && (
        <EditDrawer
          selectedChild={selectedChild}
          formDataEdit={formDataEdit}
          setFormDataEdit={setFormDataEdit}
          isDrawerOpen={isEditDrawerOpen}
          onClose={() => setIsEditDrawerOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          imageFiles={imageFiles}
          setImageFiles={setImageFiles}
          videoFiles={videoFiles}
          setVideoFiles={setVideoFiles}
        />
      )}
    </Box>
  );
};

export default ChildrenTable;

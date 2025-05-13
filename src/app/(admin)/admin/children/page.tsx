"use client";
import React, { useEffect, useState, useRef } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef, Row } from "@tanstack/react-table";
import { columns } from "./columns";
import { ChildSponsorship } from "@/types";
import { createClient } from "@/utils/supabase/client";
import dynamic from "next/dynamic";
import { centsToDollars } from "@/utils/currency";
import BulkUploadDrawer from "./components/BulkUploadDrawer";
import { Box, Button, Text } from "@chakra-ui/react";
import { MdDeleteOutline } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";
import DeleteDialog from "./components/DeleteDialog";

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), { ssr: false });
const EditDrawer = dynamic(() => import("./components/EditDrawer"), { ssr: false });

type TableInstance = {
  getSelectedRowModel: () => { rows: Row<ChildSponsorship>[] };
  getTableInstance: () => { toggleAllRowsSelected: (value: boolean) => void };
};

const ChildrenTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ChildSponsorship[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [formData, setFormData] = useState<ChildSponsorship>({
    id: "",
    created_at: "",
    sponsorship_type: "CHILD",
    status: "ACTIVE",
    location_str: "",
    location_geo: null,
    story: "",
    budget_goal: 0,
    budget_raised: 0,
    monthly_support_cost: 0,
    name: "",
    birth_date: "",
    gender: "",
    biography: "",
    country: "",
    video_url: "",
    introduction: "",
  });
  const [formDataEdit, setFormDataEdit] = useState<ChildSponsorship>({
    id: "",
    created_at: "",
    sponsorship_type: "CHILD",
    status: "ACTIVE",
    location_str: "",
    location_geo: null,
    story: "",
    budget_goal: 0,
    budget_raised: 0,
    monthly_support_cost: 0,
    name: "",
    birth_date: "",
    gender: "",
    biography: "",
    country: "",
    video_url: "",
    introduction: "",
  });

  const [selectedChild, setSelectedChild] = useState<ChildSponsorship | null>(null);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isBulkUploadDrawerOpen, setIsBulkUploadDrawerOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedRowsForDeletion, setSelectedRowsForDeletion] = useState<Row<ChildSponsorship>[]>([]);
  const tableRef = useRef<TableInstance | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/sponsorships?type=CHILD');
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const data = await response.json();
        setData(data.sponsorships);
      } catch (error) {
        console.error("Error fetching children:", error);
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
      location_geo: geo ? { type: "Point", coordinates: [geo[1], geo[0]] } : null,
      location_str: locationStr,
      country,
    }));
  };

  const uploadFileToSupabase = async (file: File, folder: string): Promise<string | null> => {
    const supabase = createClient();
    const fileName = `${Date.now()}-${file.name}`;
    const filePath = `${folder}/${fileName}`;

    try {
      // Create the folder if it doesn't exist
      const { error: listError } = await supabase.storage
        .from("sponsorships")
        .list(folder);

      if (listError && listError.message !== "Bucket not found") {
        console.error("Error checking folder:", listError);
        return null;
      }

      const { error: uploadError } = await supabase.storage
        .from("sponsorships")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) {
        console.error("File upload failed:", uploadError.message);
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      const { data } = supabase.storage
        .from("sponsorships")
        .getPublicUrl(filePath);

      if (!data.publicUrl) {
        throw new Error("Failed to get public URL");
      }

      return data.publicUrl;
    } catch (error) {
      console.error("File upload error:", error);
      throw error;
    }
  };

  const handleSubmit = async () => {
    try {
      const budgetGoalInCents = Math.round(parseFloat(formData.budget_goal.toString()) * 100);
      const childData = {
        ...formData,
        budget_goal: budgetGoalInCents,
      };

      const response = await fetch('/api/sponsorships', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(childData),
      });

      if (!response.ok) {
        throw new Error('Failed to create child');
      }

      const newChild = await response.json();

      if (imageFiles.length > 0) {
        const imageUrls = [];
        for (const imageFile of imageFiles) {
          const imageUrl = await uploadFileToSupabase(imageFile, "images");
          if (imageUrl) imageUrls.push(imageUrl);
        }

        const imageRecords = imageUrls.map((url, index) => ({
          sponsorship_id: newChild.id,
          image_url: url,
          order_index: index
        }));

        const imagesResponse = await fetch('/api/sponsorships/images', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ images: imageRecords }),
        });

        if (!imagesResponse.ok) {
          throw new Error('Failed to create image records');
        }
      }

      if (videoFiles.length > 0) {
        const videoUrl = await uploadFileToSupabase(videoFiles[0], "videos");
        if (videoUrl) {
          const videoUpdateResponse = await fetch(`/api/sponsorships/${newChild.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...newChild,
              video_url: videoUrl
            }),
          });

          if (!videoUpdateResponse.ok) {
            throw new Error('Failed to update video URL');
          }
        }
      }

      setData(prevData => [...prevData, { ...newChild, budget_goal: centsToDollars(newChild.budget_goal) }]);
      setFormData({
        id: "",
        created_at: "",
        sponsorship_type: "CHILD",
        status: "ACTIVE",
        location_str: "",
        location_geo: null,
        story: "",
        budget_goal: 0,
        budget_raised: 0,
        monthly_support_cost: 0,
        name: "",
        birth_date: "",
        gender: "",
        biography: "",
        country: "",
        video_url: "",
        introduction: "",
      });
      setImageFiles([]);
      setVideoFiles([]);

      return true;
    } catch (error) {
      console.error("Error creating child:", error);
      toaster.create({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create child",
        duration: 5000,
      });
      return false;
    }
  };

  const handleSave = async (updatedChild: ChildSponsorship) => {
    try {
      const response = await fetch(`/api/sponsorships/${updatedChild.id}`, {
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
      toaster.create({
        title: "No Selection",
        description: "No rows selected for deletion.",
        duration: 5000,
      });
      return;
    }

    setSelectedRowsForDeletion(selectedRows);
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    const childIds = selectedRowsForDeletion.map((row: Row<ChildSponsorship>) => row.original.id);

    try {
      const response = await fetch("/api/sponsorships/bulk-delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sponsorshipIds: childIds }),
      });

      if (!response.ok) {
        throw new Error("Bulk delete failed");
      }
      setData((prevData) =>
        prevData.filter((child) => !childIds.includes(child.id))
      );
      if (tableRef.current) {
        tableRef.current.getTableInstance().toggleAllRowsSelected(false);
      }
      
      setSelectedCount(0);
      setSelectedRowsForDeletion([]);
      
      toaster.create({
        title: "Success",
        description: "Selected children deleted successfully.",
        duration: 5000,
      });
    } catch (error) {
      console.error("Bulk delete error:", error);
      toaster.create({
        title: "Error",
        description: "Bulk delete failed. Please try again.",
        duration: 5000,
      });
    } finally {
      setIsDeleteDialogOpen(false);
    }
  };

  const handleDelete = async (childId: string) => {
    try {
      const response = await fetch(`/api/sponsorships/${childId}`, {
        method: 'DELETE',
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
            formData={formData}
            isDrawerOpen={isCreateDrawerOpen}
            setIsDrawerOpen={setIsCreateDrawerOpen}
            setFormData={setFormData}
            handleInputChange={handleInputChange}
            handleSelectChange={handleSelectChange}
            handleLocationSelect={handleLocationSelect}
            handleSubmit={handleSubmit}
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
              setData((prevData) => [
                ...prevData,
                ...newChildren.map(child => ({
                  ...child,
                  id: child.id ?? "",
                  created_at: child.created_at ?? "",
                }))
              ]);
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
          setSelectedChild(data as ChildSponsorship);
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
      <DeleteDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        itemCount={selectedRowsForDeletion.length}
      />
    </Box>
  );
};

export default ChildrenTable;

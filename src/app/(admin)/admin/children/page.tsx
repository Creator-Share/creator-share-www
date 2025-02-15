"use client";
import React, { useEffect, useState } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { columns } from "./columns";
import { SponsorPeople, Geography } from "@/types/admin.types";
import { createClient } from "@/utils/supabase/client";
import dynamic from "next/dynamic";
import { centsToDollars } from "@/utils/currency";

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), { ssr: false });
const EditDrawer = dynamic(() => import("./components/EditDrawer"), { ssr: false });

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

  const handleRowClick = (row: SponsorPeople) => {
    setSelectedChild(row);
    setIsEditDrawerOpen(true);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto h-[calc(100vh-200px)] mt-12">
      <div className="grid grid-cols-2 mb-2">
        <h1 className="text-3xl font-semibold leading-9">Children</h1>
        <div className="justify-self-end">
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
        </div>
      </div>
      <DataTable
        columns={columns as ColumnDef<unknown, unknown>[]}
        data={data}
        controls="bottom"
        onRowClick={(data: unknown) => handleRowClick(data as SponsorPeople)}
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
    </div>
  );
};

export default ChildrenTable;

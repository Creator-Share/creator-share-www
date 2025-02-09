"use client";
import React, { useEffect, useState } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { columns } from "./columns";
import { People, Geography } from "@/types/admin.types";
import { createClient } from "@/utils/supabase/client";
import dynamic from "next/dynamic";
import { centsToDollars } from "@/utils/currency";

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), { ssr: false });
const EditDrawer = dynamic(() => import("./components/EditDrawer"), { ssr: false });

const ChildrenTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<People[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [formData, setFormData] = useState<People>({
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
    video_url: ""
  });
  const [formDataEdit, setFormDataEdit] = useState<People>({
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
    video_url: ""
  });

  const [selectedChild, setSelectedChild] = useState<People | null>(null);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const { data: fetchedData, error } = await supabase.from("people").select("*");

      if (error) {
        console.error("Error fetching people:", error);
      } else if (fetchedData) {
        const formattedData = fetchedData.map((child) => ({
          ...child,
          budget_goal: (child.budget_goal / 100).toFixed(2),
        }));

        setData(formattedData);
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
    console.log("Submitting Data:", formData);

    const uploadedImageUrl = imageFiles.length > 0 ? await uploadFileToSupabase(imageFiles[0], "images") : "";
    const uploadedVideoUrl = videoFiles.length > 0 ? await uploadFileToSupabase(videoFiles[0], "videos") : "";

    const budgetGoalInCents = Math.round(parseFloat(formData.budget_goal.toString()) * 100);

    const updatedFormData = {
      ...formData,
      budget_goal: budgetGoalInCents,
      image_url: uploadedImageUrl,
      video_url: uploadedVideoUrl,
    };

    console.log("Submitting Data:", updatedFormData);

    const supabase = createClient();
    const { data: newChild, error } = await supabase.from("people").insert([updatedFormData]).select().single();

    if (error) {
      console.error("Error adding child:", error);
    } else {
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
      });
      setImageFiles([]);
      setVideoFiles([]);
      console.log("About to close drawer - setting isCreateDrawerOpen to false");
      setIsCreateDrawerOpen(false);
      console.log("Drawer state after setting to false:", isCreateDrawerOpen);
    }
  };

  const handleSave = async (updatedChild: People) => {
    const supabase = createClient();
    const { error } = await supabase.from("people").update(updatedChild).eq('id', updatedChild.id);

    if (error) {
        console.error("Error updating child:", error);
    } else {
        setData((prevData) => prevData.map(child => 
            child.id === updatedChild.id 
                ? { ...updatedChild, budget_goal: parseFloat(centsToDollars(updatedChild.budget_goal)) }
                : child
        ));
        setIsEditDrawerOpen(false);
    }
  };

  const handleDelete = async (childId: string) => {
    const supabase = createClient();
    const { error } = await supabase.from("people").delete().eq('id', childId);

    if (error) {
      console.error("Error deleting child:", error);
    } else {
      console.log("Child deleted successfully!");
      setData((prevData) => prevData.filter(child => child.id !== childId));
      setIsEditDrawerOpen(false);
    }
  };

  const handleRowClick = (row: People) => {
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
        onRowClick={(data: unknown) => handleRowClick(data as People)}
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

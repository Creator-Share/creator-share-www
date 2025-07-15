"use client";
import React, { useEffect, useState, useRef } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef, Row } from "@tanstack/react-table";
import { columns } from "./columns";
import { AnimalBeneficiary, Gender, Status } from "@/types/admin.types";
import { centsToDollars, dollarsToCents } from "@/utils/currency";
import { Box, Button, Text } from "@chakra-ui/react";
import { MdDeleteOutline } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";

import CreateDrawer from "./components/CreateDrawer";
import EditDrawer from "./components/EditDrawer";
import DeleteDialog from "./components/DeleteDialog";
import GoBackButton from "@/components/ui/goBack";

type TableInstance = {
  getSelectedRowModel: () => { rows: Row<AnimalBeneficiary>[] };
  getTableInstance: () => { toggleAllRowsSelected: (value: boolean) => void };
};

const AnimalsTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnimalBeneficiary[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [formData, setFormData] = useState<AnimalBeneficiary>({
    name: "",
    username: "",
    gender: "Boy",
    birth_date: "",
    biography: "",
    introduction: "",
    budget_goal: "",
    budget_raised: 0,
    status: "New",
    country: "",
    location_str: "",
    beneficiary_type: "ANIMAL",
    metadata: {
      breed: "",
      animal_type: "",
    },
  });
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [formDataEdit, setFormDataEdit] = useState<AnimalBeneficiary>({
    name: "",
    username: "",
    gender: "Boy",
    birth_date: "",
    biography: "",
    introduction: "",
    budget_goal: "",
    budget_raised: 0,
    status: "New",
    country: "",
    location_str: "",
    beneficiary_type: "ANIMAL",
    metadata: {
      breed: "",
      animal_type: "",
    },
  });
  const [selectedCount, setSelectedCount] = useState(0);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedRowsForDeletion, setSelectedRowsForDeletion] = useState<Row<AnimalBeneficiary>[]>([]);
  const tableRef = useRef<TableInstance | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/admin/beneficiaries/retrieve?beneficiary_type=ANIMAL');
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const fetchedData = await response.json();
        const animalsArr = Array.isArray(fetchedData.beneficiaries) ? fetchedData.beneficiaries : [];
        setData(animalsArr.map((animal: AnimalBeneficiary) => {
          const metadata = animal.metadata || {};
          return {
            ...animal,
            budget_goal: String(centsToDollars(typeof animal.budget_goal === 'string' ? parseInt(animal.budget_goal) : animal.budget_goal)),
            metadata: {
              ...metadata,
              breed: metadata.breed || "",
              animal_type: metadata.animal_type || "",
            }
          };
        }));
      } catch (error) {
        console.error("Error fetching animals:", error);
        toaster.create({
          title: "Error",
          description: "Failed to load animals. Please refresh the page.",
          duration: 5000,
        });
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'breed' || name === 'animal_type') {
      setFormData((prev: AnimalBeneficiary) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          [name]: value
        }
      }));
    } else {
      setFormData((prev: AnimalBeneficiary) => ({ ...prev, [name]: value }));
    }
  };

  const handleSelectChange = (name: string, value: string) => {
    if (name === 'animal_type') {
      setFormData((prev: AnimalBeneficiary) => ({
        ...prev,
        metadata: {
          ...prev.metadata,
          [name]: value
        }
      }));
    } else {
      setFormData((prev: AnimalBeneficiary) => ({ ...prev, [name]: value }));
    }
  };

  const handleDrawerClose = () => {
    setIsCreateDrawerOpen(false);
    setFormData({
      name: "",
      username: "",
      gender: "Boy",
      birth_date: "",
      biography: "",
      introduction: "",
      budget_goal: "",
      budget_raised: 0,
      status: "New",
      country: "",
      location_str: "",
      beneficiary_type: "ANIMAL",
      metadata: {
        breed: "",
        animal_type: "",
      },
    });
  };

  const handleSubmit = async () => {
    try {
      // Extract everything except metadata
      const { metadata, ...formFields } = formData;
      
      const animalData = {
        ...formFields,
        name: formData.name || "Unnamed Animal",
        username: formData.username || "",
        biography: formData.biography || "",
        introduction: formData.introduction || "",
        budget_goal: Math.round(Number(formData.budget_goal) * 100) || 0,
        budget_raised: Number(formData.budget_raised) || 0,
        status: "New",
        country: formData.country || "Unknown Country",
        location_str: formData.location_str || "Unknown Location",
        location_geo: null,
        video_url: "",
        active_subscriptions: 0,
        beneficiary_type: "ANIMAL",
        metadata: {
          ...(metadata || {}),
          breed: metadata?.breed || "",
          animal_type: metadata?.animal_type || "",
        },
      };
      const response = await fetch("/api/admin/beneficiaries/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(animalData),
      });
      const responseData = await response.json();
      if (!response.ok || !responseData.beneficiary) {
        throw new Error(responseData.error || "Failed to create animal beneficiary");
      }
      const { beneficiary } = responseData;
      
      // Add the new animal to the data array first
      setData((prev: AnimalBeneficiary[]) => [
        ...prev,
        { 
          ...beneficiary, 
          budget_goal: String(dollarsToCents(typeof beneficiary.budget_goal === 'string' ? parseInt(beneficiary.budget_goal) : beneficiary.budget_goal)),
          video_url: beneficiary.video_url || ""
        },
      ]);

      if (imageFiles.length > 0 && beneficiary.id) {
        const supabase = (await import("@/utils/supabase/client")).createClient();
        const imageUrls: string[] = [];
        for (const imageFile of imageFiles) {
          const fileName = `${Date.now()}-${imageFile.name}`;
          const filePath = `images/${fileName}`;
          const { error: uploadError } = await supabase.storage
            .from("beneficiaries")
            .upload(filePath, imageFile, {
              cacheControl: "3600",
              upsert: false,
            });
          if (uploadError) {
            console.error("File upload failed:", uploadError.message);
            continue;
          }
          const { data: urlData } = supabase.storage
            .from("beneficiaries")
            .getPublicUrl(filePath);
          if (urlData?.publicUrl) {
            imageUrls.push(urlData.publicUrl);
          }
        }
        if (imageUrls.length > 0) {
          await fetch("/api/admin/beneficiaries/images/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              images: imageUrls.map((url, index) => ({
                beneficiary_id: beneficiary.id,
                image_url: url,
                order_index: index,
              })),
              beneficiary_type: "ANIMAL",
            }),
          });
        }
      }

      // Upload video to Supabase storage and update animal record
      if (videoFiles.length > 0 && beneficiary.id) {
        const supabase = (await import("@/utils/supabase/client")).createClient();
        const videoFile = videoFiles[0];
        const fileName = `${Date.now()}-${videoFile.name}`;
        const filePath = `videos/${fileName}`;
        const { error: uploadError } = await supabase.storage
          .from("beneficiaries")
          .upload(filePath, videoFile, {
            cacheControl: "3600",
            upsert: false,
          });
        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from("beneficiaries")
            .getPublicUrl(filePath);
          if (urlData?.publicUrl) {
            const videoResponse = await fetch("/api/admin/beneficiaries/update/" + beneficiary.id, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                video_url: urlData.publicUrl,
                beneficiary_type: "ANIMAL",
              }),
            });
            if (videoResponse.ok) {
              const updatedData = await videoResponse.json();
              if (updatedData.beneficiary) {
                const updatedAnimal = updatedData.beneficiary;
                setData((prev: AnimalBeneficiary[]) => prev.map(a => 
                  a.id === updatedAnimal.id 
                    ? { 
                        ...updatedAnimal, 
                        budget_goal: String(dollarsToCents(updatedAnimal.budget_goal)),
                        video_url: updatedAnimal.video_url || ""
                      }
                    : a
                ));
                setImageFiles([]);
                setVideoFiles([]);
                handleDrawerClose();
                toaster.create({
                  title: "Success",
                  description: "Animal created successfully.",
                  duration: 5000,
                });
                return true;
              }
            }
          }
        }
      }

      if (!videoFiles.length) {
        setImageFiles([]);
        setVideoFiles([]);
        handleDrawerClose();
        toaster.create({
          title: "Success",
          description: "Animal created successfully.",
          duration: 5000,
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error("Error creating animal beneficiary:", error);
      toaster.create({
        title: "Error",
        description: "Failed to create animal. Please try again.",
        duration: 5000,
      });
      return false;
    }
  };

  const handleEditDrawerOpen = (animal: AnimalBeneficiary) => {
    setFormDataEdit({
      ...animal,
      budget_goal: String(
        centsToDollars(
          animal.budget_goal && typeof animal.budget_goal === "number"
            ? animal.budget_goal
            : Number(animal.budget_goal)
        )
      ),
      birth_date: animal.birth_date || "",
      gender: (animal.gender as Gender) || "Boy",
      status: (animal.status as Status) || "New",
      metadata: {
        ...(animal.metadata || {}),
        breed: animal.metadata?.breed || "",
        animal_type: animal.metadata?.animal_type || "",
      },
    });
    setIsEditDrawerOpen(true);
  };

  const handleEditDrawerClose = () => {
    setIsEditDrawerOpen(false);
    setFormDataEdit({
      name: "",
      username: "",
      gender: "Boy",
      birth_date: "",
      biography: "",
      introduction: "",
      budget_goal: "",
      budget_raised: 0,
      status: "New",
      country: "",
      location_str: "",
      beneficiary_type: "ANIMAL",
      metadata: {
        breed: "",
        animal_type: "",
      },
    });
  };

  const handleSave = async (updatedAnimal: AnimalBeneficiary) => {
    try {
      // Extract everything except metadata
      const { metadata, ...formFields } = updatedAnimal;
      
      const animalData = {
        ...formFields,
        budget_goal: Math.round(Number(updatedAnimal.budget_goal) * 100),
        metadata: {
          ...(metadata || {}),
          breed: metadata?.breed || "",
          animal_type: metadata?.animal_type || "",
        },
      };
      const response = await fetch(`/api/admin/beneficiaries/update/${updatedAnimal.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...animalData, beneficiary_type: "ANIMAL" }),
      });
      if (!response.ok) {
        throw new Error("Failed to update animal beneficiary");
      }
      const { beneficiary } = await response.json();
      if (!beneficiary) {
        throw new Error("No animal data returned from update endpoint");
      }
      setData((prev: AnimalBeneficiary[]) =>
        prev.map((a) =>
          a.id === beneficiary.id
            ? { 
                ...beneficiary, 
                budget_goal: Number(beneficiary.budget_goal),
                video_url: beneficiary.video_url || ""
              }
            : a
        )
      );
      handleEditDrawerClose();
      toaster.create({
        title: "Success",
        description: "Animal updated successfully.",
        duration: 5000,
      });
    } catch (error) {
      console.error("Error updating animal beneficiary:", error);
      toaster.create({
        title: "Error",
        description: "Failed to update animal. Please try again.",
        duration: 5000,
      });
    }
  };

  const handleDelete = async (animalId: string) => {
    try {
      const response = await fetch(`/api/admin/beneficiaries/delete/${animalId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete animal beneficiary");
      }
      setData((prev: AnimalBeneficiary[]) => prev.filter((a) => a.id !== animalId));
      handleEditDrawerClose();
      toaster.create({
        title: "Success",
        description: "Animal deleted successfully.",
        duration: 5000,
      });
    } catch (error) {
      console.error("Error deleting animal beneficiary:", error);
      toaster.create({
        title: "Error",
        description: "Failed to delete animal. Please try again.",
        duration: 5000,
      });
    }
  };

  if (loading) {
    return <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>;
  }

  return (
    <Box className="container mx-auto h-[calc(100vh-200px)] mt-12">
      <GoBackButton />
      <Box className="grid grid-cols-2 mb-2">
        <Text className="text-3xl font-semibold leading-9">Animals</Text>
        <Box className="justify-self-end flex gap-3">
          <CreateDrawer
            formData={formData}
            setFormData={setFormData}
            isDrawerOpen={isCreateDrawerOpen}
            setIsDrawerOpen={setIsCreateDrawerOpen}
            handleInputChange={handleInputChange}
            handleSelectChange={handleSelectChange}
            handleSubmit={handleSubmit}
            handleDrawerClose={handleDrawerClose}
            imageFiles={imageFiles}
            setImageFiles={setImageFiles}
            videoFiles={videoFiles}
            setVideoFiles={setVideoFiles}
          />
          {selectedCount > 0 && (
            <Button
              onClick={() => {
                if (!tableRef.current) return;
                const selectedRowModel = tableRef.current.getSelectedRowModel();
                setSelectedRowsForDeletion(selectedRowModel.rows);
                setIsDeleteDialogOpen(true);
              }}
              className="border-[2px] border-[#E0E0E0] bg-red-500 text-white w-fit h-[40px] px-4"
            >
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
          const animal = data as AnimalBeneficiary;
          handleEditDrawerOpen(animal);
        }}
      />
      {isEditDrawerOpen && (
        <EditDrawer
          formDataEdit={formDataEdit}
          setFormDataEdit={setFormDataEdit}
          isDrawerOpen={isEditDrawerOpen}
          onClose={handleEditDrawerClose}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
      <DeleteDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={async () => {
          const animalIds = selectedRowsForDeletion.map((row) => row.original.id);
          try {
            const response = await fetch("/api/admin/beneficiaries/bulk-delete", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ beneficiary_type: "ANIMAL", ids: animalIds }),
            });
            if (!response.ok) {
              throw new Error("Bulk delete failed");
            }
            setData((prev: AnimalBeneficiary[]) => prev.filter((a) => !animalIds.includes(a.id)));
            setSelectedRowsForDeletion([]);
            setSelectedCount(0);
            setIsDeleteDialogOpen(false);
            toaster.create({
              title: "Success",
              description: "Selected animals deleted successfully.",
              duration: 5000,
            });
          } catch (error) {
            console.error("Bulk delete error:", error);
            toaster.create({
              title: "Error",
              description: "Bulk delete failed. Please try again.",
              duration: 5000,
            });
          }
        }}
        itemCount={selectedRowsForDeletion.length}
      />
    </Box>
  );
};

export default AnimalsTable;

"use client";
import React, { useEffect, useState, useRef } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef, Row } from "@tanstack/react-table";
import { columns } from "./columns";
import { AnimalBeneficiary } from "@/types/admin.types";
import { centsToDollars, dollarsToCents } from "@/utils/currency";
import { Box, Button, Text } from "@chakra-ui/react";
import { MdDeleteOutline } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";

import CreateDrawer from "./components/CreateDrawer";
import EditDrawer from "./components/EditDrawer";
import DeleteDialog from "./components/DeleteDialog";

type TableInstance = {
  getSelectedRowModel: () => { rows: Row<AnimalBeneficiary>[] };
  getTableInstance: () => { toggleAllRowsSelected: (value: boolean) => void };
};

type AnimalFormState = Omit<AnimalBeneficiary, "budget_goal" | "birth_date" | "gender"> & {
  budget_goal: string;
  birth_date: string;
  gender: string;
};

const AnimalsTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnimalBeneficiary[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [formData, setFormData] = useState<AnimalFormState>({
    id: "",
    name: "",
    username: "",
    gender: "",
    birth_date: "",
    biography: "",
    introduction: "",
    budget_goal: "",
    budget_raised: 0,
    status: "",
    country: "",
    location_str: "",
    beneficiary_type: "ANIMAL",
    metadata: {},
    breed: "",
    animal_type: "",
  });
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [formDataEdit, setFormDataEdit] = useState<AnimalFormState>({
    id: "",
    name: "",
    username: "",
    gender: "",
    birth_date: "",
    biography: "",
    introduction: "",
    budget_goal: "",
    budget_raised: 0,
    status: "",
    country: "",
    location_str: "",
    beneficiary_type: "ANIMAL",
    metadata: {},
    breed: "",
    animal_type: "",
  });
  const [selectedCount, setSelectedCount] = useState(0);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedRowsForDeletion, setSelectedRowsForDeletion] = useState<Row<AnimalBeneficiary>[]>([]);
  const tableRef = useRef<TableInstance | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await fetch('/api/admin/animals/retrieve');
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const fetchedData = await response.json();
        const animalsArr = Array.isArray(fetchedData.animals) ? fetchedData.animals : [];
        type AnimalMetadata = { breed?: string; animal_type?: string };
        setData(animalsArr.map((animal: AnimalBeneficiary) => ({
          ...animal,
          budget_goal: String(centsToDollars(animal.budget_goal)),
          breed: animal.breed || (animal.metadata && (animal.metadata as AnimalMetadata).breed) || "",
          animal_type: animal.animal_type || (animal.metadata && (animal.metadata as AnimalMetadata).animal_type) || "",
        })));
      } catch (error) {
        console.error("Error fetching animals:", error);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: keyof AnimalBeneficiary, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleDrawerClose = () => {
    setIsCreateDrawerOpen(false);
    setFormData({
      id: "",
      name: "",
      username: "",
      gender: "",
      birth_date: "",
      biography: "",
      introduction: "",
      budget_goal: "",
      budget_raised: 0,
      status: "",
      country: "",
      location_str: "",
      beneficiary_type: "ANIMAL",
      metadata: {},
      breed: "",
      animal_type: "",
    });
  };

  const handleSubmit = async () => {
    try {
      const animalData = {
        ...formData,
        budget_goal: Math.round(Number(formData.budget_goal) * 100),
        metadata: {
          breed: formData.breed,
          animal_type: formData.animal_type,
        },
      };
      const response = await fetch("/api/admin/animals/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(animalData),
      });
      if (!response.ok) {
        throw new Error("Failed to create animal beneficiary");
      }
      const { animal } = await response.json();

      // Upload images to Supabase storage and insert media records
      if (imageFiles.length > 0) {
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
          await fetch("/api/admin/animals/images/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              images: imageUrls.map((url, index) => ({
                beneficiary_id: animal.id,
                image_url: url,
                order_index: index,
              })),
            }),
          });
        }
      }

      // Upload video to Supabase storage and update animal record
      if (videoFiles.length > 0) {
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
            await fetch("/api/admin/animals/update", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: animal.id,
                video_url: urlData.publicUrl,
              }),
            });
          }
        }
      }

      setData((prev) => [
        ...prev,
        { ...animal, budget_goal: String(dollarsToCents(animal.budget_goal)) },
      ]);
      setImageFiles([]);
      setVideoFiles([]);
      handleDrawerClose();
      return true;
    } catch (error) {
      console.error("Error creating animal beneficiary:", error);
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
      breed: animal.breed || animal.metadata?.breed || "",
      animal_type: animal.animal_type || animal.metadata?.animal_type || "",
      birth_date: animal.birth_date || "",
      gender: animal.gender || "",
    });
    setIsEditDrawerOpen(true);
  };

  const handleEditDrawerClose = () => {
    setIsEditDrawerOpen(false);
    setFormDataEdit({
      id: "",
      name: "",
      username: "",
      gender: "",
      birth_date: "",
      biography: "",
      introduction: "",
      budget_goal: "",
      budget_raised: 0,
      status: "",
      country: "",
      location_str: "",
      beneficiary_type: "ANIMAL",
      metadata: {},
      breed: "",
      animal_type: "",
    });
  };

  const handleSave = async (updatedAnimal: AnimalFormState) => {
    try {
      const animalData = {
        ...updatedAnimal,
        budget_goal: Math.round(Number(updatedAnimal.budget_goal) * 100),
        metadata: {
          breed: updatedAnimal.breed,
          animal_type: updatedAnimal.animal_type,
        },
      };
      const response = await fetch(`/api/admin/animals/update/${updatedAnimal.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(animalData),
      });
      if (!response.ok) {
        throw new Error("Failed to update animal beneficiary");
      }
      const { animal } = await response.json();
      setData((prev) =>
        prev.map((a) =>
          a.id === animal.id
            ? { ...animal, budget_goal: Number(animal.budget_goal) }
            : a
        )
      );
      handleEditDrawerClose();
    } catch (error) {
      console.error("Error updating animal beneficiary:", error);
    }
  };

  const handleDelete = async (animalId: string) => {
    try {
      const response = await fetch(`/api/admin/animals/delete/${animalId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete animal beneficiary");
      }
      setData((prev) => prev.filter((a) => a.id !== animalId));
      handleEditDrawerClose();
    } catch (error) {
      console.error("Error deleting animal beneficiary:", error);
    }
  };

  if (loading) {
    return <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>;
  }

  return (
    <Box className="container mx-auto h-[calc(100vh-200px)] mt-12">
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
            const response = await fetch("/api/admin/animals/bulk-delete", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ animalIds }),
            });
            if (!response.ok) {
              throw new Error("Bulk delete failed");
            }
            setData((prev) => prev.filter((a) => !animalIds.includes(a.id)));
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

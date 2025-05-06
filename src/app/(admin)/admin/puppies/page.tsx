"use client";
import React, { useEffect, useState, useRef } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef, Row } from "@tanstack/react-table";
import { columns } from "./columns";
import { Box, Button, Text } from "@chakra-ui/react";
import { MdDeleteOutline } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";
import { Puppy } from "./columns";
import dynamic from "next/dynamic";

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), { ssr: false });
const EditDrawer = dynamic(() => import("./components/EditDrawer"), { ssr: false });
const DeleteDialog = dynamic(() => import("./components/DeleteDialog"), { ssr: false });

type TableInstance = {
  getSelectedRowModel: () => { rows: Row<Puppy>[] };
  getTableInstance: () => { toggleAllRowsSelected: (value: boolean) => void };
};

const PuppiesTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Puppy[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [formData, setFormData] = useState<Puppy>({
    id: "",
    name: "",
    age: 0,
    breed: "",
    status: "available",
    created_at: new Date().toISOString()
  });

  const [selectedPuppy, setSelectedPuppy] = useState<Puppy | null>(null);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedRowsForDeletion, setSelectedRowsForDeletion] = useState<Row<Puppy>[]>([]);
  const tableRef = useRef<TableInstance | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // TODO: Replace with actual API endpoint
        const mockData: Puppy[] = [
          {
            id: "1",
            name: "Max",
            age: 2,
            breed: "Golden Retriever",
            status: "available",
            created_at: new Date().toISOString()
          }
        ];
        setData(mockData);
      } catch (error) {
        console.error("Error fetching puppies:", error);
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

  const handleSubmit = async () => {
    try {
      // TODO: Replace with actual API endpoint
      setData(prevData => [...prevData, { ...formData, id: Date.now().toString() }]);
      setFormData({
        id: "",
        name: "",
        age: 0,
        breed: "",
        status: "available",
        created_at: new Date().toISOString()
      });
      setImageFiles([]);
      return true;
    } catch (error) {
      console.error("Error creating puppy:", error);
      toaster.create({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create puppy",
        duration: 5000,
      });
      return false;
    }
  };

  const handleSave = async (updatedPuppy: Puppy) => {
    try {
      // TODO: Replace with actual API endpoint
      setData((prevData) => prevData.map(puppy =>
        puppy.id === updatedPuppy.id ? updatedPuppy : puppy
      ));
      setIsEditDrawerOpen(false);
    } catch (error) {
      console.error("Error updating puppy:", error);
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
    const puppyIds = selectedRowsForDeletion.map((row: Row<Puppy>) => row.original.id);

    try {
      // TODO: Replace with actual API endpoint
      setData((prevData) =>
        prevData.filter((puppy) => !puppyIds.includes(puppy.id))
      );
      if (tableRef.current) {
        tableRef.current.getTableInstance().toggleAllRowsSelected(false);
      }
      
      setSelectedCount(0);
      setSelectedRowsForDeletion([]);
      
      toaster.create({
        title: "Success",
        description: "Selected puppies deleted successfully.",
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

  const handleDelete = async (puppyId: string) => {
    try {
      // TODO: Replace with actual API endpoint
      setData((prevData) => prevData.filter(puppy => puppy.id !== puppyId));
      setIsEditDrawerOpen(false);
    } catch (error) {
      console.error("Error deleting puppy:", error);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <Box className="container mx-auto h-[calc(100vh-200px)] mt-12">
      <Box className="grid grid-cols-2 mb-2">
        <Text className="text-3xl font-semibold leading-9">Puppies</Text>
        <Box className="justify-self-end flex gap-3">
          <CreateDrawer
            formData={formData}
            isDrawerOpen={isCreateDrawerOpen}
            setIsDrawerOpen={setIsCreateDrawerOpen}
            setFormData={setFormData}
            handleInputChange={handleInputChange}
            handleSelectChange={handleSelectChange}
            handleSubmit={handleSubmit}
            imageFiles={imageFiles}
            setImageFiles={setImageFiles}
            handleDrawerClose={() => setIsCreateDrawerOpen(false)}
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
          setSelectedPuppy(data as Puppy);
          setIsEditDrawerOpen(true);
        }}
      />
      {isEditDrawerOpen && selectedPuppy && (
        <EditDrawer
          selectedPuppy={selectedPuppy}
          formData={formData}
          setFormData={setFormData}
          isDrawerOpen={isEditDrawerOpen}
          onClose={() => setIsEditDrawerOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          imageFiles={imageFiles}
          setImageFiles={setImageFiles}
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

export default PuppiesTable;

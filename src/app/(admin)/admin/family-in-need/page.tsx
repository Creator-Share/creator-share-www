"use client";
import React, { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef, Row } from "@tanstack/react-table";
import { columns } from "./columns";
import dynamic from "next/dynamic";
// import BulkUploadDrawer from "./components/BulkUploadDrawer";
import { Box, Button, Text } from "@chakra-ui/react";
import { MdDeleteOutline } from "react-icons/md";
import { toaster } from "@/components/ui/toaster";
import DeleteDialog from "./components/DeleteDialog";
import { useBeneficiaryStore } from "@/store/beneficiaryStore";
import { Beneficiaries } from "@/types/admin.types";
import { dollarsToCents } from "@/utils/currency";
import GoBackButton from "@/components/ui/goBack";

const CreateDrawer = dynamic(() => import("./components/CreateDrawer"), { ssr: false });
const EditDrawer = dynamic(() => import("./components/EditDrawer"), { ssr: false });

type TableInstance = {
  getSelectedRowModel: () => { rows: Row<Beneficiaries>[] };
  getTableInstance: () => { toggleAllRowsSelected: (value: boolean) => void };
};

const FamilyInNeedTable = () => {
  const {
    data,
    loading,
    formData,
    formDataEdit,
    selectedBeneficiary,
    imageFiles,
    videoFiles,
    selectedRowsForDeletion,
    setFormData,
    setFormDataEdit,
    setSelectedBeneficiary,
    setImageFiles,
    setVideoFiles,
    setSelectedRowsForDeletion,
    fetchBeneficiaries,
    createBeneficiary,
    updateBeneficiary,
    deleteBeneficiary,
    bulkDelete,
  } = useBeneficiaryStore();

  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  // const [isBulkUploadDrawerOpen, setIsBulkUploadDrawerOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const tableRef = useRef<TableInstance | null>(null);

  useEffect(() => {
    fetchBeneficiaries("FAMILY");
  }, [fetchBeneficiaries]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    // Convert budget_goal to number if it's the budget field
    const processedValue = name === 'budget_goal' ? parseFloat(value) || 0 : value;
    setFormData({ ...formData, [name]: processedValue });
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData({ ...formData, [name]: value });
  };

  const handleLocationSelect = (geo: [number, number] | null, locationStr: string, country: string) => {
    setFormData({
      ...formData,
      location_geo: geo ? { type: "Point", coordinates: [geo[1], geo[0]] } : null,
      location_str: locationStr,
      country,
    });
  };

  const handleSubmit = async (): Promise<boolean> => {
    // Convert budget_goal to cents before submission
    const formDataWithCents = {
      ...formData,
      budget_goal: parseInt(dollarsToCents(formData.budget_goal || 0))
    };
    const success = await createBeneficiary("FAMILY", formDataWithCents, imageFiles, videoFiles);
    if (success) {
      setIsCreateDrawerOpen(false);
      toaster.create({
        title: "Success",
        description: "Family in Need created successfully.",
        duration: 5000,
      });
      return true;
    } else {
      toaster.create({
        title: "Error",
        description: "Failed to create beneficiary",
        duration: 5000,
      });
      return false;
    }
  };

  const handleSave = async (updated: Partial<Beneficiaries>) => {
    await updateBeneficiary("FAMILY", updated);
    setIsEditDrawerOpen(false);
    toaster.create({
      title: "Success",
      description: "Family in Need updated successfully.",
      duration: 5000,
    });
  };

  const handleBulkDelete = () => {
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
    setSelectedRowsForDeletion(selectedRows.map((row) => row.original));
    setIsDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    const beneficiaryIds = selectedRowsForDeletion.map((b) => b.id).filter((id): id is string => typeof id === "string");
    await bulkDelete("FAMILY", beneficiaryIds);
    if (tableRef.current) {
      tableRef.current.getTableInstance().toggleAllRowsSelected(false);
    }
    setSelectedCount(0);
    setSelectedRowsForDeletion([]);
    setIsDeleteDialogOpen(false);
    toaster.create({
      title: "Success",
      description: "Selected beneficiaries deleted successfully.",
      duration: 5000,
    });
  };

  const handleDelete = async (beneficiaryId: string) => {
    await deleteBeneficiary("FAMILY", beneficiaryId);
    setIsEditDrawerOpen(false);
    toaster.create({
      title: "Success",
      description: "Family in Need deleted successfully.",
      duration: 5000,
    });
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
        <Text className="text-3xl font-semibold leading-9">Manage Families in Need</Text>
        <Box className="justify-self-end flex gap-3">
          <CreateDrawer
            formData={formData as Partial<Beneficiaries>}
            isDrawerOpen={isCreateDrawerOpen}
            setIsDrawerOpen={setIsCreateDrawerOpen}
            setFormData={(value) =>
              typeof value === "function"
                ? setFormData(value(formData))
                : setFormData(value)
            }
            handleInputChange={handleInputChange}
            handleSelectChange={handleSelectChange}
            handleLocationSelect={handleLocationSelect}
            handleSubmit={handleSubmit}
            imageFiles={imageFiles}
            setImageFiles={(value) =>
              typeof value === "function"
                ? setImageFiles(value(imageFiles))
                : setImageFiles(value)
            }
            videoFiles={videoFiles}
            setVideoFiles={(value) =>
              typeof value === "function"
                ? setVideoFiles(value(videoFiles))
                : setVideoFiles(value)
            }
            handleDrawerClose={() => setIsCreateDrawerOpen(false)}
          />
          {/* <BulkUploadDrawer
            isDrawerOpen={isBulkUploadDrawerOpen}
            setIsDrawerOpen={setIsBulkUploadDrawerOpen}
            onUploadSuccess={() => {
              fetchBeneficiaries("CHILD_LABORER");
            }}
          /> */}
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
          setSelectedBeneficiary(data as Beneficiaries);
          setIsEditDrawerOpen(true);
        }}
      />
      {isEditDrawerOpen && selectedBeneficiary && (
        <EditDrawer
          selectedBeneficiary={selectedBeneficiary}
          formDataEdit={formDataEdit as Partial<Beneficiaries>}
          setFormDataEdit={(value) =>
            typeof value === "function"
              ? setFormDataEdit(value(formDataEdit))
              : setFormDataEdit(value)
          }
          isDrawerOpen={isEditDrawerOpen}
          onClose={() => setIsEditDrawerOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
          imageFiles={imageFiles}
          setImageFiles={(value) =>
            typeof value === "function"
              ? setImageFiles(value(imageFiles))
              : setImageFiles(value)
          }
          videoFiles={videoFiles}
          setVideoFiles={(value) =>
            typeof value === "function"
              ? setVideoFiles(value(videoFiles))
              : setVideoFiles(value)
          }
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

export default FamilyInNeedTable;

"use client";
import React, { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef, Row } from "@tanstack/react-table";
import { columns } from "./columns";
import dynamic from "next/dynamic";
import { Box, Button, Text, Progress, Badge, Input } from "@chakra-ui/react";
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

const ChildrenTable = () => {
  const initialFormData: Beneficiaries = {
    name: "",
    username: "",
    gender: "Boy",
    birth_date: "",
    biography: "",
    budget_goal: 0,
    budget_raised: 0,
    status: "Draft",
    country: "",
    location_geo: null,
    location_str: "",
    video_url: "",
    introduction: "",
    active_subscriptions: 0,
    metadata: {},
    beneficiary_type: "CHILD"
  };

  const {
    data,
    loading,
    formData = initialFormData,
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
  const [selectedCount, setSelectedCount] = useState(0);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [mobileSearch, setMobileSearch] = useState("");
  const tableRef = useRef<TableInstance | null>(null);

  useEffect(() => {
    fetchBeneficiaries("CHILD");
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
    // Ensure all required fields are present before submitting
    if (!formData.name || !formData.username || !formData.gender || !formData.birth_date ||
      !formData.biography || !formData.status || !formData.country ||
      !formData.location_str || !formData.introduction) {
      toaster.create({
        title: "Error",
        description: "Please fill in all required fields",
        duration: 5000,
      });
      return false;
    }

    // Convert budget_goal to cents before submission
    const formDataWithCents = {
      ...formData,
      budget_goal: parseInt(dollarsToCents(formData.budget_goal || 0))
    };
    const success = await createBeneficiary("CHILD", formDataWithCents, imageFiles, videoFiles);
    if (success) {
      setIsCreateDrawerOpen(false);
      toaster.create({
        title: "Success",
        description: "Child created successfully.",
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
    await updateBeneficiary("CHILD", updated);
    setIsEditDrawerOpen(false);
    toaster.create({
      title: "Success",
      description: "Child updated successfully.",
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
    await bulkDelete("CHILD", beneficiaryIds);
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
    await deleteBeneficiary("CHILD", beneficiaryId);
    setIsEditDrawerOpen(false);
    toaster.create({
      title: "Success",
      description: "Child deleted successfully.",
      duration: 5000,
    });
  };

  if (loading) {
    return <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
      <div className="text-gray-500">Loading...</div>
    </div>;
  }

  return (
    <Box>
      <GoBackButton />
      <Box className="hidden md:block container mx-auto mt-12">

        <Box className="grid grid-cols-2 mb-2">
          <Text className="text-3xl font-semibold leading-9">Manage Children</Text>
          <Box className="justify-self-end flex gap-3">
            <CreateDrawer
              formData={formData}
              isDrawerOpen={isCreateDrawerOpen}
              setIsDrawerOpen={setIsCreateDrawerOpen}
              setFormData={(value) => {
                if (typeof value === 'function') {
                  const currentValue = value(formData);
                  setFormData(currentValue);
                } else {
                  setFormData(value);
                }
              }}
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
            selectedChild={selectedBeneficiary as Partial<Beneficiaries>}
            formDataEdit={formDataEdit as Partial<Beneficiaries>}
            setFormDataEdit={(value) => {
              if (typeof value === 'function') {
                const currentValue = value(formDataEdit);
                setFormDataEdit(currentValue);
              } else {
                setFormDataEdit(value);
              }
            }}
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
      <Box className="md:hidden">
        <Box className="container mx-auto p-4 space-y-4">
          <GoBackButton />
          <Text className="text-2xl font-semibold">Manage Children</Text>

          <Box className="flex gap-2">
            <CreateDrawer
              formData={formData}
              isDrawerOpen={isCreateDrawerOpen}
              setIsDrawerOpen={setIsCreateDrawerOpen}
              setFormData={(value) => {
                if (typeof value === 'function') {
                  const currentValue = value(formData);
                  setFormData(currentValue);
                } else {
                  setFormData(value);
                }
              }}
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
          </Box>

            <Input
              placeholder="Search by name or username"
              value={mobileSearch}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMobileSearch(e.target.value)}
              className="border"
              px={3}
              py={2}
            />

          <Box className="space-y-3">
            {data
              .filter((b) =>
                (b.name?.toLowerCase() || "").includes(mobileSearch.toLowerCase()) ||
                (b.username?.toLowerCase() || "").includes(mobileSearch.toLowerCase())
              )
              .map((b) => {
                const goal = Number(b.budget_goal || 0);
                const raised = Number(b.budget_raised || 0);
                const progress = goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0;
                return (
                  <Box key={b.id || b.username} className="border rounded-xl p-4 bg-white space-y-3">
                    <Box className="flex items-start justify-between gap-2">
                      <Box>
                        <Text className="text-lg font-semibold leading-6">{b.name}</Text>
                        <Text className="text-xs text-gray-500">@{b.username}</Text>
                      </Box>
                      <Badge colorPalette="blue">{b.status}</Badge>
                    </Box>

                    <Box className="text-sm text-gray-600">
                      <Text>{b.country}{b.location_str ? ` • ${b.location_str}` : ''}</Text>
                    </Box>

                    <Box className="space-y-1">
                      <Box className="flex justify-between text-sm">
                        <Text>Raised</Text>
                        <Text>
                          ${(b.budget_raised / 100).toFixed(2)} / ${(b.budget_goal / 100).toFixed(2)}
                        </Text>
                      </Box>
                      <Progress.Root value={progress}>
                        <Progress.Track className="rounded-xl h-2">
                          <Progress.Range className="bg-[#1C3C8C]" />
                        </Progress.Track>
                      </Progress.Root>
                    </Box>

                    <Box className="flex gap-2 pt-1">
                      <Button
                        className="flex-1 bg-[#1C3C8C] text-white"
                        onClick={() => {
                          setSelectedBeneficiary(b as Beneficiaries);
                          setIsEditDrawerOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                    </Box>
                  </Box>
                );
              })}
          </Box>

          <EditDrawer
            selectedChild={selectedBeneficiary as Partial<Beneficiaries>}
            formDataEdit={formDataEdit as Partial<Beneficiaries>}
            setFormDataEdit={(value) => {
              if (typeof value === 'function') {
                const currentValue = value(formDataEdit);
                setFormDataEdit(currentValue);
              } else {
                setFormDataEdit(value);
              }
            }}
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
        </Box>
      </Box>
    </Box>
  );
};

export default ChildrenTable;

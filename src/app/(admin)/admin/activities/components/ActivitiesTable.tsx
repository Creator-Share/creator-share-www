"use client";

import React, { useEffect, useState } from "react";
import { Button, useDisclosure } from "@chakra-ui/react";
import { CreateActivityModal, EditActivityModal, DeleteActivityModal } from "./ActivityModals";
import { getActivityColumns } from "./columns";
import { Activity } from "@/types/admin.types";
import { DataTable } from "@/components/admin-ui/Tables/data-table";

interface ActivitiesTableProps {
  beneficiaryType: string;
  beneficiaryId: string;
}

const ActivitiesTable: React.FC<ActivitiesTableProps> = ({
  beneficiaryType,
  beneficiaryId,
}) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  // Create Activity Modal State
  const { open, onOpen, onClose } = useDisclosure();
  const [newTitle, setNewTitle] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit Activity Modal State
  const [editOpen, setEditOpen] = useState(false);
  const [editActivity, setEditActivity] = useState<Activity | null>(null);
  const [editTitle, setEditTitle] = useState<string>("");
  const [editDescription, setEditDescription] = useState<string>("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  // Delete Activity State
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteActivity, setDeleteActivity] = useState<Activity | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleCreateActivity = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/activities/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          description: newDescription,
          beneficiary_id: beneficiaryId,
        }),
      });
      if (!res.ok) throw new Error("Failed to create activity");
      const data = await res.json();
      setActivities((prev) => [data.activity, ...prev]);
      setNewTitle("");
      setNewDescription("");
      onClose();
    } catch (e: Error | unknown) {
      setError(e instanceof Error ? e.message : "Failed to create activity");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    const fetchActivities = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          beneficiary_type: beneficiaryType,
          beneficiary_id: beneficiaryId,
        });
        const res = await fetch(`/api/admin/activities/retrieve?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch activities");
        const data = await res.json();
        setActivities(data.activities || []);
      } catch {
        setActivities([]);
      }
      setLoading(false);
    };
    if (beneficiaryId) {
      fetchActivities();
    }
  }, [beneficiaryType, beneficiaryId]);

  if (!beneficiaryId) {
    return (
      <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
        <div className="text-gray-500">No beneficiary selected.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
        <div>Loading activities...</div>
      </div>
    );
  }

  return (
    <div className="">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Activities</h3>
        <Button colorScheme="blue" size="sm" onClick={onOpen}>
          Create Activity
        </Button>
      </div>
      <DataTable
        columns={getActivityColumns({
          onEdit: (activity: Activity) => {
            setEditActivity(activity);
            setEditTitle(activity.title);
            setEditDescription(activity.description);
            setEditError(null);
            setEditOpen(true);
          },
          onDelete: (activity: Activity) => {
            setDeleteActivity(activity);
            setDeleteOpen(true);
          }
        })}
        data={activities}
        controls="bottom"
        tableHeight="h-64"
      />
      <CreateActivityModal
        open={open}
        onClose={onClose}
        title={newTitle}
        description={newDescription}
        onTitleChange={setNewTitle}
        onDescriptionChange={setNewDescription}
        onCreate={handleCreateActivity}
        creating={creating}
        error={error}
      />
      <EditActivityModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={editTitle}
        description={editDescription}
        onTitleChange={setEditTitle}
        onDescriptionChange={setEditDescription}
        onSave={async () => {
          setEditSaving(true);
          setEditError(null);
          try {
            if (!editActivity) return;
            const res = await fetch("/api/admin/activities/update", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: editActivity.id,
                title: editTitle,
                description: editDescription,
                beneficiary_id: editActivity.beneficiary_id,
              }),
            });
            if (!res.ok) throw new Error("Failed to update activity");
            const data = await res.json();
            setActivities((prev) =>
              prev.map((a) =>
                a.id === editActivity.id ? { ...a, ...data.activity } : a
              )
            );
            setEditOpen(false);
          } catch (e: Error | unknown) {
            setEditError(e instanceof Error ? e.message : "Failed to update activity");
          } finally {
            setEditSaving(false);
          }
        }}
        saving={editSaving}
        error={editError}
      />
      <DeleteActivityModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        activity={deleteActivity}
        onDelete={async () => {
          setDeleting(true);
          setDeleteError(null);
          try {
            if (!deleteActivity) return;
            const res = await fetch("/api/admin/activities/delete", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: deleteActivity.id })
            });
            if (!res.ok) throw new Error("Failed to delete activity");
            setActivities((prev) =>
              prev.filter((a) => a.id !== deleteActivity.id)
            );
            setDeleteOpen(false);
          } catch (e: Error | unknown) {
            setDeleteError(e instanceof Error ? e.message : "Failed to delete activity");
          } finally {
            setDeleting(false);
          }
        }}
        deleting={deleting}
        error={deleteError}
      />
    </div>
  );
};

export default ActivitiesTable;

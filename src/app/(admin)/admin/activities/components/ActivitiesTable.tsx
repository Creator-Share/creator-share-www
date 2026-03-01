"use client"

import React, { useCallback, useEffect, useState } from "react"
import { Button, useDisclosure } from "@chakra-ui/react"
import {
  CreateActivityModal,
  EditActivityModal,
  DeleteActivityModal,
} from "./ActivityModals"
import { getActivityColumns } from "./columns"
import { Activity } from "@/types/admin.types"
import { DataTable } from "@/components/admin-ui/Tables/data-table"
import { LogoLoader } from "@/components/common/LogoLoader"

interface ActivitiesTableProps {
  beneficiaryType: string
  beneficiaryId: string
  searchQuery?: string
  userRole?: string | null
}

const ActivitiesTable: React.FC<ActivitiesTableProps> = ({
  beneficiaryType,
  beneficiaryId,
  searchQuery = "",
  userRole = null,
}) => {
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  // Create Activity Modal State
  const { open, onOpen, onClose } = useDisclosure()
  const [newTitle, setNewTitle] = useState<string>("")
  const [newDescription, setNewDescription] = useState<string>("")
  const [newActivityType, setNewActivityType] = useState<string>("INFO")

  // Edit Activity Modal State
  const [editOpen, setEditOpen] = useState(false)
  const [editActivity, setEditActivity] = useState<Activity | null>(null)

  // Delete Activity State
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteActivity, setDeleteActivity] = useState<Activity | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchActivities = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        beneficiary_type: beneficiaryType,
        beneficiary_id: beneficiaryId,
      })
      if (searchQuery && searchQuery.trim()) {
        params.set("q", searchQuery.trim())
      }
      const res = await fetch(
        `/api/admin/activities/retrieve?${params.toString()}`,
      )
      if (!res.ok) throw new Error("Failed to fetch activities")
      const data = await res.json()
      setActivities(data.activities || [])
    } catch {
      setActivities([])
    } finally {
      setLoading(false)
    }
  }, [beneficiaryType, beneficiaryId, searchQuery])

  useEffect(() => {
    if (beneficiaryId) {
      fetchActivities()
    }
  }, [beneficiaryId, fetchActivities])

  const handleCreateComplete = async () => {
    await fetchActivities()
    setNewTitle("")
    setNewDescription("")
    setNewActivityType("INFO")
    onClose()
  }

  if (!beneficiaryId) {
    return (
      <div className="container mx-auto h-[calc(100vh-200px)] mt-12 flex items-center justify-center">
        <div className="text-gray-500">No beneficiary selected.</div>
      </div>
    )
  }

  if (loading) {
    return <LogoLoader size="md" minHeight="400px" />
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
        columns={getActivityColumns(
          {
            onEdit: (activity: Activity) => {
              setEditActivity(activity)
              setEditOpen(true)
            },
            onDelete: (activity: Activity) => {
              setDeleteActivity(activity)
              setDeleteOpen(true)
            },
          },
          userRole === "SUPER_ADMIN",
        )}
        data={activities}
        controls="bottom"
        tableHeight="h-64"
      />
      <CreateActivityModal
        open={open}
        onClose={onClose}
        title={newTitle}
        description={newDescription}
        activityType={newActivityType}
        beneficiaryId={beneficiaryId}
        beneficiaryName=""
        onTitleChange={setNewTitle}
        onDescriptionChange={setNewDescription}
        onActivityTypeChange={setNewActivityType}
        onComplete={handleCreateComplete}
      />
      <EditActivityModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        activity={editActivity}
        onComplete={() => {
          fetchActivities()
          setEditOpen(false)
        }}
      />
      <DeleteActivityModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        activity={deleteActivity}
        onDelete={async () => {
          setDeleting(true)
          setDeleteError(null)
          try {
            if (!deleteActivity) return
            const res = await fetch("/api/admin/activities/delete", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: deleteActivity.id }),
            })
            if (!res.ok) throw new Error("Failed to delete activity")
            setActivities((prev) =>
              prev.filter((a) => a.id !== deleteActivity.id),
            )
            setDeleteOpen(false)
          } catch (e: Error | unknown) {
            setDeleteError(
              e instanceof Error ? e.message : "Failed to delete activity",
            )
          } finally {
            setDeleting(false)
          }
        }}
        deleting={deleting}
        error={deleteError}
      />
    </div>
  )
}

export default ActivitiesTable

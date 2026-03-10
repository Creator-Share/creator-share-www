"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Activity } from "@/types/admin.types"

import React from "react"
import { Button } from "@chakra-ui/react"

export type ActivityActionHandlers = {
  onEdit: (activity: Activity) => void
  onDelete: (activity: Activity) => void
  onTogglePublic?: (activity: Activity) => void
}

export function getActivityColumns(
  handlers: ActivityActionHandlers,
  showDeleteButton: boolean = true,
): ColumnDef<unknown, unknown>[] {
  return [
    {
      accessorKey: "title",
      header: () => <span>Title</span>,
      cell: ({ row }) => (row.original as Activity).title,
    },
    {
      accessorKey: "description",
      header: () => <span>Description</span>,
      cell: ({ row }) => (row.original as Activity).description,
    },
    {
      accessorKey: "is_public",
      header: () => <span>Visibility</span>,
      cell: ({ row }) => {
        const activity = row.original as Activity
        const isPublic = activity.is_public ?? false
        return (
          <button
            onClick={() => handlers.onTogglePublic?.(activity)}
            title="Click to toggle visibility"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: "0.7rem",
              fontWeight: 600,
              cursor: handlers.onTogglePublic ? "pointer" : "default",
              border: "none",
              background: isPublic ? "#dcfce7" : "#f3f4f6",
              color: isPublic ? "#166534" : "#6b7280",
              transition: "opacity 0.15s",
            }}
          >
            <span style={{ fontSize: "0.6rem" }}>{isPublic ? "🟢" : "🔒"}</span>
            {isPublic ? "PUBLIC" : "PRIVATE"}
          </button>
        )
      },
      meta: { excludeFromClick: true },
    },
    {
      accessorKey: "created_at",
      header: () => <span>Created At</span>,
      cell: ({ row }) =>
        new Date((row.original as Activity).created_at).toLocaleString(),
    },
    {
      id: "actions",
      header: () => <span>Actions</span>,
      cell: ({ row }) => (
        <div
          style={{ display: "flex", gap: 8 }}
          className="text-center justify-center"
        >
          <Button
            size="xs"
            colorScheme="yellow"
            onClick={() => handlers.onEdit(row.original as Activity)}
          >
            Edit
          </Button>
          {showDeleteButton && (
            <Button
              size="xs"
              colorScheme="red"
              onClick={() => handlers.onDelete(row.original as Activity)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
      meta: { excludeFromClick: true },
    },
  ]
}

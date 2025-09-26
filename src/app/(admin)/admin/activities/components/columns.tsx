"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Activity } from "@/types/admin.types"

import React from "react"
import { Button } from "@chakra-ui/react"

export type ActivityActionHandlers = {
  onEdit: (activity: Activity) => void
  onDelete: (activity: Activity) => void
}

export function getActivityColumns(
  handlers: ActivityActionHandlers,
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
          <Button
            size="xs"
            colorScheme="red"
            onClick={() => handlers.onDelete(row.original as Activity)}
          >
            Delete
          </Button>
        </div>
      ),
      meta: { excludeFromClick: true },
    },
  ]
}

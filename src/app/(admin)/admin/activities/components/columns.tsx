"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Activity } from "@/types/admin.types";

export const activityColumns: ColumnDef<Activity>[] = [
  {
    accessorKey: "description",
    header: () => (
      <span>Description</span>
    ),
    cell: ({ row }) => row.original.description,
  },
  {
    accessorKey: "created_at",
    header: () => (
      <span>Created At</span>
    ),
    cell: ({ row }) =>
      new Date(row.original.created_at).toLocaleString(),
  },
];

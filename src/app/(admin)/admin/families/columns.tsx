"use client";

import { Button } from "@/components/ui/button";
import { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { LuArrowUpDown } from "react-icons/lu";
import { IoCopyOutline } from "react-icons/io5";

export type Family = {
  id: string;
  name: string;
  members: number;
  location: string;
  status: "available" | "sponsored" | "unavailable";
  created_at: string;
};

export const columns: ColumnDef<Family>[] = [
  {
    id: "select",
    meta: { excludeFromClick: true },
    header: ({ table }) => {
      const isAllSelected = table.getIsAllPageRowsSelected();
      const isSomeSelected = table.getIsSomePageRowsSelected();
      return (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            key={`header-${isAllSelected}-${isSomeSelected}`}
            className="h-5 w-5 border border-black"
            checked={isAllSelected}
            _indeterminate={isSomeSelected && !isAllSelected ? {} : undefined}
            onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          />
        </div>
      );
    },
    cell: ({ row }) => {
      return (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            key={`${row.id}-${row.getIsSelected()}`}
            className="h-5 w-5 border border-black"
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    meta: { excludeFromClick: true },
    header: ({ column }) => {
      const meta = column.columnDef.meta as { excludeFromClick?: boolean };
      if (meta?.excludeFromClick) {
        return null;
      }
      return (
        <Button
          variant="ghost"
          onClick={() =>
            column.toggleSorting(column.getIsSorted() === "asc")
          }
        >
          ID
          <LuArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      );
    },
    cell: ({ row }) => {
      const family = row.original;
      return (
        <div className="flex items-center justify-center" title={family.id}>
          <IoCopyOutline
            className="ml-1 h-4 w-4 cursor-pointer"
            onClick={() => family.id && navigator.clipboard.writeText(family.id)}
          />
        </div>
      );
    },
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() =>
          column.toggleSorting(column.getIsSorted() === "asc")
        }
      >
        Name
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "members",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() =>
          column.toggleSorting(column.getIsSorted() === "asc")
        }
      >
        Members
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "location",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() =>
          column.toggleSorting(column.getIsSorted() === "asc")
        }
      >
        Location
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() =>
          column.toggleSorting(column.getIsSorted() === "asc")
        }
      >
        Status
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "created_at",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() =>
          column.toggleSorting(column.getIsSorted() === "asc")
        }
      >
        Created At
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const family = row.original;
      return <div>{new Date(family.created_at).toLocaleDateString()}</div>;
    },
  },
];

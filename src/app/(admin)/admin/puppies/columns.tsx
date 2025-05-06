"use client";

import { Button } from "@/components/ui/button";
import { ColumnDef } from "@tanstack/react-table";
import { Checkbox } from "@/components/ui/checkbox";
import { LuArrowUpDown } from "react-icons/lu";
import { IoCopyOutline } from "react-icons/io5";

export type Puppy = {
  id: string;
  name: string;
  age: number;
  breed: string;
  status: "available" | "sponsored" | "unavailable";
  created_at: string;
};

export const columns: ColumnDef<Puppy>[] = [
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
      const puppy = row.original;
      return (
        <div className="flex items-center justify-center" title={puppy.id}>
          <IoCopyOutline
            className="ml-1 h-4 w-4 cursor-pointer"
            onClick={() => puppy.id && navigator.clipboard.writeText(puppy.id)}
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
    accessorKey: "age",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() =>
          column.toggleSorting(column.getIsSorted() === "asc")
        }
      >
        Age
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "breed",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() =>
          column.toggleSorting(column.getIsSorted() === "asc")
        }
      >
        Breed
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
      const puppy = row.original;
      return <div>{new Date(puppy.created_at).toLocaleDateString()}</div>;
    },
  },
];

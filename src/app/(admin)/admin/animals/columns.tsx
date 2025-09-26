"use client"

import { Button } from "@/components/ui/button"
import { ColumnDef } from "@tanstack/react-table"
import { Checkbox } from "@/components/ui/checkbox"
import { LuArrowUpDown } from "react-icons/lu"
import { IoCopyOutline } from "react-icons/io5"
import { AnimalBeneficiary } from "@/types/admin.types"
import { centsToDollars } from "@/utils/currency"

export const columns: ColumnDef<AnimalBeneficiary>[] = [
  {
    id: "select",
    meta: { excludeFromClick: true },
    header: ({ table }) => {
      const isAllSelected = table.getIsAllPageRowsSelected()
      const isSomeSelected = table.getIsSomePageRowsSelected()
      return (
        <div
          className="flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            key={`header-${isAllSelected}-${isSomeSelected}`}
            className="h-5 w-5 border border-black"
            checked={isAllSelected}
            _indeterminate={isSomeSelected && !isAllSelected ? {} : undefined}
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
          />
        </div>
      )
    },
    cell: ({ row }) => {
      return (
        <div
          className="flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            key={`${row.id}-${row.getIsSelected()}`}
            className="h-5 w-5 border border-black"
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      )
    },
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    meta: { excludeFromClick: true },
    header: ({ column }) => {
      const meta = column.columnDef.meta as { excludeFromClick?: boolean }
      if (meta?.excludeFromClick) {
        return null
      }
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          ID
          <LuArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
    cell: ({ row }) => {
      const animal = row.original
      return (
        <div className="flex items-center justify-center" title={animal.id}>
          <IoCopyOutline
            className="ml-1 h-4 w-4 cursor-pointer"
            onClick={() =>
              animal.id && navigator.clipboard.writeText(animal.id)
            }
          />
        </div>
      )
    },
  },
  {
    accessorKey: "name",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Name
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "username",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Username
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "biography",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Biography
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const animal = row.original
      return <div className="line-clamp-2">{animal.biography}</div>
    },
  },
  {
    accessorKey: "introduction",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Introduction
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const animal = row.original
      return <div>{animal.introduction}</div>
    },
  },
  {
    accessorKey: "budget_goal",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Budget Goal
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const animal = row.original
      return (
        <div>
          $
          {centsToDollars(
            typeof animal.budget_goal === "string"
              ? parseInt(animal.budget_goal)
              : animal.budget_goal,
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "budget_raised",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Budget Raised
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const animal = row.original
      return <div>${centsToDollars(animal.budget_raised)}</div>
    },
  },
  {
    accessorKey: "status",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Status
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "country",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Country
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "location_str",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Location
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
  },
  {
    accessorKey: "metadata.breed",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Breed
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const animal = row.original
      return <div>{animal.metadata?.breed || ""}</div>
    },
  },
  {
    accessorKey: "metadata.animal_type",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Animal Type
        <LuArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ row }) => {
      const animal = row.original
      return <div>{animal.metadata?.animal_type || ""}</div>
    },
  },
]

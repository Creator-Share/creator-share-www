"use client"

import { IoMdArrowDropdown } from "react-icons/io"
import { RxMixerHorizontal } from "react-icons/rx"
import { Table } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import {
  MenuRoot,
  MenuTrigger,
  MenuContent,
  MenuSeparator,
  MenuCheckboxItem,
} from "@/components/ui/menu"

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto hidden h-8 lg:flex"
        >
          <RxMixerHorizontal className="mr-2 h-4 w-4" />
          View
          <IoMdArrowDropdown className="ml-1 h-4 w-4" />
        </Button>
      </MenuTrigger>
      <MenuContent className="w-[150px] z-50" portalled={false}>
        <div className="px-2 py-1 text-sm font-medium text-muted-foreground">
          Toggle columns
        </div>
        <MenuSeparator />
        {table
          .getAllColumns()
          .filter(
            (column) =>
              typeof column.accessorFn !== "undefined" && column.getCanHide(),
          )
          .map((column) => (
            <MenuCheckboxItem
              key={column.id}
              className="capitalize"
              checked={column.getIsVisible()}
              onCheckedChange={(value: boolean) =>
                column.toggleVisibility(!!value)
              }
              value={column.id}
            >
              {column.id}
            </MenuCheckboxItem>
          ))}
      </MenuContent>
    </MenuRoot>
  )
}

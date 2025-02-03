"use client";

import * as React from "react";
import {
  ColumnDef,
  SortingState,
  getSortedRowModel,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  ColumnFiltersState,
  useReactTable,
  VisibilityState,
  Row,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "./DataTablePagination";
import { DataTableViewOptions } from "./column-toggle";
import { Input } from "@chakra-ui/react";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  controls?: "top" | "bottom";
  searchable?: boolean;
  onRowClick?: (data: TData, column: ColumnDef<TData, TValue>) => void;
  tableHeight?: string;
  className?: string;
  getRowProps?: (row: Row<TData>) => React.HTMLAttributes<HTMLTableRowElement>;
  initialColumnVisibility?: VisibilityState;
}
const excludeFromFiltering = ["select", "actions"];
const renderFilterInput = (id: string) => !excludeFromFiltering.includes(id);
const DEFAULT_TABLE_HEIGHT = "h-[80vh]";

export const DataTable = React.forwardRef(function DataTable<TData, TValue>(
  {
    columns,
    data,
    onRowClick,
    controls,
    tableHeight = DEFAULT_TABLE_HEIGHT,
    getRowProps,
    initialColumnVisibility = {},
  }: DataTableProps<TData, TValue>,
  ref: React.Ref<unknown>
) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialColumnVisibility);
  const [rowSelection, setRowSelection] = React.useState({});

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnFiltersChange: setColumnFilters,
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
    },
    initialState: {
      columnVisibility: initialColumnVisibility,
      pagination: { pageSize: 10 },
    },
  });

  // Log pagination info for debugging:
  console.log("Data length:", data.length);
  console.log("Page count:", table.getPageCount());

  // Reset to page 0 if data changes
  React.useEffect(() => {
    table.setPageIndex(0);
  }, [data]);

  React.useImperativeHandle(ref, () => ({
    getTableInstance: () => table,
    getSelectedRowModel: () => table.getSelectedRowModel(),
  }));

  return (
    <div className="flex flex-col h-full">
      {controls === "top" && (
        <div className="flex flex-row justify-between items-center">
          <DataTablePagination table={table} />
          <DataTableViewOptions table={table} />
        </div>
      )}
      <div className={`rounded-md border mt-3 h-full overflow-auto ${tableHeight}`}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-center">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {renderFilterInput(header.id) && (
                      <div className="flex items-center py-4">
                        <Input
                          placeholder="Search..."
                          value={
                            (table.getColumn(header.id)?.getFilterValue() as string) ?? ""
                          }
                          onChange={(event) =>
                            table.getColumn(header.id)?.setFilterValue(event.target.value)
                          }
                          className="max-w-sm"
                        />
                      </div>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="overflow-scroll h-full">
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="text-center cursor-pointer hover:bg-slate-20"
                  {...(getRowProps ? getRowProps(row) : {})}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      onClick={() => onRowClick && onRowClick(row.original, cell.column.columnDef)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {controls === "bottom" && (
        <div className="flex flex-row justify-between items-center pt-4">
          <DataTablePagination table={table} />
          <DataTableViewOptions table={table} />
        </div>
      )}
    </div>
  );
});

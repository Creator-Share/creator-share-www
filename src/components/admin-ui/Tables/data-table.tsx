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
// import { Input } from "@chakra-ui/react";

/* eslint-disable @typescript-eslint/no-unused-vars */
declare module "@tanstack/table-core" {
  interface ColumnMeta<TData, TValue> {
    excludeFromClick?: boolean;
  }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

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
  onRowSelectionChange?: (rowSelection: Record<string, unknown>) => void;
}
// const excludeFromFiltering = ["select", "actions", "id"];
// const renderFilterInput = (id: string) => !excludeFromFiltering.includes(id);
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
    onRowSelectionChange,
  }: DataTableProps<TData, TValue>,
  ref: React.Ref<unknown>
) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialColumnVisibility);
  const [rowSelection, setRowSelection] = React.useState({});

  React.useEffect(() => {
    if (onRowSelectionChange) {
      onRowSelectionChange(rowSelection);
    }
  }, [rowSelection, onRowSelectionChange]);

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
      <div className={`rounded-xl border mt-3 h-full overflow-auto ${tableHeight}`}>
        <Table>
          <TableHeader className="bg-[#E5EEFB]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-center text-[#727D79] px-6 py-3">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {/* {renderFilterInput(header.id) && (
                      <div className="flex justify-center items-center w-full py-4">
                        <Input
                          placeholder="Search..."
                          value={
                            (table.getColumn(header.id)?.getFilterValue() as string) ?? ""
                          }
                          onChange={(event) =>
                            table.getColumn(header.id)?.setFilterValue(event.target.value)
                          }
                          className="max-w-sm p-2"
                        />
                      </div>
                    )} */}
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
                      onClick={() => {
                        const columnDef = cell.column.columnDef;
                        if (columnDef.meta?.excludeFromClick && onRowClick) {
                          return;
                        }
                        if (onRowClick) {
                          onRowClick(row.original, columnDef);
                        }
                      }}
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

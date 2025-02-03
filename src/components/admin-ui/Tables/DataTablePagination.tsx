"use client";

import React from "react";
import type { Table } from "@tanstack/react-table";
import {
  PaginationRoot,
  PaginationPrevTrigger,
  PaginationNextTrigger,
  PaginationItems,
  PaginationPageText,
} from "@/components/ui/pagination";

interface DataTablePaginationProps<TData> {
  table: Table<TData>;
}

export function DataTablePagination<TData>({ table }: DataTablePaginationProps<TData>) {
  const { pageIndex } = table.getState().pagination;
  const currentPage = pageIndex + 1;
  const totalPages = table.getPageCount();

  return (
    <div className="flex items-center justify-center">
      <PaginationRoot
        page={currentPage}
        count={totalPages}
        onPageChange={(details: { page: number }) => table.setPageIndex(details.page - 1)}
      >
        <PaginationPrevTrigger />
        <PaginationItems />
        <PaginationNextTrigger />
        <PaginationPageText format="compact" />
      </PaginationRoot>
    </div>
  );
}

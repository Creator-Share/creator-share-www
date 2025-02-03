"use client";

import React from "react";
import { HStack } from "@chakra-ui/react";
import type { Table } from "@tanstack/react-table";
import {
    PaginationRoot,
    PaginationPrevTrigger,
    PaginationNextTrigger,
    PaginationItems,
} from "@/components/ui/pagination";

interface DataTablePaginationProps<TData> {
    table: Table<TData>;
}

export function DataTablePagination<TData>({ table }: DataTablePaginationProps<TData>) {
    const { pageIndex } = table.getState().pagination;
    const currentPage = pageIndex + 1;

    return (
        <div className="flex items-center justify-center">
            <PaginationRoot
                page={currentPage}
                count={table.getFilteredRowModel().rows.length}
                pageSize={table.getState().pagination.pageSize}
                onPageChange={(details: { page: number }) =>
                    table.setPageIndex(details.page - 1)
                }
            >
                <HStack>
                    <PaginationPrevTrigger />
                    <PaginationItems />
                    <PaginationNextTrigger />
                </HStack>
            </PaginationRoot>
        </div>
    );
}

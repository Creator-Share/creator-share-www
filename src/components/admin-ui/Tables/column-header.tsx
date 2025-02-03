"use client";

import React from "react";
import { Column } from "@tanstack/react-table";
import { cn } from "@/utils/cn";
import { Button } from "@/components/ui/button";
import { FaArrowDown, FaArrowUp } from "react-icons/fa6";
import { RxCaretSort, RxEyeNone } from "react-icons/rx";
import {
  MenuRoot,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
} from "@/components/ui/menu";

interface DataTableColumnHeaderProps<TData, TValue>
  extends React.HTMLAttributes<HTMLDivElement> {
  column: Column<TData, TValue>;
  title: string;
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return <div className={cn(className)}>{title}</div>;
  }

  return (
    <div className={cn("flex items-center space-x-2", className)}>
      <MenuRoot>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-3 h-8">
            <span>{title}</span>
            {column.getIsSorted() === "desc" ? (
              <FaArrowDown className="ml-2 h-4 w-4" />
            ) : column.getIsSorted() === "asc" ? (
              <FaArrowUp className="ml-2 h-4 w-4" />
            ) : (
              <RxCaretSort className="ml-2 h-4 w-4" />
            )}
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            value="asc"
            onClick={() => column.toggleSorting(false)}
          >
            <FaArrowUp className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
            <span>Asc</span>
          </MenuItem>
          <MenuItem
            value="desc"
            onClick={() => column.toggleSorting(true)}
          >
            <FaArrowDown className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
            <span>Desc</span>
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            value="hide"
            onClick={() => column.toggleVisibility(false)}
          >
            <RxEyeNone className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
            <span>Hide</span>
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    </div>
  );
}

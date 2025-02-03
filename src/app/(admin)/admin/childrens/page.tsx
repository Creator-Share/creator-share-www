"use client";

import React, { useEffect, useState } from "react";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { columns } from "./columns";
import { People } from "@/types/admin.types";
import { createClient } from "@/utils/supabase/client";

const ChildrenTable = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<People[]>([]);

  useEffect(() => {
    async function fetchData() {
      const supabase = createClient();
      const { data: fetchedData, error } = await supabase
        .from("people")
        .select("*");
      if (error) {
        console.error("Error fetching people:", error);
      } else if (fetchedData) {
        setData(fetchedData as People[]);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto h-[calc(100vh-200px)]">
      <div className="grid grid-cols-2 mb-2">
        <h1 className="text-3xl font-semibold leading-9">Children</h1>
        {/* Uncomment and adjust if you need a button for creating new records */}
        {/*
        <div className="justify-self-end">
          <Button
            className="border-[2px] border-[#E0E0E0] w-fit h-[40px]"
            onClick={() => setShowCreateModal(true)}
            variant="destructive"
            disabled={viewServiceProvider?.id ? false : true}
          >
            <PlusCircledIcon className="mr-[3.5px]" /> New Group
          </Button>
        </div>
        */}
      </div>
      <DataTable
        className=""
        columns={columns as ColumnDef<unknown, unknown>[]}
        data={data}
        controls="bottom"
      />
    </div>
  );
};

export default ChildrenTable;

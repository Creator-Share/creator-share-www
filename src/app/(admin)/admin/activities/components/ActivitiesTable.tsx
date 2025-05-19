"use client";

import React, { useEffect, useState } from "react";
import { activityColumns } from "./columns";
import { Activity } from "@/types/admin.types";
import { DataTable } from "@/components/admin-ui/Tables/data-table";
import { ColumnDef } from "@tanstack/react-table";

interface ActivitiesTableProps {
  beneficiaryType: string;
  beneficiaryId: string;
}

const ActivitiesTable: React.FC<ActivitiesTableProps> = ({
  beneficiaryType,
  beneficiaryId,
}) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchActivities = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          beneficiary_type: beneficiaryType,
          beneficiary_id: beneficiaryId,
        });
        const res = await fetch(`/api/admin/activities/retrieve?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to fetch activities");
        const data = await res.json();
        setActivities(data.activities || []);
      } catch {
        setActivities([]);
      }
      setLoading(false);
    };
    if (beneficiaryId) {
      fetchActivities();
    }
  }, [beneficiaryType, beneficiaryId]);

  if (!beneficiaryId) {
    return <div className="text-gray-500">No beneficiary selected.</div>;
  }

  if (loading) {
    return <div>Loading activities...</div>;
  }

  return (
    <div className="">
      <h3 className="font-semibold mb-2">Activities</h3>
      <DataTable
        columns={activityColumns as unknown as ColumnDef<unknown, unknown>[]}
        data={activities}
        controls="bottom"
        tableHeight="h-64"
      />
    </div>
  );
};

export default ActivitiesTable;

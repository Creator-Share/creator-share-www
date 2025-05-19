"use client";

import React, { useEffect, useState } from "react";
import { Activity, Beneficiaries } from "@/types/admin.types";
import { Input } from "@chakra-ui/react";
import ChakraSelect from "./components/SelectBeneficiary";

const ActivitiesAdminPage: React.FC = () => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [children, setChildren] = useState<Beneficiaries[]>([]);
  const [selectedChild, setSelectedChild] = useState<string[]>([]);

  // Fetch children (beneficiaries) from Supabase
  useEffect(() => {
    const fetchChildren = async () => {
      const res = await fetch("/api/admin/children/retrieve");
      const data = await res.json();
      console.log("Fetched children from /api/admin/children/retrieve:", {
        data,
        firstChild: data.children?.[0],
        childCount: data.children?.length || 0,
        hasName: data.children?.[0]?.name,
        hasId: data.children?.[0]?.id
      });
      setChildren(data.children || []);
    };
    fetchChildren();
  }, []);

  // Fetch activities from the correct endpoint
  const fetchActivities = React.useCallback(async () => {
    let url = "/api/admin/activities/retrieve";
    if (selectedChild.length > 0) {
      url += `?beneficiary_id=${selectedChild[0]}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    setActivities(data.activities || []);
  }, [selectedChild]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Add activity form state
  const [newDescription, setNewDescription] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAddActivity = async () => {
    if (selectedChild.length === 0 || !newDescription.trim()) return;
    setAdding(true);
    await fetch("/api/admin/activities/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: newDescription,
        beneficiary_id: selectedChild[0],
      }),
    });
    setNewDescription("");
    setAdding(false);
    await fetchActivities();
  };

  return (
    <div style={{ padding: 24 }}>
      <h1>Activities Admin</h1>
      <div>
        <label>
          Select Child:{" "}
          <ChakraSelect
            childrenList={children}
            selectedChild={selectedChild}
            setSelectedChild={setSelectedChild}
          />
        </label>
      </div>
      <div style={{ marginTop: 24 }}>
        <h2>Activities</h2>
        <ul>
          {activities.map(a => (
            <li key={a.id}>
              <strong>{a.description}</strong> (Created: {a.created_at})
              <button
                style={{ marginLeft: 12, color: "red" }}
                onClick={async () => {
                  if (!window.confirm("Delete this activity?")) return;
                  await fetch(`/api/admin/activities/delete?id=${a.id}`, {
                    method: "DELETE",
                  });
                  await fetchActivities();
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 16 }}>
          <Input
            type="text"
            placeholder="New activity description"
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
            disabled={selectedChild.length === 0 || adding}
            p={2}
            w={'50%'}
            className="border border-[#ff5733]"
          />
          <button
            onClick={handleAddActivity}
            disabled={selectedChild.length === 0 || !newDescription.trim() || adding}
            style={{ marginLeft: 8 }}
          >
            {adding ? "Adding..." : "Add Activity"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActivitiesAdminPage
"use client";

import React, { useEffect, useState } from "react";
import { Beneficiaries } from "@/types/admin.types";
import { Box, Text } from "@chakra-ui/react";
import ChakraSelect from "./components/SelectBeneficiary";
import ActivitiesTable from "./components/ActivitiesTable";

const ActivitiesAdminPage: React.FC = () => {
  const [children, setChildren] = useState<Beneficiaries[]>([]);
  const [selectedChild, setSelectedChild] = useState<string[]>([]);
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

  return (
    <Box className="container mx-auto h-[calc(100vh-200px)] mt-12">
      <Text className="text-3xl font-semibold leading-9 mb-6">Activities</Text>
      <Box className="mb-6">
        <ChakraSelect
          childrenList={children}
          selectedChild={selectedChild}
          setSelectedChild={setSelectedChild}
        />
      </Box>
      <ActivitiesTable
        beneficiaryType="CHILD"
        beneficiaryId={selectedChild[0] || ''}
      />
    </Box>
  );
};

export default ActivitiesAdminPage

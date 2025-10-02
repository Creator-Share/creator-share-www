"use client"
import React, { useEffect, useState } from "react"
import { Beneficiaries } from "@/types/admin.types"
import { Box } from "@chakra-ui/react"
import ChakraSelect from "./components/SelectBeneficiary"
import ActivitiesTable from "./components/ActivitiesTable"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"

const ActivitiesAdminPage: React.FC = () => {
  const [children, setChildren] = useState<Beneficiaries[]>([])
  const [selectedChild, setSelectedChild] = useState<string[]>([])
  
  useEffect(() => {
    const fetchChildren = async () => {
      const res = await fetch("/api/admin/beneficiaries/retrieve")
      const data = await res.json()
      setChildren(data.children || [])
    }
    fetchChildren()
  }, [])

  return (
    <AdminPageLayout
      title="Activities"
      description="Manage activities for beneficiaries"
      breadcrumb={[{ label: "Activities" }]}
      searchPlaceholder="Search activities..."
      searchValue=""
      onSearchChange={() => {}}
      showResults={true}
    >
      <Box className="mb-6">
        <ChakraSelect
          childrenList={children}
          selectedChild={selectedChild}
          setSelectedChild={setSelectedChild}
        />
      </Box>
      <ActivitiesTable
        beneficiaryType="CHILD"
        beneficiaryId={selectedChild[0] || ""}
      />
    </AdminPageLayout>
  )
}

export default ActivitiesAdminPage

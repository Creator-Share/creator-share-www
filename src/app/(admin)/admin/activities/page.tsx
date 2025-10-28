"use client"
import React, { useEffect, useState } from "react"
import { Beneficiaries } from "@/types/admin.types"
import { Box } from "@chakra-ui/react"
import ChakraSelect from "./components/SelectBeneficiary"
import ActivitiesTable from "./components/ActivitiesTable"
import AdminPageLayout from "@/components/admin-ui/AdminPageLayout"

const ActivitiesAdminPage: React.FC = () => {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiaries[]>([])
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<string[]>([])
  
  useEffect(() => {
    const fetchBeneficiaries = async () => {
      try {
        const res = await fetch("/api/admin/beneficiaries/retrieve?beneficiary_type=CHILD")
        const data = await res.json()
        setBeneficiaries(data.beneficiaries || [])
      } catch (error) {
        console.error("Failed to fetch beneficiaries:", error)
        setBeneficiaries([])
      }
    }
    fetchBeneficiaries()
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
          childrenList={beneficiaries}
          selectedChild={selectedBeneficiary}
          setSelectedChild={setSelectedBeneficiary}
        />
      </Box>
      <ActivitiesTable
        beneficiaryType="CHILD"
        beneficiaryId={selectedBeneficiary[0] || ""}
      />
    </AdminPageLayout>
  )
}

export default ActivitiesAdminPage

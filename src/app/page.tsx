"use client"
import { useState, useCallback } from "react"
import { Box } from "@chakra-ui/react"
import { HomeHero } from "@/components/HomeHero"
import SponsorshipsContainer from "./sponsorships/components/SponsorshipsContainer"
import type { BeneficiaryTabType } from "@/components/BeneficiaryTypeNav"

export default function Home() {
  const [activeType, setActiveType] = useState<BeneficiaryTabType | null>(null)

  const handleTypeChange = useCallback((type: BeneficiaryTabType | null) => {
    setActiveType(type)
  }, [])

  return (
    <Box minH={{ base: "auto", lg: "130vh" }} pb={{ base: 0, lg: 40 }}>
      <HomeHero activeType={activeType} onTypeChange={handleTypeChange} />
      <SponsorshipsContainer activeType={activeType} onTypeChange={handleTypeChange} />
    </Box>
  )
}

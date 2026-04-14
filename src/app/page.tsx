"use client"
import { useState, useCallback } from "react"
import { Box } from "@chakra-ui/react"
import { HomeHero } from "@/components/HomeHero"
import SponsorshipsContainer from "./sponsorships/components/SponsorshipsContainer"
import type { BeneficiaryTabType } from "@/config/beneficiaryTypes"
import { HomeBgPicker } from "@/components/HomeBg"

export default function Home() {
  const [activeType, setActiveType] = useState<BeneficiaryTabType | null>(null)

  const handleTypeChange = useCallback((type: BeneficiaryTabType | null) => {
    setActiveType(type)
  }, [])

  return (
    <Box position="relative" minH={{ base: "auto", lg: "130vh" }} pb={{ base: 0, lg: 40 }}>
      <HomeBgPicker />
      <div style={{ position: "relative", zIndex: 1 }}>
        <HomeHero activeType={activeType} onTypeChange={handleTypeChange} />
        <SponsorshipsContainer activeType={activeType} onTypeChange={handleTypeChange} />
      </div>
    </Box>
  )
}

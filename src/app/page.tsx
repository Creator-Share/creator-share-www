"use client"
import { useState, useCallback } from "react"
import { Box } from "@chakra-ui/react"
import { HomeHero } from "@/components/HomeHero"
import SponsorshipsContainer from "./sponsorships/components/SponsorshipsContainer"
import { HomeBgPicker } from "@/components/debug/HomeBgPicker"
import type { BeneficiaryTabType } from "@/components/BeneficiaryTypeNav"

export default function Home() {
  const [activeType, setActiveType] = useState<BeneficiaryTabType | null>(null)

  const handleTypeChange = useCallback((type: BeneficiaryTabType | null) => {
    setActiveType(type)
  }, [])

  return (
    <Box position="relative" minH={{ base: "auto", lg: "130vh" }} pb={{ base: 0, lg: 40 }}>
      {/* Renders the SVG background (absolute, z-index 0) + the ◈ debug switcher (fixed) */}
      <HomeBgPicker />

      {/* All page content sits above the background */}
      <div style={{ position: "relative", zIndex: 1 }}>
        <HomeHero activeType={activeType} onTypeChange={handleTypeChange} />
        <SponsorshipsContainer activeType={activeType} onTypeChange={handleTypeChange} />
      </div>
    </Box>
  )
}

"use client"
import { Box } from "@chakra-ui/react"
import { HomeHero } from "@/components/HomeHero"
import { StatsSection } from "@/components/StatsSection"
import SponsorshipsContainer from "../components/SponsorshipsContainer"

/**
 * Direct-link route for child profiles (e.g. /sponsorships/kfxg0n82).
 * SponsorshipsContainer reads window.location.pathname on mount and
 * automatically opens the matching child's modal, so no extra prop plumbing
 * is needed here.
 */
export default function ChildProfilePage() {
  return (
    <Box minH="130vh" pb={40}>
      <HomeHero />
      <StatsSection />
      <SponsorshipsContainer />
    </Box>
  )
}

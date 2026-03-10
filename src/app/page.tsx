"use client"
import { Box } from "@chakra-ui/react"
import { HomeHero } from "@/components/HomeHero"
import SponsorshipsContainer from "./sponsorships/components/SponsorshipsContainer"

export default function Home() {
  return (
    <Box minH="130vh" pb={40}>
      <HomeHero />
      <SponsorshipsContainer />
    </Box>
  )
}

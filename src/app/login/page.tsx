"use client"
import { Box } from "@chakra-ui/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { HomeHero } from "@/components/HomeHero"
import { StatsSection } from "@/components/StatsSection"
import SponsorshipsContainer from "../sponsorships/components/SponsorshipsContainer"
import { useAuthStore } from "@/store/authStore"

// Renders the homepage content with the sign-in modal open.
// The PageNavbar detects the /login path and opens the SignInModal automatically.
export default function LoginPage() {
  const router = useRouter()
  const user = useAuthStore((state) => state.user)

  useEffect(() => {
    if (user) router.push("/")
  }, [user, router])

  return (
    <Box minH="130vh" pb={40}>
      <HomeHero />
      <StatsSection />
      <SponsorshipsContainer />
    </Box>
  )
}

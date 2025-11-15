"use client"

import { useState } from "react"
import { ThemeProvider } from "next-themes"
import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import { QueryClient } from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
import { SponsorshipProvider } from "@/app/sponsorships/hooks/useSponsorship"
import { ReservationsProvider } from "@/app/sponsorships/hooks/useReservations"
import { PresenceProvider } from "@/hooks/usePresence"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <ChakraProvider value={defaultSystem}>
      <ThemeProvider
        attribute="class"
        disableTransitionOnChange
        defaultTheme="light"
      >
        <QueryClientProvider client={queryClient}>
          <PresenceProvider>
            <ReservationsProvider>
              <SponsorshipProvider>
                {children}
              </SponsorshipProvider>
            </ReservationsProvider>
          </PresenceProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ChakraProvider>
  )
}

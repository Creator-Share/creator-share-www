"use client"

import { useState } from "react"
import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import { QueryClient } from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
import { SponsorshipProvider } from "@/app/sponsorships/hooks/useSponsorship"

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <ChakraProvider value={defaultSystem}>
      <QueryClientProvider client={queryClient}>
        <SponsorshipProvider>
          {children}
        </SponsorshipProvider>
      </QueryClientProvider>
    </ChakraProvider>
  )
}

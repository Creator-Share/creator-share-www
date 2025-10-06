"use client"

import { useState } from "react"
import { ThemeProvider } from "next-themes"
import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import { QueryClient } from "@tanstack/react-query"
import { QueryClientProvider } from "@tanstack/react-query"
// import { ColorModeProvider } from "./ui/color-mode";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <ChakraProvider value={defaultSystem}>
      <ThemeProvider
        attribute="class"
        disableTransitionOnChange
        defaultTheme="light"
      >
        {/* <ColorModeProvider> */}
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
        {/* </ColorModeProvider> */}
      </ThemeProvider>
    </ChakraProvider>
  )
}
